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

const log = getLog()

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
	/** System prompt — defines personality and expertise. Optional: auto-generated from name+role if not provided */
	systemPrompt?: string
	/** Home folder within the project (relative to project root, e.g. "/" or "frontend/") */
	homeFolder: string
	/** LLM model override (defaults to server default) */
	model?: string
	/** When last active */
	lastActiveAt?: string
	// kilocode_change start - port configuration
	/** Port this agent's server should use (if applicable) */
	port?: number
	/** Type of server this agent runs (frontend, backend, api, etc) */
	serverType?: "frontend" | "backend" | "api" | "database" | "none"
	// kilocode_change end
	// kilocode_change start - ephemeral agents
	/** If true, agent is temporary and will be deleted after completing its task */
	ephemeral?: boolean
	/** ID of the agent that created this ephemeral agent */
	createdBy?: string
	// kilocode_change end
	// kilocode_change start - hierarchy
	/** Boss's agent ID (null/undefined = top-level, no boss) */
	reportsTo?: string
	/** Domain/scope this agent owns (e.g. "backend", "frontend/components") */
	scope?: string
	// kilocode_change end
	// kilocode_change start - inherited folders from retired agents
	/** Additional folders this agent has access to (inherited from retired agents) */
	inheritedFolders?: Array<{
		path: string
		fromAgent: string
		fromAgentName: string
		inheritedAt: string
		reason: string
	}>
	// kilocode_change end
	// kilocode_change start - scheduled tasks
	/** Scheduled tasks for this agent (autonomous periodic work) */
	scheduledTasks?: ScheduledTask[]
	// kilocode_change end
	// kilocode_change start - agent memory
	/** Agent's memory summary from past conversations */
	memorySummary?: string
	// kilocode_change end
}

// kilocode_change start - Task pool system
/**
 * Task context - provides full information for the worker to execute the task
 */
export interface TaskContext {
	/** Working directory for this task (relative to project root) */
	workingDirectory: string
	/** Files to read for context before starting */
	relevantFiles?: string[]
	/** Expected output files with descriptions */
	outputPaths?: Record<string, string>
	/** Coding conventions, patterns to follow */
	conventions?: string
	/** Dependencies or prerequisites */
	dependencies?: string[]
	/** Any additional context */
	notes?: string
}

/**
 * A task in the task pool
 */
export interface Task {
	/** Unique task ID */
	id: string
	/** Short title */
	title: string
	/** Full description of what to do */
	description: string
	/** Priority (higher = more urgent) */
	priority: number
	/** Task status */
	status: "available" | "claimed" | "in-progress" | "completed" | "failed"
	/** ID of agent that created/delegated this task */
	createdBy: string
	// kilocode_change start - hierarchy
	/** Specific agent this task is assigned to (null = open pool) */
	assignedTo?: string
	/** Parent task ID (for task breakdown/decomposition) */
	parentTaskId?: string
	/** Urgency level for escalation rules */
	urgency?: "normal" | "urgent" | "critical"
	// kilocode_change end
	/** ID of worker that claimed this task */
	claimedBy?: string
	/** When claimed */
	claimedAt?: string
	/** Full context for execution */
	context: TaskContext
	/** Result after completion */
	result?: {
		filesCreated: string[]
		filesModified: string[]
		summary: string
	}
	/** Error info if failed */
	error?: string
	/** Timestamps */
	createdAt: string
	completedAt?: string
}

/**
 * A scheduled task that runs automatically on a schedule.
 */
