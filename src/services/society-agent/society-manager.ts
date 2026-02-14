// kilocode_change - new file
/**
 * SocietyManager - Main orchestrator for Society Agent system
 *
 * Manages the lifecycle of purposes, creates and coordinates agent teams,
 * handles human interaction, and maintains system state.
 */

import { AgentTeam, AgentTeamConfig } from "./agent-team"
import { Purpose } from "./supervisor-agent"
import { PurposeAnalyzer, PurposeContext } from "./purpose-analyzer"
import { ApiHandler } from "../../api"
import { ExecutionLogger } from "./execution-logger"

// kilocode_change start
export interface ActivePurpose {
	purpose: Purpose
	team: AgentTeam
	analysis: ReturnType<typeof PurposeAnalyzer.analyze>
	startedAt: number
	status: "analyzing" | "forming-team" | "executing" | "completed" | "failed"
}

export interface SocietyManagerConfig {
	apiHandler: ApiHandler
	workspacePath?: string
	onPurposeStarted?: (purpose: Purpose) => void
	onPurposeCompleted?: (purpose: Purpose, summary: string) => void
	onTeamFormed?: (purposeId: string, teamSize: number) => void
	onProgressUpdate?: (purposeId: string, progress: number) => void
	onMessage?: (purposeId: string, agentId: string, message: string) => void
	onStatusChange?: (purposeId: string, agentId: string, status: string, task?: string) => void
}

export interface SocietyState {
	activePurposes: Map<string, ActivePurpose>
	completedPurposes: Purpose[]
	totalAgentsCreated: number
}
// kilocode_change end

/**
 * Main orchestrator for the Society Agent system
 */
export class SocietyManager {
	// kilocode_change start
	private state: SocietyState
	private config: SocietyManagerConfig
	private logger: ExecutionLogger
	// kilocode_change end

	constructor(config: SocietyManagerConfig) {
		// kilocode_change start
		this.state = {
			activePurposes: new Map(),
			completedPurposes: [],
			totalAgentsCreated: 0,
		}
		this.config = config
		this.logger = new ExecutionLogger({
			workspaceRoot: config.workspacePath || process.cwd(),
			enableConsole: true,
		})
		// kilocode_change end
	}

	/**
	 * Get current system state
	 */
	getState(): SocietyState {
		// kilocode_change start
		return {
			...this.state,
			activePurposes: new Map(this.state.activePurposes),
			completedPurposes: [...this.state.completedPurposes],
		}
		// kilocode_change end
	}

	/**
	 * Start a new purpose
	 */
	async startPurpose(purposeContext: PurposeContext): Promise<string> {
		// kilocode_change start
		// Create purpose object
		const purpose: Purpose = {
			id: `purpose-${Date.now()}`,
			description: purposeContext.description,
			context: purposeContext.context,
			attachments: purposeContext.attachments,
			constraints: purposeContext.constraints,
			successCriteria: purposeContext.successCriteria,
			createdAt: Date.now(),
		}

		// kilocode_change - AI decides if task is simple enough for direct execution
		const complexityCheck = await this.checkComplexity(purpose)

		if (complexityCheck.isSimple) {
			console.log("🎯 Simple task detected - using direct execution (no multi-agent overhead)")
			return await this.executeSimpleTask(purpose, complexityCheck.workerType)
		}

		console.log("🏢 Complex task - forming multi-agent team")

		// Analyze purpose
		const analysis = PurposeAnalyzer.analyze(purposeContext)

		// Create active purpose entry
		const activePurpose: ActivePurpose = {
			purpose,
			team: null as any, // Will be created next
			analysis,
			startedAt: Date.now(),
			status: "analyzing",
		}

		this.state.activePurposes.set(purpose.id, activePurpose)
		this.config.onPurposeStarted?.(purpose)

		// Create team
		activePurpose.status = "forming-team"
		activePurpose.team = await this.createTeam(purpose)

		// Initialize team (supervisor analyzes and creates workers)
		await activePurpose.team.initialize()

		const teamState = activePurpose.team.getState()
		const teamSize = teamState.workers.size + 1 // +1 for supervisor

		this.state.totalAgentsCreated += teamSize
		this.config.onTeamFormed?.(purpose.id, teamSize)

		// Start execution
		activePurpose.status = "executing"

		return purpose.id
		// kilocode_change end
	}

