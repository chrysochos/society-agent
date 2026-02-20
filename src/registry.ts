// Society Agent - new file
/**
 * Agent Registry
 *
 * Tracks all active agents in the society, their capabilities,
 * status, and availability.
 */

import { AgentIdentity, AgentRole, AgentCapability } from "./types"
import { SocietyAgentStorage } from "./storage"
import { getLog } from "./logger" // Society Agent

/**
 * Agent status in the registry
 */
export interface AgentRegistryStatus {
	/** Current status: idle, busy, offline */
	status: "idle" | "busy" | "offline"
	/** Current task ID if busy */
	currentTask: string | null
	/** Number of tasks completed */
	taskCount: number
	/** Number of tasks currently assigned */
	activeTasks: number
	/** Last seen timestamp */
	lastSeen: number
	/** When agent was registered */
	registeredAt: number
}

/**
 * Full agent entry in registry
 */
export interface AgentRegistryEntry {
	/** Agent identity */
	identity: AgentIdentity
	/** Agent status */
	status: AgentRegistryStatus
}

/**
 * Registry query options
 */
export interface RegistryQuery {
	/** Filter by role */
	role?: AgentRole
	/** Filter by capabilities (must have all) */
	capabilities?: AgentCapability[]
	/** Filter by status */
	status?: "idle" | "busy" | "offline"
	/** Filter by availability */
	available?: boolean
}

/**
 * Agent registry for tracking active agents in the society
 */
export class AgentRegistry {
	private static instance: AgentRegistry | undefined

	private agents = new Map<string, AgentRegistryEntry>()
	private agentsByRole = new Map<AgentRole, Set<string>>()
	private storage: SocietyAgentStorage | null = null
	private initialized = false

	// Make constructor private to enforce singleton
	private constructor() {}

	/**
	 * Get the singleton instance
	 */
	static getInstance(): AgentRegistry {
		if (!AgentRegistry.instance) {
			AgentRegistry.instance = new AgentRegistry()
		}
		return AgentRegistry.instance
	}

	/**
	 * Reset the singleton (for testing)
	 */
	static resetInstance(): void {
		AgentRegistry.instance = undefined
	}

	/**
	 * Initialize with storage
	 */
	async initialize(storage: SocietyAgentStorage): Promise<void> {
		if (this.initialized) {
			return
		}

		this.storage = storage
		await this.loadFromStorage()
		this.initialized = true
	}

	/**
	 * Load agent registry from persistent storage
	 */
	private async loadFromStorage(): Promise<void> {
		if (!this.storage) {
			return
		}

		try {
			const activeAgents = await this.storage.getActiveAgents()

			for (const [agentId, entry] of activeAgents) {
				if (entry.agentData && entry.agentData.name) {
					const identity: AgentIdentity = {
						id: agentId,
						name: entry.agentData.name,
						role: entry.agentData.role as AgentRole,
						capabilities: entry.agentData.capabilities as AgentCapability[],
						domain: entry.agentData.domain,
						createdAt: new Date(entry.agentData.createdAt || entry.timestamp),
					}

					const registryEntry: AgentRegistryEntry = {
						identity,
						status: {
							status: entry.agentData.available ? "idle" : "offline",
							currentTask: null,
							taskCount: entry.agentData.taskCount || 0,
							activeTasks: 0,
							lastSeen: entry.timestamp,
							registeredAt: entry.timestamp,
						},
					}

					this.agents.set(agentId, registryEntry)

					// Index by role
					if (!this.agentsByRole.has(identity.role)) {
						this.agentsByRole.set(identity.role, new Set())
					}
					this.agentsByRole.get(identity.role)!.add(agentId)
				}
			}
		} catch (error) {
			getLog().error("Failed to load agent registry from storage:", error)
		}
	}

	/**
	 * Register a new agent
	 */
	async registerAgent(identity: AgentIdentity): Promise<void> {
		const entry: AgentRegistryEntry = {
			identity,
			status: {
				status: "idle",
				currentTask: null,
				taskCount: 0,
				activeTasks: 0,
				lastSeen: Date.now(),
				registeredAt: Date.now(),
			},
		}

		this.agents.set(identity.id, entry)

		// Index by role
		if (!this.agentsByRole.has(identity.role)) {
			this.agentsByRole.set(identity.role, new Set())
		}
		this.agentsByRole.get(identity.role)!.add(identity.id)

		// Persist to storage
		if (this.storage) {
			await this.storage.recordAgentRegistration(identity.id, {
				name: identity.name,
				role: identity.role,
				capabilities: identity.capabilities,
				domain: identity.domain,
				available: true,
				taskCount: 0,
				createdAt: identity.createdAt.getTime(),
			})
		}
	}

	/**
	 * Unregister an agent
	 */
	async unregisterAgent(agentId: string): Promise<boolean> {
		const entry = this.agents.get(agentId)
		if (!entry) {
			return false
		}

		// Remove from role index
		const roleSet = this.agentsByRole.get(entry.identity.role)
		if (roleSet) {
			roleSet.delete(agentId)
		}

		this.agents.delete(agentId)

		// Persist to storage
		if (this.storage) {
			await this.storage.recordAgentDeregistration(agentId)
		}

		return true
	}

