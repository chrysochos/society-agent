// Society Agent - new file
/**
 * ExecutionLogger - Structured logging for purpose executions
 *
 * Logs all agent activities, decisions, and outcomes to JSONL files
 * in the .society-agent directory.
 */

import * as fs from "fs"
import * as path from "path"
import { getLog } from "./logger"

// Society Agent start
export interface LogEntry {
	timestamp: number
	purposeId: string
	agentId?: string
	level: "info" | "warn" | "error" | "debug"
	event: string
	data?: Record<string, unknown>
}

export interface ExecutionLoggerConfig {
	workspaceRoot: string
	enableConsole?: boolean
}
// Society Agent end

/**
 * Logs execution events to structured JSONL files
 */
export class ExecutionLogger {
	// Society Agent start
	private logDir: string
	private enableConsole: boolean
	private logStream?: fs.WriteStream
	// Society Agent end

	constructor(config: ExecutionLoggerConfig) {
		// Society Agent start
		this.logDir = path.join(config.workspaceRoot, ".society-agent", "logs")
		this.enableConsole = config.enableConsole !== false

		// Ensure log directory exists
		this.ensureLogDirectory()
		// Society Agent end
	}

	/**
	 * Ensure log directory exists
	 */
	private ensureLogDirectory(): void {
		// Society Agent start
		if (!fs.existsSync(this.logDir)) {
			fs.mkdirSync(this.logDir, { recursive: true })
		}
		// Society Agent end
	}

	/**
	 * Log info event
	 */
	info(purposeId: string, event: string, data?: Record<string, unknown>, agentId?: string): void {
		// Society Agent start
		this.log("info", purposeId, event, data, agentId)
		// Society Agent end
	}

	/**
	 * Log warning event
	 */
	warn(purposeId: string, event: string, data?: Record<string, unknown>, agentId?: string): void {
		// Society Agent start
		this.log("warn", purposeId, event, data, agentId)
		// Society Agent end
	}

	/**
	 * Log error event
	 */
	error(purposeId: string, event: string, data?: Record<string, unknown>, agentId?: string): void {
		// Society Agent start
		this.log("error", purposeId, event, data, agentId)
		// Society Agent end
	}

	/**
	 * Log debug event
	 */
	debug(purposeId: string, event: string, data?: Record<string, unknown>, agentId?: string): void {
		// Society Agent start
		this.log("debug", purposeId, event, data, agentId)
		// Society Agent end
	}

	// Society Agent start - Agent message logging
	/**
	 * Log agent-to-agent message
	 */
	logAgentMessage(purposeId: string, fromAgent: string, toAgent: string | undefined, message: string): void {
		this.log("info", purposeId, "agent_message", {
			fromAgent,
			toAgent,
			message,
		})
	}

	/**
	 * Log agent status change
	 */
	logAgentStatus(purposeId: string, agentId: string, status: string, task?: string): void {
		this.log("info", purposeId, "agent_status", {
			agentId,
			status,
			task,
		})
	}

	/**
	 * Log agent result
	 */
	logAgentResult(purposeId: string, agentId: string, result: string, success: boolean): void {
		this.log(success ? "info" : "error", purposeId, "agent_result", {
			agentId,
			result,
			success,
		})
	}
	// Society Agent end

	/**
	 * Write log entry
	 */
	private log(
		level: LogEntry["level"],
		purposeId: string,
		event: string,
		data?: Record<string, unknown>,
		agentId?: string,
	): void {
		// Society Agent start
		const entry: LogEntry = {
			timestamp: Date.now(),
			purposeId,
			agentId,
			level,
			event,
			data,
		}

		// Write to JSONL file
		this.writeToFile(entry)

		// Optionally log to console
		if (this.enableConsole) {
			this.logToConsole(entry)
		}
		// Society Agent end
	}

	/**
	 * Write log entry to JSONL file
	 */
	private writeToFile(entry: LogEntry): void {
		// Society Agent start
		try {
			// Create per-purpose log file
			const logFile = path.join(this.logDir, `${entry.purposeId}.jsonl`)

			// Append to file
			const line = JSON.stringify(entry) + "\n"
			fs.appendFileSync(logFile, line, "utf8")
		} catch (error) {
			getLog().error("Failed to write log:", error)
		}
		// Society Agent end
	}

	/**
	 * Log to console
	 */
	private logToConsole(entry: LogEntry): void {
		// Society Agent start
		const timestamp = new Date(entry.timestamp).toISOString()
		const agentPrefix = entry.agentId ? `[${entry.agentId}]` : ""
		const message = `[${timestamp}] ${agentPrefix} ${entry.event}`

		switch (entry.level) {
			case "error":
				getLog().error(message, entry.data || "")
				break
			case "warn":
				getLog().warn(message, entry.data || "")
				break
			case "debug":
				getLog().debug(message, entry.data || "")
				break
			default:
				getLog().info(message, entry.data || "")
		}
		// Society Agent end
	}

	/**
	 * Read logs for a purpose
	 */
	readLogs(purposeId: string): LogEntry[] {
		// Society Agent start
		const logFile = path.join(this.logDir, `${purposeId}.jsonl`)

		if (!fs.existsSync(logFile)) {
			return []
		}

		try {
			const content = fs.readFileSync(logFile, "utf8")
			const lines = content.trim().split("\n")
			return lines.map((line) => JSON.parse(line))
		} catch (error) {
			getLog().error("Failed to read logs:", error)
			return []
		}
		// Society Agent end
	}

	/**
	 * Query logs with filters
	 */
	queryLogs(
		purposeId: string,
		filters?: {
			agentId?: string
			level?: LogEntry["level"]
			event?: string
			since?: number
		},
	): LogEntry[] {
		// Society Agent start
		let logs = this.readLogs(purposeId)

		if (filters) {
			if (filters.agentId) {
				logs = logs.filter((log) => log.agentId === filters.agentId)
			}
			if (filters.level) {
				logs = logs.filter((log) => log.level === filters.level)
			}
			if (filters.event) {
				logs = logs.filter((log) => log.event.includes(filters.event!))
			}
			if (filters.since) {
				logs = logs.filter((log) => log.timestamp >= filters.since!)
			}
		}

		return logs
		// Society Agent end
	}

	/**
	 * Get all log files
	 */
	listLogFiles(): string[] {
		// Society Agent start
		try {
			return fs.readdirSync(this.logDir).filter((file) => file.endsWith(".jsonl"))
		} catch (error) {
			return []
		}
		// Society Agent end
	}

	/**
	 * Delete logs for a purpose
	 */
	deleteLogs(purposeId: string): void {
		// Society Agent start
		const logFile = path.join(this.logDir, `${purposeId}.jsonl`)
		if (fs.existsSync(logFile)) {
			fs.unlinkSync(logFile)
		}
		// Society Agent end
	}

	/**
	 * Clear all logs
	 */
	clearAllLogs(): void {
		// Society Agent start
		const files = this.listLogFiles()
		for (const file of files) {
			fs.unlinkSync(path.join(this.logDir, file))
		}
		// Society Agent end
	}

	/**
	 * Dispose resources
	 */
	dispose(): void {
		// Society Agent start
		if (this.logStream) {
			this.logStream.end()
			this.logStream = undefined
		}
		// Society Agent end
	}
}