	/**
	 * Create agent team for purpose
	 */
	private async createTeam(purpose: Purpose): Promise<AgentTeam> {
		// kilocode_change start
		const teamConfig: AgentTeamConfig = {
			purpose,
			apiHandler: this.config.apiHandler,
			workspacePath: this.config.workspacePath,
			onMessage: (agentId, content) => {
				this.config.onMessage?.(purpose.id, agentId, content)
			},
			onStatusChange: (agentId, status) => {
				// Get current task for this agent
				const agent = Array.from(
					this.state.activePurposes.get(purpose.id)?.team.getState().workers.values() || [],
				).find((w) => w.getIdentity().id === agentId)
				const task = agent?.getState().currentTask
				this.config.onStatusChange?.(purpose.id, agentId, status, task)
			},
			onProgressUpdate: (progress) => {
				this.config.onProgressUpdate?.(purpose.id, progress)

				// Auto-complete when reaching 100% (check if purpose still exists to avoid double completion)
				if (progress === 100 && this.state.activePurposes.has(purpose.id)) {
					setTimeout(() => {
						// Double-check purpose still exists before completing
						if (this.state.activePurposes.has(purpose.id)) {
							this.completePurpose(purpose.id)
						}
					}, 1000)
				}
			},
		}

		return new AgentTeam(teamConfig)
		// kilocode_change end
	}

	/**
	 * Get active purpose by ID
	 */
	getActivePurpose(purposeId: string): ActivePurpose | undefined {
		// kilocode_change start
		return this.state.activePurposes.get(purposeId)
		// kilocode_change end
	}

	/**
	 * List all active purposes
	 */
	listActivePurposes(): ActivePurpose[] {
		// kilocode_change start
		return Array.from(this.state.activePurposes.values())
		// kilocode_change end
	}

	/**
	 * Send message to specific agent in a purpose
	 */
	async sendMessageToAgent(purposeId: string, agentId: string, message: string): Promise<string> {
		// kilocode_change start
		const activePurpose = this.state.activePurposes.get(purposeId)
		if (!activePurpose) {
			throw new Error(`Purpose ${purposeId} not found`)
		}

		return await activePurpose.team.sendMessageToAgent(agentId, message)
		// kilocode_change end
	}

	/**
	 * Pause purpose execution
	 */
	pausePurpose(purposeId: string): void {
		// kilocode_change start
		const activePurpose = this.state.activePurposes.get(purposeId)
		if (!activePurpose) {
			throw new Error(`Purpose ${purposeId} not found`)
		}

		activePurpose.team.pauseAll()
		// kilocode_change end
	}

	/**
	 * Resume purpose execution
	 */
	resumePurpose(purposeId: string): void {
		// kilocode_change start
		const activePurpose = this.state.activePurposes.get(purposeId)
		if (!activePurpose) {
			throw new Error(`Purpose ${purposeId} not found`)
		}

		activePurpose.team.resumeAll()
		// kilocode_change end
	}

	/**
	 * Complete purpose and dispose team
	 */
	async completePurpose(purposeId: string): Promise<string> {
		// kilocode_change start
		const activePurpose = this.state.activePurposes.get(purposeId)
		if (!activePurpose) {
			throw new Error(`Purpose ${purposeId} not found`)
		}

		// Get completion summary from team
		const summary = await activePurpose.team.complete()

		// Update status
		activePurpose.status = "completed"

		// Move to completed
		this.state.completedPurposes.push(activePurpose.purpose)
		this.state.activePurposes.delete(purposeId)

		// Dispose team
		activePurpose.team.dispose()

		this.config.onPurposeCompleted?.(activePurpose.purpose, summary)

		return summary
		// kilocode_change end
	}

	/**
	 * Stop purpose execution (error/abort)
	 */
	stopPurpose(purposeId: string, reason: string): void {
		// kilocode_change start
		const activePurpose = this.state.activePurposes.get(purposeId)
		if (!activePurpose) {
			throw new Error(`Purpose ${purposeId} not found`)
		}

		activePurpose.status = "failed"
		activePurpose.team.dispose()
		this.state.activePurposes.delete(purposeId)
		// kilocode_change end
	}

