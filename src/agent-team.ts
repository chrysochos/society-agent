// kilocode_change - new file
/**
 * AgentTeam - Manages lifecycle of agent teams for a purpose
 *
 * Creates supervisor and workers, coordinates communication, manages state.
 * Supports two modes:
 *   - In-process: ConversationAgent objects (LLM threads in same extension process)
 *   - Multi-window: Launches real VS Code windows via AgentLauncher with Ed25519 identity
 */

import { ConversationAgent, AgentIdentity } from "./conversation-agent"
import { SupervisorAgent, Purpose, WorkerSpec } from "./supervisor-agent"
import { ApiHandler } from "./api"
import { AgentIdentityManager } from "./agent-identity"
import { AgentLauncher, LaunchConfig } from "./agent-launcher"
import { getLog } from "./logger"

// kilocode_change start
export interface TeamMember {
	agent: ConversationAgent
	identity: AgentIdentity
	createdAt: number
}

export interface AgentTeamConfig {
	purpose: Purpose
	apiHandler: ApiHandler
	workspacePath?: string
	/** Shared directory for .society-agent/ (identity, inbox, keys) */
	sharedDir?: string
	/** Launch workers as separate VS Code windows (multi-window mode) */
	multiWindow?: boolean
	onMessage?: (agentId: string, content: string) => void
	onStatusChange?: (agentId: string, status: string) => void
	onProgressUpdate?: (progress: number) => void
}

export interface TeamState {
	purpose: Purpose
	supervisor: SupervisorAgent
	workers: Map<string, ConversationAgent>
	createdAt: number
	status: "forming" | "executing" | "completed" | "failed"
}
// kilocode_change end

/**
 * Manages a team of agents working on a purpose
 */
export class AgentTeam {
	// kilocode_change start
	private state: TeamState
	private config: AgentTeamConfig
	private apiHandler: ApiHandler
	private identityManager: AgentIdentityManager | null = null
	private launcher: AgentLauncher | null = null
	private teamId: string
	private onMessage?: (agentId: string, content: string) => void
	private onStatusChange?: (agentId: string, status: string) => void
	private onProgressUpdate?: (progress: number) => void
	// kilocode_change end

	constructor(config: AgentTeamConfig) {
		// kilocode_change start
		this.config = config
		this.teamId = `team-${Date.now()}`

		// Set up identity system if sharedDir provided
		if (config.sharedDir) {
			this.identityManager = new AgentIdentityManager(config.sharedDir)
		}

		// Set up launcher for multi-window mode
		if (config.multiWindow) {
			this.launcher = new AgentLauncher()
		}

		const supervisorIdentity: AgentIdentity = {
			id: `supervisor-${Date.now()}`,
			role: "supervisor",
			capabilities: ["analyze", "plan", "delegate", "monitor", "escalate"],
			createdAt: Date.now(),
		}

		const supervisor = new SupervisorAgent({
			identity: supervisorIdentity,
			apiHandler: config.apiHandler,
			purpose: config.purpose,
			onTeamCreated: (spec) => this.createWorkers(spec),
			onTaskAssigned: (assignment) => this.assignTaskToWorker(assignment),
			onEscalation: (escalation) => this.handleEscalation(escalation),
			onProgressUpdate: (progress) => this.updateProgress(progress),
		})

		this.state = {
			purpose: config.purpose,
			supervisor,
			workers: new Map(),
			createdAt: Date.now(),
			status: "forming",
		}

		this.apiHandler = config.apiHandler
		this.onMessage = config.onMessage
		this.onStatusChange = config.onStatusChange
		this.onProgressUpdate = config.onProgressUpdate
		// kilocode_change end
	}

	/**
	 * Get team state
	 */
	getState(): TeamState {
		// kilocode_change start
		return {
			...this.state,
			workers: new Map(this.state.workers),
		}
		// kilocode_change end
	}

	/**
	 * Get all team members (supervisor + workers)
	 */
	getAllMembers(): TeamMember[] {
		// kilocode_change start
		const members: TeamMember[] = [
			{
				agent: this.state.supervisor,
				identity: this.state.supervisor.getIdentity(),
				createdAt: this.state.createdAt,
			},
		]

		for (const [id, worker] of this.state.workers) {
			members.push({
				agent: worker,
				identity: worker.getIdentity(),
				createdAt: this.state.createdAt,
			})
		}

		return members
		// kilocode_change end
	}

