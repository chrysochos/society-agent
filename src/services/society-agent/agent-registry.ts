// kilocode_change - new file
import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as path from "path"
import { v4 as uuidv4 } from "uuid"
import { AgentClient, AttachmentData } from "./agent-client"
import { InboxManager } from "./inbox-manager" // kilocode_change
import { MessageSecurity } from "./message-security" // kilocode_change

/**
 * Agent Registry - Manages agent discovery and lifecycle in multi-VS Code setup
 *
 * Hybrid coordination (file-based + network):
 * - registry.jsonl: Agent registrations with heartbeats and HTTP URLs
 * - messages.jsonl: Message queue (for offline delivery)
 * - deliveries.jsonl: Tracks which agent received which message
 *
 * Communication:
 * - Network: Fast path for online agents (HTTP)
 * - File: Fallback for offline agents (messages.jsonl)
 */

export interface AgentRegistration {
	agentId: string
	role:
		| "supervisor"
		| "backend-developer"
		| "frontend-developer"
		| "tester"
		| "devops"
		| "security-reviewer"
		| "custom"
	capabilities: string[]
	workspace: string
	vsCodePid: number
	url?: string // HTTP server URL (e.g., http://127.0.0.1:3000) - kilocode_change
	status: "online" | "offline" | "idle" | "busy"
	lastHeartbeat: string // ISO timestamp
	registered: string // ISO timestamp
}

export interface AgentMessage {
	id: string
	from: string
	to: string // agentId or "broadcast" or "supervisor"
	type: "task_assign" | "task_complete" | "message" | "question" | "status_update" | "shutdown"
	content: any
	timestamp: string
	delivered: boolean // false if recipient was offline when sent
	deliveredAt?: string // when message was actually delivered
}

export class AgentRegistry {
	private agentId: string
	private role: string
	private capabilities: string[]
	private sharedDir: string
	private workspace: string
	private serverUrl: string | undefined // kilocode_change - HTTP server URL
	private registryPath: string
	private messagesPath: string
	private heartbeatInterval: NodeJS.Timeout | undefined
	private messageWatcher: vscode.FileSystemWatcher | undefined
	private lastMessagePosition: number = 0
	private inboxManager?: InboxManager // kilocode_change
	private messageSecurity?: MessageSecurity // kilocode_change

	constructor(sharedDir: string, serverUrl?: string) {
		// kilocode_change - added serverUrl param
		this.sharedDir = sharedDir
		this.serverUrl = serverUrl // kilocode_change
		this.registryPath = path.join(sharedDir, "registry.jsonl")
		this.messagesPath = path.join(sharedDir, "messages.jsonl")
		this.workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || ""

		// Get or generate agent ID
		const config = vscode.workspace.getConfiguration("kilo-code")
		let configuredId = config.get<string>("societyAgent.agentId") || ""
		if (!configuredId) {
			// Auto-generate and save
			configuredId = this.generateAgentId()
			config.update("societyAgent.agentId", configuredId, vscode.ConfigurationTarget.Workspace)
		}
		this.agentId = configuredId

		// Get role and capabilities
		this.role = config.get<string>("societyAgent.role") || "custom"
		this.capabilities = config.get<string[]>("societyAgent.capabilities") || []

		// kilocode_change start - Initialize inbox and security
		const projectRoot = path.dirname(sharedDir)
		this.inboxManager = new InboxManager(projectRoot)
		this.messageSecurity = new MessageSecurity(projectRoot)
		// kilocode_change end
	}

	/**
	 * Generate unique agent ID based on role and random UUID
	 */
	private generateAgentId(): string {
		const shortUuid = uuidv4().split("-")[0]
		return `${this.role}-${shortUuid}`
	}

	/**
	 * Initialize agent: register, start heartbeat, watch messages
	 */
	async initialize(): Promise<void> {
		// Ensure shared directory exists
		await fs.mkdir(this.sharedDir, { recursive: true })

		// Register this agent
		await this.register()

		// Start heartbeat (updates status every 30 seconds)
		this.startHeartbeat()

		// Watch for new messages
		await this.startMessageWatcher()

		// kilocode_change start - Initialize inbox security
		if (this.inboxManager) {
			await this.inboxManager.initialize()
		}
		if (this.messageSecurity) {
			await this.messageSecurity.initialize()
		}
		// kilocode_change end

		console.log(`[AgentRegistry] Agent ${this.agentId} initialized`)
	}

