// kilocode_change - new file
/**
 * Unified Message Handler - Single entry point for all message processing
 *
 * Both HTTP and inbox polling feed into this handler.
 * Handles deduplication, signature verification, priority routing, and delivery.
 *
 * Message flow:
 *   HTTP POST → handleMessage()
 *   Inbox poll → handleMessage()
 *                    ↓
 *   dedup → verify signature → check replay → route by priority
 *                                                ↓
 *   INTERRUPT → inject into active conversation
 *   QUEUE     → add to task queue, process when idle
 *   LOG       → log and notify, don't disturb agent
 */

import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import * as crypto from "crypto"
import {
	AgentIdentityManager,
	SignedMessage,
	AttachmentRef,
	getMessagePriority,
	isReplayAttack,
} from "./agent-identity"
import { getLog } from "./logger"

export interface MessageHandlerOptions {
	/** Shared .society-agent directory */
	sharedDir: string

	/** Identity manager for signature verification */
	identityManager: AgentIdentityManager

	/** This agent's ID */
	agentId: string

	/** Optional: message sender for auto-routing responses */
	messageSender?: { send: (to: string, type: string, content: string, replyTo?: string) => Promise<void> }
}

/**
 * UnifiedMessageHandler - Single handler for all incoming messages
 */
export class UnifiedMessageHandler {
	private options: MessageHandlerOptions
	private processedIds: Set<string> = new Set()
	private taskQueue: SignedMessage[] = []
	private currentTask: SignedMessage | null = null
	private onTaskComplete: (() => void) | null = null

	/**
	 * Response context: tracks who sent the current task so we can auto-route
	 * the response back to them when the task completes.
	 */
	private responseContext: { lastSender: string; messageId: string } | null = null

	// Max processed IDs to track (prevent memory leak)
	private static readonly MAX_PROCESSED_IDS = 10_000

	// kilocode_change start - Recent message tracking for monitor
	private static readonly MAX_RECENT_MESSAGES = 50
	private recentMessages: Array<{
		id: string
		from: string
		to: string
		type: string
		content: string
		timestamp: number
	}> = []
	// kilocode_change end

	// kilocode_change start - Shutdown callback
	private onShutdownCallback?: () => void
	// kilocode_change end

	constructor(options: MessageHandlerOptions) {
		this.options = options
	}

	/**
	 * Set the message sender for auto-routing responses.
	 * Called after construction since sender may be created later.
	 */
	setMessageSender(sender: MessageHandlerOptions["messageSender"]): void {
		this.options.messageSender = sender
	}

	/**
	 * Handle an incoming message — THE single entry point
	 * Called by both HTTP server and inbox poller
	 */
	async handleMessage(message: SignedMessage): Promise<{ accepted: boolean; reason?: string }> {
		const { agentId, identityManager } = this.options

		// Skip messages not for us
		if (message.to !== agentId && message.to !== "all") {
			return { accepted: false, reason: "Not addressed to this agent" }
		}

		// 1. Deduplication
		if (this.processedIds.has(message.id)) {
			getLog().info(`Dedup: already processed ${message.id}`)
			return { accepted: false, reason: "Already processed" }
		}

		// 2. Validate (signature + replay + authorization)
		const validation = identityManager.validateMessage(message)
		if (!validation.valid) {
			getLog().warn(`REJECTED message ${message.id}: ${validation.reason}`)
			await this.quarantineMessage(message, validation.reason!)
			return { accepted: false, reason: validation.reason }
		}

		// 3. Verify attachments if present
		if (message.attachments && message.attachments.length > 0) {
			const attachmentValid = await this.verifyAttachments(message)
			if (!attachmentValid) {
				getLog().warn(`REJECTED message ${message.id}: attachment hash mismatch`)
				await this.quarantineMessage(message, "Attachment hash mismatch")
				return { accepted: false, reason: "Attachment integrity check failed" }
			}
		}

		// 4. Mark as processed
		this.processedIds.add(message.id)
		this.cleanupProcessedIds()

		// kilocode_change start - Track recent messages for monitor
		this.recentMessages.push({
			id: message.id,
			from: message.from,
			to: message.to,
			type: message.type,
			content: typeof message.content === "string" ? message.content.slice(0, 200) : JSON.stringify(message.content).slice(0, 200),
			timestamp: Date.now(),
		})
		if (this.recentMessages.length > UnifiedMessageHandler.MAX_RECENT_MESSAGES) {
			this.recentMessages = this.recentMessages.slice(-UnifiedMessageHandler.MAX_RECENT_MESSAGES)
		}
		// kilocode_change end

		// 5. Route by priority
		const priority = getMessagePriority(message.type)
		getLog().info(`Processing ${message.type} from ${message.from} (priority: ${priority})`)

		switch (priority) {
			case "interrupt":
				await this.handleInterrupt(message)
				break
			case "queue":
				await this.handleQueue(message)
				break
			case "log":
				await this.handleLog(message)
				break
		}

		// 6. Write delivery confirmation
		await this.confirmDelivery(message)

		return { accepted: true }
	}

