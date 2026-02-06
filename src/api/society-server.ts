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
import { SocietyManager, SocietyManagerConfig } from "../services/society-agent/society-manager"
import { PurposeContext } from "../services/society-agent/purpose-analyzer"
import { ResponseStrategy } from "../services/society-agent/response-strategy"
import { ConversationAgent } from "../services/society-agent/conversation-agent"
import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler } from "./index"
import { commandExecutor } from "../services/society-agent/command-executor"

const app = express()
const server = http.createServer(app)
const io = new SocketIOServer(server, {
	cors: { origin: "*" },
})

const PORT = process.env.PORT || 3000
const NODE_ENV = process.env.NODE_ENV || "development"
const VERBOSE = process.env.VERBOSE_LOGGING !== "false"

// Override console.log to respect VERBOSE_LOGGING
const originalLog = console.log
console.log = (...args: any[]) => {
	// Always show important messages (with emoji indicators)
	const msg = args.join(" ")
	if (
		msg.includes("✅ Server") ||
		msg.includes("📊 API") ||
		msg.includes("💬 WebSocket") ||
		msg.includes("💡 Configure") ||
		msg.includes("╔") ||
		msg.includes("║") ||
		msg.includes("╚")
	) {
		originalLog(...args)
	} else if (VERBOSE) {
		originalLog(...args)
	}
}