	/**
	 * Register agent in shared registry
	 */
	private async register(): Promise<void> {
		const registration: AgentRegistration = {
			agentId: this.agentId,
			role: this.role as any,
			capabilities: this.capabilities,
			workspace: this.workspace,
			vsCodePid: process.pid,
			url: this.serverUrl, // kilocode_change - include HTTP server URL
			status: "idle",
			lastHeartbeat: new Date().toISOString(),
			registered: new Date().toISOString(),
		}

		// Append to registry (JSONL format)
		await this.appendJSONL(this.registryPath, registration)
	}

	/**
	 * Update agent status with heartbeat
	 */
	private async updateHeartbeat(status: "online" | "offline" | "idle" | "busy" = "idle"): Promise<void> {
		// kilocode_change - added "offline"
		const heartbeat = {
			agentId: this.agentId,
			url: this.serverUrl, // kilocode_change - include URL in heartbeat

			status: status,
			lastHeartbeat: new Date().toISOString(),
		}

		// Append heartbeat to registry
		await this.appendJSONL(this.registryPath, heartbeat)
	}

	/**
	 * Start periodic heartbeat (every 30 seconds)
	 */
	private startHeartbeat(): void {
		this.heartbeatInterval = setInterval(async () => {
			await this.updateHeartbeat("idle")
		}, 30000)
	}

	/**
	 * Watch messages.jsonl for new messages addressed to this agent
	 */
	private async startMessageWatcher(): Promise<void> {
		// Create messages file if doesn't exist
		try {
			await fs.access(this.messagesPath)
		} catch {
			await fs.writeFile(this.messagesPath, "")
		}

		// Get current file size to only process new messages
		const stats = await fs.stat(this.messagesPath)
		this.lastMessagePosition = stats.size

		// Watch for changes
		this.messageWatcher = vscode.workspace.createFileSystemWatcher(this.messagesPath)

		this.messageWatcher.onDidChange(async (uri) => {
			await this.processNewMessages()
		})
	}

	/**
	 * Process new messages added to messages.jsonl
	 * Only reads messages added since last check (using file position)
	 */
	private async processNewMessages(): Promise<void> {
		try {
			const stats = await fs.stat(this.messagesPath)
			const currentSize = stats.size

			if (currentSize <= this.lastMessagePosition) {
				return // No new data
			}

			// Read only new content
			const fileHandle = await fs.open(this.messagesPath, "r")
			const buffer = Buffer.alloc(currentSize - this.lastMessagePosition)
			await fileHandle.read(buffer, 0, buffer.length, this.lastMessagePosition)
			await fileHandle.close()

			const newContent = buffer.toString("utf-8")
			const lines = newContent.split("\n").filter((line) => line.trim())

			for (const line of lines) {
				try {
					const message: AgentMessage = JSON.parse(line)

					// Check if message is for this agent
					if (message.to === this.agentId || message.to === "broadcast") {
						await this.handleMessage(message)
					}
				} catch (err) {
					console.error("[AgentRegistry] Failed to parse message:", err)
				}
			}

			// Update position
			this.lastMessagePosition = currentSize
		} catch (err) {
			console.error("[AgentRegistry] Failed to process messages:", err)
		}
	}

	/**
	 * Handle incoming message
	 */
	private async handleMessage(message: AgentMessage): Promise<void> {
		console.log(`[AgentRegistry] Received message from ${message.from}:`, message.type)

		// Mark message as delivered if it wasn't already
		if (!message.delivered) {
			await this.markMessageDelivered(message.id)
		}

		// Emit event for other parts of the system to handle
		// TODO: Integrate with ConversationAgent or SocietyManager
		vscode.window.showInformationMessage(`Message from ${message.from}: ${message.type}`)
	}

