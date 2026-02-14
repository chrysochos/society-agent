// kilocode_change - new file
/**
 * Society Agent Dashboard - Main control panel
 *
 * Displays all active agents, purpose progress, and provides
 * controls for monitoring and intervention.
 */

import React, { useState, useEffect, useRef } from "react"
import { VSCodeButton, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react"
import { vscode } from "../../utils/vscode"
import { AgentCard } from "./AgentCard"
import { InteractiveTerminal } from "./InteractiveTerminal"
import { AgentMonitor } from "./AgentMonitor" // kilocode_change - replaces PurposeInput as default view
import { TerminalPane } from "./TerminalPane"
import { MessageDialog } from "./MessageDialog"
import { MessageStream, type AgentMessage } from "./MessageStream"
import "./Dashboard.css"

// kilocode_change start
interface Agent {
	id: string
	name: string
	role: "supervisor" | "worker"
	workerType?: string
	status: "idle" | "working" | "waiting" | "paused" | "error" | "completed"
	currentTask?: string
	recentActivity: string[]
}

interface Purpose {
	id: string
	description: string
	progress: number
	status: "analyzing" | "forming-team" | "executing" | "completed" | "failed"
	startedAt: number
}

interface DashboardState {
	purpose?: Purpose
	agents: Agent[]
	messages: AgentMessage[]
	selectedAgent?: Agent
	selectedFilter: string // "all" or agent ID
	showTerminal: boolean
	showMessageDialog: boolean
	showInteractiveTerminal: boolean
}
// kilocode_change end

export const Dashboard: React.FC = () => {
	// kilocode_change start
	const [state, setState] = useState<DashboardState>({
		agents: [],
		messages: [],
		selectedFilter: "all",
		showTerminal: false,
		showMessageDialog: false,
		showInteractiveTerminal: false,
	})

	const [showMonitor, setShowMonitor] = useState(true) // kilocode_change - renamed from showPurposeInput
	const messageStreamRef = useRef<HTMLDivElement>(null)

	// Handle messages from extension
	useEffect(() => {
		// Notify extension that webview is ready
		console.log("📡 Society Agent Dashboard mounted, sending ready signal")
		vscode.postMessage({ type: "webview-ready" })

		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			console.log("📨 Dashboard received message:", message.type, message)

			switch (message.type) {
				case "purpose-started":
					setState((prev) => ({
						...prev,
						purpose: message.purpose,
					}))
					setShowMonitor(false) // kilocode_change
					break

				case "team-formed":
					setState((prev) => ({
						...prev,
						agents: message.agents,
					}))
					break

				case "agent-status-update":
					setState((prev) => ({
						...prev,
						agents: prev.agents.map((agent) =>
							agent.id === message.agentId
								? {
										...agent,
										status: message.status,
										currentTask: message.currentTask || agent.currentTask,
										recentActivity:
											message.status !== agent.status
												? [`Status: ${message.status}`, ...agent.recentActivity.slice(0, 4)]
												: agent.recentActivity,
									}
								: agent,
						),
					}))
					break

				case "agent-activity":
					setState((prev) => ({
						...prev,
						agents: prev.agents.map((agent) =>
							agent.id === message.agentId
								? {
										...agent,
										recentActivity: [message.activity, ...agent.recentActivity.slice(0, 4)],
									}
								: agent,
						),
					}))
					break

				case "progress-update":
					setState((prev) => ({
						...prev,
						purpose: prev.purpose ? { ...prev.purpose, progress: message.progress } : undefined,
					}))
					break

				case "terminal-output": // kilocode_change - Handle terminal output
					setState((prev) => ({
						...prev,
						agents: prev.agents.map((agent) =>
							agent.id === message.agentId
								? {
										...agent,
										recentActivity: [message.output, ...agent.recentActivity.slice(0, 4)],
									}
								: agent,
						),
					}))
					break

				case "purpose-completed":
					setState((prev) => ({
						...prev,
						purpose: prev.purpose ? { ...prev.purpose, status: "completed", progress: 100 } : undefined,
					}))
					// kilocode_change start - Show completion notification
					if (message.result) {
						console.log("✅ Purpose completed:", message.result)
					}
					// kilocode_change end
					break

				// kilocode_change start - Handle Society Agent messages
				case "society-agent-message":
					setState((prev) => ({
						...prev,
						messages: [
							...prev.messages,
							{
								id: `msg-${Date.now()}-${Math.random()}`,
								fromAgent: message.agentId,
								toAgent: message.toAgent,
								message: message.message,
								timestamp: message.timestamp,
								type: "message",
							},
						],
					}))
					break

				case "society-agent-status":
					setState((prev) => ({
						...prev,
						messages: [
							...prev.messages,
							{
								id: `status-${Date.now()}-${Math.random()}`,
								fromAgent: message.agentId,
								message: `Status: ${message.status}${message.task ? ` - ${message.task}` : ""}`,
								timestamp: message.timestamp,
								type: "status",
							},
						],
						agents: prev.agents.map((agent) =>
							agent.id === message.agentId
								? {
										...agent,
										status: message.status,
										currentTask: message.task || agent.currentTask,
									}
								: agent,
						),
					}))
					break
				// kilocode_change end
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [])

	const handlePurposeSubmit = (purposeData: {
		description: string
		context?: string
		attachments?: string[]
		constraints?: string[]
		successCriteria?: string[]
	}) => {
		console.log("📤 Sending purpose to extension:", purposeData)
		// Send to extension
		vscode.postMessage({
			type: "start-purpose",
			...purposeData, // Spread the fields at top level
		})
	}

	const handleAgentClick = (agent: Agent) => {
		setState((prev) => ({
			...prev,
			selectedAgent: agent,
			showTerminal: true,
		}))
	}

	const handleSendMessage = (agentId: string) => {
		setState((prev) => ({
			...prev,
			selectedAgent: prev.agents.find((a) => a.id === agentId),
			showMessageDialog: true,
		}))
	}

	const handlePauseAgent = (agentId: string) => {
		vscode.postMessage({
			type: "pause-agent",
			agentId,
		} as any)
	}

	const handlePauseAll = () => {
		vscode.postMessage({
			type: "pause-all",
		} as any)
	}

	const handleResumeAll = () => {
		vscode.postMessage({
			type: "resume-all",
		} as any)
	}

	const handleStopPurpose = () => {
		if (confirm("Stop current purpose execution?")) {
			vscode.postMessage({
				type: "stop-purpose",
				purposeId: state.purpose?.id,
			} as any)
		}
	}

	// Show agent monitor when no active purpose
	if (showMonitor || !state.purpose) { // kilocode_change - renamed from showPurposeInput
		return <AgentMonitor /> // kilocode_change - replaced PurposeInput with AgentMonitor
	}

	return (
		<div className="society-dashboard">
			{/* Header */}
			<div className="dashboard-header">
				<div className="header-content">
					<h1>Society Agent Control Panel</h1>
					<div className="purpose-info">
						<div className="purpose-description">{state.purpose.description}</div>
						<div className="progress-container">
							<div className="progress-text">
								Progress: {state.purpose.progress}%{state.purpose.status === "completed" && " ✅"}
							</div>
							{state.purpose.status !== "completed" && <VSCodeProgressRing />}
						</div>
					</div>
				</div>

				<div className="header-actions">
					{" "}
					<VSCodeButton
						onClick={() =>
							setState((prev) => ({ ...prev, showInteractiveTerminal: !prev.showInteractiveTerminal }))
						}>
						{state.showInteractiveTerminal ? "🖥️ Hide Terminal" : "🖥️ Open Terminal"}
					</VSCodeButton>{" "}
					<VSCodeButton onClick={handlePauseAll}>⏸️ Pause All</VSCodeButton>
					<VSCodeButton onClick={handleResumeAll}>▶️ Resume All</VSCodeButton>
					<VSCodeButton appearance="secondary" onClick={handleStopPurpose}>
						⏹️ Stop
					</VSCodeButton>
					{/* kilocode_change start - Add New Purpose button (always visible) */}
					<VSCodeButton
						onClick={() => {
							if (state.purpose?.status !== "completed") {
								if (!confirm("Current purpose is still running. Start a new purpose anyway?")) {
									return
								}
							}
							setState((prev) => ({
								...prev,
								agents: [],
								showTerminal: false,
								showMessageDialog: false,
								showInteractiveTerminal: false,
								messages: [],
								selectedFilter: "all",
							}))
							setShowMonitor(true) // kilocode_change
						}}
						title="Start new purpose">
						➕ New Purpose
					</VSCodeButton>
					{/* kilocode_change end */}
				</div>
			</div>

			{/* kilocode_change start - Agent Filter Tabs */}
			<div className="agent-filter-tabs">
				<button
					className={`filter-tab ${state.selectedFilter === "all" ? "active" : ""}`}
					onClick={() => setState((prev) => ({ ...prev, selectedFilter: "all" }))}>
					All Messages
				</button>
				{state.agents.map((agent) => (
					<button
						key={agent.id}
						className={`filter-tab ${state.selectedFilter === agent.id ? "active" : ""}`}
						onClick={() => setState((prev) => ({ ...prev, selectedFilter: agent.id }))}>
						{agent.name}
					</button>
				))}
			</div>

			{/* Message Stream */}
			<div className="message-stream-container" ref={messageStreamRef}>
				<MessageStream messages={state.messages} filterAgent={state.selectedFilter} />
			</div>
			{/* kilocode_change end */}

			{/* Agent Grid */}
			<div className="agent-grid">
				{state.agents.map((agent) => (
					<AgentCard
						key={agent.id}
						agent={agent}
						onTerminalClick={() => handleAgentClick(agent)}
						onMessageClick={() => handleSendMessage(agent.id)}
						onPauseClick={() => handlePauseAgent(agent.id)}
					/>
				))}
			</div>

			{/* Interactive Terminal */}
			{state.showInteractiveTerminal && (
				<div className="terminal-section">
					<InteractiveTerminal
						cwd="/workspace"
						onCommandExecute={(cmd) => console.log("Executed:", cmd)}
						_onClose={() => setState((prev) => ({ ...prev, showInteractiveTerminal: false }))}
					/>
				</div>
			)}

			{/* Agent Terminal Pane */}
			{state.showTerminal && state.selectedAgent && (
				<TerminalPane
					agent={state.selectedAgent}
					onClose={() => setState((prev) => ({ ...prev, showTerminal: false, selectedAgent: undefined }))}
				/>
			)}

			{/* Message Dialog */}
			{state.showMessageDialog && state.selectedAgent && (
				<MessageDialog
					agent={state.selectedAgent}
					onClose={() =>
						setState((prev) => ({ ...prev, showMessageDialog: false, selectedAgent: undefined }))
					}
				/>
			)}
		</div>
	)
	// kilocode_change end
}