// Middleware
app.use(express.json())
app.use(express.static(path.join(__dirname, "../../webview-ui/dist")))

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
		console.log("🔧 Initializing Society Manager...")

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
				console.log("📌 Purpose started:", purpose.id)
				io.emit("purpose-started", {
					id: purpose.id,
					description: purpose.description,
					createdAt: purpose.createdAt,
				})
			},
			onTeamFormed: (purposeId, teamSize) => {
				console.log("👥 Team formed:", teamSize, "agents")
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

		console.log("✅ Society Manager initialized")
	} catch (error) {
		console.error("❌ Failed to initialize Society Manager:", error)
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

	return purpose.team.getAllMembers().map((member) => ({
		id: member.identity.id,
		name: member.identity.name,
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
	res.json({
		status: "ok",
		environment: NODE_ENV,
		societyManagerReady: !!societyManager,
		apiKeyConfigured: !!process.env.ANTHROPIC_API_KEY,
		timestamp: new Date().toISOString(),
	})
})

/**
 * POST /api/config/api-key - Save API key to .env file
 */
app.post("/api/config/api-key", async (req, res) => {
	try {
		const { apiKey } = req.body

		if (!apiKey || typeof apiKey !== "string") {
			return res.status(400).json({ error: "API key required" })
		}

		// Validate API key format
		if (!apiKey.startsWith("sk-ant-")) {
			return res.status(400).json({ error: "Invalid API key format" })
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

		console.log("✅ API key saved to .env file")

		res.json({
			success: true,
			message: "API key saved successfully. Server will use this key for future requests.",
		})
	} catch (error) {
		console.error("❌ Error saving API key:", error)
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
app.post("/api/purpose/start", async (req, res) => {
	try {
		// Get API key from header or use environment variable
		const apiKey = (req.headers["x-api-key"] as string) || process.env.ANTHROPIC_API_KEY

		if (!apiKey) {
			return res.status(401).json({
				error: "API key required. Provide via X-API-Key header or configure ANTHROPIC_API_KEY environment variable",
			})
		}

		const { description } = req.body

		if (!description) {
			return res.status(400).json({ error: "Purpose description required" })
		}

		// Initialize user agent if not exists (maintains conversation memory)
		if (!userAgent) {
			console.log("🤖 Creating user conversation agent...")

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
					id: "user-agent",
					role: "worker",
					capabilities: ["chat", "coding", "analysis", "creative"],
					createdAt: Date.now(),
				},
				apiHandler,
				systemPrompt: `You are Claude 3.5 Sonnet, a helpful AI assistant.

Your role:
- Answer questions conversationally
- Help with coding, writing, analysis, and creative tasks
- Provide clear, helpful responses
- Maintain context across the conversation

Guidelines:
- Be conversational and natural
- Use markdown formatting when helpful
- Be concise but thorough
- Remember previous messages in our conversation

You maintain your own conversation memory, so you can reference earlier parts of our discussion.`,
				onMessage: (message) => {
					// Stream message to client
					io.emit("agent-message", {
						agentId: "user-agent",
						message: message.content,
						timestamp: message.timestamp,
						isStreaming: false,
					})
				},
			})
		}

		console.log("💬 User agent handling:", description)

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

		return res.json({
			type: "chat",
			response: fullResponse,
			status: "completed",
			historyLength: userAgent.getHistory().length,
		})
	} catch (error) {
		console.error("❌ Error handling purpose:", error)
		res.status(500).json({ error: String(error) })
	}
})

/**
 * GET /api/purposes - Get all purposes (active + completed)
 */
app.get("/api/purposes", (req, res) => {
	try {
		if (!societyManager) {
			return res.json({ active: [], completed: [] })
		}

		const state = societyManager.getState()

		const active = Array.from(state.activePurposes.values()).map((purpose) => ({
			id: purpose.purpose.id,
			description: purpose.purpose.description,
			status: purpose.status,
			startedAt: purpose.startedAt,
			progress: purpose.supervisorState?.progressPercentage || 0,
			teamSize: purpose.team.getAllMembers().length,
		}))

		const completed = state.completedPurposes.map((purpose) => ({
			id: purpose.id,
			description: purpose.description,
			status: "completed",
			createdAt: purpose.createdAt,
		}))

		res.json({ active, completed })
	} catch (error) {
		console.error("❌ Error getting purposes:", error)
		res.status(500).json({ error: String(error) })
	}
})

/**
 * GET /api/purpose/:purposeId - Get details of a specific purpose
 */
app.get("/api/purpose/:purposeId", (req, res) => {
	try {
		if (!societyManager) {
			return res.status(404).json({ error: "Society Manager not initialized" })
		}

		const state = societyManager.getState()
		const purpose = state.activePurposes.get(req.params.purposeId)

		if (!purpose) {
			return res.status(404).json({ error: "Purpose not found" })
		}

		res.json({
			id: purpose.purpose.id,
			description: purpose.purpose.description,
			status: purpose.status,
			progress: purpose.supervisorState?.progressPercentage || 0,
			agents: getTeamAgents(req.params.purposeId),
			startedAt: purpose.startedAt,
		})
	} catch (error) {
		console.error("❌ Error getting purpose:", error)
		res.status(500).json({ error: String(error) })
	}
})

/**
 * GET /api/agents - Get all active agents
 */
app.get("/api/agents", (req, res) => {
	try {
		if (!societyManager) {
			return res.json({ agents: [] })
		}

		const state = societyManager.getState()
		const agents: any[] = []

		state.activePurposes.forEach((purpose) => {
			purpose.team.getAllMembers().forEach((member) => {
				agents.push({
					id: member.identity.id,
					name: member.identity.name,
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
		console.error("❌ Error getting agents:", error)
		res.status(500).json({ error: String(error) })
	}
})

/**
 * GET /api/agent/:agentId - Get details of a specific agent
 */
app.get("/api/agent/:agentId", (req, res) => {
	try {
		if (!societyManager) {
			return res.status(404).json({ error: "Society Manager not initialized" })
		}

		const state = societyManager.getState()
		let foundAgent: any = null

		state.activePurposes.forEach((purpose) => {
			const member = purpose.team.getAllMembers().find((m) => m.identity.id === req.params.agentId)
			if (member) {
				foundAgent = {
					id: member.identity.id,
					name: member.identity.name,
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
			return res.status(404).json({ error: "Agent not found" })
		}

		res.json(foundAgent)
	} catch (error) {
		console.error("❌ Error getting agent:", error)
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/agent/:agentId/pause - Pause an agent
 */
app.post("/api/agent/:agentId/pause", async (req, res) => {
	try {
		// TODO: Implement agent pause
		res.json({ status: "paused", agentId: req.params.agentId })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/agent/:agentId/stop - Stop an agent
 */
app.post("/api/agent/:agentId/stop", async (req, res) => {
	try {
		// TODO: Implement agent stop
		res.json({ status: "stopped", agentId: req.params.agentId })
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
app.post("/api/terminal/execute", async (req, res) => {
	try {
		const { command, cwd, projectId } = req.body

		if (!command || typeof command !== "string") {
			return res.status(400).json({ error: "Command required" })
		}

		// Determine working directory
		let workingDir = cwd
		if (projectId) {
			// TODO: Get project path from workspace manager
			workingDir = cwd || process.cwd()
		} else {
			workingDir = cwd || process.cwd()
		}

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
		console.error("❌ Error executing command:", error)
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/terminal/kill - Kill a running command
 */
app.post("/api/terminal/kill", (req, res) => {
	try {
		const { commandId } = req.body

		if (!commandId) {
			return res.status(400).json({ error: "Command ID required" })
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
		// TODO: Implement purpose pause
		res.json({ status: "paused", purposeId: req.params.purposeId })
	} catch (error) {
		res.status(500).json({ error: String(error) })
	}
})

/**
 * POST /api/purpose/:purposeId/stop - Stop a purpose
 */
app.post("/api/purpose/:purposeId/stop", async (req, res) => {
	try {
		if (!societyManager) {
			return res.status(404).json({ error: "Society Manager not initialized" })
		}

		await societyManager.stopPurpose(req.params.purposeId, "User requested stop")

		res.json({ status: "stopped", purposeId: req.params.purposeId })
	} catch (error) {
		console.error("❌ Error stopping purpose:", error)
		res.status(500).json({ error: String(error) })
	}
})

// ============================================================================
// WebSocket Events (Real-time Communication)
// ============================================================================

io.on("connection", (socket) => {
	const clientId = socket.id
	connectedClients.add(clientId)

	console.log(`✅ Client connected: ${clientId}`)

	socket.on("subscribe-purpose", (purposeId: string) => {
		console.log(`📡 Client ${clientId} subscribed to purpose ${purposeId}`)
		socket.join(`purpose:${purposeId}`)
	})

	socket.on("unsubscribe-purpose", (purposeId: string) => {
		console.log(`📡 Client ${clientId} unsubscribed from purpose ${purposeId}`)
		socket.leave(`purpose:${purposeId}`)
	})

	socket.on("subscribe-agent", (agentId: string) => {
		console.log(`📡 Client ${clientId} subscribed to agent ${agentId}`)
		socket.join(`agent:${agentId}`)
	})

	socket.on("disconnect", () => {
		connectedClients.delete(clientId)
		console.log(`❌ Client disconnected: ${clientId}`)
	})
})

// ============================================================================
// Serve React SPA
// ============================================================================

app.get("*", (req, res) => {
	res.sendFile(path.join(__dirname, "../webview-ui/build-standalone/index-standalone.html"))
})

// ============================================================================
// Error Handling
// ============================================================================

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
	console.error("🔴 Server error:", err)
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
		console.log(`
╔════════════════════════════════════════╗
║   Society Agent Web Server             ║
║   Environment: ${NODE_ENV.padEnd(24)} ║
║   Port: ${String(PORT).padEnd(28)} ║
╚════════════════════════════════════════╝
		`)

		// Don't initialize Society Manager at startup - wait for first request with API key

		server.listen(PORT, () => {
			console.log(`✅ Server running on http://localhost:${PORT}`)
			console.log(`📊 API: http://localhost:${PORT}/api`)
			console.log(`💬 WebSocket: ws://localhost:${PORT}`)
			console.log(`\n💡 Configure your API key in the web UI (click Settings button)`)
		})
	} catch (error) {
		console.error("❌ Failed to start server:", error)
		process.exit(1)
	}
}

start()

// Graceful shutdown
process.on("SIGTERM", () => {
	console.log("🛑 SIGTERM received, shutting down gracefully")
	server.close(() => {
		console.log("✅ Server closed")
		process.exit(0)
	})
})

export { app, server, io }
