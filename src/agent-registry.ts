// Society Agent - new file
import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as path from "path"
import { v4 as uuidv4 } from "uuid"
import { AgentClient, AttachmentData } from "./agent-client"
import { InboxManager } from "./inbox-manager" // Society Agent
import { MessageSecurity } from "./message-security" // Society Agent
import { getLog } from "./logger"

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
	url?: string // HTTP server URL (e.g., http://127.0.0.1:3000) - Society Agent
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
	private serverUrl: string | undefined // Society Agent - HTTP server URL
	private registryPath: string
	private messagesPath: string
	private heartbeatInterval: NodeJS.Timeout | undefined
	private messageWatcher: vscode.FileSystemWatcher | undefined
	private lastMessagePosition: number = 0
	private inboxManager?: InboxManager // Society Agent
	private messageSecurity?: MessageSecurity // Society Agent
	// Society Agent start - Cached agents for synchronous monitor access
	private cachedAgents: AgentRegistration[] = []
	private cacheRefreshInterval: NodeJS.Timeout | undefined
	// Society Agent end
	// Society Agent start - External message handler callback
	private onMessageCallback?: (message: AgentMessage) => Promise<void>
	// Society Agent end

	constructor(sharedDir: string, serverUrl?: string) {
		// Society Agent - added serverUrl param
		this.sharedDir = sharedDir
		this.serverUrl = serverUrl // Society Agent
		this.registryPath = path.join(sharedDir, "registry.jsonl")
		this.messagesPath = path.join(sharedDir, "messages.jsonl")
		this.workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || ""

		// Get or generate agent ID
		const config = vscode.workspace.getConfiguration("society-agent")
		let configuredId = config.get<string>("agentId") || ""
		if (!configuredId) {
			// Auto-generate and save
			configuredId = this.generateAgentId()
			config.update("societyAgent.agentId", configuredId, vscode.ConfigurationTarget.Workspace)
		}
		this.agentId = configuredId

		// Get role and capabilities
		this.role = config.get<string>("societyAgent.role") || "custom"
		this.capabilities = config.get<string[]>("societyAgent.capabilities") || []

		// Society Agent start - Initialize inbox and security
		const projectRoot = path.dirname(sharedDir)
		this.inboxManager = new InboxManager(projectRoot)
		this.messageSecurity = new MessageSecurity(projectRoot)
		// Society Agent end
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

		// Society Agent start - Initialize inbox security
		if (this.inboxManager) {
			await this.inboxManager.initialize()
		}
		if (this.messageSecurity) {
			await this.messageSecurity.initialize()
		}
		// Society Agent end

		getLog().info(`Agent ${this.agentId} initialized`)
	}

	/**
	 * Register agent in shared registry
	 * Society Agent - now uses single JSON file instead of unbounded JSONL
	 */
	private async register(): Promise<void> {
		const registration: AgentRegistration = {
			agentId: this.agentId,
			role: this.role as any,
			capabilities: this.capabilities,
			workspace: this.workspace,
			vsCodePid: process.pid,
			url: this.serverUrl, // Society Agent - include HTTP server URL
			status: "idle",
			lastHeartbeat: new Date().toISOString(),
			registered: new Date().toISOString(),
		}

		// Society Agent - Write to single JSON registry (replaces unbounded JSONL)
		await this.updateRegistryJson(registration)
	}

	/**
	 * Update agent status with heartbeat
	 * Society Agent - now updates single JSON registry instead of appending JSONL
	 */
	private async updateHeartbeat(status: "online" | "offline" | "idle" | "busy" = "idle"): Promise<void> {
		const update: Partial<AgentRegistration> = {
			agentId: this.agentId,
			url: this.serverUrl,
			status: status,
			lastHeartbeat: new Date().toISOString(),
		}

		// Update in-place in single JSON registry
		await this.updateRegistryJson(update as AgentRegistration)
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
					getLog().error("Failed to parse message:", err)
				}
			}

			// Update position
			this.lastMessagePosition = currentSize
		} catch (err) {
			getLog().error("Failed to process messages:", err)
		}
	}

	/**
	 * Handle incoming message
	 */
	private async handleMessage(message: AgentMessage): Promise<void> {
		getLog().info(`Received message from ${message.from}:`, message.type)

		// Mark message as delivered if it wasn't already
		if (!message.delivered) {
			await this.markMessageDelivered(message.id)
		}

		// Society Agent start - Route through external handler if registered
		if (this.onMessageCallback) {
			await this.onMessageCallback(message)
		} else {
			vscode.window.showInformationMessage(`Message from ${message.from}: ${message.type}`)
		}
		// Society Agent end
	}

	// Society Agent start - Register an external message handler
	/**
	 * Set a callback for incoming messages (e.g. to route through UnifiedMessageHandler).
	 */
	setMessageHandler(handler: (message: AgentMessage) => Promise<void>): void {
		this.onMessageCallback = handler
	}
	// Society Agent end

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
	 * Uses hybrid communication: always writes inbox file (reliable), also tries HTTP (fast)
	 * Society Agent - updated to always-inbox-first strategy
	 */
	async sendMessage(
		to: string,
		type: AgentMessage["type"],
		content: any,
		attachments?: AttachmentData[],
	): Promise<void> {
		// Society Agent - added attachments param
		const message: AgentMessage = {
			id: uuidv4(),
			from: this.agentId,
			to: to,
			type: type,
			content: content,
			timestamp: new Date().toISOString(),
			delivered: false, // Will be marked true when recipient processes it
		}

		// Society Agent start - Always write to inbox first (guaranteed delivery)
		if (this.inboxManager && this.messageSecurity) {
			try {
				const signature = await this.messageSecurity.signMessage(message, this.agentId)
				const signedMessage = { ...message, signature }
				await this.inboxManager.queueMessage(to, signedMessage)
				getLog().info(`Queued signed message for ${to} in inbox:`, type)
			} catch (error) {
				getLog().error(`Failed to queue inbox message:`, error)
				// Fallback to messages.jsonl
				await this.appendJSONL(this.messagesPath, message)
			}
		} else {
			// No inbox manager - use legacy messages.jsonl
			await this.appendJSONL(this.messagesPath, message)
		}
		// Society Agent end

		// Society Agent start - Also try HTTP for instant delivery (best-effort)
		const agents = await this.getAgents()
		const recipient = agents.find((a) => a.agentId === to)

		if (recipient && recipient.url && (await this.isAgentOnlineNetwork(recipient.url))) {
			try {
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
				getLog().info(`Also sent to ${to} via HTTP (instant):`, type)
			} catch (error) {
				getLog().info(`HTTP send to ${to} failed (inbox file will be picked up):`, error)
			}
		}
		// Society Agent end
	}

	/**
	 * Get all registered agents
	 * Society Agent - reads from single JSON registry first, falls back to JSONL
	 */
	async getAgents(): Promise<AgentRegistration[]> {
		// Try new single JSON registry first
		const jsonRegistryPath = this.registryPath.replace(".jsonl", ".json")
		try {
			const content = await fs.readFile(jsonRegistryPath, "utf-8")
			const registry = JSON.parse(content)
			if (registry.agents && typeof registry.agents === "object") {
				return Object.values(registry.agents) as AgentRegistration[]
			}
		} catch {
			// Fall through to legacy JSONL
		}

		// Legacy: read from JSONL
		try {
			const content = await fs.readFile(this.registryPath, "utf-8")
			const lines = content.split("\n").filter((line) => line.trim())

			const agents = new Map<string, AgentRegistration>()

			for (const line of lines) {
				try {
					const entry = JSON.parse(line)
					if (entry.agentId) {
						if (agents.has(entry.agentId)) {
							agents.set(entry.agentId, { ...agents.get(entry.agentId)!, ...entry })
						} else {
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
		getLog().info(`Agent ${this.agentId} catching up on missed messages...`)

		const undelivered = await this.getUndeliveredMessages()
		getLog().info(`Found ${undelivered.length} undelivered messages`)

		for (const message of undelivered) {
			await this.handleMessage(message)
		}

		getLog().info(`Catch-up complete`)
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

		getLog().info(`Agent ${this.agentId} disposed`)
	}

	/**
	 * Append line to JSONL file (legacy — still used for messages.jsonl)
	 */
	private async appendJSONL(filePath: string, data: any): Promise<void> {
		const line = JSON.stringify(data) + "\n"
		await fs.appendFile(filePath, line, "utf-8")
	}

	// Society Agent start - Single JSON registry (replaces unbounded JSONL)
	/**
	 * Update agent in single JSON registry file
	 * File format: { agents: { [agentId]: AgentRegistration }, updatedAt: string }
	 * Each agent is an entry — overwrites on heartbeat instead of appending
	 */
	private async updateRegistryJson(registration: AgentRegistration): Promise<void> {
		const jsonPath = this.registryPath.replace(".jsonl", ".json")

		// Read existing registry (or start fresh)
		let registry: { agents: Record<string, AgentRegistration>; updatedAt: string }
		try {
			const content = await fs.readFile(jsonPath, "utf-8")
			registry = JSON.parse(content)
		} catch {
			registry = { agents: {}, updatedAt: new Date().toISOString() }
		}

		// Merge: update existing entry or add new one
		const existing = registry.agents[registration.agentId]
		if (existing) {
			registry.agents[registration.agentId] = { ...existing, ...registration }
		} else {
			registry.agents[registration.agentId] = registration
		}
		registry.updatedAt = new Date().toISOString()

		// Write atomically (write to temp, then rename)
		const tmpPath = jsonPath + ".tmp"
		await fs.writeFile(tmpPath, JSON.stringify(registry, null, 2), "utf-8")
		await fs.rename(tmpPath, jsonPath)
	}
	// Society Agent end

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

	// Society Agent start - Synchronous accessor for monitor (uses cached data)
	/**
	 * Get registered agents synchronously from cache.
	 * Cache is refreshed on a background interval.
	 */
	getRegisteredAgents(): AgentRegistration[] {
		return [...this.cachedAgents]
	}

	/**
	 * Start background cache refresh for the agent registry
	 */
	startCacheRefresh(intervalMs: number = 10_000): void {
		// Do an initial refresh
		this.refreshCache()
		// Then refresh on interval
		this.cacheRefreshInterval = setInterval(() => this.refreshCache(), intervalMs)
	}

	/**
	 * Stop background cache refresh
	 */
	stopCacheRefresh(): void {
		if (this.cacheRefreshInterval) {
			clearInterval(this.cacheRefreshInterval)
			this.cacheRefreshInterval = undefined
		}
	}

	private refreshCache(): void {
		this.getAgents()
			.then((agents) => {
				this.cachedAgents = agents
			})
			.catch(() => {
				// Keep stale cache on error
			})
	}
	// Society Agent end

	// Society Agent start - helper methods for network communication
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
			getLog().error("Error marking message as delivered:", error)
		}
	}
	// Society Agent end
}
