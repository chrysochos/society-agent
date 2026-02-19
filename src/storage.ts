// kilocode_change - new file
/**
 * Society Agent Persistent Storage
 *
 * Workspace-local file-based storage for agent state using JSONL format.
 * Enables data sharing between CLI and VS Code extension instances.
 */

import * as fs from "fs/promises"
import * as path from "path"
import { getLog } from "./logger" // kilocode_change

/**
 * Storage paths for Society Agent data
 */
export interface StoragePaths {
	baseDir: string // .society-agent/
	logsDir: string // .society-agent/logs/
	registryFile: string // .society-agent/registry.jsonl
	messagesFile: string // .society-agent/messages.jsonl
	approvalsFile: string // .society-agent/approvals.jsonl
}

/**
 * Get storage paths for a workspace
 */
export function getStoragePaths(workspaceRoot: string): StoragePaths {
	const baseDir = path.join(workspaceRoot, ".society-agent")
	return {
		baseDir,
		logsDir: path.join(baseDir, "logs"),
		registryFile: path.join(baseDir, "registry.jsonl"),
		messagesFile: path.join(baseDir, "messages.jsonl"),
		approvalsFile: path.join(baseDir, "approvals.jsonl"),
	}
}

/**
 * Ensure storage directories exist
 */
export async function ensureStorageDirectories(paths: StoragePaths): Promise<void> {
	await fs.mkdir(paths.logsDir, { recursive: true })
}

/**
 * Generic JSONL storage operations
 */
export class JsonlStorage<T> {
	constructor(private filePath: string) {}

	/**
	 * Append an entry to the JSONL file
	 */
	async append(entry: T): Promise<void> {
		try {
			const line = JSON.stringify(entry) + "\n"
			const dir = path.dirname(this.filePath)
			await fs.mkdir(dir, { recursive: true })
			await fs.appendFile(this.filePath, line, "utf-8")
		} catch (error) {
			getLog().error(`Failed to append to ${this.filePath}:`, error)
			throw error
		}
	}

	/**
	 * Read all entries from the JSONL file
	 */
	async readAll(): Promise<T[]> {
		try {
			const content = await fs.readFile(this.filePath, "utf-8")
			const lines = content
				.trim()
				.split("\n")
				.filter((line) => line.length > 0)
			return lines.map((line) => JSON.parse(line) as T)
		} catch (error: any) {
			// File doesn't exist yet - return empty array
			if (error.code === "ENOENT") {
				return []
			}
			getLog().error(`Failed to read from ${this.filePath}:`, error)
			throw error
		}
	}

	/**
	 * Read entries matching a filter
	 */
	async readFiltered(predicate: (entry: T) => boolean): Promise<T[]> {
		const entries = await this.readAll()
		return entries.filter(predicate)
	}

	/**
	 * Clear all entries (delete the file)
	 */
	async clear(): Promise<void> {
		try {
			await fs.unlink(this.filePath)
		} catch (error: any) {
			// Ignore if file doesn't exist
			if (error.code !== "ENOENT") {
				getLog().error(`Failed to clear ${this.filePath}:`, error)
				throw error
			}
		}
	}

	/**
	 * Get the last N entries
	 */
	async readLast(count: number): Promise<T[]> {
		const entries = await this.readAll()
		return entries.slice(-count)
	}

	/**
	 * Count total entries
	 */
	async count(): Promise<number> {
		const entries = await this.readAll()
		return entries.length
	}
}

/**
 * Registry entry for persistent storage
 */
export interface RegistryEntry {
	timestamp: number
	event: "register" | "deregister" | "status-update"
	agentId: string
	agentData?: {
		name: string
		role: string
		capabilities: string[]
		domain?: string
		available?: boolean
		taskCount?: number
		createdAt?: number
	}
}

/**
 * Message entry for persistent storage
 */
export interface MessageEntry {
	timestamp: number
	messageId: string
	type: "request" | "response" | "broadcast" | "notification"
	fromAgentId: string
	toAgentId?: string
	action?: string
	payload?: unknown
	correlationId?: string
	priority?: "low" | "normal" | "high" | "urgent"
	error?: string
}

/**
 * Approval entry for persistent storage
 */
export interface ApprovalEntry {
	timestamp: number
	agentId: string
	tool: string
	params?: unknown
	decision: "approved" | "denied"
	approvedBy?: string
	reason?: string
	autoApproved?: boolean
}

/**
 * Society Agent storage manager
 */
