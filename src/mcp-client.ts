/**
 * MCP Client Manager for Society Agent
 * 
 * Manages connections to external MCP servers (GitHub, Playwright, etc.)
 * Following the same permission model as skills:
 * - Global MCPs: /mcp-config.json (user-managed, read-only for agents)
 * - Project MCPs: projects/{project}/mcp.json (user-managed, project scope)
 * 
 * Agents can LIST and USE MCPs, but cannot REGISTER them.
 */

import { spawn, ChildProcess } from "child_process"
import * as fs from "fs"
import * as path from "path"
import { EventEmitter } from "events"

// MCP server configuration
interface McpServerConfig {
	command: string
	args?: string[]
	env?: Record<string, string>
	description?: string
}

interface McpConfig {
	servers: Record<string, McpServerConfig>
}

// MCP protocol types
interface McpTool {
	name: string
	description?: string
	inputSchema?: {
		type: string
		properties?: Record<string, any>
		required?: string[]
	}
}

interface McpToolResult {
	content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>
	isError?: boolean
}

// Active MCP server connection
interface McpConnection {
	process: ChildProcess
	config: McpServerConfig
	tools: McpTool[]
	ready: boolean
	lastUsed: number
	messageId: number
	pendingRequests: Map<number, { resolve: (value: any) => void; reject: (err: Error) => void }>
	buffer: string
}

class McpClientManager extends EventEmitter {
	private connections: Map<string, McpConnection> = new Map()
	private globalConfig: McpConfig | null = null
	private projectConfigs: Map<string, McpConfig> = new Map()
	private workspacePath: string
	
	constructor(workspacePath: string) {
		super()
		this.workspacePath = workspacePath
		this.loadGlobalConfig()
	}
	
	/**
	 * Load global MCP configuration from /mcp-config.json
	 */
	private loadGlobalConfig(): void {
		const configPath = path.join(this.workspacePath, "mcp-config.json")
		try {
			if (fs.existsSync(configPath)) {
				const content = fs.readFileSync(configPath, "utf-8")
				this.globalConfig = JSON.parse(content)
				console.log(`[MCP] Loaded global config: ${Object.keys(this.globalConfig?.servers || {}).length} servers`)
			}
		} catch (err) {
			console.error(`[MCP] Failed to load global config:`, err)
		}
	}
	
	/**
	 * Load project-specific MCP configuration
	 */
	private loadProjectConfig(projectId: string): McpConfig | null {
		if (this.projectConfigs.has(projectId)) {
			return this.projectConfigs.get(projectId)!
		}
		
		const configPath = path.join(this.workspacePath, "projects", projectId, "mcp.json")
		try {
			if (fs.existsSync(configPath)) {
				const content = fs.readFileSync(configPath, "utf-8")
				const config = JSON.parse(content)
				this.projectConfigs.set(projectId, config)
				console.log(`[MCP] Loaded project config for ${projectId}: ${Object.keys(config.servers || {}).length} servers`)
				return config
			}
		} catch (err) {
			console.error(`[MCP] Failed to load project config for ${projectId}:`, err)
		}
		return null
	}
	
	/**
	 * Get merged MCP servers for a project (project overrides global)
	 */
	getAvailableServers(projectId?: string): Record<string, McpServerConfig & { source: "global" | "project" }> {
		const servers: Record<string, McpServerConfig & { source: "global" | "project" }> = {}
		
		// Add global servers first
		if (this.globalConfig?.servers) {
			for (const [name, config] of Object.entries(this.globalConfig.servers)) {
				servers[name] = { ...config, source: "global" }
			}
		}
		
		// Override with project servers
		if (projectId) {
			const projectConfig = this.loadProjectConfig(projectId)
			if (projectConfig?.servers) {
				for (const [name, config] of Object.entries(projectConfig.servers)) {
					servers[name] = { ...config, source: "project" }
				}
			}
		}
		
		return servers
	}
	