	// ─── Priority Handlers ───────────────────────────────────────────

	/**
	 * INTERRUPT: Inject into active conversation or create mini-task
	 */
	private async handleInterrupt(message: SignedMessage): Promise<void> {
		// Shutdown is special
		if (message.type === "shutdown") {
			getLog().info(`Shutdown requested by ${message.from}`)
			vscode.window.showWarningMessage(`🛑 Shutdown requested by ${message.from}: ${message.content}`)
			// kilocode_change start - graceful shutdown sequence
			this.taskQueue.length = 0
			this.currentTask = null
			this.onShutdownCallback?.()
			// kilocode_change end
			return
		}

		const { ClineProvider } = await import("../../core/webview/ClineProvider")
		const provider = ClineProvider.getVisibleInstance()
		const currentTask = provider?.getCurrentTask()

		if (currentTask) {
			// Inject into active conversation
			const formatted = this.formatForInjection(message)

			try {
				// Try direct injection first
				await currentTask.handleWebviewAskResponse("messageResponse", formatted, undefined)
				getLog().info(`Injected ${message.type} from ${message.from} into active task`)
			} catch {
				// Fallback: add to conversation history
				try {
					await currentTask.addToApiConversationHistory({
						role: "user",
						content: formatted,
					} as any)
					getLog().info(`Added ${message.type} from ${message.from} to conversation history`)
				} catch (error) {
					getLog().error(`Failed to inject message:`, error)
					vscode.window.showInformationMessage(
						`📨 ${message.from}: ${message.content.substring(0, 100)}`,
					)
				}
			}
		} else {
			// Agent is idle — create a mini-task to respond
			if (provider) {
				// Track sender for response routing
				this.responseContext = { lastSender: message.from, messageId: message.id }
				const formatted = this.formatForNewTask(message)
				await provider.createTask(formatted)
				getLog().info(`Created task for ${message.type} from ${message.from}`)
			} else {
				vscode.window.showInformationMessage(
					`📨 ${message.from}: ${message.content.substring(0, 100)}`,
				)
			}
		}
	}

	/**
	 * QUEUE: Add to task queue, process when current task finishes
	 */
	private async handleQueue(message: SignedMessage): Promise<void> {
		const { ClineProvider } = await import("../../core/webview/ClineProvider")
		const provider = ClineProvider.getVisibleInstance()
		const currentTask = provider?.getCurrentTask()

		if (!currentTask) {
			// Agent is idle — start immediately
			if (provider) {
				this.currentTask = message
				// Track who sent this so we can route the response back
				this.responseContext = { lastSender: message.from, messageId: message.id }
				const formatted = this.formatForNewTask(message)
				await provider.createTask(formatted)
				getLog().info(`Started queued task from ${message.from}`)
			}
		} else {
			// Agent is busy — queue it
			this.taskQueue.push(message)
			getLog().info(`Queued ${message.type} from ${message.from} (queue size: ${this.taskQueue.length})`)
			vscode.window.showInformationMessage(
				`📋 Task from ${message.from} queued (position ${this.taskQueue.length})`,
			)
		}
	}

