// Society Agent - new file
/**
 * ConversationAgent - Base agent implementation as LLM conversation thread
 *
 * Each agent maintains its own conversation history with the LLM, enabling
 * autonomous decision-making and task execution while preserving context.
 *
 * Inherits Society Agent's built-in conversation summarization for automatic memory management.
 */

import Anthropic from "@anthropic-ai/sdk"
import { ApiHandler, ApiStream } from "./api"
import { ApiMessage, summarizeConversation } from "./api/condense"
import * as fs from "fs/promises"
import * as path from "path"
import { getLog } from "./logger" // Society Agent

// Society Agent start
export interface AgentIdentity {
	id: string
	createdAt: number
}

export interface AgentMessage {
	role: "user" | "assistant"
	content: string
	timestamp: number
	attachments?: any[] // Society Agent - support for image attachments
}

export interface AgentState {
	identity: AgentIdentity
	conversationHistory: AgentMessage[]
	currentTask?: string
	status: "idle" | "working" | "waiting" | "paused" | "error" | "completed"
	metadata: Record<string, unknown>
	systemPrompt?: string // Society Agent - used by callLLM methods
}

export interface ConversationAgentConfig {
	identity: AgentIdentity
	apiHandler: ApiHandler
	systemPrompt?: string
	workspacePath?: string
	onMessage?: (message: AgentMessage) => void
	onStatusChange?: (status: AgentState["status"]) => void
	onFileCreated?: (relativePath: string, fullPath: string, size: number) => void // Society Agent - file tracking
	maxMessages?: number // Max messages before summarization (default: 50) - LEGACY
	summaryThreshold?: number // When to trigger summary (default: 40) - LEGACY
	// Society Agent start - token-based summarization
	contextWindowSize?: number // Total context window size in tokens (default: 200000 for Claude)
	contextThresholdPercent?: number // Percentage of context window to trigger summarization (default: 70)
	// Society Agent end
	// Society Agent start - backup and persistence settings
	backupsEnabled?: boolean // Enable/disable pre-summarization backups (default: true)
	persistHistory?: boolean // Persist history to disk (default: false)
	historyDir?: string // Directory for persisted history files
	maxHistoryMB?: number // Max disk space for history in MB (default: 50)
	// Society Agent end
	preserveFirstMessage?: boolean // Keep first message after summarization (default: true) - set false to drop it and save tokens (especially images) // Society Agent
	onSummarizationStart?: (metadata: { messageCount: number; tokenCount: number; contextPercent: number }) => void // Society Agent - summarization event
	onSummarizationEnd?: (metadata: { summary: string; messageCountBefore: number; messageCountAfter: number; tokensBefore: number; tokensAfter: number; cost: number; error?: string }) => void // Society Agent - summarization event
}
// Society Agent end

/**
 * Base agent that uses LLM conversation thread for autonomous operation
 */
export class ConversationAgent {
	// Society Agent start
	private state: AgentState
	private apiHandler: ApiHandler
	private systemPrompt: string
	private workspacePath: string
	private onMessage?: (message: AgentMessage) => void
	private onStatusChange?: (status: AgentState["status"]) => void
	private onFileCreated?: (relativePath: string, fullPath: string, size: number) => void // Society Agent
	private _pendingContent?: any[] // Society Agent - structured content blocks for images - file tracking
	private maxMessages: number // Society Agent: Max messages before summarization
	private summaryThreshold: number // Society Agent: When to trigger summary
	private conversationSummary: string = "" // Society Agent: Summarized older context
	private onSummarizationStart?: (metadata: { messageCount: number; tokenCount: number; contextPercent: number }) => void // Society Agent
	private onSummarizationEnd?: (metadata: { summary: string; messageCountBefore: number; messageCountAfter: number; tokensBefore: number; tokensAfter: number; cost: number; error?: string }) => void // Society Agent
	// Society Agent start - token-based summarization
	private contextWindowSize: number
	private contextThresholdPercent: number
	private historyBackups: Array<{ timestamp: number; messages: AgentMessage[]; tokenCount: number; reason: string }> = []
	// Society Agent end
	// Society Agent start - backup and persistence settings
	private backupsEnabled: boolean
	private persistHistory: boolean
	private historyDir: string
	private maxHistoryMB: number
	private preserveFirstMessage: boolean // Society Agent - option to drop first message after summarization
	// Society Agent end

	constructor(config: ConversationAgentConfig) {
		// Society Agent start
		this.workspacePath = config.workspacePath || process.cwd()
		this.state = {
			identity: config.identity,
			conversationHistory: [],
			status: "idle",
			metadata: {},
		}
		this.apiHandler = config.apiHandler
		this.systemPrompt = config.systemPrompt || this.getDefaultSystemPrompt()
		this.onMessage = config.onMessage
		this.onStatusChange = config.onStatusChange
		this.onFileCreated = config.onFileCreated // Society Agent - file tracking
		// Society Agent: Memory management configuration
		this.maxMessages = config.maxMessages || 50
		this.summaryThreshold = config.summaryThreshold || 40
		this.conversationSummary = ""
		this.onSummarizationStart = config.onSummarizationStart // Society Agent
		this.onSummarizationEnd = config.onSummarizationEnd // Society Agent
		// Society Agent start - token-based summarization
		this.contextWindowSize = config.contextWindowSize || 200000 // Claude 3.5 Sonnet context window
		this.contextThresholdPercent = config.contextThresholdPercent || 70 // Summarize at 70% capacity
		this.historyBackups = []
		// Society Agent end
		// Society Agent start - backup and persistence settings
		this.backupsEnabled = config.backupsEnabled !== false // default: true
		this.persistHistory = config.persistHistory || false
		this.historyDir = config.historyDir || path.join(this.workspacePath, ".society-agent", "history")
		this.maxHistoryMB = config.maxHistoryMB || 50 // 50MB default
		this.preserveFirstMessage = config.preserveFirstMessage !== false // default: true, set false to save tokens after summarization
		// Load persisted history on startup
		if (this.persistHistory) {
			this.loadHistoryFromDisk().catch(err => {
				getLog().warn(`${this.state.identity.id}: Failed to load persisted history: ${err}`)
			})
		}
		// Society Agent end
	}

