// kilocode_change - new file
/**
 * SimpleAgentLoop - Basic autonomous agent behavior integrated with KiloCode chat
 *
 * Polls inbox for messages from other agents and delivers them based on current agent state.
 * Uses persistent queue to guarantee message delivery.
 */

import * as vscode from "vscode"
import { AgentRegistry, AgentMessage } from "./agent-registry"
import { ResponseHandler } from "./response-handler"
import { KnowledgeManager } from "./knowledge-manager"
import { InboxManager, InboxMessage } from "./inbox-manager"

export class SimpleAgentLoop {
	private registry: AgentRegistry
	private role: string
	private capabilities: string[]
	private running: boolean = false
	private pollInterval: NodeJS.Timeout | undefined
	private processedMessageIds: Set<string> = new Set()
	private responseHandler: ResponseHandler
	private agentId: string
	private knowledgeManager: KnowledgeManager | undefined
	private inboxManager: InboxManager | undefined // kilocode_change
	private sharedDir: string | undefined // kilocode_change - Shared directory for inbox

	constructor(registry: AgentRegistry, agentId: string, role: string, capabilities: string[], sharedDir?: string) {
		// kilocode_change
		this.registry = registry
		this.agentId = agentId
		this.role = role
		this.capabilities = capabilities
		this.responseHandler = new ResponseHandler(registry, agentId)
		this.sharedDir = sharedDir // kilocode_change
	}

	/**
	 * Start the agent loop
	 */
	async start(): Promise<void> {
		if (this.running) return

		this.running = true
		console.log(`[SimpleAgentLoop] Starting for ${this.role}`)

		// Initialize knowledge manager (workspace-local)
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
		if (workspaceRoot) {
			this.knowledgeManager = new KnowledgeManager(workspaceRoot)
			await this.knowledgeManager.initialize()
			console.log(`[SimpleAgentLoop] Knowledge base initialized at ${workspaceRoot}/.agent-knowledge/`)
		}

		// kilocode_change start - Initialize inbox manager with shared directory and security
		const inboxRoot = this.sharedDir || workspaceRoot
		if (inboxRoot) {
			this.inboxManager = new InboxManager(inboxRoot)
			await this.inboxManager.initialize() // Initialize security keys
			console.log(`[SimpleAgentLoop] Inbox manager initialized at ${inboxRoot}/.society-agent/inbox/`)
			console.log(`[SimpleAgentLoop] Message security enabled - signatures will be verified`)
		} else {
			console.warn(`[SimpleAgentLoop] No shared directory or workspace root - inbox disabled`)
		}
		// kilocode_change end

		// Poll for messages every 3 seconds
		this.pollInterval = setInterval(async () => {
			try {
				await this.processMessages()
			} catch (error) {
				console.error("[SimpleAgentLoop] Error processing messages:", error)
			}
		}, 3000)
	}

	/**
	 * Stop the agent loop
	 */
	stop(): void {
		if (this.pollInterval) {
			clearInterval(this.pollInterval)
			this.pollInterval = undefined
		}
		this.running = false
		console.log(`[SimpleAgentLoop] Stopped for ${this.role}`)
	}

	/**
	 * Process pending messages from inbox (kilocode_change - now uses InboxManager)
	 */
	private async processMessages(): Promise<void> {
		if (!this.inboxManager) {
			// Fallback to old behavior if inbox not initialized
			const messages = await this.registry.getUndeliveredMessages()
			const newMessages = messages.filter((msg) => !this.processedMessageIds.has(msg.id))

			if (newMessages.length === 0) return

			console.log(`[SimpleAgentLoop] Processing ${newMessages.length} new message(s) (fallback mode)`)

			for (const message of newMessages) {
				await this.handleMessage(message)
				this.processedMessageIds.add(message.id)
			}
			return
		}

		// kilocode_change start - Use inbox for guaranteed delivery
		const pendingMessages = await this.inboxManager.getPendingMessages(this.agentId)

		if (pendingMessages.length === 0) return

		console.log(`[SimpleAgentLoop] Found ${pendingMessages.length} pending message(s) in inbox`)

		for (const message of pendingMessages) {
			const delivered = await this.attemptDelivery(message)

			if (delivered) {
				// Acknowledge (delete from inbox) on successful delivery
				await this.inboxManager.acknowledge(message)
				console.log(`[SimpleAgentLoop] Successfully delivered and acknowledged message ${message.id}`)
			} else {
				// Increment attempt count, will retry next cycle
				await this.inboxManager.incrementAttempt(message)
				console.log(
					`[SimpleAgentLoop] Failed to deliver message ${message.id}, attempt ${(message.attempts || 0) + 1}`,
				)
			}
		}
		// kilocode_change end
	}

