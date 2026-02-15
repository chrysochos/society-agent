// kilocode_change - new file
/**
 * ConversationAgent - Base agent implementation as LLM conversation thread
 *
 * Each agent maintains its own conversation history with the LLM, enabling
 * autonomous decision-making and task execution while preserving context.
 *
 * Inherits Kilo's built-in conversation summarization for automatic memory management.
 */

import Anthropic from "@anthropic-ai/sdk"
import { ApiHandler } from "../../api"
import { ApiStream } from "../../api/transform/stream"
import { ApiMessage } from "../../core/task-persistence/apiMessages"
import { summarizeConversation } from "../../core/condense"
import * as fs from "fs/promises"
import * as path from "path"
import { getLog } from "./logger" // kilocode_change

// kilocode_change start
export interface AgentIdentity {
	id: string
	role: "supervisor" | "worker"
	workerType?: "backend" | "frontend" | "security" | "tester" | "devops" | "custom"
	capabilities: string[]
	createdAt: number
}

export interface AgentMessage {
	role: "user" | "assistant"
	content: string
	timestamp: number
}

export interface AgentState {
	identity: AgentIdentity
	conversationHistory: AgentMessage[]
	currentTask?: string
	status: "idle" | "working" | "waiting" | "paused" | "error" | "completed"
	metadata: Record<string, unknown>
	systemPrompt?: string // kilocode_change - used by callLLM methods
}

export interface ConversationAgentConfig {
	identity: AgentIdentity
	apiHandler: ApiHandler
	systemPrompt?: string
	workspacePath?: string
	onMessage?: (message: AgentMessage) => void
	onStatusChange?: (status: AgentState["status"]) => void
	onFileCreated?: (relativePath: string, fullPath: string, size: number) => void // kilocode_change - file tracking
	maxMessages?: number // Max messages before summarization (default: 50)
	summaryThreshold?: number // When to trigger summary (default: 40)
}
// kilocode_change end

/**
 * Base agent that uses LLM conversation thread for autonomous operation
 */
export class ConversationAgent {
	// kilocode_change start
	private state: AgentState
	private apiHandler: ApiHandler
	private systemPrompt: string
	private workspacePath: string
	private onMessage?: (message: AgentMessage) => void
	private onStatusChange?: (status: AgentState["status"]) => void
	private onFileCreated?: (relativePath: string, fullPath: string, size: number) => void // kilocode_change
	private _pendingContent?: any[] // kilocode_change - structured content blocks for images - file tracking
	private maxMessages: number // Kilocode: Max messages before summarization
	private summaryThreshold: number // Kilocode: When to trigger summary
	private conversationSummary: string = "" // Kilocode: Summarized older context
	// kilocode_change end

	constructor(config: ConversationAgentConfig) {
		// kilocode_change start
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
		this.onFileCreated = config.onFileCreated // kilocode_change - file tracking
		// Kilocode: Memory management configuration
		this.maxMessages = config.maxMessages || 50
		this.summaryThreshold = config.summaryThreshold || 40
		this.conversationSummary = ""
		// kilocode_change end
	}

	/**
	 * Get agent identity
	 */
	getIdentity(): AgentIdentity {
		// kilocode_change start
		return this.state.identity
		// kilocode_change end
	}

	/**
	 * Get current agent state
	 */
	getState(): AgentState {
		// kilocode_change start
		return { ...this.state }
		// kilocode_change end
	}

	/**
	 * Get conversation history
	 */
	getHistory(): AgentMessage[] {
		// kilocode_change start
		return [...this.state.conversationHistory]
		// kilocode_change end
	}

	// kilocode_change start - expose conversation summary and clear history
	/**
	 * Get the auto-summarized conversation context (if any)
	 */
	getSummary(): string {
		return this.conversationSummary
	}