export interface ScheduledTask {
	/** Unique scheduled task ID */
	id: string
	/** Human-readable name */
	name: string
	/** Task type: 'ai' uses LLM with prompt, 'command' runs shell command (no AI tokens) */
	type: "ai" | "command"
	/** What the agent should do when triggered (for type='ai') */
	prompt?: string
	/** Shell command to run (for type='command') - runs in agent's home folder */
	command?: string
	/** Cron expression (e.g. "0 9 * * *" = 9am daily, "0,30 * * * *" = every 30 min) */
	cron: string
	/** Whether this schedule is active */
	enabled: boolean
	/** Last time this ran */
	lastRunAt?: string
	/** Next scheduled run time */
	nextRunAt?: string
	/** How the last run went */
	lastRunStatus?: "success" | "failed" | "running"
	/** Error from last run if failed */
	lastError?: string
	/** Last command output (for type='command') */
	lastOutput?: string
	/** Total run count */
	runCount: number
	/** When created */
	createdAt: string
}
// kilocode_change end

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
	// kilocode_change start - Task pool
	/** Task pool for this project */
	tasks: Task[]
	/** Maximum concurrent ephemeral workers (default: 3) */
	maxConcurrentWorkers: number
	// kilocode_change end
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
			// kilocode_change start - Task pool
			tasks: [],
			maxConcurrentWorkers: 3,
			// kilocode_change end
			status: "active",
			createdAt: now,
			updatedAt: now,
			agents: [
				{
					id: "architect",
					name: "Architect",
					role: "Lead Architect",
					capabilities: ["planning", "code-analysis", "architecture", "task-delegation"],
					// kilocode_change start - Updated system prompt to use AGENTS.md
					systemPrompt: `You are Architect, a senior software architect and team supervisor.

## CRITICAL: READ YOUR AGENTS.md FIRST
Before doing ANYTHING, use read_file to check your AGENTS.md file. It contains:
- Your identity and evolving memory
- Team members and their roles
- Project architecture decisions
- Important context from past work

## Your Responsibilities
1. Coordinate your team of worker agents
2. Delegate tasks with CLEAR, SPECIFIC instructions
3. Update your AGENTS.md with decisions and learnings

## Workflow
1. read_file("AGENTS.md") - Get your context and team info
2. list_team - See who is available
3. delegate_task - Assign work with specific instructions
4. Update AGENTS.md with what you learned

## When Delegating Tasks
ALWAYS include in task instructions:
- Clear requirements and expected output
- Technology choices if relevant
- Any context the worker needs

Use markdown formatting. Be decisive and action-oriented.`,
					// kilocode_change end
					ephemeral: false, // kilocode_change - Supervisor is persistent
					homeFolder: "/",
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
					ephemeral: false, // kilocode_change - Persistent worker agent
					homeFolder: "/",
					lastActiveAt: now,
				},
			],
		},
	]
}