	/**
	 * List available MCPs (informative - name + description only)
	 * This is the lazy-loading first step - shows what's available without loading tool lists
	 */
	listMcps(projectId?: string): string {
		const servers = this.getAvailableServers(projectId)
		
		if (Object.keys(servers).length === 0) {
			return `📭 No MCP servers configured.\n\nMCP servers must be registered by the user in:\n- Global: /mcp-config.json\n- Project: projects/{project}/mcp.json`
		}
		
		const lines = Object.entries(servers).map(([name, config]) => {
			const scope = config.source === "global" ? "🌐" : "📁"
			const connected = this.connections.has(name) ? " (connected)" : ""
			return `- **${name}** ${scope}${connected}: ${config.description || "(no description)"}`
		})
		
		return `🔌 **Available MCP Servers:**\n\n${lines.join("\n")}\n\n` +
			`Use \`list_mcp_tools("server_name")\` to see available tools.\n` +
			`Use \`use_mcp("server_name", "tool_name", {...})\` to call a tool.`
	}
	
	/**
	 * Connect to an MCP server (lazy - called on first use)
	 */
	private async connect(serverName: string, config: McpServerConfig): Promise<McpConnection> {
		return new Promise((resolve, reject) => {
			console.log(`[MCP] Connecting to ${serverName}: ${config.command} ${(config.args || []).join(" ")}`)
			
			const proc = spawn(config.command, config.args || [], {
				env: { ...process.env, ...config.env },
				stdio: ["pipe", "pipe", "pipe"],
			})
			
			const connection: McpConnection = {
				process: proc,
				config,
				tools: [],
				ready: false,
				lastUsed: Date.now(),
				messageId: 0,
				pendingRequests: new Map(),
				buffer: "",
			}
			
			// Handle stdout (JSON-RPC responses)
			proc.stdout?.on("data", (data: Buffer) => {
				connection.buffer += data.toString()
				this.processBuffer(serverName, connection)
			})
			
			// Handle stderr (logs)
			proc.stderr?.on("data", (data: Buffer) => {
				console.log(`[MCP ${serverName}] ${data.toString().trim()}`)
			})
			
			proc.on("error", (err) => {
				console.error(`[MCP ${serverName}] Process error:`, err)
				this.connections.delete(serverName)
				reject(err)
			})
			
			proc.on("exit", (code) => {
				console.log(`[MCP ${serverName}] Exited with code ${code}`)
				this.connections.delete(serverName)
			})
			
			this.connections.set(serverName, connection)
			
			// Initialize the connection
			this.sendRequest(serverName, "initialize", {
				protocolVersion: "2024-11-05",
				capabilities: {},
				clientInfo: { name: "society-agent", version: "1.0" },
			})
				.then(() => {
					connection.ready = true
					console.log(`[MCP ${serverName}] Connected and initialized`)
					resolve(connection)
				})
				.catch(reject)
		})
	}
	
	/**
	 * Process buffered JSON-RPC messages
	 */
	private processBuffer(serverName: string, connection: McpConnection): void {
		const lines = connection.buffer.split("\n")
		connection.buffer = lines.pop() || "" // Keep incomplete line
		
		for (const line of lines) {
			if (!line.trim()) continue
			try {
				const msg = JSON.parse(line)
				if (msg.id !== undefined && connection.pendingRequests.has(msg.id)) {
					const { resolve, reject } = connection.pendingRequests.get(msg.id)!
					connection.pendingRequests.delete(msg.id)
					if (msg.error) {
						reject(new Error(msg.error.message || JSON.stringify(msg.error)))
					} else {
						resolve(msg.result)
					}
				}
			} catch (err) {
				// Ignore non-JSON lines
			}
		}
	}
	
	/**
	 * Send a JSON-RPC request to an MCP server
	 */
	private sendRequest(serverName: string, method: string, params: any): Promise<any> {
		const connection = this.connections.get(serverName)
		if (!connection) {
			return Promise.reject(new Error(`Not connected to ${serverName}`))
		}
		
		const id = ++connection.messageId
		const request = { jsonrpc: "2.0", id, method, params }
		
		return new Promise((resolve, reject) => {
			connection.pendingRequests.set(id, { resolve, reject })
			connection.process.stdin?.write(JSON.stringify(request) + "\n")
			
			// Timeout after 30 seconds
			setTimeout(() => {
				if (connection.pendingRequests.has(id)) {
					connection.pendingRequests.delete(id)
					reject(new Error(`Request timed out: ${method}`))
				}
			}, 30000)
		})
	}
	
	/**
	 * Ensure server is connected, connect if needed
	 */
	private async ensureConnected(serverName: string, projectId?: string): Promise<McpConnection> {
		if (this.connections.has(serverName)) {
			const conn = this.connections.get(serverName)!
			conn.lastUsed = Date.now()
			return conn
		}
		
		const servers = this.getAvailableServers(projectId)
		if (!servers[serverName]) {
			throw new Error(`MCP server "${serverName}" not found. Use list_mcps() to see available servers.`)
		}
		
		return this.connect(serverName, servers[serverName])
	}
	