	/**
	 * LOG: Just log and optionally notify, don't disturb the agent
	 */
	private async handleLog(message: SignedMessage): Promise<void> {
		getLog().info(`${message.type} from ${message.from}: ${message.content.substring(0, 100)}`)

		// Show subtle notification for status updates
		if (message.type === "task_complete") {
			vscode.window.showInformationMessage(
				`✅ ${message.from} completed: ${message.content.substring(0, 80)}`,
			)
		}
	}

	// ─── Task Queue Management ───────────────────────────────────────

	/**
	 * Called when the current task completes — auto-route response, then pick up next from queue
	 *
	 * @param responseText - The agent's final response text (if available)
	 */
	async onCurrentTaskCompleted(responseText?: string): Promise<void> {
		// Auto-route response back to sender
		if (responseText && this.responseContext && this.options.messageSender) {
			try {
				const mentions = this.parseMentions(responseText)
				const sender = this.options.messageSender

				if (mentions.length === 0) {
					// No @mentions — send back to whoever sent the task
					await sender.send(
						this.responseContext.lastSender,
						"task_complete",
						responseText,
						this.responseContext.messageId,
					)
					getLog().info(`Auto-routed response to ${this.responseContext.lastSender}`)
				} else {
					// Has @mentions — send to each mentioned agent
					for (const mention of mentions) {
						if (mention === "all") {
							await sender.send("all", "message", responseText, this.responseContext.messageId)
						} else {
							await sender.send(mention, "message", responseText, this.responseContext.messageId)
						}
					}
					getLog().info(`Routed response to @mentions: ${mentions.join(", ")}`)
				}
			} catch (error) {
				getLog().error(`Failed to auto-route response:`, error)
			}
		}

		this.currentTask = null
		this.responseContext = null

		if (this.taskQueue.length === 0) {
			getLog().info(`Task queue empty — agent idle`)
			return
		}

		const next = this.taskQueue.shift()!
		this.currentTask = next
		// Track sender for next task's response routing
		this.responseContext = { lastSender: next.from, messageId: next.id }

		getLog().info(`Starting next queued task from ${next.from} (${this.taskQueue.length} remaining)`)

		const { ClineProvider } = await import("../../core/webview/ClineProvider")
		const provider = ClineProvider.getVisibleInstance()
		if (provider) {
			const formatted = this.formatForNewTask(next)
			await provider.createTask(formatted)
		}
	}

	/**
	 * Parse @mentions from text
	 */
	private parseMentions(text: string): string[] {
		const mentionRegex = /@([\w-]+)/g
		const mentions: string[] = []
		let match
		while ((match = mentionRegex.exec(text)) !== null) {
			mentions.push(match[1])
		}
		return mentions
	}

	/**
	 * Get current response context (for external callers like ResponseCapture)
	 */
	getResponseContext(): { lastSender: string; messageId: string } | null {
		return this.responseContext
	}

	/**
	 * Get current queue status
	 */
	getQueueStatus(): { current: SignedMessage | null; pending: number; queue: SignedMessage[] } {
		return {
			current: this.currentTask,
			pending: this.taskQueue.length,
			queue: [...this.taskQueue],
		}
	}

	// ─── Message Formatting ──────────────────────────────────────────

	private formatForInjection(message: SignedMessage): string {
		const icon = this.getTypeIcon(message.type)
		const attachmentNote = message.attachments?.length
			? `\n\n📎 ${message.attachments.length} attachment(s): ${message.attachments.map((a) => a.name).join(", ")}`
			: ""

		return `${icon} **Message from ${message.from}:**\n\n${message.content}${attachmentNote}`
	}

	private formatForNewTask(message: SignedMessage): string {
		const icon = this.getTypeIcon(message.type)
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "unknown"

		const attachmentNote = message.attachments?.length
			? `\n\n📎 **Attachments** (${message.attachments.length}):\n${message.attachments.map((a) => `  - ${a.name} (${a.type}, ${this.formatSize(a.size)})`).join("\n")}`
			: ""

		return [
			`${icon} **From: ${message.from}**`,
			"",
			message.content,
			attachmentNote,
			"",
			`**📁 Your Workspace**: \`${workspaceRoot}\``,
			`*Work only in this directory. Do NOT navigate to parent directories.*`,
			"",
			`**📚 Your Knowledge Base**: \`${workspaceRoot}/.agent-knowledge/\``,
			"",
			"---",
			"",
			`*💡 Your response will go to **${message.from}** by default.*`,
			`*Use **@agent-id** to send to another agent, or **@all** to broadcast.*`,
		].join("\n")
	}

