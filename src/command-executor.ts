// Society Agent - new file
/**
 * CommandExecutor - Execute shell commands with output streaming
 *
 * Handles command execution in project workspaces with real-time output
 * via WebSocket, security checks, and command history.
 */

import { spawn, ChildProcess } from "child_process"
import * as path from "path"
import * as fs from "fs"

export interface CommandResult {
	id: string
	command: string
	cwd: string
	status: "running" | "success" | "error"
	exitCode?: number
	output: string[]
	startedAt: number
	finishedAt?: number
	error?: string
}

export interface ExecuteCommandOptions {
	cwd?: string // Working directory
	env?: Record<string, string> // Environment variables
	timeout?: number // Max execution time (ms)
	onOutput?: (data: string, type: "stdout" | "stderr") => void
	onExit?: (code: number) => void
}

export class CommandExecutor {
	private runningCommands: Map<string, ChildProcess> = new Map()
	private commandHistory: CommandResult[] = []
	private maxHistorySize = 100

	/**
	 * Normalize command for cross-platform compatibility
	 * e.g., "python" → "python3" on systems where python3 is the binary
	 */
	private normalizeCommand(command: string): string {
		// Replace "python " or "python -" with "python3 " or "python3 -"
		// This handles: python script.py, python -m http.server, python3 already works
		return command
			.replace(/^python(\s+)/g, "python3$1")           // Start of command
			.replace(/(\s+)python(\s+)/g, "$1python3$2")     // Middle of command (after &&, ||, ;, |)
			.replace(/(\s*&&\s*)python(\s+)/g, "$1python3$2") // After &&
			.replace(/(\s*\|\|\s*)python(\s+)/g, "$1python3$2") // After ||
			.replace(/(\s*;\s*)python(\s+)/g, "$1python3$2")   // After ;
			.replace(/(\s*\|\s*)python(\s+)/g, "$1python3$2")  // After |
	}

	/**
	 * Execute a shell command
	 */
	async executeCommand(command: string, options: ExecuteCommandOptions = {}): Promise<CommandResult> {
		const commandId = `cmd-${Date.now()}-${Math.random().toString(36).substring(7)}`
		const cwd = options.cwd || process.cwd()

		// Normalize command (e.g., python → python3)
		const normalizedCommand = this.normalizeCommand(command)

		// Security: Validate working directory exists
		if (!fs.existsSync(cwd)) {
			throw new Error(`Working directory does not exist: ${cwd}`)
		}

		// Security: Prevent certain dangerous commands
		const dangerousCommands = ["rm -rf /", "mkfs", "dd if=/dev/zero", ":(){ :|:& };:"]
		if (dangerousCommands.some((dangerous) => normalizedCommand.includes(dangerous))) {
			throw new Error("Dangerous command blocked for safety")
		}

		const result: CommandResult = {
			id: commandId,
			command: normalizedCommand,
			cwd,
			status: "running",
			output: [],
			startedAt: Date.now(),
		}

		return new Promise((resolve, reject) => {
			// Spawn process
			const child = spawn(normalizedCommand, [], {
				cwd,
				shell: true,
				env: { ...process.env, ...options.env },
			})

			this.runningCommands.set(commandId, child)

			// Handle stdout
			child.stdout?.on("data", (data: Buffer) => {
				const line = data.toString()
				result.output.push(line)
				options.onOutput?.(line, "stdout")
			})

			// Handle stderr
			child.stderr?.on("data", (data: Buffer) => {
				const line = data.toString()
				result.output.push(`[stderr] ${line}`)
				options.onOutput?.(line, "stderr")
			})

			// Handle exit
			child.on("exit", (code) => {
				result.status = code === 0 ? "success" : "error"
				result.exitCode = code || 0
				result.finishedAt = Date.now()

				this.runningCommands.delete(commandId)
				this.addToHistory(result)

				options.onExit?.(code || 0)

				if (code === 0) {
					resolve(result)
				} else {
					reject(new Error(`Command failed with exit code ${code}`))
				}
			})

			// Handle errors
			child.on("error", (error) => {
				result.status = "error"
				result.error = error.message
				result.finishedAt = Date.now()

				this.runningCommands.delete(commandId)
				this.addToHistory(result)

				reject(error)
			})

			// Handle timeout
			if (options.timeout) {
				setTimeout(() => {
					if (this.runningCommands.has(commandId)) {
						child.kill("SIGTERM")
						result.error = "Command timeout"
						reject(new Error("Command execution timeout"))
					}
				}, options.timeout)
			}
		})
	}

	/**
	 * Kill a running command
	 */
	killCommand(commandId: string): boolean {
		const child = this.runningCommands.get(commandId)
		if (child) {
			child.kill("SIGTERM")
			this.runningCommands.delete(commandId)
			return true
		}
		return false
	}

	/**
	 * Get command result by ID
	 */
	getCommandResult(commandId: string): CommandResult | undefined {
		return this.commandHistory.find((r) => r.id === commandId)
	}

	/**
	 * Get command history
	 */
	getHistory(limit?: number): CommandResult[] {
		const history = [...this.commandHistory].reverse()
		return limit ? history.slice(0, limit) : history
	}

	/**
	 * Get running commands
	 */
	getRunningCommands(): string[] {
		return Array.from(this.runningCommands.keys())
	}

	/**
	 * Add command result to history
	 */
	private addToHistory(result: CommandResult): void {
		this.commandHistory.push(result)

		// Limit history size
		if (this.commandHistory.length > this.maxHistorySize) {
			this.commandHistory.shift()
		}
	}

	/**
	 * Clear command history
	 */
	clearHistory(): void {
		this.commandHistory = []
	}
}

// Singleton instance
export const commandExecutor = new CommandExecutor()
