// kilocode_change - new file
import * as http from "http"
import * as path from "path"
import * as fs from "fs/promises"
import { EventEmitter } from "events"
import * as vscode from "vscode"
import { getLog } from "./logger"

/**
 * Agent Server - HTTP server for receiving messages from other agents
 *
 * Endpoints:
 * - POST /api/message       - Receive text message
 * - POST /api/message-multi - Receive message with attachments
 * - POST /api/task          - Receive task assignment
 * - GET  /api/status        - Health check
 */

interface IncomingMessage {
	from: string
	to: string
	type: string
	content: any
	timestamp: string
}

interface IncomingAttachment {
	filename: string
	mimeType: string
	data: Buffer
	size: number
}

export class AgentServer extends EventEmitter {
	private server: http.Server | undefined
	private port: number
	private agentId: string
	private role: string
	private tempDir: string

	constructor(port: number, agentId: string, role: string) {
		super()
		this.port = port
		this.agentId = agentId
		this.role = role
		this.tempDir = path.join(__dirname, "..", "..", "..", ".tmp", "agent-attachments")
	}

	/**
	 * Start the HTTP server
	 */
	async start(): Promise<void> {
		// Ensure temp directory exists
		await fs.mkdir(this.tempDir, { recursive: true })

		// Create HTTP server
		this.server = http.createServer((req, res) => {
			this.handleRequest(req, res)
		})

		// Start listening
		await new Promise<void>((resolve, reject) => {
			this.server!.listen(this.port, "127.0.0.1", () => {
				getLog().info(`Listening on http://127.0.0.1:${this.port}`)
				resolve()
			})

			this.server!.once("error", reject)
		})
	}

	/**
	 * Stop the HTTP server
	 */
	async stop(): Promise<void> {
		if (this.server) {
			await new Promise<void>((resolve) => {
				this.server!.close(() => {
					getLog().info(`Stopped`)
					resolve()
				})
			})
		}

		// Cleanup temp directory
		try {
			await fs.rm(this.tempDir, { recursive: true })
		} catch {
			// Ignore cleanup errors
		}
	}

	/**
	 * Handle incoming HTTP request
	 */
	private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		// Enable CORS for localhost
		res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1")
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		res.setHeader("Access-Control-Allow-Headers", "Content-Type")

		// Handle OPTIONS (preflight)
		if (req.method === "OPTIONS") {
			res.writeHead(200)
			res.end()
			return
		}

		const url = new URL(req.url || "/", `http://127.0.0.1:${this.port}`)