	/**
	 * Clear all conversation history and summary.
	 * Agent becomes a blank slate but keeps its identity/config.
	 */
	clearHistory(): void {
		this.state.conversationHistory = []
		this.conversationSummary = ""
		this.state.currentTask = undefined
		this.setStatus("idle")
		getLog().info(`${this.state.identity.id}: History cleared`)
	}
	// kilocode_change end

	/**
	 * Update agent status
	 */
	private setStatus(status: AgentState["status"]): void {
		// kilocode_change start
		this.state.status = status
		this.onStatusChange?.(status)
		// kilocode_change end
	}

	/**
	 * Add message to conversation history
	 */
	private async addMessage(role: "user" | "assistant", content: string): Promise<AgentMessage> {
		// kilocode_change start
		const message: AgentMessage = {
			role,
			content,
			timestamp: Date.now(),
		}
		this.state.conversationHistory.push(message)
		this.onMessage?.(message)

		// Kilocode: Auto-summarize if conversation getting long
		if (this.state.conversationHistory.length >= this.summaryThreshold) {
			await this.summarizeOldMessages()
		}

		return message
		// kilocode_change end
	}

	/**
	 * Send message to agent (from human or supervisor)
	 */
	async sendMessage(content: string): Promise<string> {
		// kilocode_change start
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
		// kilocode_change end
	}

	/**
	 * Send message and stream response (yields chunks as they arrive)
	 * @param content - string or array of content blocks (text, image)
	 */
	async *sendMessageStream(content: string | any[]): AsyncGenerator<string, void, unknown> {
		// kilocode_change start
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
		// kilocode_change end
	}

	/**
	 * Assign task to agent
	 */
	async assignTask(task: string, outputDir?: string): Promise<void> {
		// kilocode_change start
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
		// kilocode_change end
	}

	/**
	 * Execute the assigned task
	 */
	private async executeTask(task: string, supervisorOutputDir?: string): Promise<void> {
		// kilocode_change start - LLM-driven intent and folder decisions
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
			// kilocode_change - Use dedicated projects/ directory to separate from extension code
			const BASE_OUTPUT_DIR = "projects"
			let outputDir = supervisorOutputDir || `${BASE_OUTPUT_DIR}/temp`

			// Only run folder decision if supervisor didn't already decide
			if (!supervisorOutputDir && (intent === "B" || intent === "C")) {
				// kilocode_change - Check if user explicitly specified a folder in the task
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
				} // kilocode_change - Close else block for AI folder decision
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
		// kilocode_change end
	}

	// kilocode_change start - Extract files from a chat response and create them
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

