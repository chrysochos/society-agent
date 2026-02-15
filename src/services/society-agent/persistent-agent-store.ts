// kilocode_change - new file
/**
 * Persistent Agent Store
 *
 * Stores agent profiles to disk so they survive server restarts.
 * Each persistent agent has: name, role, system prompt, capabilities,
 * conversation history summary, and knowledge.
 *
 * Ephemeral agents are NOT stored — they're created per-purpose and disposed.
 * Persistent agents can spawn ephemeral workers for subtasks.
 */

import * as fs from "fs"
import * as path from "path"
import { getLog } from "./logger"

const log = getLog("persistent-agent-store")

export interface PersistentAgentProfile {
	/** Unique ID */
	id: string
	/** Human-readable name */
	name: string
	/** Agent's role/specialty */
	role: string
	/** What this agent is good at */
	capabilities: string[]
	/** System prompt that defines this agent's personality and expertise */
	systemPrompt: string
	/** Whether this agent can spawn ephemeral workers */
	canSpawnWorkers: boolean
	/** Agent lifecycle */
	lifecycle: "persistent"
	/** Current status */
	status: "active" | "idle" | "disabled"
	/** LLM model to use (defaults to server default) */
	model?: string
	/** Agent's dedicated workspace folder (relative to projects/) */
	workspaceFolder: string
	/** Summarized knowledge from past conversations */
	knowledgeSummary: string
	/** Number of messages processed lifetime */
	totalMessages: number
	/** Number of tasks completed */
	tasksCompleted: number
	/** When agent was created */
	createdAt: string
	/** When agent was last active */
	lastActiveAt: string
	/** Conversation memory summary (survives restarts) */
	memorySummary: string
}

export interface AgentStoreState {
	agents: PersistentAgentProfile[]
	version: number
	updatedAt: string
}

const DEFAULT_AGENTS: PersistentAgentProfile[] = [
	{
		id: "architect",
		name: "Architect",
		role: "Lead Architect",
		capabilities: ["planning", "code-analysis", "architecture", "task-delegation"],
		systemPrompt: `You are Architect, a senior software architect AI agent.

Your expertise:
- System design and architecture decisions
- Breaking down complex projects into manageable tasks
- Code review and quality assessment
- Technology selection and trade-offs

When you receive a complex task, analyze it and decide:
1. Can you handle it alone? → Do it directly
2. Does it need multiple specialists? → Describe what workers you need and their tasks

Always think architecturally: modularity, separation of concerns, maintainability.
Provide clear rationale for decisions. Use markdown formatting.`,
		canSpawnWorkers: true,
		lifecycle: "persistent",
		status: "active",
		workspaceFolder: "architect",
		knowledgeSummary: "",
		totalMessages: 0,
		tasksCompleted: 0,
		createdAt: new Date().toISOString(),
		lastActiveAt: new Date().toISOString(),
		memorySummary: "",
	},
	{
		id: "coder",
		name: "Coder",
		role: "Full-Stack Developer",
		capabilities: ["coding", "debugging", "testing", "file-write"],
		systemPrompt: `You are Coder, a full-stack developer AI agent.

Your expertise:
- Writing clean, production-quality code
- Debugging and fixing issues
- Writing tests
- Working with TypeScript, Python, React, Node.js, and more

When given a coding task:
1. Understand the requirements clearly
2. Write well-structured, commented code
3. Consider edge cases and error handling
4. Suggest tests if appropriate

You write code directly — no need to ask for permission. Create files when needed.
Be concise in explanations, let the code speak.`,
		canSpawnWorkers: false,
		lifecycle: "persistent",
		status: "active",
		workspaceFolder: "coder",
		knowledgeSummary: "",
		totalMessages: 0,
		tasksCompleted: 0,
		createdAt: new Date().toISOString(),
		lastActiveAt: new Date().toISOString(),
		memorySummary: "",
	},
]

export class PersistentAgentStore {
	private storePath: string
	private state: AgentStoreState

	constructor(workspacePath: string) {
		const agentDir = path.join(workspacePath, "projects", ".agents")
		this.storePath = path.join(agentDir, "agents.json")
		this.state = { agents: [], version: 1, updatedAt: new Date().toISOString() }

		// Ensure directory exists
		if (!fs.existsSync(agentDir)) {
			fs.mkdirSync(agentDir, { recursive: true })
		}

		this.load()
	}

