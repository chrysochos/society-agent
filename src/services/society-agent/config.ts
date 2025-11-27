// kilocode_change - new file
/**
 * Society Agent Configuration
 * 
 * Default configuration and utilities for Society Agent framework.
 */

import type { SocietyAgentConfig, AgentRole, AgentCapability } from './types'

/**
 * Default Society Agent configuration
 */
export const defaultConfig: SocietyAgentConfig = {
	enabled: false, // Disabled by default, must be explicitly enabled
	defaultRole: 'worker',
	defaultCapabilities: [
		'file-read',
		'code-analysis',
	],
	requireApproval: true,
	alwaysRequireApproval: [
		'file-delete',
		'shell-execute',
		'git-operations',
	],
	enableMessaging: true,
	enableDelegation: true,
	logAllActions: true,
	logDirectory: '.society-agent/logs',
}

/**
 * Supervisor agent default capabilities
 */
export const supervisorCapabilities: AgentCapability[] = [
	'file-read',
	'file-write',
	'code-analysis',
	'agent-messaging',
	'task-delegation',
	'approval-grant',
]

/**
 * Coordinator agent default capabilities
 */
export const coordinatorCapabilities: AgentCapability[] = [
	'file-read',
	'code-analysis',
	'agent-messaging',
	'task-delegation',
]

/**
 * High-risk operations that should always require approval
 */
export const highRiskOperations = [
	'file-delete',
	'shell-execute',
	'git-operations',
	'api-request',
] as const

/**
 * Get default capabilities for a given role
 */
export function getDefaultCapabilitiesForRole(role: AgentRole): AgentCapability[] {
	switch (role) {
		case 'supervisor':
			return supervisorCapabilities
		case 'coordinator':
			return coordinatorCapabilities
		case 'worker':
		default:
			return defaultConfig.defaultCapabilities
	}
}

/**
 * Validate agent capabilities
 */
export function validateCapabilities(capabilities: string[]): AgentCapability[] {
	const validCapabilities: AgentCapability[] = [
		'file-read',
		'file-write',
		'file-delete',
		'shell-execute',
		'browser-control',
		'api-request',
		'code-analysis',
		'test-execution',
		'git-operations',
		'agent-messaging',
		'task-delegation',
		'approval-grant',
	]

	const validated: AgentCapability[] = []
	for (const cap of capabilities) {
		if (validCapabilities.includes(cap as AgentCapability)) {
			validated.push(cap as AgentCapability)
		} else {
			console.warn(`[Society Agent] Invalid capability: ${cap}`)
		}
	}

	return validated
}

/**
 * Check if capability requires approval
 */
export function requiresApproval(
	capability: AgentCapability,
	config: SocietyAgentConfig = defaultConfig
): boolean {
	if (!config.requireApproval) {
		return false
	}

	return config.alwaysRequireApproval.includes(capability) || 
		   highRiskOperations.includes(capability as typeof highRiskOperations[number])
}

/**
 * Validate agent role
 */
export function validateRole(role: string): AgentRole {
	const validRoles: AgentRole[] = ['worker', 'supervisor', 'coordinator']
	
	if (validRoles.includes(role as AgentRole)) {
		return role as AgentRole
	}

	console.warn(`[Society Agent (SA)] Invalid role: ${role}, defaulting to 'worker'`)
	return 'worker'
}

/**
 * Merge custom config with defaults
 */
export function mergeConfig(custom: Partial<SocietyAgentConfig>): SocietyAgentConfig {
	return {
		...defaultConfig,
		...custom,
	}
}
