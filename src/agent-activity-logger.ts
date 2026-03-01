/**
 * AgentActivityLogger
 *
 * Writes a per-agent append-only JSONL log file so you can later audit:
 *   - Every user chat message that arrived
 *   - Every LLM response (stop reason, token counts, duration)
 *   - Every tool call (name + args) and its result (output, duration, success)
 *   - Every inbox message received from another agent
 *   - Why the agent loop exited (stop_sequence, max_turns, loop_detected, user_stopped, error)
 *   - API errors (rate limits, timeouts, etc.)
 *
 * File location:  projects/<projectFolder>/<agentHomeFolder>/.agent-log.jsonl
 * If homeFolder is "/" (root agent), the file goes in projects/<projectFolder>/.agent-log-<agentId>.jsonl
 *
 * Each line is a self-contained JSON object:
 * {
 *   t:          Unix ms timestamp
 *   agentId:    string
 *   projectId:  string
 *   type:       EventType (see below)
 *   ...fields specific to the event type
 * }
 */

import * as fs from "fs"
import * as path from "path"
import { getLog } from "./logger"

// ── Event types ────────────────────────────────────────────────────────────────

export type ActivityEventType =
    | "chat_in"       // User (or system prompt injection) sent a message to this agent
    | "chat_out"      // Agent produced a text response
    | "tool_call"     // Agent invoked a tool
    | "tool_result"   // Tool returned a result
    | "inbox_msg"     // Message arrived from another agent via the inbox
    | "loop_exit"     // Agentic loop ended (reason recorded)
    | "api_error"     // LLM API call failed
    | "agent_start"   // Agent loop began (new conversation turn)
    | "agent_stop"    // Agent was explicitly stopped by user

export interface BaseEvent {
    t: number
    agentId: string
    projectId: string
    type: ActivityEventType
}

export interface ChatInEvent extends BaseEvent {
    type: "chat_in"
    role: "user" | "system" | "agent"
    content: string
    /** true when this message came from an attachment/file injection */
    hasAttachments?: boolean
    /** set when role === "agent" — the sending agent's name */
    fromAgent?: string
}

export interface ChatOutEvent extends BaseEvent {
    type: "chat_out"
    content: string
    stopReason: string        // "end_turn" | "tool_use" | "stop_sequence" | "max_tokens" | ...
    inputTokens?: number
    outputTokens?: number
    durationMs: number
    iteration: number
}

export interface ToolCallEvent extends BaseEvent {
    type: "tool_call"
    tool: string
    args: Record<string, unknown>
    iteration: number
    callIndex: number         // position within this iteration (0-based)
}

export interface ToolResultEvent extends BaseEvent {
    type: "tool_result"
    tool: string
    iteration: number
    callIndex: number
    success: boolean
    durationMs: number
    /** Full tool output */
    output: string
    outputLength: number
}

export interface InboxMsgEvent extends BaseEvent {
    type: "inbox_msg"
    from: string
    content: string
}

export type LoopExitReason =
    | "end_turn"            // Model said it was done (no tool calls)
    | "user_stopped"        // User clicked Stop
    | "max_iterations"      // Hit MAX_TOOL_ITERATIONS
    | "loop_detected"       // Repeated tool / text / command loop
    | "api_error"           // Unrecoverable API failure
    | "stop_sequence"       // Model hit a stop sequence
    | "max_tokens"          // Context too long
    | "unknown"

export interface LoopExitEvent extends BaseEvent {
    type: "loop_exit"
    reason: LoopExitReason
    iterations: number
    totalToolCalls: number
    durationMs: number
    detail?: string           // Extra info, e.g. which tool was looping
}

export interface ApiErrorEvent extends BaseEvent {
    type: "api_error"
    iteration: number
    statusCode?: number
    message: string
    retryable: boolean
}

export interface AgentStartEvent extends BaseEvent {
    type: "agent_start"
    trigger: "user_chat" | "inbox_msg" | "task_claim"
    model: string
}

export interface AgentStopEvent extends BaseEvent {
    type: "agent_stop"
    reason: "user_request"
}