	/**
	 * Initialize team - analyze purpose and create workers
	 */
	async initialize(): Promise<void> {
		// kilocode_change start
		this.state.status = "forming"

		// Generate Ed25519 identity for supervisor if identity manager available
		if (this.identityManager) {
			const supervisorId = this.state.supervisor.getIdentity().id
			try {
				const { publicKeyPem } = await this.identityManager.createAgentIdentity(
					supervisorId,
					"supervisor",
					["analyze", "plan", "delegate", "monitor", "escalate"],
					this.teamId,
				)
				await this.identityManager.registerPublicKey(supervisorId, publicKeyPem)
				getLog().info(`Ed25519 identity created for supervisor ${supervisorId}`)
			} catch (err) {
				getLog().warn(`Failed to create supervisor identity:`, err)
			}
		}

		// Supervisor analyzes purpose and determines team composition
		await this.state.supervisor.analyzePurpose()
		// Workers are created in the callback

		// If multi-window mode, launch VS Code windows for workers
		if (this.launcher && this.config.workspacePath) {
			await this.launchWorkerWindows()
		}

		this.state.status = "executing"

		// Start the actual work!
		await this.state.supervisor.startExecution()
		// kilocode_change end
	}

	/**
	 * Launch worker agents as separate VS Code windows (multi-window mode)
	 */
	private async launchWorkerWindows(): Promise<void> {
		// kilocode_change start
		if (!this.launcher || !this.config.workspacePath) return

		const projectRoot = this.config.workspacePath
		const sharedDir = this.config.sharedDir || require("path").join(projectRoot, ".society-agent")

		for (const [workerId, worker] of this.state.workers) {
			const identity = worker.getIdentity()
			const launchConfig: LaunchConfig = {
				agentId: workerId,
				role: identity.workerType || identity.role,
				workspace: `workspaces/${workerId}`,
				autoLaunch: true,
				capabilities: identity.capabilities,
				lifecycle: "ephemeral",
			}

			const result = await this.launcher.launchAgent(projectRoot, launchConfig, sharedDir)
			if (result.success) {
				getLog().info(`Launched VS Code window for ${workerId}`)
			} else {
				getLog().warn(`Failed to launch ${workerId}: ${result.error}`)
			}

			// Delay between launches
			await new Promise((resolve) => setTimeout(resolve, 2000))
		}
		// kilocode_change end
	}

	/**
	 * Create worker agents based on team specification.
	 * In multi-window mode: generates Ed25519 identity + launches VS Code windows.
	 * In in-process mode: creates ConversationAgent objects in same process.
	 */
	private createWorkers(teamSpec: WorkerSpec[]): void {
		// kilocode_change start
		for (const spec of teamSpec) {
			for (let i = 0; i < spec.count; i++) {
				const workerId = `${spec.workerType}-${Date.now()}-${i}`
				const capabilities = this.getWorkerCapabilities(spec.workerType)

				const workerIdentity: AgentIdentity = {
					id: workerId,
					role: "worker",
					workerType: spec.workerType,
					capabilities,
					createdAt: Date.now(),
				}

				// Generate Ed25519 identity if identity manager available
				if (this.identityManager) {
					// Fire-and-forget: create identity files on disk
					// (async but we don't await — workers can start before keys are written)
					this.identityManager
						.createAgentIdentity(workerId, spec.workerType, capabilities, this.teamId, undefined, spec.workerType)
						.then(({ publicKeyPem }) => this.identityManager!.registerPublicKey(workerId, publicKeyPem))
						.then(() => getLog().info(`Ed25519 identity created for ${workerId}`))
						.catch((err) => getLog().warn(`Failed to create identity for ${workerId}:`, err))
				}

				const worker = new ConversationAgent({
					identity: workerIdentity,
					apiHandler: this.apiHandler,
					workspacePath: this.config.workspacePath,
					onMessage: (msg) => this.onMessage?.(workerId, msg.content),
					onStatusChange: (status) => {
						this.onStatusChange?.(workerId, status)
						// Update supervisor when worker completes
						if (status === "completed") {
							this.state.supervisor.updateTaskStatus(workerId, "completed")
						}
					},
				})

				this.state.workers.set(workerId, worker)
				this.state.supervisor.registerWorker(workerId)
			}
		}
		// kilocode_change end
	}

