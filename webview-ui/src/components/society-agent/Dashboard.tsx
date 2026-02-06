// kilocode_change - new file
/**
 * Society Agent Dashboard - Main control panel
 *
 * Displays all active agents, purpose progress, and provides
 * controls for monitoring and intervention.
 */

import React, { useState, useEffect } from "react"
import { VSCodeButton, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react"
import { vscode } from "../../utils/vscode"
import { AgentCard } from "./AgentCard"
import { TerminalPane } from "./TerminalPane"
import { InteractiveTerminal } from "./InteractiveTerminal"
import { PurposeInput } from "./PurposeInput"
import { MessageDialog } from "./MessageDialog"
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
	selectedAgent?: Agent
	showTerminal: boolean
	showMessageDialog: boolean
	showInteractiveTerminal: boolean
}
// kilocode_change end

export const Dashboard: React.FC = () => {
	// kilocode_change start
	const [state, setState] = useState<DashboardState>({
		agents: [],
		showTerminal: false,
		showMessageDialog: false,
		showInteractiveTerminal: false,
	})

	const [showPurposeInput, setShowPurposeInput] = useState(true)

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
					setShowPurposeInput(false)
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

				case "purpose-completed":
					setState((prev) => ({
						...prev,
						purpose: prev.purpose ? { ...prev.purpose, status: "completed", progress: 100 } : undefined,
					}))
					break
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

	const closeTerminal = () => {
		setState((prev) => ({
			...prev,
			showTerminal: false,
			selectedAgent: undefined,
		}))
	}

	const closeMessageDialog = () => {
		setState((prev) => ({
			...prev,
			showMessageDialog: false,
		}))
	}

	// Show purpose input if no active purpose
	if (showPurposeInput || !state.purpose) {
		return <PurposeInput onSubmit={handlePurposeSubmit} />
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
				</div>
			</div>

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
						cwd={process.cwd?.() || "/workspace"}
						onCommandExecute={(cmd) => console.log("Executed:", cmd)}
					/>
				</div>
			)}
		</div>
	)
	// kilocode_change end
}
