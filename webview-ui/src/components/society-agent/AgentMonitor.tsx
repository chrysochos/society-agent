// kilocode_change - new file
/**
 * AgentMonitor - Real-time agent status monitor
 *
 * Replaces the PurposeInput sidebar with a live dashboard showing:
 * - This agent's identity (ID, role, team, key fingerprint)
 * - Registered agents with heartbeat status
 * - Message queue depth
 * - Recent messages log
 * - Quick actions (pause all, send message)
 */

import React, { useState, useEffect, useCallback } from "react"
import { VSCodeButton, VSCodeBadge, VSCodeDivider, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react"
import { vscode } from "../../utils/vscode"
import "./AgentMonitor.css"

// --- Data types matching backend ---

interface MonitorIdentity {
	id: string
	name: string
	role: "worker" | "supervisor" | "coordinator"
	capabilities: string[]
	domain?: string
	fingerprint?: string // Ed25519 public key fingerprint
	teamId?: string
}

interface MonitorAgent {
	id: string
	name: string
	role: "worker" | "supervisor" | "coordinator"
	status: "idle" | "busy" | "offline"
	currentTask: string | null
	lastSeen: number
	domain?: string
}

interface MonitorMessage {
	id: string
	from: string
	to?: string
	type: "message" | "status" | "result" | "error" | "command"
	content: string
	timestamp: number
}

interface MonitorData {
	identity: MonitorIdentity | null
	agents: MonitorAgent[]
	queueDepth: number
	recentMessages: MonitorMessage[]
	teamStatus?: {
		teamId: string
		supervisorId: string
		workerCount: number
		activeWorkers: number
	}
}

// --- Component ---

export const AgentMonitor: React.FC = () => {
	const [data, setData] = useState<MonitorData>({
		identity: null,
		agents: [],
		queueDepth: 0,
		recentMessages: [],
	})
	const [isConnected, setIsConnected] = useState(false)
	const [expandedSection, setExpandedSection] = useState<string | null>("identity")
	const [lastRefresh, setLastRefresh] = useState<number>(Date.now())

	// Request data from extension backend
	const requestRefresh = useCallback(() => {
		vscode.postMessage({ type: "agent-monitor-refresh" } as any)
		setLastRefresh(Date.now())
	}, [])

	useEffect(() => {
		// Signal ready and request initial data
		vscode.postMessage({ type: "webview-ready" } as any)
		requestRefresh()

		const handleMessage = (event: MessageEvent) => {
			const msg = event.data

			switch (msg.type) {
				case "agent-monitor-data":
					setData(msg.data)
					setIsConnected(true)
					break

				case "agent-monitor-update":
					setData((prev) => ({ ...prev, ...msg.patch }))
					break

				case "agent-monitor-identity":
					setData((prev) => ({ ...prev, identity: msg.identity }))
					setIsConnected(true)
					break

				case "agent-monitor-agents":
					setData((prev) => ({ ...prev, agents: msg.agents }))
					break

				case "agent-monitor-message":
					setData((prev) => ({
						...prev,
						recentMessages: [msg.message, ...prev.recentMessages].slice(0, 50),
						queueDepth: msg.queueDepth ?? prev.queueDepth,
					}))
					break

				// Also handle legacy dashboard messages so the monitor works
				// even before the backend is updated
				case "society-agent-status":
					setData((prev) => ({
						...prev,
						agents: prev.agents.map((a) =>
							a.id === msg.agentId
								? { ...a, status: msg.status, currentTask: msg.task ?? a.currentTask }
								: a,
						),
					}))
					break

				case "team-formed":
					if (msg.agents) {
						setData((prev) => ({
							...prev,
							agents: msg.agents.map((a: any) => ({
								id: a.id,
								name: a.name,
								role: a.role,
								status: "idle" as const,
								currentTask: null,
								lastSeen: Date.now(),
								domain: a.workerType,
							})),
						}))
					}
					break
			}
		}

		window.addEventListener("message", handleMessage)

		// Poll for updates every 5 seconds
		const interval = setInterval(requestRefresh, 5000)

		return () => {
			window.removeEventListener("message", handleMessage)
			clearInterval(interval)
		}
	}, [requestRefresh])

	const toggleSection = (section: string) => {
		setExpandedSection((prev) => (prev === section ? null : section))
	}

	const timeSince = (ts: number): string => {
		const seconds = Math.floor((Date.now() - ts) / 1000)
		if (seconds < 5) return "just now"
		if (seconds < 60) return `${seconds}s ago`
		if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
		return `${Math.floor(seconds / 3600)}h ago`
	}

	const truncateId = (id: string, len = 8): string => {
		return id.length > len ? id.slice(0, len) + "…" : id
	}

	// --- Render sections ---

	const renderIdentitySection = () => {
		const id = data.identity
		return (
			<div className="monitor-section">
				<div className="section-header" onClick={() => toggleSection("identity")}>
					<span className="section-icon">{expandedSection === "identity" ? "▾" : "▸"}</span>
					<span className="section-title">🔑 This Agent</span>
					{id && <VSCodeBadge>{id.role}</VSCodeBadge>}
				</div>
				{expandedSection === "identity" && (
					<div className="section-content">
						{id ? (
							<div className="identity-details">
								<div className="detail-row">
									<span className="detail-label">ID</span>
									<span className="detail-value mono">{truncateId(id.id, 16)}</span>
								</div>
								<div className="detail-row">
									<span className="detail-label">Name</span>
									<span className="detail-value">{id.name}</span>
								</div>
								<div className="detail-row">
									<span className="detail-label">Role</span>
									<span className="detail-value">{id.role}</span>
								</div>
								{id.domain && (
									<div className="detail-row">
										<span className="detail-label">Domain</span>
										<span className="detail-value">{id.domain}</span>
									</div>
								)}
								{id.teamId && (
									<div className="detail-row">
										<span className="detail-label">Team</span>
										<span className="detail-value mono">{truncateId(id.teamId)}</span>
									</div>
								)}
								{id.fingerprint && (
									<div className="detail-row">
										<span className="detail-label">Key</span>
										<span className="detail-value mono fingerprint">{id.fingerprint}</span>
									</div>
								)}
								<div className="detail-row">
									<span className="detail-label">Caps</span>
									<span className="detail-value caps-list">
										{id.capabilities.length > 0
											? id.capabilities.map((c) => (
													<span key={c} className="cap-badge">
														{c}
													</span>
												))
											: "—"}
									</span>
								</div>
							</div>
						) : (
							<div className="section-empty">No identity loaded</div>
						)}
					</div>
				)}
			</div>
		)
	}

	const renderAgentsSection = () => {
		const sorted = [...data.agents].sort((a, b) => {
			// Supervisor first, then by status
			if (a.role === "supervisor" && b.role !== "supervisor") return -1
			if (b.role === "supervisor" && a.role !== "supervisor") return 1
			return 0
		})

		return (
			<div className="monitor-section">
				<div className="section-header" onClick={() => toggleSection("agents")}>
					<span className="section-icon">{expandedSection === "agents" ? "▾" : "▸"}</span>
					<span className="section-title">👥 Agents</span>
					<VSCodeBadge>{data.agents.length}</VSCodeBadge>
				</div>
				{expandedSection === "agents" && (
					<div className="section-content">
						{sorted.length > 0 ? (
							<div className="agents-list">
								{sorted.map((agent) => (
									<div key={agent.id} className={`agent-row status-${agent.status}`}>
										<div className="agent-row-header">
											<span className="agent-row-icon">
												{agent.role === "supervisor" ? "🎯" : "🤖"}
											</span>
											<span className="agent-row-name">{agent.name}</span>
											<span
												className={`status-dot status-${agent.status}`}
												title={agent.status}
											/>
										</div>
										{agent.currentTask && <div className="agent-row-task">{agent.currentTask}</div>}
										<div className="agent-row-meta">
											{agent.domain && <span className="meta-tag">{agent.domain}</span>}
											<span className="meta-time">{timeSince(agent.lastSeen)}</span>
										</div>
									</div>
								))}
							</div>
						) : (
							<div className="section-empty">No agents registered</div>
						)}
					</div>
				)}
			</div>
		)
	}

	const renderQueueSection = () => {
		return (
			<div className="monitor-section">
				<div className="section-header" onClick={() => toggleSection("queue")}>
					<span className="section-icon">{expandedSection === "queue" ? "▾" : "▸"}</span>
					<span className="section-title">📬 Message Queue</span>
					<VSCodeBadge>{data.queueDepth}</VSCodeBadge>
				</div>
				{expandedSection === "queue" && (
					<div className="section-content">
						{data.teamStatus && (
							<div className="team-stats">
								<div className="detail-row">
									<span className="detail-label">Team</span>
									<span className="detail-value mono">{truncateId(data.teamStatus.teamId)}</span>
								</div>
								<div className="detail-row">
									<span className="detail-label">Supervisor</span>
									<span className="detail-value mono">
										{truncateId(data.teamStatus.supervisorId)}
									</span>
								</div>
								<div className="detail-row">
									<span className="detail-label">Workers</span>
									<span className="detail-value">
										{data.teamStatus.activeWorkers} / {data.teamStatus.workerCount} active
									</span>
								</div>
							</div>
						)}
						<div className="queue-info">
							<div className="detail-row">
								<span className="detail-label">Pending</span>
								<span className="detail-value">
									{data.queueDepth === 0 ? (
										<span className="queue-empty">Empty ✓</span>
									) : (
										<span className="queue-count">{data.queueDepth} messages</span>
									)}
								</span>
							</div>
						</div>
					</div>
				)}
			</div>
		)
	}

	const renderMessagesSection = () => {
		return (
			<div className="monitor-section messages-section">
				<div className="section-header" onClick={() => toggleSection("messages")}>
					<span className="section-icon">{expandedSection === "messages" ? "▾" : "▸"}</span>
					<span className="section-title">💬 Recent Messages</span>
					<VSCodeBadge>{data.recentMessages.length}</VSCodeBadge>
				</div>
				{expandedSection === "messages" && (
					<div className="section-content messages-list">
						{data.recentMessages.length > 0 ? (
							data.recentMessages.slice(0, 20).map((msg) => (
								<div key={msg.id} className={`message-row type-${msg.type}`}>
									<div className="message-header">
										<span className="message-from">{truncateId(msg.from, 10)}</span>
										{msg.to && (
											<>
												<span className="message-arrow">→</span>
												<span className="message-to">{truncateId(msg.to, 10)}</span>
											</>
										)}
										<span className="message-time">{timeSince(msg.timestamp)}</span>
									</div>
									<div className="message-content">{msg.content}</div>
								</div>
							))
						) : (
							<div className="section-empty">No messages yet</div>
						)}
					</div>
				)}
			</div>
		)
	}

	// --- Main render ---

	return (
		<div className="agent-monitor">
			{/* Status bar */}
			<div className="monitor-status-bar">
				<div className="status-indicator">
					<span className={`connection-dot ${isConnected ? "connected" : ""}`} />
					<span className="status-text">{isConnected ? "Connected" : "Connecting…"}</span>
				</div>
				<div className="status-actions">
					<VSCodeButton appearance="icon" title="Refresh" onClick={requestRefresh}>
						🔄
					</VSCodeButton>
				</div>
			</div>

			{/* Sections */}
			<div className="monitor-sections">
				{renderIdentitySection()}
				<VSCodeDivider />
				{renderAgentsSection()}
				<VSCodeDivider />
				{renderQueueSection()}
				<VSCodeDivider />
				{renderMessagesSection()}
			</div>

			{/* Footer */}
			<div className="monitor-footer">
				<span className="footer-text">Last refresh: {timeSince(lastRefresh)}</span>
			</div>
		</div>
	)
}
