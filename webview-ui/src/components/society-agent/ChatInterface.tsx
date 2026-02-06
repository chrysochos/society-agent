// kilocode_change - new file
/**
 * Society Agent Chat Interface
 *
 * Main UI component for chat-based purpose input and results display.
 * Single user, real-time updates via WebSocket.
 */

import React, { useState, useEffect, useRef } from "react"
import { io, Socket } from "socket.io-client"
import { Settings } from "./Settings"
import "./ChatInterface.css"

interface Message {
	id: string
	type: "user" | "agent" | "system"
	content: string
	timestamp: number
	agentId?: string
	purposeId?: string
}

interface Agent {
	id: string
	name: string
	role: string
	status: string
	progress: number
	actionCount: number
}

interface Purpose {
	id: string
	description: string
	status: string
	progress: number
	agents: Agent[]
}

export const ChatInterface: React.FC = () => {
	// State
	const [messages, setMessages] = useState<Message[]>([])
	const [inputValue, setInputValue] = useState("")
	const [currentPurpose, setCurrentPurpose] = useState<Purpose | null>(null)
	const [isLoading, setIsLoading] = useState(false)
	const [socket, setSocket] = useState<Socket | null>(null)
	const [showAgentsPanel, setShowAgentsPanel] = useState(false)
	const [showSettings, setShowSettings] = useState(false)

	const messagesEndRef = useRef<HTMLDivElement>(null)
	const inputRef = useRef<HTMLInputElement>(null)

	// Initialize WebSocket connection
	useEffect(() => {
		const newSocket = io(window.location.origin, {
			reconnection: true,
			reconnectionDelay: 1000,
			reconnectionDelayMax: 5000,
			reconnectionAttempts: 5,
		})

		newSocket.on("connect", () => {
			console.log("✅ Connected to server")
			// Don't show connection messages in chat
		})

		newSocket.on("disconnect", () => {
			console.log("❌ Disconnected from server")
			// Don't show disconnection messages in chat
		})

		newSocket.on("purpose-started", (data: any) => {
			addSystemMessage(`� Working on: ${data.description}`)
		})

		newSocket.on("team-formed", (data: any) => {
			// Don't show team formation details - only show results
		})

		newSocket.on("progress-update", (data: any) => {
			if (currentPurpose && data.purposeId === currentPurpose.id) {
				setCurrentPurpose((prev) =>
					prev
						? {
								...prev,
								progress: data.progress,
							}
						: null,
				)
			}
		})

		newSocket.on("agent-status-change", (data: any) => {
			// Don't show individual agent status changes - too verbose
			// Only show important messages via agent-message events
		})

		newSocket.on("agent-message", (data: any) => {
			// Only show completion messages, not every status update
			if (data.status === "completed" || data.message?.includes("Created") || data.message?.includes("Error")) {
				addAgentMessage(data.message, data.agentId)
			}
		})

		setSocket(newSocket)

		return () => {
			newSocket.close()
		}
	}, [])

	// Auto-scroll to bottom
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
	}, [messages])

	// Helper functions
	const addSystemMessage = (content: string) => {
		const message: Message = {
			id: Date.now().toString(),
			type: "system",
			content,
			timestamp: Date.now(),
		}
		setMessages((prev) => [...prev, message])
	}

	const addAgentMessage = (content: string, agentId?: string) => {
		const message: Message = {
			id: Date.now().toString(),
			type: "agent",
			content,
			timestamp: Date.now(),
			agentId,
		}
		setMessages((prev) => [...prev, message])
	}

	const addUserMessage = (content: string) => {
		const message: Message = {
			id: Date.now().toString(),
			type: "user",
			content,
			timestamp: Date.now(),
		}
		setMessages((prev) => [...prev, message])
	}

	// Handle sending purpose
	const handleSendPurpose = async () => {
		if (!inputValue.trim() || isLoading) return

		// Check if API key is configured
		const apiKey = localStorage.getItem("anthropic_api_key")
		if (!apiKey) {
			addSystemMessage("⚠️ Please configure your API key in Settings first")
			setShowSettings(true)
			return
		}

		const purpose = inputValue.trim()
		addUserMessage(purpose)
		setInputValue("")
		setIsLoading(true)

		try {
			const response = await fetch("/api/purpose/start", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-API-Key": apiKey,
				},
				body: JSON.stringify({ description: purpose }),
			})

			if (!response.ok) {
				throw new Error("Failed to start purpose")
			}

			const data = await response.json()

			setCurrentPurpose({
				id: data.purposeId,
				description: data.description,
				status: "started",
				progress: 0,
				agents: [],
			})

			// Subscribe to purpose updates via WebSocket
			if (socket) {
				socket.emit("subscribe-purpose", data.purposeId)
			}

			addSystemMessage("🚀 Purpose execution started!")
		} catch (error) {
			addSystemMessage(`❌ Error: ${String(error)}`)
		} finally {
			setIsLoading(false)
			inputRef.current?.focus()
		}
	}

	const handleStopPurpose = async () => {
		if (!currentPurpose) return

		try {
			const response = await fetch(`/api/purpose/${currentPurpose.id}/stop`, {
				method: "POST",
			})

			if (!response.ok) {
				throw new Error("Failed to stop purpose")
			}

			addSystemMessage("⏹️ Purpose stopped by user")
			setCurrentPurpose(null)
		} catch (error) {
			addSystemMessage(`❌ Error: ${String(error)}`)
		}
	}

	const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault()
			handleSendPurpose()
		}
	}

	return (
		<div className="chat-interface">
			{/* Header */}
			<div className="chat-header">
				<div className="header-content">
					<h1>🤖 Society Agent Chat</h1>
					<p>Describe what you need, agents will do the work</p>
				</div>
				<div className="header-buttons">
					<button className="settings-btn" onClick={() => setShowSettings(true)}>
						⚙️ Settings
					</button>
					<button className="agents-btn" onClick={() => setShowAgentsPanel(!showAgentsPanel)}>
						{showAgentsPanel ? "Hide" : "Show"} Agents ({currentPurpose?.agents.length || 0})
					</button>
					{currentPurpose && (
						<button className="stop-btn" onClick={handleStopPurpose}>
							⏹️ Stop
						</button>
					)}
				</div>
			</div>

			{/* Main content - 2 column layout */}
			<div className="chat-body">
				{/* Left: Chat messages */}
				<div className="chat-column">
					<div className="messages-container">
						{messages.length === 0 ? (
							<div className="empty-state">
								<h2>👋 Welcome to Society Agent</h2>
								<p>Type a purpose or task, and AI agents will execute it for you.</p>
								<div className="example-prompts">
									<p>Example:</p>
									<ul>
										<li>"Analyze this TypeScript code for security issues"</li>
										<li>"Create a documentation file with examples"</li>
										<li>"Review the authentication implementation"</li>
									</ul>
								</div>
							</div>
						) : (
							messages.map((msg) => (
								<div key={msg.id} className={`message message-${msg.type}`}>
									<div className="message-time">{new Date(msg.timestamp).toLocaleTimeString()}</div>
									{msg.type === "agent" && msg.agentId && (
										<div className="message-agent">
											<a href={`#/agent/${msg.agentId}`} className="agent-link">
												🤖 {msg.agentId}
											</a>
										</div>
									)}
									<div className="message-content">{msg.content}</div>
								</div>
							))
						)}
						<div ref={messagesEndRef} />
					</div>

					{/* Input area */}
					<div className="input-area">
						<div className="progress-area">
							{currentPurpose && (
								<>
									<div className="progress-text">
										Progress: {currentPurpose.progress}% • Status: {currentPurpose.status}
									</div>
									<div className="progress-bar">
										<div
											className="progress-fill"
											style={{ width: `${currentPurpose.progress}%` }}
										/>
									</div>
								</>
							)}
						</div>

						<div className="input-wrapper">
							<input
								ref={inputRef}
								type="text"
								value={inputValue}
								onChange={(e) => setInputValue(e.target.value)}
								onKeyPress={handleKeyPress}
								placeholder={isLoading ? "Processing..." : "Describe your task or purpose..."}
								disabled={isLoading}
								className="input-field"
								autoFocus
							/>
							<button
								onClick={handleSendPurpose}
								disabled={!inputValue.trim() || isLoading}
								className="send-btn">
								{isLoading ? "⏳" : "📤"} Send
							</button>
						</div>
					</div>
				</div>

				{/* Right: Agents panel (collapsible) */}
				{showAgentsPanel && currentPurpose && (
					<div className="agents-panel">
						<h3>Active Agents ({currentPurpose.agents.length})</h3>
						<div className="agents-list">
							{currentPurpose.agents.length === 0 ? (
								<p className="no-agents">No agents yet</p>
							) : (
								currentPurpose.agents.map((agent) => (
									<div key={agent.id} className="agent-card">
										<a href={`#/agent/${agent.id}`} className="agent-name-link">
											{agent.role === "supervisor" ? "👨‍💼" : "🔧"} {agent.name}
										</a>
										<div className="agent-status">
											<span className={`status ${agent.status}`}>{agent.status}</span>
										</div>
										<div className="agent-progress">
											<div className="agent-progress-bar">
												<div
													className="agent-progress-fill"
													style={{ width: `${agent.progress}%` }}
												/>
											</div>
											<span className="agent-progress-text">{agent.actionCount}/100 actions</span>
										</div>
									</div>
								))
							)}
						</div>
					</div>
				)}
			</div>

			{/* Settings Modal */}
			<Settings isOpen={showSettings} onClose={() => setShowSettings(false)} />
		</div>
	)
}

export default ChatInterface