	/**
	 * List tools for a specific MCP server (loads tool definitions)
	 */
	async listMcpTools(serverName: string, projectId?: string): Promise<string> {
		try {
			const connection = await this.ensureConnected(serverName, projectId)
			
			// Fetch tools if not cached
			if (connection.tools.length === 0) {
				const result = await this.sendRequest(serverName, "tools/list", {})
				connection.tools = result.tools || []
			}
			
			if (connection.tools.length === 0) {
				return `📭 MCP server "${serverName}" has no tools available.`
			}
			
			const lines = connection.tools.map(tool => {
				const params = tool.inputSchema?.properties
					? Object.keys(tool.inputSchema.properties).join(", ")
					: ""
				return `- **${tool.name}**${params ? `(${params})` : ""}: ${tool.description || "(no description)"}`
			})
			
			// Add Playwright-specific usage guidance
			let guidance = `Use \`use_mcp("${serverName}", "tool_name", { param: value })\` to call.`
			if (serverName === "playwright") {
				guidance = `**Playwright Usage:**
1. First call \`browser_navigate({ url: "..." })\` to open a page
2. Call \`browser_snapshot()\` to get element refs (e.g., ref="e7")
3. Use refs for actions: \`browser_click({ ref: "e7" })\`

⚠️ **Important:** Don't use CSS selectors - use \`ref\` values from snapshot!

Example:
\`\`\`
use_mcp("playwright", "browser_navigate", { url: "http://localhost:5173" })
use_mcp("playwright", "browser_snapshot", {})  // Get refs
use_mcp("playwright", "browser_click", { ref: "e7" })  // Click using ref
\`\`\``
			}
			
			return `🔧 **Tools from "${serverName}":**\n\n${lines.join("\n")}\n\n` + guidance
		} catch (err: any) {
			return `❌ Failed to list tools for "${serverName}": ${err.message}`
		}
	}
	
	/**
	 * Call an MCP tool
	 */
	async useMcp(serverName: string, toolName: string, params: any, projectId?: string): Promise<string> {
		try {
			const connection = await this.ensureConnected(serverName, projectId)
			
			console.log(`[MCP ${serverName}] Calling tool: ${toolName}`, params)
			
			const result: McpToolResult = await this.sendRequest(serverName, "tools/call", {
				name: toolName,
				arguments: params,
			})
			
			// Format the result
			const output = result.content
				.map(item => {
					if (item.type === "text") return item.text
					if (item.type === "image") return `[Image: ${item.mimeType}]`
					return JSON.stringify(item)
				})
				.join("\n")
			
			if (result.isError) {
				return `❌ MCP tool error:\n${output}`
			}
			
			return `✅ **${serverName}.${toolName}** result:\n${output}`
		} catch (err: any) {
			return `❌ Failed to call ${serverName}.${toolName}: ${err.message}`
		}
	}
	
	/**
	 * Disconnect all servers (cleanup)
	 */
	disconnectAll(): void {
		for (const [name, connection] of this.connections) {
			console.log(`[MCP] Disconnecting ${name}`)
			connection.process.kill()
		}
		this.connections.clear()
	}
	
	/**
	 * Disconnect idle servers (after 5 minutes of no use)
	 */
	cleanupIdle(maxIdleMs: number = 5 * 60 * 1000): void {
		const now = Date.now()
		for (const [name, connection] of this.connections) {
			if (now - connection.lastUsed > maxIdleMs) {
				console.log(`[MCP] Disconnecting idle server: ${name}`)
				connection.process.kill()
				this.connections.delete(name)
			}
		}
	}
}

// Singleton instance
let mcpManager: McpClientManager | null = null

export function getMcpManager(workspacePath?: string): McpClientManager {
	if (!mcpManager && workspacePath) {
		mcpManager = new McpClientManager(workspacePath)
	}
	if (!mcpManager) {
		throw new Error("MCP manager not initialized")
	}
	return mcpManager
}

export function initMcpManager(workspacePath: string): McpClientManager {
	mcpManager = new McpClientManager(workspacePath)
	return mcpManager
}

export { McpClientManager, McpServerConfig, McpConfig, McpTool }
