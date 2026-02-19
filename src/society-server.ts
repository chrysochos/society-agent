// kilocode_change - new file
/**
 * Society Agent Web Server
 *
 * Express.js server that runs Society Agents and exposes them via HTTP/WebSocket API.
 * Single user, full-featured chat interface with agent monitoring.
 */

// kilocode_change - Mock vscode module for standalone server mode (must be first!)
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
import OpenAI from "openai" // kilocode_change - OpenRouter support
import { ApiHandler } from "../../api/index"
import { commandExecutor } from "./command-executor"
import { getLog } from "./logger"
// kilocode_change start - dynamic provider configuration
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
} from "./provider-config"
import type { ProviderSettings } from "@roo-code/types"
// kilocode_change end
// kilocode_change start - persistent agents
import { PersistentAgentStore } from "./persistent-agent-store"
// kilocode_change end
// kilocode_change start - project system
import { ProjectStore, ProjectAgentConfig, Project, Task, TaskContext } from "./project-store"
// kilocode_change end
// kilocode_change start - terminal support
import * as pty from "node-pty"
// kilocode_change end
// kilocode_change start - standalone settings system
import { settings as standaloneSettings, initializeSettings, getSettingsSummary } from "./settings"
// kilocode_change end

const app = express()
const server = http.createServer(app)
const io = new SocketIOServer(server, {
	cors: { origin: "*" },
	// kilocode_change start - Increase timeouts for long-running operations
	pingTimeout: 300000,     // 5 minutes
	pingInterval: 30000,     // 30 seconds
	// kilocode_change end
})

const PORT = process.env.PORT || 4000
const NODE_ENV = process.env.NODE_ENV || "development"
const log = getLog()

// kilocode_change start - centralized workspace path with stable default
function getWorkspacePath(): string {
	return process.env.WORKSPACE_PATH || "/workspace"
}

function getOutputDir(): string {
	return path.join(getWorkspacePath(), "projects")
}
// kilocode_change end

// Middleware
app.use(express.json({ limit: "50mb" })) // kilocode_change - support file uploads
app.use(express.static(path.join(__dirname, "public")))  // kilocode_change - serve standalone frontend

// Global state
let societyManager: SocietyManager | null = null
const connectedClients = new Set<string>()
let userAgent: ConversationAgent | null = null // Single agent for user conversations
const stoppedAgents = new Set<string>() // kilocode_change - track agents that should stop

// kilocode_change start - persistent agent system
const agentStore = new PersistentAgentStore(getWorkspacePath())
const activeAgents = new Map<string, ConversationAgent>() // agentId → live ConversationAgent
// kilocode_change end
// kilocode_change start - project system
const projectStore = new ProjectStore(getWorkspacePath())
// kilocode_change end

// kilocode_change start - activity logging for visibility
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
// kilocode_change end

// kilocode_change start - token usage tracking
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
// kilocode_change - Added OpenRouter model pricing
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

// kilocode_change - Helper to find pricing with model name variations
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
// kilocode_change end

// kilocode_change start - Agent inbox system for async messaging
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
// kilocode_change end

// kilocode_change start - track current provider config
let currentProviderConfig: ProviderConfig | null = null
let currentProviderSettings: ProviderSettings | null = null

/**
 * Get API handler using current provider configuration
 * Falls back to loading config if not initialized
 * Now uses buildSocietyApiHandler for full provider support
 */
function getApiHandlerFromConfig(): ApiHandler {
	const workspacePath = process.env.WORKSPACE_PATH || process.cwd()

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

	return createApiHandler(currentProviderConfig) as ApiHandler
}
// kilocode_change end

/**
 * Initialize Society Manager with callbacks
 */
async function initializeSocietyManager(apiKey?: string) {
	if (societyManager) return

	try {
		log.info("Initializing Society Manager...")

		const workspacePath = process.env.WORKSPACE_PATH || process.cwd()

		// kilocode_change start - use full provider configuration
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
			let providerConfig: ProviderConfig
			try {
				providerConfig = loadProviderConfig(workspacePath)
			} catch (configError) {
				// If no config exists and apiKey provided, use Anthropic as default
				if (apiKey) {
					providerConfig = {
						provider: "anthropic",
						apiKey,
						model: process.env.API_MODEL_ID || "claude-sonnet-4-20250514",
					}
				} else {
					throw configError
				}
			}
			currentProviderConfig = providerConfig
			currentProviderSettings = null
			log.info(`Using provider: ${providerConfig.provider}, model: ${providerConfig.model} (legacy config)`)
			apiHandler = createApiHandler(providerConfig) as ApiHandler
		}
		// kilocode_change end

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

	const purposeAny = purpose as any // kilocode_change - access team/identity properties
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
	res.json({
		status: "ok",
		environment: NODE_ENV,
		societyManagerReady: !!societyManager,
		apiKeyConfigured: !!process.env.ANTHROPIC_API_KEY,
		workspacePath,
		outputDir: path.join(workspacePath, "projects"),
		timestamp: new Date().toISOString(),
	})
})

// kilocode_change start - activity log API
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
// kilocode_change end

// kilocode_change start - usage/cost tracking API
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
// kilocode_change end

// kilocode_change start - workspace directory browser for project.html
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
// kilocode_change end

// kilocode_change start - workspace file browser
/**
 * GET /api/workspace/files - List files in the projects output directory
 */