	/**
	 * Mark message as delivered (for offline delivery tracking)
	 */
	private async markMessageDelivered(messageId: string): Promise<void> {
		const delivery = {
			messageId: messageId,
			deliveredTo: this.agentId,
			deliveredAt: new Date().toISOString(),
		}

		// Log delivery
		const deliveryPath = path.join(this.sharedDir, "deliveries.jsonl")
		await this.appendJSONL(deliveryPath, delivery)
	}

	/**
	 * Send message to another agent (or broadcast)
	 * Uses hybrid communication: tries network first, fallback to file
	 */
	async sendMessage(
		to: string,
		type: AgentMessage["type"],
		content: any,
		attachments?: AttachmentData[],
	): Promise<void> {
		// kilocode_change - added attachments param
		const message: AgentMessage = {
			id: uuidv4(),
			from: this.agentId,
			to: to,
			type: type,
			content: content,
			timestamp: new Date().toISOString(),
			delivered: false, // Will be marked true when recipient processes it
		}

		// kilocode_change start - hybrid communication
		// Try network first if recipient is online and has URL
		const agents = await this.getAgents()
		const recipient = agents.find((a) => a.agentId === to)

		if (recipient && recipient.url && (await this.isAgentOnlineNetwork(recipient.url))) {
			try {
				// Send via network
				if (attachments && attachments.length > 0) {
					await AgentClient.sendMessageWithAttachments(
						recipient.url,
						{
							from: this.agentId,
							to,
							type,
							content,
						},
						attachments,
					)
				} else {
					await AgentClient.sendMessage(recipient.url, {
						from: this.agentId,
						to,
						type,
						content,
					})
				}

				console.log(`[AgentRegistry] Sent message to ${to} via network:`, type)
				return // Success - no need for file fallback
			} catch (error) {
				console.warn(`[AgentRegistry] Network send failed, using file fallback:`, error)
				// Fall through to file-based delivery
			}
		}

		// File-based fallback (for offline agents or network failures)
		await this.appendJSONL(this.messagesPath, message)

		// kilocode_change start - Also write to inbox with signature
		if (this.inboxManager && this.messageSecurity) {
			try {
				// Sign the message
				const signature = await this.messageSecurity.signMessage(message, this.agentId)
				const signedMessage = { ...message, signature }

				// Queue in inbox
				await this.inboxManager.queueMessage(to, signedMessage)
				console.log(`[AgentRegistry] Sent signed message to ${to} via inbox:`, type)
			} catch (error) {
				console.error(`[AgentRegistry] Failed to queue inbox message:`, error)
			}
		} else {
			console.log(`[AgentRegistry] Sent message to ${to} via file (offline):`, type)
		}
		// kilocode_change end
	}

	/**
	 * Get all registered agents
	 */
	async getAgents(): Promise<AgentRegistration[]> {
		try {
			const content = await fs.readFile(this.registryPath, "utf-8")
			const lines = content.split("\n").filter((line) => line.trim())

			const agents = new Map<string, AgentRegistration>()

			// Process all lines, later entries update earlier ones
			for (const line of lines) {
				try {
					const entry = JSON.parse(line)
					if (entry.agentId) {
						if (agents.has(entry.agentId)) {
							// Update existing entry (heartbeat or status update)
							agents.set(entry.agentId, { ...agents.get(entry.agentId)!, ...entry })
						} else {
							// New registration
							agents.set(entry.agentId, entry as AgentRegistration)
						}
					}
				} catch {
					// Skip malformed lines
				}
			}

			return Array.from(agents.values())
		} catch {
			return []
		}
	}

	/**
	 * Get online agents (heartbeat within last 2 minutes)
	 */
	async getOnlineAgents(): Promise<AgentRegistration[]> {
		const allAgents = await this.getAgents()
		const twoMinutesAgo = Date.now() - 2 * 60 * 1000

		return allAgents.filter((agent) => {
			const lastHeartbeat = new Date(agent.lastHeartbeat).getTime()
			return lastHeartbeat > twoMinutesAgo
		})
	}