	/**
	 * Get agent identity
	 */
	getIdentity(): AgentIdentity {
		// Society Agent start
		return this.state.identity
		// Society Agent end
	}

	/**
	 * Get current agent state
	 */
	getState(): AgentState {
		// Society Agent start
		return { ...this.state }
		// Society Agent end
	}

	/**
	 * Get conversation history
	 */
	getHistory(): AgentMessage[] {
		// Society Agent start
		return [...this.state.conversationHistory]
		// Society Agent end
	}

	// Society Agent start - expose system prompt
	/**
	 * Get the system prompt for this agent
	 */
	getSystemPrompt(): string {
		return this.systemPrompt
	}
	// Society Agent end

	// Society Agent start - expose conversation summary and clear history
	/**
	 * Get the auto-summarized conversation context (if any)
	 */
	getSummary(): string {
		return this.conversationSummary
	}

	/**
	 * Clear all conversation history, summary, and backups.
	 * Agent becomes a blank slate but keeps its identity/config.
	 * Also deletes persisted history files if persistence is enabled.
	 */
	clearHistory(): void {
		this.state.conversationHistory = []
		this.conversationSummary = ""
		this.historyBackups = [] // Society Agent - also clear backups
		this.state.currentTask = undefined
		this.setStatus("idle")
		// Society Agent start - delete persisted files
		if (this.persistHistory) {
			this.deletePersistedHistory().catch(err => {
				getLog().warn(`${this.state.identity.id}: Failed to delete persisted history: ${err}`)
			})
		}
		// Society Agent end
		getLog().info(`${this.state.identity.id}: History and backups cleared`)
	}

	// Society Agent start - Token estimation and backup access
	/**
	 * Get all history backups (full conversation before each summarization)
	 */
	getHistoryBackups(): Array<{ timestamp: number; messages: AgentMessage[]; tokenCount: number; reason: string }> {
		return [...this.historyBackups]
	}

	/**
	 * Estimate token count for current conversation
	 * Uses rough approximation: ~4 chars per token for English text
	 */
	estimateTokenCount(): number {
		let totalChars = this.systemPrompt.length
		for (const msg of this.state.conversationHistory) {
			totalChars += msg.content.length
		}
		return Math.ceil(totalChars / 4) // ~4 chars per token
	}

	/**
	 * Get current context usage stats
	 */
	getContextStats(): { tokenCount: number; contextPercent: number; messageCount: number; windowSize: number } {
		const tokenCount = this.estimateTokenCount()
		return {
			tokenCount,
			contextPercent: (tokenCount / this.contextWindowSize) * 100,
			messageCount: this.state.conversationHistory.length,
			windowSize: this.contextWindowSize,
		}
	}

	/**
	 * Get the current conversation summary (if any)
	 */
	getCurrentSummary(): string | null {
		return this.conversationSummary || null
	}

	/**
	 * Get examination context: current summary + most recent backup for comparison
	 */
	getExaminationContext(): {
		currentSummary: string | null
		currentMessages: AgentMessage[]
		lastBackup: { timestamp: number; messages: AgentMessage[]; tokenCount: number; reason: string } | null
		hasSummarized: boolean
	} {
		const lastBackup = this.historyBackups.length > 0 
			? this.historyBackups[this.historyBackups.length - 1] 
			: null
		return {
			currentSummary: this.conversationSummary || null,
			currentMessages: [...this.state.conversationHistory],
			lastBackup,
			hasSummarized: !!this.conversationSummary,
		}
	}

	/**
	 * Examine the summary by asking a question.
	 * Compares the answer against both the summary and the original backup.
	 * Returns analysis of what was captured vs potentially lost.
	 */
	async examineSummary(question: string, backupIndex?: number): Promise<{
		question: string
		answerFromSummary: string
		answerFromOriginal: string
		comparison: 'captured' | 'partial' | 'missing' | 'no-backup'
		explanation: string
	}> {
		const backup = backupIndex !== undefined 
			? this.historyBackups[backupIndex]
			: this.historyBackups[this.historyBackups.length - 1]

		if (!backup) {
			return {
				question,
				answerFromSummary: '',
				answerFromOriginal: '',
				comparison: 'no-backup',
				explanation: 'No backup available for comparison. The conversation has not been summarized yet.',
			}
		}

		// Build original conversation as text
		const originalText = backup.messages
			.map(m => `[${m.role}]: ${m.content}`)
			.join('\n\n')

		const summaryText = this.conversationSummary || '(No summary available)'

		// Ask LLM to answer the question from BOTH sources and compare
		const examinePrompt = `You are a summary quality examiner. You are given:
1. A USER QUESTION about a conversation
2. The ORIGINAL CONVERSATION (full text before summarization)
3. The SUMMARY that replaced most of the conversation

Your task:
- Answer the user's question based on the ORIGINAL CONVERSATION
- Answer the same question based on the SUMMARY
- Compare the two answers and determine if the summary captured the information

Respond in this exact JSON format:
{
  "answerFromOriginal": "Answer based on the original conversation",
  "answerFromSummary": "Answer based on the summary (or 'Information not found in summary')",
  "comparison": "captured|partial|missing",
  "explanation": "Brief explanation of what was captured, partially captured, or missing"
}

Where comparison is:
- "captured": The summary fully answers the question
- "partial": The summary has some but not all relevant information
- "missing": The information is in the original but NOT in the summary

USER QUESTION:
${question}

ORIGINAL CONVERSATION:
${originalText}

SUMMARY:
${summaryText}

Respond with ONLY the JSON object, no other text.`

		try {
			const response = await this.callLLMDirect(examinePrompt)
			const parsed = JSON.parse(response)
			return {
				question,
				answerFromSummary: parsed.answerFromSummary || '',
				answerFromOriginal: parsed.answerFromOriginal || '',
				comparison: parsed.comparison || 'missing',
				explanation: parsed.explanation || '',
			}
		} catch (error) {
			getLog().error(`${this.state.identity.id}: Error examining summary: ${error}`)
			return {
				question,
				answerFromSummary: '',
				answerFromOriginal: '',
				comparison: 'missing',
				explanation: `Error during examination: ${String(error)}`,
			}
		}
	}

