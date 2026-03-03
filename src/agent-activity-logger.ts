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

    // ── ERRORS.md Management ──────────────────────────────────────────────────

    private static readonly MAX_OCCURRENCES_PER_TOOL = 5

    /** Path to ERRORS.md for a given agent */
    errorsPath(projectFolder: string, agentHomeFolder: string): string {
        if (!agentHomeFolder || agentHomeFolder === "/") {
            return path.join(this.projectsRoot, projectFolder, "ERRORS.md")
        }
        return path.join(this.projectsRoot, projectFolder, agentHomeFolder, "ERRORS.md")
    }

    /**
     * Extract a signature from error output for deduplication.
     * Strips timestamps, paths, and variable content to get a stable pattern.
     */
    private extractErrorSignature(errorOutput: string): string {
        return errorOutput
            .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/g, "") // timestamps
            .replace(/\/[\w\-\.\/]+/g, "/PATH") // file paths
            .replace(/:\d+:\d+/g, ":LINE:COL") // line:col
            .replace(/0x[0-9a-fA-F]+/g, "0xADDR") // hex addresses
            .replace(/\s+/g, " ") // normalize whitespace
            .trim()
            .substring(0, 80)
    }

    /**
     * Record a tool error to ERRORS.md with deduplication.
     * - Same error signature within a tool section → update count instead of new entry
     * - Limits to MAX_OCCURRENCES_PER_TOOL per tool (drops oldest)
     */
    recordToolError(
        projectFolder: string,
        agentHomeFolder: string,
        tool: string,
        args: Record<string, unknown>,
        errorOutput: string,
    ): void {
        try {
            const filePath = this.errorsPath(projectFolder, agentHomeFolder)
            const timestamp = new Date().toISOString().replace("T", " ").split(".")[0]
            const errorSignature = this.extractErrorSignature(errorOutput)
            const errorPreview = errorOutput.substring(0, 200).replace(/\n/g, " ").trim()

            let content = ""
            if (fs.existsSync(filePath)) {
                content = fs.readFileSync(filePath, "utf8")
            } else {
                content = `# Errors Log

Tool errors for learning. Update **Solution** when you solve an error.
When a solution works well, consider creating a Skill in \`skills/\` folder.

`
            }

            const sectionHeader = `## ${tool}`
            
            // Check if this exact error signature already exists
            if (content.includes(sectionHeader)) {
                const sectionStart = content.indexOf(sectionHeader)
                const nextSection = content.indexOf("\n## ", sectionStart + 1)
                const sectionEnd = nextSection !== -1 ? nextSection : content.length
                const toolSection = content.slice(sectionStart, sectionEnd)
                
                // Check for duplicate signature
                if (toolSection.includes(errorSignature.substring(0, 40))) {
                    // Update existing entry count instead of adding new
                    const countMatch = toolSection.match(/\*\*Count:\*\* (\d+)/)
                    if (countMatch) {
                        const newCount = parseInt(countMatch[1]) + 1
                        content = content.replace(
                            /\*\*Count:\*\* \d+/,
                            `**Count:** ${newCount}`
                        )
                        content = content.replace(
                            /\*\*Last seen:\*\* [^\n]+/,
                            `**Last seen:** ${timestamp}`
                        )
                    }
                    fs.writeFileSync(filePath, content, "utf8")
                    getLog().info(`[AgentActivityLogger] Updated error count for ${tool}`)
                    return
                }
            }

            // New error - add section if needed
            if (!content.includes(sectionHeader)) {
                content += `
${sectionHeader}

**Solution:** (not yet solved)

### Occurrences
`
            }

            // Count existing occurrences for this tool
            const sectionStart = content.indexOf(sectionHeader)
            const nextSection = content.indexOf("\n## ", sectionStart + 1)
            const sectionEnd = nextSection !== -1 ? nextSection : content.length
            const toolSection = content.slice(sectionStart, sectionEnd)
            const occurrenceMatches = toolSection.match(/^- \*\*\d{4}-/gm) || []
            
            // If at limit, remove oldest occurrence
            if (occurrenceMatches.length >= AgentActivityLogger.MAX_OCCURRENCES_PER_TOOL) {
                // Find and remove the last (oldest) occurrence entry
                const lastOccurrence = toolSection.lastIndexOf("\n- **")
                if (lastOccurrence !== -1) {
                    const entryEnd = toolSection.indexOf("\n", lastOccurrence + 1)
                    const oldEntry = toolSection.slice(lastOccurrence, entryEnd !== -1 ? entryEnd : undefined)
                    content = content.replace(oldEntry, "")
                }
            }

            // Insert new entry at top of occurrences
            const occurrencesHeader = content.indexOf("### Occurrences", sectionStart)
            if (occurrencesHeader !== -1) {
                const insertPoint = content.indexOf("\n", occurrencesHeader) + 1
                const entry = `- **${timestamp}** | **Count:** 1 | **Last seen:** ${timestamp}\n  Pattern: \`${errorSignature}\`\n  Error: ${errorPreview}\n`
                content = content.slice(0, insertPoint) + entry + content.slice(insertPoint)
            }

            fs.writeFileSync(filePath, content, "utf8")
            getLog().info(`[AgentActivityLogger] Recorded new error for ${tool}`)
        } catch (e) {
            getLog().warn("[AgentActivityLogger] Failed to record error:", e)
        }
    }

    /**
     * Get errors for a specific tool from ERRORS.md.
     * Returns the section content or null if no errors for this tool.
     */
    getToolErrors(
        projectFolder: string,
        agentHomeFolder: string,
        tool: string,
    ): string | null {
        try {
            const filePath = this.errorsPath(projectFolder, agentHomeFolder)
            if (!fs.existsSync(filePath)) return null

            const content = fs.readFileSync(filePath, "utf8")
            const sectionHeader = `## ${tool}`
            const sectionStart = content.indexOf(sectionHeader)
            if (sectionStart === -1) return null

            // Find the end of this section (next ## or end of file)
            const nextSection = content.indexOf("\n## ", sectionStart + 1)
            const sectionEnd = nextSection !== -1 ? nextSection : content.length

            return content.slice(sectionStart, sectionEnd).trim()
        } catch (e) {
            getLog().warn("[AgentActivityLogger] Failed to read errors:", e)
            return null
        }
    }

    /**
     * Check if a tool has unsolved errors (Solution contains "not yet solved")
     */
    hasUnsolvedErrors(
        projectFolder: string,
        agentHomeFolder: string,
        tool: string,
    ): boolean {
        const section = this.getToolErrors(projectFolder, agentHomeFolder, tool)
        if (!section) return false
        return section.includes("(not yet solved)")
    }

    /**
     * Promote a solved error to a Skill.
     * Creates a SKILL.md file in the skills folder based on the error solution.
     * Returns the path to the created skill or null on failure.
     */
    promoteErrorToSkill(
        projectFolder: string,
        agentHomeFolder: string,
        tool: string,
        skillName: string,
        description: string,
        triggers: string[],
    ): string | null {
        try {
            const section = this.getToolErrors(projectFolder, agentHomeFolder, tool)
            if (!section) {
                getLog().warn(`[AgentActivityLogger] No errors found for tool ${tool}`)
                return null
            }

            // Extract solution from section
            const solutionMatch = section.match(/\*\*Solution:\*\*\s*([^\n]+(?:\n(?!\*\*|###)[^\n]*)*)/i)
            if (!solutionMatch || solutionMatch[1].includes("not yet solved")) {
                getLog().warn(`[AgentActivityLogger] No solution found for tool ${tool}`)
                return null
            }
            const solution = solutionMatch[1].trim()

            // Extract a sample error pattern for context
            const patternMatch = section.match(/Pattern:\s*`([^`]+)`/)
            const pattern = patternMatch ? patternMatch[1] : "Unknown error pattern"

            // Determine skills folder path
            let skillsPath: string
            if (!agentHomeFolder || agentHomeFolder === "/") {
                skillsPath = path.join(this.projectsRoot, projectFolder, "skills", skillName)
            } else {
                skillsPath = path.join(this.projectsRoot, projectFolder, agentHomeFolder, "skills", skillName)
            }

            // Create skill directory
            if (!fs.existsSync(skillsPath)) {
                fs.mkdirSync(skillsPath, { recursive: true })
            }

            // Generate SKILL.md content
            const triggersYaml = triggers.map(t => `  - ${t}`).join("\n")
            const skillContent = `---
name: ${skillName}
description: ${description}
version: 1.0
triggers:
${triggersYaml}
origin: Promoted from ERRORS.md (${tool})
---

# ${skillName}

${description}

## Background

This skill was automatically promoted from a recurring error pattern:
- **Tool:** ${tool}
- **Error Pattern:** \`${pattern}\`

## Solution

${solution}

## Instructions

When you encounter this error pattern:

1. Recognize the error matches: \`${pattern.substring(0, 50)}...\`
2. Apply the solution above
3. Verify the fix worked

## Notes

- Originally discovered through tool failures
- Promoted to skill on ${new Date().toISOString().split("T")[0]}
`

            const skillFilePath = path.join(skillsPath, "SKILL.md")
            fs.writeFileSync(skillFilePath, skillContent, "utf8")

            // Mark the error as promoted in ERRORS.md
            const errorsFilePath = this.errorsPath(projectFolder, agentHomeFolder)
            let errorsContent = fs.readFileSync(errorsFilePath, "utf8")
            const sectionHeader = `## ${tool}`
            errorsContent = errorsContent.replace(
                sectionHeader,
                `${sectionHeader}\n\n> ✅ **Promoted to Skill:** \`skills/${skillName}/\` on ${new Date().toISOString().split("T")[0]}`
            )
            fs.writeFileSync(errorsFilePath, errorsContent, "utf8")

            getLog().info(`[AgentActivityLogger] Promoted ${tool} error to skill: ${skillName}`)
            return skillFilePath
        } catch (e) {
            getLog().warn("[AgentActivityLogger] Failed to promote error to skill:", e)
            return null
        }
    }

    /**
     * Get all tools with solved errors that could be promoted to skills.
     */
    getSolvedErrors(
        projectFolder: string,
        agentHomeFolder: string,
    ): Array<{ tool: string; solution: string }> {
        try {
            const filePath = this.errorsPath(projectFolder, agentHomeFolder)
            if (!fs.existsSync(filePath)) return []

            const content = fs.readFileSync(filePath, "utf8")
            const results: Array<{ tool: string; solution: string }> = []

            // Find all tool sections
            const sectionRegex = /## (\w+)\n+(?:>.*\n+)?\*\*Solution:\*\*\s*([^\n]+(?:\n(?!\*\*|###|## )[^\n]*)*)/g
            let match
            while ((match = sectionRegex.exec(content)) !== null) {
                const tool = match[1]
                const solution = match[2].trim()
                if (!solution.includes("not yet solved") && !content.includes(`Promoted to Skill.*${tool}`)) {
                    results.push({ tool, solution })
                }
            }

            return results
        } catch (e) {
            getLog().warn("[AgentActivityLogger] Failed to get solved errors:", e)
            return []
        }
    }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
    return args
}
