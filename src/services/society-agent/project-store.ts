// kilocode_change - new file
/**
 * Project Store
 *
 * Projects are the primary organizing unit. Each project has a folder,
 * accumulated knowledge, and one or more assigned agents.
 *
 * - Each agent belongs to exactly one project.
 * - Agents have a homeFolder within the project (defaults to "/").
 * - Agents have full access to the whole project, homeFolder is just the cwd.
 * - Ephemeral agents inherit the folder of the persistent agent that spawns them.
 */

import * as fs from "fs"
import * as path from "path"
import { getLog } from "./logger"

const log = getLog("project-store")

/**
 * An agent's configuration within a project.
 * Agents are defined inline within their project — one agent = one project.
 */
export interface ProjectAgentConfig {
	/** Unique agent ID (must be unique within the project) */
	id: string
	/** Human-readable name */
	name: string
	/** Agent's role / specialty */
	role: string
	/** What this agent is good at */
	capabilities: string[]
	/** System prompt — defines personality and expertise */
	systemPrompt: string
	/** Whether this agent can spawn ephemeral workers */
	canSpawnWorkers: boolean
	/** Home folder within the project (relative to project root, e.g. "/" or "frontend/") */
	homeFolder: string
	/** LLM model override (defaults to server default) */
	model?: string
	/** Summarized memory from past conversations (survives restarts) */
	memorySummary: string
	/** Agent-specific knowledge summary */
	knowledgeSummary: string
	/** Lifetime message count */
	totalMessages: number
	/** Tasks completed */
	tasksCompleted: number
	/** When last active */
	lastActiveAt: string
}

/**
 * A project — the primary organizing unit.
 */
export interface Project {
	/** Unique project ID (also the folder name under projects/) */
	id: string
	/** Human-readable project name */
	name: string
	/** What this project is about */
	description: string
	/** Folder path relative to projects/ (usually same as id) */
	folder: string
	/** Project-level knowledge (shared across all agents) */
	knowledge: string
	/** Agents assigned to this project */
	agents: ProjectAgentConfig[]
	/** Project status */
	status: "active" | "archived" | "paused"
	/** Timestamps */
	createdAt: string
	updatedAt: string
}

export interface ProjectStoreState {
	projects: Project[]
	version: number
	updatedAt: string
}

/**
 * Default starter project with two agents
 */
function createDefaultProjects(): Project[] {
	const now = new Date().toISOString()
	return [
		{
			id: "default",
			name: "Default Project",
			description: "A general-purpose workspace with an Architect (supervisor) and a Coder (worker).",
			folder: "default",
			knowledge: "",
			status: "active",
			createdAt: now,
			updatedAt: now,
			agents: [
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
					homeFolder: "/",
					memorySummary: "",
					knowledgeSummary: "",
					totalMessages: 0,
					tasksCompleted: 0,
					lastActiveAt: now,
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
					homeFolder: "/",
					memorySummary: "",
					knowledgeSummary: "",
					totalMessages: 0,
					tasksCompleted: 0,
					lastActiveAt: now,
				},
			],
		},
	]
}

export class ProjectStore {
	private storePath: string
	private state: ProjectStoreState
	private projectsBaseDir: string

	constructor(workspacePath: string) {
		this.projectsBaseDir = path.join(workspacePath, "projects")
		const metaDir = path.join(this.projectsBaseDir, ".society")
		this.storePath = path.join(metaDir, "projects.json")
		this.state = { projects: [], version: 1, updatedAt: new Date().toISOString() }

		if (!fs.existsSync(metaDir)) {
			fs.mkdirSync(metaDir, { recursive: true })
		}

		this.load()
	}

	// ========================================================================
	// Persistence
	// ========================================================================

	private load(): void {
		try {
			if (fs.existsSync(this.storePath)) {
				const data = JSON.parse(fs.readFileSync(this.storePath, "utf-8"))
				this.state = data
				log.info(`Loaded ${this.state.projects.length} projects`)
			} else {
				// Check for legacy persistent-agent-store and migrate
				const legacyPath = path.join(this.projectsBaseDir, ".agents", "agents.json")
				if (fs.existsSync(legacyPath)) {
					this.migrateFromLegacy(legacyPath)
				} else {
					this.state.projects = createDefaultProjects()
					this.save()
					log.info(`Created default projects`)
				}
			}
			// Ensure project folders exist
			for (const project of this.state.projects) {
				const dir = path.join(this.projectsBaseDir, project.folder)
				if (!fs.existsSync(dir)) {
					fs.mkdirSync(dir, { recursive: true })
					log.info(`Created project folder: ${dir}`)
				}
			}
		} catch (error) {
			log.error("Error loading project store:", error)
			this.state.projects = createDefaultProjects()
			this.save()
		}
	}