	/**
	 * Attempt to deliver a message based on current agent state (kilocode_change)
	 * Returns true if delivered successfully, false if should retry later
	 */
	private async attemptDelivery(message: InboxMessage): Promise<boolean> {
		const { ClineProvider } = await import("../../core/webview/ClineProvider")
		const provider = ClineProvider.getVisibleInstance()
		const currentTask = provider?.currentTask

		// Determine agent state
		const isIdle = !currentTask || currentTask.state === "completed" || currentTask.state === "error"
		const isWaiting = currentTask && (currentTask.state === "waiting_for_api" || currentTask.state === "paused")
		const isBusy = currentTask && currentTask.state === "streaming"

		console.log(
			`[SimpleAgentLoop] Attempting delivery for message ${message.id}, agent state: ${currentTask?.state || "idle"}`,
		)

		// Strategy 1: IDLE - Create new task (always works)
		if (isIdle) {
			console.log(`[SimpleAgentLoop] Agent idle - creating new task for message`)
			try {
				await this.handleMessage(message)
				return true
			} catch (error) {
				console.error(`[SimpleAgentLoop] Failed to create task:`, error)
				return false
			}
		}

		// Strategy 2: WAITING - Inject into current task (high success rate)
		if (isWaiting) {
			console.log(`[SimpleAgentLoop] Agent waiting - injecting message into current task`)
			try {
				const sender = message.from === "user" ? "user" : message.from
				const content = typeof message.content === "string" ? message.content : ""
				const formattedMessage = `📨 **Response from ${sender}:**\n\n${content}`

				await currentTask.handleWebviewAskResponse("messageResponse", formattedMessage, undefined)
				console.log(`[SimpleAgentLoop] Message injected successfully`)
				return true
			} catch (error) {
				console.error(`[SimpleAgentLoop] Injection failed:`, error)
				return false
			}
		}

		// Strategy 3: BUSY - Add to conversation history (guaranteed delivery on next cycle)
		if (isBusy || currentTask) {
			console.log(`[SimpleAgentLoop] Agent busy - adding message to conversation history`)
			try {
				const sender = message.from === "user" ? "user" : message.from
				const content = typeof message.content === "string" ? message.content : ""
				const formattedMessage = `📨 **Response from ${sender}:**\n\n${content}`

				// Add to API conversation history
				await currentTask.addToApiConversationHistory({
					role: "user",
					content: formattedMessage,
				} as any)

				// Show notification
				vscode.window.showInformationMessage(
					`📨 Message from ${sender} queued. You'll see it in your next response.`,
				)

				console.log(`[SimpleAgentLoop] Message added to conversation history`)
				return true
			} catch (error) {
				console.error(`[SimpleAgentLoop] Failed to add to history:`, error)
				// Retry later
				return false
			}
		}

		// Unknown state - retry later
		console.warn(`[SimpleAgentLoop] Unknown agent state, will retry`)
		return false
	}

	/**
	 * Handle a single message - inject into chat via ClineProvider
	 */
	private async handleMessage(message: AgentMessage): Promise<void> {
		console.log(`[SimpleAgentLoop] Received message:`, {
			from: message.from,
			type: message.type,
			content: typeof message.content === "string" ? message.content.substring(0, 100) : message.content,
		})

		// Mark as delivered
		await this.registry.markDelivered(message.id)

		// Set response context for routing replies
		const sender = message.from === "user" ? "user" : message.from
		this.responseHandler.setContext(sender, message.id)

		const content = typeof message.content === "string" ? message.content : ""

		// kilocode_change start - Smart message routing
		const { ClineProvider } = await import("../../core/webview/ClineProvider")
		const provider = ClineProvider.getVisibleInstance()
		const currentTask = provider?.currentTask
		const hasActiveTask = currentTask && currentTask.state !== "completed" && currentTask.state !== "error"

		// If agent has active task and receives a "message" type, inject AND add to history
		if (message.type === "message" && hasActiveTask) {
			console.log(`[SimpleAgentLoop] Agent busy - injecting message from ${sender} into active task`)
			const formattedMessage = `📨 **Response from ${sender}:**\n\n${content}`

			// Add directly to API conversation history so agent sees it in next API call
			try {
				await currentTask.addToApiConversationHistory({
					role: "user",
					content: formattedMessage,
				} as any)
				console.log(`[SimpleAgentLoop] Message added to conversation history`)
			} catch (error) {
				console.log(`[SimpleAgentLoop] Failed to add to history:`, error)
			}

			// Also try to inject immediately for visibility
			try {
				await currentTask.handleWebviewAskResponse("messageResponse", formattedMessage, undefined)
				console.log(`[SimpleAgentLoop] Message injected into current stream`)
			} catch (error) {
				console.log(`[SimpleAgentLoop] Immediate injection failed (agent may be streaming):`, error)
				// Show notification as fallback
				vscode.window.showInformationMessage(
					`📨 Message from ${sender} added to your conversation. You'll see it in your next response.`,
				)
			}

			return
		}

		// Only create NEW tasks for task_assign and question types
		if (message.type !== "task_assign" && message.type !== "question") {
			console.log(`[SimpleAgentLoop] Message type '${message.type}' - showing notification only`)
			const typeLabel = "Message"
			vscode.window.showInformationMessage(
				`💬 ${typeLabel} from ${sender}: ${content}\n\n(Use --type task_assign or --type question to create a task)`,
			)
			return
		}
		// kilocode_change end

		// Additional check: Is content too simple to be a real task?
		const isSimpleMessage = this.isSimpleMessage(content)
		if (isSimpleMessage) {
			console.log(`[SimpleAgentLoop] Content too simple for task: "${content}"`)
			vscode.window.showInformationMessage(
				`💬 ${sender}: ${content}\n\n(Message too simple to start a task. Please provide a task description.)`,
			)
			return
		}

		// Inject into chat via ClineProvider
		try {
			const { ClineProvider } = await import("../../core/webview/ClineProvider")
			const provider = ClineProvider.getVisibleInstance()

			if (provider) {
				const currentTask = provider.currentTask
				const isContinuation = currentTask && currentTask.state !== "completed" && currentTask.state !== "error"

				// Format message for chat (with continuation hint if applicable)
				const formattedMessage = this.formatMessageForChat(message, sender, !!isContinuation)

				if (isContinuation) {
					// Continue existing conversation
					await currentTask.handleWebviewAskResponse("messageResponse", formattedMessage, undefined)
					console.log(`[SimpleAgentLoop] Appended message to existing task from ${sender}`)
				} else {
					// Create new task (first message or previous task finished)
					// Enable auto-approvals for autonomous agent work
					await provider.createTask(formattedMessage, undefined, undefined, {
						mode: "code",
						alwaysAllowWrite: true, // Auto-approve file writes
						alwaysAllowExecute: true, // Auto-approve command execution
					})
					console.log(
						`[SimpleAgentLoop] Created new task with message from ${sender} (auto-approvals enabled)`,
					)
				}
			} else {
				console.log("[SimpleAgentLoop] No visible ClineProvider, showing notification")
				vscode.window.showInformationMessage(`📨 ${sender}: ${this.getMessagePreview(message)}`)
			}
		} catch (error) {
			console.error("[SimpleAgentLoop] Failed to inject message into chat:", error)
			vscode.window.showInformationMessage(`📨 ${sender}: ${this.getMessagePreview(message)}`)
		}
	}

