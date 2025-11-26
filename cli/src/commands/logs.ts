// kilocode_change - new file
/**
 * /logs command - View Society Agent action logs
 */

import fs from "fs/promises"
import path from "path"
import { generateMessage } from "../ui/utils/messages.js"
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
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
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
		return files.filter((file) => file.endsWith(".jsonl")).map((file) => path.join(logsDir, file))
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
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
	follow: boolean = false,
): Promise<void> {
	const logs = await readAgentLogs(logPath, limit)

	if (logs.length === 0) {
		context.ui.output(generateMessage(`No logs found for agent: ${agentId}`, "info"))
		return
	}

	context.ui.output(generateMessage(`\n=== Agent Logs: ${agentId} ===`, "info"))
	context.ui.output(generateMessage(`Log file: ${logPath}`, "dim"))
	context.ui.output(generateMessage(`Total actions: ${logs.length}\n`, "dim"))

	for (const log of logs) {
		const timeStr = formatRelativeTime(log.timestamp)
		const absTimeStr = formatAbsoluteTime(log.timestamp)
		const formatted = formatAgentAction(log)

		// Color-code by action type
		let color: "success" | "error" | "warning" | "info" = "info"
		if (log.result === "error") {
			color = "error"
		} else if (log.result === "success") {
			color = "success"
		} else if (log.requiredApproval) {
			color = "warning"
		}

		context.ui.output(generateMessage(`[${timeStr}] ${formatted}`, color))
		if (context.args.includes("--verbose") || context.args.includes("-v")) {
			context.ui.output(generateMessage(`  Time: ${absTimeStr}`, "dim"))
			if (log.params) {
				context.ui.output(generateMessage(`  Params: ${JSON.stringify(log.params)}`, "dim"))
			}
			if (log.error) {
				context.ui.output(generateMessage(`  Error: ${log.error}`, "error"))
			}
		}
	}

	context.ui.output("")

	// TODO: Implement follow mode (tail -f style)
	if (follow) {
		context.ui.output(generateMessage("Follow mode not yet implemented", "warning"))
	}
}

/**
 * /logs command
 */
export const logsCommand: Command = {
	name: "logs",
	description: "View Society Agent action logs",
	aliases: ["log"],
	args: [
		{
			name: "agentId",
			description: "Specific agent ID to view logs for",
			required: false,
		},
	],
	options: [
		{
			name: "--limit",
			aliases: ["-n"],
			description: "Limit the number of log entries to display",
			requiresValue: true,
		},
		{
			name: "--follow",
			aliases: ["-f"],
			description: "Follow log output in real-time (not yet implemented)",
			requiresValue: false,
		},
		{
			name: "--verbose",
			aliases: ["-v"],
			description: "Show detailed information for each log entry",
			requiresValue: false,
		},
		{
			name: "--all",
			aliases: ["-a"],
			description: "Show logs for all agents",
			requiresValue: false,
		},
	],

	async execute(context: CommandContext): Promise<void> {
		const { args, ui } = context

		// Determine logs directory
		const logsDir = path.join(process.cwd(), ".society-agent", "logs")

		// Check if logs directory exists
		try {
			await fs.access(logsDir)
		} catch {
			ui.output(
				generateMessage(
					`No Society Agent logs found. Logs directory does not exist: ${logsDir}\n` +
						`Make sure to run the CLI with agent options (--agent-id, --agent-name, etc.) to enable logging.`,
					"warning",
				),
			)
			return
		}

		// Parse options
		const limitStr = context.getOption("--limit")
		const limit = limitStr ? parseInt(limitStr, 10) : undefined
		const follow = context.hasOption("--follow")
		const showAll = context.hasOption("--all")

		// Get agent ID from args or options
		const agentIdArg = args.find((arg) => !arg.startsWith("-"))

		if (agentIdArg && !showAll) {
			// Show logs for specific agent
			const logPath = path.join(logsDir, `${agentIdArg}.jsonl`)
			try {
				await fs.access(logPath)
				await displayAgentLogs(context, logPath, agentIdArg, limit, follow)
			} catch {
				ui.output(generateMessage(`No logs found for agent: ${agentIdArg}`, "error"))
				ui.output(generateMessage(`Expected log file: ${logPath}`, "dim"))

				// Show available agents
				const logFiles = await findAgentLogFiles(logsDir)
				if (logFiles.length > 0) {
					ui.output(generateMessage("\nAvailable agents:", "info"))
					for (const file of logFiles) {
						const id = getAgentIdFromPath(file)
						ui.output(generateMessage(`  - ${id}`, "dim"))
					}
				}
			}
		} else {
			// Show logs for all agents
			const logFiles = await findAgentLogFiles(logsDir)

			if (logFiles.length === 0) {
				ui.output(generateMessage("No Society Agent logs found.", "warning"))
				ui.output(
					generateMessage(
						`Make sure to run the CLI with agent options (--agent-id, --agent-name, etc.) to enable logging.`,
						"dim",
					),
				)
				return
			}

			ui.output(generateMessage(`Found ${logFiles.length} agent log file(s)\n`, "info"))

			for (const logPath of logFiles) {
				const agentId = getAgentIdFromPath(logPath)
				await displayAgentLogs(context, logPath, agentId, limit || 10, false)
			}

			if (!limit) {
				ui.output(
					generateMessage(
						`Showing 10 most recent entries per agent. Use --limit to see more.`,
						"dim",
					),
				)
			}
		}
	},
}
