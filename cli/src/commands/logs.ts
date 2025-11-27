// kilocode_change - new file
/**
 * /logs command - View Society Agent (SA) action logs
 */

import * as fs from "fs/promises"
import * as path from "path"
import type { Command, CommandContext } from "./core/types.js"
import type { AgentAction } from "../../../src/services/society-agent/types.js"
import { formatAgentAction } from "../../../src/services/society-agent/logger.js"

/**
 * Format a timestamp as a relative time string
 */
function formatRelativeTime(ts: number): string {
	const now = Date.now()
	const diff = now - ts
	const seconds = Math.floor(diff / 1000)
	const minutes = Math.floor(seconds / 60)
	const hours = Math.floor(minutes / 60)
	const days = Math.floor(hours / 24)

	if (days > 0) return `${days}d ago`
	if (hours > 0) return `${hours}h ago`
	if (minutes > 0) return `${minutes}m ago`
	return "just now"
}

/**
 * Format an absolute timestamp as human-readable
 */
function formatAbsoluteTime(ts: number): string {
	const date = new Date(ts)
	return date.toLocaleString()
}

/**
 * Read agent logs from a JSONL file
 */
async function readAgentLogs(logPath: string, limit?: number): Promise<AgentAction[]> {
	try {
		const content = await fs.readFile(logPath, "utf-8")
		const lines = content.trim().split("\n")
		const actions: AgentAction[] = []

		for (const line of lines) {
			if (!line.trim()) continue
			try {
				const action = JSON.parse(line) as AgentAction
				actions.push(action)
			} catch (error) {
				console.error(`Failed to parse log line: ${line}`)
			}
		}

		// Return most recent logs first
		const sorted = actions.reverse()
		return limit ? sorted.slice(0, limit) : sorted
	} catch (error) {
		if ((error as any).code === "ENOENT") {
			return []
		}
		throw error
	}
}

/**
 * Find all agent log files
 */
async function findAgentLogFiles(logsDir: string): Promise<string[]> {
	try {
		const files = await fs.readdir(logsDir)
		return files.filter((file: string) => file.endsWith(".jsonl")).map((file: string) => path.join(logsDir, file))
	} catch (error) {
		if ((error as any).code === "ENOENT") {
			return []
		}
		throw error
	}
}

/**
 * Get agent ID from log file path
 */
function getAgentIdFromPath(logPath: string): string {
	const filename = path.basename(logPath, ".jsonl")
	return filename
}

/**
 * Display logs for a specific agent
 */
async function displayAgentLogs(
	context: CommandContext,
	logPath: string,
	agentId: string,
	limit?: number,
): Promise<void> {
	const logs = await readAgentLogs(logPath, limit)

	if (logs.length === 0) {
		context.addMessage({
			id: Date.now().toString(),
			type: "system",
			content: `No logs found for agent: ${agentId}`,
			ts: Date.now(),
		})
		return
	}

	let output = `\n=== Agent Logs: ${agentId} ===\n`
	output += `Log file: ${logPath}\n`
	output += `Total actions: ${logs.length}\n\n`

	for (const log of logs) {
		const timestamp = typeof log.timestamp === "number" ? log.timestamp : new Date(log.timestamp).getTime()
		const timeStr = formatRelativeTime(timestamp)
		const formatted = formatAgentAction(log)

		output += `[${timeStr}] ${formatted}\n`
	}

	context.addMessage({
		id: Date.now().toString(),
		type: "system",
		content: output,
		ts: Date.now(),
	})
}

/**
 * /logs command
 */
export const logsCommand: Command = {
	name: "logs",
	description: "View Society Agent (SA) action logs",
	aliases: ["log"],
	usage: "/logs [agentId]",
	examples: ["/logs", "/logs agent-123"],
	category: "system",
	priority: 7,
	handler: async (context) => {
		const { args, addMessage } = context

		// Determine logs directory (use process.cwd() from Node.js globals)
		const logsDir = path.join((globalThis as any).process.cwd(), ".society-agent", "logs")

		// Check if logs directory exists
		try {
			await fs.access(logsDir)
		} catch {
			addMessage({
				id: Date.now().toString(),
				type: "system",
				content:
					`No Society Agent (SA) logs found. Logs directory does not exist: ${logsDir}\n\n` +
					`Make sure to run the CLI with agent options (--agent-id, --agent-name, etc.) to enable logging.`,
				ts: Date.now(),
			})
			return
		}

		// Get agent ID from first arg
		const agentIdArg = args[0]

		if (agentIdArg) {
			// Show logs for specific agent
			const logPath = path.join(logsDir, `${agentIdArg}.jsonl`)
			try {
				await fs.access(logPath)
				await displayAgentLogs(context, logPath, agentIdArg, 10)
			} catch {
				let output = `No logs found for agent: ${agentIdArg}\n`
				output += `Expected log file: ${logPath}\n\n`

				// Show available agents
				const logFiles = await findAgentLogFiles(logsDir)
				if (logFiles.length > 0) {
					output += "Available agents:\n"
					for (const file of logFiles) {
						const id = getAgentIdFromPath(file)
						output += `  - ${id}\n`
					}
				}

				addMessage({
					id: Date.now().toString(),
					type: "system",
					content: output,
					ts: Date.now(),
				})
			}
		} else {
			// Show logs for all agents
			const logFiles = await findAgentLogFiles(logsDir)

			if (logFiles.length === 0) {
				addMessage({
					id: Date.now().toString(),
					type: "system",
					content:
						`No Society Agent (SA) logs found.\n\n` +
						`Make sure to run the CLI with agent options (--agent-id, --agent-name, etc.) to enable logging.`,
					ts: Date.now(),
				})
				return
			}

			let output = `Found ${logFiles.length} agent log file(s)\n\n`

			for (const logPath of logFiles) {
				const agentId = getAgentIdFromPath(logPath)
				const logs = await readAgentLogs(logPath, 10)

				if (logs.length > 0) {
					output += `=== Agent: ${agentId} ===\n`
					for (const log of logs) {
						const timestamp =
							typeof log.timestamp === "number" ? log.timestamp : new Date(log.timestamp).getTime()
						const timeStr = formatRelativeTime(timestamp)
						const formatted = formatAgentAction(log)
						output += `[${timeStr}] ${formatted}\n`
					}
					output += "\n"
				}
			}

			output += "Showing 10 most recent entries per agent."

			addMessage({
				id: Date.now().toString(),
				type: "system",
				content: output,
				ts: Date.now(),
			})
		}
	},
}