	/**
	 * Check if task is simple enough for direct execution
	 * kilocode_change - AI decides complexity
	 */
	private async checkComplexity(purpose: Purpose): Promise<{ isSimple: boolean; workerType: string }> {
		const { buildApiHandler } = require("../../api")
		const providerSettings = this.config.apiHandler
			? null
			: require("../../core/webview/ClineProvider").getProviderSettings?.()
		const apiHandler = this.config.apiHandler || buildApiHandler(providerSettings)

		// Quick LLM call to determine complexity
		const prompt = `Analyze this task:

"${purpose.description}"

Is this a SIMPLE task that one person could do quickly (1-2 files, straightforward)?
Or COMPLEX requiring multiple specialists (multiple components, integration, testing)?

Examples of SIMPLE:
- "Create a calculator"
- "Write a Python script to sort data"
- "Build a todo list"

Examples of COMPLEX:
- "Build e-commerce site with auth and payments"
- "Create REST API with tests and deployment"
- "Full stack app with frontend and backend"

Respond with JSON:
{
  "isSimple": true/false,
  "workerType": "backend|frontend|custom",
  "reasoning": "why"
}

Respond with ONLY the JSON:`

		try {
			const stream = apiHandler.createMessage("Analyze task complexity", [{ role: "user", content: prompt }]) // kilocode_change

			let jsonText = ""
			for await (const chunk of stream) {
				if (chunk.type === "text") {
					jsonText += chunk.text
				}
			}

			jsonText = jsonText.trim()
			if (jsonText.includes("```")) {
				const match = jsonText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
				if (match) jsonText = match[1]
			}

			const result = JSON.parse(jsonText)
			console.log(`🤔 Complexity: ${result.isSimple ? "SIMPLE" : "COMPLEX"} - ${result.reasoning}`)
			return { isSimple: result.isSimple, workerType: result.workerType || "backend" }
		} catch (error) {
			console.warn("⚠️ Complexity check failed, defaulting to complex:", error)
			return { isSimple: false, workerType: "backend" }
		}
	}

	/**
	 * Execute simple task with single agent (no multi-agent overhead)
	 * kilocode_change - Direct execution path
	 */
	private async executeSimpleTask(purpose: Purpose, workerType: string): Promise<string> {
		const { ConversationAgent } = require("./conversation-agent")

		// Create single agent
		const agent = new ConversationAgent({
			identity: {
				id: `simple-${Date.now()}`,
				role: "worker",
				workerType,
				capabilities: ["file-write", "code-analysis"],
				createdAt: Date.now(),
			},
			apiHandler: this.config.apiHandler,
			workspacePath: this.config.workspacePath,
		})

		this.state.totalAgentsCreated++

		// Report progress
		this.config.onPurposeStarted?.(purpose)
		this.config.onTeamFormed?.(purpose.id, 1) // Just 1 agent
		this.config.onProgressUpdate?.(purpose.id, 50)

		// Execute directly
		await agent.assignTask(purpose.description)

		// Wait for completion (poll status)
		await new Promise<void>((resolve) => {
			// kilocode_change - typed Promise
			const checkInterval = setInterval(() => {
				if (agent.getState().status === "completed") {
					clearInterval(checkInterval)
					resolve(undefined)
				}
			}, 500)
		})

		this.config.onProgressUpdate?.(purpose.id, 100)
		this.config.onPurposeCompleted?.(purpose, "Task completed successfully") // kilocode_change

		return purpose.id
	}

	/**
	 * Get system statistics
	 */
	getStatistics(): {
		activePurposes: number
		completedPurposes: number
		totalAgentsCreated: number
	} {
		// kilocode_change start
		return {
			activePurposes: this.state.activePurposes.size,
			completedPurposes: this.state.completedPurposes.length,
			totalAgentsCreated: this.state.totalAgentsCreated,
		}
		// kilocode_change end
	}

	/**
	 * Dispose all resources
	 */
	dispose(): void {
		// kilocode_change start
		for (const activePurpose of this.state.activePurposes.values()) {
			activePurpose.team.dispose()
		}
		this.state.activePurposes.clear()
		// kilocode_change end
	}
}