	/**
	 * Detect if message is just conversational (not a real task)
	 */
	private isSimpleMessage(content: string): boolean {
		const trimmed = content.trim().toLowerCase()

		// Simple greetings and test messages
		const simplePatterns = [
			/^hi$/,
			/^hello$/,
			/^hey$/,
			/^test$/,
			/^test message$/,
			/^testing$/,
			/^ping$/,
			/^are you there\??$/,
			/^can you hear me\??$/,
		]

		// Check if matches any simple pattern
		if (simplePatterns.some((pattern) => pattern.test(trimmed))) {
			return true
		}

		// Check if message is very short (less than 10 chars) with no task indicators
		if (trimmed.length < 10) {
			const taskIndicators = ["create", "build", "implement", "add", "fix", "update", "write", "make"]
			const hasTaskIndicator = taskIndicators.some((word) => trimmed.includes(word))
			return !hasTaskIndicator
		}

		return false
	}

	/**
	 * Format message for chat display - Always show sender
	 */
	private formatMessageForChat(message: AgentMessage, sender: string, isContinuation: boolean): string {
		const typeIcon = this.getTypeIcon(message.type)
		const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content, null, 2)

		// Get workspace root path
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "unknown"

		// Add continuation hint if this is appending to existing task
		const continuationNote = isContinuation
			? `\n\n*⚡ **CONTINUATION**: This is a follow-up message. Continue working on the current task without re-exploring the workspace from scratch. Build on your existing knowledge.*`
			: ""

		// Add workspace context and knowledge base info
		const workspaceNote = !isContinuation
			? `\n\n**📁 Your Workspace**: \`${workspaceRoot}\`\n*Work only in this directory. Do NOT navigate to parent directories.*\n\n**📚 Your Knowledge Base**: \`${workspaceRoot}/.agent-knowledge/\`\n*You are fully responsible for maintaining your knowledge. Save conversations, decisions, objects, states, relationships - whatever helps you work effectively. Organize it however makes sense to you.*`
			: ""

		// Format: Icon From: sender-name \n\n content \n\n workspace note \n\n continuation hint \n\n routing hint
		return `${typeIcon} **From: ${sender}**\n\n${content}${workspaceNote}${continuationNote}\n\n---\n\n*💡 Tip: Your response will go to **${sender}** by default.*\n*Use **@agent-id** to send to another agent, or **@all** to broadcast.*`
	}

	private getTypeIcon(type: string): string {
		switch (type) {
			case "task_assign":
				return "🎯"
			case "question":
				return "❓"
			case "task_complete":
				return "✅"
			case "status_update":
				return "📊"
			default:
				return "📨"
		}
	}

	/**
	 * Get message preview for notifications
	 */
	private getMessagePreview(message: AgentMessage): string {
		if (typeof message.content === "string") {
			return message.content.length > 50 ? message.content.substring(0, 50) + "..." : message.content
		}
		return `[${message.type}]`
	}
}