	/**
	 * Migrate from the old PersistentAgentStore format.
	 * Each standalone agent becomes a single-agent project.
	 */
	private migrateFromLegacy(legacyPath: string): void {
		try {
			const data = JSON.parse(fs.readFileSync(legacyPath, "utf-8"))
			const legacyAgents = data.agents || []
			const now = new Date().toISOString()

			// Group agents: if they share a workspaceFolder, put them in the same project
			// Otherwise each agent becomes its own project
			const folderMap = new Map<string, any[]>()
			for (const agent of legacyAgents) {
				const folder = agent.workspaceFolder || agent.id
				if (!folderMap.has(folder)) folderMap.set(folder, [])
				folderMap.get(folder)!.push(agent)
			}

			this.state.projects = []
			for (const [folder, agents] of folderMap) {
				const project: Project = {
					id: folder,
					name: agents.length === 1 ? agents[0].name : folder.charAt(0).toUpperCase() + folder.slice(1),
					description: agents.length === 1
						? `${agents[0].role} workspace`
						: `Multi-agent project with ${agents.length} agents`,
					folder,
					knowledge: "",
					status: "active",
					createdAt: agents[0].createdAt || now,
					updatedAt: now,
					agents: agents.map((a: any) => ({
						id: a.id,
						name: a.name,
						role: a.role,
						capabilities: a.capabilities || [],
						systemPrompt: a.systemPrompt || "",
						canSpawnWorkers: a.canSpawnWorkers || false,
						homeFolder: "/",
						model: a.model,
						memorySummary: a.memorySummary || "",
						knowledgeSummary: a.knowledgeSummary || "",
						totalMessages: a.totalMessages || 0,
						tasksCompleted: a.tasksCompleted || 0,
						lastActiveAt: a.lastActiveAt || now,
					})),
				}
				this.state.projects.push(project)
			}

			this.save()
			log.info(`Migrated ${legacyAgents.length} legacy agents into ${this.state.projects.length} projects`)
		} catch (error) {
			log.error("Error migrating legacy agent store:", error)
			this.state.projects = createDefaultProjects()
			this.save()
		}
	}

	private save(): void {
		try {
			this.state.updatedAt = new Date().toISOString()
			fs.writeFileSync(this.storePath, JSON.stringify(this.state, null, 2), "utf-8")
		} catch (error) {
			log.error("Error saving project store:", error)
		}
	}

	// ========================================================================
	// Project CRUD
	// ========================================================================

	getAll(): Project[] {
		return [...this.state.projects]
	}

	get(id: string): Project | undefined {
		return this.state.projects.find((p) => p.id === id)
	}

