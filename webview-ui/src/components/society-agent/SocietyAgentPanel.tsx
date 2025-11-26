// kilocode_change - new file
/**
 * Society Agent Registry Panel
 * 
 * Displays active agents, their capabilities, status, and allows interaction.
 */

import React, { useState, useEffect } from "react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { vscode } from "@/utils/vscode"

interface AgentIdentity {
	id: string
	name?: string
	role: "worker" | "supervisor" | "coordinator"
	capabilities: string[]
	domain?: string
}

interface AgentStatus {
	agent: AgentIdentity
	available: boolean
	taskCount: number
	lastSeen: number
	activeTasks: string[]
}

interface SocietyAgentPanelProps {
	// Optional callback when agent is selected
	onAgentSelect?: (agentId: string) => void
}

export const SocietyAgentPanel: React.FC<SocietyAgentPanelProps> = ({ onAgentSelect }) => {
	const [agents, setAgents] = useState<AgentStatus[]>([])
	const [loading, setLoading] = useState(true)
	const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
	const [filter, setFilter] = useState<"all" | "worker" | "supervisor" | "coordinator">("all")

	useEffect(() => {
		// Request agent registry from extension
		vscode.postMessage({
			type: "getAgentRegistry",
		})

		// Set up message listener
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "agentRegistry") {
				setAgents(message.agents || [])
				setLoading(false)
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [])

	const handleRefresh = () => {
		setLoading(true)
		vscode.postMessage({
			type: "getAgentRegistry",
		})
	}

	const handleAgentClick = (agentId: string) => {
		setSelectedAgent(agentId)
		onAgentSelect?.(agentId)
	}

	const handleSendMessage = (agentId: string) => {
		vscode.postMessage({
			type: "sendAgentMessage",
			agentId,
		})
	}

	const filteredAgents = filter === "all" ? agents : agents.filter((a) => a.agent.role === filter)

	const formatLastSeen = (timestamp: number): string => {
		const now = Date.now()
		const diff = now - timestamp
		const minutes = Math.floor(diff / 60000)

		if (minutes < 1) return "just now"
		if (minutes < 60) return `${minutes}m ago`
		const hours = Math.floor(minutes / 60)
		if (hours < 24) return `${hours}h ago`
		const days = Math.floor(hours / 24)
		return `${days}d ago`
	}

	const getRoleColor = (role: string): string => {
		switch (role) {
			case "supervisor":
				return "text-blue-400"
			case "coordinator":
				return "text-purple-400"
			case "worker":
			default:
				return "text-green-400"
		}
	}

	const getStatusColor = (available: boolean): string => {
		return available ? "bg-green-500" : "bg-yellow-500"
	}

	if (loading) {
		return (
			<div className="flex items-center justify-center p-8">
				<div className="text-muted-foreground">Loading agents...</div>
			</div>
		)
	}

	if (agents.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center p-8 space-y-4">
				<div className="text-muted-foreground">No active agents found</div>
				<div className="text-xs text-muted-foreground text-center">
					Start an agent with --agent-id flag to see it here
				</div>
				<VSCodeButton onClick={handleRefresh}>Refresh</VSCodeButton>
			</div>
		)
	}

	return (
		<div className="flex flex-col h-full">
			{/* Header */}
			<div className="flex items-center justify-between p-4 border-b border-border">
				<h2 className="text-lg font-semibold">Society Agents</h2>
				<div className="flex items-center gap-2">
					<div className="text-xs text-muted-foreground">{agents.length} active</div>
					<VSCodeButton appearance="icon" onClick={handleRefresh}>
						↻
					</VSCodeButton>
				</div>
			</div>

			{/* Filter */}
			<div className="flex gap-2 p-4 border-b border-border">
				<button
					className={`px-3 py-1 text-xs rounded ${filter === "all" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}
					onClick={() => setFilter("all")}>
					All ({agents.length})
				</button>
				<button
					className={`px-3 py-1 text-xs rounded ${filter === "worker" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}
					onClick={() => setFilter("worker")}>
					Workers ({agents.filter((a) => a.agent.role === "worker").length})
				</button>
				<button
					className={`px-3 py-1 text-xs rounded ${filter === "supervisor" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}
					onClick={() => setFilter("supervisor")}>
					Supervisors ({agents.filter((a) => a.agent.role === "supervisor").length})
				</button>
				<button
					className={`px-3 py-1 text-xs rounded ${filter === "coordinator" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}
					onClick={() => setFilter("coordinator")}>
					Coordinators ({agents.filter((a) => a.agent.role === "coordinator").length})
				</button>
			</div>

			{/* Agent List */}
			<div className="flex-1 overflow-y-auto">
				{filteredAgents.map((agentStatus) => {
					const agent = agentStatus.agent
					const isSelected = selectedAgent === agent.id

					return (
						<div
							key={agent.id}
							className={`p-4 border-b border-border cursor-pointer hover:bg-accent/50 ${isSelected ? "bg-accent" : ""}`}
							onClick={() => handleAgentClick(agent.id)}>
							{/* Agent Header */}
							<div className="flex items-start justify-between mb-2">
								<div className="flex items-center gap-2">
									{/* Status Indicator */}
									<div
										className={`w-2 h-2 rounded-full ${getStatusColor(agentStatus.available)}`}
										title={agentStatus.available ? "Available" : "Busy"}
									/>

									{/* Agent Name/ID */}
									<div className="flex flex-col">
										<span className="font-medium text-sm">
											{agent.name || agent.id}
										</span>
										{agent.name && (
											<span className="text-xs text-muted-foreground">
												{agent.id}
											</span>
										)}
									</div>
								</div>

								{/* Role Badge */}
								<span
									className={`px-2 py-0.5 text-xs rounded ${getRoleColor(agent.role)} bg-accent`}>
									{agent.role}
								</span>
							</div>

							{/* Domain */}
							{agent.domain && (
								<div className="text-xs text-muted-foreground mb-2">
									Domain: {agent.domain}
								</div>
							)}

							{/* Capabilities */}
							<div className="flex flex-wrap gap-1 mb-2">
								{agent.capabilities.slice(0, 5).map((cap) => (
									<span
										key={cap}
										className="px-2 py-0.5 text-xs bg-secondary text-secondary-foreground rounded">
										{cap}
									</span>
								))}
								{agent.capabilities.length > 5 && (
									<span className="px-2 py-0.5 text-xs text-muted-foreground">
										+{agent.capabilities.length - 5} more
									</span>
								)}
							</div>

							{/* Status Info */}
							<div className="flex items-center justify-between text-xs text-muted-foreground">
								<div>
									{agentStatus.taskCount > 0 ? (
										<span>
											{agentStatus.taskCount}{" "}
											{agentStatus.taskCount === 1 ? "task" : "tasks"}
										</span>
									) : (
										<span>Idle</span>
									)}
								</div>
								<div>{formatLastSeen(agentStatus.lastSeen)}</div>
							</div>

							{/* Actions (shown when selected) */}
							{isSelected && (
								<div className="flex gap-2 mt-3 pt-3 border-t border-border">
									<VSCodeButton
										appearance="secondary"
										onClick={(e) => {
											e.stopPropagation()
											handleSendMessage(agent.id)
										}}>
										Send Message
									</VSCodeButton>
									<VSCodeButton
										appearance="secondary"
										onClick={(e) => {
											e.stopPropagation()
											vscode.postMessage({
												type: "viewAgentLogs",
												agentId: agent.id,
											})
										}}>
										View Logs
									</VSCodeButton>
								</div>
							)}
						</div>
					)
				})}
			</div>

			{/* Footer Stats */}
			<div className="p-4 border-t border-border bg-secondary/30">
				<div className="flex justify-between text-xs text-muted-foreground">
					<span>
						Available: {agents.filter((a) => a.available).length} / {agents.length}
					</span>
					<span>
						Total Tasks: {agents.reduce((sum, a) => sum + a.taskCount, 0)}
					</span>
				</div>
			</div>
		</div>
	)
}