	/**
	 * Get agent by ID
	 */
	getAgent(agentId: string): AgentIdentity | undefined {
		return this.agents.get(agentId)?.identity
	}

	/**
	 * Get agent status
	 */
	getStatus(agentId: string): AgentRegistryStatus | undefined {
		return this.agents.get(agentId)?.status
	}

	/**
	 * Get full agent entry
	 */
	getEntry(agentId: string): AgentRegistryEntry | undefined {
		return this.agents.get(agentId)
	}

	/**
	 * Get all registered agents
	 */
	getAllAgents(): AgentIdentity[] {
		return Array.from(this.agents.values()).map((entry) => entry.identity)
	}

	/**
	 * Get all agent entries
	 */
	getAllEntries(): AgentRegistryEntry[] {
		return Array.from(this.agents.values())
	}

	/**
	 * Query agents by criteria
	 */
	queryAgents(query: RegistryQuery): AgentIdentity[] {
		let candidates = Array.from(this.agents.values())

		// Filter by role
		if (query.role) {
			candidates = candidates.filter((entry) => entry.identity.role === query.role)
		}

		// Filter by capabilities
		if (query.capabilities) {
			candidates = candidates.filter((entry) =>
				query.capabilities!.every((cap) => entry.identity.capabilities.includes(cap)),
			)
		}

		// Filter by status
		if (query.status) {
			candidates = candidates.filter((entry) => entry.status.status === query.status)
		}

		// Filter by availability
		if (query.available !== undefined) {
			candidates = candidates.filter((entry) => {
				const isAvailable = entry.status.status === "idle" && entry.status.activeTasks === 0
				return query.available === isAvailable
			})
		}

		return candidates.map((entry) => entry.identity)
	}

	/**
	 * Get agents by role
	 */
	getAgentsByRole(role: AgentRole): AgentIdentity[] {
		const agentIds = this.agentsByRole.get(role)
		if (!agentIds) {
			return []
		}

		return Array.from(agentIds)
			.map((id) => this.agents.get(id)?.identity)
			.filter((identity): identity is AgentIdentity => identity !== undefined)
	}

	/**
	 * Get available agents (idle with no active tasks)
	 */
	getAvailableAgents(): AgentIdentity[] {
		return this.queryAgents({ available: true })
	}

	/**
	 * Get busy agents
	 */
	getBusyAgents(): AgentIdentity[] {
		return this.queryAgents({ status: "busy" })
	}

	/**
	 * Update agent status
	 */
	async updateStatus(agentId: string, updates: Partial<AgentRegistryStatus>): Promise<boolean> {
		const entry = this.agents.get(agentId)
		if (!entry) {
			return false
		}

		entry.status = {
			...entry.status,
			...updates,
			lastSeen: Date.now(),
		}

		// Persist to storage
		if (this.storage) {
			await this.storage.recordAgentStatusUpdate(agentId, {
				name: entry.identity.name,
				role: entry.identity.role,
				capabilities: entry.identity.capabilities,
				domain: entry.identity.domain,
				available: entry.status.status === "idle",
				taskCount: entry.status.taskCount,
				createdAt: entry.identity.createdAt.getTime(),
			})
		}

		return true
	}

	/**
	 * Mark agent as busy with a task
	 */
	async markBusy(agentId: string, taskId: string): Promise<boolean> {
		return await this.updateStatus(agentId, {
			status: "busy",
			currentTask: taskId,
			activeTasks: (this.getStatus(agentId)?.activeTasks || 0) + 1,
		})
	}

	/**
	 * Mark agent as idle (completed task)
	 */
	async markIdle(agentId: string): Promise<boolean> {
		const status = this.getStatus(agentId)
		if (!status) {
			return false
		}

		return await this.updateStatus(agentId, {
			status: "idle",
			currentTask: null,
			taskCount: status.taskCount + 1,
			activeTasks: Math.max(0, status.activeTasks - 1),
		})
	}

	/**
	 * Mark agent as offline
	 */
	async markOffline(agentId: string): Promise<boolean> {
		return await this.updateStatus(agentId, {
			status: "offline",
		})
	}

	/**
	 * Update agent heartbeat
	 */
	async heartbeat(agentId: string): Promise<boolean> {
		return await this.updateStatus(agentId, {})
	}

	/**
	 * Check if agent exists
	 */
	hasAgent(agentId: string): boolean {
		return this.agents.has(agentId)
	}

	/**
	 * Get agent count
	 */
	getAgentCount(): number {
		return this.agents.size
	}

	/**
	 * Get statistics
	 */
	getStatistics(): {
		total: number
		idle: number
		busy: number
		offline: number
		byRole: Record<AgentRole, number>
	} {
		const entries = Array.from(this.agents.values())

		return {
			total: entries.length,
			idle: entries.filter((e) => e.status.status === "idle").length,
			busy: entries.filter((e) => e.status.status === "busy").length,
			offline: entries.filter((e) => e.status.status === "offline").length,
			byRole: {
				worker: this.agentsByRole.get("worker")?.size || 0,
				supervisor: this.agentsByRole.get("supervisor")?.size || 0,
				coordinator: this.agentsByRole.get("coordinator")?.size || 0,
			},
		}
	}

	/**
	 * Clear all agents (for testing)
	 */
	clear(): void {
		this.agents.clear()
		this.agentsByRole.clear()
	}
}
