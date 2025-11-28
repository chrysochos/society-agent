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

		const analysisPrompt = `Analyze this purpose and determine what worker agents are needed:

Purpose: ${this.supervisorState.purpose.description}
Context: ${this.supervisorState.purpose.context || "None provided"}
Constraints: ${this.supervisorState.purpose.constraints?.join(", ") || "None"}
Success Criteria: ${this.supervisorState.purpose.successCriteria?.join(", ") || "None"}

Determine:
1. What worker types are needed (backend, frontend, security, tester, devops, custom)
2. How many of each type
3. Why each is needed

Respond in JSON format:
{
  "workers": [
    {"workerType": "backend", "count": 1, "reason": "..."},
    {"workerType": "tester", "count": 1, "reason": "..."}
  ]
}`

		const response = await this.sendMessage(analysisPrompt)

		try {
			const parsed = JSON.parse(response)
			this.supervisorState.teamSpec = parsed.workers || []
			this.onTeamCreated?.(this.supervisorState.teamSpec)
			return this.supervisorState.teamSpec
		} catch (error) {
			throw new Error(`Failed to parse team specification: ${error}`)
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
			status: "pending",
		}

		this.supervisorState.taskAssignments.push(assignment)
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
			this.supervisorState.progressPercentage = 0
			return
		}

		const completedTasks = this.supervisorState.taskAssignments.filter((a) => a.status === "completed").length

		this.supervisorState.progressPercentage = Math.round((completedTasks / totalTasks) * 100)
		this.onProgressUpdate?.(this.supervisorState.progressPercentage)
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
