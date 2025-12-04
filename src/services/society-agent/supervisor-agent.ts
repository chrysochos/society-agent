// kilocode_change - new file
/**
 * SupervisorAgent - Autonomous supervisor that coordinates worker agents
 *
 * Analyzes purposes, creates teams, delegates tasks, monitors progress,
 * resolves issues, and escalates critical decisions to human.
 */

import { ConversationAgent, AgentIdentity } from "./conversation-agent"
import { ApiHandler } from "../../api"

// kilocode_change start
export interface Purpose {
	id: string
	description: string
	context?: string
	attachments?: string[]
	constraints?: string[]
	successCriteria?: string[]
	createdAt: number
}

export interface WorkerSpec {
	workerType: "backend" | "frontend" | "security" | "tester" | "devops" | "custom"
	count: number
	reason: string
}

export interface TaskAssignment {
	workerId: string
	task: string
	context: string
	assignedAt: number
	status: "pending" | "in-progress" | "completed" | "failed"
}

export interface EscalationRequest {
	id: string
	priority: "low" | "medium" | "high" | "critical"
	question: string
	options?: string[]
	context: string
	timestamp: number
	response?: string
	respondedAt?: number
}

export interface SupervisorState {
	purpose: Purpose
	teamSpec: WorkerSpec[]
	workerIds: string[]
	taskAssignments: TaskAssignment[]
	escalations: EscalationRequest[]
	progressPercentage: number
	currentPhase: "analyzing" | "planning" | "executing" | "monitoring" | "completed" | "failed"
}

export interface SupervisorAgentConfig {
	identity: AgentIdentity
	apiHandler: ApiHandler
	purpose: Purpose
	onTeamCreated?: (teamSpec: WorkerSpec[]) => void
	onTaskAssigned?: (assignment: TaskAssignment) => void
	onEscalation?: (escalation: EscalationRequest) => void
	onProgressUpdate?: (progress: number) => void
}
// kilocode_change end

/**
 * Supervisor agent that autonomously manages a team of workers
 */
export class SupervisorAgent extends ConversationAgent {
	// kilocode_change start
	private supervisorState: SupervisorState
	private onTeamCreated?: (teamSpec: WorkerSpec[]) => void
	private onTaskAssigned?: (assignment: TaskAssignment) => void
	private onEscalation?: (escalation: EscalationRequest) => void
	private onProgressUpdate?: (progress: number) => void
	// kilocode_change end

	constructor(config: SupervisorAgentConfig) {
		// kilocode_change start
		super({
			identity: { ...config.identity, role: "supervisor" },
			apiHandler: config.apiHandler,
			systemPrompt: SupervisorAgent.getSupervisorPrompt(),
		})

		this.supervisorState = {
			purpose: config.purpose,
			teamSpec: [],
			workerIds: [],
			taskAssignments: [],
			escalations: [],
			progressPercentage: 0,
			currentPhase: "analyzing",
		}

		this.onTeamCreated = config.onTeamCreated
		this.onTaskAssigned = config.onTaskAssigned
		this.onEscalation = config.onEscalation
		this.onProgressUpdate = config.onProgressUpdate
		// kilocode_change end
	}

	/**
	 * Get supervisor-specific state
	 */
	getSupervisorState(): SupervisorState {
		// kilocode_change start
		return { ...this.supervisorState }
		// kilocode_change end
	}

