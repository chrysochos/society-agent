// kilocode_change - new file
/**
 * Society Agent Logger
 *
 * Structured logging for agent actions with context.
 */

import * as fs from "fs/promises"
import * as path from "path"
import type { AgentAction, AgentIdentity, AgentMetadata } from "./types"

/**
 * Society Agent Logger
 */
export class SocietyAgentLogger {
	private agentMetadata: AgentMetadata
	private logPath: string

	constructor(metadata: AgentMetadata) {
		this.agentMetadata = metadata
		this.logPath = metadata.historyPath
	}

	/**
	 * Log an agent action
	 */
	async logAction(
		action: string,
		params?: Record<string, unknown>,
		result?: { success: boolean; data?: unknown; error?: string },
		requiredApproval = false,
		approvedBy?: string,
	): Promise<void> {
		const entry: AgentAction = {
			timestamp: new Date(),
			agentId: this.agentMetadata.identity.id,
			action,
			...(params !== undefined && { params }),
			...(result !== undefined && { result }),
			requiredApproval,
			...(approvedBy !== undefined && { approvedBy }),
		}

		await this.writeLogEntry(entry)
	}

	/**
	 * Log successful action
	 */
	async logSuccess(action: string, data?: unknown): Promise<void> {
		await this.logAction(action, undefined, { success: true, data })
	}

	/**
	 * Log failed action
	 */
	async logError(action: string, error: string | Error): Promise<void> {
		const errorMessage = error instanceof Error ? error.message : error
		await this.logAction(action, undefined, { success: false, error: errorMessage })
	}

	/**
	 * Log action with approval
	 */
	async logApprovedAction(
		action: string,
		approvedBy: string,
		params?: Record<string, unknown>,
		result?: { success: boolean; data?: unknown; error?: string },
	): Promise<void> {
		await this.logAction(action, params, result, true, approvedBy)
	}

	/**
	 * Write log entry to file (JSONL format)
	 */
	private async writeLogEntry(entry: AgentAction): Promise<void> {
		try {
			// Ensure log directory exists
			const logDir = path.dirname(this.logPath)
			await fs.mkdir(logDir, { recursive: true })

			// Append as JSONL (one JSON object per line)
			const line = JSON.stringify(entry) + "\n"
			await fs.appendFile(this.logPath, line, "utf-8")
		} catch (error) {
			// Don't throw - logging failures shouldn't break agent execution
			console.error("[Society Agent (SA) Logger] Failed to write log:", error)
		}
	}

	/**
	 * Read agent action history
	 */
	async readHistory(limit?: number): Promise<AgentAction[]> {
		try {
			const content = await fs.readFile(this.logPath, "utf-8")
			const lines = content.trim().split("\n").filter(Boolean)

			const actions = lines.map((line) => JSON.parse(line) as AgentAction)

			if (limit) {
				return actions.slice(-limit)
			}

			return actions
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				// File doesn't exist yet - return empty array
				return []
			}
			console.error("[Society Agent Logger] Failed to read history:", error)
			return []
		}
	}

	/**
	 * Get agent metadata
	 */
	getMetadata(): AgentMetadata {
		return this.agentMetadata
	}

	/**
	 * Get agent identity
	 */
	getIdentity(): AgentIdentity {
		return this.agentMetadata.identity
	}
}

/**
 * Create a logger for an agent
 */
export function createAgentLogger(metadata: AgentMetadata): SocietyAgentLogger {
	return new SocietyAgentLogger(metadata)
}

/**
 * Format agent action for display
 */
export function formatAgentAction(action: AgentAction): string {
	const timestamp = action.timestamp.toISOString()
	const status = action.result?.success ? "✓" : "✗"
	const approval = action.requiredApproval ? ` [Approved by: ${action.approvedBy}]` : ""

	return `[${timestamp}] ${status} ${action.agentId}: ${action.action}${approval}`
}

// kilocode_change start - OutputChannel-based logging for replacing console.log
/**
 * Simple log interface for society-agent services.
 * Replaces direct console.log/warn/error calls.
 */
export interface SocietyLog {
	info(message: string, ...args: unknown[]): void
	warn(message: string, ...args: unknown[]): void
	error(message: string, ...args: unknown[]): void
	debug(message: string, ...args: unknown[]): void
}

const noopLog: SocietyLog = {
	info() {},
	warn() {},
	error() {},
	debug() {},
}

let _globalLog: SocietyLog = noopLog

/** Set the global society-agent log (call once from extension.ts). */
export function setSocietyLog(log: SocietyLog): void {
	_globalLog = log
}

/** Get the global society-agent log. */
export function getLog(): SocietyLog {
	return _globalLog
}

/**
 * Create a SocietyLog backed by a VS Code OutputChannel.
 * @param channel - anything with appendLine (OutputChannel compatible)
 * @param prefix - log line prefix
 */
export function createChannelLog(
	channel: { appendLine(value: string): void },
	prefix = "[SocietyAgent]",
): SocietyLog {
	const fmt = (level: string, message: string, args: unknown[]): string => {
		const extra = args.length > 0
			? " " + args.map(a => {
				if (a instanceof Error) return `${a.message}\n${a.stack || ""}`
				if (typeof a === "object" && a !== null) {
					try { return JSON.stringify(a) } catch { return String(a) }
				}
				return String(a)
			}).join(" ")
			: ""
		return `${prefix} [${level}] ${message}${extra}`
	}

	return {
		info(message, ...args) { channel.appendLine(fmt("INFO", message, args)) },
		warn(message, ...args) { channel.appendLine(fmt("WARN", message, args)) },
		error(message, ...args) { channel.appendLine(fmt("ERROR", message, args)) },
		debug(message, ...args) { channel.appendLine(fmt("DEBUG", message, args)) },
	}
}
// kilocode_change end