app.get("/api/workspace/files", async (req, res): Promise<void> => {
	try {
		const workspacePath = process.env.WORKSPACE_PATH || process.cwd()
		const projectsDir = path.join(workspacePath, "projects")

		const files: { path: string; fullPath: string; size: number; modified: string; isDir: boolean }[] = []

		// kilocode_change - Skip heavy directories that slow down file listing
		const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".next", ".cache", "coverage", "__pycache__", ".git"])

		async function walkDir(dir: string, prefix: string = "") {
			try {
				const entries = await fs.promises.readdir(dir, { withFileTypes: true })
				for (const entry of entries) {
					if (entry.name.startsWith(".")) continue
					if (SKIP_DIRS.has(entry.name)) continue // kilocode_change - skip heavy dirs
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

// kilocode_change start - Raw file serving for viewers (images, PDFs, etc.)
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
// kilocode_change end

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
// kilocode_change end

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
		// Also save to src/.env as fallback (where KiloCode reads it)
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

		// Also update src/.env if it exists (keeps KiloCode in sync)
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

// kilocode_change start - change workspace path from browser
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
// kilocode_change end

// kilocode_change start - provider configuration endpoints
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

		await saveProviderConfig(workspacePath, provider, apiKey, model)

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
// kilocode_change end

// kilocode_change start - standalone settings API
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
// kilocode_change end

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

		const { description, attachments, agentId } = req.body // kilocode_change - added agentId

		if (!description && (!attachments || attachments.length === 0)) {
			res.status(400).json({ error: "Purpose description or attachments required" })
			return
		}

		// kilocode_change start - route to persistent/project agent if agentId specified
		if (agentId) {
			// Try project store first, then legacy store
			const found = projectStore.findAgentProject(agentId)
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

			// kilocode_change start - Auto-extract and create files from project agent responses
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
			// kilocode_change end

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
				filesCreated, // kilocode_change - report files created
			})
			return
		}
		// kilocode_change end

		// Initialize user agent if not exists (maintains conversation memory)
		if (!userAgent) {
			log.info("Creating user conversation agent...")

			// kilocode_change start - use provider config instead of hardcoded Anthropic
			const apiHandler = getApiHandlerFromConfig()
			// kilocode_change end

			userAgent = new ConversationAgent({
				identity: {
					id: "society-agent",
					createdAt: Date.now(),
				},
				apiHandler,
				systemPrompt: `You are Society Agent, an AI assistant powering a multi-agent collaboration system.

Your role:
- Answer questions conversationally and helpfully
- Help with coding, writing, analysis, planning, and creative tasks
- Provide clear, well-structured responses
- Maintain context across the conversation

Guidelines:
- Be conversational and direct
- Use markdown formatting when helpful
- Be concise but thorough
- You have full conversation memory across messages`,
				onMessage: (message) => {
					// Stream message to client
					io.emit("agent-message", {
						agentId: "user-agent",
						message: message.content,
						timestamp: message.timestamp,
						isStreaming: false,
					})
				},
				// kilocode_change start - file creation tracking
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
				// kilocode_change end
				// kilocode_change start - summarization events
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
				// kilocode_change end
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

// kilocode_change start
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
// kilocode_change end

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
			const pAny = purpose as any // kilocode_change
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

		const pAny = purpose as any // kilocode_change
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
			const pAny = purpose as any // kilocode_change
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
			const pAny = purpose as any // kilocode_change
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
		res.status(501).json({ error: "Agent stop not yet implemented", agentId: req.params.agentId })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

// kilocode_change start - persistent agent CRUD endpoints
/**
 * Helper: get or create a live ConversationAgent from a persistent profile
 */
function getOrCreateAgent(profile: import("./persistent-agent-store").PersistentAgentProfile, apiKey: string): ConversationAgent {
	const existing = activeAgents.get(profile.id)
	if (existing) return existing

	// kilocode_change start - use provider config instead of hardcoded Anthropic
	const apiHandler = getApiHandlerFromConfig()
	// kilocode_change end

	// Build system prompt with memory context
	let fullPrompt = profile.systemPrompt
	if (profile.memorySummary) {
		fullPrompt += `\n\n## Your Memory (from past conversations)\n${profile.memorySummary}`
	}

	const agent = new ConversationAgent({
		identity: {
			id: profile.id,
			createdAt: Date.now(),
		},
		apiHandler,
		systemPrompt: fullPrompt,
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
		// kilocode_change start - summarization events
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
		// kilocode_change end
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
		// kilocode_change - notify open agent pages
		io.emit("agent-reset", { agentId: req.params.id, timestamp: Date.now() })
		res.json({ success: true, message: `Agent ${profile.name} memory cleared` })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})
// kilocode_change end

// kilocode_change start - project CRUD endpoints

/**
 * GET /api/projects - List all projects
 */
app.get("/api/projects", (req, res): void => {
	try {
		const projects = projectStore.getAll().map((p) => ({
			...p,
			agents: p.agents.map((a) => ({
				...a,
				isActive: activeAgents.has(a.id),
				historyLength: activeAgents.get(a.id)?.getHistory().length || 0,
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
				isActive: activeAgents.has(a.id),
				historyLength: activeAgents.get(a.id)?.getHistory().length || 0,
			})),
		})
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
		
		// kilocode_change start - Auto-create Main Supervisor if no agents provided
		let projectAgents = agents
		if (!agents || agents.length === 0) {
			const supervisorId = "supervisor"
			projectAgents = [{
				id: supervisorId,
				name: "Main Supervisor",
				role: "Project Supervisor - coordinates work, delegates to workers, or works solo on simple tasks",
				systemPrompt: `You are the Main Supervisor for project "${name}".

## QUICK TASKS - DO THEM DIRECTLY!
For simple operational requests, act immediately without over-analyzing:
- "Run the servers" → Just run them (cd backend && npm start, cd frontend && npm run dev)
- "Stop the servers" → Kill the processes
- "Install dependencies" → npm install in each directory
- "Check status" → quick ls or ps command
- "Fix this error" → Read the error, fix the file, done

**DON'T** spend 15 steps checking every file when user just wants you to run something!

## PORT CONFLICTS - KILL FIRST, ASK LATER
If you get "EADDRINUSE" (port already in use):
1. DON'T waste time investigating - just kill it: \`fuser -k PORT/tcp\` or \`pkill -f "node.*PORT"\`
2. Then start your server
3. Example: \`fuser -k 3001/tcp; npm start\` (kill port 3001, then start)

Other projects may have servers running - don't be polite, just take the port.

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

This way you (and future sessions) don't have to re-learn everything!`,
				homeFolder: "/", // kilocode_change - supervisor works in project root, not subfolder
			}]
			log.info(`[Project] Auto-created Main Supervisor for project "${name}"`)
		}
		// kilocode_change end
		
		const project = projectStore.create({ id, name, description: description || "", folder, knowledge, agents: projectAgents })
		io.emit("system-event", { type: "project-created", projectId: id, name, timestamp: Date.now() })
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
			for (const a of project.agents) activeAgents.delete(a.id)
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
 * POST /api/projects/:id/agents - Add an agent to a project
 */
app.post("/api/projects/:id/agents", (req, res): void => {
	try {
		const { id, name, role, systemPrompt, homeFolder, model } = req.body
		if (!id || !name || !role || !systemPrompt) {
			res.status(400).json({ error: "id, name, role, and systemPrompt are required" })
			return
		}
		const agent = projectStore.addAgent(req.params.id, {
			id, name, role,
			systemPrompt,
			homeFolder: homeFolder || "/",
			model,
		})
		if (!agent) {
			res.status(404).json({ error: "Project not found" })
			return
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
		const updated = projectStore.updateAgent(req.params.projectId, req.params.agentId, req.body)
		if (!updated) {
			res.status(404).json({ error: "Project or agent not found" })
			return
		}
		if (activeAgents.has(req.params.agentId)) {
			activeAgents.delete(req.params.agentId)
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
		activeAgents.delete(req.params.agentId)
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
		activeAgents.delete(req.params.agentId)
		projectStore.resetAgentMemory(req.params.projectId, req.params.agentId)
		// kilocode_change - notify open agent pages
		io.emit("agent-reset", { agentId: req.params.agentId, projectId: req.params.projectId, timestamp: Date.now() })
		res.json({ success: true, message: `Agent ${agent.name} memory cleared` })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

// kilocode_change end

// kilocode_change start - agent chat history endpoint
/**
 * GET /api/agent/:agentId/history - Get conversation history for an agent
 * Returns messages from the live agent (if cached), plus summary if available.
 */
app.get("/api/agent/:agentId/history", (req, res): void => {
	try {
		const { agentId } = req.params
		const agent = activeAgents.get(agentId)
		if (!agent) {
			// Agent not active — return empty with any persisted memory
			const found = projectStore.findAgentProject(agentId)
			const memorySummary = found?.agent.memorySummary || agentStore.get(agentId)?.memorySummary || ""
			res.json({ messages: [], summary: "", memorySummary, active: false })
			return
		}
		res.json({
			messages: agent.getHistory(),
			summary: agent.getSummary(),
			memorySummary: "",
			active: true,
		})
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * DELETE /api/agent/:agentId/history - Clear conversation history for an agent
 * Clears in-memory history and persisted memory summary.
 */
app.delete("/api/agent/:agentId/history", (req, res): void => {
	try {
		const { agentId } = req.params
		const agent = activeAgents.get(agentId)
		if (agent) {
			agent.clearHistory()
		}
		// Also clear persisted memory
		const found = projectStore.findAgentProject(agentId)
		if (found) {
			projectStore.resetAgentMemory(found.project.id, agentId)
		} else {
			agentStore.updateMemory(agentId, "")
		}
		io.emit("agent-reset", { agentId, timestamp: Date.now() })
		log.info(`Cleared history for agent: ${agentId}`)
		res.json({ success: true, message: "History cleared" })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

// kilocode_change start - history backups and context stats endpoints
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
// kilocode_change end
// kilocode_change end

// kilocode_change start - agent-scoped workspace & chat routes (session-based, single port)

/**
 * Helper: resolve agent's workspace directory.
 * Checks project store first (project-based agents), then falls back to legacy agent store.
 */
function agentWorkspaceDir(agentId: string): string {
	// New: look up via project store
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
 */
function securePath(agentDir: string, relativePath: string): { ok: boolean; fullPath: string; error?: string } {
	const fullPath = path.join(agentDir, relativePath)
	const resolved = path.resolve(fullPath)
	const dirResolved = path.resolve(agentDir)
	if (!resolved.startsWith(dirResolved)) {
		return { ok: false, fullPath, error: "Access denied: path outside agent workspace" }
	}
	return { ok: true, fullPath }
}

// kilocode_change start - Tool-use supervisor delegation with agentic loop

/**
 * Anthropic tool definitions for supervisor agents.
 * These let the supervisor organically decide when to delegate, list team, or propose new agents.
 */
const SUPERVISOR_TOOLS: Anthropic.Tool[] = [
	// kilocode_change start - Supervisor mind tools (same as workers)
	{
		name: "read_file",
		description: "Read a file from YOUR folder. Use this to read any files you've created - notes, plans, context. This is your persistent memory!",
		input_schema: {
			type: "object" as const,
			properties: {
				path: { type: "string", description: "Relative path to the file (e.g. 'notes.md', 'plan.md', 'context.md')" },
			},
			required: ["path"],
		},
	},
	{
		name: "write_file",
		description: "Write/update a file in YOUR folder. Save notes, plans, decisions, learnings - whatever helps you stay organized.",
		input_schema: {
			type: "object" as const,
			properties: {
				path: { type: "string", description: "Relative path to the file (e.g. 'notes.md', 'decisions.md', 'progress.md')" },
				content: { type: "string", description: "Full content to write to the file" },
			},
			required: ["path", "content"],
		},
	},
	{
		name: "list_files",
		description: "List files in YOUR folder. Use this to see what files exist.",
		input_schema: {
			type: "object" as const,
			properties: {
				path: { type: "string", description: "Relative path to directory (e.g. '.' for your root)" },
			},
			required: ["path"],
		},
	},
	// kilocode_change end
	{
		name: "list_team",
		description: "List all agents in your project team with their IDs, names, roles, and current status. Use this to see who is available before delegating.",
		input_schema: {
			type: "object" as const,
			properties: {},
			required: [],
		},
	},
	// kilocode_change start - Supervisor can read agent knowledge
	{
		name: "read_agent_file",
		description: "Read a file from an agent's folder. Use this to check their files and notes. Check agent knowledge before delegating to understand what they already know!",
		input_schema: {
			type: "object" as const,
			properties: {
				agent_id: { type: "string", description: "The agent ID whose file to read" },
				path: { type: "string", description: "Relative path to the file (e.g. 'notes.md', 'package.json', 'src/App.js')" },
			},
			required: ["agent_id", "path"],
		},
	},
	{
		name: "list_agent_files",
		description: "List files in an agent's folder. Use this to see what an agent has created, what knowledge files exist, and understand their project state.",
		input_schema: {
			type: "object" as const,
			properties: {
				agent_id: { type: "string", description: "The agent ID whose files to list" },
				path: { type: "string", description: "Relative path within agent folder (default: '.')" },
			},
			required: ["agent_id"],
		},
	},
	// kilocode_change end
	// kilocode_change start - Supervisor can ask/message agents directly
	{
		name: "ask_agent",
		description: "Ask a quick question to one of your workers. They'll respond immediately. Good for clarification, status checks, or quick coordination. For complex work, use delegate_task instead.",
		input_schema: {
			type: "object" as const,
			properties: {
				agent_id: { type: "string", description: "The agent ID to ask (from list_team)" },
				question: { type: "string", description: "Your question or message" },
			},
			required: ["agent_id", "question"],
		},
	},
	{
		name: "send_message",
		description: "Send an async message to an agent's inbox. They'll see it when they check their inbox. Use for non-urgent updates, instructions for later, or FYI messages.",
		input_schema: {
			type: "object" as const,
			properties: {
				agent_id: { type: "string", description: "The agent ID to message" },
				message: { type: "string", description: "Your message content" },
				priority: { type: "string", enum: ["normal", "urgent"], description: "Priority level. Urgent messages may interrupt the agent." },
			},
			required: ["agent_id", "message"],
		},
	},
	{
		name: "read_inbox",
		description: "Check your inbox for messages from other agents. Call this periodically to see if anyone has sent you messages.",
		input_schema: {
			type: "object" as const,
			properties: {
				mark_read: { type: "boolean", description: "If true, mark messages as read. Default: true" },
			},
			required: [],
		},
	},
	// kilocode_change end
	{
		name: "delegate_task",
		description: "Delegate a specific task to one of your team agents. The agent will execute the task autonomously and return results including any files created. Use this when work needs to be done by a specialist.",
		input_schema: {
			type: "object" as const,
			properties: {
				agent_id: { type: "string", description: "The ID of the agent to delegate to (from list_team)" },
				task: { type: "string", description: "Detailed task instructions. Be specific — include requirements, technology choices, file names, expected output format. The agent has no prior context." },
			},
			required: ["agent_id", "task"],
		},
	},
	// kilocode_change start - Parallel delegation for multiple agents
	{
		name: "delegate_tasks_parallel",
		description: "Delegate tasks to MULTIPLE agents simultaneously. All agents work in parallel and results are collected. Use this when you have independent tasks for different specialists.",
		input_schema: {
			type: "object" as const,
			properties: {
				delegations: {
					type: "array",
					description: "Array of delegation objects",
					items: {
						type: "object",
						properties: {
							agent_id: { type: "string", description: "Agent ID to delegate to" },
							task: { type: "string", description: "Task instructions for this agent" },
						},
						required: ["agent_id", "task"],
					},
				},
			},
			required: ["delegations"],
		},
	},
	// kilocode_change end
	{
		name: "propose_new_agent",
		description: "Create a new worker agent for the project. By default, agents are EPHEMERAL (automatically deleted after completing their task). Use persistent=true for agents you want to keep long-term.",
		input_schema: {
			type: "object" as const,
			properties: {
				name: { type: "string", description: "Human-readable name for the agent (e.g. 'Security Reviewer')" },
				role: { type: "string", description: "One-line role description (e.g. 'Reviews code for security vulnerabilities')" },
				system_prompt: { type: "string", description: "System prompt defining the agent's expertise and behavior" },
				persistent: { type: "boolean", description: "If true, agent is permanent. If false (default), agent is deleted after completing its task." },
			},
			required: ["name", "role"],
		},
	},
	// kilocode_change start - Cleanup orphaned ephemeral files
	{
		name: "cleanup_ephemeral_files",
		description: "List and optionally delete _eph_ prefixed files (from ephemeral agents). Orphaned files are those where the agent no longer exists.",
		input_schema: {
			type: "object" as const,
			properties: {
				delete: { type: "boolean", description: "If true, delete orphaned files. If false (default), just list them." },
				pattern: { type: "string", description: "Optional: filter files containing this pattern (e.g. agent ID or filename)" },
			},
			required: [],
		},
	},
	// kilocode_change end
	// kilocode_change start - Task pool system
	{
		name: "create_task",
		description: "Create a task in the task pool. Workers will claim and execute tasks. Include full context so workers can execute without asking questions.",
		input_schema: {
			type: "object" as const,
			properties: {
				title: { type: "string", description: "Short task title (e.g. 'Write User model tests')" },
				description: { type: "string", description: "Full task description with requirements, acceptance criteria, implementation hints" },
				priority: { type: "number", description: "Priority 1-10 (higher = more urgent). Default: 5" },
				working_directory: { type: "string", description: "Directory for this task relative to project root (e.g. 'src/models', 'tests')" },
				output_paths: {
					type: "object",
					description: "Expected output files as { path: description } (e.g. { 'tests/user.test.ts': 'Unit tests for User model' })",
				},
				relevant_files: {
					type: "array",
					items: { type: "string" },
					description: "Files the worker should read for context (e.g. ['src/models/user.ts', 'README.md'])",
				},
				conventions: { type: "string", description: "Coding conventions, patterns to follow (e.g. 'Use Jest, follow existing test patterns')" },
				notes: { type: "string", description: "Additional context or notes" },
			},
			required: ["title", "description"],
		},
	},
	{
		name: "list_tasks",
		description: "List all tasks in the task pool with their status. Shows available, claimed, in-progress, completed, and failed tasks.",
		input_schema: {
			type: "object" as const,
			properties: {
				status: {
					type: "string",
					enum: ["all", "available", "claimed", "in-progress", "completed", "failed"],
					description: "Filter by status. Default: 'all'",
				},
			},
			required: [],
		},
	},
	{
		name: "spawn_worker",
		description: "Spawn an ephemeral worker to claim and execute tasks from the pool. Worker is generic - it becomes specialized by the task it claims. Workers auto-delete after completing their task.",
		input_schema: {
			type: "object" as const,
			properties: {
				count: { type: "number", description: "How many workers to spawn (limited by maxConcurrentWorkers). Default: 1" },
			},
			required: [],
		},
	},
	{
		name: "get_worker_status",
		description: "Get status of all active ephemeral workers - what task each is working on, progress, etc.",
		input_schema: {
			type: "object" as const,
			properties: {},
			required: [],
		},
	},
	// kilocode_change end
	{
		name: "run_command",
		description: "Execute a shell command in the project workspace. Use this to install dependencies (npm install), run servers (npm start), run tests, or any other terminal operation. Commands run in the project folder.",
		input_schema: {
			type: "object" as const,
			properties: {
				command: { type: "string", description: "The shell command to execute (e.g. 'npm install', 'npm start', 'ls -la')" },
				working_dir: { type: "string", description: "Optional subdirectory within the project to run the command (e.g. 'agent1' or 'backend'). Defaults to project root." },
				background: { type: "boolean", description: "If true, run the command in background (for servers). Default false." },
				timeout_ms: { type: "number", description: "Timeout in milliseconds. Default 60000 (60s). Use higher for npm install." },
			},
			required: ["command"],
		},
	},
]

// kilocode_change start - Worker agents get tools to operate in their folder
const WORKER_TOOLS: Anthropic.Tool[] = [
	{
		name: "run_command",
		description: "Execute a shell command in YOUR agent folder. Use this to install dependencies (npm install), run/stop servers, run tests, or any terminal operation. Commands run in your designated folder within the project.",
		input_schema: {
			type: "object" as const,
			properties: {
				command: { type: "string", description: "The shell command to execute (e.g. 'npm install', 'npm start', 'pkill -f node')" },
				background: { type: "boolean", description: "If true, run in background (for servers). Default false." },
				timeout_ms: { type: "number", description: "Timeout in milliseconds. Default 60000 (60s)." },
			},
			required: ["command"],
		},
	},
	// kilocode_change start - Mind tools for persistent memory
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
	// kilocode_change start - patch_file for targeted edits
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
	// kilocode_change end
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
	// kilocode_change end
	// kilocode_change start - Inter-agent communication
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
		description: "Send an async message to another agent's inbox. They'll see it when they check their inbox. Use for non-urgent updates, requests for later, or FYI messages. Does not wait for response.",
		input_schema: {
			type: "object" as const,
			properties: {
				agent_id: { type: "string", description: "ID of the agent to message" },
				message: { type: "string", description: "Your message content" },
				priority: { type: "string", enum: ["normal", "urgent"], description: "Priority level. Default: normal" },
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
	// kilocode_change end
	// kilocode_change start - Allow workers to READ from project (other agents' folders)
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
	// kilocode_change start - Additional development tools
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
		description: "List running processes - find servers, check if something is running on a port, see what's active.",
		input_schema: {
			type: "object" as const,
			properties: {
				filter: { type: "string", description: "Filter by name (e.g. 'node', 'npm', 'python')" },
				port: { type: "number", description: "Find process on specific port" },
			},
			required: [],
		},
	},
	{
		name: "kill_process",
		description: "Kill a process by PID or by port. Useful to stop servers or hung processes.",
		input_schema: {
			type: "object" as const,
			properties: {
				pid: { type: "number", description: "Process ID to kill" },
				port: { type: "number", description: "Kill process on this port" },
				name: { type: "string", description: "Kill processes matching this name (use carefully!)" },
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
	// kilocode_change end
	// kilocode_change start - Task pool tools for workers
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
	// kilocode_change end
]
// kilocode_change end

/**
 * Execute a single tool call for suprevisor agents.
 * Returns the tool result as a string.
 */
/**
 * Execute a single tool call for an agent.
 * kilocode_change - UNIFIED: supervisors and workers are identical.
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
	const agentConfig = project.agents.find(a => a.id === supervisorId)
	if (!agentConfig) {
		return { result: `Error: Agent ${supervisorId} not found`, filesCreated: 0 }
	}
	
	// Delegate to the unified agent tool execution
	const { result } = await executeAgentTool(toolName, toolInput, agentConfig, project, io, apiKey)
	
	// Track filesCreated for write_file operations
	const filesCreated = (toolName === "write_file" && result.includes("✅")) ? 1 : 0
	return { result, filesCreated }
}

// kilocode_change start - Worker tool execution (restricted to their folder)
async function executeAgentTool(
	toolName: string,
	toolInput: any,
	agentConfig: ProjectAgentConfig,
	project: Project,
	io: SocketIOServer,
	apiKey?: string, // kilocode_change - Optional API key for spawning sub-agents
): Promise<{ result: string; filesCreated: number }> {
	// kilocode_change start - Use task's workingDirectory if worker has a claimed task
	const claimedTask = projectStore.getTasks(project.id).find(
		t => t.claimedBy === agentConfig.id && ["claimed", "in-progress"].includes(t.status)
	)
	
	// Determine the working folder
	let workingFolder: string
	if (claimedTask && claimedTask.context.workingDirectory && claimedTask.context.workingDirectory !== "/") {
		// Use the task's working directory (relative to project folder)
		const projectFolder = project.folder || project.id
		workingFolder = path.join(projectStore.projectsBaseDir, projectFolder, claimedTask.context.workingDirectory)
	} else {
		// Fall back to agent's home folder
		workingFolder = projectStore.agentHomeDir(project.id, agentConfig.id)
	}
	// kilocode_change end
	
	// Also keep agentFolder for tools that need it (like memory files)
	const agentFolder = projectStore.agentHomeDir(project.id, agentConfig.id)

	// Ensure directories exist
	if (!fs.existsSync(workingFolder)) {
		fs.mkdirSync(workingFolder, { recursive: true })
	}
	if (!fs.existsSync(agentFolder)) {
		fs.mkdirSync(agentFolder, { recursive: true })
	}

	// kilocode_change start - Emit tool-execution event for UI visibility
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
				return `💻 Running: ${toolInput.command}${toolInput.background ? ' (background)' : ''}`
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
	// kilocode_change end

	// kilocode_change start - Handle all worker tools
	switch (toolName) {
		case "read_file": {
			const { path: filePath } = toolInput as { path: string }
			
			// kilocode_change - Reject absolute paths
			if (filePath && filePath.startsWith("/")) {
				return { result: `❌ Use relative paths only! Your working folder is: ${workingFolder}\nTry: read_file("src/App.js") or read_project_file() for project files`, filesCreated: 0 }
			}
			
			// kilocode_change - Use workingFolder for file operations
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
			
			// kilocode_change - Reject absolute paths
			if (filePath && filePath.startsWith("/")) {
				return { result: `❌ Use relative paths only! Your working folder is: ${workingFolder}\nTry: write_file("src/App.js", content)`, filesCreated: 0 }
			}
			
			// kilocode_change - Use workingFolder (task's directory) for file operations
			const fullPath = path.join(workingFolder, filePath)
			
			// Security: ensure path is within working folder
			if (!fullPath.startsWith(workingFolder)) {
				return { result: `❌ Error: Cannot write files outside your working directory`, filesCreated: 0 }
			}
			
			try {
				// Create directory if needed
				const dir = path.dirname(fullPath)
				if (!fs.existsSync(dir)) {
					fs.mkdirSync(dir, { recursive: true })
				}
				fs.writeFileSync(fullPath, content, "utf-8")
				log.info(`[Worker ${agentConfig.name}] Wrote file: ${fullPath} (${content.length} bytes)`)
				
				// kilocode_change - Calculate path relative to projects dir for file explorer
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
				
				return { result: `✅ Wrote ${relativeToProjects} (${content.length} bytes)`, filesCreated: 0 }
			} catch (err: any) {
				return { result: `❌ Error writing file: ${err.message}`, filesCreated: 0 }
			}
		}

		// kilocode_change start - patch_file for targeted edits
		case "patch_file": {
			const { path: filePath, old_text, new_text } = toolInput as { path: string; old_text: string; new_text: string }
			// kilocode_change - Use workingFolder for file operations
			const fullPath = path.join(workingFolder, filePath)
			
			// Security: ensure path is within working folder
			if (!fullPath.startsWith(workingFolder)) {
				return { result: `❌ Error: Cannot edit files outside your working directory`, filesCreated: 0 }
			}
			
			try {
				if (!fs.existsSync(fullPath)) {
					return { result: `❌ File not found: ${filePath}`, filesCreated: 0 }
				}
				
				const content = fs.readFileSync(fullPath, "utf-8")
				
				if (!content.includes(old_text)) {
					// Show snippet of file to help agent find correct text
					const snippet = content.substring(0, 500)
					return { result: `❌ Could not find the exact text to replace.\n\nFile starts with:\n\`\`\`\n${snippet}\n\`\`\`\n\nMake sure old_text matches EXACTLY including whitespace.`, filesCreated: 0 }
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
		// kilocode_change end

		case "list_files": {
			const { path: dirPath } = toolInput as { path: string }
			
			// kilocode_change start - Reject absolute paths (agent confusion prevention)
			if (dirPath && dirPath.startsWith("/")) {
				return { result: `❌ Use relative paths only! Your working folder is: ${workingFolder}\nTry: list_files(".")  or  list_files("src")`, filesCreated: 0 }
			}
			// kilocode_change end
			
			// kilocode_change - Use workingFolder for file operations
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
				// kilocode_change - Filter out noise directories
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

			// kilocode_change - Use workingFolder for commands
			log.info(`[Worker ${agentConfig.name}] Running: ${command} (cwd: ${workingFolder}, bg: ${background || false})`)

			io.emit("system-event", {
				type: "command-start",
				agentId: agentConfig.id,
				projectId: project.id,
				message: `Running: ${command}`,
				command,
				cwd: workingFolder,
				background: background || false,
				timestamp: Date.now(),
			})

	if (background) {
		const { exec } = await import("child_process")
		const logFile = `/tmp/worker-${agentConfig.id}-${Date.now()}.log`
		const bgCommand = `nohup ${command} > ${logFile} 2>&1 & echo $!`

		const cleanEnv = { ...process.env }
		delete cleanEnv.PORT

		return new Promise((resolve) => {
			exec(bgCommand, { cwd: workingFolder, shell: "/bin/bash", env: cleanEnv }, (err, stdout) => {
				const pid = stdout.trim()

				io.emit("system-event", {
					type: "command-background",
					agentId: agentConfig.id,
					projectId: project.id,
					message: `Background: ${command} (PID: ${pid})`,
					command,
					pid,
					logFile,
					timestamp: Date.now(),
				})

				if (err) {
					resolve({ result: `Failed to start: ${err.message}`, filesCreated: 0 })
					return
				}

				// Wait 3 seconds and check status
				setTimeout(async () => {
					try {
						const { execSync } = await import("child_process")
						let isRunning = false
						try {
							execSync(`kill -0 ${pid} 2>/dev/null`)
							isRunning = true
						} catch {
							isRunning = false
						}

						let logContent = ""
						try {
							logContent = fs.readFileSync(logFile, "utf-8")
							if (logContent.length > 3000) {
								logContent = logContent.substring(0, 3000) + "\n...(truncated)"
							}
						} catch {
							logContent = "(no output yet)"
						}

						if (isRunning) {
							resolve({
								result: `✅ Background process running!\nPID: ${pid}\nLog: ${logFile}\n\nOutput:\n${logContent || "(no output yet)"}`,
								filesCreated: 0,
							})
						} else {
							resolve({
								result: `❌ Process failed (exited immediately)!\n\nOutput/Error:\n${logContent || "(no output)"}`,
								filesCreated: 0,
							})
						}
					} catch (checkErr: any) {
						resolve({
							result: `✅ Started (PID: ${pid})\nLog: ${logFile}\n(Could not verify: ${checkErr.message})`,
							filesCreated: 0,
						})
					}
				}, 3000)
			})
		})
	}

	// Foreground execution with real-time streaming
	// kilocode_change start - Use spawn instead of execSync to stream output
	const { spawn } = await import("child_process")
	const timeout = timeout_ms || 300000 // 5 minutes default

	return new Promise<{ result: string; filesCreated: number }>((resolve) => {
		let output = ""
		let lastEmitTime = 0
		const EMIT_INTERVAL = 500 // Emit every 500ms at most
		
		// Emit command starting
		io.emit("agent-message", {
			agentId: agentConfig.id,
			agentName: agentConfig.name,
			projectId: project.id,
			message: `\n⏳ *Running: ${command}*\n\`\`\`\n`,
			timestamp: Date.now(),
			isStreaming: true,
		})

		const child = spawn("bash", ["-c", command], {
			cwd: workingFolder, // kilocode_change - Use workingFolder for commands
			env: { ...process.env, FORCE_COLOR: "0" },
		})

		const streamOutput = (data: Buffer) => {
			const text = data.toString()
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

		const timeoutId = setTimeout(() => {
			child.kill("SIGTERM")
			resolve({ result: `❌ Command timed out after ${timeout / 1000}s.\n\nPartial output:\n${output.substring(0, 4000)}`, filesCreated: 0 })
		}, timeout)

		child.on("close", (code) => {
			clearTimeout(timeoutId)
			
			// Close the code block in UI
			io.emit("agent-message", {
				agentId: agentConfig.id,
				agentName: agentConfig.name,
				projectId: project.id,
				message: `\n\`\`\`\n`,
				timestamp: Date.now(),
				isStreaming: true,
			})

			const truncated = output.length > 6000
				? output.substring(0, 6000) + "\n...(truncated)"
				: output

			io.emit("system-event", {
				type: code === 0 ? "command-complete" : "command-error",
				agentId: agentConfig.id,
				projectId: project.id,
				message: `${code === 0 ? "Completed" : "Failed"}: ${command}`,
				exitCode: code || 0,
				timestamp: Date.now(),
			})

			if (code === 0) {
				resolve({ result: `✅ Command completed.\n\nOutput:\n${truncated || "(no output)"}`, filesCreated: 0 })
			} else {
				resolve({ result: `❌ Command failed (exit ${code}).\n\nOutput:\n${truncated || "(no output)"}`, filesCreated: 0 })
			}
		})

		child.on("error", (err) => {
			clearTimeout(timeoutId)
			resolve({ result: `❌ Command error: ${err.message}`, filesCreated: 0 })
		})
	})
	// kilocode_change end
}

	// kilocode_change start - Inter-agent communication tools
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

			log.info(`[Worker ${agentConfig.name}] Asking ${targetAgent.name}: ${question.substring(0, 80)}...`)
			
			io.emit("agent-message", {
				agentId: agentConfig.id,
				agentName: agentConfig.name,
				projectId: project.id,
				message: `\n💬 **Asking ${targetAgent.name}:** ${question}\n`,
				timestamp: Date.now(),
				isStreaming: true,
			})

			try {
				// kilocode_change start - use createOneShot for inter-agent communication
				const targetFolder = projectStore.agentHomeDir(project.id, targetAgent.id)
				
				const response = await createOneShot(
					`You are ${targetAgent.name}, role: ${targetAgent.role}. 
Your folder is: ${targetFolder}
Another agent (${agentConfig.name}) is asking you a question. Answer briefly and helpfully.
If you don't know, say so. Be concise.`,
					`[Question from ${agentConfig.name}]: ${question}`,
					undefined, // use current provider config
					1024
				)
				// kilocode_change end

				// Track usage
				if (response.usage) {
					usageTracker.record({
						projectId: project.id,
						agentId: targetAgent.id,
						agentName: targetAgent.name,
						model: currentProviderConfig?.model || "unknown",
						inputTokens: response.usage.inputTokens,
						outputTokens: response.usage.outputTokens,
					})
				}

				const answer = response.text || '(no response)'
				
				io.emit("agent-message", {
					agentId: agentConfig.id,
					agentName: agentConfig.name,
					projectId: project.id,
					message: `\n💬 **${targetAgent.name} replied:** ${answer}\n`,
					timestamp: Date.now(),
					isStreaming: true,
				})

				return { result: `📨 **Response from ${targetAgent.name}:**\n${answer}`, filesCreated: 0 }
			} catch (err: any) {
				log.error(`[Worker ${agentConfig.name}] ask_agent failed:`, err)
				return { result: `❌ Failed to reach ${targetAgent.name}: ${err.message}`, filesCreated: 0 }
			}
		}

		case "list_agents": {
			const agents = project.agents.map(a => {
				const isSelf = a.id === agentConfig.id
				return `- **${a.name}** (${a.id})${isSelf ? ' ← you' : ''}\n  Role: ${a.role}`
			}).join('\n')
			return { result: `📋 **Agents in project "${project.name}":**\n${agents}`, filesCreated: 0 }
		}
		// kilocode_change end

		// kilocode_change start - Allow workers to READ from project (other agents' folders)
		case "read_project_file": {
			const { path: filePath } = toolInput as { path: string }
			const workspacePath = process.env.WORKSPACE_PATH || process.cwd()
			const projectDir = path.join(workspacePath, "projects", project.folder || project.id)
			const fullPath = path.join(projectDir, filePath)
			
			// Security: ensure path is within project folder
			if (!fullPath.startsWith(projectDir)) {
				return { result: `❌ Error: Cannot read files outside the project`, filesCreated: 0 }
			}
			
			try {
				if (!fs.existsSync(fullPath)) {
					return { result: `❌ File not found: ${filePath}`, filesCreated: 0 }
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
			const { path: dirPath } = toolInput as { path: string }
			const workspacePath = process.env.WORKSPACE_PATH || process.cwd()
			const projectDir = path.join(workspacePath, "projects", project.folder || project.id)
			const fullPath = path.join(projectDir, dirPath || ".")
			
			// Security: ensure path is within project folder
			if (!fullPath.startsWith(projectDir)) {
				return { result: `❌ Error: Cannot list files outside the project`, filesCreated: 0 }
			}
			
			try {
				if (!fs.existsSync(fullPath)) {
					return { result: `❌ Directory not found: ${dirPath}`, filesCreated: 0 }
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
				return { result: `📂 **Project: ${dirPath || "."}** (READ ONLY):\n${listing || "(empty)"}`, filesCreated: 0 }
			} catch (err: any) {
				return { result: `❌ Error listing directory: ${err.message}`, filesCreated: 0 }
			}
		}
		// kilocode_change end

		// kilocode_change start - Additional development tools implementations
		case "search_in_files": {
			const { pattern, path: searchPath, file_pattern } = toolInput as { pattern: string; path?: string; file_pattern?: string }
			const { execSync } = await import("child_process")
			
			let searchDir = agentFolder
			if (searchPath?.startsWith("project:")) {
				const workspacePath = process.env.WORKSPACE_PATH || process.cwd()
				searchDir = path.join(workspacePath, "projects", project.folder || project.id)
			} else if (searchPath) {
				searchDir = path.join(agentFolder, searchPath)
			}
			
			try {
				const fileGlob = file_pattern || "*"
				// kilocode_change - Exclude node_modules, .git, dist, build, coverage from search
				const excludeDirs = "--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build --exclude-dir=coverage --exclude-dir=.next --exclude-dir=.cache"
				const cmd = `grep -rn ${excludeDirs} --include="${fileGlob}" "${pattern}" . 2>/dev/null | head -50`
				const output = execSync(cmd, { cwd: searchDir, encoding: "utf-8", timeout: 30000 })
				return { result: output ? `🔍 **Search results for "${pattern}":**\n\`\`\`\n${output}\n\`\`\`` : `🔍 No matches found for "${pattern}"`, filesCreated: 0 }
			} catch (err: any) {
				if (err.status === 1) return { result: `🔍 No matches found for "${pattern}"`, filesCreated: 0 }
				return { result: `❌ Search error: ${err.message}`, filesCreated: 0 }
			}
		}

		// kilocode_change start - find_files tool (excludes node_modules etc)
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
		// kilocode_change end

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
				return { result: `❌ Request failed: ${err.message}`, filesCreated: 0 }
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
				// kilocode_change - Use workingFolder for git commands
				const diff = execSync(`git diff ${stagedFlag}${file} 2>/dev/null | head -100`, { cwd: workingFolder, encoding: "utf-8" })
				return { result: diff ? `📝 **Git Diff${filePath ? ` (${filePath})` : ""}:**\n\`\`\`diff\n${diff}\n\`\`\`` : `(no changes)`, filesCreated: 0 }
			} catch (err: any) {
				return { result: `❌ Git error: ${err.message}`, filesCreated: 0 }
			}
		}

		case "get_processes": {
			const { filter, port } = toolInput as { filter?: string; port?: number }
			const { execSync } = await import("child_process")
			
			try {
				let cmd = "ps aux"
				if (port) {
					cmd = `lsof -i :${port} 2>/dev/null || echo "Nothing on port ${port}"`
				} else if (filter) {
					cmd = `ps aux | grep -i "${filter}" | grep -v grep | head -20`
				} else {
					cmd = "ps aux | head -20"
				}
				const output = execSync(cmd, { encoding: "utf-8", timeout: 5000 })
				return { result: `🔄 **Processes:**\n\`\`\`\n${output}\n\`\`\``, filesCreated: 0 }
			} catch (err: any) {
				return { result: `❌ Error: ${err.message}`, filesCreated: 0 }
			}
		}

		case "kill_process": {
			const { pid, port, name } = toolInput as { pid?: number; port?: number; name?: string }
			const { execSync } = await import("child_process")
			
			try {
				if (pid) {
					execSync(`kill ${pid}`, { encoding: "utf-8" })
					return { result: `✅ Killed process ${pid}`, filesCreated: 0 }
				} else if (port) {
					const output = execSync(`lsof -ti :${port} | xargs kill 2>/dev/null && echo "Killed process on port ${port}" || echo "Nothing on port ${port}"`, { encoding: "utf-8" })
					return { result: output.trim(), filesCreated: 0 }
				} else if (name) {
					const output = execSync(`pkill -f "${name}" && echo "Killed processes matching ${name}" || echo "No process found matching ${name}"`, { encoding: "utf-8" })
					return { result: output.trim(), filesCreated: 0 }
				} else {
					return { result: `❌ Specify pid, port, or name`, filesCreated: 0 }
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
		// kilocode_change end

		// kilocode_change start - Worker send_message (async to inbox)
		case "send_message": {
			const { agent_id, message, priority } = toolInput as { agent_id: string; message: string; priority?: string }
			const targetAgent = project.agents.find(a => a.id === agent_id)

			if (!targetAgent) {
				return { result: `❌ Agent "${agent_id}" not found. Use list_agents to see available agents.`, filesCreated: 0 }
			}

			if (targetAgent.id === agentConfig.id) {
				return { result: `❌ You cannot message yourself. Save your own notes with write_file.`, filesCreated: 0 }
			}

			sendToInbox(project.id, { id: agentConfig.id, name: agentConfig.name }, agent_id, message, (priority as "normal" | "urgent") || "normal")

			io.emit("agent-message", {
				agentId: agentConfig.id,
				agentName: agentConfig.name,
				projectId: project.id,
				message: `\n📨 **Message sent to ${targetAgent.name}** ${priority === "urgent" ? "⚠️ URGENT" : ""}\n`,
				timestamp: Date.now(),
				isStreaming: true,
			})

			return { result: `✅ Message sent to ${targetAgent.name}'s inbox${priority === "urgent" ? " (URGENT)" : ""}.`, filesCreated: 0 }
		}
		// kilocode_change end

		// kilocode_change start - Worker read_inbox
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
		// kilocode_change end

		// kilocode_change start - Worker task pool tools
		case "claim_task": {
			const { task_id } = toolInput as { task_id?: string }
			
			// Check if worker already has a task
			const existingTasks = projectStore.getTasks(project.id)
			const alreadyClaimed = existingTasks.find(t => t.claimedBy === agentConfig.id && ["claimed", "in-progress"].includes(t.status))
			if (alreadyClaimed) {
				return { result: `⚠️ You already have a task: "${alreadyClaimed.title}" (${alreadyClaimed.status})\n\nComplete it first with \`complete_task()\` or \`fail_task()\`.`, filesCreated: 0 }
			}
			
			let task
			if (task_id) {
				task = projectStore.claimTask(project.id, task_id, agentConfig.id)
			} else {
				task = projectStore.claimNextTask(project.id, agentConfig.id)
			}
			
			if (!task) {
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
				taskTitle: task.title,
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
			
			return { result: `✅ **Task completed: ${myTask.title}**\n\n📝 Summary: ${summary}\n📁 Files created: ${(files_created || []).length}\n📝 Files modified: ${(files_modified || []).length}\n\n${agentConfig.ephemeral ? '👋 You will now self-destruct. Goodbye!' : ''}`, filesCreated: 0 }
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
		// kilocode_change end

		default:
			return { result: `Unknown tool: ${toolName}`, filesCreated: 0 }
	}
}

/**
 * Handle worker agent chat with tools.
 */
async function handleWorkerChat(
	userMessage: string,
	agentConfig: ProjectAgentConfig,
	project: Project,
	apiKey: string,
	io: SocketIOServer,
	attachments?: any[], // kilocode_change - added attachments parameter for images
): Promise<{ fullResponse: string }> {
	log.info(`[handleWorkerChat] Called for ${agentConfig.id} with message: ${userMessage.substring(0, 80)}${attachments?.length ? ` + ${attachments.length} attachment(s)` : ''}`)
	
	// kilocode_change start - Activity log: task received
	activityLogger.log({
		projectId: project.id,
		agentId: agentConfig.id,
		agentName: agentConfig.name,
		type: "task_received",
		summary: `Received task: ${userMessage.substring(0, 100)}${userMessage.length > 100 ? "..." : ""}`,
		details: { messageLength: userMessage.length },
	})
	// kilocode_change end

	// kilocode_change start - use provider config for model and API key
	// Priority: 1) Standalone settings 2) ProviderSettings 3) Legacy config 4) Environment
	let anthropic: Anthropic | null = null
	let openRouterClient: OpenAI | null = null  // kilocode_change - OpenRouter support
	let model: string
	let useOpenRouter = false  // kilocode_change - flag for OpenRouter

	// kilocode_change start - Check standalone settings FIRST
	if (standaloneSettings.isInitialized() && standaloneSettings.hasApiKey()) {
		const providerConfig = standaloneSettings.getProvider()
		log.info(`[handleWorkerChat] Using standalone settings: ${providerConfig.type}/${providerConfig.model}`)
		
		if (providerConfig.type === "openrouter") {
			useOpenRouter = true
			openRouterClient = new OpenAI({
				baseURL: "https://openrouter.ai/api/v1",
				apiKey: providerConfig.apiKey,
			})
			model = providerConfig.model
		} else if (providerConfig.type === "anthropic" || providerConfig.type === "minimax") {
			anthropic = new Anthropic({
				apiKey: providerConfig.apiKey,
				baseURL: providerConfig.type === "minimax" ? "https://api.minimax.io/anthropic" : undefined,
			})
			model = providerConfig.model
		} else if (providerConfig.type === "openai" || providerConfig.type === "groq" || providerConfig.type === "deepseek" || providerConfig.type === "mistral") {
			// These providers use OpenAI-compatible API
			const { PROVIDER_BASE_URLS } = await import("./settings")
			useOpenRouter = true  // Use OpenAI SDK path
			openRouterClient = new OpenAI({
				baseURL: providerConfig.baseUrl || PROVIDER_BASE_URLS[providerConfig.type],
				apiKey: providerConfig.apiKey,
			})
			model = providerConfig.model
		} else {
			// Fallback to Anthropic SDK
			anthropic = new Anthropic({ apiKey: providerConfig.apiKey })
			model = providerConfig.model
		}
	}
	// kilocode_change end
	else if (currentProviderSettings) {
		const provider = currentProviderSettings.apiProvider
		// kilocode_change start - OpenRouter support
		if (provider === "openrouter") {
			useOpenRouter = true
			openRouterClient = new OpenAI({
				baseURL: "https://openrouter.ai/api/v1",
				apiKey: currentProviderSettings.openRouterApiKey || "not-provided",
			})
			model = currentProviderSettings.openRouterModelId || "anthropic/claude-sonnet-4"
			log.info(`[handleWorkerChat] Using OpenRouter with model: ${model}`)
		}
		// kilocode_change end
		// Tool calling requires Anthropic-compatible API (Anthropic or MiniMax)
		else if (provider === "anthropic" || provider === "minimax") {
			anthropic = new Anthropic({
				apiKey: provider === "anthropic" ? currentProviderSettings.apiKey : currentProviderSettings.minimaxApiKey,
				baseURL: provider === "minimax" ? "https://api.minimax.io/anthropic" : undefined,
			})
			model = currentProviderSettings.apiModelId || "claude-sonnet-4-20250514"
		} else {
			// Other providers - try OpenRouter as fallback if key available
			if (currentProviderSettings.openRouterApiKey) {
				useOpenRouter = true
				openRouterClient = new OpenAI({
					baseURL: "https://openrouter.ai/api/v1",
					apiKey: currentProviderSettings.openRouterApiKey,
				})
				model = currentProviderSettings.openRouterModelId || "anthropic/claude-sonnet-4"
				log.info(`[handleWorkerChat] Fallback to OpenRouter with model: ${model}`)
			} else {
				// Last resort - use Anthropic
				anthropic = new Anthropic({ apiKey: apiKey })
				model = "claude-sonnet-4-20250514"
			}
		}
	} else {
		// Legacy provider config
		const providerConfig = currentProviderConfig || loadProviderConfig(process.env.WORKSPACE_PATH || process.cwd())
		// kilocode_change start - OpenRouter legacy support
		if (providerConfig.provider === "openrouter" && providerConfig.apiKey) {
			useOpenRouter = true
			openRouterClient = new OpenAI({
				baseURL: "https://openrouter.ai/api/v1",
				apiKey: providerConfig.apiKey,
			})
			model = providerConfig.model || "anthropic/claude-sonnet-4"
		}
		// kilocode_change end
		// Tool calling requires Anthropic-compatible API (Anthropic or MiniMax)
		else if (providerConfig.provider === "anthropic" || providerConfig.provider === "minimax") {
			anthropic = new Anthropic({
				apiKey: providerConfig.apiKey,
				baseURL: providerConfig.provider === "minimax" ? "https://api.minimax.io/anthropic" : undefined,
			})
			model = providerConfig.model || "claude-sonnet-4-20250514"
		} else {
			anthropic = new Anthropic({ apiKey: apiKey }) // fallback to env ANTHROPIC_API_KEY
			model = "claude-sonnet-4-20250514"
		}
	}
	// kilocode_change end
	const agent = getOrCreateProjectAgent(agentConfig, project, apiKey)

	// kilocode_change - Use proper homeFolder from config
	const agentFolder = projectStore.agentHomeDir(project.id, agentConfig.id)
	
	// kilocode_change start - Build folder context for persistent memory
	let folderContext = ""
	try {
		// Check what exists in folder
		if (fs.existsSync(agentFolder)) {
			const files = fs.readdirSync(agentFolder)
			const fileList = files.filter(f => !f.startsWith('.') && f !== 'node_modules').slice(0, 20)
			folderContext += `\n\n## YOUR FOLDER CONTENTS\nFiles in ${agentFolder}:\n${fileList.map(f => `- ${f}`).join('\n')}`
			
			// Check package.json for project type
			const pkgPath = path.join(agentFolder, 'package.json')
			if (fs.existsSync(pkgPath)) {
				try {
					const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
					folderContext += `\n\nProject: ${pkg.name || 'unknown'}`
					if (pkg.scripts) {
						folderContext += `\nAvailable scripts: ${Object.keys(pkg.scripts).join(', ')}`
					}
					if (pkg.dependencies) {
						const deps = Object.keys(pkg.dependencies).slice(0, 10)
						folderContext += `\nDependencies: ${deps.join(', ')}`
					}
				} catch (e) { /* ignore parse errors */ }
			}
			
			// Check for server.js
			if (fs.existsSync(path.join(agentFolder, 'server.js'))) {
				folderContext += `\n\nYou have a server.js file - this is likely your Express server.`
			}
			
			// Check for src/ folder (React)
			if (fs.existsSync(path.join(agentFolder, 'src'))) {
				folderContext += `\nYou have a src/ folder - this is likely a React frontend.`
			}
		} else {
			folderContext += `\n\n## YOUR FOLDER\nYour folder does not exist yet. Create it by creating files.`
		}
	} catch (e) {
		log.warn(`[handleWorkerChat] Error reading folder context: ${e}`)
	}
	// kilocode_change end
	
	const systemPrompt = `${agentConfig.systemPrompt || `You are ${agentConfig.name}, a worker agent.`}

You are working in project "${project.name}".
Your working folder is: ${agentFolder}
${folderContext}

## YOUR TOOLS

You have these tools - **USE THEM**, don't output code blocks!

### 1. run_command
Execute shell commands in your folder.
- \`run_command(command="npm start", background=true)\` - start server
- \`run_command(command="ls -la")\` - list files
- \`run_command(command="npm install")\` - install deps

### 2. read_file
Read files from your folder.
- \`read_file(path="AGENTS.md")\` - READ THIS FIRST! Your knowledge base
- \`read_file(path="package.json")\` - read config

### 3. write_file  
Create NEW files or COMPLETELY REWRITE files in your folder.
- \`write_file(path="AGENTS.md", content="...")\` - update your knowledge
- \`write_file(path="src/App.js", content="...")\` - create code

### 4. patch_file (PREFERRED FOR EDITS!)
Make TARGETED edits to existing files - much more efficient!
- \`patch_file(path="src/App.js", old_text="old code here", new_text="new code here")\`
- Only replaces the specific text you specify
- Include enough context in old_text to be unique
- USE THIS instead of rewriting entire files!

### 5. list_files
List files in a directory.
- \`list_files(path=".")\` - list your folder
- \`list_files(path="src")\` - list src folder

### 6. ask_agent (IMPORTANT!)
Ask questions to other agents in your project, including the supervisor/architect.
- \`ask_agent(agent_id="architect", question="What port should I use?")\` - ask supervisor
- \`ask_agent(agent_id="agent1", question="What's your API endpoint?")\` - ask another worker
Use this to coordinate, get requirements, or resolve conflicts!

### 7. list_agents
See all agents you can communicate with.
- \`list_agents()\` - shows all agents and their roles

## AGENTS.md - KNOWLEDGE INDEX (LAZY LOADING!)

**AGENTS.md is your INDEX for LAZY LOADING knowledge.**

### The Pattern:
1. **Read AGENTS.md FIRST** - It's your index/table of contents
2. **Check what files exist** - The index tells you what knowledge is available
3. **Only load what you NEED** - Read specific files relevant to current task
4. **Don't read everything** - That's wasteful! Use the index to decide.

### At the START of a task:
\`\`\`
1. read_file("AGENTS.md")     # Read the INDEX
2. Check "Knowledge Files Index" table
3. Identify which files are relevant to THIS task
4. read_file("RELEVANT_FILE.md")  # Only load what you need
\`\`\`

### Example - Task: "Fix the API endpoint"
\`\`\`
1. Read AGENTS.md (index)
2. See: API.md exists → "Endpoints, contracts" → RELEVANT!
3. See: ARCHITECTURE.md exists → Maybe relevant
4. See: TROUBLESHOOTING.md exists → Check if similar issue
5. Read only: API.md, maybe TROUBLESHOOTING.md
6. DON'T read: PROCEDURES.md, DEPENDENCIES.md (not relevant)
\`\`\`

### After COMPLETING work - Update the INDEX:
1. Update \`Current State\` in AGENTS.md
2. Update \`Recent Activity\` log
3. If you created/modified knowledge:
   - Create/update the detailed .md file
   - Update the \`Knowledge Files Index\` table in AGENTS.md
   - Add to \`Objects & Entities Registry\` if new objects

### Standard Knowledge Files:
| File | Purpose | Create When |
|------|---------|-------------|
| \`STATE.md\` | Detailed state tracking | Complex state to track |
| \`ARCHITECTURE.md\` | System design | Building structure |
| \`API.md\` | Endpoints, schemas | Working with APIs |
| \`PROCEDURES.md\` | Workflows | Repeatable processes |
| \`TROUBLESHOOTING.md\` | Issues & fixes | Solving problems |

## RULES
- ALWAYS read AGENTS.md (index) FIRST!
- LAZY LOAD: Only read files you NEED for the current task
- Keep index updated when you create/modify files
- NEVER output bash code blocks - USE the tools!
- For servers use background=true
- NEVER use \`pkill -f node\` - kills everything!

## IMPORTANT: COMPLETE YOUR TASKS FULLY

### Before writing code or tests:
1. **READ the actual source code first** using read_project_file
2. Understand what components/functions ACTUALLY exist
3. Never assume - verify by reading

### When tests or commands fail:
1. **Read the error carefully**
2. **Diagnose the cause** - wrong file path? missing component? typo?
3. **Fix the issue** - edit your files to correct the mistake
4. **Re-run** to verify the fix worked
5. **Don't stop until it works** or you've explained why it can't

### Testing best practices:
1. Use list_project_files to see what exists
2. Use read_project_file to read actual code BEFORE writing tests
3. Match test imports to REAL file paths and component names
4. If a test fails, fix it immediately - don't leave broken tests`

	// kilocode_change start - Build content with attachments (images)
	let messageContent: string | Anthropic.ContentBlockParam[]
	if (attachments && attachments.length > 0) {
		// Build content blocks with images
		const contentBlocks: Anthropic.ContentBlockParam[] = []
		
		// Add images first - handle both frontend format (source.data) and raw format (base64)
		// NOTE: Frontend resizeImage() always converts to JPEG, so we hardcode image/jpeg
		for (const att of attachments) {
			// Frontend sends: { type: 'image', source: { type: 'base64', media_type: ..., data: ... } }
			if (att.type === 'image' && att.source?.data) {
				contentBlocks.push({
					type: "image",
					source: {
						type: "base64",
						media_type: 'image/jpeg', // Always JPEG - frontend resizes to JPEG
						data: att.source.data,
					}
				})
				log.info(`[handleWorkerChat] Added image block (source format)`)
			}
			// Raw format: { type: 'image/png', base64: '...' }
			else if (att.type?.startsWith('image/') && att.base64) {
				contentBlocks.push({
					type: "image",
					source: {
						type: "base64",
						media_type: 'image/jpeg', // Always JPEG - frontend resizes to JPEG
						data: att.base64,
					}
				})
				log.info(`[handleWorkerChat] Added image block (raw format)`)
			}
		}
		
		// Add text message
		if (userMessage) {
			contentBlocks.push({ type: "text", text: userMessage })
		}
		
		messageContent = contentBlocks.length > 0 ? contentBlocks : userMessage
		log.info(`[handleWorkerChat] Built ${contentBlocks.length} content blocks from ${attachments.length} attachments`)
	} else {
		messageContent = userMessage
	}
	// kilocode_change end

	await (agent as any).addMessage("user", messageContent)
	const history = agent.getHistory()
	const messages: Anthropic.MessageParam[] = history.map((m: any) => ({
		role: m.role as "user" | "assistant",
		content: m.content,
	}))

	let fullResponse = ""
	const maxIterations = 15 // kilocode_change - Increased from 5 to allow auto-continue

	log.info(`[handleWorkerChat] Starting loop with model ${model}, ${messages.length} messages, ${WORKER_TOOLS.length} tools, useOpenRouter=${useOpenRouter}`)

	// kilocode_change start - OpenRouter uses OpenAI SDK, need to convert tools
	const openAiTools: OpenAI.Chat.ChatCompletionTool[] = useOpenRouter ? WORKER_TOOLS.map((t) => ({
		type: "function" as const,
		function: {
			name: t.name,
			description: t.description || "",
			parameters: t.input_schema as Record<string, unknown>,
		},
	})) : []
	// kilocode_change end

	for (let iteration = 0; iteration < maxIterations; iteration++) {
		log.info(`[handleWorkerChat] Iteration ${iteration + 1}`)
		
		// kilocode_change start - Check if agent was stopped
		if (stoppedAgents.has(agentConfig.id)) {
			log.info(`[Worker] ${agentConfig.name} was stopped by user`)
			stoppedAgents.delete(agentConfig.id) // Clean up
			io.emit("agent-message", {
				agentId: agentConfig.id,
				agentName: agentConfig.name,
				projectId: project.id,
				message: "\n⛔ **Stopped by user**\n",
				timestamp: Date.now(),
				isStreaming: false,
				isDone: true,
			})
			break
		}
		// kilocode_change end
		
		// kilocode_change start - OpenRouter branch using OpenAI SDK
		if (useOpenRouter && openRouterClient) {
			// Convert Anthropic messages to OpenAI format
			const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
				{ role: "system", content: systemPrompt },
				...messages.map((m): OpenAI.Chat.ChatCompletionMessageParam => {
					if (m.role === "user") {
						// Handle tool results
						if (Array.isArray(m.content) && m.content.length > 0 && (m.content[0] as any).type === "tool_result") {
							// Return tool results as separate messages
							return {
								role: "tool" as const,
								tool_call_id: (m.content[0] as any).tool_use_id,
								content: typeof (m.content[0] as any).content === "string" 
									? (m.content[0] as any).content 
									: JSON.stringify((m.content[0] as any).content),
							}
						}
						// Regular user message
						return {
							role: "user" as const,
							content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
						}
					} else {
						// Assistant message - might have tool calls
						const assistantMsg: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
							role: "assistant" as const,
							content: "",
						}
						if (Array.isArray(m.content)) {
							const textParts: string[] = []
							const toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = []
							for (const block of m.content) {
								if ((block as any).type === "text") {
									textParts.push((block as any).text)
								} else if ((block as any).type === "tool_use") {
									toolCalls.push({
										id: (block as any).id,
										type: "function" as const,
										function: {
											name: (block as any).name,
											arguments: JSON.stringify((block as any).input),
										},
									})
								}
							}
							assistantMsg.content = textParts.join("")
							if (toolCalls.length > 0) {
								assistantMsg.tool_calls = toolCalls
							}
						} else {
							assistantMsg.content = typeof m.content === "string" ? m.content : ""
						}
						return assistantMsg
					}
				}),
			]
			
			// Filter out invalid messages (tool results need special handling)
			const validMessages = openAiMessages.filter((m, i) => {
				if (m.role === "tool") {
					// Check if previous message has matching tool call
					const prev = openAiMessages[i - 1]
					return prev?.role === "assistant" && (prev as any).tool_calls?.some((tc: any) => tc.id === (m as any).tool_call_id)
				}
				return true
			})
			
			const completion = await openRouterClient.chat.completions.create({
				model,
				max_tokens: 16384,
				messages: validMessages,
				tools: openAiTools,
			})
			
			const choice = completion.choices[0]
			const textContent = choice?.message?.content || ""
			
			// Track usage
			if (completion.usage) {
				usageTracker.record({
					projectId: project.id,
					agentId: agentConfig.id,
					agentName: agentConfig.name,
					model,
					inputTokens: completion.usage.prompt_tokens || 0,
					outputTokens: completion.usage.completion_tokens || 0,
				})
			}
			
			// Emit text to UI
			if (textContent) {
				io.emit("agent-message", {
					agentId: agentConfig.id,
					agentName: agentConfig.name,
					projectId: project.id,
					message: textContent,
					timestamp: Date.now(),
					isStreaming: true,
				})
				fullResponse += textContent
			}
			
			// Check for tool calls
			const toolCalls = choice?.message?.tool_calls || []
			
			if (toolCalls.length === 0) {
				if (choice?.finish_reason === "stop") {
					break
				} else if (choice?.finish_reason === "length") {
					log.info(`[handleWorkerChat] OpenRouter hit length limit, auto-continuing`)
					messages.push({ 
						role: "assistant", 
						content: textContent || "" 
					})
					messages.push({ role: "user", content: "Continue from where you left off." })
					continue
				} else {
					break
				}
			}
			
			// Build assistant message with tool calls for history
			const assistantContent: any[] = []
			if (textContent) {
				assistantContent.push({ type: "text", text: textContent })
			}
			for (const tc of toolCalls) {
				const toolCall = tc as any
				assistantContent.push({
					type: "tool_use",
					id: toolCall.id,
					name: toolCall.function.name,
					input: JSON.parse(toolCall.function.arguments || "{}"),
				})
			}
			messages.push({ role: "assistant", content: assistantContent })
			
			// Execute tool calls
			const toolResults: Anthropic.ToolResultBlockParam[] = []
			for (const tc of toolCalls) {
				const toolCall = tc as any
				const toolName = toolCall.function.name
				const toolInput = JSON.parse(toolCall.function.arguments || "{}")
				
				// kilocode_change start - Show detailed tool info for ALL tools
				let toolDisplay = `🔧 **${toolName}**`
				if (toolName === "run_command" && toolInput.command) {
					toolDisplay += `\n\`\`\`bash\n${toolInput.command}\n\`\`\``
					if (toolInput.background) toolDisplay += `\n⚡ Background mode`
				} else if (toolName === "write_file" && toolInput.path) {
					toolDisplay += ` → \`${toolInput.path}\` (${toolInput.content?.length || 0} bytes)`
				} else if (toolName === "read_file" && toolInput.path) {
					toolDisplay += ` → \`${toolInput.path}\``
				} else if (toolName === "list_files") {
					toolDisplay += ` → \`${toolInput.path || '.'}\``
				} else if (toolName === "patch_file" && toolInput.path) {
					toolDisplay += ` → \`${toolInput.path}\``
				} else if (toolName === "read_project_file" && toolInput.path) {
					toolDisplay += ` → \`${toolInput.path}\``
				} else if (toolName === "find_files" && toolInput.pattern) {
					toolDisplay += ` → "${toolInput.pattern}"`
				} else if (toolName === "search_files" && toolInput.query) {
					toolDisplay += ` → "${toolInput.query}"`
				}
				// kilocode_change end
				
				io.emit("agent-message", {
					agentId: agentConfig.id,
					agentName: agentConfig.name,
					projectId: project.id,
					message: `\n${toolDisplay}\n`,
					timestamp: Date.now(),
					isStreaming: true,
				})

				const { result } = await executeAgentTool(toolName, toolInput, agentConfig, project, io)

				activityLogger.log({
					projectId: project.id,
					agentId: agentConfig.id,
					agentName: agentConfig.name,
					type: "tool_used",
					summary: `Used ${toolName}: ${result.substring(0, 80)}${result.length > 80 ? "..." : ""}`,
					details: { tool: toolName, input: toolInput, resultLength: result.length },
				})

				let resultDisplay = result
				if (resultDisplay.length > 2000) {
					resultDisplay = resultDisplay.substring(0, 2000) + "\n...(truncated)"
				}
				
				io.emit("agent-message", {
					agentId: agentConfig.id,
					agentName: agentConfig.name,
					projectId: project.id,
					message: `\n📤 **Result:**\n\`\`\`\n${resultDisplay}\n\`\`\`\n`,
					timestamp: Date.now(),
					isStreaming: true,
				})

				toolResults.push({
					type: "tool_result",
					tool_use_id: tc.id,
					content: result,
				})
			}
			
			messages.push({ role: "user", content: toolResults })
			continue
		}
		// kilocode_change end - OpenRouter branch
		
		// Original Anthropic SDK path
		if (!anthropic) {
			throw new Error("No API client configured")
		}
		const stream = await anthropic.messages.stream({
			model,
			max_tokens: 16384, // kilocode_change - Increased from 4096 for longer tasks
			system: systemPrompt,
			messages,
			tools: WORKER_TOOLS,
		})

		let textContent = ""
		const finalMessage = await stream.finalMessage()

		// kilocode_change start - Track token usage
		if (finalMessage.usage) {
			usageTracker.record({
				projectId: project.id,
				agentId: agentConfig.id,
				agentName: agentConfig.name,
				model,
				inputTokens: finalMessage.usage.input_tokens,
				outputTokens: finalMessage.usage.output_tokens,
			})
		}
		// kilocode_change end

		for (const block of finalMessage.content) {
			if (block.type === "text") {
				textContent += block.text
				io.emit("agent-message", {
					agentId: agentConfig.id,
					agentName: agentConfig.name,
					projectId: project.id,
					message: block.text,
					timestamp: Date.now(),
					isStreaming: true,
				})
			}
		}

		fullResponse += textContent

		const toolBlocks = finalMessage.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")

		// kilocode_change start - Auto-continue on max_tokens, only stop on explicit end_turn
		if (toolBlocks.length === 0) {
			if (finalMessage.stop_reason === "end_turn") {
				// Model explicitly finished - done
				break
			} else if (finalMessage.stop_reason === "max_tokens") {
				// Hit token limit - auto-continue
				log.info(`[handleWorkerChat] Hit max_tokens, auto-continuing (iteration ${iteration + 1})`)
				io.emit("agent-message", {
					agentId: agentConfig.id,
					agentName: agentConfig.name,
					projectId: project.id,
					message: "\n*[Auto-continuing...]*\n",
					timestamp: Date.now(),
					isStreaming: true,
				})
				messages.push({ role: "assistant", content: finalMessage.content })
				messages.push({ role: "user", content: "Continue from where you left off." })
				continue
			} else {
				// Other stop reason (e.g., tool_use without blocks?) - stop to be safe
				break
			}
		}
		// kilocode_change end

		messages.push({ role: "assistant", content: finalMessage.content })

		const toolResults: Anthropic.ToolResultBlockParam[] = []
		for (const toolBlock of toolBlocks) {
			const input = toolBlock.input as Record<string, any>
			
			// kilocode_change start - Show detailed tool info for ALL tools
			let toolDisplay = `🔧 **${toolBlock.name}**`
			if (toolBlock.name === "run_command" && input.command) {
				toolDisplay += `\n\`\`\`bash\n${input.command}\n\`\`\``
				if (input.background) toolDisplay += `\n⚡ Background mode`
			} else if (toolBlock.name === "write_file" && input.path) {
				toolDisplay += ` → \`${input.path}\` (${input.content?.length || 0} bytes)`
			} else if (toolBlock.name === "read_file" && input.path) {
				toolDisplay += ` → \`${input.path}\``
			} else if (toolBlock.name === "list_files") {
				toolDisplay += ` → \`${input.path || '.'}\``
			} else if (toolBlock.name === "patch_file" && input.path) {
				toolDisplay += ` → \`${input.path}\``
			} else if (toolBlock.name === "read_project_file" && input.path) {
				toolDisplay += ` → \`${input.path}\``
			} else if (toolBlock.name === "find_files" && input.pattern) {
				toolDisplay += ` → "${input.pattern}"`
			} else if (toolBlock.name === "search_files" && input.query) {
				toolDisplay += ` → "${input.query}"`
			}
			// kilocode_change end
			
			io.emit("agent-message", {
				agentId: agentConfig.id,
				agentName: agentConfig.name,
				projectId: project.id,
				message: `\n${toolDisplay}\n`,
				timestamp: Date.now(),
				isStreaming: true,
			})

			const { result } = await executeAgentTool(
				toolBlock.name,
				toolBlock.input,
				agentConfig,
				project,
				io,
			)

			// kilocode_change start - Activity log: tool used
			activityLogger.log({
				projectId: project.id,
				agentId: agentConfig.id,
				agentName: agentConfig.name,
				type: "tool_used",
				summary: `Used ${toolBlock.name}: ${result.substring(0, 80)}${result.length > 80 ? "..." : ""}`,
				details: { tool: toolBlock.name, input: toolBlock.input, resultLength: result.length },
			})
			// kilocode_change end

			// Show result in UI
			let resultDisplay = result
			if (resultDisplay.length > 2000) {
				resultDisplay = resultDisplay.substring(0, 2000) + "\n...(truncated)"
			}
			
			io.emit("agent-message", {
				agentId: agentConfig.id,
				agentName: agentConfig.name,
				projectId: project.id,
				message: `\n📤 **Result:**\n\`\`\`\n${resultDisplay}\n\`\`\`\n`,
				timestamp: Date.now(),
				isStreaming: true,
			})

			toolResults.push({
				type: "tool_result",
				tool_use_id: toolBlock.id,
				content: result,
			})
		}

		messages.push({ role: "user", content: toolResults })

		// kilocode_change start - Auto-recovery: detect failures and prompt agent to fix
		const hasError = toolResults.some(tr => {
			const content = typeof tr.content === 'string' ? tr.content : ''
			return content.includes('❌') || 
				   content.includes('Command failed') || 
				   content.includes('Error:') ||
				   content.includes('Cannot find module') ||
				   content.includes('FAIL') ||
				   content.includes('exit 1')
		})
		
		if (hasError) {
			log.info(`[handleWorkerChat] Error detected in tool results, prompting auto-recovery`)
			io.emit("agent-message", {
				agentId: agentConfig.id,
				agentName: agentConfig.name,
				projectId: project.id,
				message: "\n⚠️ *Error detected - analyzing and fixing...*\n",
				timestamp: Date.now(),
				isStreaming: true,
			})
		}
		// kilocode_change end
	}

	io.emit("agent-message", {
		agentId: agentConfig.id,
		agentName: agentConfig.name,
		projectId: project.id,
		message: "",
		timestamp: Date.now(),
		isStreaming: false,
		isDone: true,
	})

	// kilocode_change start - Activity log: task completed
	activityLogger.log({
		projectId: project.id,
		agentId: agentConfig.id,
		agentName: agentConfig.name,
		type: "task_completed",
		summary: `Completed task (${fullResponse.length} chars response)`,
		details: { responseLength: fullResponse.length },
	})
	// kilocode_change end

	await (agent as any).addMessage("assistant", fullResponse)
	return { fullResponse }
}
// kilocode_change end

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
): Promise<{
	fullResponse: string
	delegationResults: Array<{ agentId: string; agentName: string; filesCreated: number; responseLength: number }>
	totalFilesCreated: number
}> {
	// kilocode_change start - Progress indicator at start
	io.emit("agent-message", {
		agentId: supervisorConfig.id,
		agentName: supervisorConfig.name,
		projectId: project.id,
		message: "🤔 **Analyzing your request...**\n",
		timestamp: Date.now(),
		isStreaming: true,
		isProgress: true,
	})
	// kilocode_change end

	// kilocode_change start - use provider config for model and API key
	// Priority: 1) Standalone settings 2) ProviderSettings 3) Legacy config 4) Environment
	let anthropic: Anthropic | null = null
	let openRouterClient: OpenAI | null = null
	let model: string
	let useOpenRouter = false

	// kilocode_change start - Check standalone settings FIRST
	if (standaloneSettings.isInitialized() && standaloneSettings.hasApiKey()) {
		const providerConfig = standaloneSettings.getProvider()
		log.info(`[handleSupervisorChat] Using standalone settings: ${providerConfig.type}/${providerConfig.model}`)
		
		if (providerConfig.type === "openrouter") {
			useOpenRouter = true
			openRouterClient = new OpenAI({
				baseURL: "https://openrouter.ai/api/v1",
				apiKey: providerConfig.apiKey,
			})
			model = providerConfig.model
		} else if (providerConfig.type === "anthropic" || providerConfig.type === "minimax") {
			anthropic = new Anthropic({
				apiKey: providerConfig.apiKey,
				baseURL: providerConfig.type === "minimax" ? "https://api.minimax.io/anthropic" : undefined,
			})
			model = providerConfig.model
		} else if (providerConfig.type === "openai" || providerConfig.type === "groq" || providerConfig.type === "deepseek" || providerConfig.type === "mistral") {
			const { PROVIDER_BASE_URLS } = await import("./settings")
			useOpenRouter = true
			openRouterClient = new OpenAI({
				baseURL: providerConfig.baseUrl || PROVIDER_BASE_URLS[providerConfig.type],
				apiKey: providerConfig.apiKey,
			})
			model = providerConfig.model
		} else {
			anthropic = new Anthropic({ apiKey: providerConfig.apiKey })
			model = providerConfig.model
		}
	}
	// kilocode_change end
	else if (currentProviderSettings) {
		const provider = currentProviderSettings.apiProvider
		// kilocode_change start - Handle OpenRouter in currentProviderSettings
		if (provider === "openrouter") {
			useOpenRouter = true
			openRouterClient = new OpenAI({
				baseURL: "https://openrouter.ai/api/v1",
				apiKey: currentProviderSettings.openRouterApiKey || "not-provided",
			})
			model = supervisorConfig.model || currentProviderSettings.openRouterModelId || "anthropic/claude-sonnet-4"
			log.info(`[handleSupervisorChat] Using OpenRouter: ${model}`)
		}
		// kilocode_change end
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
		// kilocode_change start - Handle OpenRouter in legacy config
		if (providerConfig.provider === "openrouter" && providerConfig.apiKey) {
			useOpenRouter = true
			openRouterClient = new OpenAI({
				baseURL: "https://openrouter.ai/api/v1",
				apiKey: providerConfig.apiKey,
			})
			model = supervisorConfig.model || providerConfig.model || "anthropic/claude-sonnet-4"
		}
		// kilocode_change end
		// Tool calling requires Anthropic-compatible API (Anthropic or MiniMax)
		else if (providerConfig.provider === "anthropic" || providerConfig.provider === "minimax") {
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
	// kilocode_change end
	const agent = getOrCreateProjectAgent(supervisorConfig, project, apiKey)

	// Access the agent's system prompt (private field, accessed via cast)
	const systemPrompt = (agent as any).systemPrompt || supervisorConfig.systemPrompt

	// Add user message to agent history
	await (agent as any).addMessage("user", userMessage)

	// Build messages from agent history
	const history = agent.getHistory()
	const messages: Anthropic.MessageParam[] = history.map((msg: any) => ({
		role: msg.role === "user" ? "user" as const : "assistant" as const,
		content: msg.content,
	}))

	let fullResponse = ""
	const delegationResults: Array<{ agentId: string; agentName: string; filesCreated: number; responseLength: number }> = []
	let totalFilesCreated = 0
	const MAX_TOOL_ITERATIONS = 15 // kilocode_change - Increased from 10 for auto-continue

	for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
		log.info(`[Supervisor] ${supervisorConfig.name} iteration ${iteration + 1}, ${messages.length} messages, useOpenRouter=${useOpenRouter}`)

		// kilocode_change start - Check if agent was stopped
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
			break
		}
		// kilocode_change end

		// kilocode_change start - Progress indicators
		if (iteration > 0) {
			io.emit("agent-message", {
				agentId: supervisorConfig.id,
				agentName: supervisorConfig.name,
				projectId: project.id,
				message: `\n⏳ **Processing step ${iteration + 1}...**\n`,
				timestamp: Date.now(),
				isStreaming: true,
				isProgress: true,
			})
		}
		// kilocode_change end

		// kilocode_change start - OpenRouter path for supervisor
		if (useOpenRouter && openRouterClient) {
			// Convert SUPERVISOR_TOOLS to OpenAI function format
			const openAITools: OpenAI.Chat.ChatCompletionTool[] = SUPERVISOR_TOOLS.map((tool: any) => ({
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

			const completion = await openRouterClient.chat.completions.create({
				model,
				max_tokens: 16384,
				messages: openAIMessages,
				tools: openAITools,
			})

			const choice = completion.choices[0]
			const assistantMsg = choice.message

			// Track usage
			if (completion.usage) {
				usageTracker.record({
					projectId: project.id,
					agentId: supervisorConfig.id,
					agentName: supervisorConfig.name,
					model,
					inputTokens: completion.usage.prompt_tokens,
					outputTokens: completion.usage.completion_tokens,
				})
			}

			// Stream text to UI
			if (assistantMsg.content) {
				fullResponse += assistantMsg.content
				io.emit("agent-message", {
					agentId: supervisorConfig.id,
					agentName: supervisorConfig.name,
					projectId: project.id,
					message: assistantMsg.content,
					timestamp: Date.now(),
					isStreaming: true,
				})
			}

			// Check for tool calls
			if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
				if (choice.finish_reason === "length") {
					log.info(`[Supervisor] OpenRouter hit length limit, auto-continuing`)
					messages.push({ role: "assistant", content: assistantMsg.content || "" })
					messages.push({ role: "user", content: "Continue from where you left off." })
					continue
				}
				break
			}

			// Convert assistant message back to Anthropic format for storage
			const anthropicContent: any[] = []
			if (assistantMsg.content) {
				anthropicContent.push({ type: "text", text: assistantMsg.content })
			}
			for (const tc of assistantMsg.tool_calls) {
				const toolCall = tc as any
				anthropicContent.push({
					type: "tool_use",
					id: toolCall.id,
					name: toolCall.function.name,
					input: JSON.parse(toolCall.function.arguments || "{}"),
				})
			}
			messages.push({ role: "assistant", content: anthropicContent })

			// Execute tools
			const toolResults: { type: "tool_result"; tool_use_id: string; content: string }[] = []
			for (const tc of assistantMsg.tool_calls) {
				const toolCall = tc as any
				const toolName = toolCall.function.name
				const toolInput = JSON.parse(toolCall.function.arguments || "{}")
				log.info(`[Supervisor] OpenRouter Tool call: ${toolName}(${JSON.stringify(toolInput).substring(0, 200)})`)

				// kilocode_change start - Show detailed tool info for ALL tools
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
				// kilocode_change end

				io.emit("agent-message", {
					agentId: supervisorConfig.id,
					agentName: supervisorConfig.name,
					projectId: project.id,
					message: `\n${toolDisplay}\n`,
					timestamp: Date.now(),
					isStreaming: true,
				})

				const { result, filesCreated } = await executeSupervisorTool(
					toolName,
					toolInput,
					project,
					supervisorConfig.id,
					apiKey,
					io,
				)
				totalFilesCreated += filesCreated

				io.emit("agent-message", {
					agentId: supervisorConfig.id,
					agentName: supervisorConfig.name,
					projectId: project.id,
					message: `\n📤 **Result:**\n\`\`\`\n${result.substring(0, 2000)}\n\`\`\`\n`,
					timestamp: Date.now(),
					isStreaming: true,
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
			}

			messages.push({ role: "user", content: toolResults })
			continue
		}
		// kilocode_change end - OpenRouter path

		// Anthropic path
		if (!anthropic) {
			throw new Error("No API client configured - check settings")
		}

		const stream = await anthropic.messages.stream({
			model,
			max_tokens: 16384, // kilocode_change - Increased from 8096 for longer tasks
			system: systemPrompt,
			messages,
			tools: SUPERVISOR_TOOLS,
		})

		// kilocode_change start - TRUE STREAMING: emit text as it arrives
		let textContent = ""
		
		// Stream text chunks in real-time
		stream.on('text', (text) => {
			textContent += text
			fullResponse += text
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
		const finalMessage = await stream.finalMessage()
		// kilocode_change end

		// kilocode_change start - Track token usage for supervisor
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
		// kilocode_change end

		// Note: text was already streamed via stream.on('text') above

		// Check if the LLM wants to use tools
		const toolBlocks = finalMessage.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")

		// kilocode_change start - Auto-continue on max_tokens for supervisor
		if (toolBlocks.length === 0) {
			if (finalMessage.stop_reason === "end_turn") {
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
		// kilocode_change end

		// Add the assistant's message (with tool_use blocks) to conversation
		messages.push({ role: "assistant", content: finalMessage.content })

		// Execute each tool call and build results
		const toolResults: Anthropic.ToolResultBlockParam[] = []
		for (const toolBlock of toolBlocks) {
			log.info(`[Supervisor] Tool call: ${toolBlock.name}(${JSON.stringify(toolBlock.input).substring(0, 200)})`)

			// kilocode_change start - Show detailed tool info for ALL tools
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
			// kilocode_change end

			io.emit("agent-message", {
				agentId: supervisorConfig.id,
				agentName: supervisorConfig.name,
				projectId: project.id,
				message: `\n${toolDisplay}\n`,
				timestamp: Date.now(),
				isStreaming: true,
			})

			const { result, filesCreated } = await executeSupervisorTool(
				toolBlock.name,
				toolBlock.input,
				project,
				supervisorConfig.id,
				apiKey,
				io,
			)

			totalFilesCreated += filesCreated

			// kilocode_change start - Emit tool result to UI so user can see command output
			let resultDisplay = result
			// Truncate very long results for display (full result still goes to LLM)
			if (resultDisplay.length > 2000) {
				resultDisplay = resultDisplay.substring(0, 2000) + "\n...(truncated for display)"
			}
			
			io.emit("agent-message", {
				agentId: supervisorConfig.id,
				agentName: supervisorConfig.name,
				projectId: project.id,
				message: `\n📤 **Tool result:**\n\`\`\`\n${resultDisplay}\n\`\`\`\n`,
				timestamp: Date.now(),
				isStreaming: true,
			})
			// kilocode_change end

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
		}

		// Add tool results as user message
		messages.push({ role: "user", content: toolResults })
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

	return { fullResponse, delegationResults, totalFilesCreated }
}
// kilocode_change end

/**
 * Helper: create a ConversationAgent from a ProjectAgentConfig + project context
 */
function getOrCreateProjectAgent(
	agentConfig: ProjectAgentConfig,
	project: Project,
	apiKey: string,
): ConversationAgent {
	const existing = activeAgents.get(agentConfig.id)
	if (existing) return existing

	// kilocode_change start - use provider config instead of hardcoded Anthropic
	const apiHandler = getApiHandlerFromConfig()
	// kilocode_change end

	// Resolve project workspace path
	const projectDir = projectStore.agentHomeDir(project.id, agentConfig.id)

	// Build system prompt with project + agent context + file creation instructions
	let fullPrompt = agentConfig.systemPrompt
	// kilocode_change start - Tell the agent where its project folder is so it creates files there
	fullPrompt += `\n\n## File Creation Instructions
You are working in project "${project.name}". Your project folder is: ${projectDir}
When asked to create files, code, or any project artifacts, ALWAYS include the files in your response using this JSON format:
\`\`\`json
{
  "files": [
    {"name": "relative/path/filename.ext", "content": "full file content here"}
  ]
}
\`\`\`
This ensures files are automatically saved in your project folder. Do NOT just describe the files — include the actual content so they can be created.`
	// kilocode_change end

	// kilocode_change start - All agents get mind tools for persistent memory
	fullPrompt += `\n\n## Mind Tools - Your Persistent Memory
You have tools to maintain your own knowledge across sessions:

**Your Mind Tools:**
- \`read_file(path)\` - Read files in your folder
- \`write_file(path, content)\` - Save files (notes, plans, learnings)
- \`list_files(path)\` - See what exists in your folder
- \`read_project_file(path)\` - Read files from project root or other agents' folders

**How to Use Mind Tools:**
1. **First, discover context:** Use \`list_files(".")\` and \`read_project_file("AGENTS.md")\` to understand the project
2. **Take notes:** Write important decisions, learnings, and context to files you create
3. **Name files meaningfully:** Create whatever files help YOU stay organized (no required names)
4. **Read before acting:** Check your notes from past sessions before starting new work
5. **Update after learning:** When you learn something important, write it down

**Example usage:**
- Save task progress: \`write_file("progress.md", "## Current Task\\n...")\`
- Record decisions: \`write_file("decisions.md", "# Architecture Decisions\\n...")\`
- Track conventions: \`write_file("style-guide.md", "# Code Style\\n...")\`

Your knowledge persists between conversations. Use it!`
	// kilocode_change end

	// kilocode_change start - All agents get tool-use awareness
	const siblingAgents = project.agents.filter(a => a.id !== agentConfig.id)
	fullPrompt += `\n\n## Available Tools

You can manage work using persistent agents OR ephemeral workers (task pool).

**Task Pool Tools (Ephemeral Workers):**
- \`create_task(title, description, working_directory, output_paths, conventions, priority)\` — Add a task to the pool
- \`list_tasks()\` — See all tasks and their status
- \`spawn_worker(count)\` — Create ephemeral workers to execute tasks (they auto-delete after completion)
- \`get_worker_status()\` — Check status of active workers

**Team Management Tools (Persistent Agents):**
- \`list_team\` — See your persistent team members
- \`list_agent_files\` — List files in an agent's folder
- \`read_agent_file\` — Read an agent's knowledge files
- \`delegate_task\` — Assign a task to a persistent agent
- \`delegate_tasks_parallel\` — Assign to multiple agents simultaneously
- \`propose_new_agent\` — Create a new persistent specialist

**Other Agents (${siblingAgents.length} in this project):**
${siblingAgents.length > 0 ? siblingAgents.map(a => `- "${a.id}": ${a.name} — ${a.role}`).join("\n") : "(No other agents yet)"}

**Choosing Between Approaches:**
- **Task Pool (ephemeral):** Best for one-off implementation tasks. Workers execute and disappear.
- **Persistent Agents:** Best for ongoing roles that need memory and expertise over time.

**Task Pool Workflow:**
1. Create ALL tasks first with \`create_task()\` 
2. Decide worker count: 1 task→1 worker, 2-3 tasks→2 workers, 4+→3 workers max
3. Spawn workers with \`spawn_worker(count)\`
4. Monitor with \`list_tasks()\` until all show "completed"
5. Update your knowledge files with what you learned`
	// kilocode_change end

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
		systemPrompt: fullPrompt,
		workspacePath: projectDir, // kilocode_change - files go to project folder
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
		// kilocode_change start - summarization events
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
		// kilocode_change end
	})

	activeAgents.set(agentConfig.id, agent)
	log.info(`Activated project agent: ${agentConfig.name} in ${project.name} (workspace: ${projectDir})`)
	return agent
}

/**
 * POST /api/agent/:agentId/chat - Send a message to a specific agent
 * Looks up agent in project store first, falls back to legacy store.
 * Body: { description: string, attachments?: any[] }
 */
app.post("/api/agent/:agentId/chat", async (req, res): Promise<void> => {
	try {
		const { agentId } = req.params
		// kilocode_change - Get API key from settings, header, or env
		const providerConfig = standaloneSettings.getProvider()
		const apiKey = (req.headers["x-api-key"] as string) || providerConfig.apiKey || process.env.ANTHROPIC_API_KEY
		if (!apiKey) {
			res.status(401).json({ error: "API key required. Configure in settings or provide x-api-key header." })
			return
		}

		const { description, attachments } = req.body
		if (!description && (!attachments || attachments.length === 0)) {
			res.status(400).json({ error: "Message description or attachments required" })
			return
		}

		// Try project store first
		const found = projectStore.findAgentProject(agentId)
		if (found) {
			projectStore.recordActivity(found.project.id, agentId)
			log.info(`[${found.agent.name}@${found.project.name}] chat: ${typeof description === 'string' ? description.substring(0, 80) : 'attachment'}`)

			// kilocode_change start - All agents use tool-based agentic loop
			const result = await handleSupervisorChat(
				description,
				found.agent,
				found.project,
				apiKey,
				io,
			)

			const agent = getOrCreateProjectAgent(found.agent, found.project, apiKey)
			const history = agent.getHistory()
			if (history.length > 0 && history.length % 10 === 0) {
				const lastMessages = history.slice(-6).map((m: any) =>
					`${m.role}: ${typeof m.content === 'string' ? m.content.substring(0, 200) : '[structured]'}`
				).join('\n')
				projectStore.updateAgentMemory(found.project.id, agentId, `Recent context (${history.length} messages):\n${lastMessages}`)
			}

			res.json({
				type: "chat",
				agentId: found.agent.id,
				agentName: found.agent.name,
				projectId: found.project.id,
				projectName: found.project.name,
				response: result.fullResponse,
				status: "completed",
				historyLength: history.length,
				filesCreated: result.totalFilesCreated,
				delegations: result.delegationResults.length > 0 ? result.delegationResults : undefined,
			})
			return
			// kilocode_change end
		}

		// Legacy fallback: persistent agent store
		const profile = agentStore.get(agentId)
		if (!profile) {
			res.status(404).json({ error: `Agent "${agentId}" not found` })
			return
		}

		const agent = getOrCreateAgent(profile, apiKey)
		agentStore.recordActivity(agentId)

		log.info(`[${profile.name}] chat: ${typeof description === 'string' ? description.substring(0, 80) : 'attachment'}`)

		const content = attachments && attachments.length > 0 ? attachments : description

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

		res.json({
			type: "chat",
			agentId: profile.id,
			agentName: profile.name,
			response: fullResponse,
			status: "completed",
			historyLength: history.length,
		})
	} catch (error) {
		log.error("Error in agent chat:", error)
		res.status(500).json({ error: String(error) })
	}
})

/**
 * GET /api/agent/:agentId/workspace/files - List files in agent's workspace folder
 */
app.get("/api/agent/:agentId/workspace/files", async (req, res): Promise<void> => {
	try {
		const agentDir = agentWorkspaceDir(req.params.agentId)
		const files: { path: string; size: number; modified: string; isDir: boolean }[] = []

		// kilocode_change - Skip heavy directories that slow down file listing
		const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".next", ".cache", "coverage", "__pycache__", ".git"])

		async function walkDir(dir: string, prefix: string = "") {
			try {
				const entries = await fs.promises.readdir(dir, { withFileTypes: true })
				for (const entry of entries) {
					if (entry.name.startsWith(".")) continue
					if (SKIP_DIRS.has(entry.name)) continue // kilocode_change - skip heavy dirs
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
		if (!filePath) { res.status(400).json({ error: "path query parameter required" }); return }

		const agentDir = agentWorkspaceDir(req.params.agentId)
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

// kilocode_change start - Raw file serving for agent workspace (PDFs, images, etc.)
/**
 * GET /api/agent/:agentId/workspace/file/raw - Serve raw file from agent's workspace
 * Used for PDF viewing, image display, and file downloads
 */
app.get("/api/agent/:agentId/workspace/file/raw", async (req, res): Promise<void> => {
	try {
		const filePath = req.query.path as string
		if (!filePath) { res.status(400).json({ error: "path query parameter required" }); return }

		const agentDir = agentWorkspaceDir(req.params.agentId)
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
// kilocode_change end

/**
 * POST /api/agent/:agentId/workspace/file - Create/upload a file in agent's workspace
 */
app.post("/api/agent/:agentId/workspace/file", async (req, res): Promise<void> => {
	try {
		const { path: filePath, content, encoding } = req.body
		if (!filePath || content === undefined) { res.status(400).json({ error: "'path' and 'content' required" }); return }

		const agentDir = agentWorkspaceDir(req.params.agentId)
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
		if (!filePath) { res.status(400).json({ error: "path query parameter required" }); return }

		const agentDir = agentWorkspaceDir(req.params.agentId)
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
		const { path: dirPath } = req.body
		if (!dirPath) { res.status(400).json({ error: "'path' required" }); return }

		const agentDir = agentWorkspaceDir(req.params.agentId)
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
		const { from, to } = req.body
		if (!from || !to) { res.status(400).json({ error: "'from' and 'to' required" }); return }

		const agentDir = agentWorkspaceDir(req.params.agentId)
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

// kilocode_change end

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

	// kilocode_change start - terminal (node-pty) per socket
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
		// kilocode_change start - scope terminal cwd to agent's workspace folder
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
		// kilocode_change end
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
	// kilocode_change end

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

	// kilocode_change start - Stop agent handler
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
	// kilocode_change end

	socket.on("disconnect", () => {
		// kilocode_change start - clean up terminal on disconnect
		if (ptyProcess) {
			try {
				ptyProcess.kill()
			} catch {}
			ptyProcess = null
		}
		// kilocode_change end
		connectedClients.delete(clientId)
		log.info(`Client disconnected: ${clientId}`)
	})
})

// ============================================================================
// Serve React SPA
// ============================================================================

// kilocode_change start - serve agent-specific page
app.get("/agent/:agentId", (req, res) => {
	res.sendFile(path.join(__dirname, "public/agent.html"))
})
// kilocode_change end

// kilocode_change start - serve project page
app.get("/project/:projectId", (req, res) => {
	res.sendFile(path.join(__dirname, "public/project.html"))
})
app.get("/project/:projectId/agent/:agentId", (req, res) => {
	res.sendFile(path.join(__dirname, "public/agent.html"))
})
// kilocode_change end

app.get("*", (req, res) => {
	res.sendFile(path.join(__dirname, "public/index.html"))  // kilocode_change - serve standalone frontend
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
		// kilocode_change start - initialize standalone settings
		const workspacePath = getWorkspacePath()
		initializeSettings(workspacePath)
		log.info(getSettingsSummary())
		// kilocode_change end
		
		log.info(`Society Agent Web Server | Environment: ${NODE_ENV} | Port: ${PORT}`)

		// Don't initialize Society Manager at startup - wait for first request with API key

		server.listen(PORT, () => {
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
	server.close(() => {
		log.info("Server closed")
		process.exit(0)
	})
})

export { app, server, io }