	/**
	 * Analyze purpose and create team specification
	 */
	async analyzePurpose(): Promise<WorkerSpec[]> {
		// kilocode_change start
		this.supervisorState.currentPhase = "analyzing"

		const analysisPrompt = `You are a supervisor agent creating a team. Analyze this purpose and determine what worker agents are needed.

Purpose: ${this.supervisorState.purpose.description}
Context: ${this.supervisorState.purpose.context || "None provided"}
Constraints: ${this.supervisorState.purpose.constraints?.join(", ") || "None"}
Success Criteria: ${this.supervisorState.purpose.successCriteria?.join(", ") || "None"}

Respond with ONLY a JSON object (no markdown, no explanation, just the JSON):
{
  "workers": [
    {"workerType": "backend", "count": 1, "reason": "Implement server-side logic"},
    {"workerType": "frontend", "count": 1, "reason": "Build user interface"}
  ]
}

Available worker types: backend, frontend, security, tester, devops, custom

Respond with the JSON now:`

		const response = await this.sendMessage(analysisPrompt)
		console.log("🤖 Supervisor LLM response:", response)

		try {
			// Extract JSON from response (handle markdown code blocks)
			let jsonText = response.trim()
			
			// Remove markdown code blocks if present
			if (jsonText.includes("```")) {
				const match = jsonText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
				if (match) {
					jsonText = match[1]
				}
			}
			
			// Try to find JSON object in the response
			const jsonMatch = jsonText.match(/\{[\s\S]*"workers"[\s\S]*\}/)
			if (jsonMatch) {
				jsonText = jsonMatch[0]
			}
			
			console.log("📋 Extracted JSON:", jsonText)
			
			const parsed = JSON.parse(jsonText)
			this.supervisorState.teamSpec = parsed.workers || []
			
			console.log("✅ Team spec parsed:", this.supervisorState.teamSpec)
			
			this.onTeamCreated?.(this.supervisorState.teamSpec)
			return this.supervisorState.teamSpec
		} catch (error) {
			console.error("❌ Failed to parse team specification:", error)
			console.error("Raw response was:", response)
			
			// Fallback: create a default team
			const defaultTeam: WorkerSpec[] = [
				{ workerType: "backend", count: 1, reason: "Default backend worker" },
				{ workerType: "frontend", count: 1, reason: "Default frontend worker" },
			]
			
			console.log("⚠️ Using default team:", defaultTeam)
			this.supervisorState.teamSpec = defaultTeam
			this.onTeamCreated?.(defaultTeam)
			return defaultTeam
		}
		// kilocode_change end
	}

	/**
	 * Register worker agent with supervisor
	 */
	registerWorker(workerId: string): void {
		// kilocode_change start
		this.supervisorState.workerIds.push(workerId)
		// kilocode_change end
	}

	/**
	 * Delegate task to specific worker
	 */
	async delegateTask(workerId: string, task: string, context: string): Promise<TaskAssignment> {
		// kilocode_change start
		const assignment: TaskAssignment = {
			workerId,
			task,
			context,
			assignedAt: Date.now(),
			status: "in-progress",
		}

		this.supervisorState.taskAssignments.push(assignment)
		
		console.log(`📨 Delegating task to ${workerId}:`, task)
		
		// Trigger callback so the team can assign the task
		this.onTaskAssigned?.(assignment)

		return assignment
		// kilocode_change end
	}

	/**
	 * Update task status
	 */
	updateTaskStatus(workerId: string, status: TaskAssignment["status"]): void {
		// kilocode_change start
		const assignment = this.supervisorState.taskAssignments.find((a) => a.workerId === workerId)
		if (assignment) {
			assignment.status = status
			this.updateProgress()
		}
		// kilocode_change end
	}

	/**
	 * Calculate and update overall progress
	 */
	private updateProgress(): void {
		// kilocode_change start
		const totalTasks = this.supervisorState.taskAssignments.length
		if (totalTasks === 0) {
			// Don't send 0% update - it would override the startup progress
			this.supervisorState.progressPercentage = 0
			return
		}

		const completedTasks = this.supervisorState.taskAssignments.filter((a) => a.status === "completed").length

		// Calculate progress: 50% base (from startExecution) + (50% * completion ratio)
		// This ensures progress goes 50% → 75% → 100% as tasks complete
		const completionRatio = completedTasks / totalTasks
		const progressPercentage = 50 + Math.round(completionRatio * 50)
		
		this.supervisorState.progressPercentage = progressPercentage
		this.onProgressUpdate?.(progressPercentage)
		// kilocode_change end
	}

	/**
	 * Handle worker question/issue
	 */
	async handleWorkerQuestion(workerId: string, question: string): Promise<string> {
		// kilocode_change start
		const questionPrompt = `Worker ${workerId} has a question:

${question}

Provide guidance or answer. If this is a critical/strategic decision that requires human approval, respond with:
ESCALATE: <reason>

Otherwise, provide direct guidance to the worker.`

		const response = await this.sendMessage(questionPrompt)

		// Check if escalation needed
		if (response.startsWith("ESCALATE:")) {
			const reason = response.substring("ESCALATE:".length).trim()
			await this.escalateToHuman("high", question, reason)
			return "I've escalated this to the human. Waiting for decision..."
		}

		return response
		// kilocode_change end
	}

	/**
	 * Escalate decision to human
	 */
	async escalateToHuman(
		priority: EscalationRequest["priority"],
		question: string,
		context: string,
		options?: string[],
	): Promise<string> {
		// kilocode_change start
		const escalation: EscalationRequest = {
			id: `escalation-${Date.now()}`,
			priority,
			question,
			options,
			context,
			timestamp: Date.now(),
		}

		this.supervisorState.escalations.push(escalation)
		this.onEscalation?.(escalation)

		// In real implementation, this would wait for human response
		// For now, return placeholder
		return new Promise((resolve) => {
			// TODO: Implement actual escalation waiting mechanism
			setTimeout(() => {
				resolve("Awaiting human decision...")
			}, 100)
		})
		// kilocode_change end
	}

