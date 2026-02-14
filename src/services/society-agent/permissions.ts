// kilocode_change - new file
/**
 * Permission system for Society Agent capability-based access control
 */

import type { AgentIdentity, AgentCapability } from "./types"

/**
 * Maps tool names to required capabilities
 */
export interface ToolCapabilityMap {
	[toolName: string]: AgentCapability[]
}

/**
 * Default mapping of tools to required capabilities
 */
export const defaultToolCapabilityMap: ToolCapabilityMap = {
	// File operations
	read_file: ["file-read"],
	write_to_file: ["file-write"],
	apply_diff: ["file-write"],
	edit_file: ["file-write"],
	insert_content: ["file-write"],
	delete_file: ["file-delete"],
	list_files: ["file-read"],
	search_files: ["file-read"],

	// Code operations
	list_code_definition_names: ["code-analysis"],
	codebase_search: ["code-analysis"],

	// Testing
	update_todo_list: ["test-execution"],

	// Shell/execution
	execute_command: ["shell-execute"],

	// Browser
	browser_action: ["browser-control"],

	// API
	fetch_instructions: ["api-request"],

	// Git operations
	new_task: ["git-operations"], // May involve branching
	condense: ["git-operations"], // May involve checkpoints

	// MCP tools (using api-request as placeholder until mcp-tool capability is added)
	use_mcp_tool: ["api-request"],
	access_mcp_resource: ["api-request"],

	// Safe operations (no capability required, available to all)
	ask_followup_question: [],
	attempt_completion: [],
	switch_mode: [],
	new_rule: ["file-write"], // Creates .kilocode/rules files
	report_bug: [],
	run_slash_command: [], // Depends on command
	generate_image: ["file-write"],
}

/**
 * Permission checker for capability-based access control
 */
export class PermissionChecker {
	private capabilityMap: ToolCapabilityMap

	constructor(customMap?: ToolCapabilityMap) {
		this.capabilityMap = customMap || defaultToolCapabilityMap
	}

	/**
	 * Check if an agent has permission to use a specific tool
	 */
	canAgentUseTool(agent: AgentIdentity, toolName: string): boolean {
		const requiredCapabilities = this.capabilityMap[toolName]

		// If tool not in map, deny by default (fail-safe)
		if (!requiredCapabilities) {
			console.warn(`[PermissionChecker] Unknown tool: ${toolName}, denying access`)
			return false
		}

		// If no capabilities required, allow (safe tools)
		if (requiredCapabilities.length === 0) {
			return true
		}

		// Check if agent has all required capabilities
		return requiredCapabilities.every((cap) => agent.capabilities.includes(cap))
	}

	/**
	 * Get list of tools an agent is allowed to use
	 */
	getToolsForAgent(agent: AgentIdentity): string[] {
		return Object.keys(this.capabilityMap).filter((tool) => this.canAgentUseTool(agent, tool))
	}

	/**
	 * Get required capabilities for a tool
	 */
	getRequiredCapabilities(toolName: string): AgentCapability[] {
		return this.capabilityMap[toolName] || []
	}

	/**
	 * Get missing capabilities for an agent to use a tool
	 */
	getMissingCapabilities(agent: AgentIdentity, toolName: string): AgentCapability[] {
		const required = this.getRequiredCapabilities(toolName)
		return required.filter((cap) => !agent.capabilities.includes(cap))
	}

	/**
	 * Format permission denial message
	 */
	formatPermissionDeniedMessage(agent: AgentIdentity, toolName: string): string {
		const missing = this.getMissingCapabilities(agent, toolName)

		if (missing.length === 0) {
			return `Agent ${agent.name} (${agent.id}) is not authorized to use tool: ${toolName}`
		}

		return (
			`Agent ${agent.name} (${agent.id}) lacks required capabilities to use ${toolName}:\n` +
			`Missing: ${missing.join(", ")}\n` +
			`Current capabilities: ${agent.capabilities.join(", ")}`
		)
	}

	/**
	 * Add a custom tool-capability mapping
	 */
	addToolMapping(toolName: string, capabilities: AgentCapability[]): void {
		this.capabilityMap[toolName] = capabilities
	}

	/**
	 * Update the entire capability map
	 */
	updateCapabilityMap(newMap: ToolCapabilityMap): void {
		this.capabilityMap = { ...this.capabilityMap, ...newMap }
	}
}

/**
 * Singleton permission checker instance
 */
let globalPermissionChecker: PermissionChecker | null = null

/**
 * Get or create the global permission checker
 */
export function getPermissionChecker(): PermissionChecker {
	if (!globalPermissionChecker) {
		globalPermissionChecker = new PermissionChecker()
	}
	return globalPermissionChecker
}

/**
 * Reset the global permission checker (useful for testing)
 */
export function resetPermissionChecker(): void {
	globalPermissionChecker = null
}