	/**
	 * Get capabilities for worker type
	 */
	private getWorkerCapabilities(workerType: WorkerSpec["workerType"]): string[] {
		// kilocode_change start
		const capabilityMap: Record<string, string[]> = {
			backend: ["code", "api", "database", "test", "debug"],
			frontend: ["code", "ui", "style", "state", "test"],
			security: ["audit", "review", "vulnerability-scan", "report"],
			tester: ["test", "validate", "coverage", "report"],
			devops: ["deploy", "configure", "monitor", "ci-cd"],
			custom: ["general"],
		}

		return capabilityMap[workerType] || capabilityMap.custom
		// kilocode_change end
	}

	/**
	 * Assign task to worker (called by supervisor)
	 */
	private async assignTaskToWorker(assignment: {
		workerId: string
		task: string
		context: string
		outputDir?: string
	}): Promise<void> {
		// kilocode_change start
		const worker = this.state.workers.get(assignment.workerId)
		if (!worker) {
			throw new Error(`Worker ${assignment.workerId} not found`)
		}

		await worker.assignTask(`${assignment.task}\n\nContext: ${assignment.context}`, assignment.outputDir)
		this.state.supervisor.updateTaskStatus(assignment.workerId, "in-progress")
		// kilocode_change end
	}

	/**
	 * Handle escalation from supervisor
	 */
	private handleEscalation(escalation: { id: string; priority: string; question: string; context: string }): void {
		// kilocode_change start
		// In real implementation, this would show in web dashboard
		// For now, log to console
		getLog().info(`ESCALATION [${escalation.priority}]:`, escalation.question)
		getLog().info(`Context: ${escalation.context}`)
		// kilocode_change end
	}

	/**
	 * Update overall progress
	 */
	private updateProgress(progress: number): void {
		// kilocode_change start
		getLog().info(`Progress update: ${progress}%`)
		this.onProgressUpdate?.(progress)
		// kilocode_change end
	}

	/**
	 * Send message to specific agent
	 */
	async sendMessageToAgent(agentId: string, message: string): Promise<string> {
		// kilocode_change start
		if (agentId === this.state.supervisor.getIdentity().id) {
			return await this.state.supervisor.sendMessage(message)
		}

		const worker = this.state.workers.get(agentId)
		if (!worker) {
			throw new Error(`Agent ${agentId} not found`)
		}

		return await worker.sendMessage(message)
		// kilocode_change end
	}

	/**
	 * Broadcast message to all workers
	 */
	async broadcastToWorkers(message: string): Promise<void> {
		// kilocode_change start
		const promises: Promise<string>[] = []

		for (const [id, worker] of this.state.workers) {
			promises.push(worker.sendMessage(message))
		}

		await Promise.all(promises)
		// kilocode_change end
	}

	/**
	 * Pause all agents
	 */
	pauseAll(): void {
		// kilocode_change start
		this.state.supervisor.pause()
		for (const worker of this.state.workers.values()) {
			worker.pause()
		}
		// kilocode_change end
	}

	/**
	 * Resume all agents
	 */
	resumeAll(): void {
		// kilocode_change start
		this.state.supervisor.resume()
		for (const worker of this.state.workers.values()) {
			worker.resume()
		}
		// kilocode_change end
	}

	/**
	 * Complete team execution
	 */
	async complete(): Promise<string> {
		// kilocode_change start
		const summary = await this.state.supervisor.completePurpose()
		this.state.status = "completed"

		// Mark all workers as completed
		for (const worker of this.state.workers.values()) {
			worker.complete()
		}

		return summary
		// kilocode_change end
	}

	/**
	 * Dispose team and cleanup
	 */
	dispose(): void {
		// kilocode_change start
		this.state.workers.clear()
		// In real implementation, cleanup resources, close connections, etc.
		// kilocode_change end
	}
}