		return filesCreated
	}
	// kilocode_change end

	/**
	 * Get the workspace path for this agent
	 */
	getWorkspacePath(): string { return this.workspacePath } // kilocode_change

	/**
	 * Create a file in the workspace
	 */
	private async createFile(relativePath: string, content: string): Promise<void> {
		// kilocode_change start
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

		// kilocode_change start - notify about file creation
		this.onFileCreated?.(relativePath, fullPath, Buffer.byteLength(content, "utf-8"))
		// kilocode_change end
		// kilocode_change end
	}

	/**
	 * Get default system prompt for agent role
	 */
	private getDefaultSystemPrompt(): string {
		// kilocode_change start
		const { role, workerType } = this.state.identity

		if (role === "supervisor") {
			return `You are a Supervisor Agent in a multi-agent system.

Your responsibilities:
- Analyze purpose and create team of worker agents
- Delegate tasks to workers with clear context
- Monitor worker progress and status
- Resolve issues and guide stuck workers
- Escalate critical decisions to human
- Report completion with summary

You manage workers autonomously but escalate only strategic/critical decisions to the human.`
		}

		// Worker agent prompts by type
		const workerPrompts: Record<string, string> = {
			backend: `You are a Backend Developer Agent.

Your capabilities:
- Implement server-side logic and APIs
- Work with databases and data models
- Write backend tests
- Handle authentication and authorization
- Integrate with external services

Report progress to supervisor. Ask supervisor for guidance on decisions.`,

			frontend: `You are a Frontend Developer Agent.

Your capabilities:
- Build UI components and interfaces
- Implement client-side logic
- Style with CSS/design systems
- Handle state management
- Write frontend tests

Report progress to supervisor. Ask supervisor for guidance on decisions.`,

			security: `You are a Security Reviewer Agent.

Your capabilities:
- Audit code for vulnerabilities
- Review authentication/authorization
- Check for common security issues (XSS, CSRF, SQL injection)
- Validate input sanitization
- Review secrets management

Report findings to supervisor. Flag critical issues immediately.`,

			tester: `You are a Tester Agent.

Your capabilities:
- Write unit and integration tests
- Run test suites and validate results
- Identify edge cases
- Verify acceptance criteria
- Report test coverage

Report progress to supervisor. Flag test failures immediately.`,

			devops: `You are a DevOps Agent.

Your capabilities:
- Handle deployment and infrastructure
- Configure CI/CD pipelines
- Manage containers and orchestration
- Monitor application health
- Handle environment configuration

Report progress to supervisor. Ask supervisor for guidance on decisions.`,

			custom: `You are a Custom Worker Agent.

Follow instructions provided by the supervisor for your specific role and capabilities.`,
		}

		return workerPrompts[workerType || "custom"] || workerPrompts.custom
		// kilocode_change end
	}

	/**
	 * Call LLM with current conversation context
	 */
	private async callLLM(): Promise<string> {
		// kilocode_change start
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
		// kilocode_change end
	}

	/**
	 * Call LLM with streaming (yields chunks as they arrive)
	 */
	private async *callLLMStream(): AsyncGenerator<string, void, unknown> {
		// kilocode_change start
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
			// Kilocode: Prepend summary as system context if exists
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
		// kilocode_change end
	}

	/**
	 * Kilocode: Summarize old messages using Kilo's built-in summarization
	 */
	private async summarizeOldMessages(): Promise<void> {
		// kilocode_change start
		if (this.state.conversationHistory.length < this.summaryThreshold) {
			return // Not long enough yet
		}

		getLog().info(
			`${this.state.identity.id}: Using Kilo's summarization (${this.state.conversationHistory.length} messages)...`,
		)

		try {
			// Convert to ApiMessage format (Kilo's format)
			const apiMessages: ApiMessage[] = this.state.conversationHistory.map((msg) => ({
				role: msg.role,
				content: msg.content,
			}))

			// Use Kilo's built-in summarization
			const result = await summarizeConversation(
				apiMessages,
				this.apiHandler,
				this.systemPrompt,
				this.state.identity.id, // taskId
				0, // prevContextTokens (we'll implement proper tracking later)
				true, // isAutomaticTrigger
			)

			if (result.error) {
				getLog().error(`${this.state.identity.id}: Summarization error:`, result.error)
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

			getLog().info(
				`${this.state.identity.id}: Kilo summarized conversation (${result.messages.length} messages after, ${result.cost.toFixed(4)} cost)`,
			)
		} catch (error) {
			getLog().error(`${this.state.identity.id}: Kilo summarization failed:`, error)
		}
		// kilocode_change end
	}

	/**
	 * Pause agent execution
	 */
	pause(): void {
		// kilocode_change start
		this.setStatus("paused")
		// kilocode_change end
	}

	/**
	 * Resume agent execution
	 */
	resume(): void {
		// kilocode_change start
		if (this.state.status === "paused") {
			this.setStatus("idle")
		}
		// kilocode_change end
	}

	/**
	 * Mark task as completed
	 */
	complete(): void {
		// kilocode_change start
		this.state.currentTask = undefined
		this.setStatus("completed")
		// kilocode_change end
	}

	/**
	 * Set metadata
	 */
	setMetadata(key: string, value: unknown): void {
		// kilocode_change start
		this.state.metadata[key] = value
		// kilocode_change end
	}

	/**
	 * Get metadata
	 */
	getMetadata(key: string): unknown {
		// kilocode_change start
		return this.state.metadata[key]
		// kilocode_change end
	}
}
