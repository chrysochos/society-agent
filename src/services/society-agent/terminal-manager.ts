// kilocode_change - new file
/**
 * TerminalManager - Manages terminal lifecycle for agents
 *
 * Creates, tracks, and manages terminals for agent output.
 * Supports both VS Code native terminals and web-based xterm.js terminals.
 */

import * as vscode from "vscode"

// kilocode_change start
export interface TerminalInfo {
	agentId: string
	terminalId: string
	name: string
	createdAt: number
	type: "vscode" | "xterm"
	instance?: vscode.Terminal
}

export interface TerminalManagerConfig {
	preferredType?: "vscode" | "xterm"
	autoCleanup?: boolean
}
// kilocode_change end

/**
 * Manages terminals for agent output and interaction
 */
export class TerminalManager {
	// kilocode_change start
	private terminals: Map<string, TerminalInfo>
	private config: TerminalManagerConfig
	// kilocode_change end

	constructor(config: TerminalManagerConfig = {}) {
		// kilocode_change start
		this.terminals = new Map()
		this.config = {
			preferredType: config.preferredType || "vscode",
			autoCleanup: config.autoCleanup !== false,
		}

		// Listen for terminal disposal
		if (this.config.preferredType === "vscode") {
			vscode.window.onDidCloseTerminal((terminal) => {
				this.handleTerminalClosed(terminal)
			})
		}
		// kilocode_change end
	}

	/**
	 * Create terminal for agent
	 */
	createTerminal(agentId: string, agentName: string): string {
		// kilocode_change start
		const terminalId = `term-${agentId}-${Date.now()}`

		if (this.config.preferredType === "vscode") {
			// Create VS Code terminal
			const terminal = vscode.window.createTerminal({
				name: `Agent: ${agentName}`,
				hideFromUser: false,
			})

			const terminalInfo: TerminalInfo = {
				agentId,
				terminalId,
				name: agentName,
				createdAt: Date.now(),
				type: "vscode",
				instance: terminal,
			}

			this.terminals.set(terminalId, terminalInfo)

			// Show welcome message
			terminal.sendText(`# Agent: ${agentName} (${agentId})`)
			terminal.sendText(`# Terminal created at: ${new Date().toISOString()}`)
			terminal.sendText(`# Type commands to interact with agent\n`)

			return terminalId
		} else {
			// Create xterm.js terminal (handled by webview)
			const terminalInfo: TerminalInfo = {
				agentId,
				terminalId,
				name: agentName,
				createdAt: Date.now(),
				type: "xterm",
			}

			this.terminals.set(terminalId, terminalInfo)

			return terminalId
		}
		// kilocode_change end
	}

	/**
	 * Get terminal info
	 */
	getTerminal(terminalId: string): TerminalInfo | undefined {
		// kilocode_change start
		return this.terminals.get(terminalId)
		// kilocode_change end
	}

	/**
	 * Find terminal by agent ID
	 */
	findTerminalByAgent(agentId: string): TerminalInfo | undefined {
		// kilocode_change start
		for (const terminal of this.terminals.values()) {
			if (terminal.agentId === agentId) {
				return terminal
			}
		}
		return undefined
		// kilocode_change end
	}

	/**
	 * Write output to terminal
	 */
	writeOutput(terminalId: string, output: string): void {
		// kilocode_change start
		const terminal = this.terminals.get(terminalId)
		if (!terminal) {
			throw new Error(`Terminal ${terminalId} not found`)
		}

		if (terminal.type === "vscode" && terminal.instance) {
			// Write to VS Code terminal
			terminal.instance.sendText(output)
		} else {
			// For xterm.js, emit event to webview
			// This would be handled by webview panel
			// For now, just store in metadata
		}
		// kilocode_change end
	}

	/**
	 * Show terminal (bring to front)
	 */
	showTerminal(terminalId: string): void {
		// kilocode_change start
		const terminal = this.terminals.get(terminalId)
		if (!terminal) {
			throw new Error(`Terminal ${terminalId} not found`)
		}

		if (terminal.type === "vscode" && terminal.instance) {
			terminal.instance.show()
		}
		// kilocode_change end
	}

	/**
	 * Hide terminal
	 */
	hideTerminal(terminalId: string): void {
		// kilocode_change start
		const terminal = this.terminals.get(terminalId)
		if (!terminal) {
			throw new Error(`Terminal ${terminalId} not found`)
		}

		if (terminal.type === "vscode" && terminal.instance) {
			terminal.instance.hide()
		}
		// kilocode_change end
	}

	/**
	 * Close and dispose terminal
	 */
	closeTerminal(terminalId: string): void {
		// kilocode_change start
		const terminal = this.terminals.get(terminalId)
		if (!terminal) {
			return
		}

		if (terminal.type === "vscode" && terminal.instance) {
			terminal.instance.dispose()
		}

		this.terminals.delete(terminalId)
		// kilocode_change end
	}

	/**
	 * Reattach to existing agent terminal
	 */
	reattachTerminal(agentId: string): string | undefined {
		// kilocode_change start
		const existing = this.findTerminalByAgent(agentId)
		if (existing) {
			this.showTerminal(existing.terminalId)
			return existing.terminalId
		}
		return undefined
		// kilocode_change end
	}

	/**
	 * List all active terminals
	 */
	listTerminals(): TerminalInfo[] {
		// kilocode_change start
		return Array.from(this.terminals.values())
		// kilocode_change end
	}

	/**
	 * Handle VS Code terminal closed event
	 */
	private handleTerminalClosed(terminal: vscode.Terminal): void {
		// kilocode_change start
		for (const [terminalId, terminalInfo] of this.terminals.entries()) {
			if (terminalInfo.instance === terminal) {
				if (this.config.autoCleanup) {
					this.terminals.delete(terminalId)
				} else {
					// Mark as closed but keep record
					terminalInfo.instance = undefined
				}
				break
			}
		}
		// kilocode_change end
	}

	/**
	 * Cleanup all terminals
	 */
	dispose(): void {
		// kilocode_change start
		for (const terminal of this.terminals.values()) {
			if (terminal.type === "vscode" && terminal.instance) {
				terminal.instance.dispose()
			}
		}
		this.terminals.clear()
		// kilocode_change end
	}
}
