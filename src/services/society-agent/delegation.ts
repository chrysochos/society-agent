// kilocode_change - new file
/**
 * Task Delegation System
 *
 * Enables supervisors to delegate tasks to worker agents based on
 * capabilities and availability.
 */

import { AgentIdentity, AgentCapability } from "./types"
import { AgentMessaging } from "./agent-messaging"

/**
 * Result of task delegation
 */
export interface DelegationResult {
	/** Whether delegation was successful */
	success: boolean
	/** ID of agent that handled the task */
	agentId?: string
	/** Result from the agent */
	result?: any
	/** Error message if delegation failed */
	error?: string
}

/**
 * Criteria for selecting an agent for a task
 */
export interface TaskRequirements {
	/** Required capabilities for the task */
	requiredCapabilities: AgentCapability[]
	/** Optional preferred capabilities */
	preferredCapabilities?: AgentCapability[]
	/** Minimum agent experience level */
	minExperience?: number
	/** Exclude specific agents */
	excludeAgents?: string[]
}

/**
 * Agent availability and status
 */
export interface AgentStatus {
	/** Agent identity */
	agent: AgentIdentity
	/** Whether agent is currently available */
	available: boolean
	/** Current task count */
	taskCount: number
	/** Last seen timestamp */
	lastSeen: number
}

/**
 * Registry of agents and their status
 */
export interface AgentRegistry {
	/** Get all registered agents */
	getAllAgents(): AgentIdentity[]
	/** Get agent by ID */
	getAgent(agentId: string): AgentIdentity | undefined
	/** Get agent status */
	getStatus(agentId: string): AgentStatus | undefined
	/** Update agent status */
	updateStatus(agentId: string, status: Partial<AgentStatus>): void
}

/**
 * Task delegation system for supervisor agents
 */
export class TaskDelegation {
	constructor(
		private agentMessaging: AgentMessaging,
		private agentRegistry: AgentRegistry,
	) {}

	/**
	 * Delegate a task to the most suitable agent
	 */
	async delegateTask(task: string, requirements: TaskRequirements, context?: any): Promise<DelegationResult> {
		try {
			// Find suitable agents
			const suitableAgents = this.findSuitableAgents(requirements)

			if (suitableAgents.length === 0) {
				return {
					success: false,
					error: "No suitable agent found for task requirements",
				}
			}

			// Select best agent (first available with highest capability match)
			const selectedAgent = this.selectBestAgent(suitableAgents, requirements)

			// Delegate task
			const result = await this.agentMessaging.requestTask(selectedAgent.id, task, context)

			// Update agent status
			this.agentRegistry.updateStatus(selectedAgent.id, {
				taskCount: (this.agentRegistry.getStatus(selectedAgent.id)?.taskCount || 0) + 1,
			})

			return {
				success: true,
				agentId: selectedAgent.id,
				result,
			}
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error during delegation",
			}
		}
	}

	/**
	 * Delegate task to a specific agent
	 */
	async delegateToAgent(agentId: string, task: string, context?: any): Promise<DelegationResult> {
		try {
			const agent = this.agentRegistry.getAgent(agentId)
			if (!agent) {
				return {
					success: false,
					error: `Agent ${agentId} not found`,
				}
			}

			const status = this.agentRegistry.getStatus(agentId)
			if (!status?.available) {
				return {
					success: false,
					error: `Agent ${agentId} is not available`,
				}
			}

			const result = await this.agentMessaging.requestTask(agentId, task, context)

			this.agentRegistry.updateStatus(agentId, {
				taskCount: (status.taskCount || 0) + 1,
			})

			return {
				success: true,
				agentId,
				result,
			}
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error during delegation",
			}
		}
	}

	/**
	 * Broadcast task to all capable agents (first to respond wins)
	 */
	async broadcastTask(task: string, requirements: TaskRequirements, context?: any): Promise<DelegationResult> {
		try {
			const suitableAgents = this.findSuitableAgents(requirements)

			if (suitableAgents.length === 0) {
				return {
					success: false,
					error: "No suitable agents found for broadcast",
				}
			}

			// Broadcast to all suitable agents
			await this.agentMessaging.broadcast({
				type: "task_broadcast",
				task,
				context,
				requirements,
			})

			// In a real implementation, would wait for first response
			// For now, just delegate to first agent
			return await this.delegateToAgent(suitableAgents[0].id, task, context)
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error during broadcast",
			}
		}
	}

	/**
	 * Find agents that meet task requirements
	 */
	private findSuitableAgents(requirements: TaskRequirements): AgentIdentity[] {
		const allAgents = this.agentRegistry.getAllAgents()

		return allAgents.filter((agent) => {
			// Check exclusions
			if (requirements.excludeAgents?.includes(agent.id)) {
				return false
			}

			// Check availability
			const status = this.agentRegistry.getStatus(agent.id)
			if (!status?.available) {
				return false
			}

			// Check required capabilities
			const hasAllRequired = requirements.requiredCapabilities.every((cap) => agent.capabilities.includes(cap))
			if (!hasAllRequired) {
				return false
			}

			// Check experience level if specified
			if (requirements.minExperience !== undefined) {
				const agentExperience = this.getAgentExperience(agent)
				if (agentExperience < requirements.minExperience) {
					return false
				}
			}

			return true
		})
	}

	/**
	 * Select the best agent from a list of suitable agents
	 */
	private selectBestAgent(agents: AgentIdentity[], requirements: TaskRequirements): AgentIdentity {
		// Score each agent based on capability match and availability
		const scoredAgents = agents.map((agent) => {
			let score = 0

			// +1 for each required capability
			score += requirements.requiredCapabilities.length

			// +1 for each preferred capability
			if (requirements.preferredCapabilities) {
				score += requirements.preferredCapabilities.filter((cap) => agent.capabilities.includes(cap)).length
			}

			// Prefer agents with lower task count (less busy)
			const status = this.agentRegistry.getStatus(agent.id)
			const taskCount = status?.taskCount || 0
			score -= taskCount * 0.1

			return { agent, score }
		})

		// Sort by score (highest first)
		scoredAgents.sort((a, b) => b.score - a.score)

		return scoredAgents[0].agent
	}

	/**
	 * Get agent experience level (number of tasks completed)
	 */
	private getAgentExperience(agent: AgentIdentity): number {
		// In a real implementation, would track task completion history
		// For now, use task count as proxy
		const status = this.agentRegistry.getStatus(agent.id)
		return status?.taskCount || 0
	}

	/**
	 * Get all agents capable of handling specific capabilities
	 */
	getAgentsWithCapabilities(capabilities: AgentCapability[]): AgentIdentity[] {
		return this.findSuitableAgents({
			requiredCapabilities: capabilities,
		})
	}

	/**
	 * Get available agents
	 */
	getAvailableAgents(): AgentIdentity[] {
		return this.agentRegistry.getAllAgents().filter((agent) => {
			const status = this.agentRegistry.getStatus(agent.id)
			return status?.available
		})
	}
}