	private getTypeIcon(type: string): string {
		switch (type) {
			case "task_assign": return "🎯"
			case "question": return "❓"
			case "task_complete": return "✅"
			case "status_update": return "📊"
			case "review_request": return "🔍"
			case "shutdown": return "🛑"
			default: return "📨"
		}
	}

	private formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes}B`
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
		return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
	}

	// ─── Attachments ─────────────────────────────────────────────────

	/**
	 * Verify attachment integrity (hash check)
	 */
	private async verifyAttachments(message: SignedMessage): Promise<boolean> {
		if (!message.attachments) return true

		for (const attachment of message.attachments) {
			const fullPath = path.join(this.options.sharedDir, attachment.path)

			try {
				const fileData = await fs.readFile(fullPath)
				const hash = "sha256:" + crypto.createHash("sha256").update(fileData).digest("hex")

				if (hash !== attachment.hash) {
					getLog().warn(
						`Attachment ${attachment.name} hash mismatch: expected ${attachment.hash}, got ${hash}`,
					)
					return false
				}
			} catch (error) {
				getLog().warn(`Attachment ${attachment.name} not found at ${fullPath}`)
				return false
			}
		}

		return true
	}

	// ─── Quarantine & Delivery ───────────────────────────────────────

	/**
	 * Move rejected message to quarantine
	 */
	private async quarantineMessage(message: SignedMessage, reason: string): Promise<void> {
		const quarantineDir = path.join(this.options.sharedDir, "quarantine")
		await fs.mkdir(quarantineDir, { recursive: true })

		const entry = {
			message,
			reason,
			quarantinedAt: new Date().toISOString(),
			quarantinedBy: this.options.agentId,
		}

		const filePath = path.join(quarantineDir, `${message.id}.json`)
		await fs.writeFile(filePath, JSON.stringify(entry, null, 2), "utf-8")
	}

	/**
	 * Write delivery confirmation
	 */
	private async confirmDelivery(message: SignedMessage): Promise<void> {
		// Mark as delivered in the inbox file
		const inboxPath = path.join(
			this.options.sharedDir,
			"inbox",
			this.options.agentId,
			`${message.id}.json`,
		)

		try {
			// Update the file with delivery info
			const delivered = {
				...message,
				delivered: true,
				deliveredAt: new Date().toISOString(),
			}
			await fs.writeFile(inboxPath, JSON.stringify(delivered, null, 2), "utf-8")

			// Move to processed directory
			const processedDir = path.join(
				this.options.sharedDir,
				"inbox",
				this.options.agentId,
				"processed",
			)
			await fs.mkdir(processedDir, { recursive: true })
			const processedPath = path.join(processedDir, `${message.id}.json`)
			await fs.rename(inboxPath, processedPath)
		} catch {
			// File may not exist if message came via HTTP — that's fine
		}
	}

	/**
	 * Prevent memory leak in processedIds
	 */
	private cleanupProcessedIds(): void {
		if (this.processedIds.size > UnifiedMessageHandler.MAX_PROCESSED_IDS) {
			// Keep only the most recent half
			const ids = Array.from(this.processedIds)
			this.processedIds.clear()
			for (const id of ids.slice(ids.length / 2)) {
				this.processedIds.add(id)
			}
		}
	}

	// kilocode_change start - Monitor data accessors

	/**
	 * Get the number of queued tasks waiting to be processed
	 */
	getQueueDepth(): number {
		return this.taskQueue.length
	}

	/**
	 * Get recent messages for the monitor display
	 */
	getRecentMessages(): Array<{
		id: string
		from: string
		to: string
		type: string
		content: string
		timestamp: number
	}> {
		return [...this.recentMessages]
	}

	// kilocode_change start - Shutdown registration
	/**
	 * Register a callback that fires when a shutdown message arrives.
	 */
	onShutdown(callback: () => void): void {
		this.onShutdownCallback = callback
	}
	// kilocode_change end
}