	/**
	 * Respond to escalation (called when human makes decision)
	 */
	respondToEscalation(escalationId: string, response: string): void {
		// kilocode_change start
		const escalation = this.supervisorState.escalations.find((e) => e.id === escalationId)
		if (escalation) {
			escalation.response = response
			escalation.respondedAt = Date.now()
		}
		// kilocode_change end
	}

	/**
	 * Start executing the purpose - create work plan and delegate tasks
	 */
	async startExecution(): Promise<void> {
		// kilocode_change start
		this.supervisorState.currentPhase = "planning"

		console.log("📋 Supervisor creating work plan...")

		const planningPrompt = `You are supervising a team to complete this purpose:

Purpose: ${this.supervisorState.purpose.description}
Context: ${this.supervisorState.purpose.context || "None"}
Success Criteria: ${this.supervisorState.purpose.successCriteria?.join(", ") || "None"}

Your team (${this.supervisorState.workerIds.length} workers):
${this.supervisorState.workerIds.map((id, i) => `- ${id} (${this.supervisorState.teamSpec[Math.floor(i / this.supervisorState.teamSpec[0]?.count || 1)]?.workerType || "worker"})`).join("\n")}

CRITICAL: You MUST create exactly ${this.supervisorState.workerIds.length} tasks (one task per worker). Every worker must be assigned work.

Create a work plan. Break down the purpose into specific tasks for each worker.

IMPORTANT: For each task, specify dependencies ONLY if truly necessary (e.g., tests depend on code being written first).
Most tasks should run in PARALLEL with empty dependencies [].

Respond with ONLY a JSON object:
{
  "tasks": [
    {"workerId": "${this.supervisorState.workerIds[0] || "worker-1"}", "task": "Task description", "context": "Additional context", "dependencies": []},
    {"workerId": "${this.supervisorState.workerIds[1] || "worker-2"}", "task": "Task description", "context": "Additional context", "dependencies": []}
  ]
}

Rules for dependencies:
- Independent tasks (backend + frontend, different files, etc.) → dependencies: []
- Dependent tasks (tests need code first, deployment needs build) → dependencies: ["workerId-of-prerequisite"]

Prefer PARALLEL execution (empty dependencies) unless there's a clear technical reason for sequential.

Respond with the JSON now:`

		try {
			const response = await this.sendMessage(planningPrompt)
			console.log("🤖 Work plan response:", response)

			// Parse JSON (handle markdown)
			let jsonText = response.trim()
			if (jsonText.includes("```")) {
				const match = jsonText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
				if (match) jsonText = match[1]
			}
			const jsonMatch = jsonText.match(/\{[\s\S]*"tasks"[\s\S]*\}/)
			if (jsonMatch) jsonText = jsonMatch[0]

		const parsed = JSON.parse(jsonText)
		const tasks = parsed.tasks || []

		console.log("✅ Parsed tasks:", JSON.stringify(tasks, null, 2))
		
		// Validate: ensure all workers have tasks
		const assignedWorkers = new Set(tasks.map(t => t.workerId))
		const missingWorkers = this.supervisorState.workerIds.filter(id => !assignedWorkers.has(id))
		if (missingWorkers.length > 0) {
			console.warn(`⚠️ Warning: ${missingWorkers.length} workers not assigned tasks:`, missingWorkers)
		}
		
		// Delegate tasks to workers
			this.onProgressUpdate?.(35) // Work plan created
			
			// Execute tasks with dependency management
			await this.executeTasksWithDependencies(tasks)

			this.supervisorState.currentPhase = "executing"
			this.onProgressUpdate?.(50) // Tasks delegated, work started
			console.log("🚀 Work delegation complete, execution started")
		} catch (error) {
			console.error("❌ Failed to create work plan:", error)
			console.error("Error details:", error instanceof Error ? error.message : String(error))
			// Fallback: assign simple tasks in parallel
			console.log("⚠️ Using fallback task assignment (parallel)")
			const fallbackTasks = this.supervisorState.workerIds.map(workerId => ({
				workerId,
				task: `Work on: ${this.supervisorState.purpose.description}`,
				context: "Contribute to completing the purpose",
				dependencies: [] as string[]
			}))
			await this.executeTasksWithDependencies(fallbackTasks)
		}
		// kilocode_change end
	}

