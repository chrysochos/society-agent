// kilocode_change - new file
/**
 * Agent Identity Service for CLI
 * 
 * Manages agent identity for Society Agent framework in CLI mode.
 */

import { randomUUID } from 'crypto'
import type { AgentIdentity, AgentRole, AgentCapability } from '../../../src/services/society-agent/types'
import { getDefaultCapabilitiesForRole, validateRole, validateCapabilities } from '../../../src/services/society-agent/config'

/**
 * CLI Agent Identity Manager
 */
export class AgentIdentityService {
	private identity: AgentIdentity | null = null

	/**
	 * Initialize agent identity from CLI options
	 */
	initialize(options: {
		agentId?: string
		agentName?: string
		role?: string
		capabilities?: string[]
		domain?: string
	}): AgentIdentity {
		// Validate role
		const role: AgentRole = options.role ? validateRole(options.role) : 'worker'

		// Get capabilities - use provided or defaults for role
		let capabilities: AgentCapability[]
		if (options.capabilities && options.capabilities.length > 0) {
			capabilities = validateCapabilities(options.capabilities)
		} else {
			capabilities = getDefaultCapabilitiesForRole(role)
		}

		// Create identity
		this.identity = {
			id: options.agentId || `agent-${randomUUID()}`,
			name: options.agentName || `Agent-${Date.now()}`,
			role,
			capabilities,
			...(options.domain && { domain: options.domain }),
			createdAt: new Date(),
		}

		return this.identity!
	}

	/**
	 * Get current agent identity
	 */
	getIdentity(): AgentIdentity | null {
		return this.identity
	}

	/**
	 * Check if identity is initialized
	 */
	isInitialized(): boolean {
		return this.identity !== null
	}

	/**
	 * Check if agent has a specific capability
	 */
	hasCapability(capability: AgentCapability): boolean {
		return this.identity?.capabilities.includes(capability) ?? false
	}

	/**
	 * Get agent ID
	 */
	getAgentId(): string | null {
		return this.identity?.id ?? null
	}

	/**
	 * Get agent role
	 */
	getRole(): AgentRole | null {
		return this.identity?.role ?? null
	}

	/**
	 * Check if agent is supervisor
	 */
	isSupervisor(): boolean {
		return this.identity?.role === 'supervisor'
	}

	/**
	 * Check if agent is coordinator
	 */
	isCoordinator(): boolean {
		return this.identity?.role === 'coordinator'
	}

	/**
	 * Export identity for passing to extension
	 */
	export(): AgentIdentity | null {
		return this.identity
	}
}

// Singleton instance
let identityService: AgentIdentityService | null = null

/**
 * Get or create identity service instance
 */
export function getIdentityService(): AgentIdentityService {
	if (!identityService) {
		identityService = new AgentIdentityService()
	}
	return identityService
}

/**
 * Initialize agent identity from CLI options
 */
export function initializeAgentIdentity(options: {
	agentId?: string
	agentName?: string
	role?: string
	capabilities?: string[]
	domain?: string
}): AgentIdentity {
	const service = getIdentityService()
	return service.initialize(options)
}
