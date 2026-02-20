// Society Agent - new file
/**
 * Supervisor communication channel (Phase 4)
 *
 * Enables worker agents to communicate with supervisor agents for:
 * - Approval requests
 * - Status updates
 * - Task delegation
 * - Error reporting
 */

import type { AgentIdentity } from "./types"
import type { ApprovalRequest, ApprovalResponse } from "./approval"
import { getLog } from "./logger"

/**
 * Message types for supervisor communication
 */
export type SupervisorMessageType =
	| "approval_request"
	| "approval_response"
	| "interrupt"
	| "status_update"
	| "log"
	| "delegate_task"
	| "task_result"

/**
 * Message structure for supervisor communication
 */
export interface SupervisorMessage {
	/** Message type */
	type: SupervisorMessageType

	/** Sender agent ID */
	fromAgentId: string

	/** Recipient agent ID (optional for broadcasts) */
	toAgentId?: string

	/** Message payload */
	data: any

	/** When the message was sent */
	timestamp: number

	/** Message ID for tracking responses */
	messageId?: string

	/** ID of message being responded to */
	inReplyTo?: string
}

/**
 * Message handler callback
 */
type MessageHandler = (message: SupervisorMessage) => void

/**
 * Supervisor communication channel (Phase 4)
 *
 * Uses callback-based messaging for in-process communication.
 * Can be extended to use WebSocket/IPC for multi-process supervision.
 */
export class SupervisorChannel {
	private agentId: string
	private supervisorId?: string
	private messageQueue: SupervisorMessage[] = []
	private pendingRequests = new Map<string, (response: any) => void>()
	protected connected: boolean = false
	private requestTimeout: number = 30000 // 30 seconds
	private messageHandlers: MessageHandler[] = []

	constructor(agentId: string, supervisorId?: string) {
		this.agentId = agentId
		this.supervisorId = supervisorId
	}

	/**
	 * Register a message handler
	 */
	onMessage(handler: MessageHandler): void {
		this.messageHandlers.push(handler)
	}

	/**
	 * Generate unique message ID
	 */
	private generateMessageId(): string {
		return `${this.agentId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
	}

	/**
	 * Notify all message handlers
	 */
	private notifyHandlers(message: SupervisorMessage): void {
		for (const handler of this.messageHandlers) {
			try {
				handler(message)
			} catch (error) {
				getLog().error("Error in message handler:", error)
			}
		}
	}

	/**
	 * Connect to supervisor
	 */
	async connect(): Promise<void> {
		if (this.connected) {
			return
		}

		// In-process: mark as connected immediately
		// For multi-process: would establish WebSocket/IPC connection here
		this.connected = true

		// Notify connection
		this.notifyHandlers({
			type: "status_update",
			fromAgentId: this.agentId,
			toAgentId: this.supervisorId,
			data: { status: "connected" },
			timestamp: Date.now(),
		})

		// Process queued messages
		while (this.messageQueue.length > 0) {
			const message = this.messageQueue.shift()
			if (message) {
				await this.sendMessage(message)
			}
		}
	}

	/**
	 * Disconnect from supervisor
	 */
	async disconnect(): Promise<void> {
		if (!this.connected) {
			return
		}

		this.connected = false

		// Notify disconnection
		this.notifyHandlers({
			type: "status_update",
			fromAgentId: this.agentId,
			toAgentId: this.supervisorId,
			data: { status: "disconnected" },
			timestamp: Date.now(),
		})

		// Clear pending requests
		for (const [messageId, resolver] of this.pendingRequests.entries()) {
			resolver({ error: "Channel disconnected" })
		}
		this.pendingRequests.clear()
	}

	/**
	 * Send message to supervisor
	 */
	async sendMessage(message: SupervisorMessage): Promise<void> {
		if (!this.connected) {
			// Queue message for when connected
			this.messageQueue.push(message)
			return
		}

		// Notify message handlers
		this.notifyHandlers(message)
	}

	/**
	 * Handle incoming response from supervisor
	 */
	handleResponse(message: SupervisorMessage): void {
		if (message.type !== "approval_response" || !message.inReplyTo) {
			return
		}

		const resolver = this.pendingRequests.get(message.inReplyTo)
		if (resolver) {
			this.pendingRequests.delete(message.inReplyTo)
			resolver(message.data as ApprovalResponse)
		}
	}

	/**
	 * Request approval from supervisor
	 */
	async requestApproval(request: ApprovalRequest): Promise<ApprovalResponse> {
		const messageId = this.generateMessageId()

		const message: SupervisorMessage = {
			type: "approval_request",
			fromAgentId: this.agentId,
			toAgentId: this.supervisorId,
			data: request,
			timestamp: Date.now(),
			messageId,
		}

		// Send request
		await this.sendMessage(message)

		// Wait for response with timeout
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pendingRequests.delete(messageId)
				reject(new Error(`Approval request timed out after ${this.requestTimeout}ms`))
			}, this.requestTimeout)

			this.pendingRequests.set(messageId, (response: ApprovalResponse) => {
				clearTimeout(timeout)
				resolve(response)
			})
		})
	}

	/**
	 * Check if connected to supervisor
	 */
	isConnected(): boolean {
		return this.connected
	}

	/**
	 * Get supervisor ID
	 */
	getSupervisorId(): string | undefined {
		return this.supervisorId
	}
}

/**
 * Mock supervisor channel for testing (Phase 3)
 *
 * Simulates supervisor responses for testing approval workflows.
 */
export class MockSupervisorChannel extends SupervisorChannel {
	private autoApprove: boolean

	constructor(agentId: string, autoApprove: boolean = true) {
		super(agentId, "mock-supervisor")
		this.autoApprove = autoApprove
	}

	/**
	 * Mock connection (always succeeds)
	 */
	override async connect(): Promise<void> {
		this.connected = true
	}

	/**
	 * Mock disconnection
	 */
	override async disconnect(): Promise<void> {
		this.connected = false
	}

	/**
	 * Mock message sending (logs to console)
	 */
	override async sendMessage(message: SupervisorMessage): Promise<void> {
		getLog().info("Message sent:", message)
	}

	/**
	 * Mock approval request (auto-approves or auto-denies based on configuration)
	 */
	override async requestApproval(request: ApprovalRequest): Promise<ApprovalResponse> {
		getLog().info("Approval request:", request)

		// Simulate processing delay
		await new Promise((resolve) => setTimeout(resolve, 100))

		return {
			approved: this.autoApprove,
			reason: this.autoApprove ? "Auto-approved by mock supervisor" : "Auto-denied by mock supervisor",
			supervisorId: "mock-supervisor",
			timestamp: Date.now(),
		}
	}

	/**
	 * Set auto-approve behavior
	 */
	setAutoApprove(autoApprove: boolean): void {
		this.autoApprove = autoApprove
	}
}

/**
 * Create a mock supervisor channel for testing
 */
export function createMockSupervisorChannel(agentId: string, autoApprove: boolean = true): MockSupervisorChannel {
	return new MockSupervisorChannel(agentId, autoApprove)
}