	/**
	 * Get automated quality score for the current summary
	 * Checks if key topics from original are present in summary
	 */
	async getSummaryQuality(backupIndex?: number): Promise<{
		score: number // 0-100
		topicsFound: string[]
		topicsMissing: string[]
		recommendations: string[]
	}> {
		const backup = backupIndex !== undefined 
			? this.historyBackups[backupIndex]
			: this.historyBackups[this.historyBackups.length - 1]

		if (!backup || !this.conversationSummary) {
			return {
				score: 0,
				topicsFound: [],
				topicsMissing: [],
				recommendations: ['No summary or backup available for quality assessment'],
			}
		}

		const originalText = backup.messages
			.map(m => `[${m.role}]: ${m.content}`)
			.join('\n\n')

		const qualityPrompt = `You are a summary quality assessor. Analyze how well this summary captures the key information from the original conversation.

ORIGINAL CONVERSATION:
${originalText}

SUMMARY:
${this.conversationSummary}

Extract key topics/decisions/facts from the ORIGINAL and check if each appears in the SUMMARY.

Respond in this exact JSON format:
{
  "score": <number 0-100>,
  "topicsFound": ["topic1 that IS in summary", "topic2 that IS in summary"],
  "topicsMissing": ["topic3 that is NOT in summary", "topic4 that is NOT in summary"],
  "recommendations": ["Recommendation 1", "Recommendation 2"]
}

Be thorough - identify all important decisions, technical details, and action items.
Respond with ONLY the JSON object.`

		try {
			const response = await this.callLLMDirect(qualityPrompt)
			const parsed = JSON.parse(response)
			return {
				score: parsed.score || 0,
				topicsFound: parsed.topicsFound || [],
				topicsMissing: parsed.topicsMissing || [],
				recommendations: parsed.recommendations || [],
			}
		} catch (error) {
			getLog().error(`${this.state.identity.id}: Error assessing summary quality: ${error}`)
			return {
				score: 0,
				topicsFound: [],
				topicsMissing: [],
				recommendations: [`Error during quality assessment: ${String(error)}`],
			}
		}
	}

	/**
	 * Direct LLM call for examination (doesn't add to conversation history)
	 */
	private async callLLMDirect(prompt: string): Promise<string> {
		const messages: Anthropic.MessageParam[] = [
			{ role: 'user', content: prompt }
		]

		const stream = this.apiHandler.createMessage('You are a helpful assistant that responds only in valid JSON format.', messages)
		let result = ''
		for await (const chunk of stream) {
			if (chunk.type === 'text') {
				result += chunk.text
			}
		}
		return result.trim()
	}

	// Society Agent start - History persistence methods
	/**
	 * Get the history file path for this agent
	 */
	private getHistoryFilePath(): string {
		return path.join(this.historyDir, `${this.state.identity.id}.json`)
	}

	/**
	 * Load history from disk (called on startup if persistence enabled)
	 */
	async loadHistoryFromDisk(): Promise<void> {
		if (!this.persistHistory) return

		try {
			const filePath = this.getHistoryFilePath()
			const data = await fs.readFile(filePath, "utf-8")
			const parsed = JSON.parse(data)

			if (parsed.messages && Array.isArray(parsed.messages)) {
				this.state.conversationHistory = parsed.messages
			}
			if (parsed.summary) {
				this.conversationSummary = parsed.summary
			}
			if (parsed.backups && Array.isArray(parsed.backups) && this.backupsEnabled) {
				this.historyBackups = parsed.backups
			}
			// Society Agent start - restore task state
			if (parsed.currentTask) {
				this.state.currentTask = parsed.currentTask
			}
			if (parsed.status && parsed.status !== "completed" && parsed.status !== "error") {
				// Resume as "working" if it was in progress before restart
				this.state.status = "idle" // Reset to idle - agent can resume via conversation
			}
			// Society Agent end

			getLog().info(`${this.state.identity.id}: Loaded ${this.state.conversationHistory.length} messages from disk${parsed.currentTask ? ` (had task: ${parsed.currentTask.substring(0, 50)}...)` : ""}`)
		} catch (err: any) {
			if (err.code !== "ENOENT") {
				throw err
			}
			// File doesn't exist - that's fine for new agents
		}
	}

	/**
	 * Save current history to disk
	 */
	async saveHistoryToDisk(): Promise<void> {
		if (!this.persistHistory) return

		try {
			// Ensure directory exists
			await fs.mkdir(this.historyDir, { recursive: true })

			const data = {
				agentId: this.state.identity.id,
				savedAt: Date.now(),
				messages: this.state.conversationHistory,
				summary: this.conversationSummary,
				backups: this.backupsEnabled ? this.historyBackups : [],
				// Society Agent start - persist task state for restart recovery
				currentTask: this.state.currentTask,
				status: this.state.status,
				// Society Agent end
			}

			const filePath = this.getHistoryFilePath()
			await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8")

			// Check if we need to cleanup old files
			await this.cleanupOldHistory()

			getLog().debug(`${this.state.identity.id}: Saved history to disk`)
		} catch (err) {
			getLog().error(`${this.state.identity.id}: Failed to save history: ${err}`)
			throw err
		}
	}

	/**
	 * Delete persisted history for this agent
	 */
	async deletePersistedHistory(): Promise<void> {
		try {
			const filePath = this.getHistoryFilePath()
			await fs.unlink(filePath)
			getLog().info(`${this.state.identity.id}: Deleted persisted history`)
		} catch (err: any) {
			if (err.code !== "ENOENT") {
				throw err
			}
			// File doesn't exist - that's fine
		}
	}