	private load(): void {
		try {
			if (fs.existsSync(this.storePath)) {
				const data = JSON.parse(fs.readFileSync(this.storePath, "utf-8"))
				this.state = data
				// Migrate: add workspaceFolder to agents that don't have it
				for (const agent of this.state.agents) {
					if (!agent.workspaceFolder) {
						agent.workspaceFolder = agent.id
					}
				}
				log.info(`Loaded ${this.state.agents.length} persistent agents`)
			} else {
				// First run: create default agents
				this.state.agents = DEFAULT_AGENTS
				this.save()
				log.info(`Created ${DEFAULT_AGENTS.length} default persistent agents`)
			}
			// Ensure workspace folders exist for all agents
			const projectsDir = path.dirname(path.dirname(this.storePath))
			for (const agent of this.state.agents) {
				const agentDir = path.join(projectsDir, agent.workspaceFolder)
				if (!fs.existsSync(agentDir)) {
					fs.mkdirSync(agentDir, { recursive: true })
					log.info(`Created workspace folder: ${agentDir}`)
				}
			}
		} catch (error) {
			log.error("Error loading agent store:", error)
			this.state.agents = DEFAULT_AGENTS
			this.save()
		}
	}

	private save(): void {
		try {
			this.state.updatedAt = new Date().toISOString()
			fs.writeFileSync(this.storePath, JSON.stringify(this.state, null, 2), "utf-8")
		} catch (error) {
			log.error("Error saving agent store:", error)
		}
	}

	/** Get all persistent agents */
	getAll(): PersistentAgentProfile[] {
		return [...this.state.agents]
	}

	/** Get agent by ID */
	get(id: string): PersistentAgentProfile | undefined {
		return this.state.agents.find((a) => a.id === id)
	}

	/** Create a new persistent agent */
	create(profile: Omit<PersistentAgentProfile, "createdAt" | "lastActiveAt" | "totalMessages" | "tasksCompleted" | "lifecycle" | "status" | "knowledgeSummary" | "memorySummary" | "workspaceFolder">): PersistentAgentProfile {
		if (this.state.agents.some((a) => a.id === profile.id)) {
			throw new Error(`Agent with ID "${profile.id}" already exists`)
		}

		// Create dedicated workspace folder for this agent
		const workspaceFolder = profile.id
		const agentWorkDir = path.join(path.dirname(path.dirname(this.storePath)), workspaceFolder)
		if (!fs.existsSync(agentWorkDir)) {
			fs.mkdirSync(agentWorkDir, { recursive: true })
			log.info(`Created workspace folder: ${agentWorkDir}`)
		}

		const agent: PersistentAgentProfile = {
			...profile,
			lifecycle: "persistent",
			status: "active",
			workspaceFolder,
			knowledgeSummary: "",
			totalMessages: 0,
			tasksCompleted: 0,
			createdAt: new Date().toISOString(),
			lastActiveAt: new Date().toISOString(),
			memorySummary: "",
		}

		this.state.agents.push(agent)
		this.save()
		log.info(`Created persistent agent: ${agent.name} (${agent.id})`)
		return agent
	}

	/** Update an existing persistent agent */
	update(id: string, updates: Partial<PersistentAgentProfile>): PersistentAgentProfile | undefined {
		const idx = this.state.agents.findIndex((a) => a.id === id)
		if (idx === -1) return undefined

		// Don't allow changing id or lifecycle
		const { id: _id, lifecycle: _lc, ...safeUpdates } = updates as any
		this.state.agents[idx] = { ...this.state.agents[idx], ...safeUpdates }
		this.save()
		return this.state.agents[idx]
	}

	/** Delete a persistent agent */
	delete(id: string): boolean {
		const idx = this.state.agents.findIndex((a) => a.id === id)
		if (idx === -1) return false
		this.state.agents.splice(idx, 1)
		this.save()
		log.info(`Deleted persistent agent: ${id}`)
		return true
	}

	/** Record activity for an agent */
	recordActivity(id: string, messagesAdded: number = 1): void {
		const agent = this.get(id)
		if (!agent) return
		agent.totalMessages += messagesAdded
		agent.lastActiveAt = new Date().toISOString()
		this.save()
	}

	/** Record task completion */
	recordTaskCompletion(id: string): void {
		const agent = this.get(id)
		if (!agent) return
		agent.tasksCompleted += 1
		agent.lastActiveAt = new Date().toISOString()
		this.save()
	}

	/** Update memory summary for an agent */
	updateMemory(id: string, memorySummary: string): void {
		const agent = this.get(id)
		if (!agent) return
		agent.memorySummary = memorySummary
		this.save()
	}

	/** Update knowledge summary */
	updateKnowledge(id: string, knowledgeSummary: string): void {
		const agent = this.get(id)
		if (!agent) return
		agent.knowledgeSummary = knowledgeSummary
		this.save()
	}
}