	/**
	 * Get undelivered messages for this agent (agent was offline when sent)
	 */
	async getUndeliveredMessages(): Promise<AgentMessage[]> {
		try {
			// Read all messages
			const messagesContent = await fs.readFile(this.messagesPath, "utf-8")
			const messageLines = messagesContent.split("\n").filter((line) => line.trim())

			// Read all deliveries
			const deliveryPath = path.join(this.sharedDir, "deliveries.jsonl")
			let deliveredIds = new Set<string>()
			try {
				const deliveryContent = await fs.readFile(deliveryPath, "utf-8")
				const deliveryLines = deliveryContent.split("\n").filter((line) => line.trim())
				for (const line of deliveryLines) {
					const delivery = JSON.parse(line)
					if (delivery.deliveredTo === this.agentId) {
						deliveredIds.add(delivery.messageId)
					}
				}
			} catch {
				// No deliveries file yet
			}

			// Find messages for this agent that haven't been delivered
			const undelivered: AgentMessage[] = []
			for (const line of messageLines) {
				try {
					const message: AgentMessage = JSON.parse(line)
					if ((message.to === this.agentId || message.to === "broadcast") && !deliveredIds.has(message.id)) {
						undelivered.push(message)
					}
				} catch {
					// Skip malformed
				}
			}

			return undelivered
		} catch {
			return []
		}
	}

	/**
	 * "Wake up and catch up" - Process all missed messages since agent was offline
	 */
	async catchUp(): Promise<void> {
		console.log(`[AgentRegistry] Agent ${this.agentId} catching up on missed messages...`)

		const undelivered = await this.getUndeliveredMessages()
		console.log(`[AgentRegistry] Found ${undelivered.length} undelivered messages`)

		for (const message of undelivered) {
			await this.handleMessage(message)
		}

		console.log(`[AgentRegistry] Catch-up complete`)
	}

	/**
	 * Cleanup: unregister, stop heartbeat, stop watchers
	 */
	async dispose(): Promise<void> {
		// Stop heartbeat
		if (this.heartbeatInterval) {
			clearInterval(this.heartbeatInterval)
		}

		// Stop message watcher
		if (this.messageWatcher) {
			this.messageWatcher.dispose()
		}

		// Mark as offline
		await this.updateHeartbeat("offline")

		console.log(`[AgentRegistry] Agent ${this.agentId} disposed`)
	}

	/**
	 * Append line to JSONL file
	 */
	private async appendJSONL(filePath: string, data: any): Promise<void> {
		const line = JSON.stringify(data) + "\n"
		await fs.appendFile(filePath, line, "utf-8")
	}

	// Getters
	getAgentId(): string {
		return this.agentId
	}

	getRole(): string {
		return this.role
	}

	getCapabilities(): string[] {
		return this.capabilities
	}

	// kilocode_change start - helper methods for network communication
	/**
	 * Check if agent is online via network
	 */
	private async isAgentOnlineNetwork(url: string): Promise<boolean> {
		try {
			return await AgentClient.checkStatus(url, 2000)
		} catch {
			return false
		}
	}

	/**
	 * Mark message as delivered
	 */
	async markDelivered(messageId: string): Promise<void> {
		try {
			// Read all messages
			const content = await fs.readFile(this.messagesPath, "utf-8")
			const lines = content.trim().split("\n").filter(Boolean)
			const updated: string[] = []

			for (const line of lines) {
				const message = JSON.parse(line) as AgentMessage
				if (message.id === messageId) {
					message.delivered = true
					message.deliveredAt = new Date().toISOString()
				}
				updated.push(JSON.stringify(message))
			}

			await fs.writeFile(this.messagesPath, updated.join("\n") + "\n", "utf-8")

			// Record delivery
			const deliveryPath = path.join(this.sharedDir, "deliveries.jsonl")
			const delivery = {
				messageId,
				agentId: this.agentId,
				deliveredAt: new Date().toISOString(),
			}
			await fs.appendFile(deliveryPath, JSON.stringify(delivery) + "\n", "utf-8")
		} catch (error) {
			console.error("[AgentRegistry] Error marking message as delivered:", error)
		}
	}
	// kilocode_change end
}