	/**
	 * Cleanup old history files to stay within maxHistoryMB limit
	 * Removes oldest files first until total size is under limit
	 */
	private async cleanupOldHistory(): Promise<void> {
		try {
			const files = await fs.readdir(this.historyDir)
			const historyFiles = files.filter(f => f.endsWith(".json"))

			if (historyFiles.length === 0) return

			// Get file stats
			const fileStats = await Promise.all(
				historyFiles.map(async f => {
					const filePath = path.join(this.historyDir, f)
					const stat = await fs.stat(filePath)
					return { name: f, path: filePath, size: stat.size, mtime: stat.mtime.getTime() }
				})
			)

			// Calculate total size
			let totalSize = fileStats.reduce((sum, f) => sum + f.size, 0)
			const maxBytes = this.maxHistoryMB * 1024 * 1024

			if (totalSize <= maxBytes) return

			// Sort by modification time (oldest first)
			fileStats.sort((a, b) => a.mtime - b.mtime)

			// Delete oldest files until under limit (but never delete current agent's file)
			const currentFile = this.getHistoryFilePath()
			for (const file of fileStats) {
				if (totalSize <= maxBytes) break
				if (file.path === currentFile) continue // Don't delete current agent's file

				await fs.unlink(file.path)
				totalSize -= file.size
				getLog().info(`${this.state.identity.id}: Deleted old history file ${file.name} to free space`)
			}
		} catch (err) {
			getLog().warn(`${this.state.identity.id}: History cleanup failed: ${err}`)
		}
	}

	/**
	 * Check if backups are enabled for this agent
	 */
	isBackupsEnabled(): boolean {
		return this.backupsEnabled
	}

	/**
	 * Enable or disable backups at runtime
	 */
	setBackupsEnabled(enabled: boolean): void {
		this.backupsEnabled = enabled
		if (!enabled) {
			this.historyBackups = [] // Clear existing backups when disabled
		}
		getLog().info(`${this.state.identity.id}: Backups ${enabled ? "enabled" : "disabled"}`)
	}
	// Society Agent end

	/**
	 * Update agent status
	 */
	private setStatus(status: AgentState["status"]): void {
		// Society Agent start
		this.state.status = status
		this.onStatusChange?.(status)
		// Society Agent end
	}

	/**
	 * Add message to conversation history
	 */
	private async addMessage(role: "user" | "assistant", content: string): Promise<AgentMessage> {
		// Society Agent start
		const message: AgentMessage = {
			role,
			content,
			timestamp: Date.now(),
		}
		this.state.conversationHistory.push(message)
		this.onMessage?.(message)

		// Society Agent start - Token-based summarization threshold
		const tokenCount = this.estimateTokenCount()
		const contextPercent = (tokenCount / this.contextWindowSize) * 100
		
		// Summarize if we exceed the token threshold OR the message count threshold (fallback)
		const shouldSummarize = contextPercent >= this.contextThresholdPercent || 
			this.state.conversationHistory.length >= this.summaryThreshold
		
		if (shouldSummarize) {
			getLog().info(`${this.state.identity.id}: Triggering summarization (${tokenCount} tokens, ${contextPercent.toFixed(1)}% of context, ${this.state.conversationHistory.length} messages)`)
			await this.summarizeOldMessages()
		}
		// Society Agent end

		// Society Agent start - persist to disk after each message for restart recovery
		if (this.persistHistory) {
			this.saveHistoryToDisk().catch(err => {
				getLog().warn(`${this.state.identity.id}: Failed to persist message: ${err}`)
			})
		}
		// Society Agent end

		return message
		// Society Agent end
	}

	/**
	 * Add message with attachments to conversation history
	 * Society Agent - supports image attachments
	 */
	private async addMessageWithAttachments(role: "user" | "assistant", content: string, attachments: any[]): Promise<AgentMessage> {
		const message: AgentMessage = {
			role,
			content,
			timestamp: Date.now(),
			attachments,
		}
		this.state.conversationHistory.push(message)
		this.onMessage?.(message)

		// Check summarization threshold
		const tokenCount = this.estimateTokenCount()
		const contextPercent = (tokenCount / this.contextWindowSize) * 100
		const shouldSummarize = contextPercent >= this.contextThresholdPercent || 
			this.state.conversationHistory.length >= this.summaryThreshold
		
		if (shouldSummarize) {
			getLog().info(`${this.state.identity.id}: Triggering summarization (${tokenCount} tokens, ${contextPercent.toFixed(1)}% of context, ${this.state.conversationHistory.length} messages)`)
			await this.summarizeOldMessages()
		}

		// Society Agent start - persist to disk after each message for restart recovery
		if (this.persistHistory) {
			this.saveHistoryToDisk().catch(err => {
				getLog().warn(`${this.state.identity.id}: Failed to persist message: ${err}`)
			})
		}
		// Society Agent end

		return message
	}

	/**
	 * Send message to agent (from human or supervisor)
	 */
	async sendMessage(content: string): Promise<string> {
		// Society Agent start
		await this.addMessage("user", content)
		this.setStatus("working")

		try {
			const response = await this.callLLM()
			await this.addMessage("assistant", response)
			this.setStatus("idle")
			return response
		} catch (error) {
			this.setStatus("error")
			throw error
		}
		// Society Agent end
	}

	/**
	 * Send message and stream response (yields chunks as they arrive)
	 * @param content - string or array of content blocks (text, image)
	 */
	async *sendMessageStream(content: string | any[]): AsyncGenerator<string, void, unknown> {
		// Society Agent start
		const displayText = typeof content === "string" ? content : content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n") || "[attachments]"
		await this.addMessage("user", displayText)

		// If content is an array with images, we need to pass it as structured content
		if (Array.isArray(content)) {
			// Store the structured content for the LLM call
			this._pendingContent = content
		}

		this.setStatus("working")

		try {
			let fullResponse = ""

			// Stream from LLM
			for await (const chunk of this.callLLMStream()) {
				fullResponse += chunk
				yield chunk
			}

			await this.addMessage("assistant", fullResponse)
			this.setStatus("idle")
		} catch (error) {
			this.setStatus("error")
			throw error
		}
		// Society Agent end
	}

	/**
	 * Assign task to agent
	 */
	async assignTask(task: string, outputDir?: string): Promise<void> {
		// Society Agent start
		this.state.currentTask = task
		this.state.status = "working"

		getLog().info(`${this.state.identity.id} received task: ${task}`)
		if (outputDir) {
			getLog().info(`${this.state.identity.id} will use directory: ${outputDir}`)
		}

		// Start working on the task
		this.executeTask(task, outputDir).catch((error) => {
			getLog().error(`${this.state.identity.id} task execution failed:`, error)
			this.state.status = "error"
		})
		// Society Agent end
	}

