// kilocode_change - new file
/**
 * AgentCard - Individual agent status card
 *
 * Displays agent status, current task, recent activity,
 * and provides quick action buttons.
 */

import React from "react"
import { VSCodeButton, VSCodeBadge } from "@vscode/webview-ui-toolkit/react"
import "./AgentCard.css"

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

interface AgentCardProps {
	agent: Agent
	onTerminalClick: () => void
	onMessageClick: () => void
	onPauseClick: () => void
}
// kilocode_change end

export const AgentCard: React.FC<AgentCardProps> = ({ agent, onTerminalClick, onMessageClick, onPauseClick }) => {
	// kilocode_change start
	const getStatusIcon = (status: Agent["status"]) => {
		switch (status) {
			case "working":
				return "🟢"
			case "idle":
				return "⚪"
			case "waiting":
				return "🟡"
			case "paused":
				return "⏸️"
			case "error":
				return "🔴"
			case "completed":
				return "✅"
			default:
				return "⚪"
		}
	}

	const getRoleIcon = (role: Agent["role"]) => {
		return role === "supervisor" ? "🎯" : "🤖"
	}

	const getStatusLabel = (status: Agent["status"]) => {
		return status.charAt(0).toUpperCase() + status.slice(1)
	}

	const getWorkerTypeLabel = (workerType?: string) => {
		if (!workerType) return ""
		return workerType
			.split("-")
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
			.join(" ")
	}

	return (
		<div className={`agent-card status-${agent.status}`}>
			{/* Header */}
			<div className="agent-card-header">
				<div className="agent-title">
					<span className="agent-icon">
						{getRoleIcon(agent.role)} {getStatusIcon(agent.status)}
					</span>
					<div className="agent-name-info">
						<div className="agent-name">{agent.name}</div>
						<div className="agent-type">
							{agent.role === "supervisor" ? "Supervisor" : getWorkerTypeLabel(agent.workerType)}
						</div>
					</div>
				</div>
				<VSCodeBadge>{getStatusLabel(agent.status)}</VSCodeBadge>
			</div>

			{/* Current Task */}
			{agent.currentTask && (
				<div className="agent-current-task">
					<div className="task-label">Current:</div>
					<div className="task-text">{agent.currentTask}</div>
				</div>
			)}

			{/* Recent Activity */}
			<div className="agent-recent-activity">
				<div className="activity-label">Recent:</div>
				<div className="activity-list">
					{agent.recentActivity.length > 0 ? (
						agent.recentActivity.slice(0, 3).map((activity, index) => (
							<div key={index} className="activity-item">
								{activity}
							</div>
						))
					) : (
						<div className="activity-item empty">No recent activity</div>
					)}
				</div>
			</div>

			{/* Actions */}
			<div className="agent-actions">
				<VSCodeButton onClick={onTerminalClick} title="Open terminal">
					📟 Terminal
				</VSCodeButton>
				<VSCodeButton onClick={onMessageClick} title="Send message">
					💬 Message
				</VSCodeButton>
				<VSCodeButton onClick={onPauseClick} title="Pause agent">
					{agent.status === "paused" ? "▶️" : "⏸️"}
				</VSCodeButton>
			</div>
		</div>
	)
	// kilocode_change end
}
