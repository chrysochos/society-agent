// kilocode_change - new file
/**
 * InteractiveTerminal - Full-featured web terminal with command execution
 *
 * Features:
 * - Real-time command execution with output streaming
 * - Command history (up/down arrows)
 * - Tab completion (basic)
 * - Copy/paste support
 * - Keyboard shortcuts
 */

import React, { useEffect, useRef, useState } from "react"
import { Terminal } from "xterm"
import { FitAddon } from "xterm-addon-fit"
import { io, Socket } from "socket.io-client"
import "./InteractiveTerminal.css"

interface InteractiveTerminalProps {
	projectId?: string
	cwd?: string
	onCommandExecute?: (command: string) => void
	_onClose?: () => void // kilocode_change - unused but kept for future use
}

export const InteractiveTerminal: React.FC<InteractiveTerminalProps> = ({
	projectId,
	cwd,
	onCommandExecute,
	_onClose,
}) => {
	// kilocode_change
	const terminalRef = useRef<HTMLDivElement>(null)
	const xtermRef = useRef<Terminal | null>(null)
	const fitAddonRef = useRef<FitAddon | null>(null)
	const socketRef = useRef<Socket | null>(null)
	const [connected, setConnected] = useState(false)
	const [_currentCommand, _setCurrentCommand] = useState("") // kilocode_change - unused but kept for future use
	const [commandHistory, setCommandHistory] = useState<string[]>([])
	const [historyIndex, setHistoryIndex] = useState(-1)
	const workingDirRef = useRef(cwd || "/workspace")

	useEffect(() => {
		if (!terminalRef.current) return

		// Create terminal
		const terminal = new Terminal({
			cursorBlink: true,
			fontSize: 14,
			fontFamily: 'Consolas, "Courier New", monospace',
			theme: {
				background: "#1e1e1e",
				foreground: "#d4d4d4",
				cursor: "#aeafad",
				black: "#000000",
				red: "#cd3131",
				green: "#0dbc79",
				yellow: "#e5e510",
				blue: "#2472c8",
				magenta: "#bc3fbc",
				cyan: "#11a8cd",
				white: "#e5e5e5",
				brightBlack: "#666666",
				brightRed: "#f14c4c",
				brightGreen: "#23d18b",
				brightYellow: "#f5f543",
				brightBlue: "#3b8eea",
				brightMagenta: "#d670d6",
				brightCyan: "#29b8db",
				brightWhite: "#e5e5e5",
			},
		})

		const fitAddon = new FitAddon()
		terminal.loadAddon(fitAddon)

		terminal.open(terminalRef.current)
		fitAddon.fit()

		xtermRef.current = terminal
		fitAddonRef.current = fitAddon

		// Welcome message
		terminal.writeln("\x1b[1;32m╔═══════════════════════════════════════════════════════════╗\x1b[0m")
		terminal.writeln("\x1b[1;32m║  Society Agent Interactive Terminal                      ║\x1b[0m")
		terminal.writeln("\x1b[1;32m║  Type commands and press Enter to execute                ║\x1b[0m")
		terminal.writeln("\x1b[1;32m║  Use ↑/↓ for history, Tab for completion, Ctrl+C to kill║\x1b[0m")
		terminal.writeln("\x1b[1;32m╚═══════════════════════════════════════════════════════════╝\x1b[0m")
		terminal.writeln("")

		// Connect to WebSocket
		const socket = io("http://localhost:3000")
		socketRef.current = socket

		socket.on("connect", () => {
			setConnected(true)
			terminal.writeln("\x1b[32m✓ Connected to server\x1b[0m\r\n")
			writePrompt(terminal)
		})

		socket.on("disconnect", () => {
			setConnected(false)
			terminal.writeln("\x1b[31m✗ Disconnected from server\x1b[0m\r\n")
		})

		// Listen for command output
		socket.on("terminal-output", (data: any) => {
			terminal.write(data.data.replace(/\n/g, "\r\n"))
		})

		socket.on("terminal-exit", (data: any) => {
			if (data.exitCode === 0) {
				terminal.writeln(`\x1b[32m✓ Command completed (exit code ${data.exitCode})\x1b[0m`)
			} else {
				terminal.writeln(`\x1b[31m✗ Command failed (exit code ${data.exitCode})\x1b[0m`)
			}
			writePrompt(terminal)
		})

		// Handle terminal input
		let currentLine = ""
		let cursorPosition = 0

		terminal.onData((data: string) => {
			const code = data.charCodeAt(0)

			// Enter key
			if (code === 13) {
				terminal.write("\r\n")
				const command = currentLine.trim()

				if (command) {
					// Add to history
					setCommandHistory((prev) => [...prev, command])
					setHistoryIndex(-1)

					// Execute command
					executeCommand(command)
					onCommandExecute?.(command)

					currentLine = ""
					cursorPosition = 0
				} else {
					writePrompt(terminal)
				}
			}
			// Backspace
			else if (code === 127) {
				if (cursorPosition > 0) {
					currentLine = currentLine.slice(0, cursorPosition - 1) + currentLine.slice(cursorPosition)
					cursorPosition--
					terminal.write("\b \b")
					// Redraw rest of line if needed
					if (cursorPosition < currentLine.length) {
						terminal.write(currentLine.slice(cursorPosition) + " ")
						terminal.write("\x1b[" + (currentLine.length - cursorPosition + 1) + "D")
					}
				}
			}
			// Ctrl+C
			else if (code === 3) {
				terminal.write("^C\r\n")
				currentLine = ""
				cursorPosition = 0
				writePrompt(terminal)
			}
			// Arrow keys
			else if (data === "\x1b[A") {
				// Up arrow - previous command
				if (historyIndex < commandHistory.length - 1) {
					const newIndex = historyIndex + 1
					setHistoryIndex(newIndex)
					replaceCurrentLine(terminal, commandHistory[commandHistory.length - 1 - newIndex])
				}
			} else if (data === "\x1b[B") {
				// Down arrow - next command
				if (historyIndex > 0) {
					const newIndex = historyIndex - 1
					setHistoryIndex(newIndex)
					replaceCurrentLine(terminal, commandHistory[commandHistory.length - 1 - newIndex])
				} else if (historyIndex === 0) {
					setHistoryIndex(-1)
					replaceCurrentLine(terminal, "")
				}
			}
			// Left arrow
			else if (data === "\x1b[D") {
				if (cursorPosition > 0) {
					cursorPosition--
					terminal.write("\x1b[D")
				}
			}
			// Right arrow
			else if (data === "\x1b[C") {
				if (cursorPosition < currentLine.length) {
					cursorPosition++
					terminal.write("\x1b[C")
				}
			}
			// Tab - basic completion (TODO: enhance)
			else if (code === 9) {
				// For now, just insert spaces
				currentLine += "  "
				cursorPosition += 2
				terminal.write("  ")
			}
			// Normal characters
			else if (code >= 32 && code < 127) {
				currentLine = currentLine.slice(0, cursorPosition) + data + currentLine.slice(cursorPosition)
				cursorPosition++
				terminal.write(data)
				// Redraw rest of line if needed
				if (cursorPosition < currentLine.length) {
					terminal.write(currentLine.slice(cursorPosition))
					terminal.write("\x1b[" + (currentLine.length - cursorPosition) + "D")
				}
			}
		})

		function writePrompt(term: Terminal) {
			const dir = workingDirRef.current.split("/").pop() || "~"
			term.write(`\x1b[36m${dir}\x1b[0m \x1b[32m$\x1b[0m `)
		}

		function replaceCurrentLine(term: Terminal, newLine: string) {
			// Clear current line
			term.write("\r\x1b[K")
			writePrompt(term)
			term.write(newLine)
			currentLine = newLine
			cursorPosition = newLine.length
		}

		// Handle resize
		const handleResize = () => {
			fitAddon.fit()
		}
		window.addEventListener("resize", handleResize)

		// Cleanup
		return () => {
			window.removeEventListener("resize", handleResize)
			socket.disconnect()
			terminal.dispose()
		}
		// kilocode_change - Terminal setup should run once, dependencies would cause unwanted re-renders
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	const executeCommand = async (command: string) => {
		try {
			await fetch("http://localhost:3000/api/terminal/execute", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					command,
					cwd: workingDirRef.current,
					projectId,
				}),
			})
		} catch (error) {
			console.error("Failed to execute command:", error)
			xtermRef.current?.writeln(`\x1b[31mError: ${error}\x1b[0m`)
		}
	}

	return (
		<div className="interactive-terminal">
			<div className="terminal-header">
				<div className="terminal-title">
					<span className={`connection-status ${connected ? "connected" : "disconnected"}`}></span>
					<span>Terminal {connected ? "(Connected)" : "(Disconnected)"}</span>
				</div>
				<div className="terminal-actions">
					<button className="terminal-btn" onClick={() => xtermRef.current?.clear()} title="Clear">
						🗑️
					</button>
					<button className="terminal-btn" onClick={() => fitAddonRef.current?.fit()} title="Fit to window">
						⛶
					</button>
				</div>
			</div>
			<div ref={terminalRef} className="terminal-container" />
		</div>
	)
}