	/**
	 * Execute the assigned task
	 */
	private async executeTask(task: string, supervisorOutputDir?: string): Promise<void> {
		// Society Agent start - LLM-driven intent and folder decisions
		getLog().info(`${this.state.identity.id} starting work on task...`)

		// Step 1: Ask LLM to classify the task intent
		const intentPrompt = `Task: "${task}"

What type of response does this task require?

A) TEXT_ONLY - Just answer with text/output (e.g., "Print numbers 1 to 5", "What is X?", "Calculate sum")
B) CREATE_FILES - Create actual files in workspace (e.g., "Create a Python program", "Build REST API", "Generate test files")
C) EXECUTE_AND_SHOW - Write code, execute it, show output (e.g., "Run a simulation", "Process data and show results")

Respond with ONLY the letter (A, B, or C):`

		try {
			const intentResponse = await this.sendMessage(intentPrompt)
			const intent = intentResponse.trim().toUpperCase().charAt(0)

			getLog().info(
				`${this.state.identity.id} classified task as: ${intent === "A" ? "TEXT_ONLY" : intent === "B" ? "CREATE_FILES" : "EXECUTE_AND_SHOW"}`,
			)

			// Step 2: For file creation, ask AI where to put files
			// Society Agent - Use dedicated projects/ directory to separate from extension code
			const BASE_OUTPUT_DIR = "projects"
			let outputDir = supervisorOutputDir || `${BASE_OUTPUT_DIR}/temp`

			// Only run folder decision if supervisor didn't already decide
			if (!supervisorOutputDir && (intent === "B" || intent === "C")) {
				// Society Agent - Check if user explicitly specified a folder in the task
				const explicitPathMatch = task.match(
					/(?:in|to|at|into|under)\s+(?:folder\s+)?["`']?([a-zA-Z0-9_\-\/]+)["`']?/i,
				)
				if (explicitPathMatch) {
					const userPath = explicitPathMatch[1]
					outputDir = userPath.startsWith(BASE_OUTPUT_DIR) ? userPath : `${BASE_OUTPUT_DIR}/${userPath}`
					getLog().info(`User specified folder: ${outputDir}`)
				} else {
					// No explicit path - run AI folder decision
					// Get workspace context
					const fs = await import("fs/promises")
					const path = await import("path")
					let workspaceStructure = "Empty workspace"
					let sessionContext = "No previous work"

					try {
						// Try to read session context
						const contextPath = path.join(this.workspacePath, `${BASE_OUTPUT_DIR}/.session-context.json`)
						const contextData = await fs.readFile(contextPath, "utf-8")
						const context = JSON.parse(contextData)
						sessionContext = `Current project: ${context.currentProject || "none"}
Last 3 purposes:
${
	context.purposeHistory
		?.slice(-3)
		.map((p: any) => `  • "${p.description}" → ${p.path}`)
		.join("\n") || "  (none)"
}`
					} catch {
						// No context yet, first purpose
					}

					try {
						// Get workspace structure (projects/ directory only)
						const projectsPath = path.join(this.workspacePath, BASE_OUTPUT_DIR)
						try {
							await fs.mkdir(projectsPath, { recursive: true })
						} catch {
							// Directory exists
						}
						const entries = await fs.readdir(projectsPath, { withFileTypes: true })
						const dirs = entries
							.filter((e) => e.isDirectory() && !e.name.startsWith("."))
							.map((e) => e.name)
						workspaceStructure = dirs.length > 0 ? dirs.join(", ") : "Empty workspace"
					} catch {
						// Can't read workspace
					}

					const folderPrompt = `Task: "${task}"

WORKSPACE CONTEXT:
${sessionContext}

EXISTING PROJECTS:
${workspaceStructure}

ANALYZE THE USER'S INTENT:

1. CHECK FOR EXPLICIT PROJECT MENTION:
   - Does the user mention a specific project name?
   - Example: "Add auth to the calculator" → mentions "calculator"
   - Example: "Improve the e-commerce API" → mentions "e-commerce"

2. CHECK FOR EXISTING PROJECT MATCH:
   - Does the task relate to an existing project?
   - Look for keywords in existing project names
   - Example: task mentions "calculator", folder "calculator" exists → REUSE IT

3. CHECK CONTINUATION:
   - If current project exists and user doesn't mention switching → CONTINUE
   - Only create NEW if explicitly requested or clearly different

RULES:
- PREFER REUSING existing folders over creating duplicates
- Match keywords: "calculator" matches "calculator", "calc", "simple-calculator"
- If user says "the X project", reuse existing X folder
- If current project active and task doesn't mention new project → CONTINUE
- Only create NEW when: explicitly requested, or no matching folder exists

Respond with JSON:
{
  "action": "continue|reuse|new",
  "path": "project-name",
  "projectName": "descriptive-name",
  "reasoning": "why you chose this",
  "matched": "folder-name-if-reusing"
}

Examples:
- Task: "Add tests to calculator", Existing: ["calculator"] → {"action": "reuse", "path": "calculator", "matched": "calculator"}
- Task: "Improve the API", Current: "ecommerce-api" → {"action": "continue", "path": "ecommerce-api"}
- Task: "Create new mobile app" → {"action": "new", "path": "mobile-app"}
- Task: "Fix bugs", Current: "calculator", Existing: ["calculator"] → {"action": "continue", "path": "calculator"}

Respond with JSON now:`

					const folderResponse = await this.sendMessage(folderPrompt)
					let folderJson = folderResponse.trim()
					if (folderJson.includes("```")) {
						const match = folderJson.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
						if (match) folderJson = match[1]
					}

					const folderDecision = JSON.parse(folderJson)
					outputDir = `${BASE_OUTPUT_DIR}/${folderDecision.path}`

					const actionLabel =
						folderDecision.action === "reuse"
							? "REUSE"
							: folderDecision.action === "continue"
								? "CONTINUE"
								: "NEW"
					getLog().info(`AI decided: ${actionLabel} → ${outputDir}`)
					getLog().info(`Reasoning: ${folderDecision.reasoning}`)
					if (folderDecision.matched) {
						getLog().info(`Reusing existing folder: ${folderDecision.matched}`)
					}

					// Update session context
					try {
						const contextPath = path.join(this.workspacePath, `${BASE_OUTPUT_DIR}/.session-context.json`)
						await fs.mkdir(path.dirname(contextPath), { recursive: true })

						let context: any = { purposeHistory: [] }
						try {
							const existing = await fs.readFile(contextPath, "utf-8")
							context = JSON.parse(existing)
						} catch {
							// New context file
						}

						context.currentProject = folderDecision.projectName
						context.currentProjectPath = outputDir
						context.purposeHistory = context.purposeHistory || []
						context.purposeHistory.push({
							description: task,
							path: outputDir,
							timestamp: Date.now(),
						})

						// Keep only last 10 purposes
						if (context.purposeHistory.length > 10) {
							context.purposeHistory = context.purposeHistory.slice(-10)
						}

						await fs.writeFile(contextPath, JSON.stringify(context, null, 2))
						getLog().info(`Updated session context: project = ${folderDecision.projectName}`)
					} catch (error) {
						getLog().warn(`Could not update session context:`, error)
					}
				} // Society Agent - Close else block for AI folder decision
			}

			// Handle based on intent
			if (intent === "A") {
				// TEXT_ONLY: Just get the answer and log it
				const answer = await this.sendMessage(task)
				getLog().info(`${this.state.identity.id} response:`, answer)
				this.addMessage("assistant", answer)

				// Save response to a results file
				const resultsPath = `${outputDir}/response.txt`
				await this.createFile(resultsPath, answer)

				this.setStatus("completed")
				return
			}

			if (intent === "C") {
				// EXECUTE_AND_SHOW: Create code, run it, capture output
				const codePrompt = `${task}

Write code to accomplish this task, then I'll execute it and show you the output.

Respond with a JSON object:
{
  "code": "your code here",
  "language": "python|javascript|bash",
  "filename": "script.py"
}

Respond with ONLY the JSON:`

				const codeResponse = await this.sendMessage(codePrompt)
				let jsonText = codeResponse.trim()
				if (jsonText.includes("```")) {
					const match = jsonText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
					if (match) jsonText = match[1]
				}

				const codeData = JSON.parse(jsonText)
				// Use AI-decided output directory
				await this.createFile(`${outputDir}/${codeData.filename}`, codeData.code)

				// Note: Actual execution would happen here in full implementation
				getLog().info(`${this.state.identity.id} created executable code at ${outputDir}`)
				this.setStatus("completed")
				return
			}

			// B) CREATE_FILES: Original file creation logic
			const workPrompt = `Your task: ${task}

Create the ACTUAL FILES directly in your response.

Respond with ONLY a JSON object listing every file to create:

{
  "files": [
    {"name": "file1.txt", "content": "actual content"},
    {"name": "file2.txt", "content": "actual content"}
  ]
}

IMPORTANT:
- Include the actual content for each file
- Use just the filename, not full path (we'll handle directory placement)
- Do NOT create helper scripts unless explicitly required

Respond with the complete JSON now:`

			const response = await this.sendMessage(workPrompt)
			getLog().info(`${this.state.identity.id} received implementation plan`)
			getLog().info(`${this.state.identity.id} LLM response:`, response.substring(0, 500))

			// Extract JSON from response
			let jsonText = response.trim()
			if (jsonText.includes("```")) {
				const match = jsonText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
				if (match) jsonText = match[1]
			}
			const jsonMatch = jsonText.match(/\{[\s\S]*"files"[\s\S]*\}/)
			if (jsonMatch) jsonText = jsonMatch[0]

			const parsed = JSON.parse(jsonText)
			const files = parsed.files || []

			if (files.length === 0) {
				getLog().warn(`${this.state.identity.id} parsed 0 files from response!`)
				getLog().warn(`Raw JSON: ${jsonText}`)
			}

			getLog().info(`${this.state.identity.id} creating files in: ${outputDir}`)

			// Create the files in AI-decided directory
			for (const file of files) {
				const filePath = `${outputDir}/${file.name || file.path}` // Support both formats
				await this.createFile(filePath, file.content)
			}

			getLog().info(`${this.state.identity.id} created ${files.length} files in ${outputDir}`)
			this.setStatus("completed")
		} catch (error) {
			getLog().error(`${this.state.identity.id} failed to execute task:`, error)
			// Fallback: create a simple status file
			const errorDir = `.society-agent/outputs/error-${Date.now()}`
			await this.createFile(`${errorDir}/status.txt`, `Task: ${task}\nStatus: Error\nError: ${error}`)
			this.setStatus("completed")
		}
		// Society Agent end
	}

