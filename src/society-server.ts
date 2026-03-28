// Society Agent - new file
/**
 * Society Agent Web Server
 *
 * Express.js server that runs Society Agents and exposes them via HTTP/WebSocket API.
 * Single user, full-featured chat interface with agent monitoring.
 */

// Load environment variables first
import "dotenv/config"

// Society Agent - Mock vscode module for standalone server mode (must be first!)
import "./vscode-mock"

import express from "express"
import * as http from "http"
import { Server as SocketIOServer } from "socket.io"
import path from "path"
import fs from "fs"
import { SocietyManager, SocietyManagerConfig } from "./society-manager"
import { PurposeContext } from "./purpose-analyzer"
import { ResponseStrategy } from "./response-strategy"
import { ConversationAgent } from "./conversation-agent"
import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai" // Society Agent - OpenRouter support
import { ApiHandler, buildApiHandler } from "./api"
import { commandExecutor } from "./command-executor"
import { getLog } from "./logger"
// Society Agent start - dynamic provider configuration
import {
	// Legacy functions (for backward compatibility)
	loadProviderConfig,
	saveProviderConfig,
	createApiHandler,
	getConfiguredProviders,
	ProviderType,
	ProviderConfig,
	// New full provider support
	loadProviderSettings,
	saveProviderSettings,
	buildSocietyApiHandler,
	buildApiHandlerFromSettings,
	createOneShot,
	getAllProviderNames,
	isValidProvider,
	ProviderSettings,
	// Context window management
	getContextWindowSize,
	getSafeContextThreshold,
} from "./provider-config"
// Society Agent end
// Society Agent start - persistent agents
import { PersistentAgentStore } from "./persistent-agent-store"
// Society Agent end
// Society Agent start - project system
import { ProjectStore, ProjectAgentConfig, Project, Task, TaskContext } from "./project-store"
// Society Agent end
// Society Agent start - terminal support
import * as pty from "node-pty"
// Society Agent end
// Society Agent start - standalone settings system
import { settings as standaloneSettings, initializeSettings, getSettingsSummary, PROVIDER_BASE_URLS } from "./settings"
// Society Agent end
// Society Agent start - shared workspace support
import {
	SharedWorkspaceRegistry,
	createSharedWorkspaceRegistry,
	createSharedWorkspace,
	getSharedWorkspace,
	canWriteInSharedWorkspace,
	handoffToSubordinate,
	returnToSupervisor,
	getWorkspaceStatusPrompt,
} from "./file-ownership"
// Society Agent end
// Society Agent start - MCP server integration
import { initMcpManager, getMcpManager } from "./mcp-client"
// Society Agent end
// Society Agent start - git loader for project history
import { initGitLoader, getGitLoader } from "./git-loader"
// Society Agent end
// Society Agent start - port allocation system
import { PortManager, PortAllocation } from "./port-manager"
// Society Agent end
// Society Agent start - diagnostics watcher (tsc / ruff / pyright)
import { DiagnosticsWatcher } from "./diagnostics-watcher"
// Society Agent end
// Society Agent start - per-agent activity logger
import { AgentActivityLogger } from "./agent-activity-logger"
// Society Agent end
// Society Agent start - security utilities
import { safeObjectEntries, sanitizeGitRef, validatePath } from "./security-utils"
// Society Agent end
// Society Agent start - delegation tracking with stable task IDs
import {
	createDelegation,
	addTaskToPlan,
	saveTask,
	DelegationRequest,
} from "./delegation-tracker"
// Society Agent end

const app = express()
const server = http.createServer(app)
const io = new SocketIOServer(server, {
	cors: { origin: "*" },
	// Society Agent start - Increase timeouts for long-running operations
	pingTimeout: 300000,     // 5 minutes
	pingInterval: 30000,     // 30 seconds
	// Society Agent end
})

const PORT = parseInt(process.env.PORT || "4000", 10)
const NODE_ENV = process.env.NODE_ENV || "development"
const log = getLog()

// Society Agent - Protected ports that agents cannot kill
// These ports are protected from being terminated by any agent
// Set via PROTECTED_PORTS env var (comma-separated): "4000,3000,5000"
// Port 4000 (system server) is always protected
const PROTECTED_PORTS: Set<number> = new Set([
	PORT, // System server port (4000 by default)
	...(process.env.PROTECTED_PORTS || "")
		.split(",")
		.map(p => parseInt(p.trim(), 10))
		.filter(p => !isNaN(p) && p > 0)
])
log.info(`[Security] Protected ports: ${[...PROTECTED_PORTS].join(", ")}`)

// Helper to check if a port is protected
function isPortProtected(port: number): boolean {
	return PROTECTED_PORTS.has(port)
}

// Helper to extract port numbers from a command string
function extractPortsFromCommand(cmd: string): number[] {
	const ports: number[] = []
	// Match patterns like: :3000, -p 3000, --port 3000, PORT=3000, port:3000, -ti:3000
	const patterns = [
		/:(\d{2,5})(?!\d)/g,           // :3000
		/-p\s*(\d{2,5})/gi,            // -p 3000
		/--port[=\s]+(\d{2,5})/gi,     // --port 3000 or --port=3000
		/PORT[=:]\s*(\d{2,5})/gi,      // PORT=3000 or PORT:3000
		/\bport\s*[=:]\s*(\d{2,5})/gi, // port=3000 or port:3000
		/-ti:?(\d{2,5})/gi,            // -ti:3000 (lsof)
		/fuser.*?(\d{2,5})\/tcp/gi,    // fuser 3000/tcp
		/kill-port\s+(\d{2,5})/gi,     // kill-port 3000
	]
	for (const pattern of patterns) {
		let match
		while ((match = pattern.exec(cmd)) !== null) {
			const port = parseInt(match[1], 10)
			if (port > 0 && port < 65536) ports.push(port)
		}
	}
	return [...new Set(ports)]
}

// Society Agent - Hierarchical visibility: check if an agent can access a given path
// Rules:
// 1. Agent can read within their homeFolder and subdirectories
// 2. Agent can read within their scope (if defined)
// 3. Agent can read their inheritedFolders
// 4. Supervisors can read subordinate agent folders (recursively)
// 5. Project root ("/") homeFolder grants full access
function canAgentAccessPath(
	agentConfig: ProjectAgentConfig,
	project: ProjectStoreState,
	requestedPath: string
): { allowed: boolean; reason: string } {
	// Normalize paths - remove leading/trailing slashes for consistent comparison
	const normalize = (p: string) => p.replace(/^\/+|\/+$/g, "").toLowerCase()
	const normPath = normalize(requestedPath)
	const normHome = normalize(agentConfig.homeFolder || "/")
	
	// Rule 5: Root homeFolder grants full access (legacy behavior)
	if (normHome === "" || normHome === "/" || agentConfig.homeFolder === "/") {
		return { allowed: true, reason: "agent has root access" }
	}
	
	// Rule 1: Agent can read within their homeFolder
	if (normPath === normHome || normPath.startsWith(normHome + "/")) {
		return { allowed: true, reason: "within agent homeFolder" }
	}
	
	// Rule 2: Agent can read within their scope
	if (agentConfig.scope) {
		const normScope = normalize(agentConfig.scope)
		if (normPath === normScope || normPath.startsWith(normScope + "/")) {
			return { allowed: true, reason: "within agent scope" }
		}
	}
	
	// Rule 3: Agent can read their inheritedFolders
	if (agentConfig.inheritedFolders && agentConfig.inheritedFolders.length > 0) {
		for (const inherited of agentConfig.inheritedFolders) {
			const normInherited = normalize(inherited.path)
			if (normPath === normInherited || normPath.startsWith(normInherited + "/")) {
				return { allowed: true, reason: `inherited folder from ${inherited.fromAgentName}` }
			}
		}
	}
	
	// Rule 4: Supervisors can read subordinate agent folders (recursively)
	const allAgents = project.agents || []
	const getSubordinateFolders = (supervisorId: string, visited: Set<string> = new Set()): string[] => {
		if (visited.has(supervisorId)) return [] // Prevent cycles
		visited.add(supervisorId)
		
		const folders: string[] = []
		for (const agent of allAgents) {
			if (agent.reportsTo === supervisorId) {
				// Add this subordinate's folder
				const subHome = normalize(agent.homeFolder || "/")
				if (subHome && subHome !== "" && subHome !== "/") {
					folders.push(subHome)
				}
				if (agent.scope) {
					folders.push(normalize(agent.scope))
				}
				// Recursively get subordinates of this subordinate
				folders.push(...getSubordinateFolders(agent.id, visited))
			}
		}
		return folders
	}
	
	const subordinateFolders = getSubordinateFolders(agentConfig.id)
	for (const subFolder of subordinateFolders) {
		if (normPath === subFolder || normPath.startsWith(subFolder + "/")) {
			return { allowed: true, reason: "subordinate agent folder" }
		}
	}
	
	// Not allowed - build helpful message
	const allowedPaths: string[] = [agentConfig.homeFolder || "/"]
	if (agentConfig.scope) allowedPaths.push(agentConfig.scope)
	if (agentConfig.inheritedFolders) {
		allowedPaths.push(...agentConfig.inheritedFolders.map(f => f.path))
	}
	allowedPaths.push(...subordinateFolders.map(f => `${f}/ (subordinate)`))
	
	return {
		allowed: false,
		reason: `Access denied. You can only read files within: ${allowedPaths.join(", ")}`
	}
}

// Society Agent - Get the list of folders an agent can access (for filtered root listing)
function getAgentAccessibleFolders(
	agentConfig: ProjectAgentConfig,
	project: ProjectStoreState
): string[] {
	const normalize = (p: string) => p.replace(/^\/+|\/+$/g, "")
	const normHome = normalize(agentConfig.homeFolder || "/")
	
	// Root homeFolder grants full access - return empty to signal "all"
	if (normHome === "" || normHome === "/" || agentConfig.homeFolder === "/") {
		return []
	}
	
	const folders: string[] = []
	
	// Agent's home folder (get top-level component)
	if (normHome) {
		const topLevel = normHome.split("/")[0]
		if (topLevel) folders.push(topLevel)
	}
	
	// Agent's scope (get top-level component)
	if (agentConfig.scope) {
		const normScope = normalize(agentConfig.scope)
		const topLevel = normScope.split("/")[0]
		if (topLevel && !folders.includes(topLevel)) folders.push(topLevel)
	}
	
	// Inherited folders (get top-level component)
	if (agentConfig.inheritedFolders) {
		for (const inherited of agentConfig.inheritedFolders) {
			const topLevel = normalize(inherited.path).split("/")[0]
			if (topLevel && !folders.includes(topLevel)) folders.push(topLevel)
		}
	}
	
	// Subordinate folders (get top-level component)
	const allAgents = project.agents || []
	const getSubordinateFolders = (supervisorId: string, visited: Set<string> = new Set()): string[] => {
		if (visited.has(supervisorId)) return []
		visited.add(supervisorId)
		const results: string[] = []
		for (const agent of allAgents) {
			if (agent.reportsTo === supervisorId) {
				const subHome = normalize(agent.homeFolder || "/")
				if (subHome) {
					const topLevel = subHome.split("/")[0]
					if (topLevel) results.push(topLevel)
				}
				if (agent.scope) {
					const topLevel = normalize(agent.scope).split("/")[0]
					if (topLevel) results.push(topLevel)
				}
				results.push(...getSubordinateFolders(agent.id, visited))
			}
		}
		return results
	}
	
	const subFolders = getSubordinateFolders(agentConfig.id)
	for (const f of subFolders) {
		if (!folders.includes(f)) folders.push(f)
	}
	
	return folders
}

// Society Agent - Reconnect event buffer: survives client disconnections
// Buffers the last 400 events per agent so clients can replay missed events on reconnect.
const RECONNECT_BUFFER_MAX = 400
const agentEventBuffer = new Map<string, { t: number; type: string; data: any }[]>()
const agentStreamAccum = new Map<string, string>() // accumulate streaming text per agent

function bufferEvent(agentId: string, type: string, data: any) {
	const buf = agentEventBuffer.get(agentId) || []
	buf.push({ t: Date.now(), type, data })
	if (buf.length > RECONNECT_BUFFER_MAX) buf.splice(0, buf.length - RECONNECT_BUFFER_MAX)
	agentEventBuffer.set(agentId, buf)
}

// Wrap io.emit to automatically buffer agent-specific events
const _ioEmit = io.emit.bind(io)
;(io as any).emit = (event: string, data: any, ...rest: any[]) => {
	if (data && typeof data === "object" && data.agentId) {
		const id: string = data.agentId
		if (event === "agent-message") {
			if (data.isStreaming) {
				// Accumulate streaming chunks; don't buffer fragments individually
				agentStreamAccum.set(id, (agentStreamAccum.get(id) || "") + (data.message || ""))
			} else if (data.isDone) {
				// Flush accumulated stream as a single buffered message
				const fullText = agentStreamAccum.get(id) || ""
				agentStreamAccum.delete(id)
				if (fullText) bufferEvent(id, "agent-message", { ...data, message: fullText, isStreaming: false, isDone: true, _replayed: true })
			} else if (data.message) {
				// Plain (non-streaming) system notice or injection message
				bufferEvent(id, "agent-message", { ...data, _replayed: true })
			}
		} else if (event === "tool-execution" && (data.status === "completed" || data.status === "error")) {
			bufferEvent(id, "tool-execution", data)
		} else if (event === "agent-activity") {
			bufferEvent(id, "agent-activity", data)
		}
	}
	return _ioEmit(event, data, ...rest)
}

// Society Agent start - centralized workspace path with stable default
function getWorkspacePath(): string {
	return process.env.WORKSPACE_PATH || "/workspace"
}

function getOutputDir(): string {
	return path.join(getWorkspacePath(), "projects")
}
// Society Agent end

// Middleware
app.use(express.json({ limit: "50mb" })) // Society Agent - support file uploads
app.use(express.static(path.join(__dirname, "public")))  // Society Agent - serve standalone frontend

// Global state
let societyManager: SocietyManager | null = null
const connectedClients = new Set<string>()
let userAgent: ConversationAgent | null = null // Single agent for user conversations
const stoppedAgents = new Set<string>() // Society Agent - track agents that should stop

// Society Agent - MCP rate limiting to prevent runaway tool usage
interface McpRateLimitState {
	callCount: number
	lastResetTime: number
	errorCount: number
}
const mcpRateLimits = new Map<string, McpRateLimitState>() // key: agentId:serverName
const MCP_RATE_LIMIT = 10 // max calls per window
const MCP_RATE_WINDOW_MS = 60000 // 1 minute window
const MCP_MAX_CONSECUTIVE_ERRORS = 3

function checkMcpRateLimit(agentId: string, serverName: string): { allowed: boolean; message?: string } {
	const key = `${agentId}:${serverName}`
	const now = Date.now()
	let state = mcpRateLimits.get(key)
	
	if (!state || now - state.lastResetTime > MCP_RATE_WINDOW_MS) {
		state = { callCount: 0, lastResetTime: now, errorCount: 0 }
		mcpRateLimits.set(key, state)
	}
	
	state.callCount++
	
	if (state.callCount > MCP_RATE_LIMIT) {
		return { 
			allowed: false, 
			message: `⚠️ Rate limit exceeded: ${serverName} called ${state.callCount} times in the last minute. Wait before retrying. Consider a different approach.` 
		}
	}
	
	return { allowed: true }
}

function recordMcpError(agentId: string, serverName: string): boolean {
	const key = `${agentId}:${serverName}`
	let state = mcpRateLimits.get(key)
	if (!state) {
		state = { callCount: 0, lastResetTime: Date.now(), errorCount: 0 }
		mcpRateLimits.set(key, state)
	}
	state.errorCount++
	return state.errorCount >= MCP_MAX_CONSECUTIVE_ERRORS
}

function resetMcpErrors(agentId: string, serverName: string): void {
	const key = `${agentId}:${serverName}`
	const state = mcpRateLimits.get(key)
	if (state) state.errorCount = 0
}

// Society Agent start - system pause/resume for external oversight
let systemPaused = false
const PAUSED_STATE_FILE = path.join(getWorkspacePath(), ".system-paused-state.json")

interface PausedState {
	timestamp: number
	reason: string
	activeConversations: Array<{
		agentId: string
		projectId: string
		lastMessage?: string
	}>
}

function saveSystemState(reason: string): PausedState {
	const state: PausedState = {
		timestamp: Date.now(),
		reason,
		activeConversations: []
	}
	
	// Save active agent conversations
	for (const [agentId, agent] of activeAgents.entries()) {
		// Find which project this agent belongs to
		const project = projectStore.getAll().find((p: Project) => p.agents.some((a: ProjectAgentConfig) => a.id === agentId))
		if (project) {
			state.activeConversations.push({
				agentId,
				projectId: project.id,
				lastMessage: (agent as any).conversationHistory?.slice(-1)[0]?.content?.substring(0, 200)
			})
		}
	}
	
	fs.writeFileSync(PAUSED_STATE_FILE, JSON.stringify(state, null, 2))
	return state
}

function loadPausedState(): PausedState | null {
	try {
		if (fs.existsSync(PAUSED_STATE_FILE)) {
			return JSON.parse(fs.readFileSync(PAUSED_STATE_FILE, "utf-8"))
		}
	} catch (e) {
		log.warn("Failed to load paused state:", e)
	}
	return null
}

function clearPausedState(): void {
	try {
		if (fs.existsSync(PAUSED_STATE_FILE)) {
			fs.unlinkSync(PAUSED_STATE_FILE)
		}
	} catch (e) {
		log.warn("Failed to clear paused state:", e)
	}
}
// Society Agent end - system pause/resume

// Society Agent start - persistent agent system
const agentStore = new PersistentAgentStore(getWorkspacePath())
const activeAgents = new Map<string, ConversationAgent>() // agentId → live ConversationAgent
// Society Agent end

// Society Agent start - Base communication rules (prepended to ALL agent system prompts)
const BASE_AGENT_RULES = `
# AGENT RULES

## Response format (mandatory)
Every response must follow this structure:
1. **Headline** — one bold line (≤12 words) stating what you did or found
2. Bullet points — 2-5 bullets with specifics (files changed, errors fixed, commands run)
3. Final line — **Next:** what happens next  OR  **Done:** task is complete

Example:
**Fixed TypeScript errors in auth module**
- Removed unused import in auth/login.ts
- Changed any -> User type in 3 places
- Ran tsc -- 0 errors
**Next:** Running integration tests

## Output (keep it compact)
- Bullets only; no paragraphs; never repeat context already visible to user
- Don't echo tool results — user sees tool cards in UI; just summarize what you learned/did
- Don't create status/progress/report files — communicate directly in chat

## WHY labels (required before tool calls)
Before running a tool, state intent inline: "[→ reason]" on the same line as your reasoning.
Examples:
- I'll read the config file [→ check CORS origins include localhost]
- Running tsc [→ verify no type errors remain after edit]
- Checking processes [→ confirm dev server is still running on port 3000]

## Verification (mandatory)
- Prove servers work with curl before claiming "server running"
- Run tsc/compiler before claiming "no errors"
- Run ls before claiming files were created
- After fixing an error, re-run the check to show fresh output
- Fix errors automatically (run→fail→fix→re-run), don't ask permission

## Files
- Only write to YOUR folder — never touch other agents' folders or the root workspace
- A supervisor NEVER writes to a subagent's folder — only delegates via \`delegate_task\`

## Four Canonical Files (every agent has these)
| File | Purpose | When to update |
|------|---------|----------------|
| \`AGENTS.md\` | Knowledge index, current state, skills | After every session |
| \`PLAN.md\` | Task checklist — \`[ ]\` / \`[x]\` with commit hashes | Before & after every task |
| \`FILES.md\` | Registry of files you own — check before creating any file | Every time you create a file |
| \`ERRORS.md\` | Error log with solutions — check before debugging | When you fix a new error |

## Work Protocol (mandatory for every task)
1. Read \`PLAN.md\` → find the first \`[ ]\` item
2. Read \`FILES.md\` → check what files already exist before creating anything
3. Implement the item
4. Run the compiler (\`npx tsc --noEmit\` or equivalent) → fix all errors
5. \`git add -A && git commit -m "feat: <description>"\`
6. Mark \`[x]\` in PLAN.md with the commit hash: \`[x] Task *(commit: abc1234)*\`
7. Register any new files in \`FILES.md\`
8. Document any new errors (and their fixes) in \`ERRORS.md\`

## Receiving a task from your supervisor
When a supervisor delegates work to you containing a checklist or feature list:
1. Write all items into YOUR \`PLAN.md\` BEFORE doing any work — do not start until this is done
2. Execute them one by one following the Work Protocol above
3. Report back with the commit hash for each completed item:
   > "Done. Commits: feature-name (abc1234), other-feature (def5678)"

Never start implementing before writing the received tasks into your PLAN.md.
If the task is ambiguous, write what you understood into PLAN.md and send it back for confirmation before executing.


- Work until task is fully complete (up to 200 iterations)
- If DESIRED_STATE.md exists, achieve it autonomously
- Use \`report_to_supervisor\` to report: in_progress / completed / blocked / needs_info

## Protected (never touch)
- **Protected ports** — Port 4000 is always protected (Society Agent server). Additional ports may be protected via PROTECTED_PORTS env var.
- Use \`get_processes()\` to see the list of protected ports
- Use \`kill_process({ port: N })\` instead of raw shell commands — it has safety checks
- Never \`pkill tsx\`, \`pkill node\`, \`killall node\` — kills everything including the agent runner
- Use ports 3000, 5173, 6001, 8080 etc. for your own services (unless protected)

## Global Skills (curated knowledge)
Global skills contain curated expertise for specific domains. Check skills before starting unfamiliar work:
- \`list_global_skills()\` — see available skills
- \`read_global_skill("skill-name")\` — load the skill's instructions

**IMPORTANT**: If you're a permanent (custodian) agent and need to implement code changes:
1. Load: \`read_global_skill("workflow-policy")\`
2. Follow the custodian/worker model — you govern, workers implement
3. Spawn workers with \`spawn_worker()\` for **code writing only**

**DO NOT spawn workers for**: running compilers, tests, git commands, reading files, or verification tasks. Do those yourself.

`
function buildFullSystemPrompt(agentSystemPrompt: string): string {
	return BASE_AGENT_RULES + agentSystemPrompt
}

// Society Agent start - Build prompt with project-specific config
import { loadProjectConfig, generateProjectPromptSection, type ProjectConfig, bootstrapExistingProject, writeBootstrapFiles, syncBootstrapFiles, bootstrapSubFolder, smartBootstrap, hasBootstrapFiles } from "./project-config"

// Cache for project configs to avoid repeated disk reads
const projectConfigCache = new Map<string, { config: ProjectConfig; loadedAt: number }>()
const CONFIG_CACHE_TTL = 60000 // 1 minute

async function getProjectConfigCached(projectDir: string): Promise<ProjectConfig> {
	const cached = projectConfigCache.get(projectDir)
	if (cached && Date.now() - cached.loadedAt < CONFIG_CACHE_TTL) {
		return cached.config
	}
	const config = await loadProjectConfig(projectDir)
	projectConfigCache.set(projectDir, { config, loadedAt: Date.now() })
	return config
}

async function buildProjectAwarePrompt(agentSystemPrompt: string, projectDir: string): Promise<string> {
	try {
		const config = await getProjectConfigCached(projectDir)
		const basePrompt = buildFullSystemPrompt(agentSystemPrompt)
		const projectSection = generateProjectPromptSection(config)
		return basePrompt + "\n\n" + projectSection
	} catch (error) {
		log.warn(`[buildProjectAwarePrompt] Failed to load project config: ${error}`)
		return buildFullSystemPrompt(agentSystemPrompt)
	}
}
// Society Agent end - Build prompt with project-specific config

// Society Agent start - Shared workspace registry per project
const projectSharedWorkspaces = new Map<string, SharedWorkspaceRegistry>()

function getProjectSharedWorkspaces(projectId: string): SharedWorkspaceRegistry {
	let registry = projectSharedWorkspaces.get(projectId)
	if (!registry) {
		registry = createSharedWorkspaceRegistry()
		projectSharedWorkspaces.set(projectId, registry)
	}
	return registry
}
// Society Agent end - Shared workspace registry

// Society Agent end - Base communication rules

// Society Agent start - project system
const projectStore = new ProjectStore(getWorkspacePath())
// Society Agent end

function sanitizeTaskToken(input: string): string {
	return input.replace(/[^a-zA-Z0-9_-]/g, "_")
}

function uniqueChangeDocPath(baseDir: string, baseName: string): string {
	const candidate = path.join(baseDir, baseName)
	if (!fs.existsSync(candidate)) return candidate
	const ts = new Date().toISOString().replace(/[:.]/g, "-")
	const ext = path.extname(baseName)
	const stem = baseName.slice(0, Math.max(0, baseName.length - ext.length))
	return path.join(baseDir, `${stem}_${ts}${ext}`)
}

function getChangeDocsDir(supervisorDir: string, kind: "briefs" | "reports"): string {
	return path.join(supervisorDir, "CHANGE_DOCS", kind)
}

function writeChangeBriefDoc(project: Project, supervisorId: string, task: Task): string | undefined {
	try {
		const supervisorDir = projectStore.agentHomeDir(project.id, supervisorId)
		const briefsDir = getChangeDocsDir(supervisorDir, "briefs")
		fs.mkdirSync(briefsDir, { recursive: true })
		const token = sanitizeTaskToken(task.id)
		const briefPath = uniqueChangeDocPath(briefsDir, `CHANGE_BRIEF_${token}.md`)
		const content = `# CHANGE_BRIEF_${token}

## Metadata
- project: ${project.name}
- project_id: ${project.id}
- task_id: ${task.id}
- created_by: ${task.createdBy}
- created_at: ${task.createdAt}
- priority: ${task.priority}

## Title
${task.title}

## Description
${task.description}

## Context
- working_directory: ${task.context.workingDirectory || "."}
- conventions: ${task.context.conventions || "(none specified)"}

## Dependencies
${task.dependencies && task.dependencies.length > 0 ? task.dependencies.map((d) => `- ${d}`).join("\n") : "- none"}

## Expected Outputs
${task.context.outputPaths && Object.keys(task.context.outputPaths).length > 0
			? Object.entries(task.context.outputPaths).map(([filePath, desc]) => `- ${filePath}: ${desc}`).join("\n")
			: "- none specified"}

## Notes
${task.context.notes || "(none)"}
`
		fs.writeFileSync(briefPath, content, "utf-8")
		return briefPath
	} catch (err) {
		log.warn(`[CHANGE_BRIEF] Failed to write brief for task ${task.id}: ${err}`)
		return undefined
	}
}

function writeChangeReportDoc(
	project: Project,
	supervisorId: string,
	task: Task,
	workerId: string,
	result: { filesCreated: string[]; filesModified: string[]; summary: string },
): string | undefined {
	try {
		const supervisorDir = projectStore.agentHomeDir(project.id, supervisorId)
		const reportsDir = getChangeDocsDir(supervisorDir, "reports")
		fs.mkdirSync(reportsDir, { recursive: true })
		const token = sanitizeTaskToken(task.id)
		const reportPath = uniqueChangeDocPath(reportsDir, `CHANGE_REPORT_${token}.md`)
		const content = `# CHANGE_REPORT_${token}

## Metadata
- project: ${project.name}
- project_id: ${project.id}
- task_id: ${task.id}
- worker_id: ${workerId}
- supervisor_id: ${supervisorId}
- completed_at: ${new Date().toISOString()}

## Task Title
${task.title}

## Summary
${result.summary}

## Files Created
${result.filesCreated.length > 0 ? result.filesCreated.map((f) => `- ${f}`).join("\n") : "- none"}

## Files Modified
${result.filesModified.length > 0 ? result.filesModified.map((f) => `- ${f}`).join("\n") : "- none"}
`
		fs.writeFileSync(reportPath, content, "utf-8")
		return reportPath
	} catch (err) {
		log.warn(`[CHANGE_REPORT] Failed to write report for task ${task.id}: ${err}`)
		return undefined
	}
}

// Society Agent start - diagnostics watcher
const diagnosticsWatcher = new DiagnosticsWatcher(getWorkspacePath())
// Society Agent start - per-agent activity logger
const agentActivityLogger = new AgentActivityLogger(path.join(getWorkspacePath(), "projects"))
// Wire real-time Socket.IO so the Activity panel updates live without manual refresh
agentActivityLogger.setEmitter((event) => io.emit("agent-activity", event))
// Society Agent end
diagnosticsWatcher.on("updated", (projectId: string) => {
	const result = diagnosticsWatcher.getDiagnostics(projectId)
	io.emit("diagnostics-update", { projectId, ...result })
})
// Society Agent end

// Society Agent start - activity logging for visibility
interface ActivityEntry {
	id: string
	timestamp: number
	projectId: string
	agentId: string
	agentName: string
	type: "task_received" | "tool_used" | "task_completed" | "error" | "delegation_started" | "delegation_completed"
	summary: string
	details?: Record<string, any>
}

class ActivityLogger {
	private activities: ActivityEntry[] = []
	private maxSize = 500

	log(entry: Omit<ActivityEntry, "id" | "timestamp">) {
		const fullEntry: ActivityEntry = {
			...entry,
			id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
			timestamp: Date.now(),
		}
		this.activities.unshift(fullEntry)
		if (this.activities.length > this.maxSize) {
			this.activities = this.activities.slice(0, this.maxSize)
		}
		// Also emit to connected clients
		io.emit("activity", fullEntry)
		return fullEntry
	}

	getByProject(projectId: string, limit = 50): ActivityEntry[] {
		return this.activities.filter(a => a.projectId === projectId).slice(0, limit)
	}

	getByAgent(agentId: string, limit = 50): ActivityEntry[] {
		return this.activities.filter(a => a.agentId === agentId).slice(0, limit)
	}

	getAll(limit = 100): ActivityEntry[] {
		return this.activities.slice(0, limit)
	}

	clear() {
		this.activities = []
	}
}

const activityLogger = new ActivityLogger()
// Society Agent end

type ChatRequestCacheEntry = {
	status: "in-progress" | "completed"
	startedAt: number
	response?: any
}

const chatRequestCache = new Map<string, ChatRequestCacheEntry>()
const CHAT_REQUEST_CACHE_TTL_MS = 15 * 60 * 1000

type AutoRetryTrackerEntry = {
	active: boolean
	lastRetryAt: number
	consecutiveSameReason: number
	lastReason?: string
}

const autoRetryTracker = new Map<string, AutoRetryTrackerEntry>()
const AUTO_RETRY_COOLDOWN_MS = 20 * 1000

function autoRetryKey(projectId: string, taskId: string): string {
	return `${projectId}:${taskId}`
}

function makeChatRequestKey(agentId: string, projectId: string | undefined, requestId: string): string {
	return `${projectId || "legacy"}:${agentId}:${requestId}`
}

function cleanupChatRequestCache() {
	const now = Date.now()
	for (const [key, entry] of chatRequestCache.entries()) {
		if (now - entry.startedAt > CHAT_REQUEST_CACHE_TTL_MS) {
			chatRequestCache.delete(key)
		}
	}
}

type AutoMode = "report_only" | "implement_from_report" | "recall_only" | "none"

function inferAutoMode(description: string | undefined): AutoMode {
	const text = (description || "").toLowerCase()
	if (!text) return "none"

	const asksReport = /(report|what is implemented|known gaps|limitations|swagger|test\/verification|status summary)/.test(text)
	const asksImplement = /(complete all|fix all|implement|do the works|execute)/.test(text)
	const asksRecall = /(remember the report|do you remember)/.test(text)

	if (asksImplement && /(all you found|from report|findings|gaps)/.test(text)) return "implement_from_report"
	if (asksRecall && !asksImplement) return "recall_only"
	if (asksReport && !asksImplement) return "report_only"
	return "none"
}

function applyAutoMode(description: string | undefined, mode: AutoMode): string {
	const base = description || ""
	if (mode === "report_only") {
		return `[AUTO_MODE: REPORT_ONLY]\n` +
			`Return one consolidated report only. Do not spawn workers, do not create tasks, do not run broad verification sweeps, and stop after report.\n\n` +
			base
	}
	if (mode === "implement_from_report") {
		return `[AUTO_MODE: IMPLEMENT_FROM_REPORT]\n` +
			`Use the latest report/findings as source of truth. Build a prioritized fix list and execute without restarting full discovery. Read only files needed for selected fixes.\n\n` +
			base
	}
	if (mode === "recall_only") {
		return `[AUTO_MODE: RECALL_ONLY]\n` +
			`Answer from existing context and recent report. Do not run tools unless the user explicitly asks to refresh.\n\n` +
			base
	}
	return base
}

function getReportSnapshotPath(project: Project, agentId: string): string {
	const agentDir = projectStore.agentHomeDir(project.id, agentId)
	return path.join(agentDir, "REPORT_SNAPSHOT.md")
}

function loadReportSnapshot(project: Project, agentId: string): string | undefined {
	try {
		const snapshotPath = getReportSnapshotPath(project, agentId)
		if (!fs.existsSync(snapshotPath)) return undefined
		return fs.readFileSync(snapshotPath, "utf-8")
	} catch (err) {
		log.warn(`[ReportSnapshot] Failed to load snapshot for ${agentId}: ${err}`)
		return undefined
	}
}

function saveReportSnapshot(project: Project, agentId: string, report: string): boolean {
	try {
		const snapshotPath = getReportSnapshotPath(project, agentId)
		const now = new Date().toISOString()
		const content = `# REPORT_SNAPSHOT\n\n- agent_id: ${agentId}\n- project_id: ${project.id}\n- updated_at: ${now}\n\n---\n\n${report}\n`
		fs.writeFileSync(snapshotPath, content, "utf-8")
		return true
	} catch (err) {
		log.warn(`[ReportSnapshot] Failed to save snapshot for ${agentId}: ${err}`)
		return false
	}
}

function withSnapshotContext(prompt: string, snapshot: string): string {
	const maxChars = 16000
	const clipped = snapshot.length > maxChars ? snapshot.slice(0, maxChars) + "\n...(snapshot truncated)" : snapshot
	return `[AUTO_CONTEXT: REPORT_SNAPSHOT]\n${clipped}\n[/AUTO_CONTEXT]\n\n${prompt}`
}

// Society Agent start - token usage tracking
interface UsageEntry {
	id: string
	timestamp: number
	projectId: string
	agentId: string
	agentName: string
	model: string
	inputTokens: number
	outputTokens: number
	totalTokens: number
	costUsd: number // estimated cost
}

// Society Agent start - Safe JSON parse for tool arguments (models sometimes return malformed JSON)
function safeParseToolArgs(jsonStr: string | undefined): Record<string, any> {
	if (!jsonStr) return {}
	try {
		return JSON.parse(jsonStr)
	} catch (e: any) {
		log.warn(`Failed to parse tool arguments: ${e.message}`)
		log.warn(`Raw arguments: ${jsonStr?.substring(0, 200)}...`)
		// Try to fix common issues
		try {
			// Sometimes models output trailing content after JSON
			const match = jsonStr.match(/^\s*\{[\s\S]*?\}/)
			if (match) {
				return JSON.parse(match[0])
			}
		} catch {}
		return { _parseError: e.message, _rawArgs: jsonStr }
	}
}

// Society Agent - Strip ANSI escape codes from terminal output
function stripAnsiCodes(text: string): string {
	// Remove all ANSI escape sequences: colors, cursor movement, etc.
	return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
}

// Society Agent - Estimate tokens for a messages array + system prompt
const CONTEXT_HARD_LIMIT = 160000 // trim when estimated tokens exceed this (safe margin below 196608)
const CONTEXT_TOOL_OVERHEAD = 6000 // tool definitions token cost

function estimateMessagesTokens(systemPrompt: string, msgs: any[]): number {
	let chars = systemPrompt.length
	for (const m of msgs) {
		if (typeof m.content === "string") {
			chars += m.content.length
		} else if (Array.isArray(m.content)) {
			for (const part of m.content) {
				if (part.text) chars += part.text.length
				else if (part.content) chars += typeof part.content === "string" ? part.content.length : JSON.stringify(part.content).length
				else chars += JSON.stringify(part).length
			}
		}
	}
	return Math.ceil(chars / 4) + CONTEXT_TOOL_OVERHEAD
}

// Trim old tool results in-place when approaching context limit
// 16.7C: uses soft-trim (head + omission marker + tail) instead of hard replace
function trimMessagesForContext(systemPrompt: string, msgs: any[]): number {
	let estimated = estimateMessagesTokens(systemPrompt, msgs)
	if (estimated <= CONTEXT_HARD_LIMIT) return 0

	let trimCount = 0
	// Work from oldest to newest, skipping first message (original task) and last 4 (recent context)
	for (let i = 1; i < msgs.length - 4 && estimated > CONTEXT_HARD_LIMIT; i++) {
		const msg = msgs[i]
		if (msg.role === "user" && Array.isArray(msg.content)) {
			for (const part of msg.content) {
				if (part.type === "tool_result" && typeof part.content === "string" && part.content.length > 200) {
					const orig = part.content
					const head = orig.substring(0, 300)
					const tail = orig.substring(orig.length - 100)
					const omitted = orig.length - 400
					const saved = Math.ceil((orig.length - 400) / 4)
					part.content = omitted > 50
						? `${head}\n…[+${omitted} chars omitted]…\n${tail}`
						: orig.substring(0, 200)
					estimated -= saved
					trimCount++
				}
			}
		} else if (msg.role === "assistant" && Array.isArray(msg.content)) {
			for (const part of msg.content) {
				if (part.type === "text" && typeof part.text === "string" && part.text.length > 500) {
					const orig = part.text
					const head = orig.substring(0, 200)
					const tail = orig.substring(orig.length - 80)
					const omitted = orig.length - 280
					const saved = Math.ceil((orig.length - 80) / 4)
					part.text = omitted > 50
						? `${head}\n…[+${omitted} chars omitted]…\n${tail}`
						: orig.substring(0, 200)
					estimated -= saved
					trimCount++
				}
			}
		}
	}
	return trimCount
}

// 16.7A: History turn limiting — keep only the last N user turns (+ first message)
const HISTORY_TURN_LIMIT = 40
function limitHistory(msgs: any[], limit: number = HISTORY_TURN_LIMIT): any[] {
	if (msgs.length < 3) return msgs
	const first = msgs[0]
	const rest = msgs.slice(1)
	const userIdxs = rest.map((m, i) => (m.role === "user" ? i : -1)).filter(i => i >= 0)
	if (userIdxs.length <= limit) return msgs
	const keepFrom = userIdxs[userIdxs.length - limit]
	return [first, ...rest.slice(keepFrom)]
}

// Society Agent - Extract clean preview from tool results for UI tool cards
function extractCleanPreview(result: string, maxLines = 2): { preview: string; lineCount: number } {
	// Show more lines for errors so users can read them without expanding
	const isError = result.startsWith("❌") || result.includes("Command failed") || result.includes("Process failed")
	const effectiveMaxLines = isError ? 20 : maxLines

	// Strip markdown formatting to get actual content
	let content = result
	// Remove ANSI escape codes (terminal colors etc.)
	content = stripAnsiCodes(content)
	// Remove markdown headers like "📄 **filename**:"
	content = content.replace(/^[📄📝✅❌🔍🔎📁💻📨💬🎯✏️📖][^\n]*\*\*[^*]+\*\*:?\s*\n?/gm, '')
	// Remove code block markers
	content = content.replace(/^```\w*\n?/gm, '').replace(/\n?```$/gm, '')
	// Trim whitespace
	content = content.trim()
	
	const lines = content.split('\n').filter(l => l.trim() !== '')
	const preview = lines.slice(0, effectiveMaxLines).join('\n') + (lines.length > effectiveMaxLines ? '...' : '')
	
	return { preview, lineCount: lines.length }
}
// Society Agent end

interface UsageSummary {
	totalInputTokens: number
	totalOutputTokens: number
	totalTokens: number
	totalCostUsd: number
	callCount: number
	byAgent: Record<string, { inputTokens: number; outputTokens: number; costUsd: number; callCount: number }>
	byModel: Record<string, { inputTokens: number; outputTokens: number; costUsd: number; callCount: number }>
}

// Pricing per 1M tokens (as of 2026)
// Society Agent - Added OpenRouter model pricing
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
	// Claude models (Anthropic direct)
	"claude-sonnet-4-20250514": { input: 3, output: 15 },
	"claude-3-5-sonnet-20241022": { input: 3, output: 15 },
	"claude-3-opus-20240229": { input: 15, output: 75 },
	"claude-3-haiku-20240307": { input: 0.25, output: 1.25 },
	
	// OpenRouter models (with openrouter/ prefix stripped)
	"minimax/minimax-m2.5": { input: 0.30, output: 1.00 },  // MiniMax M2.5
	"minimax-m2.5": { input: 0.30, output: 1.00 },
	"google/gemini-2.0-flash-001": { input: 0.10, output: 0.40 },
	"google/gemini-pro": { input: 0.125, output: 0.375 },
	"openai/gpt-4o": { input: 2.50, output: 10.00 },
	"openai/gpt-4o-mini": { input: 0.15, output: 0.60 },
	"openai/gpt-4-turbo": { input: 10.00, output: 30.00 },
	"anthropic/claude-3.5-sonnet": { input: 3, output: 15 },
	"anthropic/claude-3-opus": { input: 15, output: 75 },
	"anthropic/claude-3-haiku": { input: 0.25, output: 1.25 },
	"meta-llama/llama-3.1-70b-instruct": { input: 0.52, output: 0.75 },
	"meta-llama/llama-3.1-8b-instruct": { input: 0.055, output: 0.055 },
	"mistralai/mistral-large": { input: 2.00, output: 6.00 },
	"deepseek/deepseek-chat": { input: 0.14, output: 0.28 },
	"qwen/qwen-2.5-72b-instruct": { input: 0.35, output: 0.40 },
	
	// Default fallback (conservative estimate)
	"default": { input: 1, output: 3 },
}

// Society Agent - Helper to find pricing with model name variations
function getModelPricing(model: string): { input: number; output: number } {
	// Try exact match first
	if (MODEL_PRICING[model]) return MODEL_PRICING[model]
	
	// Try without provider prefix (e.g., "openai/gpt-4o" -> "gpt-4o")
	const withoutPrefix = model.includes("/") ? model.split("/").slice(1).join("/") : model
	if (MODEL_PRICING[withoutPrefix]) return MODEL_PRICING[withoutPrefix]
	
	// Try with common provider prefixes
	for (const prefix of ["openai/", "anthropic/", "google/", "meta-llama/", "mistralai/", "minimax/", "deepseek/", "qwen/"]) {
		if (MODEL_PRICING[prefix + model]) return MODEL_PRICING[prefix + model]
	}
	
	// Try partial match (for versioned models)
	const modelLower = model.toLowerCase()
	for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
		if (key !== "default" && (modelLower.includes(key.toLowerCase()) || key.toLowerCase().includes(modelLower))) {
			return pricing
		}
	}
	
	return MODEL_PRICING["default"]
}

class UsageTracker {
	private entries: UsageEntry[] = []
	private maxSize = 1000
	private sessionStart = Date.now()
	// Society Agent - Per-agent session budgets (reset on each new task)
	private agentSessions: Map<string, { tokens: number; cost: number }> = new Map()

	resetAgentSession(agentId: string) {
		this.agentSessions.set(agentId, { tokens: 0, cost: 0 })
	}

	record(entry: Omit<UsageEntry, "id" | "timestamp" | "totalTokens" | "costUsd">) {
		const pricing = getModelPricing(entry.model)
		const costUsd = (entry.inputTokens * pricing.input + entry.outputTokens * pricing.output) / 1_000_000

		const fullEntry: UsageEntry = {
			...entry,
			id: `usage_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
			timestamp: Date.now(),
			totalTokens: entry.inputTokens + entry.outputTokens,
			costUsd,
		}

		this.entries.unshift(fullEntry)
		if (this.entries.length > this.maxSize) {
			this.entries = this.entries.slice(0, this.maxSize)
		}

		// Emit to UI
		io.emit("usage", fullEntry)
		io.emit("usage-summary", this.getSummary())

		// Society Agent - Update per-agent session budget and emit budget-update
		if (!this.agentSessions.has(entry.agentId)) {
			this.agentSessions.set(entry.agentId, { tokens: 0, cost: 0 })
		}
		const session = this.agentSessions.get(entry.agentId)!
		session.tokens += fullEntry.totalTokens
		session.cost += fullEntry.costUsd
		io.emit("budget-update", {
			agentId: entry.agentId,
			agentName: entry.agentName,
			projectId: entry.projectId,
			sessionTokens: session.tokens,
			sessionCostUsd: session.cost,
			callTokens: fullEntry.totalTokens,
			callCostUsd: fullEntry.costUsd,
			model: entry.model,
			timestamp: fullEntry.timestamp,
		})

		return fullEntry
	}

	getRecent(limit = 50): UsageEntry[] {
		return this.entries.slice(0, limit)
	}

	getSummary(): UsageSummary {
		const summary: UsageSummary = {
			totalInputTokens: 0,
			totalOutputTokens: 0,
			totalTokens: 0,
			totalCostUsd: 0,
			callCount: this.entries.length,
			byAgent: {},
			byModel: {},
		}

		for (const e of this.entries) {
			summary.totalInputTokens += e.inputTokens
			summary.totalOutputTokens += e.outputTokens
			summary.totalTokens += e.totalTokens
			summary.totalCostUsd += e.costUsd

			// By agent
			if (!summary.byAgent[e.agentId]) {
				summary.byAgent[e.agentId] = { inputTokens: 0, outputTokens: 0, costUsd: 0, callCount: 0 }
			}
			summary.byAgent[e.agentId].inputTokens += e.inputTokens
			summary.byAgent[e.agentId].outputTokens += e.outputTokens
			summary.byAgent[e.agentId].costUsd += e.costUsd
			summary.byAgent[e.agentId].callCount++

			// By model
			if (!summary.byModel[e.model]) {
				summary.byModel[e.model] = { inputTokens: 0, outputTokens: 0, costUsd: 0, callCount: 0 }
			}
			summary.byModel[e.model].inputTokens += e.inputTokens
			summary.byModel[e.model].outputTokens += e.outputTokens
			summary.byModel[e.model].costUsd += e.costUsd
			summary.byModel[e.model].callCount++
		}

		return summary
	}

	clear() {
		this.entries = []
		this.sessionStart = Date.now()
	}
}

const usageTracker = new UsageTracker()
// Society Agent end

// Society Agent start - Agent inbox system for async messaging
interface InboxMessage {
	id: string
	from: { id: string; name: string }
	to: string
	message: string
	priority: "normal" | "urgent"
	timestamp: number
	read: boolean
}

// In-memory inboxes (keyed by "projectId:agentId")
const agentInboxes = new Map<string, InboxMessage[]>()

function getInboxKey(projectId: string, agentId: string): string {
	return `${projectId}:${agentId}`
}

function sendToInbox(projectId: string, fromAgent: { id: string; name: string }, toAgentId: string, message: string, priority: "normal" | "urgent" = "normal"): void {
	const key = getInboxKey(projectId, toAgentId)
	if (!agentInboxes.has(key)) {
		agentInboxes.set(key, [])
	}
	agentInboxes.get(key)!.push({
		id: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
		from: fromAgent,
		to: toAgentId,
		message,
		priority,
		timestamp: Date.now(),
		read: false,
	})
	log.info(`[Inbox] ${fromAgent.name} → ${toAgentId}: ${message.substring(0, 60)}...`)
	// Society Agent start - activity log: record inbox message
	try {
		const _inboxProj = projectStore.get(projectId)
		const _inboxAgent = _inboxProj?.agents?.find(a => a.id === toAgentId)
		if (_inboxProj && _inboxAgent) {
			agentActivityLogger.logInboxMsg(projectId, toAgentId, _inboxProj.folder, _inboxAgent.homeFolder || "/", fromAgent.name || fromAgent.id, message)
		}
	} catch (_) { /* non-fatal */ }
	// Society Agent end
}

function readInbox(projectId: string, agentId: string, markRead: boolean = true): InboxMessage[] {
	const key = getInboxKey(projectId, agentId)
	const messages = agentInboxes.get(key) || []
	const unread = messages.filter(m => !m.read)
	
	if (markRead && unread.length > 0) {
		unread.forEach(m => m.read = true)
	}
	
	return unread
}

function getInboxUnreadCount(projectId: string, agentId: string): number {
	const key = getInboxKey(projectId, agentId)
	const messages = agentInboxes.get(key) || []
	return messages.filter(m => !m.read).length
}
// Society Agent end

// Society Agent start - track current provider config
let currentProviderConfig: ProviderConfig | null = null
let currentProviderSettings: ProviderSettings | null = null

/**
 * Get API handler using current provider configuration
 * Falls back to loading config if not initialized
 * Now uses buildSocietyApiHandler for full provider support
 */
function getApiHandlerFromConfig(): ApiHandler {
	const workspacePath = process.env.WORKSPACE_PATH || process.cwd()

	// Society Agent start - Check standalone settings first (supports OpenRouter and all providers)
	if (standaloneSettings.isInitialized() && standaloneSettings.hasApiKey()) {
		const providerConfig = standaloneSettings.getProvider()
		// For Anthropic, use the standard handler directly
		if (providerConfig.type === "anthropic") {
			return buildApiHandler({
				apiKey: providerConfig.apiKey,
				model: providerConfig.model,
			})
		}
		// For all other providers (OpenRouter, OpenAI, etc.) build a real handler.
		// Previously a dummy was returned here, but that breaks summarization and any
		// other code that calls handler.createMessage() directly.
		try {
			const workspacePath = process.env.WORKSPACE_PATH || process.cwd()
			return buildSocietyApiHandler(workspacePath)
		} catch {
			// Fall through to legacy methods below
		}
	}
	// Society Agent end

	// Try to use the new full ProviderSettings first
	if (!currentProviderSettings) {
		try {
			currentProviderSettings = loadProviderSettings(workspacePath)
		} catch {
			// Fall back to legacy config
		}
	}

	if (currentProviderSettings) {
		return buildApiHandlerFromSettings(currentProviderSettings)
	}

	// Fallback to legacy provider config
	if (!currentProviderConfig) {
		currentProviderConfig = loadProviderConfig(workspacePath)
	}

	if (!currentProviderConfig) {
		throw new Error("No provider configuration found. Please configure API key.")
	}

	return createApiHandler(currentProviderConfig) as ApiHandler
}

/**
 * Get current provider context window configuration
 * Returns appropriate context window size and threshold based on current provider/model
 */
function getProviderContextConfig(): { contextWindowSize: number; contextThresholdPercent: number } {
	let model: string | undefined
	let provider: ProviderType | undefined
	
	// Check standalone settings first
	if (standaloneSettings.isInitialized()) {
		const providerConfig = standaloneSettings.getProvider()
		model = providerConfig.model
		provider = providerConfig.type as ProviderType
	} else if (currentProviderSettings) {
		provider = currentProviderSettings.apiProvider
		model = currentProviderSettings.apiModelId || 
			currentProviderSettings.openRouterModelId || 
			currentProviderSettings.openAiModelId
	} else if (currentProviderConfig) {
		provider = currentProviderConfig.provider
		model = currentProviderConfig.model
	}
	
	const contextWindowSize = getContextWindowSize(model, provider)
	const contextThresholdPercent = getSafeContextThreshold(contextWindowSize)
	
	log.debug(`Context config for ${provider}/${model}: window=${contextWindowSize}, threshold=${contextThresholdPercent}%`)
	
	return { contextWindowSize, contextThresholdPercent }
}
// Society Agent end

/**
 * Initialize Society Manager with callbacks
 */
async function initializeSocietyManager(apiKey?: string) {
	if (societyManager) return

	try {
		log.info("Initializing Society Manager...")

		const workspacePath = process.env.WORKSPACE_PATH || process.cwd()

		// Society Agent start - use full provider configuration
		// Try new ProviderSettings first, fall back to legacy config
		let apiHandler: ApiHandler

		try {
			const settings = loadProviderSettings(workspacePath)
			currentProviderSettings = settings
			currentProviderConfig = null // Clear legacy config
			log.info(`Using provider: ${settings.apiProvider} (full ProviderSettings)`)
			apiHandler = buildApiHandlerFromSettings(settings)
		} catch (settingsError) {
			// Fall back to legacy config
			let providerConfig: ProviderConfig | null
			try {
				providerConfig = loadProviderConfig(workspacePath)
			} catch (configError) {
				providerConfig = null
			}
			
			if (!providerConfig) {
				// If no config exists and apiKey provided, use Anthropic as default
				if (apiKey) {
					providerConfig = {
						provider: "anthropic",
						apiKey,
						model: process.env.API_MODEL_ID || "claude-sonnet-4-20250514",
					}
				} else {
					throw new Error("No provider configuration found")
				}
			}
			currentProviderConfig = providerConfig
			currentProviderSettings = null
			log.info(`Using provider: ${providerConfig.provider}, model: ${providerConfig.model} (legacy config)`)
			apiHandler = createApiHandler(providerConfig) as ApiHandler
		}
		// Society Agent end

		societyManager = new SocietyManager({
			apiHandler,
			workspacePath,
			onPurposeStarted: (purpose) => {
				log.info("Purpose started:", purpose.id)
				io.emit("purpose-started", {
					id: purpose.id,
					description: purpose.description,
					createdAt: purpose.createdAt,
				})
			},
			onTeamFormed: (purposeId, teamSize) => {
				log.info("Team formed:", teamSize, "agents")
				io.emit("team-formed", {
					purposeId,
					teamSize,
					agents: getTeamAgents(purposeId),
				})
			},
			onProgressUpdate: (purposeId, progress) => {
				io.emit("progress-update", { purposeId, progress })
			},
			onStatusChange: (purposeId, agentId, status, task) => {
				io.emit("agent-status-change", {
					purposeId,
					agentId,
					status,
					task,
				})
			},
			onMessage: (purposeId, agentId, message) => {
				io.emit("agent-message", {
					purposeId,
					agentId,
					message,
					timestamp: Date.now(),
				})
			},
		})

		log.info("Society Manager initialized")
	} catch (error) {
		log.error("Failed to initialize Society Manager:", error)
		throw error
	}
}

/**
 * Get all agents in a team
 */
function getTeamAgents(purposeId: string) {
	if (!societyManager) return []

	const state = societyManager.getState()
	const purpose = state.activePurposes.get(purposeId)

	if (!purpose) return []

	const purposeAny = purpose as any // Society Agent - access team/identity properties
	if (!purposeAny.team) return []

	return purposeAny.team.getAllMembers().map((member: any) => ({
		id: member.identity.id,
		name: member.identity.name || member.identity.id,
		role: member.identity.role,
		status: member.agent.getState().status,
		progress: member.agent.getState().progress || 0,
		actionCount: member.agent.getState().actionCount || 0,
	}))
}

// ============================================================================
// REST API Endpoints
// ============================================================================

/**
 * GET /api/status - Server health check
 */
app.get("/api/status", (req, res) => {
	const workspacePath = process.env.WORKSPACE_PATH || process.cwd()
	// Society Agent start - use standalone settings for provider info
	const providerConfig = standaloneSettings.isInitialized() ? standaloneSettings.getProvider() : null
	res.json({
		status: "ok",
		environment: NODE_ENV,
		societyManagerReady: !!societyManager,
		apiKeyConfigured: providerConfig ? !!providerConfig.apiKey : !!process.env.ANTHROPIC_API_KEY,
		provider: providerConfig ? {
			type: providerConfig.type,
			model: providerConfig.model,
			apiKeyMasked: standaloneSettings.getMaskedApiKey(),
		} : null,
		workspacePath,
		outputDir: path.join(workspacePath, "projects"),
		timestamp: new Date().toISOString(),
		systemPaused, // Society Agent - include pause status
		protectedPorts: [...PROTECTED_PORTS], // Society Agent - ports that agents cannot kill
	})
	// Society Agent end
})

// Society Agent start - Port allocation API for visibility and management
/**
 * GET /api/ports - Get all port allocations across all projects
 */
app.get("/api/ports", (req, res) => {
	const allocations = PortManager.getAllAllocations()
	res.json({
		total: allocations.length,
		protectedSystemPorts: [...PROTECTED_PORTS].filter(p => !allocations.some(a => a.port === p)),
		allocations: allocations.map(a => ({
			port: a.port,
			projectId: a.projectId,
			serviceName: a.serviceName,
			description: a.description,
			allocatedAt: a.allocatedAt,
			allocatedBy: a.allocatedBy,
		})),
	})
})

/**
 * GET /api/projects/:id/ports - Get port allocations for a specific project
 */
app.get("/api/projects/:id/ports", (req, res) => {
	const projectId = req.params.id
	const allocations = PortManager.getProjectPorts(projectId)
	res.json({
		projectId,
		total: allocations.length,
		allocations: allocations.map(a => ({
			port: a.port,
			serviceName: a.serviceName,
			description: a.description,
			allocatedAt: a.allocatedAt,
		})),
	})
})

/**
 * POST /api/projects/:id/ports/:port/release - Manually release a port allocation
 */
app.post("/api/projects/:id/ports/:port/release", (req, res): void => {
	const projectId = req.params.id
	const port = parseInt(req.params.port)
	
	if (isNaN(port)) {
		res.status(400).json({ success: false, error: "Invalid port number" })
		return
	}
	
	const result = PortManager.releasePort(port, projectId)
	
	if (result.success) {
		// Remove from protected ports
		PROTECTED_PORTS.delete(port)
		res.json({ 
			success: true, 
			message: `Port ${port} released and removed from protection`,
			protectedPorts: [...PROTECTED_PORTS]
		})
	} else {
		res.status(403).json({ 
			success: false, 
			error: result.reason 
		})
	}
})

/**
 * POST /api/projects/:id/ports/allocate - Manually allocate a port for a project
 */
app.post("/api/projects/:id/ports/allocate", async (req, res): Promise<void> => {
	const projectId = req.params.id
	const { serviceName, port, description } = req.body || {}
	
	if (!serviceName) {
		res.status(400).json({ success: false, error: "serviceName is required" })
		return
	}
	
	try {
		const result = await PortManager.requestPort(projectId, serviceName, {
			description,
			preferredPort: port ? parseInt(port) : undefined,
			allocatedBy: "manual-ui",
		})
		
		// Add to protected ports
		PROTECTED_PORTS.add(result.port)
		
		res.json({ 
			success: true, 
			port: result.port,
			isNew: result.isNew,
			message: result.isNew 
				? `Allocated port ${result.port} for ${serviceName}`
				: `Service ${serviceName} already has port ${result.port}`,
		})
	} catch (err: any) {
		res.status(400).json({ 
			success: false, 
			error: err.message 
		})
	}
})
// Society Agent end

// Society Agent start - System pause/resume API for external oversight
/**
 * POST /api/system/pause - Pause the system for maintenance
 * External agents (like GitHub Copilot) use this before making code changes.
 * Saves current state and rejects new work until resumed.
 */
app.post("/api/system/pause", (req, res): void => {
	const { reason } = req.body || {}
	
	if (systemPaused) {
		res.json({ 
			success: false, 
			message: "System is already paused",
			pausedState: loadPausedState()
		})
		return
	}
	
	systemPaused = true
	const state = saveSystemState(reason || "External maintenance")
	
	// Notify all connected clients
	io.emit("system-event", { 
		type: "system-paused", 
		reason: reason || "External maintenance",
		timestamp: Date.now() 
	})
	
	log.info(`[System] PAUSED for: ${reason || "External maintenance"}`)
	log.info(`[System] ${state.activeConversations.length} active conversations saved`)
	
	res.json({ 
		success: true, 
		message: "System paused. Safe to make code changes.",
		pausedState: state,
		instructions: [
			"1. Make your code changes",
			"2. Restart the server: pkill -f tsx && npm start",
			"3. Or call POST /api/system/resume to continue without restart"
		]
	})
})

/**
 * POST /api/system/resume - Resume the system after maintenance
 */
app.post("/api/system/resume", (req, res): void => {
	if (!systemPaused) {
		res.json({ 
			success: false, 
			message: "System is not paused" 
		})
		return
	}
	
	const previousState = loadPausedState()
	systemPaused = false
	clearPausedState()
	
	// Notify all connected clients
	io.emit("system-event", { 
		type: "system-resumed", 
		timestamp: Date.now() 
	})
	
	log.info(`[System] RESUMED`)
	
	res.json({ 
		success: true, 
		message: "System resumed. Accepting new work.",
		previousState
	})
})

/**
 * GET /api/system/state - Get current system state (for external oversight)
 */
app.get("/api/system/state", (req, res): void => {
	const pausedState = loadPausedState()
	
	res.json({
		systemPaused,
		pausedState,
		activeAgentCount: activeAgents.size,
		activeAgents: Array.from(activeAgents.keys()),
		projectCount: projectStore.getAll().length,
		timestamp: new Date().toISOString()
	})
})

/**
 * GET /api/skills - Get all global skills
 */
app.get("/api/skills", (req, res): void => {
	const workspacePath = process.env.WORKSPACE_PATH || process.cwd()
	const skillsDir = path.join(workspacePath, "skills")
	
	try {
		if (!fs.existsSync(skillsDir)) {
			res.json({ skills: [], message: "No global skills folder" })
			return
		}
		const items = fs.readdirSync(skillsDir, { withFileTypes: true })
		const skills = items.filter(i => i.isDirectory()).map(s => {
			const skillPath = path.join(skillsDir, s.name, "SKILL.md")
			let description = "(no description)"
			let version = "1.0"
			if (fs.existsSync(skillPath)) {
				const content = fs.readFileSync(skillPath, "utf-8")
				const descMatch = content.match(/description:\s*(.+)/)
				const verMatch = content.match(/version:\s*(.+)/)
				if (descMatch) description = descMatch[1].trim()
				if (verMatch) version = verMatch[1].trim()
			}
			return { name: s.name, description, version, scope: "global" }
		})
		res.json({ skills })
	} catch (err: any) {
		res.status(500).json({ error: err.message })
	}
})

/**
 * GET /api/mcps - Get all global MCPs
 */
app.get("/api/mcps", (req, res): void => {
	const workspacePath = process.env.WORKSPACE_PATH || process.cwd()
	const configPath = path.join(workspacePath, "mcp-config.json")
	
	try {
		if (!fs.existsSync(configPath)) {
			res.json({ mcps: [], message: "No global MCP config" })
			return
		}
		const content = fs.readFileSync(configPath, "utf-8")
		const config = JSON.parse(content)
		// Use safeObjectEntries to prevent prototype pollution (CodeQL js/prototype-polluting-assignment)
		const mcps = safeObjectEntries(config.servers).map(([name, cfg]: [string, any]) => ({
			name,
			description: cfg.description || "(no description)",
			command: cfg.command,
			args: cfg.args || [],
			enabled: cfg.enabled !== false, // default true
			scope: "global"
		}))
		res.json({ mcps })
	} catch (err: any) {
		res.status(500).json({ error: err.message })
	}
})

/**
 * POST /api/mcps/:name/toggle - Toggle enabled state for a global MCP
 */
app.post("/api/mcps/:name/toggle", (req, res): void => {
	const workspacePath = process.env.WORKSPACE_PATH || process.cwd()
	const configPath = path.join(workspacePath, "mcp-config.json")
	const { name } = req.params
	
	try {
		if (!fs.existsSync(configPath)) {
			res.status(404).json({ error: "No MCP config file" })
			return
		}
		const content = fs.readFileSync(configPath, "utf-8")
		const config = JSON.parse(content)
		if (!config.servers || !config.servers[name]) {
			res.status(404).json({ error: `MCP "${name}" not found` })
			return
		}
		// Toggle enabled state
		const current = config.servers[name].enabled !== false
		config.servers[name].enabled = !current
		fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
		res.json({ name, enabled: !current })
	} catch (err: any) {
		res.status(500).json({ error: err.message })
	}
})

/**
 * GET /api/project/:projectId/skills - Get project-specific skills
 */
app.get("/api/project/:projectId/skills", (req, res): void => {
	const project = projectStore.get(req.params.projectId)
	if (!project) {
		res.status(404).json({ error: "Project not found" })
		return
	}
	
	const workspacePath = process.env.WORKSPACE_PATH || process.cwd()
	const projectFolder = project.folder || project.id
	const skillsDir = path.join(workspacePath, "projects", projectFolder, "skills")
	
	try {
		if (!fs.existsSync(skillsDir)) {
			res.json({ skills: [] })
			return
		}
		const items = fs.readdirSync(skillsDir, { withFileTypes: true })
		const skills = items.filter(i => i.isDirectory()).map(s => {
			const skillPath = path.join(skillsDir, s.name, "SKILL.md")
			let description = "(no description)"
			let version = "1.0"
			if (fs.existsSync(skillPath)) {
				const content = fs.readFileSync(skillPath, "utf-8")
				const descMatch = content.match(/description:\s*(.+)/)
				const verMatch = content.match(/version:\s*(.+)/)
				if (descMatch) description = descMatch[1].trim()
				if (verMatch) version = verMatch[1].trim()
			}
			return { name: s.name, description, version, scope: "project" }
		})
		res.json({ skills })
	} catch (err: any) {
		res.status(500).json({ error: err.message })
	}
})

/**
 * GET /api/project/:projectId/mcps - Get project-specific MCPs
 */
app.get("/api/project/:projectId/mcps", (req, res): void => {
	const project = projectStore.get(req.params.projectId)
	if (!project) {
		res.status(404).json({ error: "Project not found" })
		return
	}
	
	const workspacePath = process.env.WORKSPACE_PATH || process.cwd()
	const projectFolder = project.folder || project.id
	const configPath = path.join(workspacePath, "projects", projectFolder, "mcp.json")
	
	try {
		if (!fs.existsSync(configPath)) {
			res.json({ mcps: [] })
			return
		}
		const content = fs.readFileSync(configPath, "utf-8")
		const config = JSON.parse(content)
		// Use safeObjectEntries to prevent prototype pollution (CodeQL js/prototype-polluting-assignment)
		const mcps = safeObjectEntries(config.servers).map(([name, cfg]: [string, any]) => ({
			name,
			description: cfg.description || "(no description)",
			command: cfg.command,
			args: cfg.args || [],
			enabled: cfg.enabled !== false,
			scope: "project"
		}))
		res.json({ mcps })
	} catch (err: any) {
		res.status(500).json({ error: err.message })
	}
})

/**
 * POST /api/project/:projectId/mcps/:name/toggle - Toggle enabled state for project MCP
 */
app.post("/api/project/:projectId/mcps/:name/toggle", (req, res): void => {
	const project = projectStore.get(req.params.projectId)
	if (!project) {
		res.status(404).json({ error: "Project not found" })
		return
	}
	
	const workspacePath = process.env.WORKSPACE_PATH || process.cwd()
	const projectFolder = project.folder || project.id
	const configPath = path.join(workspacePath, "projects", projectFolder, "mcp.json")
	const { name } = req.params
	
	try {
		if (!fs.existsSync(configPath)) {
			res.status(404).json({ error: "No project MCP config" })
			return
		}
		const content = fs.readFileSync(configPath, "utf-8")
		const config = JSON.parse(content)
		if (!config.servers || !config.servers[name]) {
			res.status(404).json({ error: `MCP "${name}" not found` })
			return
		}
		config.servers[name].enabled = !(config.servers[name].enabled !== false)
		fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
		res.json({ name, enabled: config.servers[name].enabled })
	} catch (err: any) {
		res.status(500).json({ error: err.message })
	}
})
// Society Agent end - System pause/resume API

// Society Agent start - activity log API
/**
 * GET /api/activities - Get all recent activities
 */
app.get("/api/activities", (req, res) => {
	const limit = parseInt(req.query.limit as string) || 100
	res.json(activityLogger.getAll(limit))
})

/**
 * GET /api/project/:projectId/activities - Get activities for a project
 */
app.get("/api/project/:projectId/activities", (req, res) => {
	const limit = parseInt(req.query.limit as string) || 50
	res.json(activityLogger.getByProject(req.params.projectId, limit))
})

/**
 * GET /api/agent/:agentId/activities - Get activities for an agent
 */
app.get("/api/agent/:agentId/activities", (req, res) => {
	const limit = parseInt(req.query.limit as string) || 50
	res.json(activityLogger.getByAgent(req.params.agentId, limit))
})
// Society Agent end

// Society Agent start - usage/cost tracking API
/**
 * GET /api/usage - Get usage summary
 */
app.get("/api/usage", (req, res) => {
	res.json(usageTracker.getSummary())
})

/**
 * GET /api/usage/recent - Get recent usage entries
 */
app.get("/api/usage/recent", (req, res) => {
	const limit = parseInt(req.query.limit as string) || 50
	res.json(usageTracker.getRecent(limit))
})

/**
 * DELETE /api/usage - Clear usage data
 */
app.delete("/api/usage", (req, res) => {
	usageTracker.clear()
	res.json({ success: true, message: "Usage data cleared" })
})
// Society Agent end

// Society Agent start - workspace directory browser for project.html
/**
 * GET /api/workspace - List contents of a specific directory path
 * Used by project.html to browse project folders
 */
app.get("/api/workspace", async (req, res): Promise<void> => {
	try {
		const workspacePath = process.env.WORKSPACE_PATH || process.cwd()
		const projectsDir = path.join(workspacePath, "projects")
		
		// Get the requested path relative to projects dir
		const requestedPath = (req.query.path as string) || "/"
		const targetDir = path.join(projectsDir, requestedPath)
		
		// Security: ensure path is within projects directory
		const resolvedPath = path.resolve(targetDir)
		if (!resolvedPath.startsWith(path.resolve(projectsDir))) {
			res.status(403).json({ error: "Access denied" })
			return
		}
		
		const entries: { name: string; isDir: boolean; size: number }[] = []
		
		try {
			const dirEntries = await fs.promises.readdir(targetDir, { withFileTypes: true })
			for (const entry of dirEntries) {
				if (entry.name.startsWith(".")) continue
				const fullPath = path.join(targetDir, entry.name)
				if (entry.isDirectory()) {
					entries.push({ name: entry.name, isDir: true, size: 0 })
				} else {
					try {
						const stat = await fs.promises.stat(fullPath)
						entries.push({ name: entry.name, isDir: false, size: stat.size })
					} catch {
						entries.push({ name: entry.name, isDir: false, size: 0 })
					}
				}
			}
		} catch (err: any) {
			if (err.code === "ENOENT") {
				// Directory doesn't exist yet - return empty
				res.json({ entries: [], path: requestedPath })
				return
			}
			throw err
		}
		
		res.json({ entries, path: requestedPath })
	} catch (error) {
		log.error("Error browsing workspace:", error)
		res.status(500).json({ error: String(error) })
	}
})
// Society Agent end

// Society Agent start - workspace file browser
/**
 * GET /api/workspace/files - List files in the projects output directory
 */
app.get("/api/workspace/files", async (req, res): Promise<void> => {
	try {
		const workspacePath = process.env.WORKSPACE_PATH || process.cwd()
		const projectsDir = path.join(workspacePath, "projects")

		const files: { path: string; fullPath: string; size: number; modified: string; isDir: boolean }[] = []

		// Society Agent - Skip heavy directories that slow down file listing
		const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".next", ".cache", "coverage", "__pycache__", ".git"])

		async function walkDir(dir: string, prefix: string = "") {
			try {
				const entries = await fs.promises.readdir(dir, { withFileTypes: true })
				for (const entry of entries) {
					if (entry.name.startsWith(".")) continue
					if (SKIP_DIRS.has(entry.name)) continue // Society Agent - skip heavy dirs
					const fullPath = path.join(dir, entry.name)
					const relPath = prefix ? `${prefix}/${entry.name}` : entry.name
					if (entry.isDirectory()) {
						files.push({ path: relPath, fullPath, size: 0, modified: "", isDir: true })
						await walkDir(fullPath, relPath)
					} else {
						const stat = await fs.promises.stat(fullPath)
						files.push({
							path: relPath,
							fullPath,
							size: stat.size,
							modified: stat.mtime.toISOString(),
							isDir: false,
						})
					}
				}
			} catch {
				// Directory doesn't exist yet
			}
		}

		await walkDir(projectsDir)

		res.json({
			workspacePath,
			outputDir: projectsDir,
			files,
			totalFiles: files.filter((f) => !f.isDir).length,
			totalDirs: files.filter((f) => f.isDir).length,
		})
	} catch (error) {
		log.error("Error listing workspace files:", error)
		res.status(500).json({ error: String(error) })
	}
})

/**
 * GET /api/workspace/file - Read a specific file's content
 */
app.get("/api/workspace/file", async (req, res): Promise<void> => {
	try {
		const filePath = req.query.path as string
		if (!filePath) {
			res.status(400).json({ error: "path query parameter required" })
			return
		}

		const workspacePath = process.env.WORKSPACE_PATH || process.cwd()
		const fullPath = path.join(workspacePath, "projects", filePath)

		// Security: ensure path is within projects directory
		const resolved = path.resolve(fullPath)
		const projectsResolved = path.resolve(path.join(workspacePath, "projects"))
		if (!resolved.startsWith(projectsResolved)) {
			res.status(403).json({ error: "Access denied: path outside projects directory" })
			return
		}

		const content = await fs.promises.readFile(fullPath, "utf-8")
		const stat = await fs.promises.stat(fullPath)

		res.json({
			path: filePath,
			fullPath,
			content,
			size: stat.size,
			modified: stat.mtime.toISOString(),
		})
	} catch (error: any) {
		if (error.code === "ENOENT") {
			res.status(404).json({ error: "File not found" })
		} else {
			res.status(500).json({ error: String(error) })
		}
	}
})

/**
 * POST /api/workspace/file - Upload/create a file in the projects directory
 * Body: { path: string, content: string, encoding?: 'utf-8' | 'base64' }
 */
app.post("/api/workspace/file", async (req, res): Promise<void> => {
	try {
		const { path: filePath, content, encoding } = req.body
		if (!filePath || content === undefined) {
			res.status(400).json({ error: "'path' and 'content' are required" })
			return
		}

		const workspacePath = process.env.WORKSPACE_PATH || process.cwd()
		const fullPath = path.join(workspacePath, "projects", filePath)

		// Security: ensure path is within projects directory
		const resolved = path.resolve(fullPath)
		const projectsResolved = path.resolve(path.join(workspacePath, "projects"))
		if (!resolved.startsWith(projectsResolved)) {
			res.status(403).json({ error: "Access denied: path outside projects directory" })
			return
		}

		// Create parent directories if needed
		await fs.promises.mkdir(path.dirname(fullPath), { recursive: true })

		// Write file (supports text or base64-encoded binary)
		if (encoding === "base64") {
			await fs.promises.writeFile(fullPath, Buffer.from(content, "base64"))
		} else {
			await fs.promises.writeFile(fullPath, content, "utf-8")
		}

		const stat = await fs.promises.stat(fullPath)
		log.info(`File uploaded: ${filePath} (${stat.size} bytes)`)

		// Notify via WebSocket
		io.emit("file-created", { relativePath: filePath, fullPath, size: stat.size })

		res.json({
			success: true,
			path: filePath,
			fullPath,
			size: stat.size,
			modified: stat.mtime.toISOString(),
		})
	} catch (error) {
		log.error("Error uploading file:", error)
		res.status(500).json({ error: String(error) })
	}
})

// Society Agent start - Raw file serving for viewers (images, PDFs, etc.)
/**
 * GET /api/workspace/raw - Serve a raw file for viewing (images, PDFs, etc.)
 * Query: ?path=relative/path/file.ext
 * Files are served from the projects directory by default
 */
app.get("/api/workspace/raw", async (req, res): Promise<void> => {
	try {
		const filePath = req.query.path as string
		if (!filePath) {
			res.status(400).json({ error: "path query parameter required" })
			return
		}

		const workspacePath = process.env.WORKSPACE_PATH || process.cwd()
		const projectsPath = path.join(workspacePath, "projects")
		const fullPath = path.join(projectsPath, filePath)

		// Security: ensure path is within projects directory (prevent path traversal)
		const resolved = path.resolve(fullPath)
		const projectsResolved = path.resolve(projectsPath)
		if (!resolved.startsWith(projectsResolved + path.sep) && resolved !== projectsResolved) {
			res.status(403).json({ error: "Access denied: path outside projects directory" })
			return
		}

		// Check if file exists
		let stat
		try {
			stat = await fs.promises.stat(fullPath)
		} catch (e: any) {
			if (e.code === "ENOENT") {
				res.status(404).json({ error: "File not found" })
				return
			}
			throw e
		}

		if (!stat.isFile()) {
			res.status(400).json({ error: "Not a file" })
			return
		}

		// Determine MIME type based on extension
		const ext = path.extname(filePath).toLowerCase()
		const mimeTypes: Record<string, string> = {
			// Images
			".png": "image/png",
			".jpg": "image/jpeg",
			".jpeg": "image/jpeg",
			".gif": "image/gif",
			".webp": "image/webp",
			".svg": "image/svg+xml",
			".ico": "image/x-icon",
			".bmp": "image/bmp",
			// Documents
			".pdf": "application/pdf",
			// Text/Code
			".txt": "text/plain",
			".md": "text/markdown",
			".json": "application/json",
			".js": "text/javascript",
			".ts": "text/typescript",
			".html": "text/html",
			".css": "text/css",
			".xml": "application/xml",
			".yaml": "text/yaml",
			".yml": "text/yaml",
			// Archives (for download)
			".zip": "application/zip",
			".tar": "application/x-tar",
			".gz": "application/gzip",
		}

		const contentType = mimeTypes[ext] || "application/octet-stream"
		const fileName = path.basename(filePath)

		// Set headers for proper viewing
		res.setHeader("Content-Type", contentType)
		res.setHeader("Content-Length", stat.size)
		// Allow CORS for embedded viewers
		res.setHeader("Access-Control-Allow-Origin", "*")

		// For PDF/images, allow inline viewing; for others, suggest download
		const inlineTypes = [".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".txt", ".md"]
		if (inlineTypes.includes(ext)) {
			res.setHeader("Content-Disposition", `inline; filename="${fileName}"`)
		} else {
			res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`)
		}

		// Stream the file
		const stream = fs.createReadStream(fullPath)
		stream.on("error", (err) => {
			log.error("Error streaming file:", err)
			if (!res.headersSent) {
				res.status(500).json({ error: "Error reading file" })
			}
		})
		stream.pipe(res)
	} catch (error: any) {
		log.error("Error serving raw file:", error)
		if (!res.headersSent) {
			res.status(500).json({ error: String(error) })
		}
	}
})
// Society Agent end

/**
 * DELETE /api/workspace/file - Delete a file or empty directory
 * Query: ?path=relative/path/file.txt
 */
app.delete("/api/workspace/file", async (req, res): Promise<void> => {
	try {
		const filePath = req.query.path as string
		if (!filePath) {
			res.status(400).json({ error: "path query parameter required" })
			return
		}

		const workspacePath = process.env.WORKSPACE_PATH || process.cwd()
		const fullPath = path.join(workspacePath, "projects", filePath)

		// Security: ensure path is within projects directory
		const resolved = path.resolve(fullPath)
		const projectsResolved = path.resolve(path.join(workspacePath, "projects"))
		if (!resolved.startsWith(projectsResolved)) {
			res.status(403).json({ error: "Access denied: path outside projects directory" })
			return
		}

		// Prevent deleting the projects root itself
		if (resolved === projectsResolved) {
			res.status(403).json({ error: "Cannot delete the projects root directory" })
			return
		}

		const stat = await fs.promises.stat(fullPath)
		if (stat.isDirectory()) {
			// Remove directory recursively
			await fs.promises.rm(fullPath, { recursive: true, force: true })
			log.info(`Directory deleted: ${filePath}`)
		} else {
			await fs.promises.unlink(fullPath)
			log.info(`File deleted: ${filePath}`)
		}

		io.emit("file-deleted", { relativePath: filePath, fullPath, wasDir: stat.isDirectory() })

		res.json({ success: true, path: filePath, deleted: true })
	} catch (error: any) {
		if (error.code === "ENOENT") {
			res.status(404).json({ error: "File not found" })
		} else {
			log.error("Error deleting file:", error)
			res.status(500).json({ error: String(error) })
		}
	}
})

/**
 * POST /api/workspace/dir - Create a directory
 * Body: { path: string }
 */
app.post("/api/workspace/dir", async (req, res): Promise<void> => {
	try {
		const { path: dirPath } = req.body
		if (!dirPath) {
			res.status(400).json({ error: "'path' is required" })
			return
		}

		const workspacePath = process.env.WORKSPACE_PATH || process.cwd()
		const fullPath = path.join(workspacePath, "projects", dirPath)

		// Security: ensure path is within projects directory
		const resolved = path.resolve(fullPath)
		const projectsResolved = path.resolve(path.join(workspacePath, "projects"))
		if (!resolved.startsWith(projectsResolved)) {
			res.status(403).json({ error: "Access denied: path outside projects directory" })
			return
		}

		await fs.promises.mkdir(fullPath, { recursive: true })
		log.info(`Directory created: ${dirPath}`)

		res.json({ success: true, path: dirPath, fullPath })
	} catch (error) {
		log.error("Error creating directory:", error)
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/workspace/move - Move or rename a file/directory
 * Body: { from: string, to: string }
 */
app.post("/api/workspace/move", async (req, res): Promise<void> => {
	try {
		const { from, to } = req.body
		if (!from || !to) {
			res.status(400).json({ error: "'from' and 'to' paths are required" })
			return
		}

		const workspacePath = process.env.WORKSPACE_PATH || process.cwd()
		const projectsDir = path.join(workspacePath, "projects")
		const fromFull = path.join(projectsDir, from)
		const toFull = path.join(projectsDir, to)

		// Security: ensure both paths are within projects directory
		const projectsResolved = path.resolve(projectsDir)
		if (!path.resolve(fromFull).startsWith(projectsResolved) || !path.resolve(toFull).startsWith(projectsResolved)) {
			res.status(403).json({ error: "Access denied: path outside projects directory" })
			return
		}

		// Check source exists
		if (!fs.existsSync(fromFull)) {
			res.status(404).json({ error: "Source not found" })
			return
		}

		// Ensure destination parent directory exists
		await fs.promises.mkdir(path.dirname(toFull), { recursive: true })

		// Move/rename
		await fs.promises.rename(fromFull, toFull)
		log.info(`Moved: ${from} → ${to}`)

		io.emit("file-moved", { from, to })

		res.json({ success: true, from, to })
	} catch (error) {
		log.error("Error moving file:", error)
		res.status(500).json({ error: String(error) })
	}
})
// Society Agent end

/**
 * POST /api/config/api-key - Save API key to .env file
 */
app.post("/api/config/api-key", async (req, res): Promise<void> => {
	try {
		const { apiKey } = req.body

		if (!apiKey || typeof apiKey !== "string") {
			res.status(400).json({ error: "API key required" })
			return
		}

		// Validate API key format
		if (!apiKey.startsWith("sk-ant-")) {
			res.status(400).json({ error: "Invalid API key format" })
			return
		}

		// Save to workspace root .env (where dotenv auto-loads from)
		const envPath = path.resolve(process.cwd(), ".env")
		// Also save to src/.env as fallback (where Society Agent reads it)
		const srcEnvPath = path.join(__dirname, "../../.env")
		let envContent = ""

		// Read existing .env file
		if (fs.existsSync(envPath)) {
			envContent = fs.readFileSync(envPath, "utf-8")
		}

		// Update or add ANTHROPIC_API_KEY
		if (envContent.includes("ANTHROPIC_API_KEY=")) {
			envContent = envContent.replace(/ANTHROPIC_API_KEY=.*/, `ANTHROPIC_API_KEY=${apiKey}`)
		} else {
			envContent += `\nANTHROPIC_API_KEY=${apiKey}\n`
		}

		// Write updated .env file to workspace root
		fs.writeFileSync(envPath, envContent, "utf-8")

		// Also update src/.env if it exists (keeps Society Agent in sync)
		if (fs.existsSync(srcEnvPath) && srcEnvPath !== envPath) {
			let srcContent = fs.readFileSync(srcEnvPath, "utf-8")
			if (srcContent.includes("ANTHROPIC_API_KEY=")) {
				srcContent = srcContent.replace(/ANTHROPIC_API_KEY=.*/, `ANTHROPIC_API_KEY=${apiKey}`)
			} else {
				srcContent += `\nANTHROPIC_API_KEY=${apiKey}\n`
			}
			fs.writeFileSync(srcEnvPath, srcContent, "utf-8")
		}

		// Update process.env immediately
		process.env.ANTHROPIC_API_KEY = apiKey

		log.info("API key saved to .env file")

		res.json({
			success: true,
			message: "API key saved successfully. Server will use this key for future requests.",
		})
	} catch (error) {
		log.error("Error saving API key:", error)
		res.status(500).json({ error: String(error) })
	}
})

/**
 * GET /api/config/api-key - Check if API key is configured
 */
app.get("/api/config/api-key", (req, res) => {
	res.json({
		configured: !!process.env.ANTHROPIC_API_KEY,
		// Return masked key if configured (for verification)
		masked: process.env.ANTHROPIC_API_KEY
			? `${process.env.ANTHROPIC_API_KEY.slice(0, 12)}...${process.env.ANTHROPIC_API_KEY.slice(-4)}`
			: null,
	})
})

// Society Agent start - change workspace path from browser
/**
 * POST /api/config/workspace-path - Update WORKSPACE_PATH
 * Body: { path: string }
 */
app.post("/api/config/workspace-path", async (req, res): Promise<void> => {
	try {
		const { path: newPath } = req.body
		if (!newPath || typeof newPath !== "string") {
			res.status(400).json({ error: "'path' is required" })
			return
		}

		// Resolve to absolute path
		const absPath = path.resolve(newPath)

		// Verify directory exists (or create it)
		await fs.promises.mkdir(absPath, { recursive: true })

		// Also ensure the projects subdirectory exists
		await fs.promises.mkdir(path.join(absPath, "projects"), { recursive: true })

		// Update process.env
		process.env.WORKSPACE_PATH = absPath

		// Persist to .env file
		const envPath = path.join(__dirname, "../../.env")
		let envContent = ""
		if (fs.existsSync(envPath)) {
			envContent = fs.readFileSync(envPath, "utf-8")
		}
		if (envContent.includes("WORKSPACE_PATH=")) {
			envContent = envContent.replace(/WORKSPACE_PATH=.*/, `WORKSPACE_PATH=${absPath}`)
		} else {
			envContent += `\nWORKSPACE_PATH=${absPath}\n`
		}
		fs.writeFileSync(envPath, envContent, "utf-8")

		log.info(`Workspace path changed to: ${absPath}`)

		res.json({
			success: true,
			workspacePath: absPath,
			outputDir: path.join(absPath, "projects"),
		})
	} catch (error) {
		log.error("Error changing workspace path:", error)
		res.status(500).json({ error: String(error) })
	}
})
// Society Agent end

// Society Agent start - provider configuration endpoints
/**
 * GET /api/config/provider - Get current provider configuration
 * Returns both legacy and full provider settings
 */
app.get("/api/config/provider", (req, res) => {
	const workspacePath = process.env.WORKSPACE_PATH || process.cwd()
	try {
		// Try to load full provider settings first
		try {
			const settings = loadProviderSettings(workspacePath)
			res.json({
				provider: settings.apiProvider,
				model:
					settings.apiModelId ||
					settings.openRouterModelId ||
					settings.openAiModelId ||
					settings.ollamaModelId ||
					null,
				apiKeyConfigured: !!(
					settings.apiKey ||
					settings.openRouterApiKey ||
					settings.minimaxApiKey ||
					settings.openAiApiKey ||
					settings.geminiApiKey
				),
				configuredProviders: getConfiguredProviders(workspacePath),
				allProviders: getAllProviderNames(),
				settingsType: "full",
			})
			return
		} catch {
			// Fall back to legacy config
		}

		const config = loadProviderConfig(workspacePath)
		if (!config) {
			res.json({
				provider: null,
				model: null,
				apiKeyConfigured: false,
				configuredProviders: getConfiguredProviders(workspacePath),
				allProviders: getAllProviderNames(),
				settingsType: "legacy",
			})
			return
		}
		res.json({
			provider: config.provider,
			model: config.model,
			// Mask API key
			apiKeyConfigured: !!config.apiKey,
			apiKeyMasked: config.apiKey ? `${config.apiKey.slice(0, 8)}...${config.apiKey.slice(-4)}` : null,
			configuredProviders: getConfiguredProviders(workspacePath),
			allProviders: getAllProviderNames(),
			settingsType: "legacy",
		})
	} catch (error) {
		res.json({
			provider: null,
			model: null,
			apiKeyConfigured: false,
			configuredProviders: getConfiguredProviders(workspacePath),
			allProviders: getAllProviderNames(),
			error: String(error),
		})
	}
})

/**
 * POST /api/config/provider - Save provider configuration
 * Body: { provider: string, apiKey: string, model?: string }
 * Or full ProviderSettings: { apiProvider: string, ...providerSpecificSettings }
 */
app.post("/api/config/provider", async (req, res): Promise<void> => {
	try {
		const workspacePath = process.env.WORKSPACE_PATH || process.cwd()

		// Check if this is a full ProviderSettings object
		if (req.body.apiProvider) {
			const settings = req.body as ProviderSettings
			if (!isValidProvider(settings.apiProvider || "")) {
				res.status(400).json({
					error: `Invalid provider. Must be one of: ${getAllProviderNames().join(", ")}`,
				})
				return
			}

			await saveProviderSettings(workspacePath, settings)

			// Clear current state to reload with new config
			societyManager = null
			currentProviderConfig = null
			currentProviderSettings = null

			log.info(`Full ProviderSettings saved: ${settings.apiProvider}`)

			res.json({
				success: true,
				provider: settings.apiProvider,
				settingsType: "full",
				message: "Provider settings saved. Server will use new provider on next request.",
			})
			return
		}

		// Legacy format
		const { provider, apiKey, model } = req.body
		if (!provider || !apiKey) {
			res.status(400).json({ error: "'provider' and 'apiKey' are required" })
			return
		}

		const validProviders: ProviderType[] = ["anthropic", "minimax", "openrouter", "openai", "custom"]
		if (!validProviders.includes(provider)) {
			res.status(400).json({ error: `Invalid provider. Must be one of: ${validProviders.join(", ")}` })
			return
		}

		await saveProviderConfig(workspacePath, {
			provider,
			apiKey,
			model: model || "claude-sonnet-4-20250514",
		})

		// Clear current state to reload with new config
		societyManager = null
		currentProviderConfig = null
		currentProviderSettings = null

		log.info(`Provider configuration updated: ${provider}`)

		res.json({
			success: true,
			provider,
			model: model || undefined,
			settingsType: "legacy",
			message: "Provider configuration saved. Server will use new provider on next request.",
		})
	} catch (error) {
		log.error("Error saving provider config:", error)
		res.status(500).json({ error: String(error) })
	}
})

/**
 * GET /api/config/providers - List available providers
 */
app.get("/api/config/providers", (req, res) => {
	const workspacePath = process.env.WORKSPACE_PATH || process.cwd()
	res.json({
		// Legacy providers for backward compatibility
		legacyProviders: ["anthropic", "minimax", "openrouter", "openai", "custom"],
		// All supported providers (30+)
		allProviders: getAllProviderNames(),
		configured: getConfiguredProviders(workspacePath),
		current: currentProviderSettings?.apiProvider || currentProviderConfig?.provider || null,
	})
})
// Society Agent end

// Society Agent start - standalone settings API
/**
 * GET /api/settings - Get standalone server settings
 * Returns the unified settings from .society-agent/settings.json
 */
app.get("/api/settings", (req, res) => {
	try {
		const settings = standaloneSettings.get()
		res.json({
			provider: {
				type: settings.provider.type,
				model: settings.provider.model,
				apiKeyConfigured: standaloneSettings.hasApiKey(),
				apiKeyMasked: standaloneSettings.getMaskedApiKey(),
			},
			port: settings.port,
			workspacePath: settings.workspacePath,
			projectsDir: settings.projectsDir,
			defaultMaxTokens: settings.defaultMaxTokens,
			defaultTemperature: settings.defaultTemperature,
			verboseLogging: settings.verboseLogging,
			sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
			supportedProviders: standaloneSettings.getSupportedProviders(),
		})
	} catch (error) {
		log.error("Error getting settings:", error)
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/settings - Update standalone server settings
 * Body: Partial<ServerSettings>
 */
app.post("/api/settings", async (req, res): Promise<void> => {
	try {
		const { provider, ...otherSettings } = req.body

		// Validate provider if updating
		if (provider) {
			if (!provider.type || !standaloneSettings.getSupportedProviders().includes(provider.type)) {
				res.status(400).json({
					error: `Invalid provider type. Must be one of: ${standaloneSettings.getSupportedProviders().join(", ")}`,
				})
				return
			}
			standaloneSettings.updateProvider(provider)
		}

		// Update other settings
		if (Object.keys(otherSettings).length > 0) {
			standaloneSettings.update(otherSettings)
		}

		// Clear cached provider state since settings changed
		currentProviderConfig = null
		currentProviderSettings = null
		societyManager = null

		log.info(`Settings updated via API`)

		res.json({
			success: true,
			message: "Settings saved. New configuration will be used immediately.",
			settings: standaloneSettings.get(),
		})
	} catch (error) {
		log.error("Error saving settings:", error)
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/settings/provider - Quick endpoint to update just the provider
 * Body: { type: string, apiKey: string, model?: string }
 */
app.post("/api/settings/provider", async (req, res): Promise<void> => {
	try {
		const { type, apiKey, model } = req.body

		if (!type || !apiKey) {
			res.status(400).json({ error: "'type' and 'apiKey' are required" })
			return
		}

		if (!standaloneSettings.getSupportedProviders().includes(type)) {
			res.status(400).json({
				error: `Invalid provider type. Must be one of: ${standaloneSettings.getSupportedProviders().join(", ")}`,
			})
			return
		}

		standaloneSettings.updateProvider({
			type,
			apiKey,
			model: model || standaloneSettings.getDefaultModel(type),
		})

		// Clear cached state
		currentProviderConfig = null
		currentProviderSettings = null
		societyManager = null

		log.info(`Provider updated to ${type} with model ${model || standaloneSettings.getDefaultModel(type)}`)

		res.json({
			success: true,
			provider: {
				type,
				model: model || standaloneSettings.getDefaultModel(type),
				apiKeyMasked: standaloneSettings.getMaskedApiKey(),
			},
		})
	} catch (error) {
		log.error("Error updating provider:", error)
		res.status(500).json({ error: String(error) })
	}
})
// Society Agent end

/**
 * POST /api/purpose/start - Start a new purpose (Agent-driven with memory)
 */
app.post("/api/purpose/start", async (req, res): Promise<void> => {
	try {
		// Get API key from header or use environment variable
		const apiKey = (req.headers["x-api-key"] as string) || process.env.ANTHROPIC_API_KEY

		if (!apiKey) {
			res.status(401).json({
				error: "API key required. Provide via X-API-Key header or configure ANTHROPIC_API_KEY environment variable",
			})
			return
		}

		const { description, attachments, agentId, projectId } = req.body // Society Agent - added agentId, projectId

		if (!description && (!attachments || attachments.length === 0)) {
			res.status(400).json({ error: "Purpose description or attachments required" })
			return
		}

		// Society Agent start - route to persistent/project agent if agentId specified
		if (agentId) {
			// Try project store first, then legacy store
			const found = projectStore.findAgentProject(agentId, projectId)
			let agent: ConversationAgent
			let agentName: string
			let agentProjectId: string | undefined

			if (found) {
				agent = getOrCreateProjectAgent(found.agent, found.project, apiKey)
				projectStore.recordActivity(found.project.id, agentId)
				agentName = found.agent.name
				agentProjectId = found.project.id
				log.info(`[${found.agent.name}@${found.project.name}] purpose: ${typeof description === 'string' ? description.substring(0, 80) : 'attachment'}`)
			} else {
				const profile = agentStore.get(agentId)
				if (!profile) {
					res.status(404).json({ error: `Agent "${agentId}" not found` })
					return
				}
				agent = getOrCreateAgent(profile, apiKey)
				agentStore.recordActivity(agentId)
				agentName = profile.name
				log.info(`[${profile.name}] handling: ${typeof description === 'string' ? description.substring(0, 80) : 'attachment'}`)
			}

			const content = attachments && attachments.length > 0 ? attachments : description

			let fullResponse = ""
			for await (const chunk of agent.sendMessageStream(content)) {
				fullResponse += chunk
				io.emit("agent-message", {
					agentId,
					agentName,
					projectId: agentProjectId,
					message: chunk,
					timestamp: Date.now(),
					isStreaming: true,
				})
			}

			io.emit("agent-message", {
				agentId,
				agentName,
				projectId: agentProjectId,
				message: "",
				timestamp: Date.now(),
				isStreaming: false,
				isDone: true,
			})

			// Society Agent start - Auto-extract and create files from project agent responses
			let filesCreated = 0
			if (agentProjectId && fullResponse.length > 0) {
				try {
					filesCreated = await agent.extractAndCreateFiles(fullResponse)
					if (filesCreated > 0) {
						log.info(`[${agentName}] Auto-created ${filesCreated} files from chat response`)
						io.emit("system-event", {
							type: "files-created",
							agentId,
							projectId: agentProjectId,
							count: filesCreated,
							message: `${agentName} created ${filesCreated} file(s) in project folder`,
							timestamp: Date.now(),
						})
					}
				} catch (err) {
					log.warn(`[${agentName}] File extraction failed:`, err)
				}
			}
			// Society Agent end

			// Update memory periodically (every 10 messages)
			const history = agent.getHistory()
			if (history.length > 0 && history.length % 10 === 0) {
				const lastMessages = history.slice(-6).map((m: any) => `${m.role}: ${typeof m.content === 'string' ? m.content.substring(0, 200) : '[structured]'}`).join('\n')
				if (found) {
					projectStore.updateAgentMemory(found.project.id, agentId, `Recent context (${history.length} messages):\n${lastMessages}`)
				} else {
					agentStore.updateMemory(agentId, `Recent context (${history.length} messages):\n${lastMessages}`)
				}
			}

			res.json({
				type: "chat",
				agentId,
				agentName,
				projectId: agentProjectId,
				response: fullResponse,
				status: "completed",
				historyLength: history.length,
				filesCreated, // Society Agent - report files created
			})
			return
		}
		// Society Agent end

		// Initialize user agent if not exists (maintains conversation memory)
		if (!userAgent) {
			log.info("Creating user conversation agent...")

			// Society Agent start - use provider config instead of hardcoded Anthropic
			const apiHandler = getApiHandlerFromConfig()
			const contextConfig = getProviderContextConfig()
			// Society Agent end

			userAgent = new ConversationAgent({
				identity: {
					id: "society-agent",
					createdAt: Date.now(),
				},
				apiHandler,
				// Society Agent - provider-specific context limits
				contextWindowSize: contextConfig.contextWindowSize,
				contextThresholdPercent: contextConfig.contextThresholdPercent,
				systemPrompt: buildFullSystemPrompt(`You are Society Agent, an AI assistant powering a multi-agent collaboration system.

Your role:
- Answer questions conversationally and helpfully
- Help with coding, writing, analysis, planning, and creative tasks
- Provide clear, well-structured responses
- Maintain context across the conversation

Guidelines:
- Be conversational and direct
- Use markdown formatting when helpful
- Be concise but thorough
- You have full conversation memory across messages`),
				onMessage: (message) => {
					// Stream message to client
					io.emit("agent-message", {
						agentId: "user-agent",
						message: message.content,
						timestamp: message.timestamp,
						isStreaming: false,
					})
				},
				// Society Agent start - file creation tracking
				onFileCreated: (relativePath, fullPath, size) => {
					log.info(`File created: ${fullPath} (${size} bytes)`)
					io.emit("file-created", {
						agentId: "society-agent",
						relativePath,
						fullPath,
						size,
						timestamp: Date.now(),
					})
				},
				// Society Agent end
				// Society Agent start - summarization events
				onSummarizationStart: (meta) => {
					log.info(`society-agent: Summarization started (${meta.messageCount} messages, ~${meta.tokenCount} tokens, ${meta.contextPercent.toFixed(1)}%)`)
					io.emit("summarization-start", { 
						agentId: "society-agent", 
						messageCount: meta.messageCount, 
						tokenCount: meta.tokenCount,
						contextPercent: meta.contextPercent,
						timestamp: Date.now() 
					})
				},
				onSummarizationEnd: (meta) => {
					log.info(`society-agent: Summarization complete (${meta.messageCountBefore} → ${meta.messageCountAfter} msgs, ~${meta.tokensBefore} → ~${meta.tokensAfter} tokens, $${meta.cost.toFixed(4)})`)
					io.emit("summarization-end", { 
						agentId: "society-agent", 
						summary: meta.summary, 
						messageCountBefore: meta.messageCountBefore,
						messageCountAfter: meta.messageCountAfter,
						tokensBefore: meta.tokensBefore,
						tokensAfter: meta.tokensAfter,
						cost: meta.cost,
						error: meta.error,
						timestamp: Date.now() 
					})
				},
				// Society Agent end
			})
		}

		log.info("User agent handling:", description)

		// Build content: plain string or content blocks with attachments
		const content = attachments && attachments.length > 0 ? attachments : description

		// Send message to agent (it maintains its own conversation history)
		let fullResponse = ""
		for await (const chunk of userAgent.sendMessageStream(content)) {
			fullResponse += chunk
			io.emit("agent-message", {
				agentId: "user-agent",
				message: chunk,
				timestamp: Date.now(),
				isStreaming: true,
			})
		}

		// Signal end of streaming
		io.emit("agent-message", {
			agentId: "user-agent",
			message: "",
			timestamp: Date.now(),
			isStreaming: false,
			isDone: true,
		})

		res.json({
			type: "chat",
			response: fullResponse,
			status: "completed",
			historyLength: userAgent.getHistory().length,
		})
		return
	} catch (error) {
		log.error("Error handling purpose:", error)
		res.status(500).json({ error: String(error) })
	}
})

// Society Agent start
/**
 * POST /api/purpose/launch - Launch a multi-agent team for a complex purpose
 * This is the real multi-agent flow: supervisor analyzes → team forms → workers execute
 */
app.post("/api/purpose/launch", async (req, res): Promise<void> => {
	try {
		const apiKey = (req.headers["x-api-key"] as string) || process.env.ANTHROPIC_API_KEY

		if (!apiKey) {
			res.status(401).json({ error: "API key required" })
			return
		}

		const { description, constraints, successCriteria } = req.body

		if (!description) {
			res.status(400).json({ error: "Purpose description required" })
			return
		}

		// Initialize SocietyManager if needed
		await initializeSocietyManager(apiKey)

		if (!societyManager) {
			res.status(500).json({ error: "Failed to initialize Society Manager" })
			return
		}

		log.info("Launching multi-agent purpose:", description)

		io.emit("system-event", {
			type: "purpose-launching",
			message: `Analyzing purpose: "${description}"`,
			timestamp: Date.now(),
		})

		const purposeId = await societyManager.startPurpose({
			description,
			constraints: constraints || [],
			successCriteria: successCriteria || [],
		})

		res.json({
			type: "multi-agent",
			purposeId,
			status: "launched",
			message: "Purpose launched - supervisor is forming a team",
		})
	} catch (error) {
		log.error("Error launching purpose:", error)
		io.emit("system-event", {
			type: "purpose-error",
			message: `Failed: ${String(error)}`,
			timestamp: Date.now(),
		})
		res.status(500).json({ error: String(error) })
	}
})
// Society Agent end

/**
 * GET /api/purposes - Get all purposes (active + completed)
 */
app.get("/api/purposes", (req, res): void => {
	try {
		if (!societyManager) {
			res.json({ active: [], completed: [] })
			return
		}

		const state = societyManager.getState()

		const active = Array.from(state.activePurposes.values()).map((purpose) => {
			const pAny = purpose as any // Society Agent
			return {
				id: purpose.purpose.id,
				description: purpose.purpose.description,
				status: purpose.status,
				startedAt: purpose.startedAt,
				progress: pAny.supervisorState?.progressPercentage || 0,
				teamSize: pAny.team?.getAllMembers()?.length || 0,
			}
		})

		const completed = state.completedPurposes.map((purpose) => ({
			id: purpose.id,
			description: purpose.description,
			status: "completed",
			createdAt: purpose.createdAt,
		}))

		res.json({ active, completed })
	} catch (error) {
		log.error("Error getting purposes:", error)
		res.status(500).json({ error: String(error) })
	}
})

/**
 * GET /api/purpose/:purposeId - Get details of a specific purpose
 */
app.get("/api/purpose/:purposeId", (req, res): void => {
	try {
		if (!societyManager) {
			res.status(404).json({ error: "Society Manager not initialized" })
			return
		}

		const state = societyManager.getState()
		const purpose = state.activePurposes.get(req.params.purposeId)

		if (!purpose) {
			res.status(404).json({ error: "Purpose not found" })
			return
		}

		const pAny = purpose as any // Society Agent
		res.json({
			id: purpose.purpose.id,
			description: purpose.purpose.description,
			status: purpose.status,
			progress: pAny.supervisorState?.progressPercentage || 0,
			agents: getTeamAgents(req.params.purposeId),
			startedAt: purpose.startedAt,
		})
	} catch (error) {
		log.error("Error getting purpose:", error)
		res.status(500).json({ error: String(error) })
	}
})

/**
 * GET /api/agents - Get all active agents
 */
app.get("/api/agents", (req, res): void => {
	try {
		if (!societyManager) {
			res.json({ agents: [] })
			return
		}

		const state = societyManager.getState()
		const agents: any[] = []

		state.activePurposes.forEach((purpose) => {
			const pAny = purpose as any // Society Agent
			if (!pAny.team) return
			pAny.team.getAllMembers().forEach((member: any) => {
				agents.push({
					id: member.identity.id,
					name: member.identity.name || member.identity.id,
					role: member.identity.role,
					purposeId: purpose.purpose.id,
					status: member.agent.getState().status,
					progress: member.agent.getState().progress || 0,
					actionCount: member.agent.getState().actionCount || 0,
					errorCount: member.agent.getState().errorCount || 0,
				})
			})
		})

		res.json({ agents })
	} catch (error) {
		log.error("Error getting agents:", error)
		res.status(500).json({ error: String(error) })
	}
})

/**
 * GET /api/agent/:agentId - Get details of a specific agent
 */
app.get("/api/agent/:agentId", (req, res): void => {
	try {
		if (!societyManager) {
			res.status(404).json({ error: "Society Manager not initialized" })
			return
		}

		const state = societyManager.getState()
		let foundAgent: any = null

		state.activePurposes.forEach((purpose) => {
			const pAny = purpose as any // Society Agent
			if (!pAny.team) return
			const member = pAny.team.getAllMembers().find((m: any) => m.identity.id === req.params.agentId)
			if (member) {
				foundAgent = {
					id: member.identity.id,
					name: member.identity.name || member.identity.id,
					role: member.identity.role,
					purposeId: purpose.purpose.id,
					status: member.agent.getState().status,
					progress: member.agent.getState().progress || 0,
					actionCount: member.agent.getState().actionCount || 0,
					errorCount: member.agent.getState().errorCount || 0,
					task: member.agent.getState().currentTask,
				}
			}
		})

		if (!foundAgent) {
			res.status(404).json({ error: "Agent not found" })
			return
		}

		res.json(foundAgent)
	} catch (error) {
		log.error("Error getting agent:", error)
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/agent/:agentId/pause - Pause an agent
 */
app.post("/api/agent/:agentId/pause", async (req, res) => {
	try {
		res.status(501).json({ error: "Agent pause not yet implemented", agentId: req.params.agentId })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/agent/:agentId/stop - Stop an agent
 */
app.post("/api/agent/:agentId/stop", async (req, res) => {
	try {
		const agentId = req.params.agentId
		log.info(`REST API stop request for agent: ${agentId}`)
		// Add to stopped set - the agentic loop will check this
		stoppedAgents.add(agentId)
		// Clear after a timeout (in case request already finished)
		setTimeout(() => stoppedAgents.delete(agentId), 30000)
		// Emit via socket for UI update
		io.emit("agent-stopped", { agentId })
		res.json({ success: true, agentId, message: "Stop signal sent" })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

// Society Agent start - persistent agent CRUD endpoints
/**
 * Helper: get or create a live ConversationAgent from a persistent profile
 */
function getOrCreateAgent(profile: import("./persistent-agent-store").PersistentAgentProfile, apiKey: string): ConversationAgent {
	const existing = activeAgents.get(profile.id)
	if (existing) return existing

	// Society Agent start - use provider config instead of hardcoded Anthropic
	const apiHandler = getApiHandlerFromConfig()
	const contextConfig = getProviderContextConfig()
	// Society Agent end

	// Build system prompt with memory context
	let fullPrompt = buildFullSystemPrompt(profile.systemPrompt || "You are an AI assistant.")
	if (profile.memorySummary) {
		fullPrompt += `\n\n## Your Memory (from past conversations)\n${profile.memorySummary}`
	}

	// Society Agent start - agent workspace path for history persistence
	const agentWorkspace = path.join(getWorkspacePath(), "projects", profile.workspaceFolder || profile.id)
	// Society Agent end

	const agent = new ConversationAgent({
		identity: {
			id: profile.id,
			createdAt: Date.now(),
		},
		apiHandler,
		// Society Agent - provider-specific context limits
		contextWindowSize: contextConfig.contextWindowSize,
		contextThresholdPercent: contextConfig.contextThresholdPercent,
		systemPrompt: fullPrompt,
		workspacePath: agentWorkspace, // Society Agent - use agent's folder
		// Society Agent start - enable history persistence for restart recovery
		persistHistory: true,
		historyDir: path.join(agentWorkspace, ".history"),
		backupsEnabled: true,
		// Society Agent end
		onMessage: (message) => {
			io.emit("agent-message", {
				agentId: profile.id,
				message: message.content,
				timestamp: message.timestamp,
				isStreaming: false,
			})
		},
		onFileCreated: (relativePath, fullPath, size) => {
			log.info(`[${profile.name}] File created: ${fullPath} (${size} bytes)`)
			io.emit("file-created", {
				agentId: profile.id,
				relativePath,
				fullPath,
				size,
				timestamp: Date.now(),
			})
		},
		// Society Agent start - summarization events
		onSummarizationStart: (meta) => {
			log.info(`${profile.id}: Summarization started (${meta.messageCount} msgs, ~${meta.tokenCount} tokens, ${meta.contextPercent.toFixed(1)}%)`)
			io.emit("summarization-start", { 
				agentId: profile.id, 
				messageCount: meta.messageCount, 
				tokenCount: meta.tokenCount,
				contextPercent: meta.contextPercent,
				timestamp: Date.now() 
			})
		},
		onSummarizationEnd: (meta) => {
			log.info(`${profile.id}: Summarization complete (${meta.messageCountBefore} → ${meta.messageCountAfter} msgs, ~${meta.tokensBefore} → ~${meta.tokensAfter} tokens, $${meta.cost.toFixed(4)})`)
			io.emit("summarization-end", { 
				agentId: profile.id, 
				summary: meta.summary, 
				messageCountBefore: meta.messageCountBefore,
				messageCountAfter: meta.messageCountAfter,
				tokensBefore: meta.tokensBefore,
				tokensAfter: meta.tokensAfter,
				cost: meta.cost,
				error: meta.error,
				timestamp: Date.now() 
			})
		},
		// Society Agent end
	})

	activeAgents.set(profile.id, agent)
	log.info(`Activated persistent agent: ${profile.name} (${profile.id})`)
	return agent
}

/**
 * GET /api/persistent-agents - List all persistent agents
 */
app.get("/api/persistent-agents", (req, res): void => {
	try {
		const agents = agentStore.getAll().map((a) => ({
			...a,
			isActive: activeAgents.has(a.id),
			historyLength: activeAgents.get(a.id)?.getHistory().length || 0,
		}))
		res.json({ agents })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * GET /api/persistent-agents/:id - Get a specific persistent agent
 */
app.get("/api/persistent-agents/:id", (req, res): void => {
	try {
		const agent = agentStore.get(req.params.id)
		if (!agent) {
			res.status(404).json({ error: "Agent not found" })
			return
		}
		res.json({
			...agent,
			isActive: activeAgents.has(agent.id),
			historyLength: activeAgents.get(agent.id)?.getHistory().length || 0,
		})
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/persistent-agents - Create a new persistent agent
 */
app.post("/api/persistent-agents", (req, res): void => {
	try {
		const { id, name, role, systemPrompt, model } = req.body
		if (!id || !name || !role || !systemPrompt) {
			res.status(400).json({ error: "id, name, role, and systemPrompt are required" })
			return
		}
		const agent = agentStore.create({
			id,
			name,
			role,
			systemPrompt,
			model,
		})
		io.emit("system-event", { type: "agent-created", agentId: id, name, timestamp: Date.now() })
		res.status(201).json(agent)
	} catch (error) {
		res.status(400).json({ error: String(error) })
	}
})

/**
 * PUT /api/persistent-agents/:id - Update a persistent agent
 */
app.put("/api/persistent-agents/:id", (req, res): void => {
	try {
		const updated = agentStore.update(req.params.id, req.body)
		if (!updated) {
			res.status(404).json({ error: "Agent not found" })
			return
		}
		// If agent is active, kill the cached instance so it picks up new config
		if (activeAgents.has(req.params.id)) {
			activeAgents.delete(req.params.id)
			log.info(`Deactivated agent ${req.params.id} due to profile update — will recreate on next message`)
		}
		res.json(updated)
	} catch (error) {
		res.status(400).json({ error: String(error) })
	}
})

/**
 * DELETE /api/persistent-agents/:id - Delete a persistent agent
 */
app.delete("/api/persistent-agents/:id", (req, res): void => {
	try {
		activeAgents.delete(req.params.id)
		const deleted = agentStore.delete(req.params.id)
		if (!deleted) {
			res.status(404).json({ error: "Agent not found" })
			return
		}
		io.emit("system-event", { type: "agent-deleted", agentId: req.params.id, timestamp: Date.now() })
		res.json({ success: true })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/persistent-agents/:id/reset - Reset agent memory (clear conversation history)
 */
app.post("/api/persistent-agents/:id/reset", (req, res): void => {
	try {
		const profile = agentStore.get(req.params.id)
		if (!profile) {
			res.status(404).json({ error: "Agent not found" })
			return
		}
		// Kill cached instance
		activeAgents.delete(req.params.id)
		// Clear memory but keep stats
		agentStore.updateMemory(req.params.id, "")
		log.info(`Reset agent memory: ${req.params.id}`)
		// Society Agent - notify open agent pages
		io.emit("agent-reset", { agentId: req.params.id, timestamp: Date.now() })
		res.json({ success: true, message: `Agent ${profile.name} memory cleared` })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})
// Society Agent end

// Society Agent start - project CRUD endpoints

/**
 * GET /api/projects - List all projects
 */
app.get("/api/projects", (req, res): void => {
	try {
		const projects = projectStore.getAll().map((p) => ({
			...p,
			agents: p.agents.map((a) => ({
				...a,
				isActive: activeAgents.has(`${p.id}:${a.id}`),
				historyLength: activeAgents.get(`${p.id}:${a.id}`)?.getHistory().length || 0,
			})),
		}))
		res.json({ projects })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * GET /api/projects/:id - Get a specific project
 */
app.get("/api/projects/:id", (req, res): void => {
	try {
		const project = projectStore.get(req.params.id)
		if (!project) {
			res.status(404).json({ error: "Project not found" })
			return
		}
		res.json({
			...project,
			agents: project.agents.map((a) => ({
				...a,
				isActive: activeAgents.has(`${req.params.id}:${a.id}`),
				historyLength: activeAgents.get(`${req.params.id}:${a.id}`)?.getHistory().length || 0,
			})),
		})
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * GET /api/projects/:id/tasks - Get task pool for a project (legacy tasks)
 */
app.get("/api/projects/:id/tasks", (req, res): void => {
	try {
		const project = projectStore.get(req.params.id)
		if (!project) {
			res.status(404).json({ error: "Project not found" })
			return
		}
		const tasks = projectStore.getTasks(req.params.id)
		const counts = {
			total: tasks.length,
			available: tasks.filter(t => t.status === "available").length,
			claimed: tasks.filter(t => t.status === "claimed").length,
			inProgress: tasks.filter(t => t.status === "in-progress").length,
			completed: tasks.filter(t => t.status === "completed").length,
			failed: tasks.filter(t => t.status === "failed").length,
			blocked: tasks.filter(t => t.status === "blocked").length,
		}
		res.json({ tasks, counts })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * GET /api/projects/:id/approvals - Get pending approval requests for a project
 */
app.get("/api/projects/:id/approvals", (req, res): void => {
	try {
		const project = projectStore.get(req.params.id)
		if (!project) {
			res.status(404).json({ error: "Project not found" })
			return
		}
		const approvals = projectStore.getAllPendingApprovals(req.params.id)
		res.json({ approvals })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/approvals/:requestId/resolve - Resolve an approval request
 */
app.post("/api/approvals/:requestId/resolve", (req, res): void => {
	try {
		const { resolution, permanent, resolvedBy } = req.body
		if (!resolution || !["approved", "denied"].includes(resolution)) {
			res.status(400).json({ error: "Invalid resolution. Must be 'approved' or 'denied'" })
			return
		}
		const result = projectStore.resolveApproval(
			req.params.requestId,
			resolution,
			permanent === true,
			resolvedBy || "human"
		)
		if (!result) {
			res.status(404).json({ error: "Approval request not found" })
			return
		}
		io.emit("approval-resolved", { requestId: req.params.requestId, resolution })
		res.json({ success: true, approval: result })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects/:id/tasks/:taskId/reset - Reset a single task (return to pool)
 */
app.post("/api/projects/:id/tasks/:taskId/reset", (req, res): void => {
	try {
		const project = projectStore.get(req.params.id)
		if (!project) {
			res.status(404).json({ error: "Project not found" })
			return
		}
		const task = project.tasks?.find(t => t.id === req.params.taskId)
		if (!task) {
			res.status(404).json({ error: "Task not found" })
			return
		}
		// Reset task to available
		task.status = "available"
		task.claimedBy = undefined
		task.claimedAt = undefined
		task.error = "Reset by supervisor"
		projectStore.save()
		
		io.emit("task-reset", { 
			projectId: req.params.id, 
			taskId: req.params.taskId,
			taskTitle: task.title,
			timestamp: Date.now()
		})
		res.json({ success: true, task })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * DELETE /api/projects/:id/tasks/:taskId - Delete a task from the pool
 */
app.delete("/api/projects/:id/tasks/:taskId", (req, res): void => {
	try {
		const project = projectStore.get(req.params.id)
		if (!project) {
			res.status(404).json({ error: "Project not found" })
			return
		}
		const taskIndex = project.tasks?.findIndex(t => t.id === req.params.taskId)
		if (taskIndex === undefined || taskIndex === -1) {
			res.status(404).json({ error: "Task not found" })
			return
		}
		const task = project.tasks![taskIndex]
		project.tasks!.splice(taskIndex, 1)
		projectStore.save()
		
		io.emit("task-deleted", { 
			projectId: req.params.id, 
			taskId: req.params.taskId,
			taskTitle: task.title,
			timestamp: Date.now()
		})
		res.json({ success: true })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * GET /api/projects/:id/diagnostics - Return live diagnostics from background watchers.
 * Falls back to on-demand tsc if no watcher has collected data yet.
 */
app.get("/api/projects/:id/diagnostics", async (req, res): Promise<void> => {
	try {
		const project = projectStore.get(req.params.id)
		if (!project) {
			res.status(404).json({ error: "Project not found" })
			return
		}

		// Ensure watcher is running (idempotent)
		diagnosticsWatcher.startProject(project.id, project.folder || project.id)

		// Return current in-memory diagnostics from watcher
		const result = diagnosticsWatcher.getDiagnostics(project.id)
		res.json(result)
	} catch (err: any) {
		res.status(500).json({ error: err.message })
	}
})

/**
 * POST /api/projects/:id/diagnostics/refresh - Force-refresh diagnostics by
 * stopping and restarting the watchers for this project.
 */
app.post("/api/projects/:id/diagnostics/refresh", (req, res): void => {
	try {
		const project = projectStore.get(req.params.id)
		if (!project) {
			res.status(404).json({ error: "Project not found" })
			return
		}
		diagnosticsWatcher.stopProject(project.id)
		diagnosticsWatcher.startProject(project.id, project.folder || project.id)
		res.json({ success: true, message: "Watchers restarted" })
	} catch (err: any) {
		res.status(500).json({ error: err.message })
	}
})

// Society Agent start - per-agent activity log endpoint
/**
 * GET /api/projects/:id/agents/:agentId/activity?last=200
 * Returns the last N activity log events for an agent.
 */
app.get("/api/projects/:id/agents/:agentId/activity", (req, res): void => {
	try {
		const project = projectStore.get(req.params.id)
		if (!project) {
			res.status(404).json({ error: "Project not found" })
			return
		}
		const agentConfig = project.agents.find(a => a.id === req.params.agentId)
		if (!agentConfig) {
			res.status(404).json({ error: "Agent not found" })
			return
		}
		const last = Math.min(parseInt(req.query.last as string) || 200, 2000)
		const events = agentActivityLogger.readLog(project.folder, agentConfig.homeFolder || "/", req.params.agentId, last)
		res.json({ agentId: req.params.agentId, projectId: project.id, events, count: events.length })
	} catch (err: any) {
		res.status(500).json({ error: err.message })
	}
})
/**
 * DELETE /api/projects/:id/agents/:agentId/activity
 * Clears (truncates) the activity log file for an agent.
 */
app.delete("/api/projects/:id/agents/:agentId/activity", (req, res): void => {
	try {
		const project = projectStore.get(req.params.id)
		if (!project) { res.status(404).json({ error: "Project not found" }); return }
		const agentConfig = project.agents.find(a => a.id === req.params.agentId)
		if (!agentConfig) { res.status(404).json({ error: "Agent not found" }); return }
		const existed = agentActivityLogger.clearLog(project.folder, agentConfig.homeFolder || "/", req.params.agentId)
		res.json({ cleared: true, existed })
	} catch (err: any) {
		res.status(500).json({ error: err.message })
	}
})
// Society Agent end

/**
 * GET /api/projects/:id/git/log - Get git commit history for a project
 */
app.get("/api/projects/:id/git/log", (req, res): void => {
	try {
		const project = projectStore.get(req.params.id)
		if (!project) {
			res.status(404).json({ error: "Project not found" })
			return
		}
		
		const gitLoader = getGitLoader()
		if (!gitLoader) {
			res.status(500).json({ error: "Git loader not initialized" })
			return
		}
		
		const limit = parseInt(req.query.limit as string) || 50
		const branch = req.query.branch as string | undefined
		
		const result = gitLoader.getLog(req.params.id, { limit, branch })
		res.json(result)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects - Create a new project
 * Body: { id, name, description, folder?, agents?: [...] }
 */
app.post("/api/projects", (req, res): void => {
	try {
		const { id, name, description, folder, knowledge, agents } = req.body
		if (!id || !name) {
			res.status(400).json({ error: "id and name are required" })
			return
		}
		
		// Society Agent start - Auto-create Main Supervisor if no agents provided
		let projectAgents = agents
		if (!agents || agents.length === 0) {
			const supervisorId = id  // Society Agent - use project id so each supervisor has a globally unique agent ID
			projectAgents = [{
				id: supervisorId,
				name: "Main Supervisor",
				role: "Project Supervisor - coordinates work, delegates to workers, or works solo on simple tasks",
				systemPrompt: buildFullSystemPrompt(`You are the Main Supervisor for project "${name}".

## QUICK TASKS - DO THEM DIRECTLY!
For simple operational requests, act immediately without over-analyzing:
- "Run the servers" → Just run them (cd backend && npm start, cd frontend && npm run dev)
- "Stop the servers" → Kill the processes
- "Install dependencies" → npm install in each directory
- "Check status" → quick ls or ps command
- "Fix this error" → Read the error, fix the file, done

**DON'T** spend 15 steps checking every file when user just wants you to run something!

## PORT CONFLICTS - CHECK BEFORE KILLING
If you get "EADDRINUSE" (port already in use):
1. First check what's on that port: \`get_processes({ port: PORT })\`
2. If it's YOUR project's process, kill it: \`kill_process({ port: PORT })\`
3. If it's something else, ASK THE USER before killing or use a different port

**IMPORTANT:** Some ports are protected and cannot be killed:
- Port 4000 is ALWAYS protected (Society Agent system server)
- User can protect additional ports via PROTECTED_PORTS env var
- Never use \`fuser -k\` or \`pkill node\` - use kill_process({ port }) which has safety checks

## First Steps - READ DOCUMENTATION FIRST (for NEW projects only)
1. Use \`read_project_file("AGENTS.md")\` to read project documentation (if it exists)
2. Also check for README.md or other docs in the project root
3. Use \`list_files()\` to see what's in your folder
4. Use your mind tools to maintain your own knowledge:
   - \`read_file()\` - read files in your folder
   - \`write_file()\` - save notes, decisions, learnings
   - \`read_project_file()\` - read files from project root or other agents' folders
   - Create whatever files help you stay organized

## CRITICAL: ALWAYS INSTALL DEPENDENCIES FIRST!
**Before running ANY program:**
1. Check if package.json exists → run \`npm install\` or \`pnpm install\`
2. Check if requirements.txt exists → run \`pip install -r requirements.txt\`
3. Check if pyproject.toml exists → run \`pip install -e .\` or \`poetry install\`
4. Check if Gemfile exists → run \`bundle install\`
5. Check if go.mod exists → run \`go mod download\`

**NEVER try to run a program before installing its dependencies!**
This is the #1 cause of failures. Install first, run second.

## Your Workflow (for COMPLEX tasks only)
1. Read existing documentation to understand the project
2. Analyze the user's request and break it down into concrete tasks
3. Create ALL tasks in the pool using create_task()
4. **Decide how many workers to spawn** based on:
   - Number of independent tasks (tasks that can run in parallel)
   - Task dependencies (don't over-spawn if tasks must run sequentially)
   - Typical: 1 worker per 1-2 independent tasks, max 3
5. Spawn the workers with spawn_worker(count)
6. Monitor progress with get_worker_status and list_tasks
7. When all tasks complete, report summary to user
8. **Update your knowledge files** with what you learned

## Task Pool System
- Use \`create_task()\` to add tasks - include:
  - title: What to do
  - description: Detailed requirements  
  - working_directory: Where to create files (e.g., "${folder}/src")
  - output_paths: Expected files to create
  - conventions: Code style, patterns to follow
  - priority: 1-100 (lower = runs first, higher = runs later)
- Use \`spawn_worker(count)\` to create ephemeral workers
- Workers automatically claim tasks, execute them, and self-destruct
- Use \`list_tasks()\` to see task status
- Use \`get_worker_status()\` to monitor workers

## 📋 DELEGATION WITH DETAILED SPECS - MANDATORY!
When delegating to sub-agents, you MUST provide detailed specifications:

**Required for every delegate_task call:**
1. **task** - Clear task title/summary
2. **desired_state** - EXACTLY what should exist when done (files, behavior, outputs)
3. **acceptance_criteria** - Specific checkable items to verify completion
4. **constraints** - What NOT to do, boundaries
5. **context** - Why this matters, how it fits the project

**Example delegation:**
\`\`\`
delegate_task({
  agent_id: "backend-dev",
  task: "Create REST API for user authentication",
  desired_state: "A working /api/auth endpoint with login, logout, and register routes. JWT tokens for sessions. Password hashing with bcrypt. Returns proper HTTP status codes.",
  acceptance_criteria: [
    "POST /api/auth/register creates user and returns 201",
    "POST /api/auth/login returns JWT token",
    "Protected routes return 401 without valid token",
    "Passwords are hashed, never stored plain"
  ],
  constraints: [
    "Don't modify existing routes",
    "Use existing database connection",
    "No third-party auth providers"
  ],
  context: "This is the foundation for all user features. Other agents will build on this."
})
\`\`\`

**Sub-agents will:**
- Receive the full specs
- Have specs saved to their DESIRED_STATE.md
- Work autonomously to achieve the desired state
- Report back using \`report_to_supervisor\` tool
- Ask questions if blocked or need clarification

**You should:**
- Monitor agent reports (watch for "agent-report" events)
- Answer questions when agents are blocked
- Verify completed work meets acceptance criteria

## Deciding Worker Count
Think about parallelism:
- 1 task → 1 worker
- 2-3 independent tasks → 2 workers  
- 4+ independent tasks → 3 workers (max)
- Sequential/dependent tasks → fewer workers (tasks will queue)

Example: "Build a todo app" = 2 independent tasks (backend + frontend) → spawn 2 workers

## Important Guidelines
- Create ALL tasks FIRST, then spawn workers
- Tasks with lower priority numbers run first
- After spawning workers, KEEP CHECKING list_tasks until all show "completed"
- Only report to user when EVERYTHING is done
- If a task fails, you can create a new task to fix it

## For Simple Tasks
If the request is trivial (single file, quick fix), do it yourself:
- Use write_file/read_file/patch_file directly
- No need to spawn workers for small jobs
- **Still install dependencies before running any code!**

## Mind Tools - CREATE KNOWLEDGE FILES!
You have tools to maintain your own knowledge across sessions:
- \`read_file(path)\` - read any file in your folder
- \`write_file(path, content)\` - save files (notes, plans, learnings)
- \`list_files(path)\` - see what exists

**ALWAYS create knowledge files when you learn something!**
Examples:
- Learned how to start the servers? → write_file("HOW_TO_START.md", "cd backend && npm start\\ncd frontend && npm run dev")
- Found the project structure? → write_file("PROJECT_STRUCTURE.md", "...")
- Figured out a bug fix? → write_file("FIXES.md", "...")
- Made an important decision? → write_file("DECISIONS.md", "...")

This way you (and future sessions) don't have to re-learn everything!`),
				homeFolder: "/", // Society Agent - supervisor works in project root, not subfolder
			}]
			log.info(`[Project] Auto-created Main Supervisor for project "${name}"`)
		}
		// Society Agent end
		
		const project = projectStore.create({ id, name, description: description || "", folder, knowledge, agents: projectAgents })
		io.emit("system-event", { type: "project-created", projectId: id, name, timestamp: Date.now() })
		// Society Agent - start diagnostics watchers for new project
		diagnosticsWatcher.startProject(id, folder || id)
		res.status(201).json(project)
	} catch (error) {
		res.status(400).json({ error: String(error) })
	}
})

/**
 * PUT /api/projects/:id - Update project metadata
 */
app.put("/api/projects/:id", (req, res): void => {
	try {
		const updated = projectStore.update(req.params.id, req.body)
		if (!updated) {
			res.status(404).json({ error: "Project not found" })
			return
		}
		res.json(updated)
	} catch (error) {
		res.status(400).json({ error: String(error) })
	}
})

/**
 * DELETE /api/projects/:id - Delete a project
 */
app.delete("/api/projects/:id", (req, res): void => {
	try {
		const project = projectStore.get(req.params.id)
		if (project) {
			for (const a of project.agents) activeAgents.delete(`${req.params.id}:${a.id}`)
			// Society Agent - stop diagnostics watchers
			diagnosticsWatcher.stopProject(req.params.id)
		}
		const deleted = projectStore.delete(req.params.id)
		if (!deleted) {
			res.status(404).json({ error: "Project not found" })
			return
		}
		io.emit("system-event", { type: "project-deleted", projectId: req.params.id, timestamp: Date.now() })
		res.json({ success: true })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects/:id/bootstrap - Bootstrap an existing project
 * Scans the project and generates FILES.md, PLAN.md, AGENTS.md
 * Body: { ownerAgentId?, overwrite?, scanTasks?, analyzeGit? }
 */
app.post("/api/projects/:id/bootstrap", async (req, res): Promise<void> => {
	try {
		const project = projectStore.get(req.params.id)
		if (!project) {
			res.status(404).json({ error: "Project not found" })
			return
		}

		const projectRoot = projectStore.projectDir(project.id)
		const {
			ownerAgentId = project.agents[0]?.id ?? "architect",
			overwrite = false,
			scanTasks = true,
			analyzeGit = true,
		} = req.body

		log.info(`[Bootstrap] Starting bootstrap for project ${project.id}`)

		// Run bootstrap analysis
		const result = await bootstrapExistingProject(projectRoot, {
			ownerAgentId,
			projectName: project.name,
			scanTasks,
			analyzeGit,
		})

		// Write files to disk
		const { written, skipped } = await writeBootstrapFiles(projectRoot, result, { overwrite })

		log.info(`[Bootstrap] Complete: wrote ${written.length} files, skipped ${skipped.length}`)

		// If PLAN.md was skipped but we have detected tasks, append them via sync
		let tasksAddedToPlan = 0
		if (skipped.includes("PLAN.md") && result.detectedTasks.length > 0) {
			log.info(`[Bootstrap] PLAN.md exists, appending ${result.detectedTasks.length} detected tasks via sync`)
			const syncResult = await syncBootstrapFiles(projectRoot, {
				tasksToAdd: result.detectedTasks,
				scanNewTasks: false,
			})
			tasksAddedToPlan = syncResult.tasksAdded.length
			log.info(`[Bootstrap] Added ${tasksAddedToPlan} tasks to existing PLAN.md`)
		}

		// Invalidate project config cache so prompts pick up new config
		projectConfigCache.delete(projectRoot)

		res.json({
			success: true,
			language: result.config.language,
			framework: result.config.framework,
			stats: result.stats,
			detectedTasks: result.detectedTasks.slice(0, 30).map(t => ({
				type: t.type,
				file: t.file,
				line: t.line,
				text: t.text.slice(0, 100),
				priority: t.priority,
			})),
			detectedTasksCount: result.detectedTasks.length,
			tasksAddedToPlan,
			gitSummary: result.gitSummary,
			filesWritten: written,
			filesSkipped: skipped,
		})
	} catch (error) {
		log.error(`[Bootstrap] Error: ${error}`)
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects/:id/sync - Sync existing FILES.md/PLAN.md with filesystem
 * Use this when files were added/removed outside Society Agent
 * Body: { newFileOwner?, scanNewTasks?, preserveRemovedFiles?, addOnly? }
 */
app.post("/api/projects/:id/sync", async (req, res): Promise<void> => {
	try {
		const project = projectStore.get(req.params.id)
		if (!project) {
			res.status(404).json({ error: "Project not found" })
			return
		}

		const projectRoot = projectStore.projectDir(project.id)
		const {
			subPath, // Optional: sync a specific subfolder (e.g., agent folder)
			newFileOwner = "unassigned",
			scanNewTasks = true,
			preserveRemovedFiles = true,
			addOnly = false,
		} = req.body

		const targetPath = subPath ? path.join(projectRoot, subPath) : projectRoot

		log.info(`[Sync] Starting sync for ${targetPath}`)

		const result = await syncBootstrapFiles(targetPath, {
			newFileOwner,
			scanNewTasks,
			preserveRemovedFiles,
			addOnly,
		})

		log.info(`[Sync] Complete: +${result.filesAdded.length} files, -${result.filesRemoved.length} files`)

		res.json({
			success: true,
			filesAdded: result.filesAdded,
			filesRemoved: result.filesRemoved,
			filesUnchanged: result.filesUnchanged,
			tasksAdded: result.tasksAdded.length,
			conflicts: result.conflicts,
		})
	} catch (error) {
		log.error(`[Sync] Error: ${error}`)
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects/:id/bootstrap/subfolder - Bootstrap a specific subfolder
 * Use to initialize an agent's folder with its own FILES.md, PLAN.md, AGENTS.md
 * Body: { subPath (required), ownerAgentId?, scanTasks?, inheritParentConfig? }
 */
app.post("/api/projects/:id/bootstrap/subfolder", async (req, res): Promise<void> => {
	try {
		const project = projectStore.get(req.params.id)
		if (!project) {
			res.status(404).json({ error: "Project not found" })
			return
		}

		const { subPath, ownerAgentId, scanTasks = true, inheritParentConfig = true, overwrite = false } = req.body

		if (!subPath) {
			res.status(400).json({ error: "subPath is required" })
			return
		}

		const projectRoot = projectStore.projectDir(project.id)
		const fullPath = path.join(projectRoot, subPath)

		log.info(`[SubfolderBootstrap] Starting for ${subPath}`)

		const result = await bootstrapSubFolder(projectRoot, subPath, {
			ownerAgentId,
			scanTasks,
			inheritParentConfig,
		})

		// Write files to the subfolder
		const { written, skipped } = await writeBootstrapFiles(fullPath, result, { overwrite })

		log.info(`[SubfolderBootstrap] Complete: wrote ${written.length} files in ${subPath}`)

		res.json({
			success: true,
			subPath,
			language: result.config.language,
			stats: result.stats,
			detectedTasks: result.detectedTasks.length,
			filesWritten: written,
			filesSkipped: skipped,
		})
	} catch (error) {
		log.error(`[SubfolderBootstrap] Error: ${error}`)
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects/:id/smart-bootstrap - Auto-detect: full bootstrap or sync
 * If no bootstrap files exist, does full bootstrap. Otherwise syncs.
 * Body: { subPath?, ownerAgentId?, scanTasks?, force? }
 */
app.post("/api/projects/:id/smart-bootstrap", async (req, res): Promise<void> => {
	try {
		const project = projectStore.get(req.params.id)
		if (!project) {
			res.status(404).json({ error: "Project not found" })
			return
		}

		const projectRoot = projectStore.projectDir(project.id)
		const {
			subPath,
			ownerAgentId = project.agents[0]?.id ?? "architect",
			scanTasks = true,
			force = false,
		} = req.body

		const targetPath = subPath ? path.join(projectRoot, subPath) : projectRoot

		log.info(`[SmartBootstrap] Starting for ${targetPath}`)

		const { mode, result } = await smartBootstrap(targetPath, {
			ownerAgentId,
			projectName: project.name,
			scanTasks,
			force,
		})

		log.info(`[SmartBootstrap] Complete: mode=${mode}`)

		if (mode === "bootstrap") {
			const bResult = result as any
			res.json({
				success: true,
				mode: "bootstrap",
				language: bResult.config?.language,
				stats: bResult.stats,
				detectedTasks: bResult.detectedTasks?.length ?? 0,
			})
		} else {
			const sResult = result as any
			res.json({
				success: true,
				mode: "sync",
				filesAdded: sResult.filesAdded?.length ?? 0,
				filesRemoved: sResult.filesRemoved?.length ?? 0,
				tasksAdded: sResult.tasksAdded?.length ?? 0,
			})
		}
	} catch (error) {
		log.error(`[SmartBootstrap] Error: ${error}`)
		res.status(500).json({ error: String(error) })
	}
})

/**
 * GET /api/projects/:id/bootstrap-status - Check if bootstrap files exist
 */
app.get("/api/projects/:id/bootstrap-status", async (req, res): Promise<void> => {
	try {
		const project = projectStore.get(req.params.id)
		if (!project) {
			res.status(404).json({ error: "Project not found" })
			return
		}

		const projectRoot = projectStore.projectDir(project.id)
		const { subPath } = req.query
		const targetPath = subPath ? path.join(projectRoot, String(subPath)) : projectRoot

		const status = await hasBootstrapFiles(targetPath)

		res.json({
			path: subPath || "/",
			...status,
			bootstrapped: status.hasFiles || status.hasPlan,
		})
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

// ============================================================================
// MANAGED TASKS API - Stable IDs & State Machine (Proposals 1, 2)
// ============================================================================

/**
 * POST /api/projects/:id/managed-tasks - Create a managed task with stable ID
 * Body: { title, description, createdBy, priority?, parentTaskId?, dependsOn?, context?, prefixOverride? }
 */
app.post("/api/projects/:id/managed-tasks", (req, res): void => {
	try {
		const { title, description, createdBy, priority, parentTaskId, dependsOn, context, prefixOverride } = req.body
		
		if (!title || !description || !createdBy) {
			res.status(400).json({ error: "title, description, and createdBy are required" })
			return
		}

		const task = projectStore.createManagedTask(req.params.id, {
			title,
			description,
			createdBy,
			priority,
			parentTaskId,
			dependsOn,
			context,
			prefixOverride,
		})

		if (!task) {
			res.status(404).json({ error: "Project not found" })
			return
		}

		res.json(task)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * GET /api/projects/:id/managed-tasks - Get all managed tasks
 * Query: ?status=in_progress,blocked&assignedTo=agentId
 */
app.get("/api/projects/:id/managed-tasks", (req, res): void => {
	try {
		let tasks = projectStore.getManagedTasks(req.params.id)
		
		// Filter by status if provided
		if (req.query.status) {
			const statuses = String(req.query.status).split(",")
			tasks = tasks.filter(t => statuses.includes(t.status))
		}
		
		// Filter by assignee if provided
		if (req.query.assignedTo) {
			tasks = tasks.filter(t => t.assignedTo === req.query.assignedTo)
		}
		
		// Filter by createdBy if provided
		if (req.query.createdBy) {
			tasks = tasks.filter(t => t.createdBy === req.query.createdBy)
		}

		res.json(tasks)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * GET /api/projects/:id/managed-tasks/:taskId - Get a specific managed task
 */
app.get("/api/projects/:id/managed-tasks/:taskId", (req, res): void => {
	try {
		const task = projectStore.getManagedTask(req.params.id, req.params.taskId)
		if (!task) {
			res.status(404).json({ error: "Task not found" })
			return
		}
		res.json(task)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects/:id/managed-tasks/:taskId/transition - Transition task status
 * Body: { status, agentId, reason?, metadata? }
 */
app.post("/api/projects/:id/managed-tasks/:taskId/transition", (req, res): void => {
	try {
		const { status, agentId, reason, metadata } = req.body
		
		if (!status || !agentId) {
			res.status(400).json({ error: "status and agentId are required" })
			return
		}

		const task = projectStore.transitionManagedTask(
			req.params.id,
			req.params.taskId,
			status,
			agentId,
			{ reason, metadata }
		)

		if (!task) {
			res.status(400).json({ error: "Task not found or invalid transition" })
			return
		}

		res.json(task)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects/:id/managed-tasks/:taskId/delegate - Delegate task to agent
 * Body: { toAgentId, byAgentId }
 */
app.post("/api/projects/:id/managed-tasks/:taskId/delegate", (req, res): void => {
	try {
		const { toAgentId, byAgentId } = req.body
		
		if (!toAgentId || !byAgentId) {
			res.status(400).json({ error: "toAgentId and byAgentId are required" })
			return
		}

		const task = projectStore.delegateManagedTask(req.params.id, req.params.taskId, toAgentId, byAgentId)

		if (!task) {
			res.status(400).json({ error: "Task not found or cannot be delegated" })
			return
		}

		res.json(task)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects/:id/managed-tasks/:taskId/accept - Accept a delegated task
 * Body: { agentId }
 */
app.post("/api/projects/:id/managed-tasks/:taskId/accept", (req, res): void => {
	try {
		const { agentId } = req.body
		
		if (!agentId) {
			res.status(400).json({ error: "agentId is required" })
			return
		}

		const task = projectStore.acceptManagedTask(req.params.id, req.params.taskId, agentId)

		if (!task) {
			res.status(400).json({ error: "Task not found or cannot be accepted" })
			return
		}

		res.json(task)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects/:id/managed-tasks/:taskId/block - Block a task
 * Body: { agentId, blockingReason: { type, description, blockedByTaskId?, question?, unblockRequires? } }
 */
app.post("/api/projects/:id/managed-tasks/:taskId/block", (req, res): void => {
	try {
		const { agentId, blockingReason } = req.body
		
		if (!agentId || !blockingReason?.type || !blockingReason?.description) {
			res.status(400).json({ error: "agentId and blockingReason (with type and description) are required" })
			return
		}

		const task = projectStore.blockManagedTask(req.params.id, req.params.taskId, agentId, {
			...blockingReason,
			since: new Date().toISOString(),
		})

		if (!task) {
			res.status(400).json({ error: "Task not found or cannot be blocked" })
			return
		}

		io.emit("task-blocked", { projectId: req.params.id, taskId: req.params.taskId, reason: blockingReason.type })
		res.json(task)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects/:id/managed-tasks/:taskId/unblock - Unblock a task
 * Body: { agentId, resolution }
 */
app.post("/api/projects/:id/managed-tasks/:taskId/unblock", (req, res): void => {
	try {
		const { agentId, resolution } = req.body
		
		if (!agentId || !resolution) {
			res.status(400).json({ error: "agentId and resolution are required" })
			return
		}

		const task = projectStore.unblockManagedTask(req.params.id, req.params.taskId, agentId, resolution)

		if (!task) {
			res.status(400).json({ error: "Task not found or cannot be unblocked" })
			return
		}

		io.emit("task-unblocked", { projectId: req.params.id, taskId: req.params.taskId })
		res.json(task)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects/:id/managed-tasks/:taskId/submit-review - Submit task for review
 * Body: { agentId, result: { filesCreated?, filesModified?, commitHash?, summary } }
 */
app.post("/api/projects/:id/managed-tasks/:taskId/submit-review", (req, res): void => {
	try {
		const { agentId, result } = req.body
		
		if (!agentId || !result?.summary) {
			res.status(400).json({ error: "agentId and result.summary are required" })
			return
		}

		const task = projectStore.submitManagedTaskForReview(req.params.id, req.params.taskId, agentId, result)

		if (!task) {
			res.status(400).json({ error: "Task not found or cannot be submitted for review" })
			return
		}

		res.json(task)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects/:id/managed-tasks/:taskId/approve - Approve task after review
 * Body: { reviewerAgentId }
 */
app.post("/api/projects/:id/managed-tasks/:taskId/approve", (req, res): void => {
	try {
		const { reviewerAgentId } = req.body
		
		if (!reviewerAgentId) {
			res.status(400).json({ error: "reviewerAgentId is required" })
			return
		}

		const task = projectStore.approveManagedTask(req.params.id, req.params.taskId, reviewerAgentId)

		if (!task) {
			res.status(400).json({ error: "Task not found or cannot be approved" })
			return
		}

		res.json(task)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects/:id/managed-tasks/:taskId/verify - Run verification and verify task
 * Body: { agentId, quickMode? }
 */
app.post("/api/projects/:id/managed-tasks/:taskId/verify", async (req, res): Promise<void> => {
	try {
		const { agentId, quickMode } = req.body
		
		if (!agentId) {
			res.status(400).json({ error: "agentId is required" })
			return
		}

		// Run verification
		const verification = await projectStore.runTaskVerification(req.params.id, req.params.taskId, { quickMode })
		if (!verification) {
			res.status(404).json({ error: "Task not found" })
			return
		}

		// If verification passed, mark as verified
		if (verification.allPassed) {
			const task = await projectStore.verifyManagedTask(req.params.id, req.params.taskId, agentId, verification)
			if (task) {
				res.json({ task, verification })
				return
			}
		}

		// Return verification result even if not passed
		res.json({ verification, message: verification.allPassed ? "Verified" : "Verification failed" })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * GET /api/projects/:id/managed-tasks/startable - Get tasks ready to start
 */
app.get("/api/projects/:id/managed-tasks/startable", (req, res): void => {
	try {
		const tasks = projectStore.getStartableTasks(req.params.id)
		res.json(tasks)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * GET /api/projects/:id/managed-tasks/blocked - Get blocked tasks with reasons
 */
app.get("/api/projects/:id/managed-tasks/blocked", (req, res): void => {
	try {
		const blocked = projectStore.getBlockedTasks(req.params.id)
		res.json(blocked)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects/:id/update-plan - Regenerate PLAN.md from managed tasks
 */
app.post("/api/projects/:id/update-plan", async (req, res): Promise<void> => {
	try {
		await projectStore.updateProjectPlan(req.params.id)
		res.json({ success: true })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

// ============================================================================
// FILE OWNERSHIP API (Proposal 4)
// ============================================================================

/**
 * GET /api/projects/:id/files/check - Check if agent can modify a file
 * Query: ?agentId=xxx&path=src/file.ts
 */
app.get("/api/projects/:id/files/check", async (req, res): Promise<void> => {
	try {
		const { agentId, path: filePath } = req.query
		
		if (!agentId || !filePath) {
			res.status(400).json({ error: "agentId and path query parameters are required" })
			return
		}

		const result = await projectStore.checkFileAccess(req.params.id, String(agentId), String(filePath))
		res.json(result)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects/:id/files/register - Register file ownership
 * Body: { filePath, owner, description?, taskId? }
 */
app.post("/api/projects/:id/files/register", async (req, res): Promise<void> => {
	try {
		const { filePath, owner, description, taskId } = req.body
		
		if (!filePath || !owner) {
			res.status(400).json({ error: "filePath and owner are required" })
			return
		}

		const ownership = await projectStore.registerFile(req.params.id, filePath, owner, { description, taskId })

		if (!ownership) {
			res.status(404).json({ error: "Project not found" })
			return
		}

		res.json(ownership)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects/:id/files/register-batch - Register multiple files
 * Body: { filePaths: string[], owner, taskId? }
 */
app.post("/api/projects/:id/files/register-batch", async (req, res): Promise<void> => {
	try {
		const { filePaths, owner, taskId } = req.body
		
		if (!filePaths?.length || !owner) {
			res.status(400).json({ error: "filePaths (array) and owner are required" })
			return
		}

		const ownerships = await projectStore.registerFiles(req.params.id, filePaths, owner, taskId)
		res.json({ registered: ownerships.length, files: ownerships })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * GET /api/projects/:id/files/owned - Get files owned by an agent
 * Query: ?agentId=xxx
 */
app.get("/api/projects/:id/files/owned", async (req, res): Promise<void> => {
	try {
		const { agentId } = req.query
		
		if (!agentId) {
			res.status(400).json({ error: "agentId query parameter is required" })
			return
		}

		const files = await projectStore.getAgentFiles(req.params.id, String(agentId))
		res.json(files)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects/:id/files/handoff/request - Request file handoff
 * Body: { filePath, toAgentId, reason, taskId? }
 */
app.post("/api/projects/:id/files/handoff/request", async (req, res): Promise<void> => {
	try {
		const { filePath, toAgentId, reason, taskId } = req.body
		
		if (!filePath || !toAgentId || !reason) {
			res.status(400).json({ error: "filePath, toAgentId, and reason are required" })
			return
		}

		const handoff = await projectStore.requestFileHandoff(req.params.id, filePath, toAgentId, reason, taskId)

		if (!handoff) {
			res.status(400).json({ error: "File not registered or project not found" })
			return
		}

		res.json(handoff)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects/:id/files/handoff/:handoffId/approve - Approve handoff
 * Body: { approverId }
 */
app.post("/api/projects/:id/files/handoff/:handoffId/approve", async (req, res): Promise<void> => {
	try {
		const { approverId } = req.body
		
		if (!approverId) {
			res.status(400).json({ error: "approverId is required" })
			return
		}

		const handoff = await projectStore.approveFileHandoff(req.params.id, req.params.handoffId, approverId)

		if (!handoff) {
			res.status(400).json({ error: "Handoff not found or already resolved" })
			return
		}

		res.json(handoff)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects/:id/files/handoff/:handoffId/deny - Deny handoff
 * Body: { approverId, reason }
 */
app.post("/api/projects/:id/files/handoff/:handoffId/deny", async (req, res): Promise<void> => {
	try {
		const { approverId, reason } = req.body
		
		if (!approverId || !reason) {
			res.status(400).json({ error: "approverId and reason are required" })
			return
		}

		const handoff = await projectStore.denyFileHandoff(req.params.id, req.params.handoffId, approverId, reason)

		if (!handoff) {
			res.status(400).json({ error: "Handoff not found or already resolved" })
			return
		}

		res.json(handoff)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects/:id/files/handoff/:handoffId/complete - Complete approved handoff
 */
app.post("/api/projects/:id/files/handoff/:handoffId/complete", async (req, res): Promise<void> => {
	try {
		const ownership = await projectStore.completeFileHandoff(req.params.id, req.params.handoffId)

		if (!ownership) {
			res.status(400).json({ error: "Handoff not found or not approved" })
			return
		}

		res.json(ownership)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * GET /api/projects/:id/files/handoffs/pending - Get pending handoffs for an agent
 * Query: ?agentId=xxx
 */
app.get("/api/projects/:id/files/handoffs/pending", async (req, res): Promise<void> => {
	try {
		const { agentId } = req.query
		
		if (!agentId) {
			res.status(400).json({ error: "agentId query parameter is required" })
			return
		}

		const handoffs = await projectStore.getAgentPendingHandoffs(req.params.id, String(agentId))
		res.json(handoffs)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects/:id/files/update-registry - Regenerate FILES.md
 */
app.post("/api/projects/:id/files/update-registry", async (req, res): Promise<void> => {
	try {
		await projectStore.updateFilesRegistry(req.params.id)
		res.json({ success: true })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

// ============================================================================
// PLANNING LOG API (Proposal 3)
// ============================================================================

/**
 * POST /api/projects/:id/decisions - Create a new decision
 * Body: { title, category, context, options[], chosenOptionId, decision, rationale, consequences?, relatedTasks?, relatedDecisions?, decidedBy }
 */
app.post("/api/projects/:id/decisions", async (req, res): Promise<void> => {
	try {
		const decision = await projectStore.createDecision(req.params.id, req.body)
		if (!decision) {
			res.status(404).json({ error: "Project not found" })
			return
		}
		io.emit("decision-created", { projectId: req.params.id, decision })
		res.json(decision)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects/:id/decisions/propose - Propose a decision for review
 * Body: { title, category, context, options[], recommendedOptionId?, decidedBy, relatedTasks? }
 */
app.post("/api/projects/:id/decisions/propose", async (req, res): Promise<void> => {
	try {
		const decision = await projectStore.proposeDecision(req.params.id, req.body)
		if (!decision) {
			res.status(404).json({ error: "Project not found" })
			return
		}
		io.emit("decision-created", { projectId: req.params.id, decision })
		res.json(decision)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects/:id/decisions/:decisionId/accept - Accept a proposed decision
 * Body: { chosenOptionId, decision, rationale, consequences?, acceptedBy }
 */
app.post("/api/projects/:id/decisions/:decisionId/accept", async (req, res): Promise<void> => {
	try {
		const decision = await projectStore.acceptPlanningDecision(
			req.params.id,
			req.params.decisionId,
			req.body
		)
		if (!decision) {
			res.status(404).json({ error: "Decision not found or not in proposed status" })
			return
		}
		io.emit("decision-updated", { projectId: req.params.id, decisionId: req.params.decisionId, status: "accepted", decision })
		res.json(decision)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects/:id/decisions/:decisionId/implement - Mark decision as implemented
 * Body: { implementedBy }
 */
app.post("/api/projects/:id/decisions/:decisionId/implement", async (req, res): Promise<void> => {
	try {
		const { implementedBy } = req.body
		if (!implementedBy) {
			res.status(400).json({ error: "implementedBy is required" })
			return
		}
		const decision = await projectStore.markDecisionImplemented(
			req.params.id,
			req.params.decisionId,
			implementedBy
		)
		if (!decision) {
			res.status(404).json({ error: "Decision not found or not in accepted status" })
			return
		}
		io.emit("decision-updated", { projectId: req.params.id, decisionId: req.params.decisionId, status: "implemented", decision })
		res.json(decision)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects/:id/decisions/:decisionId/supersede - Supersede with a new decision
 * Body: { title, category, context, options[], chosenOptionId, decision, rationale, ... }
 */
app.post("/api/projects/:id/decisions/:decisionId/supersede", async (req, res): Promise<void> => {
	try {
		const result = await projectStore.supersedeDecision(
			req.params.id,
			req.params.decisionId,
			req.body
		)
		if (!result) {
			res.status(404).json({ error: "Decision not found" })
			return
		}
		io.emit("decision-updated", { projectId: req.params.id, decisionId: req.params.decisionId, status: "superseded", result })
		res.json(result)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects/:id/decisions/:decisionId/reject - Reject a proposed decision
 * Body: { reason, rejectedBy }
 */
app.post("/api/projects/:id/decisions/:decisionId/reject", async (req, res): Promise<void> => {
	try {
		const { reason, rejectedBy } = req.body
		if (!reason || !rejectedBy) {
			res.status(400).json({ error: "reason and rejectedBy are required" })
			return
		}
		const decision = await projectStore.rejectDecision(
			req.params.id,
			req.params.decisionId,
			{ reason, rejectedBy }
		)
		if (!decision) {
			res.status(404).json({ error: "Decision not found or not in proposed status" })
			return
		}
		io.emit("decision-updated", { projectId: req.params.id, decisionId: req.params.decisionId, status: "rejected", decision })
		res.json(decision)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects/:id/decisions/:decisionId/defer - Defer a decision
 * Body: { reason, deferredBy, deferUntil? }
 */
app.post("/api/projects/:id/decisions/:decisionId/defer", async (req, res): Promise<void> => {
	try {
		const { reason, deferredBy, deferUntil } = req.body
		if (!reason || !deferredBy) {
			res.status(400).json({ error: "reason and deferredBy are required" })
			return
		}
		const decision = await projectStore.deferDecision(
			req.params.id,
			req.params.decisionId,
			{ reason, deferredBy, deferUntil }
		)
		if (!decision) {
			res.status(404).json({ error: "Decision not found" })
			return
		}
		io.emit("decision-updated", { projectId: req.params.id, decisionId: req.params.decisionId, status: "deferred", decision })
		res.json(decision)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * GET /api/projects/:id/decisions - Get all decisions
 * Query: ?status=accepted,implemented&category=architecture&taskId=T-001
 */
app.get("/api/projects/:id/decisions", async (req, res): Promise<void> => {
	try {
		const { status, category, taskId } = req.query

		if (taskId) {
			const decisions = await projectStore.getDecisionsForTask(req.params.id, String(taskId))
			res.json(decisions)
			return
		}

		if (status === "pending" || status === "proposed") {
			const decisions = await projectStore.getPendingDecisions(req.params.id)
			res.json(decisions)
			return
		}

		// Default: get active decisions
		const decisions = await projectStore.getActiveDecisions(req.params.id)
		res.json(decisions)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects/:id/update-planning - Regenerate PLANNING.md
 */
app.post("/api/projects/:id/update-planning", async (req, res): Promise<void> => {
	try {
		await projectStore.updatePlanningLog(req.params.id)
		res.json({ success: true })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

// ============================================================================
// SUPERVISOR OVERRIDE API (Proposal 5)
// ============================================================================

/**
 * POST /api/projects/:id/supervisor/force-unblock - Force unblock a blocked task
 * Body: { taskId, supervisorId, reason, resolution }
 */
app.post("/api/projects/:id/supervisor/force-unblock", (req, res): void => {
	try {
		const { taskId, supervisorId, reason, resolution } = req.body
		if (!taskId || !supervisorId || !reason || !resolution) {
			res.status(400).json({ error: "taskId, supervisorId, reason, and resolution are required" })
			return
		}

		const result = projectStore.supervisorForceUnblock(
			req.params.id,
			taskId,
			supervisorId,
			reason,
			resolution
		)

		if (!result) {
			res.status(400).json({ error: "Task not found or not blocked" })
			return
		}

		io.emit("supervisor-override", { projectId: req.params.id, action: "force-unblock", taskId, by: supervisorId })
		io.emit("task-unblocked", { projectId: req.params.id, taskId })
		res.json(result)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects/:id/supervisor/force-reassign - Force reassign a task
 * Body: { taskId, supervisorId, newAgentId, reason }
 */
app.post("/api/projects/:id/supervisor/force-reassign", (req, res): void => {
	try {
		const { taskId, supervisorId, newAgentId, reason } = req.body
		if (!taskId || !supervisorId || !newAgentId || !reason) {
			res.status(400).json({ error: "taskId, supervisorId, newAgentId, and reason are required" })
			return
		}

		const result = projectStore.supervisorForceReassign(
			req.params.id,
			taskId,
			supervisorId,
			newAgentId,
			reason
		)

		if (!result) {
			res.status(400).json({ error: "Task not found or cannot be reassigned" })
			return
		}

		io.emit("supervisor-override", { projectId: req.params.id, action: "force-reassign", taskId, newAgentId, by: supervisorId })
		res.json(result)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects/:id/supervisor/force-status - Force a task to a specific status
 * Body: { taskId, supervisorId, newStatus, reason }
 */
app.post("/api/projects/:id/supervisor/force-status", (req, res): void => {
	try {
		const { taskId, supervisorId, newStatus, reason } = req.body
		if (!taskId || !supervisorId || !newStatus || !reason) {
			res.status(400).json({ error: "taskId, supervisorId, newStatus, and reason are required" })
			return
		}

		const result = projectStore.supervisorForceStatus(
			req.params.id,
			taskId,
			supervisorId,
			newStatus,
			reason
		)

		if (!result) {
			res.status(400).json({ error: "Task not found" })
			return
		}

		io.emit("supervisor-override", { projectId: req.params.id, action: "force-status", taskId, newStatus, by: supervisorId })
		res.json(result)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects/:id/supervisor/force-cancel - Force cancel a task
 * Body: { taskId, supervisorId, reason }
 */
app.post("/api/projects/:id/supervisor/force-cancel", (req, res): void => {
	try {
		const { taskId, supervisorId, reason } = req.body
		if (!taskId || !supervisorId || !reason) {
			res.status(400).json({ error: "taskId, supervisorId, and reason are required" })
			return
		}

		const result = projectStore.supervisorForceCancel(
			req.params.id,
			taskId,
			supervisorId,
			reason
		)

		if (!result) {
			res.status(400).json({ error: "Task not found or cannot be cancelled" })
			return
		}

		io.emit("supervisor-override", { projectId: req.params.id, action: "force-cancel", taskId, by: supervisorId })
		res.json(result)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects/:id/supervisor/change-priority - Change task priority
 * Body: { taskId, supervisorId, newPriority (1-5: 1=critical, 5=low), reason }
 */
app.post("/api/projects/:id/supervisor/change-priority", (req, res): void => {
	try {
		const { taskId, supervisorId, newPriority, reason } = req.body
		if (!taskId || !supervisorId || newPriority === undefined || !reason) {
			res.status(400).json({ error: "taskId, supervisorId, newPriority, and reason are required" })
			return
		}

		// Validate priority is 1-5
		const priority = Number(newPriority)
		if (![1, 2, 3, 4, 5].includes(priority)) {
			res.status(400).json({ error: "newPriority must be 1 (critical) to 5 (low)" })
			return
		}

		const result = projectStore.supervisorChangePriority(
			req.params.id,
			taskId,
			supervisorId,
			priority as 1 | 2 | 3 | 4 | 5,
			reason
		)

		if (!result) {
			res.status(400).json({ error: "Task not found" })
			return
		}

		io.emit("supervisor-override", { projectId: req.params.id, action: "change-priority", taskId, newPriority: priority, by: supervisorId })
		res.json(result)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * GET /api/projects/:id/supervisor/overrides - Get all supervisor overrides
 * Query: ?taskId=T-001
 */
app.get("/api/projects/:id/supervisor/overrides", (req, res): void => {
	try {
		const { taskId } = req.query

		if (taskId) {
			const overrides = projectStore.getTaskOverrides(req.params.id, String(taskId))
			res.json(overrides)
			return
		}

		const overrides = projectStore.getSupervisorOverrides(req.params.id)
		res.json(overrides)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects/:id/agents - Add an agent to a project
 */
app.post("/api/projects/:id/agents", (req, res): void => {
	try {
		const { id, name, role, systemPrompt, customInstructions, homeFolder, model, ephemeral, reportsTo, capabilities, workspaceMode } = req.body
		if (!id || !name || !role) {
			res.status(400).json({ error: "id, name, and role are required" })
			return
		}
		
		// Generate default system prompt if not provided
		let basePrompt = systemPrompt || `You are ${name}, a ${role}.

Your responsibilities:
${capabilities?.length ? capabilities.map((c: string) => `- ${c}`).join('\n') : `- Fulfill your role as ${role}`}

Work collaboratively with other agents in the project. Use available tools to complete tasks.`
		
		// Append custom instructions if provided
		if (customInstructions) {
			basePrompt += `\n\n## Custom Instructions\n${customInstructions}`
		}
		
		const defaultPrompt = buildFullSystemPrompt(basePrompt)

		// Determine home folder - nest under parent if specified
		const project = projectStore.get(req.params.id)
		let agentHomeFolder = homeFolder
		let effectiveWorkspaceMode = workspaceMode || "isolated"
		let sharedWorkspaceWith: string | undefined
		
		if (!agentHomeFolder) {
			if (reportsTo && project) {
				const parentAgent = project.agents.find(a => a.id === reportsTo)
				const parentHome = parentAgent?.homeFolder || reportsTo
				
				// Society Agent - Shared workspace mode: use same folder as supervisor
				if (effectiveWorkspaceMode === "shared") {
					agentHomeFolder = parentHome  // Same folder as supervisor!
					sharedWorkspaceWith = reportsTo
					log.info(`[API] Agent ${id} will share workspace with supervisor ${reportsTo} at ${parentHome}`)
				} else {
					// Standard isolated mode - nest under parent
					agentHomeFolder = parentHome === "/" ? id : `${parentHome}/${id}`
				}
			} else {
				agentHomeFolder = id
			}
		}

		const agent = projectStore.addAgent(req.params.id, {
			id, name, role,
			systemPrompt: defaultPrompt,
			customInstructions,  // Store separately for editing
			homeFolder: agentHomeFolder,
			model,
			ephemeral: ephemeral || false,
			reportsTo,
			workspaceMode: effectiveWorkspaceMode,
			sharedWorkspaceWith,
		})
		if (!agent) {
			res.status(404).json({ error: "Project not found" })
			return
		}
		
		// Society Agent - Set up shared workspace if workspaceMode is "shared"
		if (effectiveWorkspaceMode === "shared" && reportsTo && project) {
			const wsRegistry = getProjectSharedWorkspaces(req.params.id)
			try {
				createSharedWorkspace(wsRegistry, agentHomeFolder, reportsTo, id)
				log.info(`[API] Created shared workspace: ${agentHomeFolder} (${reportsTo} ↔ ${id})`)
			} catch (err: any) {
				// Workspace might already exist - that's OK
				log.debug(`[API] Shared workspace may already exist: ${err.message}`)
			}
		}
		
		// Create the agent's home directory
		const projectFolder = project?.folder || req.params.id
		const agentDir = path.join(projectStore.projectsBaseDir, projectFolder, agentHomeFolder)
		if (!fs.existsSync(agentDir)) {
			fs.mkdirSync(agentDir, { recursive: true })
			log.info(`[API] Created directory for new agent: ${agentDir}`)
		}
		
		io.emit("system-event", { type: "agent-added", projectId: req.params.id, agentId: id, timestamp: Date.now() })
		res.status(201).json(agent)
	} catch (error) {
		res.status(400).json({ error: String(error) })
	}
})

/**
 * PUT /api/projects/:projectId/agents/:agentId - Update an agent within a project
 */
app.put("/api/projects/:projectId/agents/:agentId", (req, res): void => {
	try {
		const updates = { ...req.body }
		
		// If customInstructions changed, regenerate the system prompt
		if (updates.customInstructions !== undefined) {
			const agent = projectStore.getAgent(req.params.projectId, req.params.agentId)
			if (agent) {
				const name = updates.name || agent.name
				const role = updates.role || agent.role
				let basePrompt = `You are ${name}, a ${role}.

Your responsibilities:
- Fulfill your role as ${role}

Work collaboratively with other agents in the project. Use available tools to complete tasks.`
				
				if (updates.customInstructions) {
					basePrompt += `\n\n## Custom Instructions\n${updates.customInstructions}`
				}
				
				updates.systemPrompt = buildFullSystemPrompt(basePrompt)
			}
		}
		
		const updated = projectStore.updateAgent(req.params.projectId, req.params.agentId, updates)
		if (!updated) {
			res.status(404).json({ error: "Project or agent not found" })
			return
		}
		const cacheKey = `${req.params.projectId}:${req.params.agentId}`
		if (activeAgents.has(cacheKey)) {
			activeAgents.delete(cacheKey)
		}
		res.json(updated)
	} catch (error) {
		res.status(400).json({ error: String(error) })
	}
})

/**
 * DELETE /api/projects/:projectId/agents/:agentId - Remove agent from project
 */
app.delete("/api/projects/:projectId/agents/:agentId", (req, res): void => {
	try {
		activeAgents.delete(`${req.params.projectId}:${req.params.agentId}`)
		const removed = projectStore.removeAgent(req.params.projectId, req.params.agentId)
		if (!removed) {
			res.status(404).json({ error: "Project or agent not found" })
			return
		}
		io.emit("system-event", { type: "agent-removed", projectId: req.params.projectId, agentId: req.params.agentId, timestamp: Date.now() })
		res.json({ success: true })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/projects/:projectId/agents/:agentId/reset - Reset agent memory
 */
app.post("/api/projects/:projectId/agents/:agentId/reset", (req, res): void => {
	try {
		const agent = projectStore.getAgent(req.params.projectId, req.params.agentId)
		if (!agent) {
			res.status(404).json({ error: "Project or agent not found" })
			return
		}
		activeAgents.delete(`${req.params.projectId}:${req.params.agentId}`)
		projectStore.resetAgentMemory(req.params.projectId, req.params.agentId)
		// Society Agent - notify open agent pages
		io.emit("agent-reset", { agentId: req.params.agentId, projectId: req.params.projectId, timestamp: Date.now() })
		res.json({ success: true, message: `Agent ${agent.name} memory cleared` })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

// Society Agent end

// Society Agent start - agent chat history endpoint
/**
 * GET /api/agent/:agentId/history - Get conversation history for an agent
 * Returns messages from the live agent (if cached), or loads from persisted disk file.
 */
app.get("/api/agent/:agentId/history", async (req, res): Promise<void> => {
	try {
		const { agentId } = req.params
		const projectId = req.query.projectId as string | undefined

		// Try bare key first (legacy/persistent agents), then composite key (project agents)
		const found = projectStore.findAgentProject(agentId, projectId)
		const compositeKey = found ? `${found.project.id}:${agentId}` : null
		const agent = activeAgents.get(agentId) || (compositeKey ? activeAgents.get(compositeKey) : undefined)

		if (agent) {
			res.json({
				messages: agent.getHistory(),
				summary: agent.getSummary(),
				memorySummary: "",
				active: true,
			})
			return
		}

		// Agent not in memory — try to load from persisted disk history
		const memorySummary = found?.agent.memorySummary || agentStore.get(agentId)?.memorySummary || ""
		if (found) {
			const agentWorkspace = projectStore.agentHomeDir(found.project.id, agentId)
			const historyFile = path.join(agentWorkspace, ".history", `${agentId}.json`)
			try {
				const raw = await fs.promises.readFile(historyFile, "utf-8")
				const parsed = JSON.parse(raw)
				res.json({
					messages: parsed.messages || [],
					summary: parsed.summary || "",
					memorySummary,
					active: false,
				})
				return
			} catch (fileErr: any) {
				if (fileErr.code !== "ENOENT") {
					log.warn(`Failed to read persisted history for ${agentId}: ${fileErr}`)
				}
			}
		} else {
			// Legacy persistent agent — try legacy path
			const legacyProfile = agentStore.get(agentId)
			if (legacyProfile) {
				const agentWorkspace = path.join(getWorkspacePath(), "projects", (legacyProfile as any).workspaceFolder || agentId)
				const historyFile = path.join(agentWorkspace, ".history", `${agentId}.json`)
				try {
					const raw = await fs.promises.readFile(historyFile, "utf-8")
					const parsed = JSON.parse(raw)
					res.json({
						messages: parsed.messages || [],
						summary: parsed.summary || "",
						memorySummary,
						active: false,
					})
					return
				} catch { /* ignore */ }
			}
		}

		// No persisted history found
		res.json({ messages: [], summary: "", memorySummary, active: false })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * DELETE /api/agent/:agentId/history - Clear conversation history for an agent
 * Clears in-memory history, persisted memory summary, and persisted disk history file.
 */
app.delete("/api/agent/:agentId/history", async (req, res): Promise<void> => {
	try {
		const { agentId } = req.params
		const projectId = req.query.projectId as string | undefined
		const found = projectStore.findAgentProject(agentId, projectId)
		const compositeKey = found ? `${found.project.id}:${agentId}` : null
		const agent = activeAgents.get(agentId) || (compositeKey ? activeAgents.get(compositeKey) : undefined)
		if (agent) {
			agent.clearHistory()
		}
		// Clear persisted memory summary
		if (found) {
			projectStore.resetAgentMemory(found.project.id, agentId)
		} else {
			agentStore.updateMemory(agentId, "")
		}
		// Delete persisted history file from disk
		if (found) {
			const agentWorkspace = projectStore.agentHomeDir(found.project.id, agentId)
			const historyFile = path.join(agentWorkspace, ".history", `${agentId}.json`)
			try { await fs.promises.unlink(historyFile) } catch { /* ignore if not present */ }
		}
		io.emit("agent-reset", { agentId, timestamp: Date.now() })
		log.info(`Cleared history for agent: ${agentId}`)
		res.json({ success: true, message: "History cleared" })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

// Society Agent start - history backups and context stats endpoints
/**
 * GET /api/agent/:agentId/history-backups - Get pre-summarization history backups
 * Returns array of backups, each with full messages before summarization occurred.
 */
app.get("/api/agent/:agentId/history-backups", (req, res): void => {
	try {
		const { agentId } = req.params
		const agent = activeAgents.get(agentId)
		if (!agent) {
			res.json({ backups: [], active: false })
			return
		}
		res.json({
			backups: agent.getHistoryBackups(),
			active: true,
		})
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * GET /api/agent/:agentId/context-stats - Get current context window usage
 * Returns token count, context percentage, message count, window size.
 */
app.get("/api/agent/:agentId/context-stats", (req, res): void => {
	try {
		const { agentId } = req.params
		const agent = activeAgents.get(agentId)
		if (!agent) {
			res.json({ tokenCount: 0, contextPercent: 0, messageCount: 0, windowSize: 200000, active: false })
			return
		}
		res.json({
			...agent.getContextStats(),
			active: true,
		})
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * GET /api/agent/:agentId/recent-events?since=<ms>
 * Returns buffered events that arrived after `since` timestamp.
 * Used by the UI to replay events missed during a disconnection/reload.
 */
app.get("/api/agent/:agentId/recent-events", (req, res): void => {
	const { agentId } = req.params
	const since = parseInt(String(req.query.since || "0"), 10)
	const buf = agentEventBuffer.get(agentId) || []
	const events = since > 0 ? buf.filter(e => e.t > since) : buf.slice(-50)
	res.json({ events })
})

/**
 * GET /api/agent/:agentId/examination-context - Get context for summary examination
 * Returns current summary, messages, and last backup for comparison
 */
app.get("/api/agent/:agentId/examination-context", (req, res): void => {
	try {
		const { agentId } = req.params
		const agent = activeAgents.get(agentId)
		if (!agent) {
			res.status(404).json({ error: "Agent not found" })
			return
		}
		res.json(agent.getExaminationContext())
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/agent/:agentId/examine-summary - Ask a question about the summary
 * Compares the answer against original backup to detect information loss
 * Body: { question: string, backupIndex?: number }
 */
app.post("/api/agent/:agentId/examine-summary", async (req, res): Promise<void> => {
	try {
		const { agentId } = req.params
		const { question, backupIndex } = req.body

		if (!question || typeof question !== "string") {
			res.status(400).json({ error: "Question is required" })
			return
		}

		const agent = activeAgents.get(agentId)
		if (!agent) {
			res.status(404).json({ error: "Agent not found" })
			return
		}

		const result = await agent.examineSummary(question, backupIndex)
		res.json(result)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * GET /api/agent/:agentId/summary-quality - Get automated quality score for the summary
 * Analyzes what topics were captured vs missing
 * Query: ?backupIndex=N (optional, defaults to most recent backup)
 */
app.get("/api/agent/:agentId/summary-quality", async (req, res): Promise<void> => {
	try {
		const { agentId } = req.params
		const backupIndex = req.query.backupIndex ? parseInt(req.query.backupIndex as string, 10) : undefined

		const agent = activeAgents.get(agentId)
		if (!agent) {
			res.status(404).json({ error: "Agent not found" })
			return
		}

		const result = await agent.getSummaryQuality(backupIndex)
		res.json(result)
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * GET /api/agent/:agentId/backups-enabled - Check if backups are enabled
 * Returns default (true) if agent not yet active
 */
app.get("/api/agent/:agentId/backups-enabled", (req, res): void => {
	try {
		const { agentId } = req.params
		const agent = activeAgents.get(agentId)
		if (!agent) {
			// Agent not active yet - return default (enabled)
			res.json({ enabled: true, active: false })
			return
		}
		res.json({ enabled: agent.isBackupsEnabled(), active: true })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/agent/:agentId/backups-enabled - Enable or disable backups
 * Body: { enabled: boolean }
 * Note: Setting only takes effect when agent becomes active (sends first message)
 */
app.post("/api/agent/:agentId/backups-enabled", (req, res): void => {
	try {
		const { agentId } = req.params
		const { enabled } = req.body
		
		if (typeof enabled !== "boolean") {
			res.status(400).json({ error: "enabled must be a boolean" })
			return
		}

		const agent = activeAgents.get(agentId)
		if (!agent) {
			// Agent not active yet - just acknowledge (setting will use default when agent starts)
			// Could store in agentStore if persistence needed, but for now just acknowledge
			res.json({ success: true, enabled, active: false, note: "Setting will apply when agent becomes active" })
			return
		}

		agent.setBackupsEnabled(enabled)
		res.json({ success: true, enabled, active: true })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})
// Society Agent end
// Society Agent end

// Society Agent start - agent-scoped workspace & chat routes (session-based, single port)

/**
 * Helper: resolve agent's workspace directory.
 * Checks project store first (project-based agents), then falls back to legacy agent store.
 * @param agentId - The agent identifier
 * @param projectId - Optional project ID (required when agent IDs may be duplicated across projects)
 */
function agentWorkspaceDir(agentId: string, projectId?: string): string {
	// If projectId provided, use it directly (avoids ambiguity with duplicate agent IDs)
	if (projectId) {
		const project = projectStore.get(projectId)
		if (project && project.agents?.some(a => a.id === agentId)) {
			return projectStore.agentHomeDir(projectId, agentId)
		}
	}
	// Fall back to searching (legacy - only works if agent IDs are globally unique)
	const found = projectStore.findAgentProject(agentId)
	if (found) {
		return projectStore.agentHomeDir(found.project.id, agentId)
	}
	// Legacy fallback
	const profile = agentStore.get(agentId)
	const folder = profile?.workspaceFolder || agentId
	return path.join(getWorkspacePath(), "projects", folder)
}

/**
 * Helper: security check — ensure resolved path is within agent's workspace
 * Validates user-provided paths to prevent path traversal attacks.
 * 
 * @param agentDir - The allowed base directory (agent's workspace)
 * @param relativePath - User-provided relative path
 * @returns Object with validation result and full path if valid
 * 
 * NOTE: CodeQL may flag uses of fullPath as js/path-injection, but this function
 * ensures the path stays within agentDir boundaries. The validation is:
 * 1. Resolves to absolute path
 * 2. Checks that resolved path starts with agentDir + path separator
 * 3. Returns validated path only if check passes
 */
function securePath(agentDir: string, relativePath: string): { ok: boolean; fullPath: string; error?: string } {
	// Validate inputs
	if (!relativePath || typeof relativePath !== "string") {
		return { ok: false, fullPath: "", error: "Invalid path: must be a non-empty string" }
	}
	
	const fullPath = path.join(agentDir, relativePath)
	const resolved = path.resolve(fullPath)
	const dirResolved = path.resolve(agentDir)
	
	// lgtm[js/path-injection] - this IS the validation function
	// Must check with path separator to prevent partial matches (e.g., /agent vs /agent-backup)
	if (!resolved.startsWith(dirResolved + path.sep) && resolved !== dirResolved) {
		return { ok: false, fullPath: resolved, error: "Access denied: path outside agent workspace" }
	}
	
	// Return the validated resolved path
	return { ok: true, fullPath: resolved }
}

// Society Agent start - Unified agent tools (all agents have the same capabilities)
const AGENT_TOOLS: Anthropic.Tool[] = [
	{
		name: "run_command",
		description: "Execute a shell command in YOUR agent folder. Use this to install dependencies (npm install), run/stop servers, run tests, or any terminal operation. Commands run in your designated folder within the project. IMPORTANT: Always examine the command output for errors (look for '!' or 'Error' or non-zero exit codes). If a command fails, read log files or adjust your approach before retrying.",
		input_schema: {
			type: "object" as const,
			properties: {
				command: { type: "string", description: "The shell command to execute (e.g. 'npm install', 'npm start', 'pkill -f node')" },
				background: { type: "boolean", description: "If true, run in background (for servers). Default false." },
				timeout_ms: { type: "number", description: "Timeout in milliseconds. Default 600000 (10 min) for test commands, 300000 (5 min) otherwise. Use a higher value for slow builds." },
			},
			required: ["command"],
		},
	},
	// Society Agent start - Mind tools for persistent memory
	{
		name: "read_file",
		description: "Read a file from your folder. Use this to read any files you've created - notes, plans, code, etc. This is how you remember things between conversations.",
		input_schema: {
			type: "object" as const,
			properties: {
				path: { type: "string", description: "Relative path to the file (e.g. 'notes.md', 'src/App.js')" },
			},
			required: ["path"],
		},
	},
	{
		name: "write_file",
		description: "Write/update a file in your folder. Use this to save notes about what you've done, what's running, important context. This is your persistent memory that survives restarts.",
		input_schema: {
			type: "object" as const,
			properties: {
				path: { type: "string", description: "Relative path to the file (e.g. 'notes.md', 'config.json')" },
				content: { type: "string", description: "Full content to write to the file" },
			},
			required: ["path", "content"],
		},
	},
	// Society Agent start - patch_file for targeted edits
	{
		name: "patch_file",
		description: "Make a targeted edit to a file - replace specific text with new text. Much more efficient than rewriting entire files! Use this when you only need to change a small part of a file.",
		input_schema: {
			type: "object" as const,
			properties: {
				path: { type: "string", description: "Relative path to the file" },
				old_text: { type: "string", description: "The EXACT text to find and replace (include enough context to be unique)" },
				new_text: { type: "string", description: "The text to replace it with" },
			},
			required: ["path", "old_text", "new_text"],
		},
	},
	// Society Agent end
	{
		name: "list_files",
		description: "List files in a directory within your folder. Use this to see what files exist.",
		input_schema: {
			type: "object" as const,
			properties: {
				path: { type: "string", description: "Relative path to directory (e.g. '.' for your root, 'src' for src folder)" },
			},
			required: ["path"],
		},
	},
	// Society Agent end
	// Society Agent start - Inter-agent communication
	{
		name: "ask_agent",
		description: "Ask a question to another agent in your project (including the supervisor/architect). Use this to coordinate, ask for information, request help, or clarify requirements. The other agent will respond to your question.",
		input_schema: {
			type: "object" as const,
			properties: {
				agent_id: { type: "string", description: "ID of the agent to ask (e.g. 'architect', 'agent1', 'agent2')" },
				question: { type: "string", description: "Your question or message to the other agent" },
			},
			required: ["agent_id", "question"],
		},
	},
	{
		name: "list_agents",
		description: "List all agents in your project to see who you can communicate with.",
		input_schema: {
			type: "object" as const,
			properties: {},
			required: [],
		},
	},
	{
		name: "send_message",
		description: "Send a message to another agent. This triggers them to process your message immediately. Use for requests, instructions, or any communication. For complex tasks with detailed responses, use delegate_task instead.",
		input_schema: {
			type: "object" as const,
			properties: {
				agent_id: { type: "string", description: "ID of the agent to message" },
				message: { type: "string", description: "Your message content" },
				priority: { type: "string", enum: ["normal", "urgent"], description: "Priority level. Default: normal" },
				wait_for_response: { type: "boolean", description: "If true, include the agent's full response. Default: false (just confirms delivery)" },
			},
			required: ["agent_id", "message"],
		},
	},
	{
		name: "read_inbox",
		description: "Check your inbox for messages from other agents. Call this at the start of tasks or when you need to check if anyone has sent you instructions or updates.",
		input_schema: {
			type: "object" as const,
			properties: {
				mark_read: { type: "boolean", description: "If true, mark messages as read. Default: true" },
			},
			required: [],
		},
	},
	// Society Agent end
	// Society Agent start - Allow workers to READ from project (other agents' folders)
	{
		name: "read_project_file",
		description: "Read a file from anywhere in the project (READ ONLY). Use this to read code created by other agents, shared configuration, or project documentation. You can read from any agent's folder but can only WRITE to your own folder.",
		input_schema: {
			type: "object" as const,
			properties: {
				path: { type: "string", description: "Path relative to project root (e.g. 'agent1/src/App.js', 'agent2/server.js', 'README.md')" },
			},
			required: ["path"],
		},
	},
	// Society Agent start - Global skills (read-only for agents)
	{
		name: "list_global_skills",
		description: "List all available global skills. Global skills are shared across all projects and can be read but NOT created by agents (only users can create global skills).",
		input_schema: {
			type: "object" as const,
			properties: {},
			required: [],
		},
	},
	{
		name: "read_global_skill",
		description: "Read a global skill's SKILL.md file. Global skills are shared across all projects. Use list_global_skills first to see available skills.",
		input_schema: {
			type: "object" as const,
			properties: {
				skill_name: { type: "string", description: "Name of the skill folder (e.g. 'compile-latex')" },
			},
			required: ["skill_name"],
		},
	},
	// Society Agent end - Global skills
	// Society Agent start - MCP server integration (read-only for agents, user registers servers)
	{
		name: "list_mcps",
		description: "List available MCP servers. MCP servers provide external integrations (GitHub, Playwright, etc.). User-managed only - agents cannot register MCPs.",
		input_schema: {
			type: "object" as const,
			properties: {},
			required: [],
		},
	},
	{
		name: "list_mcp_tools",
		description: "List tools available from a specific MCP server. Use list_mcps() first to see available servers. This connects to the server and fetches its tool definitions.",
		input_schema: {
			type: "object" as const,
			properties: {
				server_name: { type: "string", description: "Name of the MCP server (e.g. 'playwright', 'github')" },
			},
			required: ["server_name"],
		},
	},
	{
		name: "use_mcp",
		description: "Call a tool on an MCP server. Use list_mcp_tools() first to see available tools and their parameters.",
		input_schema: {
			type: "object" as const,
			properties: {
				server_name: { type: "string", description: "Name of the MCP server" },
				tool_name: { type: "string", description: "Name of the tool to call" },
				params: { type: "object", description: "Tool parameters (depends on the tool)" },
			},
			required: ["server_name", "tool_name"],
		},
	},
	// Society Agent end - MCP
	// Society Agent start - Shared workspace tools
	{
		name: "handoff_workspace",
		description: "SUPERVISOR ONLY: Hand off workspace write access to your subordinate agent. Use this when you've finished planning and want your developer to implement. The subordinate will get write access while you keep read-only access.",
		input_schema: {
			type: "object" as const,
			properties: {
				task_description: { type: "string", description: "Brief description of what the subordinate should implement" },
			},
			required: ["task_description"],
		},
	},
	{
		name: "return_workspace",
		description: "SUBORDINATE ONLY: Return workspace control to your supervisor. Use this when you've finished implementing and want your supervisor to review. The supervisor will regain write access.",
		input_schema: {
			type: "object" as const,
			properties: {
				summary: { type: "string", description: "Summary of what you implemented/changed" },
			},
			required: ["summary"],
		},
	},
	{
		name: "workspace_status",
		description: "Check the current status of the shared workspace - who has write access and what phase we're in.",
		input_schema: {
			type: "object" as const,
			properties: {},
			required: [],
		},
	},
	// Society Agent end - Shared workspace tools
	{
		name: "list_project_files",
		description: "List files in any directory within the project. Use this to see what other agents have created, explore the project structure, and understand the codebase you need to test.",
		input_schema: {
			type: "object" as const,
			properties: {
				path: { type: "string", description: "Path relative to project root (e.g. 'agent1', 'agent2/src', '.')" },
			},
			required: ["path"],
		},
	},
	// Society Agent start - Additional development tools
	{
		name: "search_in_files",
		description: "Search for text/code patterns in your folder or the entire project. Like grep - find where functions are defined, where imports are used, etc. Automatically excludes node_modules.",
		input_schema: {
			type: "object" as const,
			properties: {
				pattern: { type: "string", description: "Text or regex pattern to search for" },
				path: { type: "string", description: "Directory to search (default: your folder). Use '.' for your folder or 'project:' prefix for whole project" },
				file_pattern: { type: "string", description: "File glob pattern (e.g. '*.js', '*.ts'). Default: all files" },
			},
			required: ["pattern"],
		},
	},
	{
		name: "find_files",
		description: "Find files by name pattern. Automatically excludes node_modules, .git, dist, build folders. Use this instead of 'find' command!",
		input_schema: {
			type: "object" as const,
			properties: {
				name_pattern: { type: "string", description: "Filename pattern (e.g. '*.css', '*.js', 'package.json')" },
				path: { type: "string", description: "Directory to search (default: your folder). Use 'project:' prefix for whole project" },
				type: { type: "string", enum: ["file", "directory", "any"], description: "Type of item to find. Default: file" },
			},
			required: ["name_pattern"],
		},
	},
	{
		name: "delete_file",
		description: "Delete a file or empty directory from your folder. Use for cleanup, refactoring, or removing generated files.",
		input_schema: {
			type: "object" as const,
			properties: {
				path: { type: "string", description: "Relative path to file/directory to delete" },
			},
			required: ["path"],
		},
	},
	{
		name: "move_file",
		description: "Move or rename a file within your folder. Useful for refactoring and reorganizing code.",
		input_schema: {
			type: "object" as const,
			properties: {
				from_path: { type: "string", description: "Current relative path of the file" },
				to_path: { type: "string", description: "New relative path for the file" },
			},
			required: ["from_path", "to_path"],
		},
	},
	{
		name: "http_request",
		description: "Make HTTP requests to test APIs, fetch data, or check if services are running. Supports GET, POST, PUT, DELETE.",
		input_schema: {
			type: "object" as const,
			properties: {
				method: { type: "string", description: "HTTP method: GET, POST, PUT, DELETE, PATCH" },
				url: { type: "string", description: "Full URL to request (e.g. 'http://localhost:3000/api/todos')" },
				headers: { type: "object", description: "Optional headers object (e.g. {'Content-Type': 'application/json'})" },
				body: { type: "string", description: "Request body for POST/PUT (usually JSON string)" },
				timeout_ms: { type: "number", description: "Request timeout in ms (default: 10000)" },
			},
			required: ["method", "url"],
		},
	},
	{
		name: "git_status",
		description: "Check git status - see modified files, staged changes, current branch. Works in your folder or project root.",
		input_schema: {
			type: "object" as const,
			properties: {
				project_root: { type: "boolean", description: "If true, show status for entire project. Default: your folder only" },
			},
			required: [],
		},
	},
	{
		name: "git_diff",
		description: "See git diff - what changed in files. Useful to review changes before committing or understand recent modifications.",
		input_schema: {
			type: "object" as const,
			properties: {
				path: { type: "string", description: "Specific file to diff (optional - defaults to all changes)" },
				staged: { type: "boolean", description: "Show staged changes (--cached). Default: unstaged changes" },
			},
			required: [],
		},
	},
	{
		name: "get_processes",
		description: "List running processes - find servers, check if something is running on a port. Also shows which ports are PROTECTED (cannot be killed).",
		input_schema: {
			type: "object" as const,
			properties: {
				filter: { type: "string", description: "Filter by name (e.g. 'node', 'npm', 'python')" },
				port: { type: "number", description: "Find process on specific port (will indicate if protected)" },
			},
			required: [],
		},
	},
	{
		name: "kill_process",
		description: "Kill a process by port, PID, or name. Use get_processes to find what's running first. PROTECTED PORTS cannot be killed (system port 4000 + any ports in PROTECTED_PORTS env var).",
		input_schema: {
			type: "object" as const,
			properties: {
				port: { type: "number", description: "Kill process on this port (recommended). Some ports are protected." },
				pid: { type: "number", description: "Process ID to kill" },
				name: { type: "string", description: "Kill processes matching this name (be specific, e.g. 'my-app', not 'node')" },
			},
			required: [],
		},
	},
	{
		name: "get_file_info",
		description: "Get detailed info about a file - size, modified date, permissions, line count for text files.",
		input_schema: {
			type: "object" as const,
			properties: {
				path: { type: "string", description: "Path to file" },
			},
			required: ["path"],
		},
	},
	// Society Agent - Port allocation tools
	{
		name: "request_port",
		description: "Request a port for a service. If the same service name was used before, returns the same port. Allocated ports are protected from other projects.",
		input_schema: {
			type: "object" as const,
			properties: {
				service_name: { type: "string", description: "Name for this service (e.g., 'api', 'frontend', 'database'). Same name = same port." },
				port: { type: "number", description: "Optional: Request a specific port number. If not provided, one is auto-allocated." },
				description: { type: "string", description: "Optional description of what this port is used for" },
			},
			required: ["service_name"],
		},
	},
	{
		name: "release_port",
		description: "Release a port that was allocated to this project. The port becomes available for other projects.",
		input_schema: {
			type: "object" as const,
			properties: {
				port: { type: "number", description: "Port number to release" },
			},
			required: ["port"],
		},
	},
	{
		name: "list_project_ports",
		description: "List all ports allocated to this project, with their service names and status.",
		input_schema: {
			type: "object" as const,
			properties: {},
			required: [],
		},
	},
	{
		name: "compare_files",
		description: "Compare two files and show differences. Useful for reviewing changes or finding discrepancies.",
		input_schema: {
			type: "object" as const,
			properties: {
				file1: { type: "string", description: "First file path" },
				file2: { type: "string", description: "Second file path" },
			},
			required: ["file1", "file2"],
		},
	},
	{
		name: "create_directory",
		description: "Create a new directory in your folder. Creates parent directories if needed.",
		input_schema: {
			type: "object" as const,
			properties: {
				path: { type: "string", description: "Directory path to create (e.g. 'src/components/ui')" },
			},
			required: ["path"],
		},
	},
	// Society Agent end
	// Society Agent start - Task pool tools for workers
	{
		name: "claim_task",
		description: "Claim the next available task from the pool. You'll receive full task context including what files to create, where, and what conventions to follow. After claiming, use complete_task when done or fail_task if stuck.",
		input_schema: {
			type: "object" as const,
			properties: {
				task_id: { type: "string", description: "Optional: claim a specific task by ID. If omitted, claims highest priority available task." },
			},
			required: [],
		},
	},
	{
		name: "get_my_task",
		description: "Get details of your currently claimed task - the description, context, expected outputs, and conventions to follow.",
		input_schema: {
			type: "object" as const,
			properties: {},
			required: [],
		},
	},
	{
		name: "complete_task",
		description: "Mark your current task as completed. Include what files you created/modified and a summary of what you did.",
		input_schema: {
			type: "object" as const,
			properties: {
				files_created: {
					type: "array",
					items: { type: "string" },
					description: "List of files you created (relative paths)",
				},
				files_modified: {
					type: "array",
					items: { type: "string" },
					description: "List of files you modified (relative paths)",
				},
				summary: { type: "string", description: "Summary of what you accomplished" },
			},
			required: ["summary"],
		},
	},
	{
		name: "fail_task",
		description: "Report that you cannot complete the task. It will return to the pool for another worker to try. Only use this if you're truly stuck.",
		input_schema: {
			type: "object" as const,
			properties: {
				reason: { type: "string", description: "Why you couldn't complete the task" },
			},
			required: ["reason"],
		},
	},
	// Society Agent end
	// Society Agent start - Team management tools (previously supervisor-only, now for all agents)
	{
		name: "list_team",
		description: "List all agents in your project team with their IDs, names, roles, and current status. Use this to see who is available before delegating or asking for help.",
		input_schema: {
			type: "object" as const,
			properties: {},
			required: [],
		},
	},
	{
		name: "read_agent_file",
		description: "Read a file from another agent's folder. Use this to check their files, code, or notes.",
		input_schema: {
			type: "object" as const,
			properties: {
				agent_id: { type: "string", description: "The agent ID whose file to read" },
				path: { type: "string", description: "Relative path to the file" },
			},
			required: ["agent_id", "path"],
		},
	},
	{
		name: "list_agent_files",
		description: "List files in another agent's folder. Use this to see what an agent has created.",
		input_schema: {
			type: "object" as const,
			properties: {
				agent_id: { type: "string", description: "The agent ID whose files to list" },
				path: { type: "string", description: "Relative path within agent folder (default: '.')" },
			},
			required: ["agent_id"],
		},
	},
	// Society Agent start - Agent configuration tools for supervisors
	{
		name: "get_agent_info",
		description: "Get detailed information about an agent including their role, homeFolder, and customInstructions. Use this to understand an agent's current configuration before assigning or updating instructions.",
		input_schema: {
			type: "object" as const,
			properties: {
				agent_id: { type: "string", description: "The agent ID to get info about (must be yourself, your subordinate, or a peer)" },
			},
			required: ["agent_id"],
		},
	},
	{
		name: "set_agent_instructions",
		description: `Set or update an agent's customInstructions. Use this to define ownership boundaries, coordination protocols, and constraints.

**Permissions:**
- Top-level supervisor (no boss): can edit ANY agent including yourself
- Regular supervisors: can only edit direct subordinates

Supports both REPLACE (default) and APPEND modes for iterative refinement as the project evolves.

Example instructions:
- Ownership: "You OWN: backend/. You can READ: shared/types/. You must NOT write to: frontend/"
- Coordination: "Before changing API contracts, notify frontend-specialist via send_message"
- Constraints: "Always use TypeScript strict mode. Follow the project coding standards."`,
		input_schema: {
			type: "object" as const,
			properties: {
				agent_id: { type: "string", description: "The agent ID to configure (top-level can edit any; others can only edit subordinates)" },
				instructions: { type: "string", description: "The customInstructions to set or append" },
				mode: { type: "string", enum: ["replace", "append"], description: "'replace' (default) overwrites existing instructions. 'append' adds to existing instructions." },
			},
			required: ["agent_id", "instructions"],
		},
	},
	// Society Agent end
	{
		name: "delegate_task",
		description: `Delegate a task to another agent with DETAILED SPECIFICATIONS. The agent will work autonomously on these specs.

REQUIRED: You MUST provide detailed specs including:
1. DESIRED STATE - Exactly what should exist when done (files, behavior, output)
2. ACCEPTANCE CRITERIA - How to verify the work is complete
3. CONSTRAINTS - What NOT to do, boundaries, limitations
4. CONTEXT - Why this is needed, how it fits the bigger picture

The specs will be saved to the agent's DESIRED_STATE.md for autonomous work.`,
		input_schema: {
			type: "object" as const,
			properties: {
				agent_id: { type: "string", description: "ID of the agent to delegate to" },
				task: { type: "string", description: "Brief task title/summary" },
				desired_state: { type: "string", description: "DETAILED description of what should exist when done - files, features, behavior" },
				acceptance_criteria: { type: "array", items: { type: "string" }, description: "List of specific criteria to verify completion" },
				constraints: { type: "array", items: { type: "string" }, description: "What NOT to do, limitations, boundaries" },
				context: { type: "string", description: "Why this is needed, how it fits the project" },
				priority: { type: "string", enum: ["low", "medium", "high", "critical"], description: "Task priority. Default: medium" },
			},
			required: ["agent_id", "task", "desired_state", "acceptance_criteria"],
		},
	},
	{
		name: "report_to_supervisor",
		description: "Report status, completion, or blockers to your supervisor. Use this to communicate progress, ask questions, or request help.",
		input_schema: {
			type: "object" as const,
			properties: {
				status: { type: "string", enum: ["in_progress", "completed", "blocked", "needs_info", "failed"], description: "Current status of your work" },
				summary: { type: "string", description: "Brief summary of what you've done or your situation" },
				details: { type: "string", description: "Detailed information - completed work, blockers, questions" },
				completion_percentage: { type: "number", description: "Estimated completion 0-100" },
				blockers: { type: "array", items: { type: "string" }, description: "List of things blocking progress" },
				questions: { type: "array", items: { type: "string" }, description: "Questions you need answered to proceed" },
			},
			required: ["status", "summary"],
		},
	},
	{
		name: "create_task",
		description: "Create a task in the task pool. Other agents can claim and execute tasks.",
		input_schema: {
			type: "object" as const,
			properties: {
				title: { type: "string", description: "Short task title" },
				description: { type: "string", description: "Full task description with requirements" },
				priority: { type: "number", description: "Priority 1-10 (higher = more urgent). Default: 5" },
				working_directory: { type: "string", description: "Directory for this task relative to project root" },
			},
			required: ["title", "description"],
		},
	},
	{
		name: "list_tasks",
		description: "List all tasks in the task pool with their status.",
		input_schema: {
			type: "object" as const,
			properties: {
				status: { type: "string", enum: ["all", "available", "claimed", "completed", "failed"], description: "Filter by status. Default: 'all'" },
			},
			required: [],
		},
	},
	{
		name: "spawn_worker",
		description: "Spawn an ephemeral worker agent to claim and execute tasks from the pool.",
		input_schema: {
			type: "object" as const,
			properties: {
				count: { type: "number", description: "How many workers to spawn. Default: 1" },
			},
			required: [],
		},
	},
	{
		name: "reset_tasks",
		description: "Reset stale/orphaned tasks back to available status. Use when workers have crashed or tasks are stuck.",
		input_schema: {
			type: "object" as const,
			properties: {
				max_age_minutes: { type: "number", description: "Reset tasks claimed longer than this many minutes ago. Default: 5" },
				cleanup_workers: { type: "boolean", description: "Also remove all ephemeral workers. Default: true" },
			},
			required: [],
		},
	},
	{
		name: "propose_new_agent",
		description: "Propose creating a new permanent agent for the project. By default reports to you, but you can specify a different parent agent.",
		input_schema: {
			type: "object" as const,
			properties: {
				name: { type: "string", description: "Agent name (e.g. 'Testing Specialist')" },
				role: { type: "string", description: "Agent role description" },
				purpose: { type: "string", description: "Why this agent is needed" },
				reports_to: { type: "string", description: "Agent ID that this new agent should report to. Default: you (the caller)" },
			},
			required: ["name", "role", "purpose"],
		},
	},
	// Society Agent end - All agents now have full capabilities
]

// Ephemeral agents get a subset of tools - no delegation or spawning capabilities
// They are temporary workers that execute tasks and disappear
const EPHEMERAL_EXCLUDED_TOOLS = new Set([
	"delegate_task",       // Can't delegate to others
	"spawn_worker",        // Can't spawn more workers
	"create_task",         // Can't create tasks in the pool
	"propose_new_agent",   // Can't propose permanent agents
])
const EPHEMERAL_TOOLS: Anthropic.Tool[] = AGENT_TOOLS.filter(
	tool => !EPHEMERAL_EXCLUDED_TOOLS.has(tool.name)
)

// Society Agent start - Custodian restrictions (workflow policy)
// Custodians govern folders but don't write code - "custodians govern, workers implement"
const CUSTODIAN_ALLOWED_EXTENSIONS = new Set(['.md', '.txt'])
const CUSTODIAN_CODE_EXTENSIONS = new Set([
	'.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
	'.py', '.pyw', '.pyi',
	'.java', '.kt', '.scala',
	'.c', '.cpp', '.h', '.hpp', '.cc',
	'.cs', '.fs',
	'.go', '.rs', '.rb', '.php',
	'.swift', '.m', '.mm',
	'.vue', '.svelte', '.astro',
	'.html', '.css', '.scss', '.sass', '.less',
	'.json', '.yaml', '.yml', '.toml', '.xml',
	'.sql', '.graphql', '.prisma',
	'.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
	'.dockerfile', '.containerfile',
])
const CUSTODIAN_READ_ONLY_COMMANDS = new Set([
	'ls', 'cat', 'head', 'tail', 'less', 'more',
	'tree', 'find', 'grep', 'awk', 'sed', 'wc',
	'file', 'stat', 'du', 'df',
	'git status', 'git log', 'git diff', 'git show', 'git branch', 'git remote',
	'npm list', 'npm ls', 'npm outdated', 'npm view',
	'node --version', 'npm --version', 'python --version',
	'pwd', 'echo', 'date', 'whoami', 'env', 'printenv',
])

// Check if a file extension is allowed for custodian writes
function canCustodianWriteFile(filePath: string): { allowed: boolean; reason?: string } {
	const ext = path.extname(filePath).toLowerCase()
	if (CUSTODIAN_ALLOWED_EXTENSIONS.has(ext)) {
		return { allowed: true }
	}
	if (CUSTODIAN_CODE_EXTENSIONS.has(ext) || ext === '') {
		return { 
			allowed: false, 
			reason: `Custodians cannot write code files (${ext || 'no extension'}). ` +
				`Spawn a worker with spawn_worker() to implement code changes. ` +
				`Custodians can only write: ${[...CUSTODIAN_ALLOWED_EXTENSIONS].join(', ')}`
		}
	}
	// Unknown extension - allow with warning for now
	return { allowed: true }
}

// Check if a command is read-only (allowed for custodians)
function isCustodianCommandAllowed(command: string): { allowed: boolean; reason?: string } {
	const trimmed = command.trim().toLowerCase()
	// Check if command starts with any allowed read-only command
	for (const allowed of CUSTODIAN_READ_ONLY_COMMANDS) {
		if (trimmed === allowed || trimmed.startsWith(allowed + ' ') || trimmed.startsWith(allowed + '\t')) {
			return { allowed: true }
		}
	}
	// Check for piped commands - first command must be read-only
	const firstCmd = trimmed.split(/[|;&]/).map(s => s.trim())[0]
	for (const allowed of CUSTODIAN_READ_ONLY_COMMANDS) {
		if (firstCmd === allowed || firstCmd.startsWith(allowed + ' ')) {
			return { allowed: true }
		}
	}
	return { 
		allowed: false, 
		reason: `Custodians can only run read-only commands. ` +
			`"${command.substring(0, 50)}..." is not allowed. ` +
			`Spawn a worker with spawn_worker() to run commands that modify state.`
	}
}
// Society Agent end - Custodian restrictions

/**
 * Execute a single tool call for suprevisor agents.
 * Returns the tool result as a string.
 */
/**
 * Execute a single tool call for an agent.
 * Society Agent - UNIFIED: supervisors and workers are identical.
 * This wrapper delegates to executeAgentTool to ensure all agents use the same code.
 */
async function executeSupervisorTool(
	toolName: string,
	toolInput: any,
	project: Project,
	supervisorId: string,
	apiKey: string,
	io: SocketIOServer,
): Promise<{ result: string; filesCreated: number }> {
	// Find the agent config for this agent
	if (toolName === "spawn_worker") {
		log.info(`[executeSupervisorTool] spawn_worker called with supervisorId=${supervisorId}`)
	}
	const agentConfig = project.agents.find(a => a.id === supervisorId)
	if (!agentConfig) {
		return { result: `Error: Agent ${supervisorId} not found`, filesCreated: 0 }
	}
	if (toolName === "spawn_worker") {
		log.info(`[executeSupervisorTool] spawn_worker agentConfig.id=${agentConfig.id}, agentConfig.name=${agentConfig.name}`)
	}
	
	// Delegate to the unified agent tool execution
	return executeAgentTool(toolName, toolInput, agentConfig, project, io, apiKey)
}

// Society Agent start - Worker tool execution (restricted to their folder)
async function executeAgentTool(
	toolName: string,
	toolInput: any,
	agentConfig: ProjectAgentConfig,
	project: Project,
	io: SocketIOServer,
	apiKey?: string, // Society Agent - Optional API key for spawning sub-agents
): Promise<{ result: string; filesCreated: number }> {
	// Society Agent start - Defensive checks
	if (!project || !project.id) {
		log.error(`[executeAgentTool] Invalid project passed to tool execution`)
		return { result: `❌ Internal error: Invalid project context`, filesCreated: 0 }
	}
	if (!agentConfig || !agentConfig.id) {
		log.error(`[executeAgentTool] Invalid agentConfig passed to tool execution`)
		return { result: `❌ Internal error: Invalid agent config`, filesCreated: 0 }
	}
	// Society Agent end
	
	// Society Agent start - Determine the working folder
	// For ephemeral workers: use parent agent's folder (the one who spawned them)
	// For persistent agents: use their own folder
	let workingFolder: string
	if (agentConfig.ephemeral && agentConfig.reportsTo) {
		// Ephemeral worker - write to parent agent's folder
		workingFolder = projectStore.agentHomeDir(project.id, agentConfig.reportsTo)
	} else {
		// Persistent agent - use own folder
		workingFolder = projectStore.agentHomeDir(project.id, agentConfig.id)
	}
	// Society Agent end
	
	// Also keep agentFolder for tools that need it (like memory files)
	const agentFolder = projectStore.agentHomeDir(project.id, agentConfig.id)
	
	// Society Agent - Defensive check for undefined paths
	if (!workingFolder || !agentFolder) {
		log.error(`[executeAgentTool] Path undefined - workingFolder=${workingFolder}, agentFolder=${agentFolder}, project.id=${project.id}, agent.id=${agentConfig.id}`)
		return { result: `❌ Internal error: Could not resolve agent working directory`, filesCreated: 0 }
	}

	// Ensure directories exist
	if (!fs.existsSync(workingFolder)) {
		fs.mkdirSync(workingFolder, { recursive: true })
	}
	if (!fs.existsSync(agentFolder)) {
		fs.mkdirSync(agentFolder, { recursive: true })
	}

	// Society Agent start - Emit tool-execution event for UI visibility
	// Format the input in a human-readable way
	const formatToolDetails = () => {
		switch (toolName) {
			case "read_file":
			case "read_project_file":
				return `📖 Reading: ${toolInput.path}`
			case "write_file":
				return `📝 Writing: ${toolInput.path} (${toolInput.content?.length || 0} bytes)`
			case "patch_file":
				return `✏️ Patching: ${toolInput.path}`
			case "list_files":
				return `📁 Listing: ${toolInput.path || '.'}`
			case "run_command":
				return `💻 Running: ${toolInput.command || '(invalid command)'}${toolInput.background ? ' (background)' : ''}`
			case "ask_agent":
				return `💬 Asking ${toolInput.agent_id}: ${(toolInput.question || '').substring(0, 100)}...`
			case "send_message":
				return `📨 Message to ${toolInput.agent_id}: ${(toolInput.message || '').substring(0, 100)}...`
			case "claim_task":
				return `🎯 Claiming task from pool...`
			case "complete_task":
				return `✅ Completing task: ${toolInput.task_id}`
			case "fail_task":
				return `❌ Failing task: ${toolInput.task_id} - ${toolInput.reason}`
			case "find_files":
				return `🔍 Finding: ${toolInput.pattern} in ${toolInput.directory || '.'}`
			case "search_files":
				return `🔎 Searching for: "${toolInput.query}" in ${toolInput.directory || '.'}`
			default:
				return `🔧 ${toolName}: ${JSON.stringify(toolInput).substring(0, 100)}`
		}
	}

	io.emit("tool-execution", {
		agentId: agentConfig.id,
		agentName: agentConfig.name,
		projectId: project.id,
		toolName,
		toolInput,
		details: formatToolDetails(),
		timestamp: Date.now(),
		status: "started",
	})
	// Society Agent end

	// Society Agent start - Handle all worker tools
	switch (toolName) {
		case "read_file": {
			const { path: filePath } = toolInput as { path: string }

			if (typeof filePath !== "string" || filePath.trim().length === 0) {
				return { result: `❌ Missing required parameter: \`path\`. Example: read_file({ path: "PLAN.md" })`, filesCreated: 0 }
			}
			
			// Society Agent - Reject absolute paths
			if (filePath && filePath.startsWith("/")) {
				return { result: `❌ Use relative paths only! Your working folder is: ${workingFolder}\nTry: read_file("src/App.js") or read_project_file() for project files`, filesCreated: 0 }
			}
			
			// Society Agent - Use workingFolder for file operations
			const fullPath = path.join(workingFolder, filePath)
			
			// Security: ensure path is within working folder
			if (!fullPath.startsWith(workingFolder)) {
				return { result: `❌ Error: Cannot read files outside your working directory`, filesCreated: 0 }
			}
			
			try {
				if (!fs.existsSync(fullPath)) {
					return { result: `❌ File not found: ${filePath}`, filesCreated: 0 }
				}
				const content = fs.readFileSync(fullPath, "utf-8")
				const truncated = content.length > 10000 
					? content.substring(0, 10000) + "\n...(truncated, file is " + content.length + " bytes)"
					: content
				return { result: `📄 **${filePath}**:\n\`\`\`\n${truncated}\n\`\`\``, filesCreated: 0 }
			} catch (err: any) {
				return { result: `❌ Error reading file: ${err.message}`, filesCreated: 0 }
			}
		}

		case "write_file": {
			const { path: filePath, content } = toolInput as { path: string; content: string }

			if (typeof filePath !== "string" || filePath.trim().length === 0) {
				return { result: `❌ Missing required parameter: \`path\`. Example: write_file({ path: "notes.md", content: "..." })`, filesCreated: 0 }
			}

			if (content === undefined || content === null) {
				return { result: `❌ Error writing file: 'content' parameter is missing or undefined. Call write_file with both 'path' and 'content' arguments.`, filesCreated: 0 }
			}
			
			// Society Agent start - Custodian file write restriction
			if (!agentConfig.ephemeral) {
				const custodianCheck = canCustodianWriteFile(filePath)
				if (!custodianCheck.allowed) {
					return { result: `🚫 **Custodian write blocked**\n\n${custodianCheck.reason}\n\n💡 Use \`read_global_skill("workflow-policy")\` to understand the custodian/worker model.`, filesCreated: 0 }
				}
			}
			// Society Agent end - Custodian file write restriction
			
			// Society Agent - Reject absolute paths
			if (filePath && filePath.startsWith("/")) {
				return { result: `❌ Use relative paths only! Your working folder is: ${workingFolder}\nTry: write_file("src/App.js", content)`, filesCreated: 0 }
			}
			
			// Society Agent - Use workingFolder (task's directory) for file operations
			const fullPath = path.join(workingFolder, filePath)
			
			// Security: ensure path is within working folder
			if (!fullPath.startsWith(workingFolder)) {
				return { result: `❌ Error: Cannot write files outside your working directory`, filesCreated: 0 }
			}
			
			// Society Agent start - Shared workspace write check
			if (agentConfig.workspaceMode === "shared") {
				const wsRegistry = getProjectSharedWorkspaces(project.id)
				const wsCheck = canWriteInSharedWorkspace(wsRegistry, workingFolder, agentConfig.id)
				if (!wsCheck.success) {
					return { 
						result: `❌ **Shared workspace access denied**\n\n${wsCheck.reason}\n\n` +
							`Current owner: ${wsCheck.currentOwner}\n` +
							`Phase: ${wsCheck.currentPhase}\n\n` +
							`Use \`workspace_status\` to check access or coordinate with your partner.`,
						filesCreated: 0 
					}
				}
			}
			// Society Agent end - Shared workspace write check
			
			// Society Agent - Guard: reject empty or no-op writes
		if (!content || content.trim() === "") {
			return { result: `⚠️ Empty write: write_file called with empty content for "${filePath}". Please provide the actual content you intend to write.`, filesCreated: 0 }
		}
		if (fs.existsSync(fullPath)) {
			const existing = fs.readFileSync(fullPath, "utf-8")
			if (existing === content) {
				return { result: `⚠️ No-op write: "${filePath}" already has identical content. Apply your actual code changes before calling write_file.`, filesCreated: 0 }
			}
		}

		try {
				// Create directory if needed
				const dir = path.dirname(fullPath)
				if (!fs.existsSync(dir)) {
					fs.mkdirSync(dir, { recursive: true })
				}
				fs.writeFileSync(fullPath, content, "utf-8")
				log.info(`[Worker ${agentConfig.name}] Wrote file: ${fullPath} (${content.length} bytes)`)
				
				// Society Agent - Calculate path relative to projects dir for file explorer
				const projectsDir = projectStore.projectsBaseDir
				const relativeToProjects = path.relative(projectsDir, fullPath)
				
				io.emit("file-created", {
					agentId: agentConfig.id,
					projectId: project.id,
					relativePath: relativeToProjects, // Path relative to /projects/ for file explorer
					fullPath,
					size: content.length,
					timestamp: Date.now(),
				})
				
				return { result: `✅ Wrote ${relativeToProjects} (${content.length} bytes)`, filesCreated: 1 }
			} catch (err: any) {
				return { result: `❌ Error writing file: ${err.message}`, filesCreated: 0 }
			}
		}

		// Society Agent start - patch_file for targeted edits
		case "patch_file": {
			const { path: filePath, old_text, new_text } = toolInput as { path: string; old_text: string; new_text: string }
			
			// Society Agent start - Custodian file write restriction
			if (!agentConfig.ephemeral) {
				const custodianCheck = canCustodianWriteFile(filePath)
				if (!custodianCheck.allowed) {
					return { result: `🚫 **Custodian write blocked**\n\n${custodianCheck.reason}\n\n💡 Use \`read_global_skill("workflow-policy")\` to understand the custodian/worker model.`, filesCreated: 0 }
				}
			}
			// Society Agent end - Custodian file write restriction
			
			// Society Agent - Use workingFolder for file operations
			const fullPath = path.join(workingFolder, filePath)
			
			// Security: ensure path is within working folder
			if (!fullPath.startsWith(workingFolder)) {
				return { result: `❌ Error: Cannot edit files outside your working directory`, filesCreated: 0 }
			}
			
			// Society Agent start - Shared workspace write check
			if (agentConfig.workspaceMode === "shared") {
				const wsRegistry = getProjectSharedWorkspaces(project.id)
				const wsCheck = canWriteInSharedWorkspace(wsRegistry, workingFolder, agentConfig.id)
				if (!wsCheck.success) {
					return { 
						result: `❌ **Shared workspace access denied**\n\n${wsCheck.reason}\n\n` +
							`Current owner: ${wsCheck.currentOwner}\n` +
							`Phase: ${wsCheck.currentPhase}\n\n` +
							`Use \`workspace_status\` to check access or coordinate with your partner.`,
						filesCreated: 0 
					}
				}
			}
			// Society Agent end - Shared workspace write check
			
			try {
				if (!fs.existsSync(fullPath)) {
					return { result: `❌ File not found: ${filePath}`, filesCreated: 0 }
				}
				
				const content = fs.readFileSync(fullPath, "utf-8")
				
				if (!content.includes(old_text)) {
					// Show snippet of file and fuzzy match hints to help agent find correct text
					const snippet = content.substring(0, 500)
					
					// Try to find partial matches - look for first non-empty line of old_text
					const firstLine = old_text.split("\n").find(line => line.trim().length > 10)?.trim() || old_text.substring(0, 50)
					const lines = content.split("\n")
					const matchingLines: string[] = []
					lines.forEach((line, idx) => {
						if (line.includes(firstLine.substring(0, 30)) || firstLine.includes(line.trim().substring(0, 30))) {
							matchingLines.push(`Line ${idx + 1}: ${line.substring(0, 80)}`)
						}
					})
					
					let hint = ""
					if (matchingLines.length > 0 && matchingLines.length < 10) {
						hint = `\n\n💡 **Possible matches found:**\n\`\`\`\n${matchingLines.slice(0, 5).join("\n")}\n\`\`\`\n\n**TIP:** Use \`run_command("sed -n 'LINE_NUMp' ${filePath}")\` to get the exact text.`
					} else {
						hint = "\n\n**TIP:** Use `run_command(\"grep -n 'keyword' " + filePath + "\")` to find the exact line."
					}
					
					return { result: `❌ Could not find the exact text to replace.\n\nFile starts with:\n\`\`\`\n${snippet}\n\`\`\`\n\nMake sure old_text matches EXACTLY including whitespace.${hint}`, filesCreated: 0 }
				}
				
				const occurrences = content.split(old_text).length - 1
				if (occurrences > 1) {
					return { result: `⚠️ Found ${occurrences} occurrences of that text. Include more context in old_text to make it unique.`, filesCreated: 0 }
				}
				
				const newContent = content.replace(old_text, new_text)
				fs.writeFileSync(fullPath, newContent, "utf-8")
				
				log.info(`[Worker ${agentConfig.name}] Patched file: ${filePath}`)
				
				io.emit("file-created", {
					agentId: agentConfig.id,
					projectId: project.id,
					relativePath: filePath,
					fullPath,
					size: newContent.length,
					timestamp: Date.now(),
				})
				
				return { result: `✅ Patched ${filePath}\n- Replaced ${old_text.length} chars with ${new_text.length} chars`, filesCreated: 0 }
			} catch (err: any) {
				return { result: `❌ Error patching file: ${err.message}`, filesCreated: 0 }
			}
		}
		// Society Agent end

		case "list_files": {
			const { path: dirPath } = toolInput as { path: string }
			
			// Society Agent start - Reject absolute paths (agent confusion prevention)
			if (dirPath && dirPath.startsWith("/")) {
				return { result: `❌ Use relative paths only! Your working folder is: ${workingFolder}\nTry: list_files(".")  or  list_files("src")`, filesCreated: 0 }
			}
			// Society Agent end
			
			// Society Agent - Use workingFolder for file operations
			const fullPath = path.join(workingFolder, dirPath || ".")
			
			// Security: ensure path is within working folder
			if (!fullPath.startsWith(workingFolder)) {
				return { result: `❌ Error: Cannot list files outside your working directory`, filesCreated: 0 }
			}
			
			try {
				if (!fs.existsSync(fullPath)) {
					return { result: `❌ Directory not found: ${dirPath}`, filesCreated: 0 }
				}
				const items = fs.readdirSync(fullPath, { withFileTypes: true })
				// Society Agent - Filter out noise directories
				const ignoreDirs = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', 'coverage', '__pycache__'])
				const listing = items
					.filter(i => {
						if (i.name.startsWith(".") && i.name !== ".env") return false
						if (i.isDirectory() && ignoreDirs.has(i.name)) return false
						return true
					})
					.map(i => i.isDirectory() ? `📁 ${i.name}/` : `📄 ${i.name}`)
					.join("\n")
				return { result: `📂 **${dirPath || "."}**:\n${listing || "(empty)"}`, filesCreated: 0 }
			} catch (err: any) {
				return { result: `❌ Error listing directory: ${err.message}`, filesCreated: 0 }
			}
		}

		case "run_command": {
			// Original run_command logic
			const { command, background, timeout_ms } = toolInput as {
				command: string
				background?: boolean
				timeout_ms?: number
			}

			// Society Agent start - Validate command before executing
			if (!command || typeof command !== "string") {
				log.error(`[Worker ${agentConfig.name}] run_command received invalid command: ${JSON.stringify(toolInput)}`)
				return { result: `❌ Error: run_command requires a valid 'command' string parameter. Received: ${JSON.stringify(toolInput)}`, filesCreated: 0 }
			}
			
			// Society Agent start - Custodian command restriction
			if (!agentConfig.ephemeral) {
				const cmdCheck = isCustodianCommandAllowed(command)
				if (!cmdCheck.allowed) {
					return { result: `🚫 **Custodian command blocked**\n\n${cmdCheck.reason}\n\n💡 Use \`read_global_skill("workflow-policy")\` to understand the custodian/worker model.`, filesCreated: 0 }
				}
			}
			// Society Agent end - Custodian command restriction

			// Society Agent - Fix incorrect paths that miss the projects/<project-id> folder
			// Common mistake: /workspaces/society-agent/backend-specialist
			// Should be: /workspaces/society-agent/projects/architect/backend-specialist
			let fixedCommand = command
			const workspaceRoot = getWorkspacePath()
			
			// Find all absolute paths in the command that start with workspace root
			const pathRegex = new RegExp(`${workspaceRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/([^\\s;&|"']+)`, 'g')
			let match
			while ((match = pathRegex.exec(command)) !== null) {
				const fullPath = match[0]
				const afterRoot = match[1]
				
				// Skip if it already has projects/ or is a known root folder
				if (afterRoot.startsWith("projects/") || 
				    afterRoot.startsWith("src/") || 
				    afterRoot.startsWith("node_modules/") ||
				    afterRoot.startsWith("docs/") ||
				    afterRoot.startsWith("skills/") ||
				    afterRoot.startsWith("__tests__/") ||
				    afterRoot === "package.json" ||
				    afterRoot === "tsconfig.json" ||
				    afterRoot.startsWith(".")) {
					continue
				}
				
				// This path is probably missing projects/<project-id>/
				const correctedPath = path.join(workspaceRoot, "projects", project.id, afterRoot)
				log.warn(`[Worker ${agentConfig.name}] Detected incorrect path: ${fullPath}`)
				log.warn(`[Worker ${agentConfig.name}] Auto-correcting to: ${correctedPath}`)
				fixedCommand = fixedCommand.replace(fullPath, correctedPath)
			}

			// Society Agent - Backend port normalization guard
			// Backend agents/workers must use port 6001, not 3000.
			const isBackendAgent = (
				agentConfig.id.toLowerCase().includes("backend") ||
				(agentConfig.role || "").toLowerCase().includes("backend") ||
				(agentConfig.homeFolder || "").toLowerCase().includes("backend")
			)
			if (isBackendAgent) {
				let normalized = fixedCommand
				// Explicit env var and common CLI flags
				normalized = normalized.replace(/\bPORT=3000\b/g, "PORT=6001")
				normalized = normalized.replace(/(--port[=\s])3000\b/gi, "$16001")
				normalized = normalized.replace(/(-p\s+)3000\b/gi, "$16001")
				// Common localhost targets for backend checks
				normalized = normalized.replace(/localhost:3000\b/g, "localhost:6001")
				normalized = normalized.replace(/127\.0\.0\.1:3000\b/g, "127.0.0.1:6001")

				if (normalized !== fixedCommand) {
					log.info(`[Worker ${agentConfig.name}] Normalized backend command port 3000 -> 6001: ${normalized}`)
					fixedCommand = normalized
				}
			}
			// Society Agent end
			
			// CRITICAL: Block commands that would kill the system server or its runner
			// Test each semicolon/&&-separated segment individually to avoid false positives
			// (e.g. "kill 123; cd /workspaces/society-agent/..." must NOT be blocked)
			const SYSTEM_PORT = parseInt(process.env.PORT || "4000", 10)
			const dangerousPatterns = [
				// Port 4000 (system server) - comprehensive patterns
				new RegExp(`kill.*${SYSTEM_PORT}`, 'i'),
				new RegExp(`pkill.*${SYSTEM_PORT}`, 'i'),
				new RegExp(`fuser.*-k.*${SYSTEM_PORT}`, 'i'),
				new RegExp(`fuser.*${SYSTEM_PORT}.*-k`, 'i'),           // fuser 4000/tcp -k
				new RegExp(`lsof.*${SYSTEM_PORT}.*kill`, 'i'),          // any lsof+4000+kill combo
				new RegExp(`lsof.*-ti?:?${SYSTEM_PORT}`, 'i'),          // lsof -ti:4000 or -t -i:4000
				new RegExp(`kill.*\\$\\(.*${SYSTEM_PORT}`, 'i'),        // kill $(anything with 4000)
				new RegExp(`npx\\s+kill-port\\s+${SYSTEM_PORT}`, 'i'),  // npx kill-port 4000
				new RegExp(`kill-port\\s+${SYSTEM_PORT}`, 'i'),         // kill-port 4000
				// Society server process patterns
				/kill.*society.{0,30}server/i,   // kill society-server process
				/pkill.*society/i,               // pkill targeting society
				// System-wide node/tsx killing (would kill everything)
				/pkill.*-f.*["']?tsx["']?/i,     // pkill -f "tsx" kills the agent runner itself
				/pkill\s+tsx/i,                  // pkill tsx (without -f)
				/pkill\s+-f\s+["']?node["']?/i,  // pkill -f "node" kills all node including system
				/pkill\s+["']?node["']?/i,       // pkill node (without -f)
				/killall\s+node/i,               // killall node
				/killall\s+tsx/i,                // killall tsx
				/kill.*\$\(pgrep.*node/i,        // kill $(pgrep node)
				/pgrep.*node.*\|.*xargs.*kill/i, // pgrep node | xargs kill
			]
			
			// Split compound commands and test each segment independently
			const commandSegments = fixedCommand.split(/;|&&/).map(s => s.trim())
			const blockedBy = commandSegments
				.flatMap(seg => dangerousPatterns.filter(p => p.test(seg)).map(p => ({ seg, p })))
				[0]
			if (blockedBy) {
				log.warn(`[BLOCKED] Agent ${agentConfig.name} dangerous segment: ${blockedBy.seg}`)
				return { 
					result: `🚨 **BLOCKED: This command would kill the system server or its process runner!**\n\nBlocked segment: \`${blockedBy.seg}\`\n\n✅ To restart your project server: use kill_process({ port: YOUR_PORT }) then run_command to start it.\n✅ Use a different port for YOUR server (6001, 8080, 3000, etc.)\n❌ Never pkill tsx or kill port 4000 — that destroys the agent framework.`, 
					filesCreated: 0 
				}
			}
			
			// Society Agent - Check for protected ports in kill/fuser commands
			// This catches attempts to kill user's other protected services
			const isKillCommand = /kill|fuser.*-k|pkill/i.test(fixedCommand)
			if (isKillCommand) {
				const portsInCommand = extractPortsFromCommand(fixedCommand)
				const protectedPortHit = portsInCommand.find(p => isPortProtected(p))
				if (protectedPortHit) {
					log.warn(`[BLOCKED] Agent ${agentConfig.name} tried to kill protected port ${protectedPortHit}`)
					return { 
						result: `🚨 **BLOCKED: Port ${protectedPortHit} is protected!**\n\nThis port is in the protected list and cannot be killed by agents.\n\nProtected ports: ${[...PROTECTED_PORTS].join(", ")}\n\n💡 To protect additional ports, set PROTECTED_PORTS environment variable:\n\`PROTECTED_PORTS=3000,5000,8080 npm start\``, 
						filesCreated: 0 
					}
				}
			}
			// Society Agent end

			// Society Agent - Normalize test runner commands to non-interactive / single-run mode
			// vitest, jest, and mocha all default to watch mode which never exits.
			// Auto-append the appropriate flag so the command resolves cleanly.
			if (
				// npm test / yarn test / pnpm test — without explicit --run or --watchAll=false
				(/(?:^|&&|;)\s*(?:npm|yarn|pnpm)\s+test(?:\s|$|\s+--\s)/.test(fixedCommand) &&
					!/--run(?:\s|$)/.test(fixedCommand) &&
					!/--watchAll=false/.test(fixedCommand) &&
					!/CI=true/.test(fixedCommand))
			) {
				// Vitest uses `-- --run`; Jest uses `--watchAll=false`.
				// We can't know which runner is used, so we check package.json if possible,
				// but it's safe to always use `-- --run` since jest ignores unknown vitest flags
				// via the `--` separator. Simpler: set CI=true which both runners respect.
				fixedCommand = `CI=true ${fixedCommand}`
				log.info(`[Worker ${agentConfig.name}] Auto-prepended CI=true to prevent watch mode: ${fixedCommand}`)
			} else if (
				// npx vitest / vitest directly — without --run flag
				(/(?:^|&&|;)\s*(?:npx\s+)?vitest(?:\s+run)?\s/.test(fixedCommand) || /(?:^|&&|;)\s*(?:npx\s+)?vitest$/.test(fixedCommand)) &&
				!/\brun\b/.test(fixedCommand.replace(/.*vitest/, '')) &&  // 'run' subcommand already present
				!/--reporter/.test(fixedCommand)
			) {
				// Insert 'run' subcommand after 'vitest'
				fixedCommand = fixedCommand.replace(/((?:npx\s+)?vitest)(?!\s+run)/, '$1 run')
				log.info(`[Worker ${agentConfig.name}] Auto-inserted 'run' into vitest command: ${fixedCommand}`)
			}

			// Society Agent - Auto-detect commands that should run in background
			// These patterns indicate long-running servers that will never exit on their own
			let autoBackground = background || false
			const serverPatterns = [
				/npm\s+(run\s+)?(dev|start|serve|server)/i,   // npm run dev, npm start, etc.
				/yarn\s+(run\s+)?(dev|start|serve|server)/i,  // yarn equivalents
				/pnpm\s+(run\s+)?(dev|start|serve|server)/i,  // pnpm equivalents
				/node\s+.*server/i,                            // node server.js
				/nodemon/i,                                    // nodemon
				/ts-node\s+.*server/i,                         // ts-node server.ts
				/tsx\s+.*server/i,                             // tsx server.ts
				/python.*-m\s+http\.server/i,                  // python http server
				/python.*flask\s+run/i,                        // flask
				/python.*uvicorn/i,                            // uvicorn
				/go\s+run.*server/i,                           // go server
				/cargo\s+run.*server/i,                        // rust server
			]
			
			if (!background && serverPatterns.some(pattern => pattern.test(fixedCommand))) {
				log.info(`[Worker ${agentConfig.name}] Auto-enabling background mode for server command: ${fixedCommand}`)
				autoBackground = true
			}
			// Society Agent end

			// Society Agent - Use workingFolder for commands
			log.info(`[Worker ${agentConfig.name}] Running: ${fixedCommand} (cwd: ${workingFolder}, bg: ${autoBackground})`)
			
			// Check if working directory exists
			if (!fs.existsSync(workingFolder)) {
				return { result: `❌ Working directory not found: ${workingFolder}\n\n💡 The directory may not exist yet. Check the path or create it first.`, filesCreated: 0 }
			}

			io.emit("system-event", {
				type: "command-start",
				agentId: agentConfig.id,
				projectId: project.id,
				message: `Running: ${fixedCommand}`,
				command: fixedCommand,
				cwd: workingFolder,
				background: autoBackground,
				timestamp: Date.now(),
			})

	if (autoBackground) {
		const { exec, execSync: execSyncBg } = await import("child_process")

		// ── Helpers ────────────────────────────────────────────────────────────

		/** Extract the first port number mentioned in a command string. */
		const extractPort = (cmd: string): number | null => {
			const patterns = [
				/(?:^|\s)PORT=(\d{3,5})(?:\s|$)/,           // PORT=3000 npm start
				/(?:-p|--port)[=\s](\d{3,5})(?:\s|$)/i,     // -p 3000 / --port=3000
				/:(\d{3,5})(?:\s|$|\/)/,                     // :3000
			]
			for (const re of patterns) {
				const m = cmd.match(re)
				if (m) return parseInt(m[1], 10)
			}
			return null
		}

		/** True if something is already listening on `port`. */
		const isPortInUse = (port: number): boolean => {
			try {
				execSyncBg(`fuser ${port}/tcp 2>/dev/null`, { stdio: "pipe" })
				return true
			} catch { return false }
		}

		/** Kill whatever is on `port`, wait up to 2 s for it to die. */
		const freePort = (port: number, label: string): string => {
			try {
				execSyncBg(`fuser -k ${port}/tcp 2>/dev/null || true`, { stdio: "pipe" })
				// brief wait for OS to release the port
				execSyncBg(`sleep 0.5`, { stdio: "pipe" })
				log.info(`[Worker ${label}] Freed port ${port} before start`)
				return `🔄 Auto-killed existing process on port ${port}\n`
			} catch { return "" }
		}

		/** Try curling common health endpoints; return first successful body (truncated). */
		const httpHealthCheck = (port: number): string | null => {
			const paths = ["/health", "/api/health", "/api/status", "/", "/ping"]
			for (const p of paths) {
				try {
					const body = execSyncBg(
						`curl -s --max-time 2 http://localhost:${port}${p}`,
						{ stdio: "pipe", encoding: "utf-8" }
					) as string
					if (body && body.trim().length > 0) {
						return body.trim().substring(0, 300)
					}
				} catch { /* try next */ }
			}
			return null
		}

		// ── Strip trailing & / 2>&1 & the agent may have added ─────────────────
		// If left in, "nohup cmd 2>&1 & > log 2>&1 & echo $!" keeps bash's stdout
		// pipe open, so exec() never calls back.
		const strippedCommand = fixedCommand
			.replace(/\s*2>&1\s*&?\s*$/, '')
			.replace(/\s*&\s*$/, '')
			.trim()

		// ── Pre-flight: kill any process already on the target port ─────────────
		const targetPort = extractPort(strippedCommand)
		let preflightNote = ""
		if (targetPort && targetPort !== 4000 && isPortInUse(targetPort)) {
			preflightNote = freePort(targetPort, agentConfig.name)
		}

		const logFile = `/tmp/worker-${agentConfig.id}-${Date.now()}.log`
		const bgCommand = `nohup ${strippedCommand} > ${logFile} 2>&1 & echo $!`

		const cleanEnv = { ...process.env }
		delete cleanEnv.PORT

		/** Spawn once; optionally retry after killing EADDRINUSE port. */
		const spawnBg = (): Promise<{ result: string; filesCreated: number }> =>
			new Promise((resolve) => {
				let resolved = false
				const safeResolve = (val: { result: string; filesCreated: number }) => {
					if (!resolved) { resolved = true; resolve(val) }
				}

				// Safety net: exec() hangs if the shell never exits (should not happen
				// after our strip above, but kept as belt-and-suspenders).
				const execTimeout = setTimeout(() => {
					log.warn(`[Worker ${agentConfig.name}] exec() timed out: ${strippedCommand.substring(0, 80)}`)
					safeResolve({
						result: `⚠️ Background start timed out (15s).\nCommand: ${strippedCommand}\nLog: ${logFile}\n\nCheck with: get_processes()`,
						filesCreated: 0,
					})
				}, 15000)

				exec(bgCommand, { cwd: workingFolder, shell: "/bin/bash", env: cleanEnv }, (err, stdout) => {
					clearTimeout(execTimeout)
					const pid = stdout.trim()

					io.emit("system-event", {
						type: "command-background",
						agentId: agentConfig.id,
						projectId: project.id,
						message: `Background: ${strippedCommand} (PID: ${pid})`,
						command: strippedCommand,
						pid,
						logFile,
						timestamp: Date.now(),
					})

					if (err) {
						safeResolve({ result: `Failed to start: ${err.message}`, filesCreated: 0 })
						return
					}

					// ── Wait 3 s, then check process + log + health ──────────────
					setTimeout(async () => {
						let isRunning = false
						try {
							execSyncBg(`kill -0 ${pid} 2>/dev/null`, { stdio: "pipe" })
							isRunning = true
						} catch { isRunning = false }

						let logContent = ""
						try {
							logContent = stripAnsiCodes(fs.readFileSync(logFile, "utf-8"))
							if (logContent.length > 3000) logContent = logContent.substring(0, 3000) + "\n...(truncated)"
						} catch { logContent = "(no output yet)" }

						// ── EADDRINUSE auto-retry ────────────────────────────────
						// If the process died AND the log mentions address-in-use, we
						// extract the port, kill it, and resolve with a clear message
						// telling the agent a retry is happening automatically.
						if (!isRunning && /EADDRINUSE|address already in use/i.test(logContent)) {
							const portMatch = logContent.match(/EADDRINUSE[^:]*:+\s*(\d+)/) ||
							                  logContent.match(/address already in use.*?:(\d+)/i) ||
							                  logContent.match(/:(\d{3,5})/)
							const busyPort = portMatch ? parseInt(portMatch[1], 10) : targetPort
							if (busyPort && busyPort !== 4000) {
								log.warn(`[Worker ${agentConfig.name}] EADDRINUSE on port ${busyPort} — auto-killing and retrying`)
								freePort(busyPort, agentConfig.name)
								// Re-run and return that result
								const retryResult = await spawnBg()
								safeResolve({
									result: `🔄 Port ${busyPort} was busy — auto-killed it and retried.\n\n${retryResult.result}`,
									filesCreated: retryResult.filesCreated,
								})
								return
							}
						}

						// ── Health check on detected port ────────────────────────
						let healthNote = ""
						if (isRunning && targetPort) {
							const body = httpHealthCheck(targetPort)
							if (body) {
								healthNote = `\n\n🩺 Health check passed (port ${targetPort}):\n\`\`\`\n${body}\n\`\`\``
							} else {
								healthNote = `\n\n🩺 Health check: port ${targetPort} not yet responding (server may still be starting up)`
							}
						}

						if (isRunning) {
							safeResolve({
								result: `${preflightNote}✅ Background process running!\nPID: ${pid}\nLog: ${logFile}\n\nStartup output:\n\`\`\`\n${logContent || "(no output yet)"}\n\`\`\`${healthNote}`,
								filesCreated: 0,
							})
						} else {
							safeResolve({
								result: `${preflightNote}❌ Process failed (exited immediately)!\n\nCommand: ${strippedCommand}\n\nOutput/Error:\n\`\`\`\n${logContent || "(no output)"}\n\`\`\``,
								filesCreated: 0,
							})
						}
					}, 3000)
				})
			})

		return spawnBg()
	}

	// Foreground execution with real-time streaming
	// Society Agent start - Use spawn instead of execSync to stream output
	const { spawn } = await import("child_process")
	
	// Auto-increase timeout for test commands (enforce minimum for tests)
	// Be specific to actual test runners - don't match files that happen to have "test" in name
	const isTestCommand = /\b(npm\s+(run\s+)?test|yarn\s+(run\s+)?test|pnpm\s+(run\s+)?test|vitest(\s+run)?|jest|mocha|pytest|npx\s+(vitest|jest|mocha))\b/i.test(fixedCommand)
	const isBuildCommand = /\b(build|compile|tsc|webpack|vite\s+build|rollup|esbuild)\b/i.test(fixedCommand)
	const isInstallCommand = /\b(npm\s+install|npm\s+i|yarn\s+install|yarn\s+add|pnpm\s+install|pnpm\s+add|pip\s+install)\b/i.test(fixedCommand)
	const minTestTimeout = 600000 // 10 min minimum for tests
	const buildTimeout = 300000 // 5 min for builds
	const installTimeout = 180000 // 3 min for installs
	const defaultTimeout = isTestCommand ? minTestTimeout 
		: isBuildCommand ? buildTimeout
		: isInstallCommand ? installTimeout
		: 120000 // 2 min default for other commands (reduced from 5 min)
	// For test commands, enforce minimum even if agent passed a shorter timeout
	// But always respect explicit timeout_ms for non-test commands
	const timeout = isTestCommand 
		? Math.max(timeout_ms || defaultTimeout, minTestTimeout)
		: (timeout_ms || defaultTimeout)

	// Society Agent start - Auto-prepend sudo for apt commands
	let finalCommand = fixedCommand
	if (/^\s*(apt-get|apt|dpkg)\s/.test(fixedCommand) && !fixedCommand.includes("sudo")) {
		finalCommand = `sudo ${fixedCommand}`
		log.info(`[Worker ${agentConfig.name}] Auto-prepending sudo: ${finalCommand}`)
	}
	// Society Agent end

	// Society Agent - Warn about scripts that might hang on network I/O
	const isNetworkScript = /\b(imap|smtp|telnet|ssh|curl.*--connect-timeout|ftp|mail|pop3)\b/i.test(fixedCommand)
	let networkWarning = ""
	if (isNetworkScript && !timeout_ms) {
		networkWarning = `\n⚠️ *Network script detected - may hang if server is unreachable (timeout: ${timeout / 1000}s)*\n`
	}

	return new Promise<{ result: string; filesCreated: number }>((resolve) => {
		let output = ""
		let lastEmitTime = 0
		const EMIT_INTERVAL = 500 // Emit every 500ms at most
		
		// Emit command starting
		io.emit("agent-message", {
			agentId: agentConfig.id,
			agentName: agentConfig.name,
			projectId: project.id,
			message: `\n⏳ *Running: ${finalCommand}*${networkWarning}\n\`\`\`\n`,
			timestamp: Date.now(),
			isStreaming: true,
		})

		// Society Agent - Detect if command has backgrounding (&) and needs special handling
		// Root cause: when bash forks a background process, that child inherits ALL of bash's
		// open FDs, including our stdout/stderr pipes AND any Node.js internal pipes (fd 3+).
		// Even with >/dev/null redirects, bash may not exit cleanly in all cases.
		//
		// The only 100% reliable fix: extract background lines, spawn them as truly detached
		// Node.js children (stdio:'ignore', detached:true, unref()), and run the rest with
		// clean bash -c. This completely severs any FD connection between our pipes and the
		// background process.
		const bgLineRe = /^(.*[^&])&\s*$/   // matches "cmd &" but not "cmd &&"
		const lines = finalCommand.split('\n')
		const bgCommands: string[] = []
		const fgLines: string[] = []
		for (const line of lines) {
			const trimmed = line.trim()
			if (!trimmed) continue
			// Strip 2>&1 redirect + trailing & to get the bare command
			const m = trimmed.match(/^(.*?)\s*(?:2>&1\s*)?&\s*$/)
			if (m && !/&&\s*$/.test(trimmed)) {
				// Background command — collect it
				bgCommands.push(m[1].trim())
				fgLines.push(`echo "[bg started: ${m[1].trim().substring(0, 60)}]"`)
			} else {
				fgLines.push(line)
			}
		}
		const hasBackgrounding = bgCommands.length > 0
		const bgPids: number[] = []
		const bgLogFiles: string[] = []
		if (hasBackgrounding) {
			for (let i = 0; i < bgCommands.length; i++) {
				const bgCmd = bgCommands[i]
				// Society Agent - Write bg output to a temp log so agent can inspect startup
				const bgLogPath = `/tmp/bg-${agentConfig.id}-${Date.now()}-${i}.log`
				try {
					const bgLogFd = fs.openSync(bgLogPath, "w")
					const bgChild = spawn("bash", ["-c", bgCmd], {
						cwd: workingFolder,
						env: { ...process.env, FORCE_COLOR: "0" },
						stdio: ["ignore", bgLogFd, bgLogFd], // stdout+stderr → log file, no pipe to us
						detached: true,     // Own process group — survives bash exit
					})
					fs.closeSync(bgLogFd)   // Parent closes its copy; child keeps its inherited fd
					bgChild.unref()         // Don't keep Node event loop alive for it
					bgPids.push(bgChild.pid ?? -1)
					bgLogFiles.push(bgLogPath)
					// Replace the echo placeholder with one that includes the log path
					const idx = fgLines.indexOf(`echo "[bg started: ${bgCmd.substring(0, 60)}]"`)
					if (idx !== -1) {
						fgLines[idx] = `echo "[bg started PID=${bgChild.pid}: ${bgCmd.substring(0, 50)} → log: ${bgLogPath}]"`
					}
					log.info(`[Worker ${agentConfig.name}] Spawned detached bg process (PID ${bgChild.pid}): ${bgCmd.substring(0, 80)} → ${bgLogPath}`)
				} catch (err: any) {
					log.warn(`[Worker ${agentConfig.name}] Failed to spawn bg command: ${err.message}`)
					fgLines.push(`echo "[bg launch failed: ${err.message}]"`)
				}
			}
		}
		const shellCommand = fgLines.join('\n') || 'echo "(no foreground commands)"'

		const child = spawn("bash", ["-c", shellCommand], {
			cwd: workingFolder, // Society Agent - Use workingFolder for commands
			env: { ...process.env, FORCE_COLOR: "0" },
		})

		const streamOutput = (data: Buffer) => {
			const text = stripAnsiCodes(data.toString())
			output += text
			
			// Throttle emissions to avoid flooding
			const now = Date.now()
			if (now - lastEmitTime > EMIT_INTERVAL) {
				io.emit("agent-message", {
					agentId: agentConfig.id,
					agentName: agentConfig.name,
					projectId: project.id,
					message: text,
					timestamp: now,
					isStreaming: true,
				})
				lastEmitTime = now
			}
		}

		child.stdout?.on("data", streamOutput)
		child.stderr?.on("data", streamOutput)

		// Society Agent - Emit warning if command takes too long (30s)
		const warningId = setTimeout(() => {
			io.emit("agent-message", {
				agentId: agentConfig.id,
				agentName: agentConfig.name,
				projectId: project.id,
				message: `\n⚠️ *Command running for 30s+ (timeout: ${timeout / 1000}s)...*\n`,
				timestamp: Date.now(),
				isStreaming: true,
			})
		}, 30000)

		const timeoutId = setTimeout(() => {
			clearTimeout(warningId)
			child.kill("SIGTERM")
			// Society Agent - include bg log content even on timeout
			let bgTimeoutSection = ''
			if (bgLogFiles.length > 0) {
				bgTimeoutSection = '\n\n' + bgLogFiles.map((lp, i) => {
					try { return `⚡ BG PID=${bgPids[i]}: ${bgCommands[i]?.substring(0,50)}\n\`\`\`\n${stripAnsiCodes(fs.readFileSync(lp,'utf8')).substring(0,2000)}\n\`\`\`` }
					catch { return `⚡ BG PID=${bgPids[i]}: ${bgCommands[i]?.substring(0,50)} log not readable` }
				}).join('\n\n')
			}
			resolve({ result: `❌ Command timed out after ${timeout / 1000}s.\n\nPartial output:\n${output.substring(0, 4000)}${bgTimeoutSection}`, filesCreated: 0 })
		}, timeout)

		child.on("close", (code) => {
			clearTimeout(timeoutId)
			clearTimeout(warningId)
			
			// Close the streaming code block in UI
			io.emit("agent-message", {
				agentId: agentConfig.id,
				agentName: agentConfig.name,
				projectId: project.id,
				message: `\n\`\`\`\n`,
				timestamp: Date.now(),
				isStreaming: true,
			})

			io.emit("system-event", {
				type: code === 0 ? "command-complete" : "command-error",
				agentId: agentConfig.id,
				projectId: project.id,
				message: `${code === 0 ? "Completed" : "Failed"}: ${command}`,
				exitCode: code || 0,
				timestamp: Date.now(),
			})

			// For long output: keep first 4000 chars + last 2000 chars so the summary
			// (e.g. Jest test results) at the END of output is always visible.
			let displayOutput: string
			if (output.length > 6000) {
				const head = output.substring(0, 4000)
				const tail = output.substring(output.length - 2000)
				displayOutput = `${head}\n\n...(${output.length - 6000} bytes omitted)...\n\n${tail}`
			} else {
				displayOutput = output || "(no output)"
			}
			// Society Agent - Append bg process startup output so agent can see errors/status
			let bgSection = ''
			if (bgLogFiles.length > 0) {
				const bgParts: string[] = []
				for (let i = 0; i < bgLogFiles.length; i++) {
					const logPath = bgLogFiles[i]
					const pid = bgPids[i] ?? '?'
					const cmd = bgCommands[i]?.substring(0, 50) ?? ''
					try {
						const logContent = stripAnsiCodes(fs.readFileSync(logPath, 'utf8'))
						const lines = logContent.split('\n')
						// Show up to 80 lines; if more, show first 40 + last 40
						let preview: string
						if (lines.length > 80) {
							preview = [...lines.slice(0, 40), `...(${lines.length - 80} lines omitted)...`, ...lines.slice(-40)].join('\n')
						} else {
							preview = logContent || '(no output yet)'
						}
						bgParts.push(`⚡ BG process PID=${pid}: ${cmd}\n   log: ${logPath}\n\`\`\`\n${preview.substring(0, 3000)}\n\`\`\``)
					} catch {
						bgParts.push(`⚡ BG process PID=${pid}: ${cmd}\n   log: ${logPath} (not readable yet)`)
					}
				}
				bgSection = '\n\n' + bgParts.join('\n\n')
			}
			if (code === 0) {
				resolve({ result: `✅ Command completed.\n\`\`\`\n$ ${fixedCommand}\n${displayOutput}\n\`\`\`${bgSection}`, filesCreated: 0 })
			} else {
				resolve({ result: `❌ Command failed (exit ${code}).\n\`\`\`\n$ ${fixedCommand}\n${displayOutput}\n\`\`\`${bgSection}`, filesCreated: 0 })
			}
		})

		child.on("error", (err) => {
			clearTimeout(timeoutId)
			clearTimeout(warningId)
			resolve({ result: `❌ Command error: ${err.message}`, filesCreated: 0 })
		})
	})
	// Society Agent end
}

	// Society Agent start - Inter-agent communication tools
	case "ask_agent": {
			const { agent_id, question } = toolInput as { agent_id: string; question: string }
			const targetAgent = project.agents.find(a => a.id === agent_id)
			
			if (!targetAgent) {
				const available = project.agents.map(a => a.id).join(', ')
				return { result: `❌ Agent "${agent_id}" not found. Available agents: ${available}`, filesCreated: 0 }
			}
			
			if (targetAgent.id === agentConfig.id) {
				return { result: `❌ You cannot ask yourself questions. Save your own notes with write_file.`, filesCreated: 0 }
			}

			log.info(`[${agentConfig.name}] Asking ${targetAgent.name}: ${question.substring(0, 80)}...`)
			
			// Show in REQUESTER's panel: "I'm asking X..."
			io.emit("agent-message", {
				agentId: agentConfig.id,
				agentName: agentConfig.name,
				projectId: project.id,
				message: `\n💬 **Asking ${targetAgent.name}:** ${question}\n`,
				timestamp: Date.now(),
				isStreaming: false,
			})
			
			// Show in TARGET's panel: "X is asking me..."
			io.emit("agent-message", {
				agentId: targetAgent.id,
				agentName: targetAgent.name,
				projectId: project.id,
				message: `\n📨 **Question from ${agentConfig.name}:** ${question}\n`,
				timestamp: Date.now(),
				isStreaming: false,
			})

			try {
				const targetFolder = projectStore.agentHomeDir(project.id, targetAgent.id)
				const workspacePath = process.env.WORKSPACE_PATH || process.cwd()
				
				const answer = await createOneShot(
					workspacePath,
					`You are ${targetAgent.name}, role: ${targetAgent.role}. 
Your folder is: ${targetFolder}
Another agent (${agentConfig.name}) is asking you a question. Answer briefly and helpfully.
If you don't know, say so. Be concise.`,
					`[Question from ${agentConfig.name}]: ${question}`
				)
				
				// Show answer in REQUESTER's panel (the agent who asked)
				io.emit("agent-message", {
					agentId: agentConfig.id,
					agentName: agentConfig.name,
					projectId: project.id,
					message: `\n✅ **${targetAgent.name} replied:**\n${answer || '(no response)'}\n`,
					timestamp: Date.now(),
					isStreaming: false,
				})
				
				// Also show in TARGET's panel so they see what they "said"
				io.emit("agent-message", {
					agentId: targetAgent.id,
					agentName: targetAgent.name,
					projectId: project.id,
					message: `\n📤 **My reply to ${agentConfig.name}:**\n${answer || '(no response)'}\n`,
					timestamp: Date.now(),
					isStreaming: false,
				})

				log.info(`[${agentConfig.name}] Got reply from ${targetAgent.name}: ${(answer || '').substring(0, 80)}...`)
				return { result: `📨 **Response from ${targetAgent.name}:**\n${answer || '(no response)'}`, filesCreated: 0 }
			} catch (err: any) {
				log.error(`[${agentConfig.name}] ask_agent failed:`, err)
				
				// Show error in both panels
				const errorMsg = `❌ Failed to reach ${targetAgent.name}: ${err.message}`
				io.emit("agent-message", {
					agentId: agentConfig.id,
					agentName: agentConfig.name,
					projectId: project.id,
					message: `\n${errorMsg}\n`,
					timestamp: Date.now(),
					isStreaming: false,
				})
				
				return { result: errorMsg, filesCreated: 0 }
			}
		}

		case "list_agents": {
			const agents = project.agents.map(a => {
				const isSelf = a.id === agentConfig.id
				return `- **${a.name}** (${a.id})${isSelf ? ' ← you' : ''}\n  Role: ${a.role}`
			}).join('\n')
			return { result: `📋 **Agents in project "${project.name}":**\n${agents}`, filesCreated: 0 }
		}

		case "list_team": {
			// Show persistent team members that report to this agent or are siblings
			const myId = agentConfig.id
			const subordinates = project.agents.filter(a => !a.ephemeral && a.reportsTo === myId)
			const siblings = agentConfig.reportsTo 
				? project.agents.filter(a => !a.ephemeral && a.reportsTo === agentConfig.reportsTo && a.id !== myId)
				: []
			
			let result = `👥 **Your Team:**\n`
			if (subordinates.length > 0) {
				result += `\n**Subordinates (report to you):**\n`
				result += subordinates.map(a => `- **${a.name}** (${a.id}) - ${a.role}`).join('\n')
			} else {
				result += `\nNo subordinates.`
			}
			
			if (siblings.length > 0) {
				result += `\n\n**Peers (same level):**\n`
				result += siblings.map(a => `- **${a.name}** (${a.id}) - ${a.role}`).join('\n')
			}
			
			return { result, filesCreated: 0 }
		}

		// Society Agent start - Agent configuration tools
		case "get_agent_info": {
			const { agent_id } = toolInput as { agent_id: string }
			
			const targetAgent = project.agents.find(a => a.id === agent_id)
			if (!targetAgent) {
				const available = project.agents.filter(a => !a.ephemeral).map(a => `  - ${a.id}: ${a.name}`).join('\n')
				return { result: `❌ Agent "${agent_id}" not found.\n\nAvailable agents:\n${available}`, filesCreated: 0 }
			}
			
			// Permission check: can view self, subordinates, or peers
			const isSelf = agent_id === agentConfig.id
			const isSubordinate = targetAgent.reportsTo === agentConfig.id
			const isPeer = targetAgent.reportsTo === agentConfig.reportsTo
			const isSupervisor = agentConfig.reportsTo === agent_id
			if (!isSelf && !isSubordinate && !isPeer && !isSupervisor) {
				return { result: `❌ You can only view info for yourself, your supervisor, your subordinates, or your peers.`, filesCreated: 0 }
			}
			
			let result = `📋 **Agent: ${targetAgent.name}** (\`${targetAgent.id}\`)\n\n`
			result += `**Role:** ${targetAgent.role}\n`
			result += `**Home Folder:** \`${targetAgent.homeFolder}\`\n`
			result += `**Reports To:** ${targetAgent.reportsTo || "(top-level)"}\n`
			result += `**Ephemeral:** ${targetAgent.ephemeral ? "Yes" : "No"}\n`
			if (targetAgent.model) result += `**Model:** ${targetAgent.model}\n`
			
			if (targetAgent.customInstructions) {
				result += `\n**Custom Instructions:**\n\`\`\`\n${targetAgent.customInstructions}\n\`\`\``
			} else {
				result += `\n**Custom Instructions:** _(none set)_`
			}
			
			// Show subordinates if any
			const subordinates = project.agents.filter(a => !a.ephemeral && a.reportsTo === agent_id)
			if (subordinates.length > 0) {
				result += `\n\n**Subordinates:** ${subordinates.map(a => `${a.name} (${a.id})`).join(", ")}`
			}
			
			return { result, filesCreated: 0 }
		}

		case "set_agent_instructions": {
			const { agent_id, instructions, mode } = toolInput as { agent_id: string; instructions: string; mode?: "replace" | "append" }
			
			const targetAgent = project.agents.find(a => a.id === agent_id)
			if (!targetAgent) {
				const available = project.agents.filter(a => !a.ephemeral).map(a => `  - ${a.id}: ${a.name}`).join('\n')
				return { result: `❌ Agent "${agent_id}" not found.\n\nAvailable agents:\n${available}`, filesCreated: 0 }
			}
			
			// Permission check:
			// - Top-level supervisor (no boss) can edit ANY agent including self
			// - Regular supervisors can only edit direct subordinates
			const isTopLevel = !agentConfig.reportsTo
			const isDirectSubordinate = targetAgent.reportsTo === agentConfig.id
			const isSelf = targetAgent.id === agentConfig.id
			
			if (!isTopLevel && !isDirectSubordinate) {
				if (isSelf) {
					return { result: `❌ You cannot modify your own instructions. Ask your supervisor to update them.`, filesCreated: 0 }
				}
				return { result: `❌ You can only set instructions for your direct subordinates. "${targetAgent.name}" reports to "${targetAgent.reportsTo || "(no one)"}".`, filesCreated: 0 }
			}
			
			// Build new instructions based on mode
			const existingInstructions = targetAgent.customInstructions || ""
			const useAppend = mode === "append"
			const newInstructions = useAppend && existingInstructions 
				? `${existingInstructions}\n\n${instructions}`
				: instructions
			
			// Update in project store (persisted to disk)
			projectStore.updateAgent(project.id, agent_id, { customInstructions: newInstructions })
			
			// Also update in-memory agent config
			targetAgent.customInstructions = newInstructions
			
			const action = useAppend ? "appended to" : "set for"
			const selfNote = isSelf ? " (self)" : ""
			let result = `✅ Instructions ${action} **${targetAgent.name}**${selfNote} (\`${agent_id}\`).\n\n`
			result += `**Current Instructions:**\n\`\`\`\n${newInstructions}\n\`\`\`\n\n`
			result += isSelf 
				? `💡 These take effect on your next conversation.`
				: `💡 These take effect on the agent's next conversation. Consider notifying them via \`send_message\`.`
			
			log.info(`[set_agent_instructions] ${agentConfig.name} ${action} ${targetAgent.name}${selfNote}: ${instructions.substring(0, 100)}...`)
			
			return { result, filesCreated: 0 }
		}
		// Society Agent end

		// Society Agent start - Allow workers to READ from project (other agents' folders)
		case "read_project_file": {
			let { path: filePath } = toolInput as { path: string }
			if (typeof filePath !== "string") {
				filePath = ""
			}
			if (filePath.trim().length === 0) {
				return { result: `❌ Missing required parameter: \`path\`. Example: read_project_file({ path: "backend/PLAN.md" })`, filesCreated: 0 }
			}
			const workspacePath = process.env.WORKSPACE_PATH || process.cwd()
			const projectDir = path.join(workspacePath, "projects", project.folder || project.id)
			const projectId = project.folder || project.id
			
			// Society Agent - Fix: Strip various incorrect "projects" prefixes
			// Agent might pass: "projects/architect/...", "projects/...", or just "projects"
			const projectPrefix = `projects/${projectId}/`
			if (filePath.startsWith(projectPrefix)) {
				filePath = filePath.substring(projectPrefix.length)
				log.info(`[Worker ${agentConfig.name}] Stripped redundant prefix from path: ${toolInput.path} -> ${filePath}`)
			} else if (filePath === `projects/${projectId}` || filePath === `projects/${projectId}/`) {
				// Agent trying to read project root with full path
				filePath = ""
				log.info(`[Worker ${agentConfig.name}] Stripped project path to root: ${toolInput.path} -> (root)`)
			} else if (filePath.startsWith("projects/")) {
				// Might be "projects/somefile.ts" - strip "projects/" and see if it's a partial project name
				const afterProjects = filePath.substring("projects/".length)
				const parts = afterProjects.split("/")
				// Check if first part matches or partially matches the project id
				if (parts[0] === projectId || parts[0].toLowerCase() === projectId.toLowerCase()) {
					filePath = parts.slice(1).join("/")
					log.info(`[Worker ${agentConfig.name}] Stripped projects/project prefix: ${toolInput.path} -> ${filePath || "(root)"}`)
				} else {
					// Just strip "projects/" entirely - agent is confused
					filePath = afterProjects
					log.info(`[Worker ${agentConfig.name}] Stripped bare projects/ prefix: ${toolInput.path} -> ${filePath}`)
				}
			} else if (filePath === "projects") {
				// Agent trying to use "projects" to mean project root
				filePath = ""
				log.info(`[Worker ${agentConfig.name}] Replaced 'projects' with root: ${toolInput.path} -> (root)`)
			}
			// Also handle absolute paths
			if (filePath.startsWith(workspacePath)) {
				const relativePath = filePath.substring(workspacePath.length).replace(/^\//, "")
				if (relativePath.startsWith(`projects/${project.folder || project.id}/`)) {
					filePath = relativePath.substring(`projects/${project.folder || project.id}/`.length)
					log.info(`[Worker ${agentConfig.name}] Converted absolute to relative path: ${toolInput.path} -> ${filePath}`)
				}
			}
			
			// Society Agent - Auto-correct partial folder names (e.g., "frontend" -> "frontend-specialist")
			const pathParts = filePath.split("/")
			let folderCorrectionNote = "" // Track if we auto-corrected for error messages
			if (pathParts.length > 0) {
				const firstDir = pathParts[0]
				const firstDirPath = path.join(projectDir, firstDir)
				if (!fs.existsSync(firstDirPath) && firstDir.length > 2) {
					// Look for a folder that contains this name
					try {
						const projectFolders = fs.readdirSync(projectDir, { withFileTypes: true })
							.filter(d => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules")
							.map(d => d.name)
						// Generic matching: folder starts with input, or folder contains input
						const matchingFolder = projectFolders.find(f => 
							f.startsWith(firstDir) || f.toLowerCase().includes(firstDir.toLowerCase())
						)
						if (matchingFolder && matchingFolder !== firstDir) {
							pathParts[0] = matchingFolder
							const oldFilePath = filePath
							filePath = pathParts.join("/")
							folderCorrectionNote = `\n📝 Note: "${firstDir}" was auto-corrected to "${matchingFolder}" (folder exists)`
							log.warn(`[Worker ${agentConfig.name}] Auto-corrected folder name: ${oldFilePath} -> ${filePath}`)
						}
					} catch { /* ignore errors in folder listing */ }
				}
			}
			
			const fullPath = path.join(projectDir, filePath)
			
			// Security: ensure path is within project folder
			if (!fullPath.startsWith(projectDir)) {
				return { result: `❌ Error: Cannot read files outside the project`, filesCreated: 0 }
			}
			
			// Society Agent - Hierarchical visibility check
			const visibilityCheck = canAgentAccessPath(agentConfig, project, filePath)
			if (!visibilityCheck.allowed) {
				log.warn(`[Agent ${agentConfig.name}] Visibility blocked: ${filePath} - ${visibilityCheck.reason}`)
				return { result: `❌ ${visibilityCheck.reason}`, filesCreated: 0 }
			}
			
			try {
				if (!fs.existsSync(fullPath)) {
					// Society Agent - Suggest available files/folders when file not found
					const pathParts = filePath.split("/")
					const fileName = pathParts[pathParts.length - 1]
					const parentPath = pathParts.length > 1 
						? path.join(projectDir, ...pathParts.slice(0, -1))
						: projectDir
					
					let suggestion = ""
					if (fs.existsSync(parentPath)) {
						// Parent directory exists, show what's actually in it
						const items = fs.readdirSync(parentPath, { withFileTypes: true })
							.filter(d => !d.name.startsWith(".") && d.name !== "node_modules")
						const folders = items.filter(d => d.isDirectory()).map(d => d.name)
						const files = items.filter(d => d.isFile()).map(d => d.name)
						
						suggestion = `\n\n📁 Available in ${pathParts.length > 1 ? pathParts.slice(0, -1).join("/") : "project root"}:`
						if (folders.length > 0) {
							suggestion += `\n**Folders:** ${folders.map(f => f + "/").join(", ")}`
						}
						if (files.length > 0) {
							suggestion += `\n**Files:** ${files.slice(0, 20).join(", ")}${files.length > 20 ? "..." : ""}`
						}
					} else {
						// Parent doesn't exist - show project folders
						const projectFolders = fs.readdirSync(projectDir, { withFileTypes: true })
							.filter(d => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules")
							.map(d => d.name)
						const firstDir = pathParts[0]
						const similarFolders = projectFolders.filter(f => 
							f.toLowerCase().includes(firstDir.toLowerCase()) || firstDir.toLowerCase().includes(f.split("-")[0].toLowerCase())
						)
						
						if (similarFolders.length > 0 && !projectFolders.includes(firstDir)) {
							suggestion = `\n\n💡 Did you mean one of these?\n${similarFolders.map(f => "  - " + f + "/").join("\n")}`
						} else if (projectFolders.length > 0) {
							suggestion = `\n\n📁 Available folders in project:\n${projectFolders.map(f => "  - " + f + "/").join("\n")}`
						}
					}
					
					return { result: `❌ File not found: ${filePath}${folderCorrectionNote}${suggestion}`, filesCreated: 0 }
				}
				// Detect directory and return a listing instead of an EISDIR error
				const stat = fs.statSync(fullPath)
				if (stat.isDirectory()) {
					const items = fs.readdirSync(fullPath, { withFileTypes: true })
						.filter(d => !d.name.startsWith(".") && d.name !== "node_modules")
					const folders = items.filter(d => d.isDirectory()).map(d => d.name + "/")
					const files = items.filter(d => d.isFile()).map(d => d.name)
					const listing = [...folders, ...files].join("\n")
					return { result: `📁 **${filePath}** is a directory. Use list_project_files to explore it, or specify a file path.\n\nContents:\n${listing || "(empty)"}`, filesCreated: 0 }
				}
				const content = fs.readFileSync(fullPath, "utf-8")
				const truncated = content.length > 15000 
					? content.substring(0, 15000) + "\n...(truncated, file is " + content.length + " bytes)"
					: content
				return { result: `📄 **${filePath}** (READ ONLY):\n\`\`\`\n${truncated}\n\`\`\``, filesCreated: 0 }
			} catch (err: any) {
				return { result: `❌ Error reading file: ${err.message}`, filesCreated: 0 }
			}
		}

		case "list_project_files": {
			let { path: dirPath } = toolInput as { path: string }
			const workspacePath = process.env.WORKSPACE_PATH || process.cwd()
			const projectDir = path.join(workspacePath, "projects", project.folder || project.id)
			const projectId = project.folder || project.id
			
			// Society Agent - Fix: Strip various incorrect "projects" prefixes
			const projectPrefix = `projects/${projectId}/`
			if (dirPath && dirPath.startsWith(projectPrefix)) {
				dirPath = dirPath.substring(projectPrefix.length)
				log.info(`[Worker ${agentConfig.name}] Stripped redundant prefix from dirPath: ${toolInput.path} -> ${dirPath}`)
			} else if (dirPath === `projects/${projectId}` || dirPath === `projects/${projectId}/`) {
				dirPath = ""
				log.info(`[Worker ${agentConfig.name}] Stripped project path to root: ${toolInput.path} -> (root)`)
			} else if (dirPath && dirPath.startsWith("projects/")) {
				const afterProjects = dirPath.substring("projects/".length)
				const parts = afterProjects.split("/")
				if (parts[0] === projectId || parts[0].toLowerCase() === projectId.toLowerCase()) {
					dirPath = parts.slice(1).join("/")
					log.info(`[Worker ${agentConfig.name}] Stripped projects/project prefix: ${toolInput.path} -> ${dirPath || "(root)"}`)
				} else {
					dirPath = afterProjects
					log.info(`[Worker ${agentConfig.name}] Stripped bare projects/ prefix: ${toolInput.path} -> ${dirPath}`)
				}
			} else if (dirPath === "projects") {
				dirPath = ""
				log.info(`[Worker ${agentConfig.name}] Replaced 'projects' with root: ${toolInput.path} -> (root)`)
			}
			if (dirPath && dirPath.startsWith(workspacePath)) {
				const relativePath = dirPath.substring(workspacePath.length).replace(/^\//, "")
				if (relativePath.startsWith(`projects/${projectId}/`)) {
					dirPath = relativePath.substring(`projects/${projectId}/`.length)
				}
			}
			
			// Society Agent - Auto-correct partial folder names (e.g., "frontend" -> "frontend-specialist")
			if (dirPath) {
				const pathParts = dirPath.split("/")
				if (pathParts.length > 0) {
					const firstDir = pathParts[0]
					const firstDirPath = path.join(projectDir, firstDir)
					if (!fs.existsSync(firstDirPath) && firstDir.length > 2) {
						try {
							const projectFolders = fs.readdirSync(projectDir, { withFileTypes: true })
								.filter(d => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules")
								.map(d => d.name)
							// Generic matching: folder starts with input, or folder contains input
							const matchingFolder = projectFolders.find(f => 
								f.startsWith(firstDir) || f.toLowerCase().includes(firstDir.toLowerCase())
							)
							if (matchingFolder && matchingFolder !== firstDir) {
								pathParts[0] = matchingFolder
								const oldDirPath = dirPath
								dirPath = pathParts.join("/")
								log.warn(`[Worker ${agentConfig.name}] Auto-corrected folder name: ${oldDirPath} -> ${dirPath}`)
							}
						} catch { /* ignore errors */ }
					}
				}
			}
			
			const fullPath = path.join(projectDir, dirPath || ".")
			
			// Security: ensure path is within project folder
			if (!fullPath.startsWith(projectDir)) {
				return { result: `❌ Error: Cannot list files outside the project`, filesCreated: 0 }
			}
			
			// Society Agent - Hierarchical visibility check (special handling for root)
			const isRootListing = !dirPath || dirPath === "." || dirPath === "/"
			const accessibleFolders = getAgentAccessibleFolders(agentConfig, project)
			const hasFullAccess = accessibleFolders.length === 0 // Empty = full access
			
			if (!isRootListing) {
				// For non-root listings, check visibility
				const visibilityCheck = canAgentAccessPath(agentConfig, project, dirPath || "")
				if (!visibilityCheck.allowed) {
					log.warn(`[Agent ${agentConfig.name}] Visibility blocked: ${dirPath} - ${visibilityCheck.reason}`)
					return { result: `❌ ${visibilityCheck.reason}`, filesCreated: 0 }
				}
			}
			
			try {
				if (!fs.existsSync(fullPath)) {
					// Society Agent - Suggest available folders when directory not found
					let projectFolders = fs.readdirSync(projectDir, { withFileTypes: true })
						.filter(d => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules")
						.map(d => d.name)
					// Filter for visibility if not full access
					if (!hasFullAccess) {
						projectFolders = projectFolders.filter(f => accessibleFolders.includes(f))
					}
					let suggestion = ""
					if (projectFolders.length > 0) {
						suggestion = `\n\n📁 Available folders in project:\n${projectFolders.map(f => `  - ${f}/`).join("\n")}`
					}
					return { result: `❌ Directory not found: ${dirPath}${suggestion}`, filesCreated: 0 }
				}
				let items = fs.readdirSync(fullPath, { withFileTypes: true })
				// Filter out noise
				const ignoreDirs = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', 'coverage', '__pycache__'])
				
				// Filter for visibility if listing root and not full access
				if (isRootListing && !hasFullAccess) {
					items = items.filter(i => {
						if (!i.isDirectory()) return false // Only show accessible folders at root
						return accessibleFolders.includes(i.name)
					})
				}
				
				const listing = items
					.filter(i => {
						if (i.name.startsWith(".") && i.name !== ".env") return false
						if (i.isDirectory() && ignoreDirs.has(i.name)) return false
						return true
					})
					.map(i => i.isDirectory() ? `📁 ${i.name}/` : `📄 ${i.name}`)
					.join("\n")
				const visibilityNote = (!hasFullAccess && isRootListing) 
					? `\n\n📝 _Note: Showing only folders you have access to._` 
					: ""
				return { result: `📂 **Project: ${dirPath || "."}** (READ ONLY):\n${listing || "(empty)"}${visibilityNote}`, filesCreated: 0 }
			} catch (err: any) {
				return { result: `❌ Error listing directory: ${err.message}`, filesCreated: 0 }
			}
		}

		case "list_agent_files": {
			const { agent_id, path: dirPath } = toolInput as { agent_id: string; path?: string }
			const targetAgentDir = projectStore.agentHomeDir(project.id, agent_id)
			const fullPath = path.join(targetAgentDir, dirPath || ".")
			
			// Security: ensure path is within agent folder
			if (!fullPath.startsWith(targetAgentDir)) {
				return { result: `❌ Error: Cannot list files outside the agent's directory`, filesCreated: 0 }
			}
			
			try {
				if (!fs.existsSync(fullPath)) {
					return { result: `❌ Directory not found: ${dirPath || "."}`, filesCreated: 0 }
				}
				const items = fs.readdirSync(fullPath, { withFileTypes: true })
				// Filter out noise
				const ignoreDirs = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', 'coverage', '__pycache__'])
				const listing = items
					.filter(i => {
						if (i.name.startsWith(".") && i.name !== ".env") return false
						if (i.isDirectory() && ignoreDirs.has(i.name)) return false
						return true
					})
					.map(i => i.isDirectory() ? `📁 ${i.name}/` : `📄 ${i.name}`)
					.join("\n")
				return { result: `📂 **Agent ${agent_id}: ${dirPath || "."}**\n${listing || "(empty)"}`, filesCreated: 0 }
			} catch (err: any) {
				return { result: `❌ Error listing directory: ${err.message}`, filesCreated: 0 }
			}
		}
		// Society Agent end

		// Society Agent start - Global skills implementations
		case "list_global_skills": {
			const workspacePath = process.env.WORKSPACE_PATH || process.cwd()
			const globalSkillsDir = path.join(workspacePath, "skills")
			
			try {
				if (!fs.existsSync(globalSkillsDir)) {
					return { result: `📭 No global skills folder exists yet.\n\nGlobal skills are user-managed. Ask the user to create skills/ folder with shared skills.`, filesCreated: 0 }
				}
				const items = fs.readdirSync(globalSkillsDir, { withFileTypes: true })
				const skills = items.filter(i => i.isDirectory())
				if (skills.length === 0) {
					return { result: `📭 Global skills folder exists but is empty.`, filesCreated: 0 }
				}
				
				// Read each skill's description from SKILL.md frontmatter
				const skillList = skills.map(s => {
					const skillPath = path.join(globalSkillsDir, s.name, "SKILL.md")
					let desc = "(no description)"
					if (fs.existsSync(skillPath)) {
						const content = fs.readFileSync(skillPath, "utf-8")
						const match = content.match(/description:\s*(.+)/)
						if (match) desc = match[1].trim()
					}
					return `- **${s.name}**: ${desc}`
				}).join("\n")
				
				return { result: `🌐 **Global Skills** (READ ONLY - shared across all projects):\n\n${skillList}\n\nUse \`read_global_skill(skill_name)\` to read the full skill.\n\n⚠️ You can READ global skills but cannot CREATE them. To create a new project-specific skill, use \`write_file("skills/name/SKILL.md", ...)\``, filesCreated: 0 }
			} catch (err: any) {
				return { result: `❌ Error listing global skills: ${err.message}`, filesCreated: 0 }
			}
		}

		case "read_global_skill": {
			const { skill_name } = toolInput as { skill_name: string }
			const workspacePath = process.env.WORKSPACE_PATH || process.cwd()
			const skillPath = path.join(workspacePath, "skills", skill_name, "SKILL.md")
			
			// Security: sanitize skill_name to prevent path traversal
			if (skill_name.includes("..") || skill_name.includes("/")) {
				return { result: `❌ Invalid skill name. Use just the skill folder name (e.g. 'compile-latex')`, filesCreated: 0 }
			}
			
			try {
				if (!fs.existsSync(skillPath)) {
					return { result: `❌ Global skill not found: ${skill_name}\n\nUse \`list_global_skills()\` to see available skills.`, filesCreated: 0 }
				}
				const content = fs.readFileSync(skillPath, "utf-8")
				return { result: `🌐 **Global Skill: ${skill_name}** (READ ONLY):\n\n${content}`, filesCreated: 0 }
			} catch (err: any) {
				return { result: `❌ Error reading global skill: ${err.message}`, filesCreated: 0 }
			}
		}
		// Society Agent end - Global skills

		// Society Agent start - MCP tool implementations
		case "list_mcps": {
			try {
				const mcpManager = getMcpManager()
				const result = mcpManager.listMcps(project.id)
				return { result, filesCreated: 0 }
			} catch (err: any) {
				return { result: `❌ MCP error: ${err.message}`, filesCreated: 0 }
			}
		}

		case "list_mcp_tools": {
			const { server_name } = toolInput as { server_name: string }
			try {
				const mcpManager = getMcpManager()
				const result = await mcpManager.listMcpTools(server_name, project.id)
				return { result, filesCreated: 0 }
			} catch (err: any) {
				return { result: `❌ Failed to list MCP tools: ${err.message}`, filesCreated: 0 }
			}
		}

		case "use_mcp": {
			const { server_name, tool_name, params } = toolInput as { server_name: string; tool_name: string; params?: any }
			
			// Society Agent - Apply rate limiting for MCP tools
			const rateCheck = checkMcpRateLimit(agentConfig.id, server_name)
			if (!rateCheck.allowed) {
				log.warn(`[MCP] Rate limit hit for ${agentConfig.id}:${server_name}`)
				return { result: rateCheck.message!, filesCreated: 0 }
			}
			
			// Society Agent - Redirect Playwright screenshot/snapshot filenames to agent's folder
			let adjustedParams = params || {}
			if (server_name === "playwright" && (tool_name === "browser_take_screenshot" || tool_name === "browser_snapshot")) {
				const screenshotDir = path.join(agentFolder, "screenshots")
				if (!fs.existsSync(screenshotDir)) {
					fs.mkdirSync(screenshotDir, { recursive: true })
				}
				if (adjustedParams.filename) {
					// Redirect provided filename to agent's screenshots folder
					adjustedParams = { ...adjustedParams, filename: path.join(screenshotDir, path.basename(adjustedParams.filename)) }
				} else {
					// Provide default filename in agent's folder
					const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
					adjustedParams = { ...adjustedParams, filename: path.join(screenshotDir, `${tool_name}-${timestamp}.png`) }
				}
				log.info(`[MCP] Screenshot path: ${adjustedParams.filename}`)
			}
			
			try {
				const mcpManager = getMcpManager()
				const result = await mcpManager.useMcp(server_name, tool_name, adjustedParams, project.id)
				resetMcpErrors(agentConfig.id, server_name) // Success - reset error count
				return { result, filesCreated: 0 }
			} catch (err: any) {
				const hitErrorLimit = recordMcpError(agentConfig.id, server_name)
				if (hitErrorLimit) {
					log.warn(`[MCP] Too many consecutive errors for ${agentConfig.id}:${server_name}`)
					return { result: `❌ MCP tool call failed: ${err.message}\n\n⚠️ **${MCP_MAX_CONSECUTIVE_ERRORS} consecutive errors.** Stop using ${server_name} and try a different approach.`, filesCreated: 0 }
				}
				return { result: `❌ MCP tool call failed: ${err.message}`, filesCreated: 0 }
			}
		}
		// Society Agent end - MCP

		// Society Agent start - Shared workspace tool implementations
		case "handoff_workspace": {
			const { task_description } = toolInput as { task_description: string }
			const registry = getProjectSharedWorkspaces(project.id)
			
			// Find shared workspace for this agent
			const workspace = registry.workspaces.find(
				w => w.supervisorId === agentConfig.id || w.subordinateId === agentConfig.id
			)
			
			if (!workspace) {
				return { result: `❌ You are not part of a shared workspace. This tool is only available when workspaceMode is "shared".`, filesCreated: 0 }
			}
			
			if (workspace.supervisorId !== agentConfig.id) {
				return { result: `❌ Only the supervisor (${workspace.supervisorId}) can hand off to the subordinate.`, filesCreated: 0 }
			}
			
			const result = handoffToSubordinate(registry, workspace.folder, agentConfig.id, task_description)
			
			if (!result.success) {
				return { result: `❌ Handoff failed: ${result.reason}`, filesCreated: 0 }
			}
			
			// Notify the subordinate
			const subordinate = project.agents.find(a => a.id === workspace.subordinateId)
			const message = `🔄 **Workspace handoff from ${agentConfig.name}**\n\n` +
				`You now have write access to ${workspace.folder}.\n\n` +
				`**Task:** ${task_description}\n\n` +
				`When done, use \`return_workspace\` to give control back.`
			
			io.emit("agent-message", {
				projectId: project.id,
				fromAgentId: agentConfig.id,
				toAgentId: workspace.subordinateId,
				message,
				timestamp: Date.now(),
			})
			
			return { 
				result: `✅ Workspace handed off to ${subordinate?.name || workspace.subordinateId}.\n\n` +
					`Phase: **implementation**\n` +
					`Task: ${task_description}\n\n` +
					`You now have READ-ONLY access. Wait for them to \`return_workspace\`.`,
				filesCreated: 0 
			}
		}
		
		case "return_workspace": {
			const { summary } = toolInput as { summary: string }
			const registry = getProjectSharedWorkspaces(project.id)
			
			// Find shared workspace for this agent
			const workspace = registry.workspaces.find(
				w => w.supervisorId === agentConfig.id || w.subordinateId === agentConfig.id
			)
			
			if (!workspace) {
				return { result: `❌ You are not part of a shared workspace. This tool is only available when workspaceMode is "shared".`, filesCreated: 0 }
			}
			
			if (workspace.subordinateId !== agentConfig.id) {
				return { result: `❌ Only the subordinate (${workspace.subordinateId}) can return to the supervisor.`, filesCreated: 0 }
			}
			
			const result = returnToSupervisor(registry, workspace.folder, agentConfig.id, summary)
			
			if (!result.success) {
				return { result: `❌ Return failed: ${result.reason}`, filesCreated: 0 }
			}
			
			// Notify the supervisor
			const supervisor = project.agents.find(a => a.id === workspace.supervisorId)
			const message = `🔄 **Workspace returned from ${agentConfig.name}**\n\n` +
				`You now have write access to ${workspace.folder} for review.\n\n` +
				`**Summary:** ${summary}`
			
			io.emit("agent-message", {
				projectId: project.id,
				fromAgentId: agentConfig.id,
				toAgentId: workspace.supervisorId,
				message,
				timestamp: Date.now(),
			})
			
			return { 
				result: `✅ Workspace returned to ${supervisor?.name || workspace.supervisorId}.\n\n` +
					`Phase: **review**\n` +
					`Summary: ${summary}\n\n` +
					`You now have READ-ONLY access.`,
				filesCreated: 0 
			}
		}
		
		case "workspace_status": {
			const registry = getProjectSharedWorkspaces(project.id)
			
			const workspace = registry.workspaces.find(
				w => w.supervisorId === agentConfig.id || w.subordinateId === agentConfig.id
			)
			
			if (!workspace) {
				return { result: `ℹ️ You are not part of a shared workspace. You have standard isolated workspace access.`, filesCreated: 0 }
			}
			
			const isSupervisor = workspace.supervisorId === agentConfig.id
			const hasAccess = workspace.activeAgentId === agentConfig.id
			const partner = isSupervisor ? workspace.subordinateId : workspace.supervisorId
			const partnerAgent = project.agents.find(a => a.id === partner)
			
			return {
				result: `📋 **Shared Workspace Status**\n\n` +
					`- **Folder:** ${workspace.folder}\n` +
					`- **Your role:** ${isSupervisor ? "Supervisor" : "Subordinate"}\n` +
					`- **Partner:** ${partnerAgent?.name || partner}\n` +
					`- **Current phase:** ${workspace.currentPhase}\n` +
					`- **Write access:** ${hasAccess ? "✅ YOU" : `❌ ${workspace.activeAgentId}`}\n` +
					`- **Phase started:** ${workspace.phaseStartedAt}\n\n` +
					(hasAccess && isSupervisor ? `💡 Use \`handoff_workspace\` when ready to delegate.` :
					 hasAccess && !isSupervisor ? `💡 Use \`return_workspace\` when done implementing.` :
					 `💡 Wait for workspace access or coordinate with ${partnerAgent?.name || partner}.`),
				filesCreated: 0
			}
		}
		// Society Agent end - Shared workspace tools

		// Society Agent start - Additional development tools implementations
		case "search_in_files": {
			const { pattern, path: searchPath, file_pattern } = toolInput as { pattern: string; path?: string; file_pattern?: string }
			const { execSync } = await import("child_process")
			
			let searchDir = agentFolder
			let singleFile: string | null = null
			if (searchPath?.startsWith("project:")) {
				const workspacePath = process.env.WORKSPACE_PATH || process.cwd()
				searchDir = path.join(workspacePath, "projects", project.folder || project.id)
			} else if (searchPath) {
				const resolved = path.join(agentFolder, searchPath)
				// Society Agent - Fix ENOTDIR: if path points to a file, use parent dir + target the file
				if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
					searchDir = path.dirname(resolved)
					singleFile = path.basename(resolved)
				} else {
					searchDir = resolved
				}
			}
			
			// Society Agent - Guard against non-existent searchDir (e.g. agent passed wrong path)
			if (!fs.existsSync(searchDir)) {
				// Suggest available directories
				let suggestion = ""
				if (fs.existsSync(agentFolder)) {
					const availableDirs = fs.readdirSync(agentFolder, { withFileTypes: true })
						.filter(d => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules")
						.map(d => d.name)
					if (availableDirs.length > 0) {
						suggestion = `\n\n📁 Available directories in your folder:\n${availableDirs.map(d => "  - " + d + "/").join("\n")}`
					}
				}
				return { result: `❌ Directory not found: ${searchPath}${suggestion}`, filesCreated: 0 }
			}
			
			try {
				const fileGlob = singleFile || file_pattern || "*"
				const searchTarget = singleFile ? singleFile : "."
				// Society Agent - Exclude node_modules, .git, dist, build, coverage from search
				const excludeDirs = "--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build --exclude-dir=coverage --exclude-dir=.next --exclude-dir=.cache"
				const cmd = singleFile
					? `grep -n "${pattern}" ${searchTarget} 2>/dev/null | head -50`
					: `grep -rn ${excludeDirs} --include="${fileGlob}" "${pattern}" . 2>/dev/null | head -50`
				const output = execSync(cmd, { cwd: searchDir, encoding: "utf-8", timeout: 30000 })
				return { result: output ? `🔍 **Search results for "${pattern}":**\n\`\`\`\n${output}\n\`\`\`` : `🔍 No matches found for "${pattern}"`, filesCreated: 0 }
			} catch (err: any) {
				if (err.status === 1) return { result: `🔍 No matches found for "${pattern}"`, filesCreated: 0 }
				return { result: `❌ Search error: ${err.message}`, filesCreated: 0 }
			}
		}

		// Society Agent start - find_files tool (excludes node_modules etc)
		case "find_files": {
			const { name_pattern, path: searchPath, type } = toolInput as { name_pattern: string; path?: string; type?: string }
			const { execSync } = await import("child_process")
			
			let searchDir = agentFolder
			if (searchPath?.startsWith("project:")) {
				const workspacePath = process.env.WORKSPACE_PATH || process.cwd()
				searchDir = path.join(workspacePath, "projects", project.folder || project.id)
			} else if (searchPath) {
				searchDir = path.join(agentFolder, searchPath)
			}
			
			// Check if directory exists before running find
			if (!fs.existsSync(searchDir)) {
				return { result: `❌ Directory not found: ${searchDir}\n\n💡 The directory may not exist yet. Create it first or check the path.`, filesCreated: 0 }
			}
			
			try {
				// Exclude common generated folders
				const excludes = "-not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/build/*' -not -path '*/coverage/*' -not -path '*/.next/*' -not -path '*/.cache/*'"
				const typeFlag = type === "directory" ? "-type d" : type === "any" ? "" : "-type f"
				const cmd = `find . ${typeFlag} -name "${name_pattern}" ${excludes} 2>/dev/null | head -100`
				const output = execSync(cmd, { cwd: searchDir, encoding: "utf-8", timeout: 30000 })
				const files = output.trim().split("\n").filter(f => f).map(f => f.replace(/^\.\//, ""))
				
				if (files.length === 0) {
					return { result: `🔍 No files found matching "${name_pattern}"`, filesCreated: 0 }
				}
				
				return { result: `🔍 **Found ${files.length} file(s) matching "${name_pattern}":**\n${files.map(f => `  ${f}`).join("\n")}`, filesCreated: 0 }
			} catch (err: any) {
				return { result: `❌ Find error: ${err.message}`, filesCreated: 0 }
			}
		}
		// Society Agent end

		case "delete_file": {
			const { path: filePath } = toolInput as { path: string }
			const fullPath = path.join(agentFolder, filePath)
			
			if (!fullPath.startsWith(agentFolder)) {
				return { result: `❌ Cannot delete files outside your folder`, filesCreated: 0 }
			}
			
			try {
				if (!fs.existsSync(fullPath)) {
					return { result: `❌ File not found: ${filePath}`, filesCreated: 0 }
				}
				const stat = fs.statSync(fullPath)
				if (stat.isDirectory()) {
					fs.rmdirSync(fullPath)
				} else {
					fs.unlinkSync(fullPath)
				}
				return { result: `✅ Deleted: ${filePath}`, filesCreated: 0 }
			} catch (err: any) {
				return { result: `❌ Error deleting: ${err.message}`, filesCreated: 0 }
			}
		}

		case "move_file": {
			const { from_path, to_path } = toolInput as { from_path: string; to_path: string }
			const fromFull = path.join(agentFolder, from_path)
			const toFull = path.join(agentFolder, to_path)
			
			if (!fromFull.startsWith(agentFolder) || !toFull.startsWith(agentFolder)) {
				return { result: `❌ Cannot move files outside your folder`, filesCreated: 0 }
			}
			
			try {
				if (!fs.existsSync(fromFull)) {
					return { result: `❌ Source not found: ${from_path}`, filesCreated: 0 }
				}
				const toDir = path.dirname(toFull)
				if (!fs.existsSync(toDir)) {
					fs.mkdirSync(toDir, { recursive: true })
				}
				fs.renameSync(fromFull, toFull)
				return { result: `✅ Moved: ${from_path} → ${to_path}`, filesCreated: 0 }
			} catch (err: any) {
				return { result: `❌ Error moving: ${err.message}`, filesCreated: 0 }
			}
		}

		case "http_request": {
			const { method, url, headers, body, timeout_ms } = toolInput as { 
				method: string; url: string; headers?: Record<string, string>; body?: string; timeout_ms?: number 
			}
			
			try {
				const controller = new AbortController()
				const timeout = setTimeout(() => controller.abort(), timeout_ms || 10000)
				
				const response = await fetch(url, {
					method: method.toUpperCase(),
					headers: headers || {},
					body: body || undefined,
					signal: controller.signal,
				})
				
				clearTimeout(timeout)
				const text = await response.text()
				const truncated = text.length > 3000 ? text.substring(0, 3000) + "\n...(truncated)" : text
				
				return { result: `📡 **${method.toUpperCase()} ${url}**\nStatus: ${response.status} ${response.statusText}\n\`\`\`\n${truncated}\n\`\`\``, filesCreated: 0 }
			} catch (err: any) {
				// Provide more helpful error messages for common issues
				let hint = ""
				if (err.message.includes("Headers constructor")) {
					hint = "\n\n💡 **Header format issue.** Headers must be a plain object like: { \"Content-Type\": \"application/json\" }"
				} else if (err.message.includes("aborted") || err.name === "AbortError") {
					hint = "\n\n💡 **Request timed out.** Try increasing timeout_ms or check if the server is running."
				} else if (err.message.includes("ECONNREFUSED")) {
					hint = "\n\n💡 **Connection refused.** The server may not be running. Check with `get_processes({ port: PORT })`"
				}
				return { result: `❌ Request failed: ${err.message}${hint}`, filesCreated: 0 }
			}
		}

		case "git_status": {
			const { project_root } = toolInput as { project_root?: boolean }
			const { execSync } = await import("child_process")
			
			let cwd = agentFolder
			if (project_root) {
				const workspacePath = process.env.WORKSPACE_PATH || process.cwd()
				cwd = path.join(workspacePath, "projects", project.folder || project.id)
			}
			
			try {
				const status = execSync("git status --short 2>/dev/null || echo '(not a git repo)'", { cwd, encoding: "utf-8" })
				const branch = execSync("git branch --show-current 2>/dev/null || echo 'unknown'", { cwd, encoding: "utf-8" })
				return { result: `📋 **Git Status** (branch: ${branch.trim()})\n\`\`\`\n${status || "(no changes)"}\n\`\`\``, filesCreated: 0 }
			} catch (err: any) {
				return { result: `❌ Git error: ${err.message}`, filesCreated: 0 }
			}
		}

		case "git_diff": {
			const { path: filePath, staged } = toolInput as { path?: string; staged?: boolean }
			const { execSync } = await import("child_process")
			
			try {
				const stagedFlag = staged ? "--cached " : ""
				const file = filePath || ""
				// Society Agent - Use workingFolder for git commands
				const diff = execSync(`git diff ${stagedFlag}${file} 2>/dev/null | head -100`, { cwd: workingFolder, encoding: "utf-8" })
				return { result: diff ? `📝 **Git Diff${filePath ? ` (${filePath})` : ""}:**\n\`\`\`diff\n${diff}\n\`\`\`` : `(no changes)`, filesCreated: 0 }
			} catch (err: any) {
				return { result: `❌ Git error: ${err.message}`, filesCreated: 0 }
			}
		}

		case "get_processes": {
			const { filter, port } = toolInput as { filter?: string; port?: number }
			const { execSync } = await import("child_process")
			
			// Society Agent - Include protected ports info in output
			const protectedPortsInfo = `\n\n⚠️ **Protected ports** (cannot be killed): ${[...PROTECTED_PORTS].join(", ")}`
			
			try {
				let cmd = "ps aux"
				let header = "🔄 **Processes:**"
				if (port) {
					cmd = `lsof -i :${port} 2>/dev/null || echo "Nothing on port ${port}"`
					// Check if this port is protected
					if (isPortProtected(port)) {
						header = `🔄 **Process on port ${port}** (⚠️ PROTECTED - cannot be killed):`
					} else {
						header = `🔄 **Process on port ${port}:**`
					}
				} else if (filter) {
					cmd = `ps aux | grep -i "${filter}" | grep -v grep | head -20`
				} else {
					cmd = "ps aux | head -20"
				}
				const output = execSync(cmd, { encoding: "utf-8", timeout: 5000 })
				return { result: `${header}\n\`\`\`\n${output}\n\`\`\`${protectedPortsInfo}`, filesCreated: 0 }
			} catch (err: any) {
				return { result: `❌ Error: ${err.message}`, filesCreated: 0 }
			}
		}

		case "kill_process": {
			const { pid, port, name } = toolInput as { pid?: number; port?: number; name?: string }
			const { execSync } = await import("child_process")
			
			// Society Agent - CRITICAL: Block killing protected ports and system processes
			const SYSTEM_PID = process.pid
			
			// Need at least one parameter
			if (!port && !pid && !name) {
				return { 
					result: `❌ **Specify port, pid, or name!**\n\nUse get_processes to see what's running:\n\n✅ kill_process({ port: 3000 })\n✅ kill_process({ name: "my-server" })\n\n⚠️ Protected ports (cannot be killed): ${[...PROTECTED_PORTS].join(", ")}`, 
					filesCreated: 0 
				}
			}
			
			// Block killing any protected port
			if (port && isPortProtected(port)) {
				log.warn(`[BLOCKED] Agent ${agentConfig.name} tried to kill protected port ${port}`)
				return { 
					result: `🚨 **BLOCKED: Port ${port} is protected!**\n\nProtected ports cannot be killed by agents.\n\nProtected ports: ${[...PROTECTED_PORTS].join(", ")}\n\n💡 To protect additional ports, set PROTECTED_PORTS environment variable:\n\`PROTECTED_PORTS=3000,5000,8080 npm start\``, 
					filesCreated: 0 
				}
			}
			
			// Check port ownership: only the allocating project can kill its ports
			if (port) {
				const canKill = PortManager.canProjectKillPort(port, project.id)
				if (!canKill.allowed) {
					log.warn(`[BLOCKED] Agent ${agentConfig.name} (project ${project.id}) tried to kill port ${port} owned by another project: ${canKill.reason}`)
					return {
						result: `🚨 **BLOCKED: Port ${port} belongs to another project!**\n\n${canKill.reason}\n\n✅ You can only kill ports allocated to YOUR project.\n✅ Use \`list_project_ports\` to see your ports.\n✅ Use \`request_port\` to allocate your own ports.`,
						filesCreated: 0
					}
				}
			}
			
			// Block killing the system's own PID
			if (pid === SYSTEM_PID) {
				log.warn(`[BLOCKED] Agent ${agentConfig.name} tried to kill system PID ${SYSTEM_PID}`)
				return { 
					result: `🚨 **BLOCKED: Cannot kill the system process itself!**\n\nPID ${SYSTEM_PID} is the Society Agent server.\n\n✅ Kill YOUR processes by their specific port\n❌ Never kill the system process`, 
					filesCreated: 0 
				}
			}
			
			// Block overly broad or system-targeting names
			if (name) {
				const dangerousNamePatterns = [
					/^node$/i,            // "node" alone matches everything including system
					/^npm$/i,             // npm processes
					/^tsx$/i,             // tsx is our runner
					/^ts-node$/i,         // ts-node processes
					/society/i,           // society-server
					/tsx.*server/i,       // tsx server patterns
					/4000/,               // port 4000 in name
					/society-server/i,    // explicit society-server
					/society-agent/i,     // society-agent folder/process
				]
				
				const nameBlocked = dangerousNamePatterns.some(p => p.test(name))
				if (nameBlocked) {
					log.warn(`[BLOCKED] Agent ${agentConfig.name} tried to kill with dangerous name pattern: "${name}"`)
					return { 
						result: `🚨 **BLOCKED: Cannot use "${name}" as process name!**\n\nThis pattern is too broad and would kill the Society Agent system.\n\n✅ Be specific: use your app's unique name like "my-server" or "express-app"\n✅ Or use kill_process({ port: YOUR_PORT })\n❌ Never use "node", "npm", "tsx", or "society"`, 
						filesCreated: 0 
					}
				}
			}
			// Society Agent end
			
			try {
				if (port) {
					const output = execSync(`lsof -ti :${port} | xargs kill 2>/dev/null && echo "Killed process on port ${port}" || echo "Nothing on port ${port}"`, { encoding: "utf-8" })
					return { result: output.trim(), filesCreated: 0 }
				} else if (pid) {
					execSync(`kill ${pid}`, { encoding: "utf-8" })
					return { result: `✅ Killed process ${pid}`, filesCreated: 0 }
				} else if (name) {
					const output = execSync(`pkill -f "${name}" && echo "Killed processes matching ${name}" || echo "No process found matching ${name}"`, { encoding: "utf-8" })
					return { result: output.trim(), filesCreated: 0 }
				} else {
					return { result: `❌ Specify port, pid, or name`, filesCreated: 0 }
				}
			} catch (err: any) {
				return { result: `❌ Error: ${err.message}`, filesCreated: 0 }
			}
		}

		case "get_file_info": {
			const { path: filePath } = toolInput as { path: string }
			const fullPath = path.join(agentFolder, filePath)
			
			try {
				const stat = fs.statSync(fullPath)
				let info = `📄 **${filePath}**\n`
				info += `- Size: ${stat.size} bytes\n`
				info += `- Modified: ${stat.mtime.toISOString()}\n`
				info += `- Type: ${stat.isDirectory() ? "directory" : "file"}\n`
				
				if (!stat.isDirectory()) {
					const content = fs.readFileSync(fullPath, "utf-8")
					const lines = content.split("\n").length
					info += `- Lines: ${lines}\n`
				}
				return { result: info, filesCreated: 0 }
			} catch (err: any) {
				return { result: `❌ Error: ${err.message}`, filesCreated: 0 }
			}
		}

		// Society Agent - Port allocation tools
		case "request_port": {
			const { service_name, description, port: preferredPort } = toolInput as { service_name: string; description?: string; port?: number }
			
			if (!service_name || typeof service_name !== "string") {
				return { result: `❌ service_name is required (e.g., "api", "frontend", "database")`, filesCreated: 0 }
			}
			
			try {
				const { port, isNew } = await PortManager.requestPort(project.id, service_name, {
					description,
					allocatedBy: agentConfig.id,
					preferredPort: preferredPort,
				})
				
				if (isNew) {
					return { 
						result: `✅ **Allocated port ${port}** for service "${service_name}"\n\n` +
							`This port is now protected - only your project can kill it.\n` +
							`Use this port in your server configuration.\n\n` +
							`Example: \`PORT=${port} npm start\``,
						filesCreated: 0 
					}
				} else {
					return { 
						result: `✅ **Port ${port}** is already allocated for service "${service_name}"\n\n` +
							`Same service = same port. Your port is protected.`,
						filesCreated: 0 
					}
				}
			} catch (err: any) {
				return { result: `❌ Port allocation failed: ${err.message}`, filesCreated: 0 }
			}
		}

		case "release_port": {
			const { port } = toolInput as { port: number }
			
			if (!port || typeof port !== "number") {
				return { result: `❌ port number is required`, filesCreated: 0 }
			}
			
			const result = PortManager.releasePort(port, project.id)
			
			if (result.success) {
				return { result: `✅ Released port ${port}. It's now available for other projects.`, filesCreated: 0 }
			} else {
				return { result: `❌ Cannot release port: ${result.reason}`, filesCreated: 0 }
			}
		}

		case "list_project_ports": {
			const allocations = PortManager.getProjectPorts(project.id)
			
			if (allocations.length === 0) {
				return { 
					result: `📭 No ports allocated to this project yet.\n\n` +
						`Use \`request_port({ service_name: "api" })\` to allocate a port for your service.`,
					filesCreated: 0 
				}
			}
			
			const { execSync } = await import("child_process")
			
			let result = `🔌 **Ports allocated to project "${project.id}":**\n\n`
			for (const alloc of allocations) {
				// Check if port is in use
				let status = "⚪ idle"
				try {
					execSync(`lsof -i :${alloc.port} 2>/dev/null`, { encoding: "utf-8" })
					status = "🟢 in use"
				} catch {
					// No process on port
				}
				
				result += `| Port ${alloc.port} | ${alloc.serviceName} | ${status} |\n`
				if (alloc.description) result += `|  | ${alloc.description} |\n`
				result += `|  | Allocated: ${alloc.allocatedAt} |\n`
			}
			
			result += `\n⚠️ These ports are protected - only your project can kill them.`
			return { result, filesCreated: 0 }
		}

		case "compare_files": {
			const { file1, file2 } = toolInput as { file1: string; file2: string }
			const { execSync } = await import("child_process")
			
			const path1 = path.join(agentFolder, file1)
			const path2 = path.join(agentFolder, file2)
			
			try {
				const diff = execSync(`diff -u "${path1}" "${path2}" 2>/dev/null | head -50 || echo "(files are identical or one doesn't exist)"`, { encoding: "utf-8" })
				return { result: `📝 **Diff: ${file1} vs ${file2}**\n\`\`\`diff\n${diff}\n\`\`\``, filesCreated: 0 }
			} catch (err: any) {
				return { result: `❌ Error: ${err.message}`, filesCreated: 0 }
			}
		}

		case "create_directory": {
			const { path: dirPath } = toolInput as { path: string }
			const fullPath = path.join(agentFolder, dirPath)
			
			if (!fullPath.startsWith(agentFolder)) {
				return { result: `❌ Cannot create directories outside your folder`, filesCreated: 0 }
			}
			
			try {
				fs.mkdirSync(fullPath, { recursive: true })
				return { result: `✅ Created directory: ${dirPath}`, filesCreated: 0 }
			} catch (err: any) {
				return { result: `❌ Error: ${err.message}`, filesCreated: 0 }
			}
		}
		// Society Agent end

		// Society Agent start - Worker send_message (triggers receiving agent)
		case "send_message": {
			const { agent_id, message, priority, wait_for_response } = toolInput as { agent_id: string; message: string; priority?: string; wait_for_response?: boolean }
			const targetAgent = project.agents.find(a => a.id === agent_id)

			if (!targetAgent) {
				return { result: `❌ Agent "${agent_id}" not found. Use list_agents to see available agents.`, filesCreated: 0 }
			}

			if (targetAgent.id === agentConfig.id) {
				return { result: `❌ You cannot message yourself. Save your own notes with write_file.`, filesCreated: 0 }
			}
			
			// Society Agent - Detect FORMAL task assignment disguised as a message
			// Allow: collaboration requests, API change requests, questions
			// Block: structured task assignments with formal task syntax
			const taskPatterns = [
				/^##?\s*task/im,                        // Markdown task header
				/task\s*(id|:)\s*\d/i,                  // "Task ID: 123" or "Task: 1"
				/desired\s*state\s*:/i,                 // Formal task structure
				/acceptance\s*criteria\s*:/i,          // Formal task structure
				/task\s*delegation\s*:/i,              // Explicit delegation
				/your\s+task\s+is\s+to\s/i,            // "Your task is to..."
				/i('m)?\s+(assigning|delegating)\s+(you|this)/i, // "I'm assigning you..."
			]
			const isPeer = targetAgent.reportsTo === agentConfig.reportsTo && targetAgent.reportsTo !== undefined
			const isSubordinate = targetAgent.reportsTo === agentConfig.id
			
			const looksLikeFormalTaskAssignment = taskPatterns.some(p => p.test(message))
			
			if (looksLikeFormalTaskAssignment && isPeer && !isSubordinate) {
				return {
					result: `⚠️ This message uses formal task assignment syntax, but you cannot assign tasks to peers.\n\n` +
						`✅ **You CAN ask peers for help:** "Can you add an endpoint for X?" or "Could you expose Y via API?"\n` +
						`📋 **Use \`delegate_task\`** for formal task assignments (only to your subordinates)\n` +
						`📋 **Tell your supervisor** if peer won't help or needs to prioritize your request\n\n` +
						`💡 Rephrase as a request/question rather than a formal task assignment.`,
					filesCreated: 0
				}
			}

			// If ephemeral worker, just save to inbox (they can't be triggered)
			if (targetAgent.ephemeral) {
				sendToInbox(project.id, { id: agentConfig.id, name: agentConfig.name }, agent_id, message, (priority as "normal" | "urgent") || "normal")
				return { result: `✅ Message saved to ${targetAgent.name}'s inbox (ephemeral worker - will see on next task).`, filesCreated: 0 }
			}

			io.emit("agent-message", {
				agentId: agentConfig.id,
				agentName: agentConfig.name,
				projectId: project.id,
				message: `\n📨 **Message sent to ${targetAgent.name}** ${priority === "urgent" ? "⚠️ URGENT" : ""}\n`,
				timestamp: Date.now(),
				isStreaming: true,
			})

			// Log incoming message in the TARGET agent's Activity log
			agentActivityLogger.logChatIn(
				project.id,
				targetAgent.id,
				project.folder || project.id,
				targetAgent.homeFolder || "/",
				`[Message from ${agentConfig.name}]\n\n${message}`,
				"agent",
				agentConfig.name,
				false,
			)

			// Execute the message via handleSupervisorChat for the target agent
			log.info(`[${agentConfig.name}] Sending message to ${targetAgent.name}: ${message.substring(0, 100)}...`)
			
			try {
				const messageApiKey = apiKey || process.env.ANTHROPIC_API_KEY || ""
				const result = await handleSupervisorChat(
					`[Message from ${agentConfig.name}]\n\n${message}`,
					targetAgent,
					project,
					messageApiKey,
					io,
				)
				
				// Log the response back in the SENDER's Activity log
				// This completes the message flow: send → receive → answer → answer_back
				const responsePreview = result.fullResponse.substring(0, 2000) + (result.fullResponse.length > 2000 ? '...(truncated)' : '')
				agentActivityLogger.logChatIn(
					project.id,
					agentConfig.id,  // Log in SENDER's activity
					project.folder || project.id,
					agentConfig.homeFolder || "/",
					`[Response from ${targetAgent.name}]\n\n${responsePreview}`,
					"agent",
					targetAgent.name,  // From the target agent
					false,
				)
				
				if (wait_for_response) {
					return { 
						result: `✅ **Message delivered to ${targetAgent.name}**\n\n**Response:**\n${result.fullResponse.substring(0, 1500)}${result.fullResponse.length > 1500 ? '...(truncated)' : ''}`, 
						filesCreated: result.totalFilesCreated 
					}
				} else {
					return { 
						result: `✅ Message delivered to ${targetAgent.name}. They created ${result.totalFilesCreated} file(s).`, 
						filesCreated: result.totalFilesCreated 
					}
				}
			} catch (err: any) {
				return { result: `❌ Message delivery failed: ${err.message}`, filesCreated: 0 }
			}
		}
		// Society Agent end

		// Society Agent start - Worker read_inbox
		case "read_inbox": {
			const { mark_read } = toolInput as { mark_read?: boolean }
			const messages = readInbox(project.id, agentConfig.id, mark_read !== false)

			if (messages.length === 0) {
				return { result: `📭 Your inbox is empty.`, filesCreated: 0 }
			}

			const formatted = messages.map(m => {
				const time = new Date(m.timestamp).toLocaleTimeString()
				const urgentFlag = m.priority === "urgent" ? " ⚠️ URGENT" : ""
				return `**From ${m.from.name}** (${time})${urgentFlag}:\n${m.message}`
			}).join("\n\n---\n\n")

			return { result: `📬 **${messages.length} message(s) in your inbox:**\n\n${formatted}`, filesCreated: 0 }
		}
		// Society Agent end

		// Society Agent start - Worker task pool tools
		case "claim_task": {
			const { task_id } = toolInput as { task_id?: string }
			
			// Only workers can claim tasks
			if (!agentConfig.isWorker) {
				return { result: `⚠️ Only workers can claim tasks. Use \`spawn_worker()\` to create workers that will claim and execute your tasks.`, filesCreated: 0 }
			}
			
			// Check if worker already has a task
			const existingTasks = projectStore.getTasks(project.id)
			const alreadyClaimed = existingTasks.find(t => t.claimedBy === agentConfig.id && ["claimed", "in-progress"].includes(t.status))
			if (alreadyClaimed) {
				return { result: `⚠️ You already have a task: "${alreadyClaimed.title}" (${alreadyClaimed.status})\n\nComplete it first with \`complete_task()\` or \`fail_task()\`.`, filesCreated: 0 }
			}
			
			// If this is a worker (has reportsTo), only claim tasks from their supervisor
			const supervisorId = agentConfig.reportsTo
			
			let task
			if (task_id) {
				// If specific task_id, verify it's from the supervisor (if worker)
				const targetTask = existingTasks.find(t => t.id === task_id)
				if (supervisorId && targetTask && targetTask.createdBy !== supervisorId) {
					return { result: `⚠️ You can only claim tasks created by your supervisor (${supervisorId}).`, filesCreated: 0 }
				}
				task = projectStore.claimTask(project.id, task_id, agentConfig.id)
			} else {
				// Auto-claim next task, filtered by supervisor if worker
				task = projectStore.claimNextTask(project.id, agentConfig.id, supervisorId)
			}
			
			if (!task) {
				const taskCount = existingTasks.filter(t => t.status === "available").length
				if (supervisorId && taskCount > 0) {
					return { result: `📋 No available tasks from your supervisor (${supervisorId}).\n\nThere are ${taskCount} tasks in the pool from other agents.\n\n💡 Your supervisor will add more tasks when ready.`, filesCreated: 0 }
				}
				return { result: `📋 No available tasks in pool. Waiting...\n\n💡 The supervisor will add more tasks when ready.`, filesCreated: 0 }
			}
			
			// Mark as in-progress
			projectStore.startTask(project.id, task.id)
			
			// Format task details
			let result = `🎯 **Task Claimed: ${task.title}**\n\n`
			result += `📋 **Description:**\n${task.description}\n\n`
			result += `📁 **Working Directory:** ${task.context.workingDirectory}\n\n`
			
			if (task.context.relevantFiles?.length) {
				result += `📖 **Files to read for context:**\n`
				for (const file of task.context.relevantFiles) {
					result += `  - ${file}\n`
				}
				result += `\n`
			}
			
			if (task.context.outputPaths && Object.keys(task.context.outputPaths).length) {
				result += `📝 **Expected outputs:**\n`
				for (const [filePath, desc] of Object.entries(task.context.outputPaths)) {
					result += `  - \`${filePath}\`: ${desc}\n`
				}
				result += `\n`
			}
			
			if (task.context.conventions) {
				result += `📐 **Conventions:** ${task.context.conventions}\n\n`
			}
			
			if (task.context.notes) {
				result += `📌 **Notes:** ${task.context.notes}\n\n`
			}
			
			result += `---\n💡 When done, call \`complete_task(files_created, files_modified, summary)\``
			
			io.emit("task-claimed", {
				projectId: project.id,
				taskId: task.id,
				agentId: agentConfig.id,
				agentName: agentConfig.name,
				taskTitle: task.title,
				taskDescription: task.description.substring(0, 500) + (task.description.length > 500 ? '...' : ''),
				timestamp: Date.now(),
			})
			
			return { result, filesCreated: 0 }
		}

		case "get_my_task": {
			const tasks = projectStore.getTasks(project.id)
			const myTask = tasks.find(t => t.claimedBy === agentConfig.id && ["claimed", "in-progress"].includes(t.status))
			
			if (!myTask) {
				return { result: `📋 You don't have a task. Use \`claim_task()\` to get one.`, filesCreated: 0 }
			}
			
			// Same format as claim_task
			let result = `🎯 **Your Task: ${myTask.title}** (${myTask.status})\n\n`
			result += `📋 **Description:**\n${myTask.description}\n\n`
			result += `📁 **Working Directory:** ${myTask.context.workingDirectory}\n\n`
			
			if (myTask.context.relevantFiles?.length) {
				result += `📖 **Files to read:**\n`
				for (const file of myTask.context.relevantFiles) {
					result += `  - ${file}\n`
				}
				result += `\n`
			}
			
			if (myTask.context.outputPaths && Object.keys(myTask.context.outputPaths).length) {
				result += `📝 **Expected outputs:**\n`
				for (const [filePath, desc] of Object.entries(myTask.context.outputPaths)) {
					result += `  - \`${filePath}\`: ${desc}\n`
				}
				result += `\n`
			}
			
			if (myTask.context.conventions) {
				result += `📐 **Conventions:** ${myTask.context.conventions}\n\n`
			}
			
			return { result, filesCreated: 0 }
		}

		case "complete_task": {
			const { files_created, files_modified, summary } = toolInput as {
				files_created?: string[]
				files_modified?: string[]
				summary: string
			}
			
			// Find worker's current task
			const tasks = projectStore.getTasks(project.id)
			const myTask = tasks.find(t => t.claimedBy === agentConfig.id && ["claimed", "in-progress"].includes(t.status))
			
			if (!myTask) {
				return { result: `❌ You don't have an active task to complete.`, filesCreated: 0 }
			}
			
			const result = {
				filesCreated: files_created || [],
				filesModified: files_modified || [],
				summary,
			}
			
			projectStore.completeTask(project.id, myTask.id, result)
			const reportOwnerId = myTask.createdBy || agentConfig.reportsTo || agentConfig.id
			const reportPath = writeChangeReportDoc(project, reportOwnerId, myTask, agentConfig.id, result)
			
			io.emit("task-completed", {
				projectId: project.id,
				taskId: myTask.id,
				agentId: agentConfig.id,
				taskTitle: myTask.title,
				result,
				timestamp: Date.now(),
			})
			
			// If ephemeral, schedule self-deletion
			if (agentConfig.ephemeral) {
				setTimeout(() => {
					projectStore.removeAgent(project.id, agentConfig.id)
					io.emit("agent-deleted", {
						projectId: project.id,
						agentId: agentConfig.id,
						reason: "task completed",
						timestamp: Date.now(),
					})
					log.info(`[Worker ${agentConfig.id}] Self-destructed after completing task`)
				}, 1000)
			}
			
			return { result: `✅ **Task completed: ${myTask.title}**\n\n📝 Summary: ${summary}\n📁 Files created: ${(files_created || []).length}\n📝 Files modified: ${(files_modified || []).length}${reportPath ? `\n📄 Report: ${reportPath}` : ""}\n\n${agentConfig.ephemeral ? '👋 You will now self-destruct. Goodbye!' : ''}`, filesCreated: 0 }
		}

		case "fail_task": {
			const { reason } = toolInput as { reason: string }
			
			// Find worker's current task
			const tasks = projectStore.getTasks(project.id)
			const myTask = tasks.find(t => t.claimedBy === agentConfig.id && ["claimed", "in-progress"].includes(t.status))
			
			if (!myTask) {
				return { result: `❌ You don't have an active task to fail.`, filesCreated: 0 }
			}
			
			projectStore.failTask(project.id, myTask.id, reason)
			
			io.emit("task-failed", {
				projectId: project.id,
				taskId: myTask.id,
				agentId: agentConfig.id,
				taskTitle: myTask.title,
				reason,
				timestamp: Date.now(),
			})
			
			// If ephemeral, schedule self-deletion
			if (agentConfig.ephemeral) {
				setTimeout(() => {
					projectStore.removeAgent(project.id, agentConfig.id)
					io.emit("agent-deleted", {
						projectId: project.id,
						agentId: agentConfig.id,
						reason: "task failed",
						timestamp: Date.now(),
					})
					log.info(`[Worker ${agentConfig.id}] Self-destructed after failing task`)
				}, 1000)
			}
			
			return { result: `❌ **Task failed: ${myTask.title}**\n\nReason: ${reason}\n\nThe task has been returned to the pool for another worker.${agentConfig.ephemeral ? '\n\n👋 You will now self-destruct.' : ''}`, filesCreated: 0 }
		}

		case "create_task": {
			const { title, description, priority = 5, working_directory } = toolInput as {
				title: string
				description: string
				priority?: number
				working_directory?: string
			}
			
			// Workers will write to their parent's folder - working_directory is just informational
			const context: TaskContext = {
				workingDirectory: working_directory || ".",
				conventions: (project as any).conventions,
			}
			
			const task = projectStore.createTask(
				project.id,
				agentConfig.id,
				title,
				description,
				context,
				priority
			)
			
			if (!task) {
				return { result: `❌ Failed to create task. Project may not exist.`, filesCreated: 0 }
			}

			const briefPath = writeChangeBriefDoc(project, agentConfig.id, task)
			
			io.emit("task-created", {
				projectId: project.id,
				taskId: task.id,
				title: task.title,
				description: task.description,
				priority: task.priority,
				createdBy: agentConfig.id,
				timestamp: Date.now(),
			})
			
			return { result: `✅ **Task created: ${title}**\n\n📋 ID: \`${task.id}\`\n⚡ Priority: ${priority}/10\n📝 ${description.substring(0, 100)}${description.length > 100 ? '...' : ''}${briefPath ? `\n📄 Brief: ${briefPath}` : ""}\n\nSpawn a worker with \`spawn_worker()\` to execute tasks.`, filesCreated: 0 }
		}

		case "list_tasks": {
			const { status = "all" } = toolInput as { status?: string }
			const tasks = projectStore.getTasks(project.id)
			
			// Filter tasks by ownership:
			// - Workers see tasks from their supervisor (to claim)
			// - Regular agents see only tasks they created (for their workers)
			const supervisorId = agentConfig.reportsTo
			const isWorker = agentConfig.isWorker === true
			const taskOwnerId = (isWorker && supervisorId) ? supervisorId : agentConfig.id
			
			let filteredTasks = tasks.filter(t => t.createdBy === taskOwnerId)
			const scopeNote = (isWorker && supervisorId)
				? ` (from your supervisor: ${supervisorId})`
				: ` (created by you)`
			
			if (status !== "all") {
				filteredTasks = filteredTasks.filter(t => t.status === status)
			}
			
			const totalTasks = tasks.length
			
			if (filteredTasks.length === 0) {
				const hasOtherTasks = totalTasks > 0
				return { result: `📋 No tasks found${status !== "all" ? ` with status "${status}"` : ""}${scopeNote}.${hasOtherTasks ? `\n\n💡 Note: There are ${totalTasks} total tasks in the project pool from all agents.` : ""}`, filesCreated: 0 }
			}
			
			const statusEmoji: Record<string, string> = {
				available: "🟢",
				claimed: "🟡",
				"in-progress": "🔵",
				completed: "✅",
				failed: "❌",
			}
			
			const taskList = filteredTasks
				.sort((a, b) => b.priority - a.priority)
				.map(t => {
					const emoji = statusEmoji[t.status] || "⚪"
					const claimed = t.claimedBy ? ` (claimed by ${t.claimedBy})` : ""
					return `${emoji} **${t.title}** [P${t.priority}] - ${t.status}${claimed}\n   ${t.description.substring(0, 80)}${t.description.length > 80 ? '...' : ''}`
				})
				.join("\n\n")
			
			return { result: `📋 **Task Pool (${filteredTasks.length} tasks${scopeNote}):**\n\n${taskList}`, filesCreated: 0 }
		}
		// Society Agent end

		// Society Agent start - spawn_worker implementation
		case "spawn_worker": {
			log.info(`[spawn_worker] Called by agentConfig.id=${agentConfig.id}, agentConfig.name=${agentConfig.name}`)
			const { count = 1 } = toolInput as { count?: number }
			
			// Check if we can spawn more workers
			const activeWorkers = projectStore.getActiveWorkerCount(project.id)
			const maxWorkers = (project as any).maxConcurrentWorkers || 5
			const canSpawn = Math.min(count, maxWorkers - activeWorkers)
			
			if (canSpawn <= 0) {
				return { result: `⚠️ Cannot spawn more workers. Active: ${activeWorkers}/${maxWorkers}\n\n💡 **TIP:** If workers are stuck from a previous session, run \`reset_tasks()\` to clean them up, then try spawning again.`, filesCreated: 0 }
			}
			
			// Check if there are tasks to work on (only this supervisor's tasks)
			const myAvailableTasks = projectStore.getAvailableTaskCount(project.id, agentConfig.id)
			const totalAvailableTasks = projectStore.getAvailableTaskCount(project.id)
			if (myAvailableTasks === 0) {
				if (totalAvailableTasks > 0) {
					return { result: `⚠️ No available tasks created by you (${agentConfig.id}).\n\n📊 There are ${totalAvailableTasks} tasks from other agents in the pool.\n\n💡 Workers only claim tasks from their supervisor. Create tasks first with \`create_task()\` before spawning workers.`, filesCreated: 0 }
				}
				return { result: `⚠️ No available tasks in the pool. Create tasks first with \`create_task()\` before spawning workers.`, filesCreated: 0 }
			}
			
			const spawnedWorkers: string[] = []
			
			// Get supervisor's custom instructions to pass to workers
			const supervisorInstructions = agentConfig.customInstructions
			
			for (let i = 0; i < canSpawn; i++) {
				const workerId = `worker-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
				// Increment project-level counter for globally unique worker names
				project.workerSequence = (project.workerSequence || 0) + 1
				projectStore.save()
				const workerName = `Worker #${project.workerSequence}`
				
				// Build worker system prompt with supervisor's instructions inherited
				let workerPromptContent = `You are an ephemeral worker agent. Your job is to:
1. Claim a task from the pool with \`claim_task()\`
2. Read the task details and understand what needs to be done
3. Execute the task using available tools (read_file, write_file, run_command, etc.)
4. When done, call \`complete_task(files_created, files_modified, summary)\`
5. If you encounter an unrecoverable error, call \`fail_task(reason)\`

## ASK FOR HELP - DON'T GUESS!
If you're stuck, confused, or need clarification:
- **Call \`fail_task("QUESTION: What should I do about X?")\`**
- A helpful supervisor will answer and restart the task with more context
- It's better to ask than to guess wrong and create a mess
- Examples of when to ask:
  - "QUESTION: The task mentions 'user service' but I don't see one - should I create it?"
  - "QUESTION: Should I use REST or GraphQL for this endpoint?"
  - "QUESTION: The file already exists - should I overwrite or add to it?"

You will self-destruct after completing or failing your task. Focus on the task at hand.
DO NOT spawn more workers or create new tasks - that's the supervisor's job.`
				
				// Inherit supervisor's custom instructions (e.g., "only work on backend code")
				if (supervisorInstructions) {
					workerPromptContent += `\n\n## Inherited Instructions from Supervisor\n${supervisorInstructions}`
				}
				
				// Create ephemeral worker agent
				const workerConfig: ProjectAgentConfig = {
					id: workerId,
					name: workerName,
					role: "Ephemeral worker - claims and executes tasks from the pool",
					homeFolder: agentConfig.homeFolder || "/",
					systemPrompt: buildFullSystemPrompt(workerPromptContent),
					ephemeral: true,
					isWorker: true,
					reportsTo: agentConfig.id,
				}
				log.info(`[spawn_worker] Creating worker ${workerId} with reportsTo=${agentConfig.id}`)
				
				// Add worker to project
				projectStore.addAgent(project.id, workerConfig)
				spawnedWorkers.push(workerId)
				
				// Emit worker spawned event
				io.emit("worker-spawned", {
					projectId: project.id,
					workerId,
					workerName,
					spawnedBy: agentConfig.id,
					timestamp: Date.now(),
				})
				
				log.info(`[Supervisor ${agentConfig.name}] Spawned worker: ${workerName} (${workerId})`)
				
				// Start the worker's execution loop in the background
				// The worker will claim a task and execute it
				;(async () => {
					try {
						const workerApiKey = apiKey || process.env.ANTHROPIC_API_KEY || ""
						await runEphemeralWorker(workerConfig, project, workerApiKey, io)
					} catch (err: any) {
						log.error(`[Worker ${workerId}] Error in execution loop:`, err)
						io.emit("worker-error", {
							projectId: project.id,
							workerId,
							error: err.message,
							timestamp: Date.now(),
						})
						// Show error in chat so user can see it
						io.emit("agent-message", {
							agentId: workerId,
							agentName: workerName,
							projectId: project.id,
							message: `❌ **Worker Error**\n\n${err.message}`,
							timestamp: Date.now(),
							isStreaming: false,
						})
					}
				})()
			}
			
			const tasksNote = myAvailableTasks > canSpawn 
				? `\n\n💡 ${myAvailableTasks - canSpawn} more of your tasks available. Spawn more workers if needed.`
				: ""
			
			return { 
				result: `✅ **Spawned ${spawnedWorkers.length} worker(s)**\n\nWorker IDs:\n${spawnedWorkers.map(w => `  - ${w}`).join('\n')}\n\nThey will claim tasks from you (${agentConfig.id}) and start working autonomously.${tasksNote}`, 
				filesCreated: 0 
			}
		}

		case "reset_tasks": {
			const { max_age_minutes = 5, cleanup_workers = true } = toolInput as { max_age_minutes?: number; cleanup_workers?: boolean }
			
			const maxAgeMs = max_age_minutes * 60 * 1000
			let result = ""
			
			// Only clean up workers spawned by THIS agent (scoped cleanup)
			if (cleanup_workers) {
				const removedWorkers = projectStore.removeEphemeralWorkers(project.id, agentConfig.id)
				if (removedWorkers > 0) {
					result += `🧹 Removed ${removedWorkers} of your stale ephemeral worker(s)\n`
					io.emit("workers-cleaned", {
						projectId: project.id,
						count: removedWorkers,
						spawnedBy: agentConfig.id,
						timestamp: Date.now(),
					})
				}
			}
			
			// Reset stale tasks claimed by THIS agent's workers only
			const resetCount = projectStore.resetStaleTasks(project.id, maxAgeMs, agentConfig.id)
			
			if (resetCount > 0) {
				result += `♻️ Reset ${resetCount} stale task(s) to available\n`
				io.emit("tasks-reset", {
					projectId: project.id,
					count: resetCount,
					spawnedBy: agentConfig.id,
					timestamp: Date.now(),
				})
			}
			
			if (!result) {
				result = "✅ No stale tasks or workers found (for your workers)."
			} else {
				result += "\n💡 Tasks are now available. Spawn workers with `spawn_worker()` to process them."
			}
			
			return { result, filesCreated: 0 }
		}

		case "propose_new_agent": {
			const { name, role, purpose, reports_to } = toolInput as { name: string; role: string; purpose: string; reports_to?: string }
			
			if (!name || !role || !purpose) {
				return { result: `❌ Please provide name, role, and purpose for the new agent.`, filesCreated: 0 }
			}
			
			// Determine the parent agent
			let parentId = agentConfig.id
			let parentName = agentConfig.name
			if (reports_to) {
				const parentAgent = project.agents.find(a => a.id === reports_to && !a.ephemeral)
				if (!parentAgent) {
					const available = project.agents.filter(a => !a.ephemeral).map(a => `  - ${a.id}: ${a.name}`).join('\n')
					return { result: `❌ Agent "${reports_to}" not found.\n\nAvailable agents:\n${available}`, filesCreated: 0 }
				}
				parentId = parentAgent.id
				parentName = parentAgent.name
			}
			
			// Generate a reasonable ID from the name
			const agentId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
			
			// Check if agent already exists
			const existing = project.agents.find(a => a.id === agentId)
			if (existing) {
				return { result: `❌ An agent with ID "${agentId}" already exists in this project.`, filesCreated: 0 }
			}
			
			// Get parent agent's home folder to nest under it
			const parentAgent = project.agents.find(a => a.id === parentId)
			const parentHome = parentAgent?.homeFolder || parentId
			const agentHome = parentHome === "/" ? agentId : `${parentHome}/${agentId}`
			
			// Create the agent
			const newAgent = projectStore.addAgent(project.id, {
				id: agentId,
				name,
				role,
				systemPrompt: buildFullSystemPrompt(`You are ${name}, a ${role}.

Your purpose: ${purpose}

Work collaboratively with other agents in the project. Use available tools to complete tasks.
You report to ${parentName}.`),
				homeFolder: agentHome,  // Nested under parent's folder
				ephemeral: false,
				reportsTo: parentId,
			})
			
			if (!newAgent) {
				return { result: `❌ Failed to create agent. Project may not exist.`, filesCreated: 0 }
			}
			
			// Create the agent's home directory
			const projectFolder = project.folder || project.id
			const agentDir = path.join(projectStore.projectsBaseDir, projectFolder, agentHome)
			if (!fs.existsSync(agentDir)) {
				fs.mkdirSync(agentDir, { recursive: true })
				log.info(`[propose_new_agent] Created directory for new agent: ${agentDir}`)
			}
			
			io.emit("agent-added", {
				projectId: project.id,
				agentId: newAgent.id,
				agentName: newAgent.name,
				parentId: parentId,
				timestamp: Date.now(),
			})
			
			return { 
				result: `✅ **New agent created: ${name}**\n\n🆔 ID: \`${agentId}\`\n👔 Role: ${role}\n📋 Purpose: ${purpose}\n👤 Reports to: ${parentName}\n\nYou can now delegate tasks to this agent using \`delegate_task("${agentId}", "task description")\`.`, 
				filesCreated: 0 
			}
		}
		// Society Agent end

		// Society Agent start - delegate_task to persistent agents with detailed specs
		case "delegate_task": {
			const { 
				agent_id, 
				task, 
				desired_state, 
				acceptance_criteria: rawCriteria, 
				constraints: rawConstraints, 
				context, 
				priority 
			} = toolInput as { 
				agent_id: string
				task: string
				desired_state?: string
				acceptance_criteria?: string[] | string
				constraints?: string[] | string
				context?: string
				priority?: string
			}
			
			// Normalize arrays - models sometimes send strings instead
			const acceptance_criteria = Array.isArray(rawCriteria) ? rawCriteria 
				: typeof rawCriteria === 'string' ? rawCriteria.split('\n').map(s => s.trim()).filter(Boolean)
				: undefined
			const constraints = Array.isArray(rawConstraints) ? rawConstraints
				: typeof rawConstraints === 'string' ? rawConstraints.split('\n').map(s => s.trim()).filter(Boolean)
				: undefined
			
			// Debug: log what we have
			log.info(`[delegate_task] project.id=${project?.id}, agent_id=${agent_id}`)
			
			if (!project || !project.id) {
				return { result: `❌ Delegation failed: Project context is missing or invalid`, filesCreated: 0 }
			}
			
			// Find target agent
			const targetAgent = project.agents.find(a => a.id === agent_id && !a.ephemeral)
			if (!targetAgent) {
				const available = project.agents.filter(a => !a.ephemeral && a.id !== agentConfig.id)
				return { 
					result: `❌ Agent "${agent_id}" not found or is ephemeral.\n\nAvailable persistent agents:\n${available.map(a => `  - ${a.id}: ${a.name}`).join('\n') || '(none)'}`, 
					filesCreated: 0 
				}
			}
			
			// Society Agent - Hierarchy validation: only delegates to subordinates
			// Check if target reports to sender (direct subordinate)
			// Or if both report to the same boss (peers can't delegate to each other)
			const isSubordinate = targetAgent.reportsTo === agentConfig.id
			const isPeer = targetAgent.reportsTo === agentConfig.reportsTo && targetAgent.reportsTo !== undefined
			const isSupervisor = agentConfig.reportsTo === targetAgent.id
			
			if (isSupervisor) {
				return {
					result: `❌ Cannot delegate to your supervisor (${targetAgent.name}).\n\n💡 Use \`report_to_supervisor\` to communicate with your boss instead.`,
					filesCreated: 0
				}
			}
			
			if (isPeer && !isSubordinate) {
				// Peers can't delegate to each other - they should ask shared supervisor
				return {
					result: `❌ Cannot delegate to peer agent (${targetAgent.name}).\n\n` +
						`📋 **Hierarchy rules:**\n` +
						`- You can only delegate to agents that report to you (subordinates)\n` + 
						`- To coordinate with peers, ask your shared supervisor\n` +
						`- If this is your task to complete, do it yourself\n\n` +
						`💡 **Your subordinates:** ${project.agents.filter(a => a.reportsTo === agentConfig.id && !a.ephemeral).map(a => a.name).join(', ') || '(none)'}\n` +
						`💡 **Your supervisor:** ${project.agents.find(a => a.id === agentConfig.reportsTo)?.name || '(none - you are top-level)'}`,
					filesCreated: 0
				}
			}
			
			// Society Agent - Scope validation: warn if task involves sender's folder, not target's
			const senderHome = (agentConfig.homeFolder || "/").replace(/^\/+|\/+$/g, "").toLowerCase()
			const targetHome = (targetAgent.homeFolder || "/").replace(/^\/+|\/+$/g, "").toLowerCase()
			const taskLower = task.toLowerCase()
			const desiredStateLower = (desired_state || "").toLowerCase()
			
			// Check if the task mentions the sender's folder but not the target's folder
			const mentionsSenderFolder = senderHome && senderHome !== "/" && 
				(taskLower.includes(senderHome) || desiredStateLower.includes(senderHome))
			const mentionsTargetFolder = targetHome && targetHome !== "/" && 
				(taskLower.includes(targetHome) || desiredStateLower.includes(targetHome))
			
			if (mentionsSenderFolder && !mentionsTargetFolder && senderHome !== targetHome) {
				return {
					result: `❌ Invalid delegation: Task involves your folder (${senderHome}/) not ${targetAgent.name}'s folder (${targetHome}/).\n\n` +
						`📋 **Scope rules:**\n` +
						`- Tasks involving YOUR folder should be done by YOU (or your workers)\n` +
						`- ${targetAgent.name} can only work in ${targetHome}/\n` +
						`- Don't delegate cleanup of your mess to other agents\n\n` +
						`💡 **To clean up ${senderHome}/:** Do it yourself using \`run_command\` or spawn workers.`,
					filesCreated: 0
				}
			}
			
			// Debug: log target agent
			log.info(`[delegate_task] targetAgent.id=${targetAgent.id}, homeFolder=${targetAgent.homeFolder}`)
			
			// Society Agent - Save desired state to agent's folder
			const targetHomeDir = projectStore.agentHomeDir(project.id, targetAgent.id)
			const desiredStateFile = path.join(targetHomeDir, "DESIRED_STATE.md")
			const timestamp = new Date().toISOString()
			
			const desiredStateContent = `# Desired State - ${task}

> **Assigned by**: ${agentConfig.name}  
> **Assigned at**: ${timestamp}  
> **Priority**: ${priority || "medium"}  
> **Status**: pending

---

## 📋 Task Summary
${task}

## 🎯 Desired State
${desired_state || "(Not specified - work autonomously based on task)"}

## ✅ Acceptance Criteria
${acceptance_criteria?.map((c, i) => `${i + 1}. ${c}`).join("\n") || "- Task completed successfully"}

## 🚫 Constraints
${constraints?.map(c => `- ${c}`).join("\n") || "- None specified"}

## 📝 Context
${context || "No additional context provided."}

---

## 📊 Progress Log
*(Agent updates this as work progresses)*

| Time | Status | Notes |
|------|--------|-------|
| ${timestamp} | pending | Task received from ${agentConfig.name} |

---

## 💬 Communication Log
*(Messages between agent and supervisor)*

### From ${agentConfig.name} (${timestamp})
Initial delegation: ${task}

`
			
			try {
				fs.mkdirSync(targetHomeDir, { recursive: true })
				fs.writeFileSync(desiredStateFile, desiredStateContent)
				log.info(`[delegate_task] Saved desired state to ${desiredStateFile}`)
			} catch (err: any) {
				log.error(`[delegate_task] Failed to save desired state: ${err.message}`)
			}
			
			// Society Agent - Create tracked delegation with stable task ID
			const projectDir = projectStore.projectDir(project.id)
			let taskId = "(untracked)"
			try {
				const delegationRequest: DelegationRequest = {
					projectId: project.id,
					fromAgentId: agentConfig.id,
					fromAgentName: agentConfig.name,
					toAgentId: agent_id,
					toAgentName: targetAgent.name,
					task,
					desiredState: desired_state,
					acceptanceCriteria: acceptance_criteria,
					constraints,
					context,
					priority: priority as "low" | "medium" | "high" | "critical" | undefined,
				}
				
				const delegation = createDelegation(projectDir, delegationRequest)
				taskId = delegation.taskId
				
				// Save task to storage
				saveTask(projectDir, delegation.task)
				
				// Add task to subordinate's PLAN.md
				addTaskToPlan(targetHomeDir, delegation.task, agentConfig.name)
				
				log.info(`[delegate_task] Created tracked task ${taskId}`)
			} catch (err: any) {
				log.warn(`[delegate_task] Task tracking failed (continuing anyway): ${err.message}`)
			}
			
			// Emit delegation event with full details
			io.emit("task-delegated", {
				projectId: project.id,
				taskId, // Stable task ID (e.g., T-FRO-001)
				fromAgent: agentConfig.id,
				fromAgentName: agentConfig.name,
				toAgent: agent_id,
				toAgentName: targetAgent.name,
				task,
				desired_state,
				acceptance_criteria,
				constraints,
				context,
				priority: priority || "medium",
				timestamp: Date.now(),
			})
			
			log.info(`[${agentConfig.name}] Delegating to ${targetAgent.name}: ${task.substring(0, 100)}...`)
			
			// Build comprehensive delegation message with specs
			const delegationMessage = `# 📋 Task Delegation from ${agentConfig.name}

## Task ID: ${taskId}

## Task
${task}

## 🎯 Desired State (What should exist when done)
${desired_state || "Complete the task as described."}

## ✅ Acceptance Criteria (How to verify completion)
${acceptance_criteria?.map((c, i) => `${i + 1}. ${c}`).join("\n") || "- Task completed successfully"}

## 🚫 Constraints (What NOT to do)
${constraints?.map(c => `- ${c}`).join("\n") || "- None specified"}

## 📝 Context
${context || "No additional context."}

---

**Instructions:**
1. Read this carefully and understand the desired state
2. Work autonomously to achieve the desired state
3. Use \`report_to_supervisor\` to report progress, blockers, or completion
4. Your DESIRED_STATE.md file has been updated with these specs
5. If you cannot complete something, report it - don't guess`
			
			io.emit("delegation-message", {
				projectId: project.id,
				taskId, // Stable task ID
				toAgentId: targetAgent.id,
				toAgentName: targetAgent.name,
				fromAgentId: agentConfig.id,
				fromAgentName: agentConfig.name,
				task,
				desired_state,
				acceptance_criteria,
				constraints,
				context,
				priority: priority || "medium",
				timestamp: Date.now(),
			})
			
			// Execute the task via handleSupervisorChat for the target agent
			try {
				const delegateApiKey = apiKey || process.env.ANTHROPIC_API_KEY || ""
				
				log.info(`[delegate_task] From ${agentConfig.id} to ${targetAgent.id}, calling handleSupervisorChat with targetAgent.id=${targetAgent.id}`)
				
				const result = await handleSupervisorChat(
					delegationMessage,
					targetAgent,
					project,
					delegateApiKey,
					io,
				)
				
				// Update desired state file with completion
				try {
					const completionLog = `\n| ${new Date().toISOString()} | completed | Work finished, response sent to supervisor |`
					fs.appendFileSync(desiredStateFile, completionLog)
				} catch {}
				
				return { 
					result: `✅ **Delegation to ${targetAgent.name} complete** (${taskId})\n\n**Response:**\n${result.fullResponse.substring(0, 2000)}${result.fullResponse.length > 2000 ? '...(truncated)' : ''}`, 
					filesCreated: result.totalFilesCreated 
				}
			} catch (err: any) {
				log.error(`[delegate_task] Failed:`, err)
				return { result: `❌ Delegation failed: ${err.message}\n\nStack: ${err.stack?.substring(0, 500)}`, filesCreated: 0 }
			}
		}
		// Society Agent end
		
		// Society Agent start - report_to_supervisor tool
		case "report_to_supervisor": {
			const { 
				status, 
				summary, 
				details, 
				completion_percentage, 
				blockers, 
				questions 
			} = toolInput as {
				status: string
				summary: string
				details?: string
				completion_percentage?: number
				blockers?: string[]
				questions?: string[]
			}
			
			// Find this agent's supervisor (reportsTo field, or first supervisor in project)
			const supervisorId = agentConfig.reportsTo || project.agents.find(a => a.role?.toLowerCase().includes("supervisor"))?.id
			const supervisor = supervisorId ? project.agents.find(a => a.id === supervisorId) : null
			
			// Emit the report
			io.emit("agent-report", {
				projectId: project.id,
				fromAgentId: agentConfig.id,
				fromAgentName: agentConfig.name,
				toAgentId: supervisorId || "supervisor",
				toAgentName: supervisor?.name || "Supervisor",
				status,
				summary,
				details,
				completion_percentage,
				blockers,
				questions,
				timestamp: Date.now(),
			})
			
			// Update the agent's DESIRED_STATE.md if it exists
			const homeDir = projectStore.agentHomeDir(project.id, agentConfig.id)
			const desiredStateFile = path.join(homeDir, "DESIRED_STATE.md")
			
			if (fs.existsSync(desiredStateFile)) {
				const statusEmoji = {
					in_progress: "🔄",
					completed: "✅",
					blocked: "🚫",
					needs_info: "❓",
					failed: "❌",
				}[status] || "📝"
				
				const logEntry = `\n| ${new Date().toISOString()} | ${status} | ${statusEmoji} ${summary} |`
				
				try {
					fs.appendFileSync(desiredStateFile, logEntry)
					
					// If completed, update the status in the file header
					if (status === "completed") {
						let content = fs.readFileSync(desiredStateFile, "utf-8")
						content = content.replace(/\*\*Status\*\*: \w+/, `**Status**: completed`)
						fs.writeFileSync(desiredStateFile, content)
					}
				} catch {}
			}
			
			// Build response message
			let response = `📤 **Report sent to ${supervisor?.name || "Supervisor"}**\n\n`
			response += `**Status:** ${status}\n`
			response += `**Summary:** ${summary}\n`
			if (completion_percentage !== undefined) response += `**Progress:** ${completion_percentage}%\n`
			if (blockers?.length) response += `**Blockers:**\n${blockers.map(b => `  - ${b}`).join("\n")}\n`
			if (questions?.length) response += `**Questions:**\n${questions.map(q => `  - ${q}`).join("\n")}\n`
			
			log.info(`[${agentConfig.name}] Reported to supervisor: ${status} - ${summary}`)
			
			return { result: response, filesCreated: 0 }
		}
		// Society Agent end

		default:
			return { result: `Unknown tool: ${toolName}`, filesCreated: 0 }
	}
}
/**
 * Handle supervisor chat with an agentic tool-use loop.
 * The LLM decides when to delegate, list team, or propose agents via tool calls.
 * Returns the final text response and delegation results.
 */
async function handleSupervisorChat(
	userMessage: string,
	supervisorConfig: ProjectAgentConfig,
	project: Project,
	apiKey: string,
	io: SocketIOServer,
	attachments?: any[],
): Promise<{
	fullResponse: string
	delegationResults: Array<{ agentId: string; agentName: string; filesCreated: number; responseLength: number }>
	totalFilesCreated: number
}> {
	log.info(`[handleSupervisorChat] ENTRY: supervisorConfig.id=${supervisorConfig.id}, supervisorConfig.name=${supervisorConfig.name}`)
	
	// Society Agent - Reset per-session budget for this agent
	usageTracker.resetAgentSession(supervisorConfig.id)

	// Society Agent - Emit task-started event so UI can show what was asked
	const taskPreview = userMessage.substring(0, 200) + (userMessage.length > 200 ? '...' : '')
	io.emit("task-started", {
		agentId: supervisorConfig.id,
		agentName: supervisorConfig.name,
		projectId: project.id,
		task: taskPreview,
		fullTask: userMessage,
		timestamp: Date.now(),
	})

	// Society Agent start - use provider config for model and API key
	// Priority: 1) Standalone settings 2) ProviderSettings 3) Legacy config 4) Environment
	let anthropic: Anthropic | null = null
	let openRouterClient: OpenAI | null = null
	let model: string
	let useOpenRouter = false

	// Society Agent start - Determine effective provider and model
	// Priority: 1) Agent override 2) Project override 3) Server default
	const effectiveProvider = supervisorConfig.provider || project.provider || null
	const effectiveModel = supervisorConfig.model || project.model || null
	
	// Society Agent start - Check standalone settings FIRST
	if (standaloneSettings.isInitialized() && standaloneSettings.hasApiKey()) {
		const providerConfig = standaloneSettings.getProvider()
		
		// Use effective overrides if set, otherwise fall back to server config
		const useProvider = effectiveProvider || providerConfig.type
		const useModel = effectiveModel || providerConfig.model
		
		log.info(`[handleSupervisorChat] Provider: ${useProvider}, Model: ${useModel} (agent: ${supervisorConfig.model}, project: ${project.model}, server: ${providerConfig.model})`)
		
		if (useProvider === "openrouter") {
			useOpenRouter = true
			openRouterClient = new OpenAI({
				baseURL: "https://openrouter.ai/api/v1",
				apiKey: providerConfig.apiKey,
			})
			model = useModel
		} else if (useProvider === "anthropic" || useProvider === "minimax") {
			anthropic = new Anthropic({
				apiKey: providerConfig.apiKey,
				baseURL: useProvider === "minimax" ? "https://api.minimax.io/anthropic" : undefined,
			})
			model = useModel
		} else if (useProvider === "openai" || useProvider === "groq" || useProvider === "deepseek" || useProvider === "mistral") {
			useOpenRouter = true
			openRouterClient = new OpenAI({
				baseURL: providerConfig.baseUrl || PROVIDER_BASE_URLS[useProvider],
				apiKey: providerConfig.apiKey,
			})
			model = useModel
		} else {
			anthropic = new Anthropic({ apiKey: providerConfig.apiKey })
			model = useModel
		}
	}
	// Society Agent end
	else if (currentProviderSettings) {
		const provider = currentProviderSettings.apiProvider
		// Society Agent start - Handle OpenRouter in currentProviderSettings
		if (provider === "openrouter") {
			useOpenRouter = true
			openRouterClient = new OpenAI({
				baseURL: "https://openrouter.ai/api/v1",
				apiKey: currentProviderSettings.openRouterApiKey || "not-provided",
			})
			model = supervisorConfig.model || currentProviderSettings.openRouterModelId || "anthropic/claude-sonnet-4"
			log.info(`[handleSupervisorChat] Using OpenRouter: ${model}`)
		}
		// Society Agent end
		// Tool calling requires Anthropic-compatible API (Anthropic or MiniMax)
		else if (provider === "anthropic" || provider === "minimax") {
			anthropic = new Anthropic({
				apiKey: provider === "anthropic" ? currentProviderSettings.apiKey : currentProviderSettings.minimaxApiKey,
				baseURL: provider === "minimax" ? "https://api.minimax.io/anthropic" : undefined,
			})
			model = supervisorConfig.model || currentProviderSettings.apiModelId || "claude-sonnet-4-20250514"
		} else {
			// Other providers - try OpenRouter as fallback if key available
			if (currentProviderSettings.openRouterApiKey) {
				useOpenRouter = true
				openRouterClient = new OpenAI({
					baseURL: "https://openrouter.ai/api/v1",
					apiKey: currentProviderSettings.openRouterApiKey,
				})
				model = supervisorConfig.model || currentProviderSettings.openRouterModelId || "anthropic/claude-sonnet-4"
			} else {
				anthropic = new Anthropic({ apiKey: apiKey })
				model = supervisorConfig.model || "claude-sonnet-4-20250514"
			}
		}
	} else {
		// Legacy provider config
		const providerConfig = currentProviderConfig || loadProviderConfig(process.env.WORKSPACE_PATH || process.cwd())
		// Society Agent start - Handle OpenRouter in legacy config
		if (providerConfig && providerConfig.provider === "openrouter" && providerConfig.apiKey) {
			useOpenRouter = true
			openRouterClient = new OpenAI({
				baseURL: "https://openrouter.ai/api/v1",
				apiKey: providerConfig.apiKey,
			})
			model = supervisorConfig.model || providerConfig.model || "anthropic/claude-sonnet-4"
		}
		// Society Agent end
		// Tool calling requires Anthropic-compatible API (Anthropic or MiniMax)
		else if (providerConfig && (providerConfig.provider === "anthropic" || providerConfig.provider === "minimax")) {
			anthropic = new Anthropic({
				apiKey: providerConfig.apiKey,
				baseURL: providerConfig.provider === "minimax" ? "https://api.minimax.io/anthropic" : undefined,
			})
			model = supervisorConfig.model || providerConfig.model || "claude-sonnet-4-20250514"
		} else {
			anthropic = new Anthropic({ apiKey: apiKey }) // fallback to env ANTHROPIC_API_KEY
			model = supervisorConfig.model || "claude-sonnet-4-20250514"
		}
	}
	// Society Agent end
	// Society Agent start - activity log: agent session begins
	agentActivityLogger.logAgentStart(project.id, supervisorConfig.id, project.folder, supervisorConfig.homeFolder || "/", "user_chat", model)
	// Society Agent end
	const agent = getOrCreateProjectAgent(supervisorConfig, project, apiKey)

	// Access the agent's system prompt (private field, accessed via cast)
	const systemPrompt = (agent as any).systemPrompt || supervisorConfig.systemPrompt

	// Add user message to agent history (with attachments if present)
	if (attachments && attachments.length > 0) {
		await (agent as any).addMessageWithAttachments("user", userMessage, attachments)
	} else {
		await (agent as any).addMessage("user", userMessage)
	}

	// Build messages from agent history
	const history = agent.getHistory()
	const messages: Anthropic.MessageParam[] = history.map((msg: any) => {
		// If message has attachments (images/files), include them
		if (msg.attachments && msg.attachments.length > 0 && msg.role === 'user') {
			const content: any[] = []
			// Add images first
			for (const att of msg.attachments) {
				if (att.type === 'image' && att.source?.data) {
					content.push({
						type: 'image',
						source: {
							type: 'base64',
							media_type: att.source.media_type || 'image/jpeg',
							data: att.source.data,
						}
					})
				} else if (att.type === 'file' && att.text) {
					// File attachments: include the text representation
					content.push({ type: 'text', text: att.text })
				}
			}
			// Add text if present
			if (msg.content) {
				content.push({ type: 'text', text: msg.content })
			}
			return {
				role: 'user' as const,
				content,
			}
		}
		return {
			role: msg.role === "user" ? "user" as const : "assistant" as const,
			content: msg.content,
		}
	})

	let fullResponse = ""
	const delegationResults: Array<{ agentId: string; agentName: string; filesCreated: number; responseLength: number }> = []
	let totalFilesCreated = 0
	
	// Society Agent - Autonomous mode: much higher limit for long-running tasks
	// Agents can run up to 200 iterations, but smart loop detection will stop them if stuck
	const MAX_TOOL_ITERATIONS = 200
	let lastActionDescription = "" // Society Agent - Track what the last step did
	let iterationCount = 0 // Track actual iterations for summary
	
	// Society Agent - Smart loop detection for tool calls
	let lastToolSignature = ""
	let toolRepeatCount = 0
	const MAX_TOOL_REPEATS = 2 // Reduced - catch loops after 2 repeats
	
	// Society Agent - Track run_command history separately (catches build loops)
	let lastCommandRuns: string[] = []
	const MAX_COMMAND_HISTORY = 5
	const COMMAND_REPEAT_THRESHOLD = 3 // Same command 3 times in last 5 = loop

	// Society Agent - Modification-without-verification detection
	// Catches agents that keep editing files without ever checking if errors decreased
	let modsSinceLastVerification = 0
	const VERIFY_AFTER_MODS_THRESHOLD = 5
	const MODIFICATION_CMD_RE = /\bsed\s+.*-i\b|\bsed\s+-i\b|\bpatch\b/
	const MODIFICATION_TOOL_NAMES = new Set(["write_file", "create_file", "edit_file", "patch_file", "append_file"])
	const VERIFICATION_CMD_RE = /\btsc\b|\bnpm\s+(run\s+)?(build|test|type.?check)\b|\bpnpm\s+(run\s+)?(build|test|type.?check)\b|\bpytest\b|\bpy\.test\b|\bpython\s+-m\s+(pytest|mypy|pyright|py_compile|flake8|ruff|pylint|unittest)\b|\bpyright\b|\bmypy\b|\bruff\s+check\b|\bflake8\b|\bpylint\b|\bcargo\s+(build|test|check)\b|\bng\s+build\b|\bgo\s+(build|test|vet)\b|\bruby\s+-c\b|\bbundle\s+exec\s+rspec\b|\bmvn\s+(compile|test|verify|package)\b|\bgradle\s+(build|test|check)\b/i
	
	// Society Agent - Text loop detection
	let lastTextOutput = ""
	let textRepeatCount = 0
	const MAX_TEXT_REPEATS = 4
	
	// Society Agent - Progress tracking for autonomous work
	let lastProgressTime = Date.now()
	let filesCreatedSinceLastCheck = 0
	let meaningfulActionsCount = 0
	const PROGRESS_CHECK_INTERVAL = 10 // Check every 10 iterations
	const STALL_THRESHOLD_MS = 300000 // 5 minutes without progress = stalled
	
	// Society Agent - Track if agent made changes (vs only reading)
	let hasWrittenFiles = false
	const READ_ONLY_TOOLS = new Set(["read_project_file", "list_project_files", "read_file", "list_dir", "get_team_info", "search_files", "grep_search"])
	let consecutiveReadOnlyStops = 0

	// Society Agent - Ensure agents always summarize when they did meaningful work.
	// After end_turn, if ≥5 tools were called and we haven't injected the summary
	// prompt yet, continue for one final iteration with a summary request.
	let summaryRequested = false
	const MIN_TOOLS_FOR_SUMMARY = 5
	let hallucinationWarnCount = 0
	let fakeImplWarnCount = 0         // Guard: agent described without writing/executing
	let prematureWarnCount = 0        // Guard: agent stopped with suspiciously few write actions
	let verificationRequestCount = 0  // Guard: ask agent to verify before requesting summary
	const MAX_GUARD_RETRIES = 3       // How many times each guard can push back before giving up
	// Legacy aliases kept for compatibility with read-only check below
	let hallucinationWarned = false
	let fakeImplWarned = false
	let prematureWarned = false
	let verificationRequested = false
	let writeActionsCount = 0         // Successful write_file / patch_file calls
	let executeActionsCount = 0       // Successful run_command calls
	const actLoopStartTime = Date.now()
	let actLoopExitReason = "end_turn"
	let actTotalToolCalls = 0
	let actCallIndex = 0
	let actChatOutLogged = false      // Track if any chat_out was logged during iterations
	// Society Agent end

	// Society Agent end

	for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
		iterationCount = iteration + 1
		actCallIndex = 0 // reset per-iteration call index
		const actIterationStartTime = Date.now()

		// Society Agent start - Trim old tool results if approaching context limit
		// 16.7A: cap history to last N turns before trimming
		const _limited = limitHistory(messages)
		if (_limited.length < messages.length) messages.splice(0, messages.length, ..._limited)
		const trimCount = trimMessagesForContext(systemPrompt, messages)
		const estimatedCtx = estimateMessagesTokens(systemPrompt, messages)
		io.emit("context-stats", {
			agentId: supervisorConfig.id,
			messageCount: messages.length,
			estimated: estimatedCtx,
			trimCount,
		})
		if (trimCount > 0) {
			log.warn(`[Supervisor] ${supervisorConfig.name} trimmed ${trimCount} old message parts to fit context (~${estimatedCtx} tokens)`)
			io.emit("agent-message", {
				agentId: supervisorConfig.id,
				agentName: supervisorConfig.name,
				projectId: project.id,
				message: `\n⚠️ *Context approaching limit — trimmed ${trimCount} old results to continue*\n`,
				timestamp: Date.now(),
				isStreaming: false,
			})
		}
		// Society Agent end

		log.info(`[Supervisor] ${supervisorConfig.name} iteration ${iteration + 1}, ${messages.length} messages, ~${estimateMessagesTokens(systemPrompt, messages)} tokens, useOpenRouter=${useOpenRouter}`)

		// Society Agent start - Check if agent was stopped
		if (stoppedAgents.has(supervisorConfig.id)) {
			log.info(`[Supervisor] ${supervisorConfig.name} was stopped by user`)
			stoppedAgents.delete(supervisorConfig.id) // Clean up
			io.emit("agent-message", {
				agentId: supervisorConfig.id,
				agentName: supervisorConfig.name,
				projectId: project.id,
				message: "\n⛔ **Stopped by user**\n",
				timestamp: Date.now(),
				isStreaming: false,
				isDone: true,
			})
			actLoopExitReason = "user_stopped"
			break
		}
		// Society Agent end

		// Society Agent start - Progress indicators (suppressed - replaced by tool cards)
		// if (iteration > 0) { io.emit(...) }
		// Society Agent end

		// Society Agent start - OpenRouter path for supervisor
		if (useOpenRouter && openRouterClient) {
			// Convert AGENT_TOOLS to OpenAI function format
			const openAITools: OpenAI.Chat.ChatCompletionTool[] = AGENT_TOOLS.map((tool: any) => ({
				type: "function" as const,
				function: {
					name: tool.name,
					description: tool.description,
					parameters: tool.input_schema,
				},
			}))

			// Convert messages to OpenAI format
			const openAIMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
				{ role: "system", content: systemPrompt },
				...messages.map((m: any) => {
					if (m.role === "user") {
						return { role: "user" as const, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }
					} else {
						// Assistant message - handle tool calls
						if (Array.isArray(m.content)) {
							const textParts = m.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("")
							const toolCalls = m.content.filter((b: any) => b.type === "tool_use").map((b: any) => ({
								id: b.id,
								type: "function" as const,
								function: { name: b.name, arguments: JSON.stringify(b.input) }
							}))
							if (toolCalls.length > 0) {
								return { role: "assistant" as const, content: textParts || null, tool_calls: toolCalls }
							}
							return { role: "assistant" as const, content: textParts }
						}
						return { role: "assistant" as const, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }
					}
				}),
			]

			// Add tool results if last message was tool calls
			const lastMsg = messages[messages.length - 1]
			if (lastMsg && lastMsg.role === "user" && Array.isArray(lastMsg.content) && lastMsg.content[0]?.type === "tool_result") {
				openAIMessages.pop() // Remove the converted user message
				for (const tr of lastMsg.content) {
					const toolResult = tr as any
					openAIMessages.push({
						role: "tool",
						tool_call_id: toolResult.tool_use_id,
						content: toolResult.content,
					})
				}
			}

			// Society Agent start - TRUE STREAMING for OpenRouter supervisor
			const stream = await openRouterClient.chat.completions.create({
				model,
				max_tokens: 16384,
				messages: openAIMessages,
				tools: openAITools,
				stream: true,
				stream_options: { include_usage: true }, // Society Agent - get token usage in stream
			})

			let textContent = ""
			let finishReason: string | null = null
			let streamUsage: { prompt_tokens?: number; completion_tokens?: number } | null = null
			const toolCallsMap = new Map<number, { id: string; name: string; arguments: string }>()
			
			// Society Agent - Loop detection for stuck models
			let lastChunk = ""
			let repeatCount = 0
			const MAX_REPEATS = 3 // Reduced from 5 - catch loops faster
			
			// Society Agent - Pattern-based loop detection (catches semantic repetition)
			let sentenceBuffer: string[] = []
			const MAX_SENTENCE_REPEATS = 2
			let userStoppedDuringStream = false
			
			// Stream text in real-time
			for await (const chunk of stream) {
				// Society Agent - Check for user stop DURING streaming
				if (stoppedAgents.has(supervisorConfig.id)) {
					log.info(`[Supervisor] ${supervisorConfig.name} stopped by user during stream`)
					stoppedAgents.delete(supervisorConfig.id)
					userStoppedDuringStream = true
					io.emit("agent-message", {
						agentId: supervisorConfig.id,
						agentName: supervisorConfig.name,
						projectId: project.id,
						message: "\n⛔ **Stopped by user**\n",
						timestamp: Date.now(),
						isStreaming: false,
						isDone: true,
					})
					break
				}
				
				// Society Agent start - Capture usage from stream
				if ((chunk as any).usage) {
					streamUsage = (chunk as any).usage
				}
				// Society Agent end
				
				const choice = chunk.choices[0]
				if (!choice) continue
				
				// Handle text content
				const delta = choice.delta
				if (delta?.content) {
					// Society Agent - Detect repetitive output (model stuck in loop)
					if (delta.content === lastChunk && delta.content.length > 5) {
						repeatCount++
						if (repeatCount >= MAX_REPEATS) {
							log.warn(`[Supervisor] Model stuck in loop, breaking stream. Repeated: "${delta.content.substring(0, 50)}..."`)
							io.emit("agent-message", {
								agentId: supervisorConfig.id,
								agentName: supervisorConfig.name,
								projectId: project.id,
								message: "\n\n⚠️ *[Model stuck in loop - stopping]*",
								timestamp: Date.now(),
								isStreaming: false,
								isDone: true,
							})
							break
						}
					} else {
						lastChunk = delta.content
						repeatCount = 0
					}
					
					textContent += delta.content
					fullResponse += delta.content
					
					// Society Agent - Aggressive loop detection
					// Check for repeated sentences (same sentence 3+ times)
					const sentences = fullResponse.split(/[.!?]\s+/).filter(s => s.length > 15)
					if (sentences.length >= 3) {
						const lastThree = sentences.slice(-3)
						const uniqueSentences = new Set(lastThree.map(s => s.toLowerCase().trim().substring(0, 50)))
						if (uniqueSentences.size === 1) {
							log.warn(`[Supervisor] Sentence-level loop detected (3x), stopping`)
							io.emit("agent-message", {
								agentId: supervisorConfig.id,
								agentName: supervisorConfig.name,
								projectId: project.id,
								message: "\n\n⚠️ *[Repetitive output detected - stopping]*",
								timestamp: Date.now(),
								isStreaming: false,
								isDone: true,
							})
							break
						}
					}
					
					// Check for repeated phrases (same 30+ char block appears 3+ times)
					if (fullResponse.length > 100) {
						const lastChars = fullResponse.slice(-80)
						const pattern = lastChars.substring(0, 30)
						const occurrences = (fullResponse.match(new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length
						if (occurrences >= 3) {
							log.warn(`[Supervisor] Phrase-level loop detected ("${pattern.substring(0, 20)}..." x${occurrences}), stopping`)
							io.emit("agent-message", {
								agentId: supervisorConfig.id,
								agentName: supervisorConfig.name,
								projectId: project.id,
								message: "\n\n⚠️ *[Repeating phrase detected - stopping]*",
								timestamp: Date.now(),
								isStreaming: false,
								isDone: true,
							})
							break
						}
					}
					
					io.emit("agent-message", {
						agentId: supervisorConfig.id,
						agentName: supervisorConfig.name,
						projectId: project.id,
						message: delta.content,
						timestamp: Date.now(),
						isStreaming: true,
					})
				}
				
				// Handle tool calls (streamed incrementally)
				if (delta?.tool_calls) {
					for (const tc of delta.tool_calls) {
						const idx = tc.index ?? 0
						if (!toolCallsMap.has(idx)) {
							toolCallsMap.set(idx, { id: tc.id || "", name: tc.function?.name || "", arguments: "" })
						}
						const existing = toolCallsMap.get(idx)!
						if (tc.id) existing.id = tc.id
						if (tc.function?.name) existing.name = tc.function.name
						if (tc.function?.arguments) existing.arguments += tc.function.arguments
					}
				}
				
				if (choice.finish_reason) {
					finishReason = choice.finish_reason
				}
			}
			
			// Society Agent - If user stopped during stream, break out of main loop
			if (userStoppedDuringStream) {
				break
			}
			
			// Convert accumulated tool calls to array
			const toolCallsList = Array.from(toolCallsMap.values()).filter(tc => tc.id && tc.name).map(tc => ({
				id: tc.id,
				type: "function",
				function: { name: tc.name, arguments: tc.arguments }
			}))
			
			// Society Agent start - Track usage from streaming response
			if (streamUsage) {
				usageTracker.record({
					projectId: project.id,
					agentId: supervisorConfig.id,
					agentName: supervisorConfig.name,
					model,
					// Handle both OpenAI schema (prompt_tokens) and Anthropic schema (input_tokens)
					inputTokens: streamUsage.prompt_tokens || (streamUsage as any).input_tokens || 0,
					outputTokens: streamUsage.completion_tokens || (streamUsage as any).output_tokens || 0,
				})
			}
			// Society Agent end
			// Society Agent start - activity log: LLM response complete (OpenRouter)
			if (textContent.trim()) {
				agentActivityLogger.logChatOut(project.id, supervisorConfig.id, project.folder, supervisorConfig.homeFolder || "/", textContent, finishReason || "end_turn", iteration, actIterationStartTime, { input: streamUsage?.prompt_tokens, output: streamUsage?.completion_tokens })
				actChatOutLogged = true
			}
			// Society Agent end

			// Society Agent - Detect repeated text output (model stuck in loop)
			const normalizedText = textContent.trim().toLowerCase().replace(/\s+/g, ' ').substring(0, 100)
			if (normalizedText.length > 20 && normalizedText === lastTextOutput) {
				textRepeatCount++
				if (textRepeatCount >= MAX_TEXT_REPEATS) {
					log.warn(`[Supervisor] Model stuck repeating text, breaking. Repeated: "${textContent.substring(0, 50)}..."`)
					io.emit("agent-message", {
						agentId: supervisorConfig.id,
						agentName: supervisorConfig.name,
						projectId: project.id,
						message: "\n\n⚠️ *[Model stuck repeating same output - stopping]*",
						timestamp: Date.now(),
						isStreaming: false,
						isDone: true,
					})
					break
				}
			} else {
				lastTextOutput = normalizedText
				textRepeatCount = 0
			}

			// Check for tool calls
			if (toolCallsList.length === 0) {
				if (finishReason === "length") {
					log.info(`[Supervisor] OpenRouter hit length limit, auto-continuing`)
					messages.push({ role: "assistant", content: textContent || "" })
					messages.push({ role: "user", content: "Continue from where you left off." })
					continue
				}
				// Society Agent - Hallucination guard: agent made claims without using any tools
				if (actTotalToolCalls === 0 && iteration === 0 && hallucinationWarnCount < MAX_GUARD_RETRIES) {
					hallucinationWarnCount++
					hallucinationWarned = true
					log.warn(`[Supervisor] ${supervisorConfig.name} responded with 0 tool calls — pushing back (attempt ${hallucinationWarnCount})`)
					messages.push({ role: "assistant", content: textContent || "" })
					messages.push({ role: "user", content: `You haven't used any tools yet (reminder ${hallucinationWarnCount}/${MAX_GUARD_RETRIES}). If you made claims about files, processes, or the state of the system, you must verify them with tools first. Please actually check using read_file, run_command, http_request, or get_processes — then implement any needed fix.` })
					continue
				}
				// Society Agent - Fake Implementation Guard: many reads, zero writes/executes
				if (actTotalToolCalls >= 2 && writeActionsCount === 0 && executeActionsCount === 0 && iteration > 0 && fakeImplWarnCount < MAX_GUARD_RETRIES) {
					fakeImplWarnCount++
					fakeImplWarned = true
					log.warn(`[Supervisor] ${supervisorConfig.name} end_turn after ${actTotalToolCalls} reads with 0 writes/executes — fake implementation (attempt ${fakeImplWarnCount})`)
					messages.push({ role: "assistant", content: textContent || "" })
					messages.push({ role: "user", content: `You described a solution but did not implement it (reminder ${fakeImplWarnCount}/${MAX_GUARD_RETRIES}). You have read files but made no actual changes. Use write_file or run_command to implement your solution NOW. Stop investigating and start writing code.` })
					continue
				}
				// Society Agent - Premature Success Guard: stopped with very few total tool calls
				if (actTotalToolCalls > 0 && actTotalToolCalls < 3 && iteration >= 1 && prematureWarnCount < MAX_GUARD_RETRIES) {
					prematureWarnCount++
					prematureWarned = true
					log.warn(`[Supervisor] ${supervisorConfig.name} stopped after only ${actTotalToolCalls} tool calls — premature success (attempt ${prematureWarnCount})`)
					messages.push({ role: "assistant", content: textContent || "" })
					messages.push({ role: "user", content: `The task appears incomplete — you stopped after very few actions (reminder ${prematureWarnCount}/${MAX_GUARD_RETRIES}). Please verify your implementation actually works, check for remaining errors, and ensure the task is fully done.` })
					continue
				}
				// Society Agent - Inject summary request if agent did real work without summarising.
				// Skip if the response already looks like a summary (avoids double-summary with models that summarise naturally).
				const looksLikeSummary = /#{1,3}\s*(summary|what was built|what i (did|built|completed)|here.{0,10}(what|summary))/i.test(textContent || "")
				// Society Agent - Verification Phase Guard: verify before summarising
				if (!verificationRequested && actTotalToolCalls >= MIN_TOOLS_FOR_SUMMARY && !looksLikeSummary && verificationRequestCount < MAX_GUARD_RETRIES) {
					verificationRequestCount++
					verificationRequested = true
					log.info(`[Supervisor] ${supervisorConfig.name} requesting verification pass before summary`)
					messages.push({ role: "assistant", content: textContent || "" })
					messages.push({ role: "user", content: "Before summarizing, please verify your implementation: run the compiler, linter, or tests to confirm everything works. Check for any remaining errors or broken functionality." })
					continue
				}
				if (!summaryRequested && actTotalToolCalls >= MIN_TOOLS_FOR_SUMMARY && !looksLikeSummary) {
					summaryRequested = true
					log.info(`[Supervisor] ${supervisorConfig.name} end_turn after ${actTotalToolCalls} tools — requesting summary`)
					messages.push({ role: "assistant", content: textContent || "" })
					messages.push({ role: "user", content: "Please give a concise summary of everything you accomplished: what was built/changed, what is now running and on which ports, any issues found, and what the user should know or do next." })
					continue
				}
				break
			}

			// Convert assistant message back to Anthropic format for storage
			const anthropicContent: any[] = []
			if (textContent) {
				anthropicContent.push({ type: "text", text: textContent })
			}
			for (const tc of toolCallsList) {
				const toolCall = tc as any
				anthropicContent.push({
					type: "tool_use",
					id: toolCall.id,
					name: toolCall.function.name,
					input: safeParseToolArgs(toolCall.function.arguments),
				})
			}
			messages.push({ role: "assistant", content: anthropicContent })
			
			// Society Agent - Detect repeated tool calls (model stuck in loop)
			const currentToolSignature = toolCallsList.map((tc: any) => 
				`${tc.function?.name}:${JSON.stringify(safeParseToolArgs(tc.function?.arguments))}`
			).join("|")
			
			// Special handling for run_command - track history of commands
			for (const tc of toolCallsList) {
				const toolCall = tc as any
				if (toolCall.function?.name === "run_command") {
					const args = safeParseToolArgs(toolCall.function.arguments)
					const cmd = (args.command || "").substring(0, 100) // Normalize
					lastCommandRuns.push(cmd)
					if (lastCommandRuns.length > MAX_COMMAND_HISTORY) {
						lastCommandRuns.shift()
					}
					// Check if same command appears too many times
					const cmdCount = lastCommandRuns.filter(c => c === cmd).length
					if (cmdCount >= COMMAND_REPEAT_THRESHOLD) {
						log.warn(`[Supervisor] Command loop detected: "${cmd}" run ${cmdCount} times`)
						io.emit("agent-message", {
							agentId: supervisorConfig.id,
							agentName: supervisorConfig.name,
							projectId: project.id,
							message: `\n\n⚠️ *[Command loop detected - same command run ${cmdCount} times. Stopping.]*`,
							timestamp: Date.now(),
							isStreaming: false,
							isDone: true,
						})
						// Force break - set a flag and break out
						toolRepeatCount = MAX_TOOL_REPEATS + 10
						break
					}
				}
			}
			
			// Quick exit if command loop was detected
			if (toolRepeatCount > MAX_TOOL_REPEATS) {
				break
			}
			
			if (currentToolSignature === lastToolSignature) {
				toolRepeatCount++
				if (toolRepeatCount >= MAX_TOOL_REPEATS) {
					log.warn(`[Supervisor] Model stuck in tool loop, breaking. Repeated: ${currentToolSignature.substring(0, 100)}...`)
					io.emit("agent-message", {
						agentId: supervisorConfig.id,
						agentName: supervisorConfig.name,
						projectId: project.id,
						message: "\n\n⚠️ *[Model stuck repeating same tool calls - stopping]*",
						timestamp: Date.now(),
						isStreaming: false,
						isDone: true,
					})
					break
				}
			} else {
				lastToolSignature = currentToolSignature
				toolRepeatCount = 0
			}

			// Execute tools
			const toolResults: { type: "tool_result"; tool_use_id: string; content: string }[] = []
			for (const tc of toolCallsList) {
				const toolCall = tc as any
				const toolName = toolCall.function.name
				const toolInput = safeParseToolArgs(toolCall.function.arguments)
				log.info(`[Supervisor] OpenRouter Tool call: ${toolName}(${JSON.stringify(toolInput).substring(0, 200)})`)

				// Society Agent start - Show detailed tool info for ALL tools
				let toolDisplay = `🔧 **${toolName}**`
				if (toolName === "run_command" && toolInput.command) {
					toolDisplay += `\n\`\`\`bash\n${toolInput.command}\n\`\`\``
					if (toolInput.working_dir) toolDisplay += `\n📁 in \`${toolInput.working_dir}\``
					if (toolInput.background) toolDisplay += `\n⚡ Background mode`
				} else if (toolName === "write_file" && toolInput.path) {
					toolDisplay += ` → \`${toolInput.path}\` (${toolInput.content?.length || 0} bytes)`
				} else if (toolName === "read_file" && toolInput.path) {
					toolDisplay += ` → \`${toolInput.path}\``
				} else if (toolName === "list_files") {
					toolDisplay += ` → \`${toolInput.path || '.'}\``
				} else if (toolName === "create_task" && toolInput.title) {
					toolDisplay += ` → "${toolInput.title}"`
				} else if (toolName === "spawn_worker") {
					toolDisplay += ` → ${toolInput.count || 1} worker(s)`
				} else if (toolName === "delegate_task" && toolInput.agent_id) {
					toolDisplay += ` → ${toolInput.agent_id}: ${(toolInput.task || '').substring(0, 50)}...`
				}
				// Society Agent end

				// Society Agent - Suppress old streaming tool messages (replaced by tool cards)
				// io.emit("agent-message", { ... toolDisplay ... })

				const toolStartTime = Date.now()
				if (toolName === "spawn_worker") {
					log.info(`[handleSupervisorChat] spawn_worker: supervisorConfig.id=${supervisorConfig.id}, supervisorConfig.name=${supervisorConfig.name}`)
				}
				agentActivityLogger.logToolCall(project.id, supervisorConfig.id, project.folder, supervisorConfig.homeFolder || "/", toolName, toolInput, iteration, actCallIndex)
				const { result, filesCreated } = await executeSupervisorTool(
					toolName,
					toolInput,
					project,
					supervisorConfig.id,
					apiKey,
					io,
				)
				const toolDuration = Date.now() - toolStartTime
				agentActivityLogger.logToolResult(project.id, supervisorConfig.id, project.folder, supervisorConfig.homeFolder || "/", toolName, result, !result.startsWith("❌"), iteration, actCallIndex++, toolStartTime)
				// Record error to ERRORS.md for learning
				if (result.startsWith("❌")) {
					agentActivityLogger.recordToolError(project.folder, supervisorConfig.homeFolder || "/", toolName, toolInput, result)
				}
				actTotalToolCalls++
				totalFilesCreated += filesCreated
				// Society Agent - Track write/execute counts for fake-impl and premature-success guards
				if ((toolName === "write_file" || toolName === "patch_file") && !result.startsWith("❌") && !result.startsWith("⚠️")) writeActionsCount++
				if ((toolName === "run_command" || toolName === "execute_command") && !result.startsWith("❌")) executeActionsCount++

				// Society Agent - Emit tool-execution completed event for UI tool cards
				const { preview, lineCount } = extractCleanPreview(result)
				io.emit("tool-execution", {
					agentId: supervisorConfig.id,
					agentName: supervisorConfig.name,
					projectId: project.id,
					toolName,
					toolInput,
					result,
					preview,
					lineCount,
					status: result.startsWith("❌") ? "error" : "completed",
					durationMs: toolDuration,
					timestamp: Date.now(),
				})

				if (toolName === "delegate_task") {
					const input = toolInput as { agent_id: string; task: string }
					const targetConfig = project.agents.find(a => a.id === input.agent_id)
					delegationResults.push({
						agentId: input.agent_id,
						agentName: targetConfig?.name || input.agent_id,
						filesCreated,
						responseLength: result.length,
					})
				}

				toolResults.push({ type: "tool_result", tool_use_id: tc.id, content: result })

				// Society Agent - Track modifications vs verifications for stall detection
				if (toolName === "run_command" && toolInput.command) {
					if (VERIFICATION_CMD_RE.test(toolInput.command)) {
						modsSinceLastVerification = 0
					} else if (MODIFICATION_CMD_RE.test(String(toolInput.command))) {
						modsSinceLastVerification++
					}
				} else if (MODIFICATION_TOOL_NAMES.has(toolName)) {
					modsSinceLastVerification++
				}
			}

			// Society Agent - Inject forced verification reminder after too many mods with no check
			if (modsSinceLastVerification >= VERIFY_AFTER_MODS_THRESHOLD && toolResults.length > 0) {
				const lastResult = toolResults[toolResults.length - 1] as any
				const verifyWarning = `\n\n⚠️ **SYSTEM NOTICE – VERIFY BEFORE CONTINUING**: You have made ${modsSinceLastVerification} code/file modifications without running a compilation or type check. You MUST stop making changes and run the compiler/linter now:\n- TypeScript: \`tsc --noEmit 2>&1 | head -30\`\n- JavaScript: \`npm run build 2>&1 | head -30\`\n- Python (type check): \`python -m mypy . 2>&1 | head -30\` or \`pyright 2>&1 | head -30\`\n- Python (lint): \`ruff check . 2>&1 | head -30\` or \`flake8 . 2>&1 | head -30\`\n- Python (tests): \`python -m pytest 2>&1 | tail -20\`\n- Rust: \`cargo check 2>&1 | head -30\`\n- Go: \`go build ./... 2>&1 | head -30\`\n\nDo NOT edit any more files until you have confirmed the error count has actually decreased. If errors remain, diagnose the root cause from the compiler output — do NOT keep guessing at fixes blindly.`
				if (typeof lastResult.content === 'string') {
					lastResult.content += verifyWarning
				}
				modsSinceLastVerification = 0
				log.warn(`[Supervisor] ${supervisorConfig.name} forced verification reminder after ${VERIFY_AFTER_MODS_THRESHOLD} mods without check`)
			}

			// Society Agent start - Track what tools were used for progress message
			const toolNames = toolCallsList.map((tc: any) => {
				const name = tc.function.name
				const args = safeParseToolArgs(tc.function.arguments)
				if (name === "write_file" && args.path) return `wrote ${args.path.split('/').pop()}`
				if (name === "read_file" && args.path) return `read ${args.path.split('/').pop()}`
				if (name === "run_command") return "ran command"
				if (name === "delegate_task") return `delegated to ${args.agent_id}`
				if (name === "create_task") return `created task`
				if (name === "list_files") return "listed files"
				return name.replace(/_/g, ' ')
			})
			lastActionDescription = toolNames.join(", ")
			// Society Agent end

			messages.push({ role: "user", content: toolResults })
			continue
		}
		// Society Agent end - OpenRouter path

		// Anthropic path
		if (!anthropic) {
			throw new Error("No API client configured - check settings")
		}

		const stream = await anthropic.messages.stream({
			model,
			max_tokens: 16384, // Society Agent - Increased from 8096 for longer tasks
			system: systemPrompt,
			messages,
			tools: AGENT_TOOLS,
		})

		// Society Agent start - TRUE STREAMING: emit text as it arrives
		let textContent = ""
		let anthropicLoopDetected = false
		let anthropicUserStopped = false
		let lastAnthropicChunk = ""
		let anthropicRepeatCount = 0
		
		// Society Agent - Periodic stop check during Anthropic streaming
		const stopCheckInterval = setInterval(() => {
			if (stoppedAgents.has(supervisorConfig.id)) {
				log.info(`[Supervisor] ${supervisorConfig.name} stopped by user during Anthropic stream`)
				stoppedAgents.delete(supervisorConfig.id)
				anthropicUserStopped = true
				anthropicLoopDetected = true // Reuse the loop flag to break
				io.emit("agent-message", {
					agentId: supervisorConfig.id,
					agentName: supervisorConfig.name,
					projectId: project.id,
					message: "\n⛔ **Stopped by user**\n",
					timestamp: Date.now(),
					isStreaming: false,
					isDone: true,
				})
				try {
					stream.abort() // Try to abort the stream
				} catch (e) { /* ignore */ }
			}
		}, 100) // Check every 100ms
		
		// Stream text chunks in real-time
		stream.on('text', (text) => {
			if (anthropicLoopDetected || anthropicUserStopped) return // Skip if stopped
			
			textContent += text
			fullResponse += text
			
			// Detect chunk-level repetition
			if (text === lastAnthropicChunk && text.length > 5) {
				anthropicRepeatCount++
				if (anthropicRepeatCount >= 3) {
					anthropicLoopDetected = true
					log.warn(`[Supervisor] Anthropic chunk loop detected, will stop`)
					io.emit("agent-message", {
						agentId: supervisorConfig.id,
						agentName: supervisorConfig.name,
						projectId: project.id,
						message: "\n\n⚠️ *[Model stuck in loop - stopping]*",
						timestamp: Date.now(),
						isStreaming: false,
						isDone: true,
					})
					try { stream.abort() } catch (e) {}
					return
				}
			} else {
				lastAnthropicChunk = text
				anthropicRepeatCount = 0
			}
			
			// Detect phrase-level repetition in accumulated text
			if (textContent.length > 100) {
				const lastChars = textContent.slice(-80)
				const pattern = lastChars.substring(0, 30)
				try {
					const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
					const occurrences = (textContent.match(new RegExp(escaped, 'gi')) || []).length
					if (occurrences >= 3) {
						anthropicLoopDetected = true
						log.warn(`[Supervisor] Anthropic phrase loop detected ("${pattern.substring(0, 20)}..." x${occurrences})`)
						io.emit("agent-message", {
							agentId: supervisorConfig.id,
							agentName: supervisorConfig.name,
							projectId: project.id,
							message: "\n\n⚠️ *[Repeating phrase detected - stopping]*",
							timestamp: Date.now(),
							isStreaming: false,
							isDone: true,
						})
						try { stream.abort() } catch (e) {}
						return
					}
				} catch (e) { /* ignore regex errors */ }
			}
			
			io.emit("agent-message", {
				agentId: supervisorConfig.id,
				agentName: supervisorConfig.name,
				projectId: project.id,
				message: text,
				timestamp: Date.now(),
				isStreaming: true,
			})
		})

		// Wait for complete message (needed for tool_use blocks)
		let finalMessage
		try {
			finalMessage = await stream.finalMessage()
		} catch (e: any) {
			// Stream may have been aborted
			if (anthropicUserStopped || anthropicLoopDetected) {
				clearInterval(stopCheckInterval)
				break
			}
			throw e
		}
		
		// Clear the stop check interval
		clearInterval(stopCheckInterval)
		
		// If loop detected or user stopped during streaming, break out
		if (anthropicLoopDetected || anthropicUserStopped) {
			break
		}
		// Society Agent end

		// Society Agent start - Handle extended thinking blocks for supervisor
		for (const block of finalMessage.content) {
			if ((block as any).type === "thinking") {
				io.emit("agent-thinking", {
					agentId: supervisorConfig.id,
					agentName: supervisorConfig.name,
					projectId: project.id,
					thinking: (block as any).thinking,
					timestamp: Date.now(),
				})
			}
		}
		// Society Agent end

		// Society Agent start - Track token usage for supervisor
		if (finalMessage.usage) {
			usageTracker.record({
				projectId: project.id,
				agentId: supervisorConfig.id,
				agentName: supervisorConfig.name,
				model,
				inputTokens: finalMessage.usage.input_tokens,
				outputTokens: finalMessage.usage.output_tokens,
			})
		}
		// Society Agent end
		// Society Agent start - activity log: LLM response complete (Anthropic)
		if (textContent.trim()) {
			agentActivityLogger.logChatOut(project.id, supervisorConfig.id, project.folder, supervisorConfig.homeFolder || "/", textContent, finalMessage.stop_reason || "end_turn", iteration, actIterationStartTime, { input: finalMessage.usage?.input_tokens, output: finalMessage.usage?.output_tokens })
			actChatOutLogged = true
		}
		// Society Agent end

		// Note: text was already streamed via stream.on('text') above
		
		// Society Agent - Detect repeated text output (model stuck in loop)
		const normalizedText = textContent.trim().toLowerCase().replace(/\s+/g, ' ').substring(0, 100)
		if (normalizedText.length > 20 && normalizedText === lastTextOutput) {
			textRepeatCount++
			if (textRepeatCount >= MAX_TEXT_REPEATS) {
				log.warn(`[Supervisor] Model stuck repeating text, breaking. Repeated: "${textContent.substring(0, 50)}..."`)
				io.emit("agent-message", {
					agentId: supervisorConfig.id,
					agentName: supervisorConfig.name,
					projectId: project.id,
					message: "\n\n⚠️ *[Model stuck repeating same output - stopping]*",
					timestamp: Date.now(),
					isStreaming: false,
					isDone: true,
				})
				break
			}
		} else {
			lastTextOutput = normalizedText
			textRepeatCount = 0
		}

		// Check if the LLM wants to use tools
		const toolBlocks = finalMessage.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")

		// Society Agent start - Auto-continue on max_tokens for supervisor
		if (toolBlocks.length === 0) {
			if (finalMessage.stop_reason === "end_turn") {
				// Society Agent - Hallucination guard: model answered with 0 tools
				if (actTotalToolCalls === 0 && iteration === 0 && hallucinationWarnCount < MAX_GUARD_RETRIES) {
					hallucinationWarnCount++
					hallucinationWarned = true
					log.warn(`[Supervisor] ${supervisorConfig.name} end_turn with 0 tool calls on iteration 0 — suspected hallucination, pushing back (attempt ${hallucinationWarnCount})`)
					io.emit("agent-message", {
						agentId: supervisorConfig.id,
						agentName: supervisorConfig.name,
						projectId: project.id,
						message: "\n*[You haven't used any tools yet. Please use the available tools to complete the task rather than just describing what you would do.]*\n",
						timestamp: Date.now(),
						isStreaming: false,
					})
					messages.push({ role: "assistant", content: finalMessage.content })
					messages.push({ role: "user", content: `You haven't used any tools yet (reminder ${hallucinationWarnCount}/${MAX_GUARD_RETRIES}). Please actually use the tools available to you (read_file, write_file, run_command, etc.) to complete the task. Don't just describe what you would do — do it.` })
					continue
				}
				// Society Agent - Auto-continue if agent only read files without making changes
				if (!hasWrittenFiles && iteration > 0 && meaningfulActionsCount > 0) {
					consecutiveReadOnlyStops++
					if (consecutiveReadOnlyStops <= 2) {
						log.info(`[Supervisor] Stopped after reading files without making changes, auto-continuing (attempt ${consecutiveReadOnlyStops})`)
						io.emit("agent-message", {
							agentId: supervisorConfig.id,
							agentName: supervisorConfig.name,
							projectId: project.id,
							message: "\n*[You analyzed the problem but didn't implement changes. Continuing to fix the issue...]*\n",
							timestamp: Date.now(),
							isStreaming: false,
						})
						messages.push({ role: "assistant", content: finalMessage.content })
						messages.push({ role: "user", content: "You've analyzed the problem but stopped without implementing a fix. Please continue and make the necessary code changes using write_file to fix the issue you identified. Don't just analyze - implement the solution." })
						continue
					}
				}
				// Society Agent - Fake Implementation Guard: many reads, zero writes/executes
				if (actTotalToolCalls >= 2 && writeActionsCount === 0 && executeActionsCount === 0 && iteration > 0 && fakeImplWarnCount < MAX_GUARD_RETRIES) {
					fakeImplWarnCount++
					fakeImplWarned = true
					log.warn(`[Supervisor] ${supervisorConfig.name} end_turn after ${actTotalToolCalls} reads with 0 writes/executes — fake implementation (attempt ${fakeImplWarnCount})`)
					io.emit("agent-message", { agentId: supervisorConfig.id, agentName: supervisorConfig.name, projectId: project.id, message: `\n*[You described a solution but made no file changes. Implement it now (attempt ${fakeImplWarnCount}/${MAX_GUARD_RETRIES}).]*\n`, timestamp: Date.now(), isStreaming: false })
					messages.push({ role: "assistant", content: finalMessage.content })
					messages.push({ role: "user", content: `You described a solution but did not implement it (reminder ${fakeImplWarnCount}/${MAX_GUARD_RETRIES}). You have read files but made no actual changes. Use write_file or run_command to implement your solution NOW. Stop investigating and start writing code.` })
					continue
				}
				// Society Agent - Premature Success Guard: stopped with very few total tool calls
				if (actTotalToolCalls > 0 && actTotalToolCalls < 3 && iteration >= 1 && prematureWarnCount < MAX_GUARD_RETRIES) {
					prematureWarnCount++
					prematureWarned = true
					log.warn(`[Supervisor] ${supervisorConfig.name} stopped after only ${actTotalToolCalls} tool calls — premature success (attempt ${prematureWarnCount})`)
					io.emit("agent-message", { agentId: supervisorConfig.id, agentName: supervisorConfig.name, projectId: project.id, message: `\n*[Task appears incomplete — very few actions taken. Verifying... (attempt ${prematureWarnCount}).]*\n`, timestamp: Date.now(), isStreaming: false })
					messages.push({ role: "assistant", content: finalMessage.content })
					messages.push({ role: "user", content: `The task appears incomplete — you stopped after very few actions (reminder ${prematureWarnCount}/${MAX_GUARD_RETRIES}). Please verify your implementation actually works, check for remaining errors, and ensure the task is fully done.` })
					continue
				}
				// Society Agent - Inject summary request if agent did real work without summarising
				const lastText = finalMessage.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map(b => b.text).join("\n")
				const looksLikeSummary = /#{1,3}\s*(summary|what was built|what I built|what was done|completed|accomplished|implemented|changes made|work done)/i.test(lastText)
				// Society Agent - Verification Phase Guard: verify before summarising
				if (!verificationRequested && actTotalToolCalls >= MIN_TOOLS_FOR_SUMMARY && !looksLikeSummary && verificationRequestCount < MAX_GUARD_RETRIES) {
					verificationRequestCount++
					verificationRequested = true
					log.info(`[Supervisor] ${supervisorConfig.name} requesting verification pass before summary`)
					io.emit("agent-message", { agentId: supervisorConfig.id, agentName: supervisorConfig.name, projectId: project.id, message: "\n*[Requesting verification before summary...]*\n", timestamp: Date.now(), isStreaming: false })
					messages.push({ role: "assistant", content: finalMessage.content })
					messages.push({ role: "user", content: "Before summarizing, please verify your implementation: run the compiler, linter, or tests to confirm everything works. Check for any remaining errors or broken functionality." })
					continue
				}
				if (!summaryRequested && actTotalToolCalls >= MIN_TOOLS_FOR_SUMMARY && !looksLikeSummary) {
					summaryRequested = true
					log.info(`[Supervisor] ${supervisorConfig.name} end_turn after ${actTotalToolCalls} tools — requesting summary`)
					messages.push({ role: "assistant", content: finalMessage.content })
					messages.push({ role: "user", content: "Please give a concise summary of everything you accomplished: what was built/changed, what is now running and on which ports, any issues found, and what the user should know or do next." })
					continue
				}
				// Model explicitly finished - done
				break
			} else if (finalMessage.stop_reason === "max_tokens") {
				// Hit token limit - auto-continue
				log.info(`[Supervisor] Hit max_tokens, auto-continuing (iteration ${iteration + 1})`)
				io.emit("agent-message", {
					agentId: supervisorConfig.id,
					agentName: supervisorConfig.name,
					projectId: project.id,
					message: "\n*[Auto-continuing...]*\n",
					timestamp: Date.now(),
					isStreaming: true,
				})
				messages.push({ role: "assistant", content: finalMessage.content })
				messages.push({ role: "user", content: "Continue from where you left off." })
				continue
			} else {
				// Other stop reason - stop to be safe
				break
			}
		}
		// Society Agent end

		// Add the assistant's message (with tool_use blocks) to conversation
		messages.push({ role: "assistant", content: finalMessage.content })

		// Society Agent - Detect repeated tool calls (model stuck in loop)
		const currentToolSignature = toolBlocks.map(tb => 
			`${tb.name}:${JSON.stringify(tb.input)}`
		).join("|")
		
		// Special handling for run_command - track history of commands
		for (const tb of toolBlocks) {
			if (tb.name === "run_command") {
				const cmd = ((tb.input as any).command || "").substring(0, 100)
				lastCommandRuns.push(cmd)
				if (lastCommandRuns.length > MAX_COMMAND_HISTORY) {
					lastCommandRuns.shift()
				}
				const cmdCount = lastCommandRuns.filter(c => c === cmd).length
				if (cmdCount >= COMMAND_REPEAT_THRESHOLD) {
					log.warn(`[Supervisor] Command loop detected: "${cmd}" run ${cmdCount} times`)
					io.emit("agent-message", {
						agentId: supervisorConfig.id,
						agentName: supervisorConfig.name,
						projectId: project.id,
						message: `\n\n⚠️ *[Command loop detected - same command run ${cmdCount} times. Stopping.]*`,
						timestamp: Date.now(),
						isStreaming: false,
						isDone: true,
					})
					toolRepeatCount = MAX_TOOL_REPEATS + 10
					break
				}
			}
		}
		
		// Quick exit if command loop was detected
		if (toolRepeatCount > MAX_TOOL_REPEATS) {
			break
		}
		
		if (currentToolSignature === lastToolSignature) {
			toolRepeatCount++
			if (toolRepeatCount >= MAX_TOOL_REPEATS) {
				log.warn(`[Supervisor] Model stuck in tool loop, breaking. Repeated: ${currentToolSignature.substring(0, 100)}...`)
				io.emit("agent-message", {
					agentId: supervisorConfig.id,
					agentName: supervisorConfig.name,
					projectId: project.id,
					message: "\n\n⚠️ *[Model stuck repeating same tool calls - stopping]*",
					timestamp: Date.now(),
					isStreaming: false,
					isDone: true,
				})
				break
			}
		} else {
			lastToolSignature = currentToolSignature
			toolRepeatCount = 0
		}

		// Execute each tool call and build results
		const toolResults: Anthropic.ToolResultBlockParam[] = []
		for (const toolBlock of toolBlocks) {
			log.info(`[Supervisor] Tool call: ${toolBlock.name}(${JSON.stringify(toolBlock.input).substring(0, 200)})`)

			// Society Agent start - Show detailed tool info for ALL tools
			let toolDisplay = `🔧 **${toolBlock.name}**`
			const input = toolBlock.input as Record<string, any>
			if (toolBlock.name === "run_command" && input.command) {
				toolDisplay += `\n\`\`\`bash\n${input.command}\n\`\`\``
				if (input.working_dir) toolDisplay += `\n📁 in \`${input.working_dir}\``
				if (input.background) toolDisplay += `\n⚡ Background mode`
			} else if (toolBlock.name === "write_file" && input.path) {
				toolDisplay += ` → \`${input.path}\` (${input.content?.length || 0} bytes)`
			} else if (toolBlock.name === "read_file" && input.path) {
				toolDisplay += ` → \`${input.path}\``
			} else if (toolBlock.name === "list_files") {
				toolDisplay += ` → \`${input.path || '.'}\``
			} else if (toolBlock.name === "create_task" && input.title) {
				toolDisplay += ` → "${input.title}"`
			} else if (toolBlock.name === "spawn_worker") {
				toolDisplay += ` → ${input.count || 1} worker(s)`
			} else if (toolBlock.name === "delegate_task" && input.agent_id) {
				toolDisplay += ` → ${input.agent_id}: ${(input.task || '').substring(0, 50)}...`
			} else if (toolBlock.name === "propose_new_agent" && input.name) {
				toolDisplay += ` → "${input.name}" (${input.role || 'worker'})`
			} else if (toolBlock.name === "list_team") {
				toolDisplay += ` → checking team members`
			}
			// Society Agent end

			// Society Agent - Suppress old streaming tool messages (replaced by tool cards)
			// io.emit("agent-message", { ... toolDisplay ... })

			const toolStartTime = Date.now()
			agentActivityLogger.logToolCall(project.id, supervisorConfig.id, project.folder, supervisorConfig.homeFolder || "/", toolBlock.name, toolBlock.input as Record<string, unknown>, iteration, actCallIndex)
			const { result, filesCreated } = await executeSupervisorTool(
				toolBlock.name,
				toolBlock.input,
				project,
				supervisorConfig.id,
				apiKey,
				io,
			)
			const toolDuration = Date.now() - toolStartTime
			agentActivityLogger.logToolResult(project.id, supervisorConfig.id, project.folder, supervisorConfig.homeFolder || "/", toolBlock.name, result, !result.startsWith("❌"), iteration, actCallIndex++, toolStartTime)
			// Record error to ERRORS.md for learning
			if (result.startsWith("❌")) {
				agentActivityLogger.recordToolError(project.folder, supervisorConfig.homeFolder || "/", toolBlock.name, toolBlock.input as Record<string, unknown>, result)
			}
			actTotalToolCalls++
			// Society Agent - Track write/execute counts for fake-impl and premature-success guards
			if ((toolBlock.name === "write_file" || toolBlock.name === "patch_file") && !result.startsWith("❌") && !result.startsWith("⚠️")) writeActionsCount++
			if ((toolBlock.name === "run_command" || toolBlock.name === "execute_command") && !result.startsWith("❌")) executeActionsCount++

			totalFilesCreated += filesCreated
			
			// Society Agent - Track if agent made changes (vs only reading)
			if (filesCreated > 0 || !READ_ONLY_TOOLS.has(toolBlock.name)) {
				hasWrittenFiles = true
				consecutiveReadOnlyStops = 0
			}

			// Society Agent - Emit tool-execution completed event for UI tool cards
			const { preview, lineCount } = extractCleanPreview(result)
			io.emit("tool-execution", {
				agentId: supervisorConfig.id,
				agentName: supervisorConfig.name,
				projectId: project.id,
				toolName: toolBlock.name,
				toolInput: toolBlock.input,
				result,
				preview,
				lineCount,
				status: result.startsWith("❌") ? "error" : "completed",
				durationMs: toolDuration,
				timestamp: Date.now(),
			})

			if (toolBlock.name === "delegate_task") {
				const input = toolBlock.input as { agent_id: string; task: string }
				const targetConfig = project.agents.find(a => a.id === input.agent_id)
				delegationResults.push({
					agentId: input.agent_id,
					agentName: targetConfig?.name || input.agent_id,
					filesCreated,
					responseLength: result.length,
				})
			}

			toolResults.push({
				type: "tool_result",
				tool_use_id: toolBlock.id,
				content: result,
			})

			// Society Agent - Track modifications vs verifications for stall detection (Anthropic path)
			const tbInput = toolBlock.input as Record<string, any>
			if (toolBlock.name === "run_command" && tbInput.command) {
				if (VERIFICATION_CMD_RE.test(String(tbInput.command))) {
					modsSinceLastVerification = 0
				} else if (MODIFICATION_CMD_RE.test(String(tbInput.command))) {
					modsSinceLastVerification++
				}
			} else if (MODIFICATION_TOOL_NAMES.has(toolBlock.name)) {
				modsSinceLastVerification++
			}
		}

		// Society Agent - Inject forced verification reminder after too many mods with no check (Anthropic path)
		if (modsSinceLastVerification >= VERIFY_AFTER_MODS_THRESHOLD && toolResults.length > 0) {
			const lastResult = toolResults[toolResults.length - 1] as any
			const verifyWarning = `\n\n⚠️ **SYSTEM NOTICE – VERIFY BEFORE CONTINUING**: You have made ${modsSinceLastVerification} code/file modifications without running a compilation or type check. You MUST stop making changes and run the compiler/linter now:\n- TypeScript: \`tsc --noEmit 2>&1 | head -30\`\n- JavaScript: \`npm run build 2>&1 | head -30\`\n- Python (type check): \`python -m mypy . 2>&1 | head -30\` or \`pyright 2>&1 | head -30\`\n- Python (lint): \`ruff check . 2>&1 | head -30\` or \`flake8 . 2>&1 | head -30\`\n- Python (tests): \`python -m pytest 2>&1 | tail -20\`\n- Rust: \`cargo check 2>&1 | head -30\`\n- Go: \`go build ./... 2>&1 | head -30\`\n\nDo NOT edit any more files until you have confirmed the error count has actually decreased. If errors remain, diagnose the root cause from the compiler output — do NOT keep guessing at fixes blindly.`
			if (typeof lastResult.content === 'string') {
				lastResult.content += verifyWarning
			}
			modsSinceLastVerification = 0
			log.warn(`[Supervisor] ${supervisorConfig.name} forced verification reminder after ${VERIFY_AFTER_MODS_THRESHOLD} mods without check`)
		}

		// Society Agent start - Track what tools were used for progress message  
		const toolNames = toolBlocks.map((tb: Anthropic.ToolUseBlock) => {
			const input = tb.input as Record<string, any>
			if (tb.name === "write_file" && input.path) return `wrote ${input.path.split('/').pop()}`
			if (tb.name === "read_file" && input.path) return `read ${input.path.split('/').pop()}`
			if (tb.name === "run_command") return "ran command"
			if (tb.name === "delegate_task") return `delegated to ${input.agent_id}`
			if (tb.name === "create_task") return `created task`
			if (tb.name === "list_files") return "listed files"
			return tb.name.replace(/_/g, ' ')
		})
		lastActionDescription = toolNames.join(", ")
		// Society Agent end

		// Add tool results as user message
		messages.push({ role: "user", content: toolResults })
		
		// Society Agent - Track meaningful progress
		if (totalFilesCreated > filesCreatedSinceLastCheck) {
			lastProgressTime = Date.now()
			filesCreatedSinceLastCheck = totalFilesCreated
			meaningfulActionsCount++
		}
		
		// Society Agent - Progress checkpoint every N iterations
		if (iteration > 0 && iteration % PROGRESS_CHECK_INTERVAL === 0) {
			const timeSinceProgress = Date.now() - lastProgressTime
			log.info(`[Supervisor] ${supervisorConfig.name} checkpoint: iteration ${iteration}, files created: ${totalFilesCreated}, meaningful actions: ${meaningfulActionsCount}`)
			
			// Emit progress update for visibility
			io.emit("agent-progress", {
				agentId: supervisorConfig.id,
				agentName: supervisorConfig.name,
				projectId: project.id,
				iteration,
				totalFilesCreated,
				lastAction: lastActionDescription,
				timestamp: Date.now(),
			})
			
			// Check for stall (no progress in 5 minutes)
			if (timeSinceProgress > STALL_THRESHOLD_MS && meaningfulActionsCount === 0) {
				log.warn(`[Supervisor] ${supervisorConfig.name} appears stalled - no progress in ${Math.round(timeSinceProgress / 60000)} minutes`)
				io.emit("agent-message", {
					agentId: supervisorConfig.id,
					agentName: supervisorConfig.name,
					projectId: project.id,
					message: `\n\n⚠️ **Agent may be stalled** - No meaningful progress in ${Math.round(timeSinceProgress / 60000)} minutes.\n\nLast action: ${lastActionDescription || 'unknown'}\n\nType "continue" to keep going or "stop" to abort.`,
					timestamp: Date.now(),
					isStreaming: true,
				})
			}
		}
	}

	// Society Agent - Notify if iteration limit was hit (now 100 iterations)
	if (iterationCount >= MAX_TOOL_ITERATIONS) {
		log.warn(`[Supervisor] ${supervisorConfig.name} hit iteration limit (${MAX_TOOL_ITERATIONS})`)
		io.emit("agent-message", {
			agentId: supervisorConfig.id,
			agentName: supervisorConfig.name,
			projectId: project.id,
			message: `\n\n⚠️ **Reached ${MAX_TOOL_ITERATIONS} iterations**\n\nProgress: ${totalFilesCreated} files created, ${meaningfulActionsCount} meaningful actions\nLast action: ${lastActionDescription || 'unknown'}\n\nSend "continue" to keep working on this task.`,
			timestamp: Date.now(),
			isStreaming: true,
		})
		fullResponse += `\n\n⚠️ [Checkpoint at ${MAX_TOOL_ITERATIONS} iterations - send "continue" to proceed]`
	}

	// Signal streaming done
	io.emit("agent-message", {
		agentId: supervisorConfig.id,
		agentName: supervisorConfig.name,
		projectId: project.id,
		message: "",
		timestamp: Date.now(),
		isStreaming: false,
		isDone: true,
	})

	// Store the full assistant response in agent history
	await (agent as any).addMessage("assistant", fullResponse)

	// Extract files from supervisor's own response
	try {
		const supervisorFiles = await agent.extractAndCreateFiles(fullResponse)
		if (supervisorFiles > 0) {
			totalFilesCreated += supervisorFiles
		}
	} catch (_) { /* ignore */ }

	// Society Agent start - activity log: ensure final response is logged
	// If the agent only used tools without text output, log a summary response
	// This ensures the Activity log shows what the agent accomplished
	// Only log if no chat_out was logged during iterations (avoid double-logging)
	if (!actChatOutLogged && actTotalToolCalls > 0) {
		if (fullResponse.trim()) {
			// Log the accumulated fullResponse as a final chat_out
			agentActivityLogger.logChatOut(
				project.id,
				supervisorConfig.id,
				project.folder,
				supervisorConfig.homeFolder || "/",
				fullResponse.substring(0, 5000), // Cap at 5000 chars to avoid huge logs
				actLoopExitReason,
				iterationCount,
				actLoopStartTime,
			)
		} else {
			// Agent used tools but produced no text - log a placeholder
			agentActivityLogger.logChatOut(
				project.id,
				supervisorConfig.id,
				project.folder,
				supervisorConfig.homeFolder || "/",
				`[Completed ${actTotalToolCalls} tool calls, created ${totalFilesCreated} file(s)]`,
				actLoopExitReason,
				iterationCount,
				actLoopStartTime,
			)
		}
	}
	// Society Agent end
	
	// Society Agent start - activity log: loop finished
	agentActivityLogger.logLoopExit(project.id, supervisorConfig.id, project.folder, supervisorConfig.homeFolder || "/", actLoopExitReason as any, iterationCount, actTotalToolCalls, actLoopStartTime)
	// Society Agent end

	// Society Agent - Pending-task auto-continue
	// If the loop exited normally but the agent was working on tasks that aren't done,
	// auto-fire a follow-up round so it doesn't silently go idle.
	const agentWasWorking = actTotalToolCalls > 0 && actLoopExitReason !== "user_stopped"
	if (agentWasWorking) {
		const pendingTasks = projectStore.getTasks(project.id)
			.filter(t => t.status === "available" || (t.status === "in-progress" && t.claimedBy === supervisorConfig.id))
		const inProgressTasks = pendingTasks.filter(t => t.status === "in-progress")
		const availableTasks = pendingTasks.filter(t => t.status === "available")
		if (pendingTasks.length > 0) {
			const taskList = pendingTasks.slice(0, 5).map(t => `- [${t.status}] ${t.title}`).join("\n")
			const continueMsg = inProgressTasks.length > 0
				? `You have an in-progress task that wasn't completed. Please continue:\n${taskList}`
				: `There are ${availableTasks.length} pending task(s) in the pool. Please continue working:\n${taskList}`
			log.info(`[Supervisor] ${supervisorConfig.name} has ${pendingTasks.length} pending task(s) after loop exit — auto-continuing`)
			io.emit("agent-message", {
				agentId: supervisorConfig.id,
				agentName: supervisorConfig.name,
				projectId: project.id,
				message: `\n*[${pendingTasks.length} task(s) still pending — continuing automatically...]*\n`,
				timestamp: Date.now(),
				isStreaming: false,
			})
			// Re-invoke in background to avoid deep recursion; fire-and-forget with a small delay
			setTimeout(async () => {
				try {
					await handleSupervisorChat(supervisorConfig, project, continueMsg, undefined, apiKey, io)
				} catch (err: any) {
					log.error(`[Supervisor] ${supervisorConfig.name} auto-continue error:`, err)
				}
			}, 500)
		}
	}
	// Society Agent end

	return { fullResponse, delegationResults, totalFilesCreated }
}
// Society Agent end

/**
 * Run an ephemeral worker agent that claims and executes a task.
 * The worker will auto-destruct when done.
 */
async function runEphemeralWorker(
	workerConfig: ProjectAgentConfig,
	project: Project,
	apiKey: string,
	io: SocketIOServer,
): Promise<void> {
	const workerId = workerConfig.id
	const workerName = workerConfig.name
	
	log.info(`[Worker ${workerName}] Starting execution loop`)
	// Society Agent - Reset budget for this worker session
	usageTracker.resetAgentSession(workerId)
	
	// Activity logging setup
	const workerHomeFolder = workerConfig.homeFolder || "/"
	const workerStartTime = Date.now()
	let totalToolCalls = 0
	
	// Emit worker started event
	io.emit("worker-started", {
		projectId: project.id,
		workerId,
		workerName,
		timestamp: Date.now(),
	})
	
	// Get provider configuration
	let anthropic: Anthropic | null = null
	let openRouterClient: OpenAI | null = null
	let model: string
	let useOpenRouter = false

	if (standaloneSettings.isInitialized() && standaloneSettings.hasApiKey()) {
		const providerConfig = standaloneSettings.getProvider()
		if (providerConfig.type === "openrouter") {
			openRouterClient = new OpenAI({
				baseURL: "https://openrouter.ai/api/v1",
				apiKey: providerConfig.apiKey,
			})
			model = providerConfig.model
			useOpenRouter = true
		} else {
			anthropic = new Anthropic({ apiKey: providerConfig.apiKey })
			model = providerConfig.model
		}
	} else if (apiKey) {
		anthropic = new Anthropic({ apiKey })
		model = "claude-sonnet-4-20250514"
	} else {
		throw new Error("No API key configured for worker")
	}
	
	// Log worker start (after model is determined)
	agentActivityLogger.logAgentStart(project.id, workerId, project.folder, workerHomeFolder, "task_claim", model)
	
	// Build worker system prompt
	const systemPrompt = workerConfig.systemPrompt || `You are an ephemeral worker agent.
Your job is to:
1. First, call \`claim_task()\` to get a task from the pool
2. Read the task details and execute it using available tools
3. When done, call \`complete_task(files_created, files_modified, summary)\`
4. If you can't complete it, call \`fail_task(reason)\`

You will self-destruct after completing or failing. Focus on your task.`

	const isRetryWorker = workerConfig.role?.includes("auto-retry")
	const messages: Anthropic.MessageParam[] = [
		{
			role: "user",
			content: isRetryWorker
				? `You are resuming an unfinished task. Call \`claim_task()\` now to reclaim it, then review the progress notes in your instructions and continue from where the previous worker left off — do NOT redo work already done.`
				: "You have been spawned as an ephemeral worker. Start by claiming a task from the pool.",
		},
	]
	
	let fullResponse = ""
	const MAX_ITERATIONS = 100 // Society Agent - increased from 20 to allow workers to complete more complex tasks
	let taskCompleted = false
	let loopExitReason: "max_iterations" | "stopped_by_user" | "model_stopped" | "too_many_errors" = "max_iterations"
	let hasWrittenFiles = false // Track if agent made any modifications
	const READ_ONLY_TOOLS = new Set(["read_project_file", "list_project_files", "read_file", "list_dir", "get_team_info", "list_files", "search_in_files"])
	let consecutiveReadOnlyStops = 0 // Track consecutive stops after only reading
	let actualIterations = 0 // Track actual iterations for activity logging

	// Investigation stall detection — prevent endless read-only loops
	let consecutiveReadOnlyIterations = 0
	const INVESTIGATION_STALL_THRESHOLD = 4 // inject redirect after this many pure-read iterations
	const recentToolCallKeys: string[] = [] // rolling window of "toolName:argHash" to detect duplicate calls
	const MAX_RECENT_TOOL_KEYS = 12

	function toolCallKey(name: string, input: Record<string, any>): string {
		const sig = JSON.stringify(Object.entries(input).sort())
		return `${name}:${sig.slice(0, 80)}`
	}
	function countDuplicateKey(key: string): number {
		return recentToolCallKeys.filter(k => k === key).length
	}
	
	for (let iteration = 0; iteration < MAX_ITERATIONS && !taskCompleted; iteration++) {
		actualIterations = iteration + 1
		
		// Society Agent - Check if worker should stop
		if (stoppedAgents.has(workerId)) {
			log.info(`[Worker ${workerName}] Stop requested by user`)
			loopExitReason = "stopped_by_user"
			stoppedAgents.delete(workerId)
			io.emit("agent-message", {
				agentId: workerId,
				agentName: workerName,
				projectId: project.id,
				message: `\n🛑 **Worker stopped by user**`,
				timestamp: Date.now(),
				isStreaming: false,
			})
			break
		}

		// Society Agent - Trim old tool results if approaching context limit
		// 16.7A: cap history to last N turns before trimming
		const _wLimited = limitHistory(messages)
		if (_wLimited.length < messages.length) messages.splice(0, messages.length, ..._wLimited)
		const wTrimCount = trimMessagesForContext(systemPrompt, messages)
		const wEstimatedCtx = estimateMessagesTokens(systemPrompt, messages)
		io.emit("context-stats", {
			agentId: workerId,
			messageCount: messages.length,
			estimated: wEstimatedCtx,
			trimCount: wTrimCount,
		})
		if (wTrimCount > 0) {
			log.warn(`[Worker ${workerName}] Trimmed ${wTrimCount} old message parts to fit context (~${wEstimatedCtx} tokens)`)
		}

		log.info(`[Worker ${workerName}] Iteration ${actualIterations}`)
		
		// Society Agent - investigation stall redirect
		if (consecutiveReadOnlyIterations >= INVESTIGATION_STALL_THRESHOLD) {
			consecutiveReadOnlyIterations = 0
			const stallMsg = `⚠️ You have been investigating for ${INVESTIGATION_STALL_THRESHOLD}+ iterations without making any changes. Stop analyzing and ACT NOW:\n` +
				`- If you know what to fix, use write_file/run_command to fix it immediately.\n` +
				`- If you are truly blocked, call fail_task("QUESTION: <specific blocker>") so a supervisor can help.\n` +
				`Do NOT read more files or run more queries — implement the fix or fail the task.`
			messages.push({ role: "user", content: stallMsg })
			io.emit("agent-message", {
				agentId: workerId,
				agentName: workerName,
				projectId: project.id,
				message: stallMsg,
				timestamp: Date.now(),
				isStreaming: false,
			})
			log.warn(`[Worker ${workerName}] Investigation stall detected — injecting redirect`)
		}

		// Emit progress
		io.emit("worker-progress", {
			projectId: project.id,
			workerId,
			workerName,
			iteration: iteration + 1,
			timestamp: Date.now(),
		})
		
		let response: Anthropic.Message
		
		try {
		log.info(`[Worker ${workerName}] Making API call (useOpenRouter: ${useOpenRouter}, hasAnthropic: ${!!anthropic})`)
		io.emit("worker-api-call", {
			projectId: project.id,
			workerId,
			workerName,
			iteration: iteration + 1,
			useOpenRouter,
			model,
			timestamp: Date.now(),
		})
		
		if (useOpenRouter && openRouterClient) {
			// OpenRouter path
			const orMessages = messages.map(m => ({
				role: m.role as "user" | "assistant",
				content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
			}))
			
			const orTools = EPHEMERAL_TOOLS.map(tool => ({
				type: "function" as const,
				function: {
					name: tool.name,
					description: tool.description,
					parameters: tool.input_schema,
				},
			}))
			
			const completion = await openRouterClient.chat.completions.create({
				model,
				messages: [{ role: "system", content: systemPrompt }, ...orMessages],
				tools: orTools,
				max_tokens: 8192,
			})
			
			log.info(`[Worker ${workerName}] OpenRouter API response received`)
			// Society Agent - Track worker usage
			if (completion.usage) {
				usageTracker.record({
					projectId: project.id,
					agentId: workerId,
					agentName: workerName,
					model,
					inputTokens: completion.usage.prompt_tokens || 0,
					outputTokens: completion.usage.completion_tokens || 0,
				})
			}
			
			const choice = completion.choices[0]
			const textContent = choice.message.content || ""
			const toolCalls = choice.message.tool_calls || []
			
			log.info(`[Worker ${workerName}] Response: ${toolCalls.length} tool calls, text: ${textContent?.substring(0, 100)}...`)
			
			if (textContent) {
				fullResponse += textContent
				io.emit("agent-message", {
					agentId: workerId,
					agentName: workerName,
					projectId: project.id,
					message: textContent,
					timestamp: Date.now(),
					isStreaming: false,
				})
			}
			
			if (toolCalls.length === 0) {
				// Society Agent - Auto-continue if agent only read files without making changes
				if (!hasWrittenFiles && iteration > 0) {
					consecutiveReadOnlyStops++
					if (consecutiveReadOnlyStops <= 2) {
						log.info(`[Worker ${workerName}] Stopped after reading files without making changes, auto-continuing (attempt ${consecutiveReadOnlyStops})`)
						io.emit("agent-message", {
							agentId: workerId,
							agentName: workerName,
							projectId: project.id,
							message: "\n*[You analyzed the files but didn't implement changes. Continuing to implement the fix...]*\n",
							timestamp: Date.now(),
							isStreaming: false,
						})
						messages.push({ role: "assistant", content: textContent })
						messages.push({ role: "user", content: "You've analyzed the problem but stopped without implementing a fix. Please continue and make the necessary code changes using write_file to fix the issue you identified. Don't just analyze - implement the solution." })
						continue
					}
				}
				messages.push({ role: "assistant", content: textContent })
				loopExitReason = "model_stopped"
				break
			}
			
			// Process tool calls
			messages.push({ role: "assistant", content: textContent || "Using tools..." })
			const toolResults: any[] = []
			
			for (const tc of toolCalls) {
				const tcAny = tc as any
				const toolName = tcAny.function?.name || tcAny.name
				const toolInput = safeParseToolArgs(tcAny.function?.arguments || tcAny.arguments)

				// Society Agent - duplicate call detection
				const tKeyOR = toolCallKey(toolName, toolInput)
				recentToolCallKeys.push(tKeyOR)
				if (recentToolCallKeys.length > MAX_RECENT_TOOL_KEYS) recentToolCallKeys.shift()
				const dupCountOR = countDuplicateKey(tKeyOR)
				if (dupCountOR >= 3) {
					io.emit("agent-message", {
						agentId: workerId,
						agentName: workerName,
						projectId: project.id,
						message: `⚠️ You have called \`${toolName}\` with the same arguments ${dupCountOR} times already. You already have this information. Stop re-reading and act: write the fix or call fail_task with a specific question.`,
						timestamp: Date.now(),
						isStreaming: false,
					})
					log.warn(`[Worker ${workerName}] Duplicate tool call detected: ${tKeyOR} (${dupCountOR}x)`)
				}

				// Activity logging: log tool call
				agentActivityLogger.logToolCall(project.id, workerId, project.folder, workerHomeFolder, toolName, toolInput, iteration, totalToolCalls)
				const toolStartTime = Date.now()
				
				// Emit tool execution start
				io.emit("tool-execution", {
					agentId: workerId,
					agentName: workerName,
					projectId: project.id,
					toolName,
					toolInput,
					status: "started",
					timestamp: Date.now(),
				})
				
				const { result, filesCreated } = await executeAgentTool(
					toolName,
					toolInput,
					workerConfig,
					project,
					io,
					apiKey,
				)
				
				// Activity logging: log tool result
				agentActivityLogger.logToolResult(project.id, workerId, project.folder, workerHomeFolder, toolName, result, !result.startsWith("❌"), iteration, totalToolCalls, toolStartTime)
				// Record error to ERRORS.md for learning
				if (result.startsWith("❌")) {
					agentActivityLogger.recordToolError(project.folder, workerHomeFolder, toolName, toolInput, result)
				}
				totalToolCalls++
				
				// Track if agent is making changes (not just reading)
				if (filesCreated > 0 || !READ_ONLY_TOOLS.has(toolName)) {
					hasWrittenFiles = true
					consecutiveReadOnlyStops = 0
				}
				
				// Emit tool execution complete
				const { preview, lineCount } = extractCleanPreview(result)
				io.emit("tool-execution", {
					agentId: workerId,
					agentName: workerName,
					projectId: project.id,
					toolName,
					toolInput,
					result,
					preview,
					lineCount,
					status: result.startsWith("❌") ? "error" : "completed",
					timestamp: Date.now(),
				})
				
				toolResults.push({ type: "tool_result", tool_use_id: tc.id, content: result })
				
				// Check if task is completed
				if (toolName === "complete_task" || toolName === "fail_task") {
					taskCompleted = true
				}
			}

			// Society Agent — track investigation stall per iteration (OpenRouter path)
			const iterationWasReadOnlyOR = toolCalls.every((tc: any) => READ_ONLY_TOOLS.has(tc.function?.name || tc.name))
			if (iterationWasReadOnlyOR) {
				consecutiveReadOnlyIterations++
			} else {
				consecutiveReadOnlyIterations = 0
			}

			messages.push({ role: "user", content: toolResults.map(r => r.content).join("\n\n") })
			
		} else if (anthropic) {
			// Anthropic path
			log.info(`[Worker ${workerName}] Starting Anthropic stream...`)
			const stream = await anthropic.messages.stream({
				model,
				max_tokens: 8192,
				system: systemPrompt,
				messages,
				tools: EPHEMERAL_TOOLS,
			})
			
			response = await stream.finalMessage()
			log.info(`[Worker ${workerName}] Anthropic response received, stop_reason: ${response.stop_reason}`)
			// Society Agent - Track worker usage
			if (response.usage) {
				usageTracker.record({
					projectId: project.id,
					agentId: workerId,
					agentName: workerName,
					model,
					inputTokens: response.usage.input_tokens,
					outputTokens: response.usage.output_tokens,
				})
			}
			
			// Extract text and emit
			let textContent = ""
			const toolBlocks: Anthropic.ToolUseBlock[] = []
			
			for (const block of response.content) {
				if (block.type === "text") {
					textContent += block.text
					fullResponse += block.text
					io.emit("agent-message", {
						agentId: workerId,
						agentName: workerName,
						projectId: project.id,
						message: block.text,
						timestamp: Date.now(),
						isStreaming: false,
					})
				} else if (block.type === "tool_use") {
					toolBlocks.push(block)
				}
			}
			
			if (response.stop_reason === "end_turn" && toolBlocks.length === 0) {
				// Society Agent - Auto-continue if agent only read files without making changes
				if (!hasWrittenFiles && iteration > 0) {
					consecutiveReadOnlyStops++
					if (consecutiveReadOnlyStops <= 2) {
						log.info(`[Worker ${workerName}] Stopped after reading files without making changes, auto-continuing (attempt ${consecutiveReadOnlyStops})`)
						io.emit("agent-message", {
							agentId: workerId,
							agentName: workerName,
							projectId: project.id,
							message: "\n*[You analyzed the files but didn't implement changes. Continuing to implement the fix...]*\n",
							timestamp: Date.now(),
							isStreaming: false,
						})
						messages.push({ role: "assistant", content: response.content })
						messages.push({ role: "user", content: "You've analyzed the problem but stopped without implementing a fix. Please continue and make the necessary code changes using write_file to fix the issue you identified. Don't just analyze - implement the solution." })
						continue
					}
				}
				messages.push({ role: "assistant", content: response.content })
				break
			}
			
			if (toolBlocks.length === 0) {
				loopExitReason = "model_stopped"
				break
			}
			
			// Process tool calls
			messages.push({ role: "assistant", content: response.content })
			const toolResults: Anthropic.ToolResultBlockParam[] = []
			
			for (const toolBlock of toolBlocks) {
				const toolName = toolBlock.name
				const toolInput = toolBlock.input as Record<string, any>

				// Society Agent - duplicate call detection
				const tKey = toolCallKey(toolName, toolInput)
				recentToolCallKeys.push(tKey)
				if (recentToolCallKeys.length > MAX_RECENT_TOOL_KEYS) recentToolCallKeys.shift()
				const dupCount = countDuplicateKey(tKey)
				if (dupCount >= 3) {
					// Inject a one-time redirect into the tool result to break the loop
					const dupMsg = `⚠️ You have called \`${toolName}\` with the same arguments ${dupCount} times already. You already have this information. Stop re-reading and act: write the fix or call fail_task with a specific question.`
					io.emit("agent-message", {
						agentId: workerId,
						agentName: workerName,
						projectId: project.id,
						message: dupMsg,
						timestamp: Date.now(),
						isStreaming: false,
					})
					log.warn(`[Worker ${workerName}] Duplicate tool call detected: ${tKey} (${dupCount}x)`)
				}

				// Activity logging: log tool call
				agentActivityLogger.logToolCall(project.id, workerId, project.folder, workerHomeFolder, toolName, toolInput, iteration, totalToolCalls)
				const toolStartTime = Date.now()
				
				// Emit tool execution start
				io.emit("tool-execution", {
					agentId: workerId,
					agentName: workerName,
					projectId: project.id,
					toolName,
					toolInput,
					status: "started",
					timestamp: Date.now(),
				})
				
				const { result, filesCreated } = await executeAgentTool(
					toolName,
					toolInput,
					workerConfig,
					project,
					io,
					apiKey,
				)
				
				// Activity logging: log tool result
				agentActivityLogger.logToolResult(project.id, workerId, project.folder, workerHomeFolder, toolName, result, !result.startsWith("❌"), iteration, totalToolCalls, toolStartTime)
				// Record error to ERRORS.md for learning
				if (result.startsWith("❌")) {
					agentActivityLogger.recordToolError(project.folder, workerHomeFolder, toolName, toolInput, result)
				}
				totalToolCalls++
				
				// Track if agent is making changes (not just reading)
				if (filesCreated > 0 || !READ_ONLY_TOOLS.has(toolName)) {
					hasWrittenFiles = true
					consecutiveReadOnlyStops = 0 // Reset counter when agent makes changes
				}
				
				// Emit tool execution complete
				const { preview, lineCount } = extractCleanPreview(result)
				io.emit("tool-execution", {
					agentId: workerId,
					agentName: workerName,
					projectId: project.id,
					toolName,
					toolInput,
					result,
					preview,
					lineCount,
					status: result.startsWith("❌") ? "error" : "completed",
					timestamp: Date.now(),
				})
				
				toolResults.push({
					type: "tool_result",
					tool_use_id: toolBlock.id,
					content: result,
				})
				
				// Check if task is completed
				if (toolName === "complete_task" || toolName === "fail_task") {
					taskCompleted = true
				}
			}

			// Society Agent — track investigation stall per iteration
			const iterationWasReadOnly = toolBlocks.every(tb => READ_ONLY_TOOLS.has(tb.name))
			if (iterationWasReadOnly) {
				consecutiveReadOnlyIterations++
			} else {
				consecutiveReadOnlyIterations = 0
			}

			messages.push({ role: "user", content: toolResults })
		}
		} catch (iterErr: any) {
			log.error(`[Worker ${workerName}] Error in iteration ${iteration + 1}:`, iterErr)
			io.emit("worker-error", {
				projectId: project.id,
				workerId,
				errorMessage: iterErr.message,
				iteration: iteration + 1,
				timestamp: Date.now(),
			})
			// Show error in chat so user can see it
			io.emit("agent-message", {
				agentId: workerId,
				agentName: workerName,
				projectId: project.id,
				message: `❌ **Worker Error (iteration ${iteration + 1})**\n\n${iterErr.message}`,
				timestamp: Date.now(),
				isStreaming: false,
			})
			// Continue to next iteration or break if too many errors
			if (iteration > 2) {
				log.error(`[Worker ${workerName}] Too many errors, giving up`)
				loopExitReason = "too_many_errors"
				io.emit("agent-message", {
					agentId: workerId,
					agentName: workerName,
					projectId: project.id,
					message: `❌ **Worker giving up after too many errors**`,
					timestamp: Date.now(),
					isStreaming: false,
				})
				break
			}
		}
	}
	
	// Activity logging: log loop exit
	const exitReason = taskCompleted ? "end_turn" : loopExitReason
	agentActivityLogger.logLoopExit(project.id, workerId, project.folder, workerHomeFolder, exitReason, actualIterations, totalToolCalls, workerStartTime, taskCompleted ? "Task completed" : "Worker loop ended")
	
	// Society Agent - Warn if worker hit max iterations without completing
	if (!taskCompleted) {
		const reasonLabel =
			loopExitReason === "stopped_by_user"
				? "stopped by user"
				: loopExitReason === "model_stopped"
				? "model stopped before complete_task/fail_task"
				: loopExitReason === "too_many_errors"
				? "too many internal errors"
				: `hit max iterations (${MAX_ITERATIONS})`
		log.warn(`[Worker ${workerName}] Exited without completion: ${reasonLabel}`)
		const orphanedTask = projectStore
			.getTasks(project.id)
			.find((t) => t.claimedBy === workerId && ["claimed", "in-progress"].includes(t.status))
		if (orphanedTask) {
			// Save worker's conversation output as progress notes for the retry worker
			if (fullResponse && fullResponse.trim().length > 50) {
				const MAX_NOTES = 3500
				const trimmedResponse = fullResponse.length > MAX_NOTES
					? "...(earlier output trimmed)...\n\n" + fullResponse.slice(fullResponse.length - MAX_NOTES)
					: fullResponse
				projectStore.appendTaskProgressNotes(project.id, orphanedTask.id,
					`## Progress from ${workerName} (stopped: ${loopExitReason})\n\n${trimmedResponse}`)
			}

			const failReason =
				loopExitReason === "stopped_by_user"
					? `Worker stopped by user before completion. Task auto-returned to pool.`
					: loopExitReason === "model_stopped"
					? `Worker stopped before calling complete_task/fail_task. Task auto-returned to pool.`
					: loopExitReason === "too_many_errors"
					? `Worker aborted after repeated internal errors. Task auto-returned to pool.`
					: `Worker hit max iterations without completion. Task auto-returned to pool.`
			projectStore.failTask(project.id, orphanedTask.id, failReason)
			const failedTask = projectStore.getTask(project.id, orphanedTask.id)
			io.emit("task-failed", {
				projectId: project.id,
				taskId: orphanedTask.id,
				agentId: workerId,
				taskTitle: orphanedTask.title,
				reason: failReason,
				timestamp: Date.now(),
			})

			// Auto-recovery: spawn replacement worker while retries remain.
			const supervisorId = workerConfig.reportsTo
			const canAutoRetry = loopExitReason !== "stopped_by_user" && !!supervisorId
			if (canAutoRetry && failedTask) {
				const retryCount = failedTask.retryCount || 0
				const maxRetries = failedTask.maxRetries ?? 2
				const retryKey = autoRetryKey(project.id, failedTask.id)
				const previous = autoRetryTracker.get(retryKey)
				const now = Date.now()
				const sameReason = previous?.lastReason === loopExitReason
				const consecutiveSameReason = sameReason ? (previous?.consecutiveSameReason || 0) + 1 : 1
				autoRetryTracker.set(retryKey, {
					active: previous?.active || false,
					lastRetryAt: previous?.lastRetryAt || 0,
					consecutiveSameReason,
					lastReason: loopExitReason,
				})

				const hasRetryCapacity = retryCount <= maxRetries
				const retryActive = previous?.active === true
				const cooldownRemainingMs = previous?.lastRetryAt ? AUTO_RETRY_COOLDOWN_MS - (now - previous.lastRetryAt) : 0
				const inCooldown = cooldownRemainingMs > 0
				const repeatedStopPattern = consecutiveSameReason >= 3

				if (!hasRetryCapacity) {
					autoRetryTracker.delete(retryKey)
					io.emit("agent-message", {
						agentId: supervisorId!,
						agentName: "System",
						projectId: project.id,
						message: `⚠️ Task \`${failedTask.id}\` exhausted auto-retries (${retryCount}/${maxRetries}). Consider splitting it into smaller tasks before retrying again.`,
						timestamp: Date.now(),
						isStreaming: false,
					})
				} else if (hasRetryCapacity && !retryActive && !inCooldown && !repeatedStopPattern) {
					const supervisor = projectStore.getAgent(project.id, supervisorId!)
					const activeWorkers = projectStore.getActiveWorkerCount(project.id)
					const maxWorkers = (project as any).maxConcurrentWorkers || 5
					if (supervisor && activeWorkers < maxWorkers) {
						autoRetryTracker.set(retryKey, {
							active: true,
							lastRetryAt: now,
							consecutiveSameReason,
							lastReason: loopExitReason,
						})
						const retryWorkerId = `worker-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
						project.workerSequence = (project.workerSequence || 0) + 1
						projectStore.save()
						const retryWorkerName = `Worker #${project.workerSequence}`

						let retryPrompt = `You are an ephemeral worker agent continuing work that a previous worker started but did not finish.

## Your job
1. Call \`claim_task()\` to claim the task (task ID: \`${failedTask.id}\` — "${failedTask.title}")
2. **Read the progress notes below carefully** — do NOT repeat work already done
3. Pick up from where the previous worker left off and complete the task
4. You MUST call \`complete_task(...)\` or \`fail_task(reason)\` before stopping
5. If you are blocked on something specific, call \`fail_task("QUESTION: <exact question>")\` — don't just stop

## CRITICAL: Do not re-investigate what is already known. Proceed to act.`

						if (failedTask.progressNotes) {
							retryPrompt += `\n\n## What the previous worker did/discovered\n${failedTask.progressNotes}`
						}

						if (supervisor.customInstructions) {
							retryPrompt += `\n\n## Inherited Instructions from Supervisor\n${supervisor.customInstructions}`
						}

						const retryWorkerConfig: ProjectAgentConfig = {
							id: retryWorkerId,
							name: retryWorkerName,
							role: "Ephemeral worker - auto-retry",
							homeFolder: supervisor.homeFolder || "/",
							systemPrompt: buildFullSystemPrompt(retryPrompt),
							ephemeral: true,
							isWorker: true,
							reportsTo: supervisor.id,
						}

						projectStore.addAgent(project.id, retryWorkerConfig)
						io.emit("worker-spawned", {
							projectId: project.id,
							workerId: retryWorkerId,
							workerName: retryWorkerName,
							spawnedBy: supervisor.id,
							timestamp: Date.now(),
						})
						io.emit("agent-message", {
							agentId: supervisor.id,
							agentName: supervisor.name,
							projectId: project.id,
							message: `🔁 Auto-retry ${retryCount}/${maxRetries}: spawned ${retryWorkerName} for task \`${failedTask.id}\``,
							timestamp: Date.now(),
							isStreaming: false,
						})

						;(async () => {
							try {
								await runEphemeralWorker(retryWorkerConfig, project, apiKey, io)
							} catch (err: any) {
								log.error(`[Worker ${retryWorkerId}] Auto-retry worker error:`, err)
							} finally {
								const latest = autoRetryTracker.get(retryKey)
								if (latest) {
									autoRetryTracker.set(retryKey, {
										...latest,
										active: false,
									})
								}
							}
						})()
					}
				} else {
					const supervisor = projectStore.getAgent(project.id, supervisorId!)
					if (supervisor) {
						if (retryActive) {
							io.emit("agent-message", {
								agentId: supervisor.id,
								agentName: supervisor.name,
								projectId: project.id,
								message: `⏳ Auto-retry skipped for task \`${failedTask.id}\`: a retry worker is already active.`,
								timestamp: Date.now(),
								isStreaming: false,
							})
						} else if (inCooldown) {
							io.emit("agent-message", {
								agentId: supervisor.id,
								agentName: supervisor.name,
								projectId: project.id,
								message: `⏳ Auto-retry cooling down for task \`${failedTask.id}\` (${Math.ceil(cooldownRemainingMs / 1000)}s remaining).`,
								timestamp: Date.now(),
								isStreaming: false,
							})
						} else if (repeatedStopPattern) {
							io.emit("agent-message", {
								agentId: supervisor.id,
								agentName: supervisor.name,
								projectId: project.id,
								message: `⚠️ Auto-retry paused for task \`${failedTask.id}\`: same stop reason repeated ${consecutiveSameReason} times (${loopExitReason}). Consider splitting the task.`,
								timestamp: Date.now(),
								isStreaming: false,
							})
						}
					}
				}
			}
			log.warn(`[Worker ${workerName}] Auto-failed orphaned task ${orphanedTask.id}`)
		}
		io.emit("agent-added", {
			type: "system",
			agentId: workerId,
			projectId: project.id,
			message:
				loopExitReason === "stopped_by_user"
					? `⚠️ Worker ${workerName} was stopped by user. Task was returned to the pool.`
					: loopExitReason === "model_stopped"
					? `⚠️ Worker ${workerName} stopped before finalizing the task. Task was returned to the pool.`
					: loopExitReason === "too_many_errors"
					? `⚠️ Worker ${workerName} aborted after repeated errors. Task was returned to the pool.`
					: `⚠️ Worker ${workerName} hit max iterations (${MAX_ITERATIONS}). Task was returned to the pool.`,
			timestamp: Date.now(),
		})
	}

	if (workerConfig.ephemeral && !taskCompleted) {
		projectStore.removeAgent(project.id, workerId)
		io.emit("agent-deleted", {
			projectId: project.id,
			agentId: workerId,
			reason: "worker exited without completion",
			timestamp: Date.now(),
		})
		log.info(`[Worker ${workerName}] Removed after abnormal exit`)
	}
	
	// Emit worker finished
	io.emit("worker-finished", {
		projectId: project.id,
		workerId,
		workerName,
		completed: taskCompleted,
		timestamp: Date.now(),
	})
	
	log.info(`[Worker ${workerName}] Finished (completed: ${taskCompleted})`)
}

/**
 * Helper: create a ConversationAgent from a ProjectAgentConfig + project context
 */
function getOrCreateProjectAgent(
	agentConfig: ProjectAgentConfig,
	project: Project,
	apiKey: string,
): ConversationAgent {
	// Bug fix: key must be project-scoped — two projects can have the same agent id (e.g. "supervisor")
	const cacheKey = `${project.id}:${agentConfig.id}`
	const existing = activeAgents.get(cacheKey)
	if (existing) return existing

	// Society Agent start - Defensive checks
	if (!project || !project.id) {
		log.error(`[getOrCreateProjectAgent] Invalid project: ${JSON.stringify(project)}`)
		throw new Error(`Invalid project object - missing id`)
	}
	if (!agentConfig || !agentConfig.id) {
		log.error(`[getOrCreateProjectAgent] Invalid agentConfig: ${JSON.stringify(agentConfig)}`)
		throw new Error(`Invalid agentConfig - missing id`)
	}
	// Society Agent end

	// Society Agent start - use provider config instead of hardcoded Anthropic
	const apiHandler = getApiHandlerFromConfig()
	const contextConfig = getProviderContextConfig()
	// Society Agent end

	// Resolve project workspace path
	const projectDir = projectStore.agentHomeDir(project.id, agentConfig.id)
	const projectRoot = projectStore.projectDir(project.id)

	// Build system prompt with project + agent context + file creation instructions
	// Society Agent start - Use project-aware prompt when config is cached
	let fullPrompt: string
	const cachedConfig = projectConfigCache.get(projectRoot)
	if (cachedConfig) {
		const projectSection = generateProjectPromptSection(cachedConfig.config)
		fullPrompt = buildFullSystemPrompt(agentConfig.systemPrompt || `You are ${agentConfig.name}, part of project ${project.name}.`)
		fullPrompt += "\n\n" + projectSection
	} else {
		fullPrompt = buildFullSystemPrompt(agentConfig.systemPrompt || `You are ${agentConfig.name}, part of project ${project.name}.`)
		// Async load config for next time (fire and forget)
		getProjectConfigCached(projectRoot).catch(() => {})
	}
	// Society Agent end
	// Society Agent start - Tell the agent where its project folder is so it creates files there
	const homeFolderName = (agentConfig.homeFolder || agentConfig.id).replace(/^\/+|\/+$/g, "").split("/").pop() || agentConfig.id
	fullPrompt += `\n\n## File Creation Instructions
You are working in project "${project.name}". Your project folder is: ${projectDir}

**IMPORTANT: You are ALREADY inside your folder "${homeFolderName}/"**
- All file paths in write_file/create_file are RELATIVE to YOUR folder
- Do NOT include your folder name in paths — it will create nested duplicates!
✅ CORRECT: write_file("src/index.ts", content)
❌ WRONG:   write_file("${homeFolderName}/src/index.ts", content)  ← Creates ${homeFolderName}/${homeFolderName}/src/index.ts!

When asked to create files, code, or any project artifacts, ALWAYS include the files in your response using this JSON format:
\`\`\`json
{
  "files": [
    {"name": "relative/path/filename.ext", "content": "full file content here"}
  ]
}
\`\`\`
This ensures files are automatically saved in your project folder. Do NOT just describe the files — include the actual content so they can be created.`
	// Society Agent end

	// Society Agent start - All agents get mind tools for persistent memory
	fullPrompt += `\n\n## Memory Tools
- \`read_file(path)\` / \`write_file(path, content)\` / \`list_files(path)\` — your persistent memory in your folder
- \`read_project_file(path)\` — read any file in the project (read-only)
- Start sessions by reading AGENTS.md + your own notes; save key decisions/learnings after work
- Knowledge storage: quick tips → KNOWLEDGE.md | procedures → skills/name/SKILL.md | state → AGENTS.md
- Skills: project skills in \`skills/\` (you can create) · global skills in /skills/ (read-only, use \`read_global_skill\`)
- MCPs (external integrations): \`list_mcps()\` → \`list_mcp_tools(name)\` → \`use_mcp(name, tool, params)\`
- Wrap complex reasoning in \`<thinking>...</thinking>\` — shown as collapsible block in UI`
	// Society Agent end

	// Society Agent start - All agents get tool-use awareness
	const siblingAgents = project.agents.filter(a => a.id !== agentConfig.id)
	const directReports = project.agents.filter(a => a.reportsTo === agentConfig.id)
	const isSupervisor = directReports.length > 0
	fullPrompt += `\n\n## Team & Task Tools
**Ephemeral workers (one-off tasks):** \`create_task()\` → \`spawn_worker(count)\` → \`list_tasks()\` → \`get_worker_status()\`
**Persistent agents:** \`list_team\` · \`delegate_task\` · \`delegate_tasks_parallel\` · \`propose_new_agent\`
**Agent configuration:** \`get_agent_info(id)\` · \`set_agent_instructions(id, instructions, mode)\`
**Other agents (${siblingAgents.length}):** ${siblingAgents.length > 0 ? siblingAgents.map(a => `${a.id} (${a.name})`).join(" · ") : "none yet"}
- Ephemeral: best for one-off tasks · Persistent: best for ongoing roles with memory`

	fullPrompt += `\n\n## Idle Status-Check Protocol (Hard Rule)
If the user asks to check whether you have pending work (examples: "any work?", "check tasks", "am I idle?"):

1. Call \`read_inbox\`
2. Call \`list_tasks\`
3. Optionally read local \`PLAN.md\` only for brief status summary
4. If no pending assigned work exists, report "idle and waiting for new tasks" and STOP

When no pending work exists, you MUST NOT:
- run ad-hoc verification commands (TypeScript/test/http endpoint sweeps)
- run process or git diagnostics unless explicitly requested
- create tasks for verification-only work
- spawn workers for status checks
- continue with implementation verification after reporting idle

Only perform verification in idle mode when the user explicitly requests verification/health checks.`

	fullPrompt += `\n\n## Report Mode and Duplicate Prompt Handling
When the user asks for a report/status summary:

1. Perform one evidence-gathering pass
2. Deliver one consolidated report
3. Stop and wait for the next instruction

In report mode, do NOT:
- spawn workers
- create task-pool tasks
- restart broad rediscovery after reporting

If the same or near-identical prompt appears again in the same session:
- do not repeat full analysis
- reference prior report context
- ask whether to refresh data or proceed to implementation

If user says "complete/fix all you found":
- switch to execution mode
- convert findings into a prioritized fix list
- re-read only files needed for selected fixes (no full rediscovery sweep).`

	if (isSupervisor) {
		const reportNames = directReports.map(a => `${a.id} (${a.name}, folder: ${projectStore.agentHomeDir(project.id, a.id)})`).join("\n  - ")
		fullPrompt += `\n\n## 🔴 SUPERVISOR RULES (you have direct reports)

Your direct reports:
  - ${reportNames}

**You are a coordinator. You plan, split, delegate — you do not implement what belongs to a subagent.**

### How to delegate work (follow this every time)

1. **Write your own PLAN.md first** — list the high-level deliverables you are responsible for:
   \`\`\`
   - [ ] Auth system (→ ${directReports[0]?.id ?? 'subagent'})
   - [ ] Dashboard UI (→ ${directReports[1]?.id ?? directReports[0]?.id ?? 'subagent'})
   \`\`\`

2. **Delegate via message** — send each subagent their portion using \`delegate_task\`.
   The message MUST contain a ready-to-paste task checklist, e.g.:
   \`\`\`
   Your tasks for this sprint:
   - [ ] POST /api/login — returns signed JWT
   - [ ] Auth middleware — validates JWT on protected routes
   - [ ] Password reset flow

   Definition of done per task: compile passes + git commit + PLAN.md checked off with commit hash.
   Report back with: task name + commit hash for each.
   \`\`\`

3. **The subagent writes the checklist into its own PLAN.md** and executes.
   You cannot write their PLAN.md — you can only send the list via message.

4. **Collect results** — when a subagent reports back, extract the commit hashes
   and mark YOUR own PLAN.md:
   \`[x] Auth system (commits: abc1234, def5678)\`

5. **Verify before marking done** — run \`git log --oneline -5\` to confirm commits exist.

### Hard rules — never break these
- ❌ NEVER write, edit, or delete any file inside a subagent's folder
- ❌ NEVER run commands intended for a subagent — send them the task instead
- ❌ NEVER mark your PLAN.md \`[x]\` without a commit hash from the subagent
- ✅ Read subagent progress (read-only): \`read_project_file("<subagent-folder>/PLAN.md")\`
- ✅ Your own files: AGENTS.md, PLAN.md, FILES.md, ERRORS.md — in YOUR folder only

### When user describes the project
Extract and act on these from conversation:
1. **Goals** — what are we building? Save to your PLAN.md
2. **Architecture** — tech stack, ports, patterns? Create agents for each domain
3. **Boundaries** — who owns what? Use \`set_agent_instructions\` for each subordinate
4. **Coordination** — shared resources? Define protocols in instructions
5. **Confirm** — tell user what you set up, offer to adjust

### Configuring subordinates
Use \`get_agent_info(id)\` to view a subordinate's current instructions.
Use \`set_agent_instructions(id, instructions, mode)\` to set ownership boundaries, coordination rules, and constraints:
- **mode: "replace"** (default) — overwrites existing instructions
- **mode: "append"** — adds to existing instructions (use as project evolves)

Example: \`set_agent_instructions("backend", "You OWN: backend/, shared/types/. Coordinate API changes with frontend.", "replace")\``
	}

	if (project.knowledge) {
		fullPrompt += `\n\n## Project Knowledge (${project.name})\n${project.knowledge}`
	}
	if (agentConfig.memorySummary) {
		fullPrompt += `\n\n## Your Memory (from past conversations)\n${agentConfig.memorySummary}`
	}

	const agent = new ConversationAgent({
		identity: {
			id: agentConfig.id,
			createdAt: Date.now(),
		},
		apiHandler,
		// Society Agent - provider-specific context limits
		contextWindowSize: contextConfig.contextWindowSize,
		contextThresholdPercent: contextConfig.contextThresholdPercent,
		systemPrompt: fullPrompt,
		workspacePath: projectDir, // Society Agent - files go to project folder
		onMessage: (message) => {
			io.emit("agent-message", {
				agentId: agentConfig.id,
				message: message.content,
				timestamp: message.timestamp,
				isStreaming: false,
			})
		},
		onFileCreated: (relativePath, fullPath, size) => {
			log.info(`[${agentConfig.name}@${project.name}] File created: ${fullPath} (${size} bytes)`)
			io.emit("file-created", {
				agentId: agentConfig.id,
				projectId: project.id,
				relativePath,
				fullPath,
				size,
				timestamp: Date.now(),
			})
		},
		// Society Agent start - summarization events
		onSummarizationStart: (meta) => {
			log.info(`${agentConfig.id}: Summarization started (${meta.messageCount} msgs, ~${meta.tokenCount} tokens, ${meta.contextPercent.toFixed(1)}%)`)
			io.emit("summarization-start", { 
				agentId: agentConfig.id, 
				projectId: project.id, 
				messageCount: meta.messageCount, 
				tokenCount: meta.tokenCount,
				contextPercent: meta.contextPercent,
				timestamp: Date.now() 
			})
		},
		onSummarizationEnd: (meta) => {
			log.info(`${agentConfig.id}: Summarization complete (${meta.messageCountBefore} → ${meta.messageCountAfter} msgs, ~${meta.tokensBefore} → ~${meta.tokensAfter} tokens, $${meta.cost.toFixed(4)})`)
			io.emit("summarization-end", { 
				agentId: agentConfig.id, 
				projectId: project.id, 
				summary: meta.summary, 
				messageCountBefore: meta.messageCountBefore,
				messageCountAfter: meta.messageCountAfter,
				tokensBefore: meta.tokensBefore,
				tokensAfter: meta.tokensAfter,
				cost: meta.cost,
				error: meta.error,
				timestamp: Date.now() 
			})
		},
		// Society Agent end
		// Society Agent start - persist chat history to disk so page refreshes and server restarts restore it
		persistHistory: true,
		historyDir: path.join(projectDir, ".history"),
		backupsEnabled: true,
		// Society Agent end
	})

	activeAgents.set(`${project.id}:${agentConfig.id}`, agent)
	log.info(`Activated project agent: ${agentConfig.name} in ${project.name} (workspace: ${projectDir})`)
	return agent
}

/**
 * POST /api/agent/:agentId/chat - Send a message to a specific agent
 * Looks up agent in project store first, falls back to legacy store.
 * Body: { description: string, attachments?: any[] }
 */
app.post("/api/agent/:agentId/chat", async (req, res): Promise<void> => {
	// Society Agent start - reject if system paused
	if (systemPaused) {
		res.status(503).json({ 
			error: "System is paused for maintenance",
			message: "The system is temporarily paused. Please wait for maintenance to complete.",
			systemPaused: true
		})
		return
	}
	// Society Agent end
	
	try {
		const { agentId } = req.params
		// Society Agent - Get API key from settings, header, or env
		const providerConfig = standaloneSettings.getProvider()
		const apiKey = (req.headers["x-api-key"] as string) || providerConfig.apiKey || process.env.ANTHROPIC_API_KEY
		if (!apiKey) {
			res.status(401).json({ error: "API key required. Configure in settings or provide x-api-key header." })
			return
		}

		const { description, attachments } = req.body
		const requestId = typeof req.body.requestId === "string" ? req.body.requestId.trim() : ""
		const projectId = req.body.projectId as string | undefined
		const autoMode = inferAutoMode(description)
		const effectiveDescription = applyAutoMode(description, autoMode)
		let requestCacheKey: string | undefined

		cleanupChatRequestCache()
		if (requestId) {
			requestCacheKey = makeChatRequestKey(agentId, projectId, requestId)
			const existing = chatRequestCache.get(requestCacheKey)
			if (existing?.status === "completed" && existing.response) {
				res.json({ ...existing.response, deduplicated: true, requestId })
				return
			}
			if (existing?.status === "in-progress") {
				res.status(202).json({
					status: "in-progress",
					requestId,
					message: "Duplicate request is already being processed",
				})
				return
			}
			chatRequestCache.set(requestCacheKey, { status: "in-progress", startedAt: Date.now() })
		}
		if (!description && (!attachments || attachments.length === 0)) {
			if (requestCacheKey) chatRequestCache.delete(requestCacheKey)
			res.status(400).json({ error: "Message description or attachments required" })
			return
		}

		// Try project store first
		const found = projectStore.findAgentProject(agentId, projectId)
		if (found) {
			const shouldUseSnapshot = autoMode === "report_only" || autoMode === "implement_from_report" || autoMode === "recall_only"
			const snapshot = shouldUseSnapshot ? loadReportSnapshot(found.project, found.agent.id) : undefined
			const snapshotLoaded = !!snapshot
			const promptDescription = snapshot ? withSnapshotContext(effectiveDescription, snapshot) : effectiveDescription

			// Ephemeral workers don't accept direct messages - they only work on tasks
			if (found.agent.ephemeral) {
				if (requestCacheKey) chatRequestCache.delete(requestCacheKey)
				res.status(403).json({ 
					error: "Ephemeral workers cannot receive direct messages",
					message: "This is an ephemeral worker agent that only processes tasks from the task pool. It will self-destruct when done."
				})
				return
			}
			
			projectStore.recordActivity(found.project.id, agentId)
			log.info(`[${found.agent.name}@${found.project.name}] chat${autoMode !== "none" ? ` [${autoMode}]` : ""}: ${typeof description === 'string' ? description.substring(0, 80) : 'attachment'}`)
			// Society Agent start - activity log: incoming user message
			agentActivityLogger.logChatIn(found.project.id, agentId, found.project.folder, found.agent.homeFolder || "/", description || "[attachment only]", "user", undefined, !!(attachments && attachments.length > 0))
			// Society Agent end

			// Society Agent start - All agents use tool-based agentic loop
			const result = await handleSupervisorChat(
				promptDescription,
				found.agent,
				found.project,
				apiKey,
				io,
				attachments,
			)
			const snapshotUpdated = autoMode === "report_only" ? saveReportSnapshot(found.project, found.agent.id, result.fullResponse) : false

			const agent = getOrCreateProjectAgent(found.agent, found.project, apiKey)
			const history = agent.getHistory()
			if (history.length > 0 && history.length % 10 === 0) {
				const lastMessages = history.slice(-6).map((m: any) =>
					`${m.role}: ${typeof m.content === 'string' ? m.content.substring(0, 200) : '[structured]'}`
				).join('\n')
				projectStore.updateAgentMemory(found.project.id, agentId, `Recent context (${history.length} messages):\n${lastMessages}`)
			}

			const payload = {
				type: "chat",
				agentId: found.agent.id,
				agentName: found.agent.name,
				projectId: found.project.id,
				projectName: found.project.name,
				autoMode: autoMode !== "none" ? autoMode : undefined,
				snapshotLoaded: snapshotLoaded || undefined,
				snapshotUpdated: snapshotUpdated || undefined,
				response: result.fullResponse,
				status: "completed",
				historyLength: history.length,
				filesCreated: result.totalFilesCreated,
				delegations: result.delegationResults.length > 0 ? result.delegationResults : undefined,
			}
			if (requestCacheKey) {
				chatRequestCache.set(requestCacheKey, {
					status: "completed",
					startedAt: Date.now(),
					response: payload,
				})
			}
			res.json(payload)
			return
			// Society Agent end
		}

		// Legacy fallback: persistent agent store
		const profile = agentStore.get(agentId)
		if (!profile) {
			if (requestCacheKey) chatRequestCache.delete(requestCacheKey)
			res.status(404).json({ error: `Agent "${agentId}" not found` })
			return
		}

		const agent = getOrCreateAgent(profile, apiKey)
		agentStore.recordActivity(agentId)

		log.info(`[${profile.name}] chat${autoMode !== "none" ? ` [${autoMode}]` : ""}: ${typeof description === 'string' ? description.substring(0, 80) : 'attachment'}`)

		const content = attachments && attachments.length > 0 ? attachments : effectiveDescription

		let fullResponse = ""
		for await (const chunk of agent.sendMessageStream(content)) {
			fullResponse += chunk
			io.emit("agent-message", {
				agentId: profile.id,
				agentName: profile.name,
				message: chunk,
				timestamp: Date.now(),
				isStreaming: true,
			})
		}

		io.emit("agent-message", {
			agentId: profile.id,
			agentName: profile.name,
			message: "",
			timestamp: Date.now(),
			isStreaming: false,
			isDone: true,
		})

		const history = agent.getHistory()
		if (history.length > 0 && history.length % 10 === 0) {
			const lastMessages = history.slice(-6).map((m: any) =>
				`${m.role}: ${typeof m.content === 'string' ? m.content.substring(0, 200) : '[structured]'}`
			).join('\n')
			agentStore.updateMemory(agentId, `Recent context (${history.length} messages):\n${lastMessages}`)
		}

		const payload = {
			type: "chat",
			agentId: profile.id,
			agentName: profile.name,
			autoMode: autoMode !== "none" ? autoMode : undefined,
			response: fullResponse,
			status: "completed",
			historyLength: history.length,
		}
		if (requestCacheKey) {
			chatRequestCache.set(requestCacheKey, {
				status: "completed",
				startedAt: Date.now(),
				response: payload,
			})
		}
		res.json(payload)
	} catch (error) {
		const requestId = typeof req.body?.requestId === "string" ? req.body.requestId.trim() : ""
		if (requestId) {
			const key = makeChatRequestKey(req.params.agentId, req.body?.projectId as string | undefined, requestId)
			chatRequestCache.delete(key)
		}
		log.error("Error in agent chat:", error)
		res.status(500).json({ error: String(error) })
	}
})

/**
 * GET /api/agent/:agentId/workspace/files - List files in agent's workspace folder
 */
app.get("/api/agent/:agentId/workspace/files", async (req, res): Promise<void> => {
	try {
		const projectId = req.query.projectId as string | undefined
		const agentDir = agentWorkspaceDir(req.params.agentId, projectId)
		const files: { path: string; size: number; modified: string; isDir: boolean }[] = []

		async function walkDir(dir: string, prefix: string = "") {
			try {
				const entries = await fs.promises.readdir(dir, { withFileTypes: true })
				for (const entry of entries) {
					if (entry.name.startsWith(".")) continue
					const fullPath = path.join(dir, entry.name)
					const relPath = prefix ? `${prefix}/${entry.name}` : entry.name
					if (entry.isDirectory()) {
						files.push({ path: relPath, size: 0, modified: "", isDir: true })
						await walkDir(fullPath, relPath)
					} else {
						const stat = await fs.promises.stat(fullPath)
						files.push({ path: relPath, size: stat.size, modified: stat.mtime.toISOString(), isDir: false })
					}
				}
			} catch { /* directory may not exist yet */ }
		}

		await fs.promises.mkdir(agentDir, { recursive: true })
		await walkDir(agentDir)

		res.json({
			agentId: req.params.agentId,
			workspaceDir: agentDir,
			files,
			totalFiles: files.filter(f => !f.isDir).length,
			totalDirs: files.filter(f => f.isDir).length,
		})
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * GET /api/agent/:agentId/workspace/file - Read a file from agent's workspace
 */
app.get("/api/agent/:agentId/workspace/file", async (req, res): Promise<void> => {
	try {
		const filePath = req.query.path as string
		const projectId = req.query.projectId as string | undefined
		if (!filePath) { res.status(400).json({ error: "path query parameter required" }); return }

		const agentDir = agentWorkspaceDir(req.params.agentId, projectId)
		const check = securePath(agentDir, filePath)
		if (!check.ok) { res.status(403).json({ error: check.error }); return }

		const content = await fs.promises.readFile(check.fullPath, "utf-8")
		const stat = await fs.promises.stat(check.fullPath)
		res.json({ path: filePath, content, size: stat.size, modified: stat.mtime.toISOString() })
	} catch (error: any) {
		if (error.code === "ENOENT") res.status(404).json({ error: "File not found" })
		else res.status(500).json({ error: String(error) })
	}
})

// Society Agent start - Raw file serving for agent workspace (PDFs, images, etc.)
/**
 * GET /api/agent/:agentId/workspace/file/raw - Serve raw file from agent's workspace
 * Used for PDF viewing, image display, and file downloads
 */
app.get("/api/agent/:agentId/workspace/file/raw", async (req, res): Promise<void> => {
	try {
		const filePath = req.query.path as string
		const projectId = req.query.projectId as string | undefined
		if (!filePath) { res.status(400).json({ error: "path query parameter required" }); return }

		const agentDir = agentWorkspaceDir(req.params.agentId, projectId)
		const check = securePath(agentDir, filePath)
		if (!check.ok) { res.status(403).json({ error: check.error }); return }

		// Check if file exists
		let stat
		try {
			stat = await fs.promises.stat(check.fullPath)
		} catch (e: any) {
			if (e.code === "ENOENT") {
				res.status(404).json({ error: "File not found" })
				return
			}
			throw e
		}

		if (!stat.isFile()) {
			res.status(400).json({ error: "Not a file" })
			return
		}

		// Determine MIME type based on extension
		const ext = path.extname(filePath).toLowerCase()
		const mimeTypes: Record<string, string> = {
			// Images
			".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
			".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".bmp": "image/bmp",
			// Documents
			".pdf": "application/pdf",
			// Text/Code
			".txt": "text/plain", ".md": "text/markdown", ".json": "application/json",
			".js": "text/javascript", ".ts": "text/typescript", ".html": "text/html",
			".css": "text/css", ".xml": "application/xml", ".yaml": "text/yaml", ".yml": "text/yaml",
			// Archives
			".zip": "application/zip", ".tar": "application/x-tar", ".gz": "application/gzip",
		}

		const contentType = mimeTypes[ext] || "application/octet-stream"
		const fileName = path.basename(filePath)

		// Set headers for proper viewing
		res.setHeader("Content-Type", contentType)
		res.setHeader("Content-Length", stat.size)
		res.setHeader("Access-Control-Allow-Origin", "*")

		// For PDF/images, allow inline viewing; for others, suggest download
		const inlineTypes = [".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".txt", ".md"]
		if (inlineTypes.includes(ext)) {
			res.setHeader("Content-Disposition", `inline; filename="${fileName}"`)
		} else {
			res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`)
		}

		// Stream the file
		const stream = fs.createReadStream(check.fullPath)
		stream.on("error", (err) => {
			log.error("Error streaming file:", err)
			if (!res.headersSent) {
				res.status(500).json({ error: "Error reading file" })
			}
		})
		stream.pipe(res)
	} catch (error: any) {
		log.error("Error serving raw file:", error)
		if (!res.headersSent) {
			res.status(500).json({ error: String(error) })
		}
	}
})
// Society Agent end

/**
 * POST /api/agent/:agentId/workspace/file - Create/upload a file in agent's workspace
 */
app.post("/api/agent/:agentId/workspace/file", async (req, res): Promise<void> => {
	try {
		const { path: filePath, content, encoding, projectId } = req.body
		if (!filePath || content === undefined) { res.status(400).json({ error: "'path' and 'content' required" }); return }

		const agentDir = agentWorkspaceDir(req.params.agentId, projectId || req.query.projectId as string)
		const check = securePath(agentDir, filePath)
		if (!check.ok) { res.status(403).json({ error: check.error }); return }

		await fs.promises.mkdir(path.dirname(check.fullPath), { recursive: true })
		if (encoding === "base64") {
			await fs.promises.writeFile(check.fullPath, Buffer.from(content, "base64"))
		} else {
			await fs.promises.writeFile(check.fullPath, content, "utf-8")
		}

		const stat = await fs.promises.stat(check.fullPath)
		io.emit("file-created", { agentId: req.params.agentId, relativePath: filePath, size: stat.size })
		res.json({ success: true, path: filePath, size: stat.size, modified: stat.mtime.toISOString() })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * DELETE /api/agent/:agentId/workspace/file - Delete a file/dir from agent's workspace
 */
app.delete("/api/agent/:agentId/workspace/file", async (req, res): Promise<void> => {
	try {
		const filePath = req.query.path as string
		const projectId = req.query.projectId as string | undefined
		if (!filePath) { res.status(400).json({ error: "path query parameter required" }); return }

		const agentDir = agentWorkspaceDir(req.params.agentId, projectId)
		const check = securePath(agentDir, filePath)
		if (!check.ok) { res.status(403).json({ error: check.error }); return }

		if (path.resolve(check.fullPath) === path.resolve(agentDir)) {
			res.status(403).json({ error: "Cannot delete agent root directory" }); return
		}

		const stat = await fs.promises.stat(check.fullPath)
		if (stat.isDirectory()) {
			await fs.promises.rm(check.fullPath, { recursive: true, force: true })
		} else {
			await fs.promises.unlink(check.fullPath)
		}
		io.emit("file-deleted", { agentId: req.params.agentId, relativePath: filePath })
		res.json({ success: true, path: filePath })
	} catch (error: any) {
		if (error.code === "ENOENT") res.status(404).json({ error: "File not found" })
		else res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/agent/:agentId/workspace/dir - Create a directory in agent's workspace
 */
app.post("/api/agent/:agentId/workspace/dir", async (req, res): Promise<void> => {
	try {
		const { path: dirPath, projectId } = req.body
		if (!dirPath) { res.status(400).json({ error: "'path' required" }); return }

		const agentDir = agentWorkspaceDir(req.params.agentId, projectId || req.query.projectId as string)
		const check = securePath(agentDir, dirPath)
		if (!check.ok) { res.status(403).json({ error: check.error }); return }

		await fs.promises.mkdir(check.fullPath, { recursive: true })
		res.json({ success: true, path: dirPath })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/agent/:agentId/workspace/move - Move/rename in agent's workspace
 */
app.post("/api/agent/:agentId/workspace/move", async (req, res): Promise<void> => {
	try {
		const { from, to, projectId } = req.body
		if (!from || !to) { res.status(400).json({ error: "'from' and 'to' required" }); return }

		const agentDir = agentWorkspaceDir(req.params.agentId, projectId || req.query.projectId as string)
		const checkFrom = securePath(agentDir, from)
		const checkTo = securePath(agentDir, to)
		if (!checkFrom.ok) { res.status(403).json({ error: checkFrom.error }); return }
		if (!checkTo.ok) { res.status(403).json({ error: checkTo.error }); return }

		if (!fs.existsSync(checkFrom.fullPath)) { res.status(404).json({ error: "Source not found" }); return }

		await fs.promises.mkdir(path.dirname(checkTo.fullPath), { recursive: true })
		await fs.promises.rename(checkFrom.fullPath, checkTo.fullPath)

		io.emit("file-moved", { agentId: req.params.agentId, from, to })
		res.json({ success: true, from, to })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * GET /api/agent/:agentId/workspace/sqlite - Query SQLite database file
 * Query params: path (required), table (optional), query (optional SQL), limit (optional, default 100)
 */
app.get("/api/agent/:agentId/workspace/sqlite", async (req, res): Promise<void> => {
	try {
		const filePath = req.query.path as string
		const projectId = req.query.projectId as string | undefined
		const tableName = req.query.table as string | undefined
		const customQuery = req.query.query as string | undefined
		const limit = parseInt(req.query.limit as string) || 100

		if (!filePath) { res.status(400).json({ error: "path query parameter required" }); return }

		const agentDir = agentWorkspaceDir(req.params.agentId, projectId)
		const check = securePath(agentDir, filePath)
		if (!check.ok) { res.status(403).json({ error: check.error }); return }

		if (!fs.existsSync(check.fullPath)) {
			res.status(404).json({ error: "Database file not found" }); return
		}

		// Dynamic import sqlite3
		const sqlite3 = await import("better-sqlite3")
		const db = sqlite3.default(check.fullPath, { readonly: true })

		try {
			// Get list of tables
			const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]
			const tableNames = tables.map(t => t.name)

			// If no table specified, return schema info
			if (!tableName && !customQuery) {
				const schema: Record<string, any[]> = {}
				for (const t of tableNames) {
					schema[t] = db.prepare(`PRAGMA table_info("${t}")`).all()
				}
				res.json({ tables: tableNames, schema })
				return
			}

			// If custom query provided (read-only SELECT queries only)
			if (customQuery) {
				const trimmed = customQuery.trim().toLowerCase()
				if (!trimmed.startsWith("select")) {
					res.status(400).json({ error: "Only SELECT queries are allowed" }); return
				}
				const rows = db.prepare(customQuery).all()
				const columns = rows.length > 0 ? Object.keys(rows[0] as object) : []
				res.json({ rows: rows.slice(0, limit), columns, total: rows.length })
				return
			}

			// Query specific table
			if (tableName && !tableNames.includes(tableName)) {
				res.status(404).json({ error: `Table '${tableName}' not found`, tables: tableNames }); return
			}

			const countResult = db.prepare(`SELECT COUNT(*) as count FROM "${tableName}"`).get() as { count: number }
			const rows = db.prepare(`SELECT * FROM "${tableName}" LIMIT ?`).all(limit)
			const columns = rows.length > 0 ? Object.keys(rows[0] as object) : []

			res.json({ table: tableName, rows, columns, total: countResult.count, limit })
		} finally {
			db.close()
		}
	} catch (error: any) {
		log.error("SQLite query error:", error)
		res.status(500).json({ error: error.message || String(error) })
	}
})

/**
 * POST /api/agent/:agentId/workspace/sqlite - Execute write query on SQLite database
 * Body: { path, query } or { path, table, rowid, column, value } for cell update
 */
app.post("/api/agent/:agentId/workspace/sqlite", async (req, res): Promise<void> => {
	try {
		const { path: filePath, query, table, rowid, column, value, projectId } = req.body

		if (!filePath) { res.status(400).json({ error: "path required" }); return }

		const agentDir = agentWorkspaceDir(req.params.agentId, projectId || req.query.projectId as string)
		const check = securePath(agentDir, filePath)
		if (!check.ok) { res.status(403).json({ error: check.error }); return }

		if (!fs.existsSync(check.fullPath)) {
			res.status(404).json({ error: "Database file not found" }); return
		}

		const sqlite3 = await import("better-sqlite3")
		const db = sqlite3.default(check.fullPath)

		try {
			// Cell update mode (inline editing)
			if (table && rowid !== undefined && column) {
				// Get primary key column name
				const tableInfo = db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string; pk: number }[]
				const pkColumn = tableInfo.find(c => c.pk === 1)?.name || 'rowid'
				
				// Sanitize column name (must be in table schema)
				const validColumns = tableInfo.map(c => c.name)
				if (!validColumns.includes(column) && column !== 'rowid') {
					res.status(400).json({ error: `Invalid column: ${column}` }); return
				}

				const stmt = db.prepare(`UPDATE "${table}" SET "${column}" = ? WHERE "${pkColumn}" = ?`)
				const result = stmt.run(value, rowid)
				
				res.json({ success: true, changes: result.changes })
				return
			}

			// Custom query mode
			if (query) {
				const trimmed = query.trim().toLowerCase()
				const isWrite = trimmed.startsWith("update") || trimmed.startsWith("insert") || trimmed.startsWith("delete")
				const isDrop = trimmed.startsWith("drop") || trimmed.startsWith("alter") || trimmed.startsWith("create")
				
				if (isDrop) {
					res.status(400).json({ error: "DROP, ALTER, and CREATE queries are not allowed from the UI" }); return
				}

				if (isWrite) {
					const result = db.prepare(query).run()
					res.json({ success: true, changes: result.changes, lastInsertRowid: result.lastInsertRowid })
				} else if (trimmed.startsWith("select")) {
					const rows = db.prepare(query).all()
					const columns = rows.length > 0 ? Object.keys(rows[0] as object) : []
					res.json({ rows, columns, total: rows.length })
				} else {
					res.status(400).json({ error: "Only SELECT, UPDATE, INSERT, DELETE queries are allowed" })
				}
				return
			}

			res.status(400).json({ error: "Either 'query' or 'table/rowid/column/value' required" })
		} finally {
			db.close()
		}
	} catch (error: any) {
		log.error("SQLite write error:", error)
		res.status(500).json({ error: error.message || String(error) })
	}
})

/**
 * GET /api/agent/:agentId/workspace/git-status - Get git status for agent's workspace
 */
app.get("/api/agent/:agentId/workspace/git-status", async (req, res): Promise<void> => {
	try {
		const projectId = req.query.projectId as string | undefined
		const agentDir = agentWorkspaceDir(req.params.agentId, projectId)
		if (!fs.existsSync(agentDir)) {
			res.json({ isRepo: false, unstaged: 0, staged: 0, untracked: 0, branch: null })
			return
		}

		// Check if it's a git repo
		const { execSync } = require("child_process")
		try {
			const branch = execSync("git rev-parse --abbrev-ref HEAD 2>/dev/null", { cwd: agentDir, encoding: "utf-8" }).trim()
			const status = execSync("git status --porcelain 2>/dev/null", { cwd: agentDir, encoding: "utf-8" })
			
			const lines = status.split("\n").filter((l: string) => l.trim())
			let unstaged = 0, staged = 0, untracked = 0
			
			for (const line of lines) {
				const x = line[0] // staged status
				const y = line[1] // unstaged status
				if (x === "?" && y === "?") untracked++
				else if (y !== " " && y !== "?") unstaged++
				if (x !== " " && x !== "?") staged++
			}
			
			res.json({ isRepo: true, branch, unstaged, staged, untracked, total: lines.length })
		} catch {
			// Not a git repo
			res.json({ isRepo: false, unstaged: 0, staged: 0, untracked: 0, branch: null })
		}
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

// Society Agent end

// ============================================================================
// Terminal & Command Execution
// ============================================================================

/**
 * POST /api/terminal/execute - Execute a shell command
 */
app.post("/api/terminal/execute", async (req, res): Promise<void> => {
	try {
		const { command, cwd, projectId } = req.body

		if (!command || typeof command !== "string") {
			res.status(400).json({ error: "Command required" })
			return
		}

		// Determine working directory
		const workingDir = cwd || process.cwd()

		const commandId = `cmd-${Date.now()}`

		// Execute command with real-time streaming
		commandExecutor
			.executeCommand(command, {
				cwd: workingDir,
				onOutput: (data, type) => {
					// Stream output via WebSocket
					io.emit("terminal-output", {
						commandId,
						data,
						type,
						timestamp: Date.now(),
					})
				},
				onExit: (code) => {
					io.emit("terminal-exit", {
						commandId,
						exitCode: code,
						timestamp: Date.now(),
					})
				},
			})
			.then((result) => {
				res.json({
					success: true,
					commandId: result.id,
					exitCode: result.exitCode,
					output: result.output,
				})
			})
			.catch((error) => {
				res.status(500).json({
					error: error.message,
					commandId,
				})
			})
	} catch (error) {
		log.error("Error executing command:", error)
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/terminal/kill - Kill a running command
 */
app.post("/api/terminal/kill", (req, res): void => {
	try {
		const { commandId } = req.body

		if (!commandId) {
			res.status(400).json({ error: "Command ID required" })
			return
		}

		const killed = commandExecutor.killCommand(commandId)

		res.json({
			success: killed,
			commandId,
		})
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * GET /api/terminal/history - Get command history
 */
app.get("/api/terminal/history", (req, res) => {
	try {
		const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined
		const history = commandExecutor.getHistory(limit)

		res.json({ history })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * GET /api/terminal/running - Get running commands
 */
app.get("/api/terminal/running", (req, res) => {
	try {
		const running = commandExecutor.getRunningCommands()

		res.json({ running })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/purpose/:purposeId/pause - Pause a purpose
 */
app.post("/api/purpose/:purposeId/pause", async (req, res) => {
	try {
		res.status(501).json({ error: "Purpose pause not yet implemented", purposeId: req.params.purposeId })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/purpose/:purposeId/stop - Stop a purpose
 */
app.post("/api/purpose/:purposeId/stop", async (req, res): Promise<void> => {
	try {
		if (!societyManager) {
			res.status(404).json({ error: "Society Manager not initialized" })
			return
		}

		await societyManager.stopPurpose(req.params.purposeId, "User requested stop")

		res.json({ status: "stopped", purposeId: req.params.purposeId })
	} catch (error) {
		log.error("Error stopping purpose:", error)
		res.status(500).json({ error: String(error) })
	}
})

// ============================================================================
// WebSocket Events (Real-time Communication)
// ============================================================================

io.on("connection", (socket) => {
	const clientId = socket.id
	connectedClients.add(clientId)

	log.info(`Client connected: ${clientId}`)

	// Society Agent start - terminal (node-pty) per socket
	let ptyProcess: pty.IPty | null = null

	socket.on("terminal-start", (opts: { shell?: string; cols?: number; rows?: number; agentId?: string; projectId?: string }) => {
		// Kill existing terminal for this socket
		if (ptyProcess) {
			try {
				ptyProcess.kill()
			} catch {}
			ptyProcess = null
		}

		const shell = opts.shell || process.env.SHELL || "/bin/bash"
		// Society Agent start - scope terminal cwd to agent's workspace folder
		let cwd: string
		if (opts.projectId && opts.agentId) {
			// Persistent agent within a project - use projectStore to resolve homeFolder
			cwd = projectStore.agentHomeDir(opts.projectId, opts.agentId)
		} else if (opts.agentId) {
			const profile = agentStore.get(opts.agentId)
			const folder = profile?.workspaceFolder || opts.agentId
			cwd = path.join(getWorkspacePath(), "projects", folder)
		} else {
			cwd = process.env.WORKSPACE_PATH || process.cwd()
		}
		// Ensure workspace folder exists
		try { fs.mkdirSync(cwd, { recursive: true }) } catch {}
		// Society Agent end
		const cols = opts.cols || 80
		const rows = opts.rows || 24

		try {
			ptyProcess = pty.spawn(shell, [], {
				name: "xterm-256color",
				cols,
				rows,
				cwd,
				env: { ...process.env, TERM: "xterm-256color" } as Record<string, string>,
			})

			ptyProcess.onData((data: string) => {
				socket.emit("terminal-output", data)
			})

			ptyProcess.onExit(({ exitCode, signal }) => {
				socket.emit("terminal-exit", { code: exitCode, signal })
				ptyProcess = null
			})

			socket.emit("terminal-ready")
			log.info(`Terminal started for ${clientId}: ${shell} (${cols}x${rows})`)
		} catch (err) {
			log.error("Failed to spawn terminal:", err)
			socket.emit("terminal-output", `\x1b[31mFailed to start terminal: ${err}\x1b[0m\r\n`)
		}
	})

	socket.on("terminal-input", (data: string) => {
		if (ptyProcess) ptyProcess.write(data)
	})

	socket.on("terminal-resize", ({ cols, rows }: { cols: number; rows: number }) => {
		if (ptyProcess) {
			try {
				ptyProcess.resize(cols, rows)
			} catch {}
		}
	})

	socket.on("terminal-stop", () => {
		if (ptyProcess) {
			try {
				ptyProcess.kill()
			} catch {}
			ptyProcess = null
		}
	})
	// Society Agent end

	socket.on("subscribe-purpose", (purposeId: string) => {
		log.info(`Client ${clientId} subscribed to purpose ${purposeId}`)
		socket.join(`purpose:${purposeId}`)
	})

	socket.on("unsubscribe-purpose", (purposeId: string) => {
		log.info(`Client ${clientId} unsubscribed from purpose ${purposeId}`)
		socket.leave(`purpose:${purposeId}`)
	})

	socket.on("subscribe-agent", (agentId: string) => {
		log.info(`Client ${clientId} subscribed to agent ${agentId}`)
		socket.join(`agent:${agentId}`)
	})

	// Society Agent start - Stop agent handler
	socket.on("stop-agent", (data: { agentId?: string }) => {
		const agentId = data.agentId || "default"
		log.info(`Client ${clientId} requested stop for agent ${agentId}`)
		// Add to stopped set - the agentic loop will check this
		stoppedAgents.add(agentId)
		// Clear after a timeout (in case request already finished)
		setTimeout(() => stoppedAgents.delete(agentId), 30000)
		// Emit acknowledgment
		socket.emit("agent-stopped", { agentId })
	})
	// Society Agent end

	socket.on("disconnect", () => {
		// Society Agent start - clean up terminal on disconnect
		if (ptyProcess) {
			try {
				ptyProcess.kill()
			} catch {}
			ptyProcess = null
		}
		// Society Agent end
		connectedClients.delete(clientId)
		log.info(`Client disconnected: ${clientId}`)
	})
})

// ============================================================================
// Serve React SPA
// ============================================================================

// Society Agent start - serve agent-specific page
app.get("/agent/:agentId", (req, res) => {
	res.sendFile(path.join(__dirname, "public/agent.html"))
})
// Society Agent end

// Society Agent start - serve project page
app.get("/project/:projectId", (req, res) => {
	res.sendFile(path.join(__dirname, "public/project.html"))
})
app.get("/project/:projectId/agent/:agentId", (req, res) => {
	res.sendFile(path.join(__dirname, "public/agent.html"))
})
// Society Agent end

app.get("*", (req, res) => {
	res.sendFile(path.join(__dirname, "public/index.html"))  // Society Agent - serve standalone frontend
})

// ============================================================================
// Error Handling
// ============================================================================

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
	log.error("Server error:", err)
	res.status(500).json({
		error: "Internal server error",
		message: NODE_ENV === "development" ? err.message : undefined,
	})
})

// ============================================================================
// Start Server
// ============================================================================

async function start() {
	try {
		// Society Agent start - initialize standalone settings
		const workspacePath = getWorkspacePath()
		initializeSettings(workspacePath)
		log.info(getSettingsSummary())
		// Society Agent end
		
		// Society Agent start - initialize MCP client manager
		initMcpManager(workspacePath)
		log.info(`MCP client manager initialized`)
		// Society Agent end
		
		// Society Agent start - initialize git loader for project history
		initGitLoader(workspacePath)
		log.info(`Git loader initialized`)
		// Society Agent end

		// Society Agent start - initialize port manager for project port allocation
		PortManager.initialize(workspacePath)
		// Set callback to update PROTECTED_PORTS when allocations change
		PortManager.setAllocationChangeCallback((allocations) => {
			// Add all allocated ports to protected set
			for (const alloc of allocations) {
				PROTECTED_PORTS.add(alloc.port)
			}
			log.info(`[PortManager] Updated protected ports: ${[...PROTECTED_PORTS].join(", ")}`)
		})
		// Initialize protected ports from existing allocations
		const existingAllocations = PortManager.getAllAllocations()
		for (const alloc of existingAllocations) {
			PROTECTED_PORTS.add(alloc.port)
		}
		log.info(`Port manager initialized with ${existingAllocations.length} existing allocation(s)`)
		// Society Agent end

		// Society Agent start - start diagnostics watchers for existing projects
		const existingProjects = projectStore.getAll()
		for (const p of existingProjects) {
			diagnosticsWatcher.startProject(p.id, p.folder || p.id)
		}
		log.info(`Diagnostics watchers started for ${existingProjects.length} existing project(s)`)
		// Society Agent end

		log.info(`Society Agent Web Server | Environment: ${NODE_ENV} | Port: ${PORT}`)

		// Don't initialize Society Manager at startup - wait for first request with API key

		// Bind to 0.0.0.0 (IPv4) for VS Code port forwarding compatibility
		server.listen(PORT, "0.0.0.0", () => {
			log.info(`Server running on http://localhost:${PORT}`)
			log.info(`API: http://localhost:${PORT}/api`)
			log.info(`WebSocket: ws://localhost:${PORT}`)
			log.info(`Configure your API key in the web UI (click Settings button)`)
		})
	} catch (error) {
		log.error("Failed to start server:", error)
		process.exit(1)
	}
}

start()

// Graceful shutdown
process.on("SIGTERM", () => {
	log.info("SIGTERM received, shutting down gracefully")
	diagnosticsWatcher.stopAll()
	server.close(() => {
		log.info("Server closed")
		process.exit(0)
	})
})

export { app, server, io }