		try {
			// Route to handlers
			if (req.method === "POST" && url.pathname === "/api/message") {
				await this.handleMessage(req, res)
			} else if (req.method === "POST" && url.pathname === "/api/message-multi") {
				await this.handleMessageMulti(req, res)
			} else if (req.method === "POST" && url.pathname === "/api/task") {
				await this.handleTask(req, res)
			} else if (req.method === "GET" && url.pathname === "/api/status") {
				await this.handleStatus(req, res)
			} else {
				res.writeHead(404, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ error: "Not found" }))
			}
		} catch (error) {
			getLog().error("Error handling request:", error)
			res.writeHead(500, { "Content-Type": "application/json" })
			res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }))
		}
	}

	/**
	 * Handle POST /api/message (text only)
	 */
	private async handleMessage(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const body = await this.readBody(req)
		const message: IncomingMessage = JSON.parse(body)

		getLog().info(`Received message from ${message.from}:`, message.type)

		// Emit event for other components
		this.emit("message", message)

		// Show notification
		vscode.window
			.showInformationMessage(`Message from ${message.from}: ${message.content}`, "View")
			.then((choice) => {
				if (choice === "View") {
					this.emit("view-message", message)
				}
			})

		res.writeHead(200, { "Content-Type": "application/json" })
		res.end(JSON.stringify({ status: "received", agentId: this.agentId }))
	}

	/**
	 * Handle POST /api/message-multi (with attachments)
	 */
	private async handleMessageMulti(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const contentType = req.headers["content-type"] || ""

		if (!contentType.includes("multipart/form-data")) {
			res.writeHead(400, { "Content-Type": "application/json" })
			res.end(JSON.stringify({ error: "Expected multipart/form-data" }))
			return
		}

		// Parse multipart data
		const { fields, files } = await this.parseMultipart(req, contentType)

		const message: IncomingMessage = {
			from: fields.from || "unknown",
			to: this.agentId,
			type: fields.type || "message",
			content: fields.content || "",
			timestamp: fields.timestamp || new Date().toISOString(),
		}

		getLog().info(`Received message with ${files.length} attachments from ${message.from}`)

		// Save attachments
		const attachments: IncomingAttachment[] = []
		for (const file of files) {
			const savedPath = path.join(this.tempDir, `${Date.now()}-${file.filename}`)
			await fs.writeFile(savedPath, file.data)

			attachments.push({
				filename: file.filename,
				mimeType: file.mimeType,
				data: file.data,
				size: file.data.length,
			})
		}

		// Emit event with attachments
		this.emit("message", { ...message, attachments })

		// Show notification
		const attachmentText = attachments.length > 0 ? ` (${attachments.length} attachments)` : ""
		vscode.window
			.showInformationMessage(`Message from ${message.from}: ${message.content}${attachmentText}`, "View")
			.then((choice) => {
				if (choice === "View") {
					this.emit("view-message", { ...message, attachments })
				}
			})

		res.writeHead(200, { "Content-Type": "application/json" })
		res.end(JSON.stringify({ status: "received", agentId: this.agentId, attachments: attachments.length }))
	}

	/**
	 * Handle POST /api/task (task assignment)
	 */
	private async handleTask(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const body = await this.readBody(req)
		const task = JSON.parse(body)

		getLog().info(`Received task from ${task.from}:`, task.taskId)

		// Emit event
		this.emit("task", task)

		// Show notification
		vscode.window
			.showInformationMessage(`New task from ${task.from}: ${task.description}`, "View")
			.then((choice) => {
				if (choice === "View") {
					this.emit("view-task", task)
				}
			})

		res.writeHead(200, { "Content-Type": "application/json" })
		res.end(JSON.stringify({ status: "accepted", agentId: this.agentId }))
	}

	/**
	 * Handle GET /api/status (health check)
	 */
	private async handleStatus(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		res.writeHead(200, { "Content-Type": "application/json" })
		res.end(
			JSON.stringify({
				agentId: this.agentId,
				role: this.role,
				status: "online",
				uptime: process.uptime(),
				timestamp: new Date().toISOString(),
			}),
		)
	}

	/**
	 * Read request body
	 */
	private readBody(req: http.IncomingMessage): Promise<string> {
		return new Promise((resolve, reject) => {
			const chunks: Buffer[] = []

			req.on("data", (chunk) => {
				chunks.push(chunk)
			})

			req.on("end", () => {
				resolve(Buffer.concat(chunks).toString("utf-8"))
			})

			req.on("error", reject)
		})
	}

	/**
	 * Parse multipart/form-data
	 */
	private async parseMultipart(
		req: http.IncomingMessage,
		contentType: string,
	): Promise<{ fields: Record<string, string>; files: Array<{ filename: string; mimeType: string; data: Buffer }> }> {
		const boundaryMatch = contentType.match(/boundary=(.+)/)
		if (!boundaryMatch) {
			throw new Error("No boundary found in Content-Type")
		}

		const boundary = "--" + boundaryMatch[1]
		const body = await this.readBodyBuffer(req)
		const parts = this.splitMultipart(body, boundary)

		const fields: Record<string, string> = {}
		const files: Array<{ filename: string; mimeType: string; data: Buffer }> = []

		for (const part of parts) {
			const headerEndIndex = part.indexOf("\r\n\r\n")
			if (headerEndIndex === -1) continue

			const headerSection = part.slice(0, headerEndIndex).toString("utf-8")
			const data = part.slice(headerEndIndex + 4)

			// Parse Content-Disposition
			const dispositionMatch = headerSection.match(
				/Content-Disposition: form-data; name="([^"]+)"(?:; filename="([^"]+)")?/,
			)
			if (!dispositionMatch) continue

			const fieldName = dispositionMatch[1]
			const filename = dispositionMatch[2]

			if (filename) {
				// File upload
				const mimeTypeMatch = headerSection.match(/Content-Type: (.+)/)
				const mimeType = mimeTypeMatch ? mimeTypeMatch[1].trim() : "application/octet-stream"

				files.push({
					filename,
					mimeType,
					data: data.slice(0, -2), // Remove trailing \r\n
				})
			} else {
				// Regular field
				fields[fieldName] = data.slice(0, -2).toString("utf-8")
			}
		}

		return { fields, files }
	}

	/**
	 * Read request body as Buffer
	 */
	private readBodyBuffer(req: http.IncomingMessage): Promise<Buffer> {
		return new Promise((resolve, reject) => {
			const chunks: Buffer[] = []

			req.on("data", (chunk) => {
				chunks.push(chunk)
			})

			req.on("end", () => {
				resolve(Buffer.concat(chunks))
			})

			req.on("error", reject)
		})
	}

	/**
	 * Split multipart body by boundary
	 */
	private splitMultipart(buffer: Buffer, boundary: string): Buffer[] {
		const parts: Buffer[] = []
		const boundaryBuffer = Buffer.from("\r\n" + boundary)
		let start = 0

		while (start < buffer.length) {
			const nextBoundary = buffer.indexOf(boundaryBuffer, start)
			if (nextBoundary === -1) break

			const part = buffer.slice(start, nextBoundary)
			if (part.length > 0) {
				parts.push(part)
			}

			start = nextBoundary + boundaryBuffer.length
		}

		return parts
	}

	/**
	 * Get server URL
	 */
	getUrl(): string {
		return `http://127.0.0.1:${this.port}`
	}

	/**
	 * Get port
	 */
	getPort(): number {
		return this.port
	}

	/**
	 * Dispose (for VS Code subscription)
	 */
	dispose(): void {
		this.stop()
	}
}