	// Society Agent start - Extract files from a chat response and create them
	/**
	 * After a chat response, scan for file blocks and create them in the workspace.
	 * Detects:
	 *   1. JSON { "files": [...] } blocks
	 *   2. Markdown code blocks with filenames (```filename or ```lang // filename)
	 * Returns the number of files created.
	 */
	async extractAndCreateFiles(response: string): Promise<number> {
		let filesCreated = 0

		// Strategy 1: Look for JSON {"files": [...]} block (possibly inside ```json code block)
		// First strip markdown code block wrapping if present
		let searchText = response
		const codeBlockJsonMatch = response.match(/```json\s*\n([\s\S]*?)```/)
		if (codeBlockJsonMatch) {
			searchText = codeBlockJsonMatch[1]
		}
		const jsonMatch = searchText.match(/\{[\s\S]*?"files"\s*:\s*\[[\s\S]*\]\s*\}/)
		if (jsonMatch) {
			try {
				const parsed = JSON.parse(jsonMatch[0])
				if (Array.isArray(parsed.files) && parsed.files.length > 0) {
					for (const file of parsed.files) {
						const name = file.name || file.path || file.filename
						if (name && file.content) {
							await this.createFile(name, file.content)
							filesCreated++
						}
					}
					if (filesCreated > 0) return filesCreated
				}
			} catch {
				// Not valid JSON, try other strategies
			}
		}

		// Strategy 2: Look for markdown code blocks with filenames
		// Patterns: ```filename.ext, ```lang:filename.ext, <!-- filename.ext -->
		const codeBlockRegex = /(?:<!--\s*(\S+\.\w+)\s*-->|#+\s*`?(\S+\.\w+)`?)\s*\n```[\w]*\n([\s\S]*?)```/g
		let match
		while ((match = codeBlockRegex.exec(response)) !== null) {
			const filename = match[1] || match[2]
			const content = match[3].trim()
			if (filename && content) {
				await this.createFile(filename, content)
				filesCreated++
			}
		}

		// Society Agent start - Strategy 3: Code blocks preceded by filename mentions
		// Matches patterns like "**`hello.html`**:\n```html" or "File: hello.html\n```" or "### `hello.html`\n```"
		if (filesCreated === 0) {
			const flexibleRegex = /(?:\*{0,2}`?([a-zA-Z0-9_/.-]+\.[a-zA-Z]{1,10})`?\*{0,2}[:\s]*)\n```[\w]*\n([\s\S]*?)```/g
			let flexMatch
			while ((flexMatch = flexibleRegex.exec(response)) !== null) {
				const filename = flexMatch[1].trim()
				const content = flexMatch[2].trim()
				// Filter out false positives — filename must look like a path
				if (filename && content && /\.(html|css|js|ts|py|json|md|tsx|jsx|svg|xml|yaml|yml|sh|sql|txt|cfg|ini|toml|rs|go|java|c|cpp|h|rb|php)$/i.test(filename)) {
					// Society Agent - Extra safety: skip if content looks like agent's conversational text
					const looksLikeConversation = /^(I'll|I will|Let me|Now let|Here's|This is|The |You |If you|First|Next|To |Great|Perfect|Done|Now |Okay|I can|I need|I should|Looking|Checking|Running|Starting|Stopping|Created|Updated|Deleted|Error|Warning|Note:)/i.test(content)
					const tooShort = content.length < 10
					const noCodeChars = !/[{}\[\];=<>()"]|function|const|let|var|import|export|class|def |return|if |for |while /i.test(content)
					
					if (looksLikeConversation || (tooShort && noCodeChars)) {
						getLog().warn(`Skipping suspicious file content for ${filename}: "${content.substring(0, 50)}..."`)
						continue
					}
					
					await this.createFile(filename, content)
					filesCreated++
				}
			}
		}
		// Society Agent end

		return filesCreated
	}
	// Society Agent end

	/**
	 * Get the workspace path for this agent
	 */
	getWorkspacePath(): string { return this.workspacePath } // Society Agent

	/**
	 * Create a file in the workspace
	 */
	private async createFile(relativePath: string, content: string): Promise<void> {
		// Society Agent start
		const fullPath = path.join(this.workspacePath, relativePath)
		const dir = path.dirname(fullPath)

		getLog().info(`${this.state.identity.id} workspace path: ${this.workspacePath}`)
		getLog().info(`${this.state.identity.id} full file path: ${fullPath}`)

		// Create directory if needed
		await fs.mkdir(dir, { recursive: true })

		// Write file
		await fs.writeFile(fullPath, content, "utf-8")

		getLog().info(`${this.state.identity.id} created file: ${relativePath}`)
		this.addMessage("assistant", `Created file: ${relativePath}`)

		// Society Agent start - notify about file creation
		this.onFileCreated?.(relativePath, fullPath, Buffer.byteLength(content, "utf-8"))
		// Society Agent end
		// Society Agent end
	}

	/**
	 * Get default system prompt for agent
	 */
	private getDefaultSystemPrompt(): string {
		// Society Agent start - all agents are the same, unified prompt
		return `You are an AI Agent in a collaborative multi-agent system.

Your capabilities:
- Implement code and solutions
- Analyze and review work
- Test and validate
- Collaborate with other agents

Guidelines:
- Be thorough and precise
- Report progress clearly
- Ask for clarification when needed
- Collaborate with other agents when beneficial

Response format:
- Always end your response with a SHORT SUMMARY (1-3 sentences) of what you did or decided
- The summary helps others quickly understand without reading everything`
		// Society Agent end
	}

	/**
	 * Call LLM with current conversation context
	 */
	private async callLLM(): Promise<string> {
		// Society Agent start
		getLog().info(`Calling LLM for ${this.state.identity.id}...`)

		// Convert conversation history to Anthropic format
		const messages: Anthropic.MessageParam[] = this.state.conversationHistory.map((msg) => ({
			role: msg.role === "user" ? "user" : "assistant",
			content: msg.content,
		}))

		try {
			// Use ApiHandler.createMessage to get stream
			const systemPrompt = this.state.systemPrompt || this.getDefaultSystemPrompt()
			const stream = this.apiHandler.createMessage(systemPrompt, messages)

			let fullResponse = ""

			// Collect streamed response
			for await (const chunk of stream) {
				if (chunk.type === "text") {
					fullResponse += chunk.text
				}
			}

			getLog().info(`LLM response received (${fullResponse.length} chars)`)
			return fullResponse.trim()
		} catch (error) {
			getLog().error(`LLM call failed for ${this.state.identity.id}:`, error)
			throw error
		}
		// Society Agent end
	}

	/**
	 * Call LLM with streaming (yields chunks as they arrive)
	 */
	private async *callLLMStream(): AsyncGenerator<string, void, unknown> {
		// Society Agent start
		getLog().info(`Streaming LLM call for ${this.state.identity.id}...`)

		// Convert conversation history to Anthropic format
		const messages: Anthropic.MessageParam[] = this.state.conversationHistory.map((msg, i) => {
			// If this is the last user message and we have pending structured content, use it
			if (
				this._pendingContent &&
				msg.role === "user" &&
				i === this.state.conversationHistory.length - 1
			) {
				const content = this._pendingContent
				this._pendingContent = undefined
				return { role: "user" as const, content }
			}
			return {
				role: msg.role === "user" ? ("user" as const) : ("assistant" as const),
				content: msg.content,
			}
		})

		try {
			// Society Agent: Prepend summary as system context if exists
			let systemPrompt = this.state.systemPrompt || this.getDefaultSystemPrompt()
			if (this.conversationSummary) {
				systemPrompt += `\n\n## Previous Conversation Summary\n${this.conversationSummary}\n\nThe messages below are the recent conversation. Use the summary for older context.`
			}

			const stream = this.apiHandler.createMessage(systemPrompt, messages)

			// Yield chunks as they arrive
			for await (const chunk of stream) {
				if (chunk.type === "text") {
					yield chunk.text
				}
			}

			getLog().info(`LLM streaming completed for ${this.state.identity.id}`)
		} catch (error) {
			getLog().error(`LLM streaming failed for ${this.state.identity.id}:`, error)
			throw error
		}
		// Society Agent end
	}

	/**
	 * Society Agent: Summarize old messages using Society Agent's built-in summarization
	 */
	private async summarizeOldMessages(): Promise<void> {
		// Society Agent start
		const tokenCountBefore = this.estimateTokenCount()
		const contextPercent = (tokenCountBefore / this.contextWindowSize) * 100
		const messageCountBefore = this.state.conversationHistory.length

		// Check if we should actually summarize (token-based or message-based threshold)
		const shouldSummarize = contextPercent >= this.contextThresholdPercent || 
			messageCountBefore >= this.summaryThreshold

		if (!shouldSummarize) {
			return // Not at threshold yet
		}

		getLog().info(
			`${this.state.identity.id}: Using Society Agent's summarization (${messageCountBefore} messages, ~${tokenCountBefore} tokens, ${contextPercent.toFixed(1)}% context)...`,
		)

		// Society Agent start - BACKUP full history before summarizing (if enabled)
		if (this.backupsEnabled) {
			const backup = {
				timestamp: Date.now(),
				messages: [...this.state.conversationHistory],
				tokenCount: tokenCountBefore,
				reason: `Auto-summarization at ${contextPercent.toFixed(1)}% context (${messageCountBefore} messages, ~${tokenCountBefore} tokens)`,
			}
			this.historyBackups.push(backup)
			// Keep only last 5 backups to avoid unbounded memory growth
			if (this.historyBackups.length > 5) {
				this.historyBackups.shift()
			}
			getLog().info(`${this.state.identity.id}: Saved backup #${this.historyBackups.length} before summarization`)
		}
		// Society Agent end

		// Society Agent - notify UI with metadata
		this.onSummarizationStart?.({ messageCount: messageCountBefore, tokenCount: tokenCountBefore, contextPercent })

		try {
			// Convert to ApiMessage format (Society Agent's format)
			const apiMessages: ApiMessage[] = this.state.conversationHistory.map((msg) => ({
				role: msg.role,
				content: msg.content,
			}))

			// Use Society Agent's built-in summarization
			const result = await summarizeConversation(
				apiMessages,
				this.apiHandler,
				this.systemPrompt,
				this.state.identity.id, // taskId
				tokenCountBefore, // prevContextTokens - now we pass this correctly
				true, // isAutomaticTrigger
				undefined, // customCondensingPrompt
				undefined, // condensingApiHandler
				this.preserveFirstMessage, // Society Agent - option to drop first message
			)

			if (result.error) {
				getLog().error(`${this.state.identity.id}: Summarization error:`, result.error)
				// Still notify UI of failure
				this.onSummarizationEnd?.({
					summary: "",
					messageCountBefore,
					messageCountAfter: this.state.conversationHistory.length,
					tokensBefore: tokenCountBefore,
					tokensAfter: tokenCountBefore,
					cost: 0,
					error: result.error,
				})
				return
			}

			// Update history with summarized messages
			this.state.conversationHistory = result.messages.map((msg, idx) => ({
				role: msg.role as "user" | "assistant",
				content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
				timestamp: this.state.conversationHistory[idx]?.timestamp || Date.now(),
			}))

			// Store summary for reference
			this.conversationSummary = result.summary

			const tokenCountAfter = this.estimateTokenCount()
			getLog().info(
				`${this.state.identity.id}: Summarized conversation (${messageCountBefore} → ${result.messages.length} messages, ~${tokenCountBefore} → ~${tokenCountAfter} tokens, $${result.cost.toFixed(4)})`,
			)

			// Society Agent start - persist to disk after summarization
			if (this.persistHistory) {
				this.saveHistoryToDisk().catch(err => {
					getLog().warn(`${this.state.identity.id}: Failed to persist after summarization: ${err}`)
				})
			}
			// Society Agent end

			// Society Agent - notify UI with full metadata including token stats
			this.onSummarizationEnd?.({
				summary: result.summary,
				messageCountBefore,
				messageCountAfter: result.messages.length,
				tokensBefore: tokenCountBefore,
				tokensAfter: tokenCountAfter,
				cost: result.cost,
			})
		} catch (error) {
			getLog().error(`${this.state.identity.id}: Summarization failed:`, error)
			this.onSummarizationEnd?.({
				summary: "",
				messageCountBefore,
				messageCountAfter: this.state.conversationHistory.length,
				tokensBefore: tokenCountBefore,
				tokensAfter: tokenCountBefore,
				cost: 0,
				error: String(error),
			})
		}
		// Society Agent end
	}

	/**
	 * Pause agent execution
	 */
	pause(): void {
		// Society Agent start
		this.setStatus("paused")
		// Society Agent end
	}

	/**
	 * Resume agent execution
	 */
	resume(): void {
		// Society Agent start
		if (this.state.status === "paused") {
			this.setStatus("idle")
		}
		// Society Agent end
	}

	/**
	 * Mark task as completed
	 */
	complete(): void {
		// Society Agent start
		this.state.currentTask = undefined
		this.setStatus("completed")
		// Society Agent end
	}

	/**
	 * Set metadata
	 */
	setMetadata(key: string, value: unknown): void {
		// Society Agent start
		this.state.metadata[key] = value
		// Society Agent end
	}

	/**
	 * Get metadata
	 */
	getMetadata(key: string): unknown {
		// Society Agent start
		return this.state.metadata[key]
		// Society Agent end
	}
}