export class ProjectStore {
	private storePath: string
	private state: ProjectStoreState
	public projectsBaseDir: string // kilocode_change - made public for file path calculations

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
			// kilocode_change start - Initialize AGENTS.md for existing agents
			this.initializeAgentKnowledgeFiles()
			// kilocode_change end
		} catch (error) {
			log.error("Error loading project store:", error)
			this.state.projects = createDefaultProjects()
			this.save()
		}
	}

	// kilocode_change start - Initialize AGENTS.md for all existing agents
	private initializeAgentKnowledgeFiles(): void {
		for (const project of this.state.projects) {
			for (const agent of project.agents) {
				this.createAgentKnowledgeFile(project.id, agent)
			}
		}
	}
	// kilocode_change end

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
						systemPrompt: a.systemPrompt || "",
						// kilocode_change - Use ephemeral as primary flag
						ephemeral: a.ephemeral ?? true,
						homeFolder: "/",
						model: a.model,
						memorySummary: a.memorySummary || "",
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
		agents?: Omit<ProjectAgentConfig, "lastActiveAt">[]
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
			// kilocode_change start - Task pool
			tasks: [],
			maxConcurrentWorkers: 3,
			// kilocode_change end
			agents: (input.agents || []).map((a) => ({
				...a,
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
		input: Omit<ProjectAgentConfig, "lastActiveAt">,
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
			lastActiveAt: new Date().toISOString(),
		}

		project.agents.push(agent)
		project.updatedAt = new Date().toISOString()
		this.save()
		
		// kilocode_change start - Create AGENTS.md file for new agent
		this.createAgentKnowledgeFile(projectId, agent)
		// kilocode_change end
		
		log.info(`Added agent ${agent.name} to project ${project.name}`)
		return agent
	}

	// kilocode_change start - Create initial AGENTS.md knowledge file for an agent
	private createAgentKnowledgeFile(projectId: string, agent: ProjectAgentConfig): void {
		const agentDir = this.agentHomeDir(projectId, agent.id)
		const agentsFilePath = path.join(agentDir, "AGENTS.md")
		
		// Don't overwrite if file already exists
		if (fs.existsSync(agentsFilePath)) {
			log.info(`AGENTS.md already exists for ${agent.name}, skipping creation`)
			return
		}
		
		// Create directory if it doesn't exist
		if (!fs.existsSync(agentDir)) {
			fs.mkdirSync(agentDir, { recursive: true })
		}
		
		const template = `# ${agent.name} - Knowledge Index

> **Agent ID**: ${agent.id}  
> **Role**: ${agent.role}  
> **Created**: ${new Date().toISOString()}

---

## 📋 HOW TO USE THIS INDEX

**This is your KNOWLEDGE INDEX for LAZY LOADING:**
1. Read this file FIRST to understand what knowledge exists
2. Only read detailed files when you NEED them for the current task
3. Update this index whenever you create/modify knowledge files

---

## 🔄 Current State

- **Status**: Initialized
- **Last Task**: None yet
- **Working On**: Nothing
- **Blocked By**: Nothing

---

## 🎯 Desired State

- **Primary Goal**: ${agent.role}
- **Success Criteria**: (set by supervisor)
- **Deadline**: None

---

## 📚 Knowledge Files Index

**Read this table to find what you need. Only load files relevant to your current task.**

| File | Contains | When to Read |
|------|----------|--------------|
| \`AGENTS.md\` | This index | Always read first |
| \`STATE.md\` | Detailed current/desired state | When planning work |
| \`ARCHITECTURE.md\` | System design, components | When building/modifying structure |
| \`API.md\` | Endpoints, contracts, schemas | When working with APIs |
| \`PROCEDURES.md\` | Step-by-step workflows | When following/creating processes |
| \`DECISIONS.md\` | Key decisions & rationale | When making similar decisions |
| \`TROUBLESHOOTING.md\` | Known issues & solutions | When debugging |
| \`DEPENDENCIES.md\` | Package info, versions | When installing/updating deps |

*Create files as needed. Keep this index updated!*

---

## 🗂️ Objects & Entities Registry

**Quick lookup - detailed docs in linked files.**

| Object | Type | File | One-line Description |
|--------|------|------|---------------------|
| (none yet) | - | - | - |

---

## ⚡ Key Procedures (Summary)

| Procedure | File | When to Use |
|-----------|------|-------------|
| (none yet) | - | - |

---

## 📝 Recent Activity

| Date | Action | Result | Details In |
|------|--------|--------|------------|
| ${new Date().toISOString().split("T")[0]} | Created | Agent initialized | - |

---

## 💡 Quick Notes

(Add brief notes here. Move detailed content to separate files.)

`

		try {
			fs.writeFileSync(agentsFilePath, template, "utf-8")
			log.info(`Created AGENTS.md for ${agent.name} at ${agentsFilePath}`)
		} catch (err) {
			log.warn(`Failed to create AGENTS.md for ${agent.name}: ${err}`)
		}
	}
	// kilocode_change end

	/** Update an agent within a project */
	updateAgent(
		projectId: string,
		agentId: string,
		// kilocode_change - added port, serverType, reportsTo, scope, scheduledTasks, ephemeral, inheritedFolders; removed canSpawnWorkers, capabilities, knowledgeSummary
		updates: Partial<Pick<ProjectAgentConfig, "name" | "role" | "systemPrompt" | "ephemeral" | "homeFolder" | "model" | "port" | "serverType" | "reportsTo" | "scope" | "scheduledTasks" | "inheritedFolders">>,
	): ProjectAgentConfig | undefined {
		const project = this.get(projectId)
		if (!project) return undefined

		const agent = project.agents.find((a) => a.id === agentId)
		if (!agent) return undefined

		// Validate reportsTo if changing
		if (updates.reportsTo !== undefined && updates.reportsTo !== null && updates.reportsTo !== "") {
			const boss = project.agents.find((a) => a.id === updates.reportsTo)
			if (!boss) {
				throw new Error(`Boss agent "${updates.reportsTo}" not found in project`)
			}
			// Prevent circular reporting
			let current = boss
			while (current.reportsTo) {
				if (current.reportsTo === agentId) {
					throw new Error(`Circular reporting: cannot report to ${updates.reportsTo} who reports (directly or indirectly) to you`)
				}
				current = project.agents.find((a) => a.id === current.reportsTo)!
				if (!current) break
			}
		}

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

	/** Record activity for an agent - just updates lastActiveAt */
	recordActivity(projectId: string, agentId: string): void {
		const agent = this.getAgent(projectId, agentId)
		if (!agent) return
		agent.lastActiveAt = new Date().toISOString()
		this.save()
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

	// kilocode_change start - Task pool methods
	// ========================================================================
	// Task Pool Management
	// ========================================================================

	/** Generate a unique task ID */
	private generateTaskId(): string {
		return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
	}

	/** Get all tasks for a project */
	getTasks(projectId: string): Task[] {
		const project = this.get(projectId)
		return project?.tasks || []
	}

	/** Get a specific task */
	getTask(projectId: string, taskId: string): Task | undefined {
		const project = this.get(projectId)
		return project?.tasks?.find((t) => t.id === taskId)
	}

	/** Create a new task */
	createTask(
		projectId: string,
		createdBy: string,
		title: string,
		description: string,
		context: TaskContext,
		priority: number = 5
	): Task | undefined {
		const project = this.get(projectId)
		if (!project) return undefined

		// Initialize tasks array if needed
		if (!project.tasks) {
			project.tasks = []
		}

		const task: Task = {
			id: this.generateTaskId(),
			title,
			description,
			priority,
			status: "available",
			createdBy,
			context,
			createdAt: new Date().toISOString(),
		}

		project.tasks.push(task)
		project.updatedAt = new Date().toISOString()
		this.save()
		log.info(`Task "${title}" created in project ${project.name} by ${createdBy}`)
		return task
	}

	/** Claim an available task */
	claimTask(projectId: string, taskId: string, agentId: string): Task | undefined {
		const project = this.get(projectId)
		if (!project) return undefined

		const task = project.tasks?.find((t) => t.id === taskId)
		if (!task || task.status !== "available") return undefined

		task.status = "claimed"
		task.claimedBy = agentId
		task.claimedAt = new Date().toISOString()
		project.updatedAt = new Date().toISOString()
		this.save()
		log.info(`Task "${task.title}" claimed by ${agentId}`)
		return task
	}

	/** Claim the next available task (highest priority first) */
	claimNextTask(projectId: string, agentId: string): Task | undefined {
		const project = this.get(projectId)
		if (!project?.tasks) return undefined

		// Find highest priority available task
		const availableTasks = project.tasks
			.filter((t) => t.status === "available")
			.sort((a, b) => b.priority - a.priority)

		if (availableTasks.length === 0) return undefined

		return this.claimTask(projectId, availableTasks[0].id, agentId)
	}

	/** Start working on a claimed task */
	startTask(projectId: string, taskId: string): Task | undefined {
		const project = this.get(projectId)
		if (!project) return undefined

		const task = project.tasks?.find((t) => t.id === taskId)
		if (!task || task.status !== "claimed") return undefined

		task.status = "in-progress"
		project.updatedAt = new Date().toISOString()
		this.save()
		log.info(`Task "${task.title}" started`)
		return task
	}

	/** Complete a task */
	completeTask(
		projectId: string,
		taskId: string,
		result: { filesCreated: string[]; filesModified: string[]; summary: string }
	): Task | undefined {
		const project = this.get(projectId)
		if (!project) return undefined

		const task = project.tasks?.find((t) => t.id === taskId)
		if (!task || !["claimed", "in-progress"].includes(task.status)) return undefined

		task.status = "completed"
		task.result = result
		task.completedAt = new Date().toISOString()
		project.updatedAt = new Date().toISOString()
		this.save()
		log.info(`Task "${task.title}" completed`)
		return task
	}

	/** Fail a task (returns to available for retry) */
	failTask(projectId: string, taskId: string, error: string): Task | undefined {
		const project = this.get(projectId)
		if (!project) return undefined

		const task = project.tasks?.find((t) => t.id === taskId)
		if (!task) return undefined

		task.status = "available" // Return to pool for retry
		task.error = error
		task.claimedBy = undefined
		task.claimedAt = undefined
		project.updatedAt = new Date().toISOString()
		this.save()
		log.info(`Task "${task.title}" failed: ${error}, returned to pool`)
		return task
	}

	/** Get count of active ephemeral workers in a project */
	getActiveWorkerCount(projectId: string): number {
		const project = this.get(projectId)
		if (!project) return 0
		return project.agents.filter((a) => a.ephemeral).length
	}

	/** Check if we can spawn more workers */
	canSpawnWorker(projectId: string): boolean {
		const project = this.get(projectId)
		if (!project) return false
		const maxWorkers = project.maxConcurrentWorkers || 3
		return this.getActiveWorkerCount(projectId) < maxWorkers
	}

	/** Get available tasks count */
	getAvailableTaskCount(projectId: string): number {
		const project = this.get(projectId)
		if (!project?.tasks) return 0
		return project.tasks.filter((t) => t.status === "available").length
	}
	// kilocode_change end

	// kilocode_change start - hierarchy methods
	/** Get an agent's boss */
	getBoss(projectId: string, agentId: string): ProjectAgentConfig | undefined {
		const agent = this.getAgent(projectId, agentId)
		if (!agent?.reportsTo) return undefined
		return this.getAgent(projectId, agent.reportsTo)
	}

	/** Get an agent's direct reports (subordinates) */
	getDirectReports(projectId: string, agentId: string): ProjectAgentConfig[] {
		const project = this.get(projectId)
		if (!project) return []
		return project.agents.filter((a) => a.reportsTo === agentId && !a.ephemeral)
	}

	/** Get the full chain of command up to the top */
	getHierarchyChain(projectId: string, agentId: string): ProjectAgentConfig[] {
		const chain: ProjectAgentConfig[] = []
		let current = this.getAgent(projectId, agentId)
		while (current) {
			chain.push(current)
			if (!current.reportsTo) break
			current = this.getAgent(projectId, current.reportsTo)
		}
		return chain
	}

	/** Get all agents under this agent (recursive) */
	getAllSubordinates(projectId: string, agentId: string): ProjectAgentConfig[] {
		const result: ProjectAgentConfig[] = []
		const directReports = this.getDirectReports(projectId, agentId)
		for (const report of directReports) {
			result.push(report)
			result.push(...this.getAllSubordinates(projectId, report.id))
		}
		return result
	}

	/** Check if one agent can delegate to another (must be direct report) */
	canDelegateTo(projectId: string, fromAgentId: string, toAgentId: string): boolean {
		const target = this.getAgent(projectId, toAgentId)
		return target?.reportsTo === fromAgentId
	}

	/** Check if one agent can see another's tasks (boss can see subordinates) */
	canSeeTasks(projectId: string, viewerAgentId: string, targetAgentId: string): boolean {
		// Can always see own tasks
		if (viewerAgentId === targetAgentId) return true
		// Check if target is a subordinate
		const subordinates = this.getAllSubordinates(projectId, viewerAgentId)
		return subordinates.some((s) => s.id === targetAgentId)
	}

	/**
	 * Get escalation target based on urgency and availability
	 * - Normal: always go to direct boss, wait if unavailable
	 * - Urgent: go to boss, escalate to boss's boss if unavailable
	 * - Critical: escalate to top immediately
	 */
	getEscalationTarget(
		projectId: string,
		agentId: string,
		urgency: "normal" | "urgent" | "critical",
		isAgentAvailable: (agentId: string) => boolean
	): { target: ProjectAgentConfig | undefined; waitForBoss: boolean } {
		const agent = this.getAgent(projectId, agentId)
		if (!agent?.reportsTo) {
			// Already at top, no escalation possible
			return { target: undefined, waitForBoss: false }
		}

		const boss = this.getBoss(projectId, agentId)
		if (!boss) return { target: undefined, waitForBoss: false }

		const bossAvailable = isAgentAvailable(boss.id)

		switch (urgency) {
			case "normal":
				// Always wait for direct boss
				return { target: boss, waitForBoss: !bossAvailable }

			case "urgent":
				if (bossAvailable) {
					return { target: boss, waitForBoss: false }
				}
				// Boss unavailable - escalate to boss's boss
				const grandBoss = this.getBoss(projectId, boss.id)
				if (grandBoss && isAgentAvailable(grandBoss.id)) {
					return { target: grandBoss, waitForBoss: false }
				}
				// No available escalation, wait for boss
				return { target: boss, waitForBoss: true }

			case "critical":
				// Go straight to top
				const chain = this.getHierarchyChain(projectId, agentId)
				const top = chain[chain.length - 1]
				if (top && top.id !== agentId) {
					return { target: top, waitForBoss: false }
				}
				return { target: boss, waitForBoss: false }

			default:
				return { target: boss, waitForBoss: !bossAvailable }
		}
	}

	/** Get tasks assigned to a specific agent (not pool) */
	getAssignedTasks(projectId: string, agentId: string): Task[] {
		const project = this.get(projectId)
		if (!project?.tasks) return []
		return project.tasks.filter((t) => t.assignedTo === agentId)
	}

	/** Get tasks visible to an agent (own + subordinates) */
	getVisibleTasks(projectId: string, agentId: string): Task[] {
		const project = this.get(projectId)
		if (!project?.tasks) return []
		
		const subordinateIds = new Set(this.getAllSubordinates(projectId, agentId).map((s) => s.id))
		subordinateIds.add(agentId)
		
		return project.tasks.filter(
			(t) =>
				t.createdBy === agentId ||
				t.assignedTo === agentId ||
				t.claimedBy === agentId ||
				(t.assignedTo && subordinateIds.has(t.assignedTo)) ||
				(t.claimedBy && subordinateIds.has(t.claimedBy))
		)
	}

	/** Get subtasks of a task */
	getSubtasks(projectId: string, parentTaskId: string): Task[] {
		const project = this.get(projectId)
		if (!project?.tasks) return []
		return project.tasks.filter((t) => t.parentTaskId === parentTaskId)
	}

	/** Get top-level agents (no boss) */
	getTopLevelAgents(projectId: string): ProjectAgentConfig[] {
		const project = this.get(projectId)
		if (!project) return []
		return project.agents.filter((a) => !a.reportsTo && !a.ephemeral)
	}

	/** Get org chart structure */
	getOrgChart(projectId: string): { agent: ProjectAgentConfig; reports: any[] }[] {
		const buildTree = (agentId: string): { agent: ProjectAgentConfig; reports: any[] } | null => {
			const agent = this.getAgent(projectId, agentId)
			if (!agent) return null
			const reports = this.getDirectReports(projectId, agentId)
				.map((r) => buildTree(r.id))
				.filter((r) => r !== null)
			return { agent, reports }
		}
		
		return this.getTopLevelAgents(projectId)
			.map((a) => buildTree(a.id))
			.filter((t) => t !== null) as { agent: ProjectAgentConfig; reports: any[] }[]
	}
	// kilocode_change end

	// kilocode_change start - agent memory methods
	/** Update an agent's memory summary */
	updateAgentMemory(projectId: string, agentId: string, memorySummary: string): void {
		const project = this.get(projectId)
		if (!project) return
		const agent = project.agents.find((a) => a.id === agentId)
		if (agent) {
			agent.memorySummary = memorySummary
			this.save()
		}
	}

	/** Reset (clear) an agent's memory */
	resetAgentMemory(projectId: string, agentId: string): void {
		const project = this.get(projectId)
		if (!project) return
		const agent = project.agents.find((a) => a.id === agentId)
		if (agent) {
			agent.memorySummary = undefined
			this.save()
		}
	}
	// kilocode_change end
}
