// kilocode_change - new file
/**
 * ExecutionLogger - Structured logging for purpose executions
 *
 * Logs all agent activities, decisions, and outcomes to JSONL files
 * in the .society-agent directory.
 */

import * as fs from "fs"
import * as path from "path"
import { getLog } from "./logger"

// kilocode_change start
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
// kilocode_change end

/**
 * Logs execution events to structured JSONL files
 */
export class ExecutionLogger {
	// kilocode_change start
	private logDir: string
	private enableConsole: boolean
	private logStream?: fs.WriteStream
	// kilocode_change end

	constructor(config: ExecutionLoggerConfig) {
		// kilocode_change start
		this.logDir = path.join(config.workspaceRoot, ".society-agent", "logs")
		this.enableConsole = config.enableConsole !== false

		// Ensure log directory exists
		this.ensureLogDirectory()
		// kilocode_change end
	}

	/**
	 * Ensure log directory exists
	 */
	private ensureLogDirectory(): void {
		// kilocode_change start
		if (!fs.existsSync(this.logDir)) {
			fs.mkdirSync(this.logDir, { recursive: true })
		}
		// kilocode_change end
	}

	/**
	 * Log info event
	 */
	info(purposeId: string, event: string, data?: Record<string, unknown>, agentId?: string): void {
		// kilocode_change start
		this.log("info", purposeId, event, data, agentId)
		// kilocode_change end
	}

	/**
	 * Log warning event
	 */
	warn(purposeId: string, event: string, data?: Record<string, unknown>, agentId?: string): void {
		// kilocode_change start
		this.log("warn", purposeId, event, data, agentId)
		// kilocode_change end
	}

	/**
	 * Log error event
	 */
	error(purposeId: string, event: string, data?: Record<string, unknown>, agentId?: string): void {
		// kilocode_change start
		this.log("error", purposeId, event, data, agentId)
		// kilocode_change end
	}

	/**
	 * Log debug event
	 */
	debug(purposeId: string, event: string, data?: Record<string, unknown>, agentId?: string): void {
		// kilocode_change start
		this.log("debug", purposeId, event, data, agentId)
		// kilocode_change end
	}

	// kilocode_change start - Agent message logging
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
	// kilocode_change end

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
		// kilocode_change start
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
		// kilocode_change end
	}

	/**
	 * Write log entry to JSONL file
	 */
	private writeToFile(entry: LogEntry): void {
		// kilocode_change start
		try {
			// Create per-purpose log file
			const logFile = path.join(this.logDir, `${entry.purposeId}.jsonl`)

			// Append to file
			const line = JSON.stringify(entry) + "\n"
			fs.appendFileSync(logFile, line, "utf8")
		} catch (error) {
			getLog().error("Failed to write log:", error)
		}
		// kilocode_change end
	}

	/**
	 * Log to console
	 */
	private logToConsole(entry: LogEntry): void {
		// kilocode_change start
		const timestamp = new Date(entry.timestamp).toISOString()
		const agentPrefix = entry.agentId ? `[${entry.agentId}]` : ""
		const message = `[${timestamp}] ${agentPrefix} ${entry.event}`

		switch (entry.level) {
			case "error":
				console.error(message, entry.data || "")
				break
			case "warn":
				console.warn(message, entry.data || "")
				break
			case "debug":
				console.debug(message, entry.data || "")
				break
			default:
				console.log(message, entry.data || "")
		}
		// kilocode_change end
	}

	/**
	 * Read logs for a purpose
	 */
	readLogs(purposeId: string): LogEntry[] {
		// kilocode_change start
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
		// kilocode_change end
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
		// kilocode_change start
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
		// kilocode_change end
	}

	/**
	 * Get all log files
	 */
	listLogFiles(): string[] {
		// kilocode_change start
		try {
			return fs.readdirSync(this.logDir).filter((file) => file.endsWith(".jsonl"))
		} catch (error) {
			return []
		}
		// kilocode_change end
	}

	/**
	 * Delete logs for a purpose
	 */
	deleteLogs(purposeId: string): void {
		// kilocode_change start
		const logFile = path.join(this.logDir, `${purposeId}.jsonl`)
		if (fs.existsSync(logFile)) {
			fs.unlinkSync(logFile)
		}
		// kilocode_change end
	}

	/**
	 * Clear all logs
	 */
	clearAllLogs(): void {
		// kilocode_change start
		const files = this.listLogFiles()
		for (const file of files) {
			fs.unlinkSync(path.join(this.logDir, file))
		}
		// kilocode_change end
	}

	/**
	 * Dispose resources
	 */
	dispose(): void {
		// kilocode_change start
		if (this.logStream) {
			this.logStream.end()
			this.logStream = undefined
		}
		// kilocode_change end
	}
}
