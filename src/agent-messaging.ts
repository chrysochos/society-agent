// kilocode_change - new file
/**
 * Agent-to-Agent Messaging System
 *
 * Enables direct communication between agents in a society.
 * Supports request/response, broadcast, and notification patterns.
 */

import { AgentIdentity } from "./types"
import { SocietyAgentStorage } from "./storage"
import { getLog } from "./logger" // kilocode_change

/**
 * Generate a unique message ID
 */
function generateMessageId(): string {
	return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Types of messages agents can send to each other
 */
export type AgentMessageType = "request" | "response" | "broadcast" | "notification"

/**
 * Message sent between agents
 */
export interface AgentMessage {
	/** Type of message */
	type: AgentMessageType
	/** ID of the agent sending the message */
	fromAgentId: string
	/** ID of the target agent (undefined for broadcasts) */
	toAgentId?: string
	/** Unique message identifier */
	messageId: string
	/** Message payload - structure depends on message type */
	payload: any
	/** Timestamp when message was created */
	timestamp: number
	/** Optional correlation ID for request/response pairs */
	correlationId?: string
}

/**
 * Handler function for incoming messages
 */
export type MessageHandler = (message: AgentMessage) => void | Promise<void>

/**
 * Interface for the underlying communication channel
 * Can be implemented with WebSocket, IPC, or in-memory queue
 */
export interface MessageChannel {
	/** Send a message through the channel */
	send(message: AgentMessage): Promise<void>
	/** Register callback for incoming messages */
	onMessage(handler: MessageHandler): void
	/** Check if channel is connected */
	isConnected(): boolean
}

/**
 * Agent messaging system for inter-agent communication
 */
export class AgentMessaging {
	private messageHandlers = new Map<string, MessageHandler>()
	private pendingRequests = new Map<string, (response: any) => void>()
	private defaultHandler?: MessageHandler

	constructor(
		private agentId: string,
		private channel: MessageChannel,
	) {
		// Register channel message handler
		this.channel.onMessage((message) => this.handleIncomingMessage(message))
	}

	/**
	 * Send a message to a specific agent
	 */
	async sendToAgent(targetAgentId: string, payload: any): Promise<void> {
		if (!this.channel.isConnected()) {
			throw new Error("Message channel not connected")
		}

		const message: AgentMessage = {
			type: "request",
			fromAgentId: this.agentId,
			toAgentId: targetAgentId,
			messageId: generateMessageId(),
			payload,
			timestamp: Date.now(),
		}

		// Store message
		await AgentMessageStore.getInstance().storeMessage(message)

		await this.channel.send(message)
	}

	/**
	 * Send a request to an agent and wait for response
	 */
	async requestTask(targetAgentId: string, task: string, context?: any, timeoutMs: number = 60000): Promise<any> {
		if (!this.channel.isConnected()) {
			throw new Error("Message channel not connected")
		}

		const messageId = generateMessageId()
		const message: AgentMessage = {
			type: "request",
			fromAgentId: this.agentId,
			toAgentId: targetAgentId,
			messageId,
			payload: { task, context },
			timestamp: Date.now(),
		}

		// Wait for response
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pendingRequests.delete(messageId)
				reject(new Error(`Request to agent ${targetAgentId} timed out after ${timeoutMs}ms`))
			}, timeoutMs)

			this.pendingRequests.set(messageId, (response: any) => {
				clearTimeout(timeout)
				resolve(response)
			})

			// Store request message
			AgentMessageStore.getInstance().storeMessage(message).catch((err) => getLog().error("Failed to store message:", err))

			this.channel.send(message).catch((error) => {
				clearTimeout(timeout)
				this.pendingRequests.delete(messageId)
				reject(error)
			})
		})
	}

	/**
	 * Send a response to a previous request
	 */
	async respondToAgent(targetAgentId: string, correlationId: string, payload: any): Promise<void> {
		if (!this.channel.isConnected()) {
			throw new Error("Message channel not connected")
		}

		const message: AgentMessage = {
			type: "response",
			fromAgentId: this.agentId,
			toAgentId: targetAgentId,
			messageId: generateMessageId(),
			correlationId,
			payload,
			timestamp: Date.now(),
		}

		// Store response message
		await AgentMessageStore.getInstance().storeMessage(message)

		await this.channel.send(message)
	}

	/**
	 * Broadcast a message to all agents
	 */
	async broadcast(payload: any): Promise<void> {
		if (!this.channel.isConnected()) {
			throw new Error("Message channel not connected")
		}

		const message: AgentMessage = {
			type: "broadcast",
			fromAgentId: this.agentId,
			messageId: generateMessageId(),
			payload,
			timestamp: Date.now(),
		}

		// Store message
		await AgentMessageStore.getInstance().storeMessage(message)

		await this.channel.send(message)
	}

	/**
	 * Send a notification (fire-and-forget)
	 */
	async notify(targetAgentId: string, payload: any): Promise<void> {
		if (!this.channel.isConnected()) {
			throw new Error("Message channel not connected")
		}

		const message: AgentMessage = {
			type: "notification",
			fromAgentId: this.agentId,
			toAgentId: targetAgentId,
			messageId: generateMessageId(),
			payload,
			timestamp: Date.now(),
		}

		// Store message
		await AgentMessageStore.getInstance().storeMessage(message)

		await this.channel.send(message)
	}

	/**
	 * Register a handler for specific message types
	 */
	onMessageType(type: AgentMessageType, handler: MessageHandler): void {
		this.messageHandlers.set(type, handler)
	}

	/**
	 * Register default handler for all messages
	 */
	onMessage(handler: MessageHandler): void {
		this.defaultHandler = handler
	}

	/**
	 * Request a task from another agent and wait for completion (alias)
	 */
	async delegateTask(targetAgentId: string, task: string, context?: any): Promise<string> {
		const response = await this.requestTask(targetAgentId, task, context)

		if (response.error) {
			throw new Error(`Task delegation failed: ${response.error}`)
		}

		return response.result
	}

	/**
	 * Handle incoming messages
	 */
	private async handleIncomingMessage(message: AgentMessage): Promise<void> {
		try {
			// Handle responses to pending requests
			if (message.type === "response" && message.correlationId) {
				const resolver = this.pendingRequests.get(message.correlationId)
				if (resolver) {
					resolver(message.payload)
					this.pendingRequests.delete(message.correlationId)
					return
				}
			}

			// Try type-specific handler
			const typeHandler = this.messageHandlers.get(message.type)
			if (typeHandler) {
				await typeHandler(message)
				return
			}

			// Fall back to default handler
			if (this.defaultHandler) {
				await this.defaultHandler(message)
			}
		} catch (error) {
			getLog().error(`Error handling message ${message.messageId}:`, error)
		}
	}

	/**
	 * Clean up resources
	 */
	dispose(): void {
		this.messageHandlers.clear()
		this.pendingRequests.clear()
		this.defaultHandler = undefined
	}
}

