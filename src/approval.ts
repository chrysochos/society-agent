// Society Agent - new file
/**
 * Approval system for Society Agent high-risk operation workflows
 */

import type { AgentIdentity, AgentCapability } from "./types"
import { requiresApproval } from "./config"
import type { SupervisorChannel } from "./supervisor-channel" // Society Agent
import { SocietyAgentStorage } from "./storage"

/**
 * Approval request for a risky operation
 */
export interface ApprovalRequest {
	/** Unique identifier for this approval request */
	id: string

	/** Agent requesting approval */
	agentId: string

	/** Tool/operation being requested */
	tool: string

	/** Parameters for the operation */
	parameters: any

	/** Additional context (file paths, reason, etc.) */
	context?: {
		filePath?: string
		command?: string
		reason?: string
		[key: string]: any
	}

	/** When the request was made */
	timestamp: number

	/** Timeout in milliseconds (optional) */
	timeout?: number
}

/**
 * Response to an approval request
 */
export interface ApprovalResponse {
	/** Whether the operation was approved */
	approved: boolean

	/** Reason for approval or denial */
	reason?: string

	/** Who approved/denied (supervisor ID or 'user') */
	supervisorId: string

	/** When the response was given */
	timestamp: number
}

/**
 * Approval result with additional metadata
 */
export interface ApprovalResult extends ApprovalResponse {
	/** Original request */
	request: ApprovalRequest

	/** How long the approval took (ms) */
	duration: number
}

/**
 * Callback for displaying approval UI to user
 */
export type ApprovalUICallback = (request: ApprovalRequest) => Promise<boolean>

/**
 * Manager for approval workflows
 */
export class ApprovalManager {
	private static instance: ApprovalManager | undefined
	private pendingRequests = new Map<string, ApprovalRequest>()
	private approvalHistory: ApprovalResult[] = []
	private approvalUICallback?: ApprovalUICallback
	private supervisorChannel?: SupervisorChannel // Society Agent - typed properly for Phase 4
	private storage: SocietyAgentStorage | null = null
	private initialized = false

	private constructor() {}

	/**
	 * Get the singleton instance
	 */
	static getInstance(): ApprovalManager {
		if (!ApprovalManager.instance) {
			ApprovalManager.instance = new ApprovalManager()
		}
		return ApprovalManager.instance
	}

	/**
	 * Reset the singleton (for testing)
	 */
	static resetInstance(): void {
		ApprovalManager.instance = undefined
	}

	/**
	 * Initialize with storage
	 */
	async initialize(storage: SocietyAgentStorage): Promise<void> {
		if (this.initialized) {
			return
		}

		this.storage = storage
		// Load approval history from storage if needed
		this.initialized = true
	}

	/**
	 * Set the approval UI callback (for user prompts)
	 */
	setApprovalUICallback(callback: ApprovalUICallback): void {
		this.approvalUICallback = callback
	}

	/**
	 * Set the supervisor communication channel
	 */
	setSupervisorChannel(channel: SupervisorChannel): void {
		// Society Agent - typed properly
		this.supervisorChannel = channel
	}

	/**
	 * Request approval for a risky operation
	 */
	async requestApproval(request: ApprovalRequest): Promise<ApprovalResult> {
		const startTime = Date.now()

		// Add to pending requests
		this.pendingRequests.set(request.id, request)

		try {
			let response: ApprovalResponse

			// Try supervisor channel first if available
			if (this.supervisorChannel) {
				response = await this.requestSupervisorApproval(request)
			}
			// Fall back to user approval
			else if (this.approvalUICallback) {
				response = await this.requestUserApproval(request)
			}
			// No approval mechanism available - deny by default
			else {
				response = {
					approved: false,
					reason: "No approval mechanism available",
					supervisorId: "system",
					timestamp: Date.now(),
				}
			}

			const duration = Date.now() - startTime
			const result: ApprovalResult = {
				...response,
				request,
				duration,
			}

			// Add to history
			this.approvalHistory.push(result)

			// Persist to storage
			if (this.storage) {
				await this.storage.recordApproval({
					agentId: request.agentId,
					tool: request.tool,
					params: request.parameters,
					decision: response.approved ? "approved" : "denied",
					approvedBy: response.supervisorId,
					reason: response.reason,
					autoApproved: false, // Could track this if we add auto-approval
				})
			}

			return result
		} finally {
			// Remove from pending
			this.pendingRequests.delete(request.id)
		}
	}

