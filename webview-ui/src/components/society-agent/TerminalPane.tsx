// kilocode_change - new file
/**
 * TerminalPane - Embedded xterm.js terminal
 *
 * Displays agent output in a terminal window with real-time streaming
 * and interactive input capabilities.
 */

import React, { useEffect, useRef } from "react"
import { Terminal } from "xterm"
import { FitAddon } from "xterm-addon-fit"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import "xterm/css/xterm.css"
import "./TerminalPane.css"

// kilocode_change start
interface Agent {
	id: string
	name: string
	role: "supervisor" | "worker"
	status: string
}

interface TerminalPaneProps {
	agent: Agent
	onClose: () => void
}
// kilocode_change end

export const TerminalPane: React.FC<TerminalPaneProps> = ({ agent, onClose }) => {
	// kilocode_change start
	const terminalRef = useRef<HTMLDivElement>(null)
	const xtermRef = useRef<Terminal | null>(null)
	const fitAddonRef = useRef<FitAddon | null>(null)

	useEffect(() => {
		if (!terminalRef.current) return

		// Create terminal instance
		const terminal = new Terminal({
			cursorBlink: true,
			fontSize: 13,
			fontFamily: 'Consolas, "Courier New", monospace',
			theme: {
				background: "#1e1e1e",
				foreground: "#cccccc",
				cursor: "#ffffff",
				selectionBackground: "#264f78", // kilocode_change - fixed xterm theme property name
			},
		})

		const fitAddon = new FitAddon()
		terminal.loadAddon(fitAddon)

		terminal.open(terminalRef.current)
		fitAddon.fit()

		xtermRef.current = terminal
		fitAddonRef.current = fitAddon

		// Write welcome message
		terminal.writeln(`\x1b[1;36m╔════════════════════════════════════════════════════════╗\x1b[0m`)
		terminal.writeln(`\x1b[1;36m║  Agent Terminal: ${agent.name.padEnd(36)}\x1b[1;36m║\x1b[0m`)
		terminal.writeln(`\x1b[1;36m║  ID: ${agent.id.padEnd(44)}\x1b[1;36m║\x1b[0m`)
		terminal.writeln(`\x1b[1;36m║  Role: ${agent.role.padEnd(42)}\x1b[1;36m║\x1b[0m`)
		terminal.writeln(`\x1b[1;36m╚════════════════════════════════════════════════════════╝\x1b[0m`)
		terminal.writeln("")

		// Handle input
		let currentLine = ""
		terminal.onData((data: string) => {
			const code = data.charCodeAt(0)

			// Handle Enter key
			if (code === 13) {
				terminal.writeln("")
				if (currentLine.trim()) {
					handleCommand(currentLine.trim())
					currentLine = ""
				}
				terminal.write("\x1b[32m$ \x1b[0m")
			}
			// Handle Backspace
			else if (code === 127) {
				if (currentLine.length > 0) {
					currentLine = currentLine.slice(0, -1)
					terminal.write("\b \b")
				}
			}
			// Handle normal characters
			else {
				currentLine += data
				terminal.write(data)
			}
		})

		// Initial prompt
		terminal.write("\x1b[32m$ \x1b[0m")

		// Handle messages from extension
		const handleMessage = (event: MessageEvent) => {
			const message = event.data

			if (message.type === "terminal-output" && message.agentId === agent.id) {
				terminal.writeln(message.output)
			}
		}

		window.addEventListener("message", handleMessage)

		// Handle resize
		const handleResize = () => {
			fitAddon.fit()
		}
		window.addEventListener("resize", handleResize)

		const handleCommand = (command: string) => {
			// Send command to extension
			vscode.postMessage({
				type: "terminal-input",
				agentId: agent.id,
				input: command,
			})
		}

		return () => {
			window.removeEventListener("message", handleMessage)
			window.removeEventListener("resize", handleResize)
			terminal.dispose()
		}
	}, [agent.id, agent.name, agent.role])

	const handleClear = () => {
		if (xtermRef.current) {
			xtermRef.current.clear()
			xtermRef.current.write("\x1b[32m$ \x1b[0m")
		}
	}

	return (
		<div className="terminal-pane">
			<div className="terminal-header">
				<div className="terminal-title">
					📟 Terminal: {agent.name}
					<span className="terminal-status">({agent.status})</span>
				</div>
				<div className="terminal-actions">
					<VSCodeButton appearance="icon" onClick={handleClear} title="Clear terminal">
						🗑️
					</VSCodeButton>
					<VSCodeButton appearance="icon" onClick={onClose} title="Close terminal">
						✕
					</VSCodeButton>
				</div>
			</div>
			<div className="terminal-body" ref={terminalRef}></div>
		</div>
	)
	// kilocode_change end
}

// VSCode API global
declare const vscode: {
	postMessage: (message: any) => void
}