export type ActivityEvent =
    | ChatInEvent
    | ChatOutEvent
    | ToolCallEvent
    | ToolResultEvent
    | InboxMsgEvent
    | LoopExitEvent
    | ApiErrorEvent
    | AgentStartEvent
    | AgentStopEvent

// ── Logger class ───────────────────────────────────────────────────────────────

export class AgentActivityLogger {
    /** projectsRoot: absolute path to the "projects" folder */
    private readonly projectsRoot: string
    /** Optional real-time emitter; called after every successful file write */
    private emitFn?: (event: ActivityEvent) => void

    constructor(projectsRoot: string) {
        this.projectsRoot = projectsRoot
    }

    /**
     * Attach a real-time emit function (e.g. `(e) => io.emit("agent-activity", e)`) so
     * the UI Activity panel can update live instead of only on manual refresh.
     */
    setEmitter(fn: (event: ActivityEvent) => void): void {
        this.emitFn = fn
    }

    // ── Public helpers ──────────────────────────────────────────────────────

    now(): number {
        return Date.now()
    }

    logAgentStart(
        projectId: string,
        agentId: string,
        projectFolder: string,
        agentHomeFolder: string,
        trigger: AgentStartEvent["trigger"],
        model: string,
    ): void {
        this.write(projectFolder, agentHomeFolder, agentId, {
            t: Date.now(),
            agentId,
            projectId,
            type: "agent_start",
            trigger,
            model,
        } satisfies AgentStartEvent)
    }

    logAgentStop(
        projectId: string,
        agentId: string,
        projectFolder: string,
        agentHomeFolder: string,
    ): void {
        this.write(projectFolder, agentHomeFolder, agentId, {
            t: Date.now(),
            agentId,
            projectId,
            type: "agent_stop",
            reason: "user_request",
        } satisfies AgentStopEvent)
    }

    logChatIn(
        projectId: string,
        agentId: string,
        projectFolder: string,
        agentHomeFolder: string,
        content: string,
        role: ChatInEvent["role"] = "user",
        fromAgent?: string,
        hasAttachments = false,
    ): void {
        this.write(projectFolder, agentHomeFolder, agentId, {
            t: Date.now(),
            agentId,
            projectId,
            type: "chat_in",
            role,
            content,
            hasAttachments,
            ...(fromAgent ? { fromAgent } : {}),
        } as ChatInEvent)
    }

    logChatOut(
        projectId: string,
        agentId: string,
        projectFolder: string,
        agentHomeFolder: string,
        content: string,
        stopReason: string,
        iteration: number,
        startedAt: number,
        tokens?: { input?: number; output?: number },
    ): void {
        this.write(projectFolder, agentHomeFolder, agentId, {
            t: Date.now(),
            agentId,
            projectId,
            type: "chat_out",
            content,
            stopReason,
            inputTokens: tokens?.input,
            outputTokens: tokens?.output,
            durationMs: Date.now() - startedAt,
            iteration,
        } satisfies ChatOutEvent)
    }

    logToolCall(
        projectId: string,
        agentId: string,
        projectFolder: string,
        agentHomeFolder: string,
        tool: string,
        args: Record<string, unknown>,
        iteration: number,
        callIndex: number,
    ): void {
        const safeArgs = sanitizeArgs(args)
        this.write(projectFolder, agentHomeFolder, agentId, {
            t: Date.now(),
            agentId,
            projectId,
            type: "tool_call",
            tool,
            args: safeArgs,
            iteration,
            callIndex,
        } satisfies ToolCallEvent)
    }

    logToolResult(
        projectId: string,
        agentId: string,
        projectFolder: string,
        agentHomeFolder: string,
        tool: string,
        output: string,
        success: boolean,
        iteration: number,
        callIndex: number,
        startedAt: number,
    ): void {
        this.write(projectFolder, agentHomeFolder, agentId, {
            t: Date.now(),
            agentId,
            projectId,
            type: "tool_result",
            tool,
            iteration,
            callIndex,
            success,
            durationMs: Date.now() - startedAt,
            output,
            outputLength: output.length,
        } satisfies ToolResultEvent)
    }

