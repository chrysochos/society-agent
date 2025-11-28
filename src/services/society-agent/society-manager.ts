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
	onPurposeStarted?: (purpose: Purpose) => void
	onPurposeCompleted?: (purpose: Purpose, summary: string) => void
	onTeamFormed?: (purposeId: string, teamSize: number) => void
	onMessage?: (purposeId: string, agentId: string, message: string) => void
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
	// kilocode_change end

	constructor(config: SocietyManagerConfig) {
		// kilocode_change start
		this.state = {
			activePurposes: new Map(),
			completedPurposes: [],
			totalAgentsCreated: 0,
		}
		this.config = config
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
			onMessage: (agentId, content) => {
				this.config.onMessage?.(purpose.id, agentId, content)
			},
			onStatusChange: (agentId, status) => {
				// Could emit status change events here
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