/**
 * In-memory message channel for testing or single-process scenarios
 */
export class InMemoryMessageChannel implements MessageChannel {
	private static channels = new Map<string, InMemoryMessageChannel>()
	private handler?: MessageHandler

	constructor(private agentId: string) {
		InMemoryMessageChannel.channels.set(agentId, this)
	}

	async send(message: AgentMessage): Promise<void> {
		// Broadcast or targeted message
		if (message.type === "broadcast") {
			// Send to all agents except sender
			for (const [id, channel] of InMemoryMessageChannel.channels) {
				if (id !== this.agentId && channel.handler) {
					await channel.handler(message)
				}
			}
		} else if (message.toAgentId) {
			// Send to specific agent
			const targetChannel = InMemoryMessageChannel.channels.get(message.toAgentId)
			if (targetChannel?.handler) {
				await targetChannel.handler(message)
			}
		}
	}

	onMessage(handler: MessageHandler): void {
		this.handler = handler
	}

	isConnected(): boolean {
		return true
	}

	static dispose(agentId: string): void {
		InMemoryMessageChannel.channels.delete(agentId)
	}

	static disposeAll(): void {
		InMemoryMessageChannel.channels.clear()
	}
}

/**
 * Global message store for persistence
 * Singleton that stores all messages across all agents
 */
export class AgentMessageStore {
	private static instance: AgentMessageStore | undefined
	private storage: SocietyAgentStorage | null = null
	private messages: AgentMessage[] = []
	private initialized = false

	private constructor() {}

	static getInstance(): AgentMessageStore {
		if (!AgentMessageStore.instance) {
			AgentMessageStore.instance = new AgentMessageStore()
		}
		return AgentMessageStore.instance
	}

	static resetInstance(): void {
		AgentMessageStore.instance = undefined
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
	 * Load messages from persistent storage
	 */
	private async loadFromStorage(): Promise<void> {
		if (!this.storage) {
			return
		}

		try {
			const storedMessages = await this.storage.getMessages()

			// Convert stored format to AgentMessage format
			this.messages = storedMessages.map((entry) => ({
				type: entry.type,
				fromAgentId: entry.fromAgentId,
				toAgentId: entry.toAgentId,
				messageId: entry.messageId,
				payload: entry.payload,
				timestamp: entry.timestamp,
				correlationId: entry.correlationId,
			}))
		} catch (error) {
			getLog().error("Failed to load messages from storage:", error)
		}
	}

	/**
	 * Store a message
	 */
	async storeMessage(message: AgentMessage): Promise<void> {
		this.messages.push(message)

		// Persist to storage
		if (this.storage) {
			await this.storage.recordMessage({
				messageId: message.messageId,
				type: message.type,
				fromAgentId: message.fromAgentId,
				toAgentId: message.toAgentId,
				action: undefined, // Could extract from payload if needed
				payload: message.payload,
				correlationId: message.correlationId,
				priority: undefined, // Could extract from payload if needed
			})
		}
	}

	/**
	 * Get all messages
	 */
	getAllMessages(): AgentMessage[] {
		return [...this.messages]
	}

	/**
	 * Get messages by agent ID (sent or received)
	 */
	getMessagesByAgent(agentId: string): AgentMessage[] {
		return this.messages.filter((msg) => msg.fromAgentId === agentId || msg.toAgentId === agentId)
	}

	/**
	 * Get messages by correlation ID
	 */
	getMessagesByCorrelation(correlationId: string): AgentMessage[] {
		return this.messages.filter((msg) => msg.correlationId === correlationId)
	}

	/**
	 * Clear messages for a specific agent
	 */
	clearMessagesByAgent(agentId: string): void {
		this.messages = this.messages.filter((msg) => msg.fromAgentId !== agentId && msg.toAgentId !== agentId)
	}

	/**
	 * Clear all messages
	 */
	async clearAllMessages(): Promise<void> {
		this.messages = []
		if (this.storage) {
			await this.storage.clearMessages()
		}
	}
}