    logInboxMsg(
        projectId: string,
        agentId: string,
        projectFolder: string,
        agentHomeFolder: string,
        from: string,
        content: string,
    ): void {
        this.write(projectFolder, agentHomeFolder, agentId, {
            t: Date.now(),
            agentId,
            projectId,
            type: "inbox_msg",
            from,
            content,
        } satisfies InboxMsgEvent)
    }

    logLoopExit(
        projectId: string,
        agentId: string,
        projectFolder: string,
        agentHomeFolder: string,
        reason: LoopExitReason,
        iterations: number,
        totalToolCalls: number,
        startedAt: number,
        detail?: string,
    ): void {
        this.write(projectFolder, agentHomeFolder, agentId, {
            t: Date.now(),
            agentId,
            projectId,
            type: "loop_exit",
            reason,
            iterations,
            totalToolCalls,
            durationMs: Date.now() - startedAt,
            detail,
        } satisfies LoopExitEvent)
    }

    logApiError(
        projectId: string,
        agentId: string,
        projectFolder: string,
        agentHomeFolder: string,
        iteration: number,
        message: string,
        retryable: boolean,
        statusCode?: number,
    ): void {
        this.write(projectFolder, agentHomeFolder, agentId, {
            t: Date.now(),
            agentId,
            projectId,
            type: "api_error",
            iteration,
            statusCode,
            message,
            retryable,
        } satisfies ApiErrorEvent)
    }

    // ── Read back (for the API endpoint) ────────────────────────────────────

    /**
     * Returns the last `limit` events from the agent's log as parsed objects.
     * If the file doesn't exist returns [].
     */
    readLog(
        projectFolder: string,
        agentHomeFolder: string,
        agentId: string,
        limit = 500,
    ): ActivityEvent[] {
        const filePath = this.logPath(projectFolder, agentHomeFolder, agentId)
        if (!fs.existsSync(filePath)) return []
        try {
            const lines = fs.readFileSync(filePath, "utf8")
                .split("\n")
                .filter(Boolean)
            const tail = lines.slice(-limit)
            return tail.map(l => JSON.parse(l) as ActivityEvent)
        } catch (e) {
            getLog().error("[AgentActivityLogger] Failed to read log:", e)
            return []
        }
    }

    /**
     * Clears (truncates) the log file for a given agent.
     * Returns true if the file existed and was cleared, false if it didn't exist.
     */
    clearLog(
        projectFolder: string,
        agentHomeFolder: string,
        agentId: string,
    ): boolean {
        const filePath = this.logPath(projectFolder, agentHomeFolder, agentId)
        if (!fs.existsSync(filePath)) return false
        try {
            fs.writeFileSync(filePath, "", "utf8")
            getLog().info(`[AgentActivityLogger] Cleared log: ${filePath}`)
            return true
        } catch (e) {
            getLog().error("[AgentActivityLogger] Failed to clear log:", e)
            return false
        }
    }

    /** Absolute path to the log file for a given agent */
    logPath(projectFolder: string, agentHomeFolder: string, agentId: string): string {
        if (!agentHomeFolder || agentHomeFolder === "/") {
            return path.join(this.projectsRoot, projectFolder, `.agent-log-${agentId}.jsonl`)
        }
        return path.join(this.projectsRoot, projectFolder, agentHomeFolder, ".agent-log.jsonl")
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    private write(
        projectFolder: string,
        agentHomeFolder: string,
        agentId: string,
        event: ActivityEvent,
    ): void {
        try {
            const filePath = this.logPath(projectFolder, agentHomeFolder, agentId)
            const dir = path.dirname(filePath)
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
            fs.appendFileSync(filePath, JSON.stringify(event) + "\n", "utf8")
            // Notify real-time listeners (e.g. Socket.IO) after a successful write
            this.emitFn?.(event)
        } catch (e) {
            // Never let logging crash the agent
            getLog().warn("[AgentActivityLogger] Write failed:", e)
        }
    }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
    return args
}
