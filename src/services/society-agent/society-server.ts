// kilocode_change - new file
/**
 * Society Agent Web Server
 *
 * Express.js server that runs Society Agents and exposes them via HTTP/WebSocket API.
 * Single user, full-featured chat interface with agent monitoring.
 */

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
import { ApiHandler } from "../../api/index"
import { commandExecutor } from "./command-executor"
import { getLog } from "./logger"
// kilocode_change start - persistent agents
import { PersistentAgentStore } from "./persistent-agent-store"
// kilocode_change end
// kilocode_change start - project system
import { ProjectStore, ProjectAgentConfig, Project } from "./project-store"
// kilocode_change end
// kilocode_change start - terminal support
import * as pty from "node-pty"
// kilocode_change end

const app = express()
const server = http.createServer(app)
const io = new SocketIOServer(server, {
	cors: { origin: "*" },
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

// kilocode_change start - persistent agent system
const agentStore = new PersistentAgentStore(getWorkspacePath())
const activeAgents = new Map<string, ConversationAgent>() // agentId → live ConversationAgent
// kilocode_change end
// kilocode_change start - project system
const projectStore = new ProjectStore(getWorkspacePath())
// kilocode_change end

/**
 * Initialize Society Manager with callbacks
 */
async function initializeSocietyManager(apiKey?: string) {
	if (societyManager) return

	try {
		log.info("Initializing Society Manager...")

		// Use provided API key or fallback to environment variable
		const key = apiKey || process.env.ANTHROPIC_API_KEY
		if (!key) {
			throw new Error("API key required. Provide via X-API-Key header or ANTHROPIC_API_KEY environment variable")
		}

		const anthropic = new Anthropic({ apiKey: key })

		// Minimal API handler that works standalone - returns async generator for streaming
		const apiHandler: ApiHandler = {
			createMessage: async function* (systemPrompt: string, messages: any[]) {
				const stream = await anthropic.messages.stream({
					model: process.env.API_MODEL_ID || "claude-sonnet-4-20250514",
					max_tokens: 8096,
					system: systemPrompt,
					messages: messages.map((m) => ({
						role: m.role === "assistant" ? "assistant" : "user",
						content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
					})),
				})

				for await (const chunk of stream) {
					if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
						yield {
							type: "text",
							text: chunk.delta.text,
						}
					}
				}

				const finalMessage = await stream.finalMessage()
				return {
					stopReason: finalMessage.stop_reason || "end_turn",
				}
			},
		} as any

		const workspacePath = process.env.WORKSPACE_PATH || process.cwd()

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

// kilocode_change start - workspace file browser
/**
 * GET /api/workspace/files - List files in the projects output directory
 */
app.get("/api/workspace/files", async (req, res): Promise<void> => {
	try {
		const workspacePath = process.env.WORKSPACE_PATH || process.cwd()
		const projectsDir = path.join(workspacePath, "projects")

		const files: { path: string; fullPath: string; size: number; modified: string; isDir: boolean }[] = []

		async function walkDir(dir: string, prefix: string = "") {
			try {
				const entries = await fs.promises.readdir(dir, { withFileTypes: true })
				for (const entry of entries) {
					if (entry.name.startsWith(".")) continue
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

			const anthropic = new Anthropic({ apiKey })

			// Minimal API handler for streaming
			const apiHandler: ApiHandler = {
				createMessage: async function* (systemPrompt: string, messages: any[]) {
					const stream = await anthropic.messages.stream({
						model: process.env.API_MODEL_ID || "claude-sonnet-4-20250514",
						max_tokens: 8096,
						system: systemPrompt,
						messages: messages.map((m) => ({
							role: m.role === "assistant" ? "assistant" : "user",
							content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
						})),
					})

					for await (const chunk of stream) {
						if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
							yield {
								type: "text",
								text: chunk.delta.text,
							}
						}
					}

					const finalMessage = await stream.finalMessage()
					return {
						stopReason: finalMessage.stop_reason || "end_turn",
					}
				},
			} as any

			userAgent = new ConversationAgent({
				identity: {
					id: "society-agent",
					role: "supervisor",
					capabilities: ["chat", "coding", "analysis", "creative", "planning"],
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

	const anthropic = new Anthropic({ apiKey })

	const apiHandler: ApiHandler = {
		createMessage: async function* (systemPrompt: string, messages: any[]) {
			const stream = await anthropic.messages.stream({
				model: profile.model || process.env.API_MODEL_ID || "claude-sonnet-4-20250514",
				max_tokens: 8096,
				system: systemPrompt,
				messages: messages.map((m) => ({
					role: m.role === "assistant" ? "assistant" : "user",
					content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
				})),
			})

			for await (const chunk of stream) {
				if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
					yield { type: "text", text: chunk.delta.text }
				}
			}

			const finalMessage = await stream.finalMessage()
			return { stopReason: finalMessage.stop_reason || "end_turn" }
		},
	} as any

	// Build system prompt with memory context
	let fullPrompt = profile.systemPrompt
	if (profile.memorySummary) {
		fullPrompt += `\n\n## Your Memory (from past conversations)\n${profile.memorySummary}`
	}
	if (profile.knowledgeSummary) {
		fullPrompt += `\n\n## Your Knowledge\n${profile.knowledgeSummary}`
	}

	const agent = new ConversationAgent({
		identity: {
			id: profile.id,
			role: profile.canSpawnWorkers ? "supervisor" : "worker",
			capabilities: profile.capabilities,
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
		const { id, name, role, capabilities, systemPrompt, canSpawnWorkers, model } = req.body
		if (!id || !name || !role || !systemPrompt) {
			res.status(400).json({ error: "id, name, role, and systemPrompt are required" })
			return
		}
		const agent = agentStore.create({
			id,
			name,
			role,
			capabilities: capabilities || [],
			systemPrompt,
			canSpawnWorkers: canSpawnWorkers || false,
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
		const project = projectStore.create({ id, name, description: description || "", folder, knowledge, agents })
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
		const { id, name, role, capabilities, systemPrompt, canSpawnWorkers, homeFolder, model } = req.body
		if (!id || !name || !role || !systemPrompt) {
			res.status(400).json({ error: "id, name, role, and systemPrompt are required" })
			return
		}
		const agent = projectStore.addAgent(req.params.id, {
			id, name, role,
			capabilities: capabilities || [],
			systemPrompt,
			canSpawnWorkers: canSpawnWorkers || false,
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

	const anthropic = new Anthropic({ apiKey })

	const apiHandler: ApiHandler = {
		createMessage: async function* (systemPrompt: string, messages: any[]) {
			const stream = await anthropic.messages.stream({
				model: agentConfig.model || process.env.API_MODEL_ID || "claude-sonnet-4-20250514",
				max_tokens: 8096,
				system: systemPrompt,
				messages: messages.map((m) => ({
					role: m.role === "assistant" ? "assistant" : "user",
					content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
				})),
			})
			for await (const chunk of stream) {
				if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
					yield { type: "text", text: chunk.delta.text }
				}
			}
			const finalMessage = await stream.finalMessage()
			return { stopReason: finalMessage.stop_reason || "end_turn" }
		},
	} as any

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
	if (project.knowledge) {
		fullPrompt += `\n\n## Project Knowledge (${project.name})\n${project.knowledge}`
	}
	if (agentConfig.memorySummary) {
		fullPrompt += `\n\n## Your Memory (from past conversations)\n${agentConfig.memorySummary}`
	}
	if (agentConfig.knowledgeSummary) {
		fullPrompt += `\n\n## Your Knowledge\n${agentConfig.knowledgeSummary}`
	}

	const agent = new ConversationAgent({
		identity: {
			id: agentConfig.id,
			role: agentConfig.canSpawnWorkers ? "supervisor" : "worker",
			capabilities: agentConfig.capabilities,
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
		const apiKey = (req.headers["x-api-key"] as string) || process.env.ANTHROPIC_API_KEY
		if (!apiKey) {
			res.status(401).json({ error: "API key required" })
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
			const agent = getOrCreateProjectAgent(found.agent, found.project, apiKey)
			projectStore.recordActivity(found.project.id, agentId)

			log.info(`[${found.agent.name}@${found.project.name}] chat: ${typeof description === 'string' ? description.substring(0, 80) : 'attachment'}`)

			const content = attachments && attachments.length > 0 ? attachments : description

			let fullResponse = ""
			for await (const chunk of agent.sendMessageStream(content)) {
				fullResponse += chunk
				io.emit("agent-message", {
					agentId: found.agent.id,
					agentName: found.agent.name,
					projectId: found.project.id,
					message: chunk,
					timestamp: Date.now(),
					isStreaming: true,
				})
			}

			io.emit("agent-message", {
				agentId: found.agent.id,
				agentName: found.agent.name,
				projectId: found.project.id,
				message: "",
				timestamp: Date.now(),
				isStreaming: false,
				isDone: true,
			})

			// kilocode_change start - Auto-extract and create files from project agent responses
			let filesCreated = 0
			if (fullResponse.length > 0) {
				try {
					filesCreated = await agent.extractAndCreateFiles(fullResponse)
					if (filesCreated > 0) {
						log.info(`[${found.agent.name}@${found.project.name}] Auto-created ${filesCreated} files from chat`)
						io.emit("system-event", {
							type: "files-created",
							agentId: found.agent.id,
							projectId: found.project.id,
							count: filesCreated,
							message: `${found.agent.name} created ${filesCreated} file(s) in project folder`,
							timestamp: Date.now(),
						})
					}
				} catch (err) {
					log.warn(`[${found.agent.name}] File extraction failed:`, err)
				}
			}
			// kilocode_change end

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
				response: fullResponse,
				status: "completed",
				historyLength: history.length,
				filesCreated, // kilocode_change - report files created
			})
			return
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

	socket.on("terminal-start", (opts: { shell?: string; cols?: number; rows?: number; agentId?: string }) => {
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
		if (opts.agentId) {
			const profile = agentStore.get(opts.agentId)
			const folder = profile?.workspaceFolder || opts.agentId
			cwd = path.join(getWorkspacePath(), "projects", folder)
			// Ensure workspace folder exists
			try { fs.mkdirSync(cwd, { recursive: true }) } catch {}
		} else {
			cwd = process.env.WORKSPACE_PATH || process.cwd()
		}
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
