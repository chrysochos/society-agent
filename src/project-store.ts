// Society Agent - new file
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
import { sanitizeFilename } from "./security-utils"
import {
	type ManagedTask,
	type TaskStatus,
	type BlockingReason,
	createTask as createManagedTask,
	transitionTask,
	delegateTask,
	acceptTask,
	blockTask,
	unblockTask,
	submitForReview,
	approveTask,
	verifyTask,
	failTask,
	cancelTask,
	generatePrefix,
	generatePlanContent,
	appendToTaskLog,
	canTransition,
	getValidTransitions,
	isTerminalState,
	canStartTask,
} from "./task-manager"
import {
	type OwnershipRegistry,
	type FileOwnership,
	type OwnershipHandoff,
	createOwnershipRegistry,
	canModifyFile,
	registerFileOwnership,
	requestHandoff,
	approveHandoff,
	denyHandoff,
	completeHandoff,
	parseFilesMd,
	writeFilesMd,
	getFilesOwnedBy,
	getPendingHandoffs,
} from "./file-ownership"
import {
	type VerificationResult,
	runVerification,
	runQuickVerification,
	canMarkVerified,
	logVerification,
} from "./verification-runner"
import {
	type PlanningLog,
	type Decision,
	type DecisionCategory,
	initPlanningLog,
	loadPlanningLog,
	savePlanningLog,
	createDecision,
	proposeDecision,
	acceptDecision,
	markDecisionImplemented,
	supersedeDecision,
	rejectDecision,
	deferDecision,
	getDecisionsForTask,
	getActiveDecisions,
	getPendingDecisions as getPendingPlanningDecisions,
} from "./planning-log"
import {
	type SupervisorOverride,
	type TaskPriority,
	supervisorForceUnblock,
	supervisorForceReassign,
	supervisorForceStatus,
	supervisorForceCancel,
	supervisorChangePriority,
} from "./task-manager"

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
	/** Custom instructions appended to the system prompt (user-editable restrictions/guidance) */
	customInstructions?: string
	/** Home folder within the project (relative to project root, e.g. "/" or "frontend/") */
	homeFolder: string
	/** LLM provider override (defaults to server default) */
	provider?: string
	/** LLM model override (defaults to server default) */
	model?: string
	/** When last active */
	lastActiveAt?: string
	// Society Agent start - port configuration
	/** Port this agent's server should use (if applicable) */
	port?: number
	/** Type of server this agent runs (frontend, backend, api, etc) */
	serverType?: "frontend" | "backend" | "api" | "database" | "none"
	// Society Agent end
	// Society Agent start - ephemeral agents
	/** If true, agent is temporary and will be deleted after completing its task */
	ephemeral?: boolean
	/** ID of the agent that created this ephemeral agent */
	createdBy?: string
	// Society Agent end
	// Society Agent start - hierarchy
	/** Boss's agent ID (null/undefined = top-level, no boss) */
	reportsTo?: string
	/** Domain/scope this agent owns (e.g. "backend", "frontend/components") */
	scope?: string
	// Society Agent end
	// Society Agent start - inherited folders from retired agents
	/** Additional folders this agent has access to (inherited from retired agents) */
	inheritedFolders?: Array<{
		path: string
		fromAgent: string
		fromAgentName: string
		inheritedAt: string
		reason: string
	}>
	// Society Agent end
	// Society Agent start - scheduled tasks
	/** Scheduled tasks for this agent (autonomous periodic work) */
	scheduledTasks?: ScheduledTask[]
	// Society Agent end
	// Society Agent start - agent memory
	/** Agent's memory summary from past conversations */
	memorySummary?: string
	// Society Agent end
	// Society Agent start - agent permissions
	/** Agent's permissions - controls what operations are allowed */
	permissions?: {
		/** Custodian mode - can only write .md/.txt files and run read-only commands (default: true for persistent agents) */
		isCustodian?: boolean
		/** Can delete files (default: false) */
		canDeleteFiles?: boolean
		/** Can run shell commands (default: false) */
		canRunCommands?: boolean
		/** Can overwrite existing files (default: true) */
		canOverwriteFiles?: boolean
		/** Can spawn worker agents (default: true for supervisors) */
		canSpawnWorkers?: boolean
		/** Can message other agents (default: true) */
		canMessageAgents?: boolean
		/** Can create new agents (default: false) */
		canCreateAgents?: boolean
	}
	// Society Agent end
	// Society Agent start - granted permissions from supervisors
	/** Permissions granted by supervisors - who can ask this agent to do what */
	grantedPermissions?: Array<{
		/** Agent ID who is allowed to make requests */
		fromAgentId: string
		/** What operations they can request (e.g., "delete_file", "run_command", "*" for all) */
		operations: string[]
		/** Is this a permanent grant or one-time */
		permanent: boolean
		/** When this was granted */
		grantedAt: string
		/** Who granted it (supervisor agent or "human") */
		grantedBy: string
		/** Optional: specific scope/path this applies to */
		scope?: string
	}>
	// Society Agent end
	// Society Agent start - shared workspace mode
	/**
	 * Workspace mode:
	 * - "isolated" (default): Agent has its own folder, only writes there
	 * - "shared": Agent shares folder with supervisor, turn-based write access
	 */
	workspaceMode?: "isolated" | "shared"
	/**
	 * When workspaceMode is "shared", this is the supervisor agent ID
	 * that this agent shares the workspace with
	 */
	sharedWorkspaceWith?: string
	// Society Agent end
}

// Society Agent start - Approval queue for permission requests
/**
 * A pending permission request that needs supervisor/human approval
 */
export interface ApprovalRequest {
	/** Unique request ID */
	id: string
	/** Project ID */
	projectId: string
	/** Agent who needs to perform the action */
	targetAgentId: string
	/** Agent who made the original request (external agent) */
	requestingAgentId: string
	/** Agent who needs to approve (supervisor of target, or "human" for top-level) */
	approverAgentId: string | "human"
	/** The operation being requested (e.g., "delete_file", "run_command") */
	operation: string
	/** Details about the operation */
	operationDetails: {
		/** Original message/task that triggered this */
		originalRequest: string
		/** Specific parameters (e.g., file path to delete) */
		parameters?: Record<string, any>
	}
	/** Request status */
	status: "pending" | "approved" | "denied" | "escalated"
	/** When this was created */
	createdAt: string
	/** When this was resolved (if resolved) */
	resolvedAt?: string
	/** Human-readable summary of the request */
	summary: string
}
// Society Agent end