export class SocietyAgentStorage {
	private paths: StoragePaths
	private registryStorage: JsonlStorage<RegistryEntry>
	private messagesStorage: JsonlStorage<MessageEntry>
	private approvalsStorage: JsonlStorage<ApprovalEntry>

	constructor(workspaceRoot: string) {
		this.paths = getStoragePaths(workspaceRoot)
		this.registryStorage = new JsonlStorage<RegistryEntry>(this.paths.registryFile)
		this.messagesStorage = new JsonlStorage<MessageEntry>(this.paths.messagesFile)
		this.approvalsStorage = new JsonlStorage<ApprovalEntry>(this.paths.approvalsFile)
	}

	/**
	 * Initialize storage (create directories)
	 */
	async initialize(): Promise<void> {
		await ensureStorageDirectories(this.paths)
	}

	/**
	 * Registry operations
	 */
	async recordAgentRegistration(agentId: string, agentData: RegistryEntry["agentData"]): Promise<void> {
		await this.registryStorage.append({
			timestamp: Date.now(),
			event: "register",
			agentId,
			agentData,
		})
	}

	async recordAgentDeregistration(agentId: string): Promise<void> {
		await this.registryStorage.append({
			timestamp: Date.now(),
			event: "deregister",
			agentId,
		})
	}

	async recordAgentStatusUpdate(agentId: string, agentData: RegistryEntry["agentData"]): Promise<void> {
		await this.registryStorage.append({
			timestamp: Date.now(),
			event: "status-update",
			agentId,
			agentData,
		})
	}

	async getRegistryHistory(): Promise<RegistryEntry[]> {
		return await this.registryStorage.readAll()
	}

	async getActiveAgents(): Promise<Map<string, RegistryEntry>> {
		const history = await this.getRegistryHistory()
		const agents = new Map<string, RegistryEntry>()

		// Build current state by replaying events
		for (const entry of history) {
			if (entry.event === "register" || entry.event === "status-update") {
				agents.set(entry.agentId, entry)
			} else if (entry.event === "deregister") {
				agents.delete(entry.agentId)
			}
		}

		return agents
	}

	/**
	 * Message operations
	 */
	async recordMessage(message: Omit<MessageEntry, "timestamp">): Promise<void> {
		await this.messagesStorage.append({
			timestamp: Date.now(),
			...message,
		})
	}

	async getMessages(agentId?: string): Promise<MessageEntry[]> {
		if (agentId) {
			return await this.messagesStorage.readFiltered(
				(msg) => msg.fromAgentId === agentId || msg.toAgentId === agentId,
			)
		}
		return await this.messagesStorage.readAll()
	}

	async getMessagesByCorrelation(correlationId: string): Promise<MessageEntry[]> {
		return await this.messagesStorage.readFiltered((msg) => msg.correlationId === correlationId)
	}

	async getRecentMessages(count: number): Promise<MessageEntry[]> {
		return await this.messagesStorage.readLast(count)
	}

	async clearMessages(): Promise<void> {
		await this.messagesStorage.clear()
	}

	/**
	 * Approval operations
	 */
	async recordApproval(approval: Omit<ApprovalEntry, "timestamp">): Promise<void> {
		await this.approvalsStorage.append({
			timestamp: Date.now(),
			...approval,
		})
	}

	async getApprovals(agentId?: string): Promise<ApprovalEntry[]> {
		if (agentId) {
			return await this.approvalsStorage.readFiltered((approval) => approval.agentId === agentId)
		}
		return await this.approvalsStorage.readAll()
	}

	async getApprovalHistory(agentId: string, tool: string): Promise<ApprovalEntry[]> {
		return await this.approvalsStorage.readFiltered(
			(approval) => approval.agentId === agentId && approval.tool === tool,
		)
	}

	async clearApprovals(): Promise<void> {
		await this.approvalsStorage.clear()
	}

	/**
	 * Get storage statistics
	 */
	async getStats(): Promise<{
		registryEntries: number
		messages: number
		approvals: number
	}> {
		const [registryEntries, messages, approvals] = await Promise.all([
			this.registryStorage.count(),
			this.messagesStorage.count(),
			this.approvalsStorage.count(),
		])

		return { registryEntries, messages, approvals }
	}

	/**
	 * Clear all storage
	 */
	async clearAll(): Promise<void> {
		await Promise.all([this.registryStorage.clear(), this.messagesStorage.clear(), this.approvalsStorage.clear()])
	}
}
