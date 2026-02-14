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

const app = express()
const server = http.createServer(app)
const io = new SocketIOServer(server, {
	cors: { origin: "*" },
})

const PORT = process.env.PORT || 3000
const NODE_ENV = process.env.NODE_ENV || "development"
const log = getLog()

// Middleware
app.use(express.json({ limit: "50mb" })) // kilocode_change - support file uploads
app.use(express.static(path.join(__dirname, "public")))  // kilocode_change - serve standalone frontend

// Global state
let societyManager: SocietyManager | null = null
const connectedClients = new Set<string>()
let userAgent: ConversationAgent | null = null // Single agent for user conversations

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

		const envPath = path.join(__dirname, "../../.env")
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

		// Write updated .env file
		fs.writeFileSync(envPath, envContent, "utf-8")

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

		const { description } = req.body

		if (!description) {
			res.status(400).json({ error: "Purpose description required" })
			return
		}

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

		// Send message to agent (it maintains its own conversation history)
		let fullResponse = ""
		for await (const chunk of userAgent.sendMessageStream(description)) {
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
		connectedClients.delete(clientId)
		log.info(`Client disconnected: ${clientId}`)
	})
})

// ============================================================================
// Serve React SPA
// ============================================================================

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