	/**
	 * Request approval from supervisor agent
	 */
	private async requestSupervisorApproval(request: ApprovalRequest): Promise<ApprovalResponse> {
		// Society Agent start - Phase 4 implementation
		if (!this.supervisorChannel) {
			throw new Error("Supervisor channel not configured")
		}

		if (!this.supervisorChannel.isConnected()) {
			// Try to connect
			await this.supervisorChannel.connect()
		}

		try {
			// Request approval through supervisor channel
			const response = await this.supervisorChannel.requestApproval(request)
			return response
		} catch (error) {
			// If supervisor communication fails, return denial
			return {
				approved: false,
				reason: `Supervisor communication failed: ${error instanceof Error ? error.message : String(error)}`,
				supervisorId: this.supervisorChannel.getSupervisorId() || "unknown",
				timestamp: Date.now(),
			}
		}
		// Society Agent end
	}

	/**
	 * Request approval from user via UI
	 */
	private async requestUserApproval(request: ApprovalRequest): Promise<ApprovalResponse> {
		if (!this.approvalUICallback) {
			return {
				approved: false,
				reason: "No approval UI callback set",
				supervisorId: "system",
				timestamp: Date.now(),
			}
		}

		try {
			// Call the UI callback (will be integrated with Task.ask() in implementation)
			const approved = await this.approvalUICallback(request)

			return {
				approved,
				reason: approved ? "User approved" : "User denied",
				supervisorId: "user",
				timestamp: Date.now(),
			}
		} catch (error) {
			return {
				approved: false,
				reason: `Approval request failed: ${error instanceof Error ? error.message : String(error)}`,
				supervisorId: "system",
				timestamp: Date.now(),
			}
		}
	}

	/**
	 * Check if a tool/capability requires approval
	 */
	requiresApproval(capability: AgentCapability): boolean {
		// Use the config function with default config
		return requiresApproval(capability) // Society Agent - use default config
	}

	/**
	 * Check if a tool requires approval based on its name
	 */
	toolRequiresApproval(toolName: string): boolean {
		// High-risk tools that always require approval
		const highRiskTools = [
			"delete_file",
			"execute_command",
			"new_task", // Git operations
			"condense", // Git operations
		]

		return highRiskTools.includes(toolName)
	}

	/**
	 * Get pending approval requests
	 */
	getPendingRequests(): ApprovalRequest[] {
		return Array.from(this.pendingRequests.values())
	}

	/**
	 * Get approval history
	 */
	getApprovalHistory(limit?: number): ApprovalResult[] {
		const history = [...this.approvalHistory].reverse() // Most recent first
		return limit ? history.slice(0, limit) : history
	}

	/**
	 * Clear approval history
	 */
	clearHistory(): void {
		this.approvalHistory = []
	}

	/**
	 * Format an approval request for display
	 */
	formatApprovalRequest(request: ApprovalRequest): string {
		const lines = [
			`Approval Request: ${request.tool}`,
			`Agent: ${request.agentId}`,
			`Timestamp: ${new Date(request.timestamp).toLocaleString()}`,
		]

		if (request.context?.filePath) {
			lines.push(`File: ${request.context.filePath}`)
		}

		if (request.context?.command) {
			lines.push(`Command: ${request.context.command}`)
		}

		if (request.context?.reason) {
			lines.push(`Reason: ${request.context.reason}`)
		}

		if (request.parameters) {
			lines.push(`Parameters: ${JSON.stringify(request.parameters, null, 2)}`)
		}

		return lines.join("\n")
	}
}

/**
 * Get or create the global approval manager
 */
export function getApprovalManager(): ApprovalManager {
	return ApprovalManager.getInstance()
}

/**
 * Reset the global approval manager (useful for testing)
 */
export function resetApprovalManager(): void {
	ApprovalManager.resetInstance()
}
