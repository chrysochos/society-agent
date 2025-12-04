// kilocode_change - new file
/**
 * ConversationAgent - Base agent implementation as LLM conversation thread
 *
 * Each agent maintains its own conversation history with the LLM, enabling
 * autonomous decision-making and task execution while preserving context.
 */

import Anthropic from "@anthropic-ai/sdk"
import { ApiHandler } from "../../api"
import { ApiStream } from "../../api/transform/stream"
import * as fs from "fs/promises"
import * as path from "path"
import * as fs from "fs/promises"
import * as path from "path"

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
}

export interface ConversationAgentConfig {
	identity: AgentIdentity
	apiHandler: ApiHandler
	systemPrompt?: string
	workspacePath?: string
	onMessage?: (message: AgentMessage) => void
	onStatusChange?: (status: AgentState["status"]) => void
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
	// kilocode_change end

	constructor(config: ConversationAgentConfig) {
		// kilocode_change start
		this.workspacePath = config.workspacePath || process.cwd() // Use provided workspace or default to current directory
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
	private addMessage(role: "user" | "assistant", content: string): AgentMessage {
		// kilocode_change start
		const message: AgentMessage = {
			role,
			content,
			timestamp: Date.now(),
		}
		this.state.conversationHistory.push(message)
		this.onMessage?.(message)
		return message
		// kilocode_change end
	}

	/**
	 * Send message to agent (from human or supervisor)
	 */
	async sendMessage(content: string): Promise<string> {
		// kilocode_change start
		this.addMessage("user", content)
		this.setStatus("working")

		try {
			const response = await this.callLLM()
			this.addMessage("assistant", response)
			this.setStatus("idle")
			return response
		} catch (error) {
			this.setStatus("error")
			throw error
		}
		// kilocode_change end
	}

	/**
	 * Assign task to agent
	 */
	async assignTask(task: string): Promise<void> {
		// kilocode_change start
		this.state.currentTask = task
		this.state.status = "working"
		
		console.log(`✅ ${this.state.identity.id} received task: ${task}`)
		
		// Start working on the task
		this.executeTask(task).catch((error) => {
			console.error(`❌ ${this.state.identity.id} task execution failed:`, error)
			this.state.status = "error"
		})
		// kilocode_change end
	}

	/**
	 * Execute the assigned task
	 */
	private async executeTask(task: string): Promise<void> {
		// kilocode_change start
		console.log(`🚀 ${this.state.identity.id} starting work on task...`)
		
		// Check if task mentions delays/timing
		const hasDelay = /\d+\s*seconds?/i.test(task) || /delay/i.test(task) || /apart/i.test(task)
		const delayMatch = task.match(/(\d+)\s*seconds?/i)
		const delaySeconds = delayMatch ? parseInt(delayMatch[1]) : 0
		
		// Ask the LLM what to create
		const workPrompt = `Your task: ${task}

You must create the ACTUAL FILES directly in your response. Do NOT create scripts or programs that would create files later.

Respond with ONLY a JSON object listing every file to create:

{
  "files": [
    {"path": "file1.txt", "content": "actual content"},
    {"path": "file2.txt", "content": "actual content"},
    {"path": "file3.txt", "content": "actual content"}
  ]
}

IMPORTANT:
- If task says "create 10 files", list all 10 files in the JSON
- Include the actual content for each file
- Do NOT create helper scripts or package.json unless explicitly required
- Create data files directly

Respond with the complete JSON now:`

		try {
			const response = await this.sendMessage(workPrompt)
			console.log(`💡 ${this.state.identity.id} received implementation plan`)
			console.log(`📄 ${this.state.identity.id} LLM response:`, response.substring(0, 500))
			
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
				console.warn(`⚠️ ${this.state.identity.id} parsed 0 files from response!`)
				console.warn(`Raw JSON: ${jsonText}`)
			}
			
			// Create the files with optional delays
			for (let i = 0; i < files.length; i++) {
				const file = files[i]
				await this.createFile(file.path, file.content)
				
				// Add delay between files if requested
				if (hasDelay && delaySeconds > 0 && i < files.length - 1) {
					console.log(`⏳ ${this.state.identity.id} waiting ${delaySeconds} seconds before next file...`)
					await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000))
				}
			}
			
			console.log(`✅ ${this.state.identity.id} created ${files.length} files`)
			this.setStatus("completed")
			
		} catch (error) {
			console.error(`❌ ${this.state.identity.id} failed to execute task:`, error)
			// Fallback: create a simple status file
			await this.createFile(
				`${this.state.identity.id}-status.txt`,
				`Task: ${task}\nStatus: Attempted but encountered error\nError: ${error}`
			)
			this.setStatus("completed")
		}
		// kilocode_change end
	}

	/**
	 * Create a file in the workspace
	 */
	private async createFile(relativePath: string, content: string): Promise<void> {
		// kilocode_change start
		const fullPath = path.join(this.workspacePath, relativePath)
		const dir = path.dirname(fullPath)
		
		console.log(`📂 ${this.state.identity.id} workspace path: ${this.workspacePath}`)
		console.log(`📂 ${this.state.identity.id} full file path: ${fullPath}`)
		
		// Create directory if needed
		await fs.mkdir(dir, { recursive: true })
		
		// Write file
		await fs.writeFile(fullPath, content, "utf-8")
		
		console.log(`📝 ${this.state.identity.id} created file: ${relativePath}`)
		this.addMessage("assistant", `Created file: ${relativePath}`)
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
		console.log(`🤖 Calling LLM for ${this.state.identity.id}...`)
		
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

			console.log(`✅ LLM response received (${fullResponse.length} chars)`)
			return fullResponse.trim()
		} catch (error) {
			console.error(`❌ LLM call failed for ${this.state.identity.id}:`, error)
			throw error
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