// Society Agent start - Task pool system
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
	// Society Agent start - hierarchy
	/** Specific agent this task is assigned to (null = open pool) */
	assignedTo?: string
	/** Parent task ID (for task breakdown/decomposition) */
	parentTaskId?: string
	/** Urgency level for escalation rules */
	urgency?: "normal" | "urgent" | "critical"
	// Society Agent end
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
	/** Task IDs that must be completed before this task can be claimed */
	dependencies?: string[]
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
// Society Agent end

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
	/** LLM provider override for all agents in this project (defaults to server default) */
	provider?: string
	/** LLM model override for all agents in this project (defaults to server default) */
	model?: string
	/** Agents assigned to this project */
	agents: ProjectAgentConfig[]
	// Society Agent start - Task pool
	/** Task pool for this project (legacy - kept for compatibility) */
	tasks: Task[]
	/** Maximum concurrent ephemeral workers (default: 3) */
	maxConcurrentWorkers: number
	// Society Agent end
	// Society Agent start - Enhanced task management (Proposal 1, 2)
	/** Managed tasks with stable IDs and state machine */
	managedTasks?: ManagedTask[]
	/** Task sequence counter for ID generation */
	taskSequence?: number
	/** Project task ID prefix (e.g., "ARCH", "BE", "FE") */
	taskPrefix?: string
	// Society Agent end
	// Society Agent start - File ownership (Proposal 4)
	/** File ownership registry */
	ownershipRegistry?: OwnershipRegistry
	// Society Agent end
	// Society Agent start - Planning log (Proposal 3)
	/** Planning log for architectural decisions */
	planningLog?: PlanningLog
	// Society Agent end
	// Society Agent start - Supervisor overrides (Proposal 5)
	/** History of supervisor overrides */
	supervisorOverrides?: SupervisorOverride[]
	// Society Agent end
	// Society Agent start - Git integration
	/** Git repository configuration (for projects loaded from GitLab/GitHub) */
	gitConfig?: {
		/** Repository URL (SSH or HTTPS) */
		url: string
		/** Default branch/ref to use */
		defaultRef: string
		/** Currently checked out ref */
		currentRef?: string
		/** ID of credential to use for authentication */
		credentialId?: string
		/** When last synced from remote */
		lastSyncedAt?: string
		/** Clone status */
		cloneStatus?: "pending" | "cloning" | "ready" | "error"
		/** Error message if clone failed */
		cloneError?: string
	}
	// Society Agent end
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
			// Society Agent start - Task pool
			tasks: [],
			maxConcurrentWorkers: 3,
			// Society Agent end
			status: "active",
			createdAt: now,
			updatedAt: now,
			agents: [
				{
					id: "architect",
					name: "Architect",
					role: "Lead Architect",
					capabilities: ["planning", "code-analysis", "architecture", "task-delegation"],
					// Society Agent start - Updated system prompt to use AGENTS.md
					systemPrompt: `You are Architect, a senior software architect and team supervisor.

## 🚨 WORK MODE: CHECK YOUR TEAM FIRST
**FIRST: Check your AGENTS.md and use list_team to see who's available**

### If you have SPECIALIST AGENTS (frontend, backend, testing, etc.):
- **DELEGATE to the appropriate specialist** - They have domain expertise
- Use delegate_task with clear requirements
- Monitor their progress and coordinate

### If you have NO specialists (just you):
- **DO THE WORK YOURSELF** - You are a capable developer
- OR spawn ephemeral workers for parallel tasks
- Write code, run commands, create files directly

**Key rule: Don't delegate frontend work to a backend specialist. Match tasks to the right agent.**

## 🚨 CRITICAL: TALK TO THE USER - DON'T WRITE STATUS FILES
- **COMMUNICATE IN CHAT** - Explain what's happening conversationally, like talking to a colleague
- **DON'T write progress-report.md or status files** - Progress goes IN YOUR MESSAGE, not files
- **BE CONVERSATIONAL** - "I'm setting up 3 workers because..." not bullet points
- **EXPLAIN IN PLAIN LANGUAGE** - If something fails, explain WHY to the user directly

### ✅ When to Write Files
- Code files (.ts, .js, .html, etc.) - YES
- Configuration files - YES  
- KNOWLEDGE.md for persistent project notes - YES
- Architecture docs workers need - YES
- **Status/progress report files - NO, tell the user directly in chat**

## 🚨 CRITICAL COMMUNICATION RULES - FOLLOW THESE ALWAYS!
1. **ALWAYS REPORT ERRORS IMMEDIATELY** - The moment something fails, tell the user
2. **SHOW THE ACTUAL ERROR MESSAGE** - Copy/paste the exact error text, don't summarize
3. **SUGGEST SOLUTIONS** - Every error message must include "Here's what I can try:" with options
4. **ASK BEFORE MAJOR ACTIONS** - Don't proceed with big changes without user approval
5. **NO SILENT FAILURES** - If workers fail, STOP and report immediately with get_worker_logs()
6. **ALWAYS END WITH STATUS** - Every response MUST end with what you did and what happens next

## 📢 MANDATORY END-OF-RESPONSE FORMAT
You MUST end EVERY response with a status block like this:
\`\`\`
---
**Status:** ✅ Done | ⏳ In Progress | ❌ Failed | ⏸️ Waiting for you
**What I did:** [Brief summary]
**Next:** [What happens next OR what I need from you]
\`\`\`
NEVER stop without this status block. NEVER go silent. ALWAYS tell the user what's happening.

Example error report format:
\`\`\`
❌ **ERROR:** [exact error message here]

**What happened:** Brief explanation

**Solutions I can try:**
1. [Option A]
2. [Option B]
3. [Option C]

Which would you like me to try?
\`\`\`

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

## 🎯 CRITICAL: Task Description Must Include Coordination Rules!
Every task description MUST tell workers:
1. **"If you encounter errors, STOP and fail the task with a clear error message"**
2. **"If you're unsure or need clarification, fail the task with your question"**
3. **"Do NOT guess or make assumptions - ask if unclear"**

Example task description:
\`\`\`
Create the user authentication API.

Requirements:
- POST /api/auth/login
- POST /api/auth/register  
- Use JWT tokens

Coordination:
- If you're unsure about the database schema, STOP and ask
- If bcrypt installation fails, fail the task with the error
- Do NOT make assumptions about existing code - read files first
\`\`\`

## Using Task Dependencies
Use the \`dependencies\` parameter to ensure correct order:
\`\`\`
// First task - no dependencies
create_task({title: "Setup Types", description: "..."})
// Returns task-123

// Second task - depends on first
create_task({title: "Build Backend", dependencies: ["task-123"]})
\`\`\`

## Monitoring Workers
- Use get_worker_status() to check worker health
- Use get_worker_logs(worker_id) to see what workers are doing
- **IF ANY WORKER FAILS:** Stop immediately, get logs, show error to user, suggest fixes

Use markdown formatting. Be decisive and action-oriented.`,
					// Society Agent end
					ephemeral: false, // Society Agent - Supervisor is persistent
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
					ephemeral: false, // Society Agent - Persistent worker agent
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
	public projectsBaseDir: string // Society Agent - made public for file path calculations

	constructor(workspacePath: string) {
		// Defensive check
		if (!workspacePath) {
			console.error(`[ProjectStore] workspacePath is undefined, falling back to /workspaces/society-agent`)
			workspacePath = "/workspaces/society-agent"
		}
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
			// Society Agent start - Initialize AGENTS.md for existing agents
			this.initializeAgentKnowledgeFiles()
			// Society Agent end
		} catch (error) {
			log.error("Error loading project store:", error)
			this.state.projects = createDefaultProjects()
			this.save()
		}
	}

	// Society Agent start - Initialize AGENTS.md for all existing agents
	private initializeAgentKnowledgeFiles(): void {
		for (const project of this.state.projects) {
			for (const agent of project.agents) {
				this.createAgentKnowledgeFile(project.id, agent)
			}
		}
	}
	// Society Agent end

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
						// Society Agent - Use ephemeral as primary flag
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
		// Sanitize folder name to prevent path traversal (CodeQL js/path-injection)
		const rawFolder = input.folder || input.id
		const folder = sanitizeFilename(rawFolder)

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
			// Society Agent start - Task pool
			tasks: [],
			maxConcurrentWorkers: 3,
			// Society Agent end
			agents: (input.agents || []).map((a) => ({
				...a,
				lastActiveAt: now,
			})),
		}

		this.state.projects.push(project)
		this.save()
		
		// Society Agent start - Create AGENTS.md for each agent in new project
		for (const agent of project.agents) {
			this.createAgentKnowledgeFile(project.id, agent)
		}
		// Society Agent end
		
		log.info(`Created project: ${project.name} (${project.id})`)
		return project
	}

	update(id: string, updates: Partial<Pick<Project, "name" | "description" | "folder" | "knowledge" | "status" | "gitConfig" | "provider" | "model">>): Project | undefined {
		const project = this.get(id)
		if (!project) return undefined

		if (updates.name !== undefined) project.name = updates.name
		if (updates.description !== undefined) project.description = updates.description
		if (updates.folder !== undefined) project.folder = updates.folder
		if (updates.knowledge !== undefined) project.knowledge = updates.knowledge
		if (updates.status !== undefined) project.status = updates.status
		if (updates.gitConfig !== undefined) project.gitConfig = updates.gitConfig
		if (updates.provider !== undefined) project.provider = updates.provider || undefined
		if (updates.model !== undefined) project.model = updates.model || undefined
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
	findAgentProject(agentId: string, projectId?: string): { project: Project; agent: ProjectAgentConfig } | undefined {
		for (const project of this.state.projects) {
			if (projectId && project.id !== projectId) continue
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

		// Agent IDs are unique per project, not globally
		// Different projects can have agents with the same ID (e.g., "coder" in project A and "coder" in project B)

		const agent: ProjectAgentConfig = {
			...input,
			lastActiveAt: new Date().toISOString(),
		}

		project.agents.push(agent)
		project.updatedAt = new Date().toISOString()
		this.save()
		
		// Society Agent start - Create AGENTS.md file for new agent
		this.createAgentKnowledgeFile(projectId, agent)
		// Society Agent end
		
		log.info(`Added agent ${agent.name} to project ${project.name}`)
		return agent
	}

	// Society Agent start - Create initial AGENTS.md knowledge file for an agent
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

## 🎯 Skills Index

**Anthropic-compatible skills. Folders with SKILL.md + optional context files.**

| Skill | Folder | Trigger | Description |
|-------|--------|---------|-------------|
| (none yet) | - | - | - |

**Skill Format (Anthropic standard):**
\`\`\`
skills/
  skill-name/
    SKILL.md      # YAML frontmatter + instructions
    context.md    # Optional supplementary context
    script.sh     # Optional executable
\`\`\`

**Skills vs Playbooks:**
- **Skills** = Formal procedures in \`skills/\` folder, triggered with /skill-name
- **Playbooks** = Informal notes in KNOWLEDGE.md, project-specific context

When user says "create a skill for X" → create \`skills/x/SKILL.md\`
When learning organically → add to KNOWLEDGE.md as playbook

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

		const today = new Date().toISOString().split("T")[0]

		const planTemplate = `# PLAN.md — Task Checklist

> **Agent**: ${agent.name} (${agent.id})  
> **Role**: ${agent.role}  

## ⚠️ Work Protocol

Before every task, follow these steps IN ORDER:
1. Find the first unchecked \`[ ]\` item below
2. Read all relevant files before writing anything — check FILES.md for existing files
3. Implement in small, verifiable steps
4. Run \`npx tsc --noEmit\` — fix all errors
5. Run \`git add -A && git commit -m "feat: <description>"\`
6. Mark the item \`[x]\` with the commit hash: \`[x] Task name *(commit: abc1234)*\`
7. Report completion, then ask whether to continue

## ✅ Definition of Done

A task is NOT done until ALL four are true:
- Feature works as designed (manually verified)
- TypeScript/lint passes with zero errors
- Git commit exists with descriptive message
- Checkbox below is checked **with commit hash**

---

## 📋 Tasks

- [ ] (No tasks yet — will be assigned by supervisor or user)
`

		const filesTemplate = `# FILES.md — File Ownership Registry

> **Check this file BEFORE creating any new file.**  
> If a file already exists here, EXTEND it — never create a duplicate.  
> After creating a file, register it here immediately.

## ⚠️ Rules
- One file per purpose — never two files solving the same problem
- Before creating: \`find . -name "pattern"\` to verify it doesn't exist
- If replacing an old solution, delete the old file in the same commit

## Registered Files

| Path | Purpose | Created |
|------|---------|----------|
| \`AGENTS.md\` | Agent knowledge index | ${today} |
| \`PLAN.md\` | Task checklist with commit tracking | ${today} |
| \`FILES.md\` | This file registry | ${today} |
| \`ERRORS.md\` | Error log and solutions | ${today} |
`

		const errorsTemplate = `# ERRORS.md — Error Log

> Before debugging an error, check here first — it may already be solved.  
> After fixing a new error, document it here for future reference.

## Format

\`\`\`
### Error: <short description>
- **Symptom**: what happened
- **Root Cause**: why it happened
- **Solution**: exact commands/changes that fixed it
- **Commit**: <hash>
\`\`\`

---

*(No errors logged yet)*
`

		try {
			fs.writeFileSync(agentsFilePath, template, "utf-8")
			log.info(`Created AGENTS.md for ${agent.name} at ${agentsFilePath}`)

			const planPath = path.join(agentDir, "PLAN.md")
			if (!fs.existsSync(planPath)) {
				fs.writeFileSync(planPath, planTemplate, "utf-8")
				log.info(`Created PLAN.md for ${agent.name}`)
			}

			const filesPath = path.join(agentDir, "FILES.md")
			if (!fs.existsSync(filesPath)) {
				fs.writeFileSync(filesPath, filesTemplate, "utf-8")
				log.info(`Created FILES.md for ${agent.name}`)
			}

			const errorsPath = path.join(agentDir, "ERRORS.md")
			if (!fs.existsSync(errorsPath)) {
				fs.writeFileSync(errorsPath, errorsTemplate, "utf-8")
				log.info(`Created ERRORS.md for ${agent.name}`)
			}
		} catch (err) {
			log.warn(`Failed to create knowledge files for ${agent.name}: ${err}`)
		}
	}
	// Society Agent end

	/** Update an agent within a project */
	updateAgent(
		projectId: string,
		agentId: string,
		// Society Agent - added port, serverType, reportsTo, scope, scheduledTasks, ephemeral, inheritedFolders, provider, workspaceMode, sharedWorkspaceWith, customInstructions; removed canSpawnWorkers, capabilities, knowledgeSummary
		updates: Partial<Pick<ProjectAgentConfig, "name" | "role" | "systemPrompt" | "customInstructions" | "ephemeral" | "homeFolder" | "provider" | "model" | "port" | "serverType" | "reportsTo" | "scope" | "scheduledTasks" | "inheritedFolders" | "workspaceMode" | "sharedWorkspaceWith">>,
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

		// Society Agent start - Sync AGENTS.md header when name or role changes
		if (updates.name !== undefined || updates.role !== undefined) {
			try {
				const agentDir = this.agentHomeDir(projectId, agentId)
				const agentsFilePath = path.join(agentDir, "AGENTS.md")
				if (fs.existsSync(agentsFilePath)) {
					let content = fs.readFileSync(agentsFilePath, "utf-8")
					// Update the H1 title line
					content = content.replace(/^# .+$/m, `# ${agent.name} - Knowledge Index`)
					// Update the Role metadata line
					content = content.replace(/^> \*\*Role\*\*: .+$/m, `> **Role**: ${agent.role}`)
					fs.writeFileSync(agentsFilePath, content, "utf-8")
					log.info(`Updated AGENTS.md header for ${agent.name}`)
				}
			} catch (err) {
				log.warn(`Failed to update AGENTS.md for agent ${agentId}: ${err}`)
			}
		}
		// Society Agent end

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

	/** Get the resolved home directory for an agent within a project
	 * Sanitizes inputs to prevent path traversal (CodeQL js/path-injection)
	 */
	agentHomeDir(projectId: string, agentId: string): string {
		// Defensive checks
		if (!projectId) {
			console.error(`[agentHomeDir] projectId is ${projectId}`)
			projectId = "unknown"
		}
		if (!agentId) {
			console.error(`[agentHomeDir] agentId is ${agentId}`)
			agentId = "unknown"
		}
		
		const project = this.get(projectId)
		const agent = project?.agents.find((a) => a.id === agentId)
		const projectFolder = sanitizeFilename(project?.folder || projectId)
		const home = agent?.homeFolder || "/"

		if (home === "/" || home === "") {
			return path.join(this.projectsBaseDir, projectFolder)
		}
		// Sanitize homeFolder to prevent path traversal
		const safeHome = sanitizeFilename(home)
		return path.join(this.projectsBaseDir, projectFolder, safeHome)
	}

	// Society Agent start - Task pool methods
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
		priority: number = 5,
		dependencies?: string[]
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
			dependencies: dependencies && dependencies.length > 0 ? dependencies : undefined,
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

	/** Claim the next available task (highest priority first, respecting dependencies) */
	claimNextTask(projectId: string, agentId: string): Task | undefined {
		const project = this.get(projectId)
		if (!project?.tasks) return undefined

		// Get all completed task IDs for dependency checking
		const completedTaskIds = new Set(
			project.tasks.filter((t) => t.status === "completed").map((t) => t.id)
		)

		// Find highest priority available task with satisfied dependencies
		const availableTasks = project.tasks
			.filter((t) => {
				if (t.status !== "available") return false
				// Check if all dependencies are completed
				if (t.dependencies && t.dependencies.length > 0) {
					return t.dependencies.every((depId) => completedTaskIds.has(depId))
				}
				return true
			})
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

	/** Get available tasks count (excludes tasks blocked by dependencies) */
	getAvailableTaskCount(projectId: string): number {
		const project = this.get(projectId)
		if (!project?.tasks) return 0
		
		// Get completed task IDs for dependency checking
		const completedTaskIds = new Set(
			project.tasks.filter((t) => t.status === "completed").map((t) => t.id)
		)
		
		return project.tasks.filter((t) => {
			if (t.status !== "available") return false
			// Check if all dependencies are completed
			if (t.dependencies && t.dependencies.length > 0) {
				return t.dependencies.every((depId) => completedTaskIds.has(depId))
			}
			return true
		}).length
	}

	/** Reset stale tasks - tasks claimed by agents that no longer exist, or claimed too long ago
	 * @param projectId - Project ID
	 * @param maxAgeMs - Max age in ms before a task is considered stale
	 * @param spawnedBy - Only reset tasks claimed by workers spawned by this agent (also resets orphaned tasks)
	 */
	resetStaleTasks(projectId: string, maxAgeMs: number = 5 * 60 * 1000, spawnedBy?: string): number {
		const project = this.get(projectId)
		if (!project?.tasks) return 0

		const now = Date.now()
		let resetCount = 0

		// Get worker IDs spawned by the specified agent (if filtering)
		const myWorkerIds = spawnedBy
			? new Set(project.agents.filter((a) => a.ephemeral && a.reportsTo === spawnedBy).map((a) => a.id))
			: null

		for (const task of project.tasks) {
			if (!["claimed", "in-progress"].includes(task.status)) continue
			if (!task.claimedBy) continue

			// Check if the claiming agent still exists
			const claimingAgent = project.agents.find((a) => a.id === task.claimedBy)
			const isOrphan = !claimingAgent

			// If filtering by spawnedBy: include if our worker OR if orphaned
			if (myWorkerIds && !myWorkerIds.has(task.claimedBy) && !isOrphan) continue

			// Check if the task has been claimed for too long
			const claimedAt = task.claimedAt ? new Date(task.claimedAt).getTime() : 0
			const isStale = claimedAt && (now - claimedAt) > maxAgeMs

			if (isOrphan || isStale) {
				task.status = "available"
				task.claimedBy = undefined
				task.claimedAt = undefined
				task.error = isOrphan ? "Orphaned - claiming agent removed" : "Stale - exceeded time limit"
				resetCount++
				log.info(`Reset stale task "${task.title}" (orphan: ${isOrphan}, stale: ${isStale})`)
			}
		}

		if (resetCount > 0) {
			project.updatedAt = new Date().toISOString()
			this.save()
		}

		return resetCount
	}

	/** Remove ephemeral workers from a project
	 * @param projectId - Project ID
	 * @param spawnedBy - Only remove workers spawned by this agent (if undefined, removes all)
	 * @param includeOrphans - Also remove workers with no valid reportsTo (default: true when spawnedBy is provided)
	 */
	removeEphemeralWorkers(projectId: string, spawnedBy?: string, includeOrphans: boolean = true): number {
		const project = this.get(projectId)
		if (!project) return 0

		// Get set of valid non-ephemeral agent IDs
		const validParentIds = new Set(project.agents.filter((a) => !a.ephemeral).map((a) => a.id))

		const toRemove = project.agents.filter((a) => {
			if (!a.ephemeral) return false
			
			// If filtering by spawnedBy, check if this worker matches
			if (spawnedBy) {
				if (a.reportsTo === spawnedBy) return true
				// Also remove orphaned workers (no reportsTo, or reportsTo doesn't exist)
				if (includeOrphans && (!a.reportsTo || !validParentIds.has(a.reportsTo))) return true
				return false
			}
			
			// No filter - remove all ephemeral
			return true
		})
		const count = toRemove.length

		if (count > 0) {
			const removeIds = new Set(toRemove.map((a) => a.id))
			project.agents = project.agents.filter((a) => !removeIds.has(a.id))
			project.updatedAt = new Date().toISOString()
			this.save()
			log.info(`Removed ${count} ephemeral workers from project ${project.name}${spawnedBy ? ` (spawned by ${spawnedBy})` : ''}`)
		}
		return count
	}

	/** @deprecated Use removeEphemeralWorkers instead */
	removeAllEphemeralWorkers(projectId: string): number {
		return this.removeEphemeralWorkers(projectId)
	}
	// Society Agent end

	// Society Agent start - hierarchy methods
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
	// Society Agent end

	// Society Agent start - agent memory methods
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
	// Society Agent end

	// Society Agent start - Approval queue methods
	private _approvalQueue: ApprovalRequest[] = []
	private approvalQueuePath: string = ""

	/** Public getter for approval queue (read-only access) */
	get approvalQueue(): ApprovalRequest[] | undefined {
		this.initApprovalQueue()
		return this._approvalQueue
	}

	/** Initialize approval queue storage */
	private initApprovalQueue(): void {
		if (!this.approvalQueuePath) {
			this.approvalQueuePath = path.join(this.projectsBaseDir, ".society", "approvals.json")
		}
		if (fs.existsSync(this.approvalQueuePath)) {
			try {
				this._approvalQueue = JSON.parse(fs.readFileSync(this.approvalQueuePath, "utf-8"))
			} catch (e) {
				this._approvalQueue = []
			}
		}
	}

	/** Save approval queue */
	private saveApprovalQueue(): void {
		this.initApprovalQueue()
		fs.writeFileSync(this.approvalQueuePath, JSON.stringify(this._approvalQueue, null, 2))
	}

	/** Check if the requesting agent is in the supervisor chain of the target agent */
	isInSupervisorChain(projectId: string, targetAgentId: string, requestingAgentId: string): boolean {
		const project = this.get(projectId)
		if (!project) return false
		
		// Walk up from target agent checking if requestingAgent is in the chain
		let currentId: string | undefined = targetAgentId
		const visited = new Set<string>()
		
		while (currentId && !visited.has(currentId)) {
			visited.add(currentId)
			const agent = project.agents.find(a => a.id === currentId)
			if (!agent) break
			
			// Check if current agent's supervisor is the requesting agent
			if (agent.reportsTo === requestingAgentId) {
				return true // Requesting agent is in the supervisor chain
			}
			currentId = agent.reportsTo
		}
		return false
	}

	/** Check if a permission grant exists for this operation */
	hasPermissionGrant(projectId: string, targetAgentId: string, requestingAgentId: string, operation: string): { permanent: boolean } | false {
		const project = this.get(projectId)
		if (!project) return false
		
		const agent = project.agents.find(a => a.id === targetAgentId)
		if (!agent || !agent.grantedPermissions) return false
		
		const grant = agent.grantedPermissions.find(g => 
			g.fromAgentId === requestingAgentId &&
			(g.operations.includes(operation) || g.operations.includes("*"))
		)
		return grant ? { permanent: grant.permanent } : false
	}

	/** Check if agent has ANY grant for this operation type (regardless of who requested it) */
	hasAnyPermissionGrant(projectId: string, agentId: string, operation: string): boolean {
		const project = this.get(projectId)
		if (!project) return false
		
		const agent = project.agents.find(a => a.id === agentId)
		if (!agent || !agent.grantedPermissions) return false
		
		return agent.grantedPermissions.some(grant => 
			grant.operations.includes(operation) || grant.operations.includes("*")
		)
	}

	/** Get the first permission grant for an operation (returns full grant info including who requested it) */
	getPermissionGrant(projectId: string, agentId: string, operation: string): { fromAgentId: string; permanent: boolean } | null {
		const project = this.get(projectId)
		if (!project) return null
		
		const agent = project.agents.find(a => a.id === agentId)
		if (!agent || !agent.grantedPermissions) return null
		
		const grant = agent.grantedPermissions.find(g => 
			g.operations.includes(operation) || g.operations.includes("*")
		)
		return grant ? { fromAgentId: grant.fromAgentId, permanent: grant.permanent } : null
	}

	/** Remove a specific permission grant (for one-time grants) */
	removePermissionGrant(projectId: string, agentId: string, fromAgentId: string, operation: string): boolean {
		const project = this.get(projectId)
		if (!project) return false
		
		const agent = project.agents.find(a => a.id === agentId)
		if (!agent || !agent.grantedPermissions) return false
		
		const idx = agent.grantedPermissions.findIndex(g => 
			g.fromAgentId === fromAgentId && g.operations.includes(operation)
		)
		if (idx === -1) return false
		
		agent.grantedPermissions.splice(idx, 1)
		this.save()
		return true
	}

	/** Create an approval request */
	createApprovalRequest(request: Omit<ApprovalRequest, "id" | "createdAt" | "status">): ApprovalRequest {
		this.initApprovalQueue()
		const newRequest: ApprovalRequest = {
			...request,
			id: `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			status: "pending",
			createdAt: new Date().toISOString(),
		}
		this._approvalQueue.push(newRequest)
		this.saveApprovalQueue()
		return newRequest
	}

	/** Get pending approvals for a specific approver (agent or "human") */
	getPendingApprovals(approverAgentId: string | "human", projectId?: string): ApprovalRequest[] {
		this.initApprovalQueue()
		return this._approvalQueue.filter(r => 
			r.status === "pending" &&
			r.approverAgentId === approverAgentId &&
			(!projectId || r.projectId === projectId)
		)
	}

	/** Get all pending approvals for a project (for human review) */
	getAllPendingApprovals(projectId: string): ApprovalRequest[] {
		this.initApprovalQueue()
		return this._approvalQueue.filter(r => 
			r.status === "pending" && r.projectId === projectId
		)
	}

	/** Resolve an approval request */
	resolveApproval(
		requestId: string, 
		resolution: "approved" | "denied", 
		permanent: boolean = false,
		resolvedBy: string
	): ApprovalRequest | null {
		this.initApprovalQueue()
		const request = this._approvalQueue.find(r => r.id === requestId)
		if (!request) return null
		
		request.status = resolution
		request.resolvedAt = new Date().toISOString()
		this.saveApprovalQueue()
		
		// If approved, add a permission grant to the target agent
		// Even non-permanent approvals need a grant so the agent can perform the action
		if (resolution === "approved") {
			const project = this.get(request.projectId)
			if (project) {
				const agent = project.agents.find(a => a.id === request.targetAgentId)
				if (agent) {
					if (!agent.grantedPermissions) agent.grantedPermissions = []
					agent.grantedPermissions.push({
						fromAgentId: request.requestingAgentId,
						operations: [request.operation],
						permanent: permanent,
						grantedAt: new Date().toISOString(),
						grantedBy: resolvedBy,
					})
					this.save()
				}
			}
		}
		
		return request
	}

	/** Get supervisor chain for an agent (returns array from direct supervisor up to top) */
	getSupervisorChain(projectId: string, agentId: string): ProjectAgentConfig[] {
		const project = this.get(projectId)
		if (!project) return []
		
		const chain: ProjectAgentConfig[] = []
		const agent = project.agents.find(a => a.id === agentId)
		if (!agent) return []
		
		let currentId = agent.reportsTo
		const visited = new Set<string>()
		
		while (currentId && !visited.has(currentId)) {
			visited.add(currentId)
			const supervisor = project.agents.find(a => a.id === currentId)
			if (!supervisor) break
			chain.push(supervisor)
			currentId = supervisor.reportsTo
		}
		
		return chain
	}
	// Society Agent end

	// ========================================================================
	// Society Agent - Enhanced Task Management (Proposals 1, 2)
	// Stable Task IDs (T-PREFIX-NNN) and 9-state state machine
	// ========================================================================

	/** Initialize task management for a project */
	private initTaskManagement(project: Project): void {
		if (!project.managedTasks) {
			project.managedTasks = []
		}
		if (!project.taskSequence) {
			project.taskSequence = 0
		}
		if (!project.taskPrefix) {
			project.taskPrefix = generatePrefix(project.name)
		}
	}

	/** Get next task sequence number and increment */
	private getNextTaskSequence(project: Project): number {
		this.initTaskManagement(project)
		project.taskSequence = (project.taskSequence ?? 0) + 1
		return project.taskSequence
	}

	/** Create a managed task with stable ID */
	createManagedTask(
		projectId: string,
		data: {
			title: string
			description: string
			createdBy: string
			priority?: 1 | 2 | 3 | 4 | 5
			parentTaskId?: string
			dependsOn?: string[]
			context?: ManagedTask["context"]
			/** Override the default prefix for this task (e.g., for agent-specific tasks) */
			prefixOverride?: string
		}
	): ManagedTask | undefined {
		const project = this.get(projectId)
		if (!project) return undefined

		this.initTaskManagement(project)
		const sequence = this.getNextTaskSequence(project)
		const prefix = data.prefixOverride ?? project.taskPrefix ?? generatePrefix(project.name)

		const task = createManagedTask(prefix, sequence, {
			title: data.title,
			description: data.description,
			createdBy: data.createdBy,
			priority: data.priority,
			parentTaskId: data.parentTaskId,
			dependsOn: data.dependsOn,
			context: data.context,
		})

		project.managedTasks!.push(task)
		project.updatedAt = new Date().toISOString()
		this.save()

		log.info(`[TaskManager] Created ${task.taskId}: "${task.title}" by ${data.createdBy}`)
		return task
	}

	/** Get all managed tasks for a project */
	getManagedTasks(projectId: string): ManagedTask[] {
		const project = this.get(projectId)
		return project?.managedTasks ?? []
	}

	/** Get a specific managed task */
	getManagedTask(projectId: string, taskId: string): ManagedTask | undefined {
		const project = this.get(projectId)
		return project?.managedTasks?.find((t) => t.taskId === taskId)
	}

	/** Update a managed task (internal helper) */
	private updateManagedTask(projectId: string, task: ManagedTask): boolean {
		const project = this.get(projectId)
		if (!project?.managedTasks) return false

		const idx = project.managedTasks.findIndex((t) => t.taskId === task.taskId)
		if (idx === -1) return false

		project.managedTasks[idx] = task
		project.updatedAt = new Date().toISOString()
		this.save()
		return true
	}

	/** Transition a task to a new status */
	transitionManagedTask(
		projectId: string,
		taskId: string,
		newStatus: TaskStatus,
		agentId: string,
		options?: { reason?: string; metadata?: ManagedTask["statusHistory"][0]["metadata"] }
	): ManagedTask | undefined {
		const task = this.getManagedTask(projectId, taskId)
		if (!task) return undefined

		try {
			const updated = transitionTask(task, newStatus, agentId, options)
			this.updateManagedTask(projectId, updated)
			log.info(`[TaskManager] ${taskId}: ${task.status} → ${newStatus} by ${agentId}`)
			return updated
		} catch (error) {
			log.error(`[TaskManager] Transition failed: ${error}`)
			return undefined
		}
	}

	/** Delegate a task to an agent */
	delegateManagedTask(
		projectId: string,
		taskId: string,
		toAgentId: string,
		byAgentId: string
	): ManagedTask | undefined {
		const task = this.getManagedTask(projectId, taskId)
		if (!task) return undefined

		try {
			const updated = delegateTask(task, toAgentId, byAgentId)
			this.updateManagedTask(projectId, updated)
			log.info(`[TaskManager] ${taskId} delegated to ${toAgentId}`)
			return updated
		} catch (error) {
			log.error(`[TaskManager] Delegation failed: ${error}`)
			return undefined
		}
	}

	/** Accept a delegated task and start working */
	acceptManagedTask(projectId: string, taskId: string, agentId: string): ManagedTask | undefined {
		const task = this.getManagedTask(projectId, taskId)
		if (!task) return undefined

		try {
			const updated = acceptTask(task, agentId)
			this.updateManagedTask(projectId, updated)
			log.info(`[TaskManager] ${taskId} accepted by ${agentId}`)
			return updated
		} catch (error) {
			log.error(`[TaskManager] Accept failed: ${error}`)
			return undefined
		}
	}

	/** Block a task with a reason */
	blockManagedTask(
		projectId: string,
		taskId: string,
		agentId: string,
		blockingReason: BlockingReason
	): ManagedTask | undefined {
		const task = this.getManagedTask(projectId, taskId)
		if (!task) return undefined

		try {
			const updated = blockTask(task, agentId, blockingReason)
			this.updateManagedTask(projectId, updated)
			log.info(`[TaskManager] ${taskId} blocked: ${blockingReason.description}`)
			return updated
		} catch (error) {
			log.error(`[TaskManager] Block failed: ${error}`)
			return undefined
		}
	}

	/** Unblock a task and continue working */
	unblockManagedTask(
		projectId: string,
		taskId: string,
		agentId: string,
		resolution: string
	): ManagedTask | undefined {
		const task = this.getManagedTask(projectId, taskId)
		if (!task) return undefined

		try {
			const updated = unblockTask(task, agentId, resolution)
			this.updateManagedTask(projectId, updated)
			log.info(`[TaskManager] ${taskId} unblocked: ${resolution}`)
			return updated
		} catch (error) {
			log.error(`[TaskManager] Unblock failed: ${error}`)
			return undefined
		}
	}

	/** Submit task for review */
	submitManagedTaskForReview(
		projectId: string,
		taskId: string,
		agentId: string,
		result: ManagedTask["result"]
	): ManagedTask | undefined {
		const task = this.getManagedTask(projectId, taskId)
		if (!task) return undefined

		try {
			const updated = submitForReview(task, agentId, result)
			this.updateManagedTask(projectId, updated)
			log.info(`[TaskManager] ${taskId} submitted for review`)
			return updated
		} catch (error) {
			log.error(`[TaskManager] Submit for review failed: ${error}`)
			return undefined
		}
	}

	/** Approve a task (after review) */
	approveManagedTask(projectId: string, taskId: string, reviewerAgentId: string): ManagedTask | undefined {
		const task = this.getManagedTask(projectId, taskId)
		if (!task) return undefined

		try {
			const updated = approveTask(task, reviewerAgentId)
			this.updateManagedTask(projectId, updated)
			log.info(`[TaskManager] ${taskId} approved by ${reviewerAgentId}`)
			return updated
		} catch (error) {
			log.error(`[TaskManager] Approve failed: ${error}`)
			return undefined
		}
	}

	/** Verify a task with verification result */
	async verifyManagedTask(
		projectId: string,
		taskId: string,
		agentId: string,
		verification: VerificationResult
	): Promise<ManagedTask | undefined> {
		const task = this.getManagedTask(projectId, taskId)
		if (!task) return undefined

		const canVerify = canMarkVerified(task.status, verification)
		if (!canVerify.allowed) {
			log.warn(`[TaskManager] Cannot verify ${taskId}: ${canVerify.reason}`)
			return undefined
		}

		try {
			const updated = verifyTask(task, agentId, verification)
			this.updateManagedTask(projectId, updated)

			// Log to TASK_LOG.md
			const projectDir = this.projectDir(projectId)
			await appendToTaskLog(projectDir, updated)
			await logVerification(projectDir, verification)

			log.info(`[TaskManager] ${taskId} verified`)
			return updated
		} catch (error) {
			log.error(`[TaskManager] Verify failed: ${error}`)
			return undefined
		}
	}

	/** Run verification for a task */
	async runTaskVerification(
		projectId: string,
		taskId: string,
		options?: { quickMode?: boolean }
	): Promise<VerificationResult | undefined> {
		const task = this.getManagedTask(projectId, taskId)
		if (!task) return undefined

		const projectDir = this.projectDir(projectId)
		return options?.quickMode
			? runQuickVerification(task, projectDir)
			: runVerification(task, projectDir)
	}

	/** Fail a task */
	failManagedTask(
		projectId: string,
		taskId: string,
		agentId: string,
		error: ManagedTask["error"]
	): ManagedTask | undefined {
		const task = this.getManagedTask(projectId, taskId)
		if (!task) return undefined

		try {
			const updated = failTask(task, agentId, error)
			this.updateManagedTask(projectId, updated)
			log.info(`[TaskManager] ${taskId} failed: ${error?.message}`)
			return updated
		} catch (err) {
			log.error(`[TaskManager] Fail task error: ${err}`)
			return undefined
		}
	}

	/** Cancel a task */
	cancelManagedTask(projectId: string, taskId: string, agentId: string, reason: string): ManagedTask | undefined {
		const task = this.getManagedTask(projectId, taskId)
		if (!task) return undefined

		try {
			const updated = cancelTask(task, agentId, reason)
			this.updateManagedTask(projectId, updated)
			log.info(`[TaskManager] ${taskId} cancelled: ${reason}`)
			return updated
		} catch (error) {
			log.error(`[TaskManager] Cancel failed: ${error}`)
			return undefined
		}
	}

	/** Get tasks that can be started (dependencies satisfied) */
	getStartableTasks(projectId: string): ManagedTask[] {
		const tasks = this.getManagedTasks(projectId)
		return tasks.filter((task) => {
			if (task.status !== "planned" && task.status !== "delegated") return false
			const { canStart } = canStartTask(task, tasks)
			return canStart
		})
	}

	/** Get blocked tasks with their blocking reasons */
	getBlockedTasks(projectId: string): Array<{ task: ManagedTask; reason: BlockingReason | undefined }> {
		const tasks = this.getManagedTasks(projectId)
		return tasks
			.filter((t) => t.status === "blocked")
			.map((task) => ({ task, reason: task.blockingReason }))
	}

	/** Update PLAN.md from managed tasks */
	async updateProjectPlan(projectId: string): Promise<void> {
		const project = this.get(projectId)
		if (!project) return

		const tasks = this.getManagedTasks(projectId)
		const content = generatePlanContent(tasks, project.name)
		const projectDir = this.projectDir(projectId)
		const planPath = path.join(projectDir, "PLAN.md")

		fs.writeFileSync(planPath, content, "utf-8")
		log.debug(`[TaskManager] Updated PLAN.md for ${projectId}`)
	}

	// ========================================================================
	// Society Agent - File Ownership (Proposal 4)
	// ========================================================================

	/** Initialize ownership registry for a project */
	private async initOwnershipRegistry(project: Project): Promise<OwnershipRegistry> {
		if (!project.ownershipRegistry) {
			// Try to load from FILES.md
			const projectDir = this.projectDir(project.id)
			project.ownershipRegistry = await parseFilesMd(projectDir)
		}
		return project.ownershipRegistry
	}

	/** Get the ownership registry for a project */
	async getOwnershipRegistry(projectId: string): Promise<OwnershipRegistry | undefined> {
		const project = this.get(projectId)
		if (!project) return undefined
		return this.initOwnershipRegistry(project)
	}

	/** Check if an agent can modify a file */
	async checkFileAccess(
		projectId: string,
		agentId: string,
		filePath: string
	): Promise<{ allowed: boolean; reason?: string; owner?: string }> {
		const registry = await this.getOwnershipRegistry(projectId)
		if (!registry) return { allowed: false, reason: "Project not found" }

		return canModifyFile(agentId, filePath, registry)
	}

	/** Register file ownership */
	async registerFile(
		projectId: string,
		filePath: string,
		owner: string,
		options?: { description?: string; taskId?: string }
	): Promise<FileOwnership | undefined> {
		const project = this.get(projectId)
		if (!project) return undefined

		const registry = await this.initOwnershipRegistry(project)
		const ownership = registerFileOwnership(registry, filePath, owner, options)

		// Save to FILES.md
		const projectDir = this.projectDir(projectId)
		await writeFilesMd(projectDir, registry, project.name)

		this.save()
		return ownership
	}

	/** Register multiple files for an owner */
	async registerFiles(
		projectId: string,
		filePaths: string[],
		owner: string,
		taskId?: string
	): Promise<FileOwnership[]> {
		const project = this.get(projectId)
		if (!project) return []

		const registry = await this.initOwnershipRegistry(project)
		const ownerships: FileOwnership[] = []

		for (const filePath of filePaths) {
			const ownership = registerFileOwnership(registry, filePath, owner, { taskId })
			ownerships.push(ownership)
		}

		// Save to FILES.md
		const projectDir = this.projectDir(projectId)
		await writeFilesMd(projectDir, registry, project.name)

		this.save()
		return ownerships
	}

	/** Request a file handoff (transfer ownership) */
	async requestFileHandoff(
		projectId: string,
		filePath: string,
		toAgentId: string,
		reason: string,
		taskId?: string
	): Promise<OwnershipHandoff | undefined> {
		const project = this.get(projectId)
		if (!project) return undefined

		const registry = await this.initOwnershipRegistry(project)
		
		// Find current owner
		const ownership = registry.files.find((f) => f.path === filePath)
		if (!ownership) {
			log.warn(`[FileOwnership] Cannot request handoff - file not registered: ${filePath}`)
			return undefined
		}

		const handoff = requestHandoff(registry, filePath, ownership.owner, toAgentId, reason, taskId)

		// Save to FILES.md
		const projectDir = this.projectDir(projectId)
		await writeFilesMd(projectDir, registry, project.name)

		this.save()
		return handoff
	}

	/** Approve a file handoff */
	async approveFileHandoff(
		projectId: string,
		handoffId: string,
		approverId: string
	): Promise<OwnershipHandoff | undefined> {
		const project = this.get(projectId)
		if (!project) return undefined

		const registry = await this.initOwnershipRegistry(project)
		
		try {
			const handoff = approveHandoff(registry, handoffId, approverId)
			
			// Save to FILES.md
			const projectDir = this.projectDir(projectId)
			await writeFilesMd(projectDir, registry, project.name)

			this.save()
			return handoff
		} catch (error) {
			log.error(`[FileOwnership] Approve handoff failed: ${error}`)
			return undefined
		}
	}

	/** Deny a file handoff */
	async denyFileHandoff(
		projectId: string,
		handoffId: string,
		approverId: string,
		reason: string
	): Promise<OwnershipHandoff | undefined> {
		const project = this.get(projectId)
		if (!project) return undefined

		const registry = await this.initOwnershipRegistry(project)
		
		try {
			const handoff = denyHandoff(registry, handoffId, approverId, reason)
			
			// Save to FILES.md
			const projectDir = this.projectDir(projectId)
			await writeFilesMd(projectDir, registry, project.name)

			this.save()
			return handoff
		} catch (error) {
			log.error(`[FileOwnership] Deny handoff failed: ${error}`)
			return undefined
		}
	}

	/** Complete a file handoff (transfer ownership) */
	async completeFileHandoff(projectId: string, handoffId: string): Promise<FileOwnership | undefined> {
		const project = this.get(projectId)
		if (!project) return undefined

		const registry = await this.initOwnershipRegistry(project)
		
		try {
			const ownership = completeHandoff(registry, handoffId)
			
			// Save to FILES.md
			const projectDir = this.projectDir(projectId)
			await writeFilesMd(projectDir, registry, project.name)

			this.save()
			return ownership
		} catch (error) {
			log.error(`[FileOwnership] Complete handoff failed: ${error}`)
			return undefined
		}
	}

	/** Get files owned by an agent */
	async getAgentFiles(projectId: string, agentId: string): Promise<FileOwnership[]> {
		const registry = await this.getOwnershipRegistry(projectId)
		if (!registry) return []
		return getFilesOwnedBy(registry, agentId)
	}

	/** Get pending handoffs for an agent to approve */
	async getAgentPendingHandoffs(projectId: string, agentId: string): Promise<OwnershipHandoff[]> {
		const registry = await this.getOwnershipRegistry(projectId)
		if (!registry) return []
		return getPendingHandoffs(registry, agentId)
	}

	/** Update FILES.md from current registry */
	async updateFilesRegistry(projectId: string): Promise<void> {
		const project = this.get(projectId)
		if (!project) return

		const registry = await this.initOwnershipRegistry(project)
		const projectDir = this.projectDir(projectId)
		await writeFilesMd(projectDir, registry, project.name)
	}

	// ========================================================================
	// PLANNING LOG METHODS (Proposal 3)
	// ========================================================================

	/** Initialize or load planning log */
	private async initPlanningLog(project: Project): Promise<PlanningLog> {
		if (project.planningLog) {
			return project.planningLog
		}

		const projectDir = this.projectDir(project.id)
		const planningLog = await loadPlanningLog(projectDir)
		project.planningLog = planningLog
		return planningLog
	}

	/** Create a new decision */
	async createDecision(
		projectId: string,
		params: Parameters<typeof createDecision>[1],
	): Promise<Decision | null> {
		const project = this.get(projectId)
		if (!project) return null

		const planningLog = await this.initPlanningLog(project)
		const decision = createDecision(planningLog, params)
		this.save()

		// Save to PLANNING.md
		const projectDir = this.projectDir(projectId)
		await savePlanningLog(projectDir, planningLog)

		return decision
	}

	/** Propose a decision for review */
	async proposeDecision(
		projectId: string,
		params: Parameters<typeof proposeDecision>[1],
	): Promise<Decision | null> {
		const project = this.get(projectId)
		if (!project) return null

		const planningLog = await this.initPlanningLog(project)
		const decision = proposeDecision(planningLog, params)
		this.save()

		const projectDir = this.projectDir(projectId)
		await savePlanningLog(projectDir, planningLog)

		return decision
	}

	/** Accept a proposed decision */
	async acceptPlanningDecision(
		projectId: string,
		decisionId: string,
		params: Parameters<typeof acceptDecision>[2],
	): Promise<Decision | null> {
		const project = this.get(projectId)
		if (!project) return null

		const planningLog = await this.initPlanningLog(project)
		const decision = acceptDecision(planningLog, decisionId, params)
		if (decision) {
			this.save()
			const projectDir = this.projectDir(projectId)
			await savePlanningLog(projectDir, planningLog)
		}
		return decision
	}

	/** Mark a decision as implemented */
	async markDecisionImplemented(
		projectId: string,
		decisionId: string,
		implementedBy: string,
	): Promise<Decision | null> {
		const project = this.get(projectId)
		if (!project) return null

		const planningLog = await this.initPlanningLog(project)
		const decision = markDecisionImplemented(planningLog, decisionId, implementedBy)
		if (decision) {
			this.save()
			const projectDir = this.projectDir(projectId)
			await savePlanningLog(projectDir, planningLog)
		}
		return decision
	}

	/** Supersede an old decision with a new one */
	async supersedeDecision(
		projectId: string,
		oldDecisionId: string,
		newDecisionParams: Parameters<typeof createDecision>[1],
	): Promise<{ oldDecision: Decision; newDecision: Decision } | null> {
		const project = this.get(projectId)
		if (!project) return null

		const planningLog = await this.initPlanningLog(project)
		const result = supersedeDecision(planningLog, oldDecisionId, newDecisionParams)
		if (result) {
			this.save()
			const projectDir = this.projectDir(projectId)
			await savePlanningLog(projectDir, planningLog)
		}
		return result
	}

	/** Reject a proposed decision */
	async rejectDecision(
		projectId: string,
		decisionId: string,
		params: { reason: string; rejectedBy: string },
	): Promise<Decision | null> {
		const project = this.get(projectId)
		if (!project) return null

		const planningLog = await this.initPlanningLog(project)
		const decision = rejectDecision(planningLog, decisionId, params)
		if (decision) {
			this.save()
			const projectDir = this.projectDir(projectId)
			await savePlanningLog(projectDir, planningLog)
		}
		return decision
	}

	/** Defer a decision */
	async deferDecision(
		projectId: string,
		decisionId: string,
		params: { reason: string; deferredBy: string; deferUntil?: string },
	): Promise<Decision | null> {
		const project = this.get(projectId)
		if (!project) return null

		const planningLog = await this.initPlanningLog(project)
		const decision = deferDecision(planningLog, decisionId, params)
		if (decision) {
			this.save()
			const projectDir = this.projectDir(projectId)
			await savePlanningLog(projectDir, planningLog)
		}
		return decision
	}

	/** Get decisions affecting a task */
	async getDecisionsForTask(projectId: string, taskId: string): Promise<Decision[]> {
		const project = this.get(projectId)
		if (!project) return []

		const planningLog = await this.initPlanningLog(project)
		return getDecisionsForTask(planningLog, taskId)
	}

	/** Get all active decisions */
	async getActiveDecisions(projectId: string): Promise<Decision[]> {
		const project = this.get(projectId)
		if (!project) return []

		const planningLog = await this.initPlanningLog(project)
		return getActiveDecisions(planningLog)
	}

	/** Get pending decisions awaiting approval */
	async getPendingDecisions(projectId: string): Promise<Decision[]> {
		const project = this.get(projectId)
		if (!project) return []

		const planningLog = await this.initPlanningLog(project)
		return getPendingPlanningDecisions(planningLog)
	}

	/** Update PLANNING.md from current planning log */
	async updatePlanningLog(projectId: string): Promise<void> {
		const project = this.get(projectId)
		if (!project) return

		const planningLog = await this.initPlanningLog(project)
		const projectDir = this.projectDir(projectId)
		await savePlanningLog(projectDir, planningLog)
	}

	// ========================================================================
	// SUPERVISOR OVERRIDE METHODS (Proposal 5)
	// ========================================================================

	/** Force unblock a task (supervisor override) */
	supervisorForceUnblock(
		projectId: string,
		taskId: string,
		supervisorId: string,
		reason: string,
		resolution: string,
	): { task: ManagedTask; override: SupervisorOverride } | null {
		const project = this.get(projectId)
		if (!project?.managedTasks) return null

		const taskIndex = project.managedTasks.findIndex((t) => t.taskId === taskId)
		if (taskIndex < 0) return null

		try {
			const result = supervisorForceUnblock(
				project.managedTasks[taskIndex],
				supervisorId,
				reason,
				resolution,
			)

			project.managedTasks[taskIndex] = result.task
			project.supervisorOverrides = project.supervisorOverrides || []
			project.supervisorOverrides.push(result.override)
			this.save()

			return result
		} catch {
			return null
		}
	}

	/** Force reassign a task (supervisor override) */
	supervisorForceReassign(
		projectId: string,
		taskId: string,
		supervisorId: string,
		newAgentId: string,
		reason: string,
	): { task: ManagedTask; override: SupervisorOverride } | null {
		const project = this.get(projectId)
		if (!project?.managedTasks) return null

		const taskIndex = project.managedTasks.findIndex((t) => t.taskId === taskId)
		if (taskIndex < 0) return null

		try {
			const result = supervisorForceReassign(
				project.managedTasks[taskIndex],
				supervisorId,
				newAgentId,
				reason,
			)

			project.managedTasks[taskIndex] = result.task
			project.supervisorOverrides = project.supervisorOverrides || []
			project.supervisorOverrides.push(result.override)
			this.save()

			return result
		} catch {
			return null
		}
	}

	/** Force a task to a specific status (supervisor override) */
	supervisorForceStatus(
		projectId: string,
		taskId: string,
		supervisorId: string,
		newStatus: TaskStatus,
		reason: string,
	): { task: ManagedTask; override: SupervisorOverride } | null {
		const project = this.get(projectId)
		if (!project?.managedTasks) return null

		const taskIndex = project.managedTasks.findIndex((t) => t.taskId === taskId)
		if (taskIndex < 0) return null

		try {
			const result = supervisorForceStatus(
				project.managedTasks[taskIndex],
				supervisorId,
				newStatus,
				reason,
			)

			project.managedTasks[taskIndex] = result.task
			project.supervisorOverrides = project.supervisorOverrides || []
			project.supervisorOverrides.push(result.override)
			this.save()

			return result
		} catch {
			return null
		}
	}

	/** Force cancel a task (supervisor override) */
	supervisorForceCancel(
		projectId: string,
		taskId: string,
		supervisorId: string,
		reason: string,
	): { task: ManagedTask; override: SupervisorOverride } | null {
		const project = this.get(projectId)
		if (!project?.managedTasks) return null

		const taskIndex = project.managedTasks.findIndex((t) => t.taskId === taskId)
		if (taskIndex < 0) return null

		try {
			const result = supervisorForceCancel(
				project.managedTasks[taskIndex],
				supervisorId,
				reason,
			)

			project.managedTasks[taskIndex] = result.task
			project.supervisorOverrides = project.supervisorOverrides || []
			project.supervisorOverrides.push(result.override)
			this.save()

			return result
		} catch {
			return null
		}
	}

	/** Change task priority (supervisor override) */
	supervisorChangePriority(
		projectId: string,
		taskId: string,
		supervisorId: string,
		newPriority: TaskPriority,
		reason: string,
	): { task: ManagedTask; override: SupervisorOverride } | null {
		const project = this.get(projectId)
		if (!project?.managedTasks) return null

		const taskIndex = project.managedTasks.findIndex((t) => t.taskId === taskId)
		if (taskIndex < 0) return null

		try {
			const result = supervisorChangePriority(
				project.managedTasks[taskIndex],
				supervisorId,
				newPriority,
				reason,
			)

			project.managedTasks[taskIndex] = result.task
			project.supervisorOverrides = project.supervisorOverrides || []
			project.supervisorOverrides.push(result.override)
			this.save()

			return result
		} catch {
			return null
		}
	}

	/** Get all supervisor overrides for a project */
	getSupervisorOverrides(projectId: string): SupervisorOverride[] {
		const project = this.get(projectId)
		return project?.supervisorOverrides || []
	}

	/** Get supervisor overrides for a specific task */
	getTaskOverrides(projectId: string, taskId: string): SupervisorOverride[] {
		const project = this.get(projectId)
		return (project?.supervisorOverrides || []).filter((o) => o.taskId === taskId)
	}
}