	/**
	 * Execute tasks with intelligent parallelization based on dependencies
	 */
	private async executeTasksWithDependencies(
		tasks: Array<{ workerId: string; task: string; context: string; dependencies?: string[] }>
	): Promise<void> {
		// kilocode_change start
		const completed = new Set<string>()
		const inProgress = new Map<string, Promise<void>>()
		
		// Process tasks in waves based on dependencies
		while (completed.size < tasks.length) {
			// Find tasks that can start now (dependencies met)
			const readyTasks = tasks.filter(
				(task) =>
					!completed.has(task.workerId) &&
					!inProgress.has(task.workerId) &&
					(task.dependencies || []).every((dep) => completed.has(dep))
			)

			if (readyTasks.length === 0) {
				// Wait for at least one in-progress task to complete
				if (inProgress.size > 0) {
					await Promise.race(Array.from(inProgress.values()))
					continue
				}
				// No ready tasks and nothing in progress - break to avoid infinite loop
				break
			}

		console.log(
			`🔄 Starting ${readyTasks.length} task(s) in parallel: ${readyTasks.map((t) => t.workerId).join(", ")}`
		)

		// Start all ready tasks in parallel
		const startTime = Date.now()
		for (const task of readyTasks) {
			const taskStartTime = Date.now()
			const promise = this.delegateTask(task.workerId, task.task, task.context || "").then(() => {
				const duration = ((Date.now() - taskStartTime) / 1000).toFixed(1)
				completed.add(task.workerId)
				inProgress.delete(task.workerId)
				console.log(`✅ Task completed: ${task.workerId} in ${duration}s (${completed.size}/${tasks.length})`)
			})
			inProgress.set(task.workerId, promise)
		}
		
		// If multiple tasks started, this proves they're running in parallel
		if (readyTasks.length > 1) {
			console.log(`⚡ ${readyTasks.length} tasks started in ${Date.now() - startTime}ms (parallel execution initiated)`)
		}			// Wait for all tasks in this wave to complete before starting next wave
			await Promise.all(Array.from(inProgress.values()))
		}

		console.log(`✅ All ${tasks.length} tasks delegated (${completed.size} completed)`)
		// kilocode_change end
	}

	/**
	 * Monitor worker progress
	 */
	async monitorWorkers(): Promise<void> {
		// kilocode_change start
		this.supervisorState.currentPhase = "monitoring"

		// Check for stuck workers (tasks pending > 5 minutes)
		const now = Date.now()
		const STUCK_THRESHOLD = 5 * 60 * 1000 // 5 minutes

		for (const assignment of this.supervisorState.taskAssignments) {
			if (assignment.status === "in-progress" && now - assignment.assignedAt > STUCK_THRESHOLD) {
				// Worker might be stuck, send guidance
				await this.sendMessage(
					`Worker ${assignment.workerId} seems stuck on task: ${assignment.task}. Provide guidance or reassign.`,
				)
			}
		}
		// kilocode_change end
	}

	/**
	 * Complete purpose execution
	 */
	async completePurpose(): Promise<string> {
		// kilocode_change start
		this.supervisorState.currentPhase = "completed"
		this.supervisorState.progressPercentage = 100

		const summaryPrompt = `Purpose execution complete. Generate a summary report:

Purpose: ${this.supervisorState.purpose.description}
Team: ${this.supervisorState.workerIds.length} workers
Tasks Completed: ${this.supervisorState.taskAssignments.filter((a) => a.status === "completed").length}
Escalations: ${this.supervisorState.escalations.length}

Provide a brief summary of what was accomplished and any important notes.`

		const summary = await this.sendMessage(summaryPrompt)
		return summary
		// kilocode_change end
	}

	/**
	 * Get supervisor system prompt
	 */
	private static getSupervisorPrompt(): string {
		// kilocode_change start
		return `You are a Supervisor Agent in a multi-agent system.

Your responsibilities:
1. ANALYZE: Break down purposes into actionable tasks
2. PLAN: Determine what worker agents are needed
3. DELEGATE: Assign tasks to workers with clear context
4. MONITOR: Track worker progress, detect issues
5. GUIDE: Help stuck workers, resolve conflicts
6. ESCALATE: Only escalate critical/strategic decisions to human
7. REPORT: Summarize results and provide completion reports

Decision Making:
- Handle most decisions autonomously (technical, implementation details)
- Escalate only when:
  * Strategic business decisions needed
  * Budget/timeline impact significant
  * Multiple viable approaches with tradeoffs
  * Security/privacy implications
  * Breaking changes to existing systems

Communication:
- Be concise and clear with workers
- Provide context and reasoning
- Acknowledge good work
- Offer specific guidance when issues arise

Always respond in JSON format when asked to analyze purposes or make structured decisions.`
		// kilocode_change end
	}
}