	create(input: {
		id: string
		name: string
		description: string
		folder?: string
		knowledge?: string
		agents?: Omit<ProjectAgentConfig, "memorySummary" | "knowledgeSummary" | "totalMessages" | "tasksCompleted" | "lastActiveAt">[]
	}): Project {
		if (this.state.projects.some((p) => p.id === input.id)) {
			throw new Error(`Project "${input.id}" already exists`)
		}

		const now = new Date().toISOString()
		const folder = input.folder || input.id

		// Create project folder
		const dir = path.join(this.projectsBaseDir, folder)
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true })
			log.info(`Created project folder: ${dir}`)
		}

		const project: Project = {
			id: input.id,
			name: input.name,
			description: input.description,
			folder,
			knowledge: input.knowledge || "",
			status: "active",
			createdAt: now,
			updatedAt: now,
			agents: (input.agents || []).map((a) => ({
				...a,
				memorySummary: "",
				knowledgeSummary: "",
				totalMessages: 0,
				tasksCompleted: 0,
				lastActiveAt: now,
			})),
		}

		this.state.projects.push(project)
		this.save()
		log.info(`Created project: ${project.name} (${project.id})`)
		return project
	}

	update(id: string, updates: Partial<Pick<Project, "name" | "description" | "folder" | "knowledge" | "status">>): Project | undefined {
		const project = this.get(id)
		if (!project) return undefined

		if (updates.name !== undefined) project.name = updates.name
		if (updates.description !== undefined) project.description = updates.description
		if (updates.folder !== undefined) project.folder = updates.folder
		if (updates.knowledge !== undefined) project.knowledge = updates.knowledge
		if (updates.status !== undefined) project.status = updates.status
		project.updatedAt = new Date().toISOString()

		this.save()
		return project
	}

	delete(id: string): boolean {
		const idx = this.state.projects.findIndex((p) => p.id === id)
		if (idx === -1) return false
		this.state.projects.splice(idx, 1)
		this.save()
		log.info(`Deleted project: ${id}`)
		return true
	}

	// ========================================================================
	// Agent operations within projects
	// ========================================================================

	/** Get a specific agent by project + agent ID */
	getAgent(projectId: string, agentId: string): ProjectAgentConfig | undefined {
		const project = this.get(projectId)
		return project?.agents.find((a) => a.id === agentId)
	}

	/** Find which project an agent belongs to (by global agent ID search) */
	findAgentProject(agentId: string): { project: Project; agent: ProjectAgentConfig } | undefined {
		for (const project of this.state.projects) {
			const agent = project.agents.find((a) => a.id === agentId)
			if (agent) return { project, agent }
		}
		return undefined
	}

	/** Add an agent to a project */
	addAgent(
		projectId: string,
		input: Omit<ProjectAgentConfig, "memorySummary" | "knowledgeSummary" | "totalMessages" | "tasksCompleted" | "lastActiveAt">,
	): ProjectAgentConfig | undefined {
		const project = this.get(projectId)
		if (!project) return undefined

		if (project.agents.some((a) => a.id === input.id)) {
			throw new Error(`Agent "${input.id}" already exists in project "${projectId}"`)
		}

		// Check no other project has this agent
		const existing = this.findAgentProject(input.id)
		if (existing) {
			throw new Error(`Agent "${input.id}" already belongs to project "${existing.project.id}"`)
		}

		const agent: ProjectAgentConfig = {
			...input,
			memorySummary: "",
			knowledgeSummary: "",
			totalMessages: 0,
			tasksCompleted: 0,
			lastActiveAt: new Date().toISOString(),
		}

		project.agents.push(agent)
		project.updatedAt = new Date().toISOString()
		this.save()
		log.info(`Added agent ${agent.name} to project ${project.name}`)
		return agent
	}

	/** Update an agent within a project */
	updateAgent(
		projectId: string,
		agentId: string,
		updates: Partial<Pick<ProjectAgentConfig, "name" | "role" | "capabilities" | "systemPrompt" | "canSpawnWorkers" | "homeFolder" | "model">>,
	): ProjectAgentConfig | undefined {
		const project = this.get(projectId)
		if (!project) return undefined

		const agent = project.agents.find((a) => a.id === agentId)
		if (!agent) return undefined

		Object.assign(agent, updates)
		project.updatedAt = new Date().toISOString()
		this.save()
		return agent
	}

	/** Remove an agent from a project */
	removeAgent(projectId: string, agentId: string): boolean {
		const project = this.get(projectId)
		if (!project) return false

		const idx = project.agents.findIndex((a) => a.id === agentId)
		if (idx === -1) return false

		project.agents.splice(idx, 1)
		project.updatedAt = new Date().toISOString()
		this.save()
		log.info(`Removed agent ${agentId} from project ${project.name}`)
		return true
	}

	/** Record activity for an agent */
	recordActivity(projectId: string, agentId: string, messagesAdded = 1): void {
		const agent = this.getAgent(projectId, agentId)
		if (!agent) return
		agent.totalMessages += messagesAdded
		agent.lastActiveAt = new Date().toISOString()
		this.save()
	}

	/** Update agent memory summary */
	updateAgentMemory(projectId: string, agentId: string, memorySummary: string): void {
		const agent = this.getAgent(projectId, agentId)
		if (!agent) return
		agent.memorySummary = memorySummary
		this.save()
	}

	/** Reset agent memory (clear conversation history summary) */
	resetAgentMemory(projectId: string, agentId: string): void {
		this.updateAgentMemory(projectId, agentId, "")
	}

	// ========================================================================
	// Workspace helpers
	// ========================================================================

	/** Get the filesystem directory for a project */
	projectDir(projectId: string): string {
		const project = this.get(projectId)
		const folder = project?.folder || projectId
		return path.join(this.projectsBaseDir, folder)
	}

	/** Get the resolved home directory for an agent within a project */
	agentHomeDir(projectId: string, agentId: string): string {
		const project = this.get(projectId)
		const agent = project?.agents.find((a) => a.id === agentId)
		const projectFolder = project?.folder || projectId
		const home = agent?.homeFolder || "/"

		if (home === "/" || home === "") {
			return path.join(this.projectsBaseDir, projectFolder)
		}
		return path.join(this.projectsBaseDir, projectFolder, home)
	}
}
