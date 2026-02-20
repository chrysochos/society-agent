// Society Agent - new file
/**
 * AgentDirectory - Agent discovery and supervision chain resolution
 *
 * Solves the "how do agents know each other?" problem:
 *
 * 1. Each agent publishes itself to .society-agent/directory.json on startup
 * 2. Agents query the directory by role, capability, domain, or supervisor
 * 3. SupervisionChain resolves the escalation path: agent → supervisor → ... → human
 *
 * The directory is a shared JSON file (not JSONL) for atomic reads.
 * Writes are append-like: read → merge → write (with file lock via rename).
 */

import * as fs from "fs/promises"
import * as path from "path"
import { getLog } from "./logger"
import type {
	AgentDirectoryEntry,
	AgentRole,
	AgentCapability,
	AgentLifecycle,
	SupervisionChain,
} from "./types"

export interface AgentDirectoryConfig {
	/** Path to .society-agent/ shared directory */
	sharedDir: string
	/** How often to refresh the cache (ms). Default: 5000 */
	refreshIntervalMs?: number
}

interface DirectoryFile {
	version: 1
	updatedAt: string
	agents: Record<string, AgentDirectoryEntry>
}

export class AgentDirectory {
	private sharedDir: string
	private directoryPath: string
	private cache: Map<string, AgentDirectoryEntry> = new Map()
	private refreshInterval: NodeJS.Timeout | undefined
	private refreshIntervalMs: number

	constructor(config: AgentDirectoryConfig) {
		this.sharedDir = config.sharedDir
		this.directoryPath = path.join(config.sharedDir, "directory.json")
		this.refreshIntervalMs = config.refreshIntervalMs ?? 5000
	}

	/**
	 * Initialize: load existing directory, start cache refresh
	 */
	async initialize(): Promise<void> {
		await fs.mkdir(this.sharedDir, { recursive: true })
		await this.refreshCache()

		this.refreshInterval = setInterval(() => {
			this.refreshCache().catch((err) => {
				getLog().error("[AgentDirectory] Cache refresh failed:", err)
			})
		}, this.refreshIntervalMs)

		getLog().info(`[AgentDirectory] Initialized with ${this.cache.size} agents`)
	}

	// ─── Publishing ───────────────────────────────────────────────

	/**
	 * Publish (register/update) an agent entry in the directory
	 */
	async publish(entry: AgentDirectoryEntry): Promise<void> {
		const dir = await this.readDirectoryFile()
		dir.agents[entry.agentId] = {
			...entry,
			lastSeen: new Date().toISOString(),
		}
		await this.writeDirectoryFile(dir)
		this.cache.set(entry.agentId, dir.agents[entry.agentId])
		getLog().info(`[AgentDirectory] Published ${entry.agentId} (${entry.role})`)
	}

	/**
	 * Update agent status and heartbeat
	 */
	async heartbeat(agentId: string, status?: AgentDirectoryEntry["status"]): Promise<void> {
		const dir = await this.readDirectoryFile()
		const existing = dir.agents[agentId]
		if (existing) {
			existing.lastSeen = new Date().toISOString()
			if (status) existing.status = status
			await this.writeDirectoryFile(dir)
			this.cache.set(agentId, existing)
		}
	}

	/**
	 * Remove agent from directory (on shutdown)
	 */
	async unpublish(agentId: string): Promise<void> {
		const dir = await this.readDirectoryFile()
		delete dir.agents[agentId]
		await this.writeDirectoryFile(dir)
		this.cache.delete(agentId)
		getLog().info(`[AgentDirectory] Unpublished ${agentId}`)
	}

	// ─── Discovery queries ────────────────────────────────────────

	/**
	 * Get a specific agent by ID
	 */
	getAgent(agentId: string): AgentDirectoryEntry | undefined {
		return this.cache.get(agentId)
	}

	/**
	 * Get all agents currently in the directory
	 */
	getAllAgents(): AgentDirectoryEntry[] {
		return Array.from(this.cache.values())
	}

	/**
	 * Find agents by role
	 */
	findByRole(role: AgentRole): AgentDirectoryEntry[] {
		return this.getAllAgents().filter((a) => a.role === role)
	}

	/**
	 * Find agents by capability — returns agents that have ALL requested capabilities
	 */
	findByCapability(...capabilities: AgentCapability[]): AgentDirectoryEntry[] {
		return this.getAllAgents().filter((a) =>
			capabilities.every((cap) => a.capabilities.includes(cap)),
		)
	}

	/**
	 * Find agents by domain specialty
	 */
	findByDomain(domain: string): AgentDirectoryEntry[] {
		return this.getAllAgents().filter((a) => a.domain === domain)
	}

	/**
	 * Find agents supervised by a specific supervisor
	 */
	findBySupervisor(supervisorId: string): AgentDirectoryEntry[] {
		return this.getAllAgents().filter((a) => a.supervisorId === supervisorId)
	}

	/**
	 * Find agents by lifecycle mode
	 */
	findByLifecycle(lifecycle: AgentLifecycle): AgentDirectoryEntry[] {
		return this.getAllAgents().filter((a) => a.lifecycle === lifecycle)
	}

	/**
	 * Find online agents (heartbeat within last 2 minutes)
	 */
	getOnlineAgents(): AgentDirectoryEntry[] {
		const cutoff = Date.now() - 2 * 60 * 1000
		return this.getAllAgents().filter(
			(a) => a.status !== "offline" && new Date(a.lastSeen).getTime() > cutoff,
		)
	}

	/**
	 * Find who an agent can talk to:
	 * - Its supervisor
	 * - Its peers (same supervisor)
	 * - Agents it supervises (if it's a supervisor)
	 */
	getContactsFor(agentId: string): {
		supervisor: AgentDirectoryEntry | undefined
		peers: AgentDirectoryEntry[]
		subordinates: AgentDirectoryEntry[]
	} {
		const agent = this.cache.get(agentId)
		if (!agent) {
			return { supervisor: undefined, peers: [], subordinates: [] }
		}

		const supervisor = agent.supervisorId !== "human"
			? this.cache.get(agent.supervisorId)
			: undefined

		const peers = this.getAllAgents().filter(
			(a) => a.agentId !== agentId && a.supervisorId === agent.supervisorId,
		)

		const subordinates = this.findBySupervisor(agentId)

		return { supervisor, peers, subordinates }
	}

	// ─── Human + External work ────────────────────────────────────

	/**
	 * Find VS Code instances where a human is present.
	 * These can receive direct instructions bypassing the supervisor chain.
	 */
	getHumanPresentNodes(): AgentDirectoryEntry[] {
		return this.getAllAgents().filter((a) => a.humanPresent)
	}

	/**
	 * Find VS Code instances that accept external work (from any agent, not just supervisor).
	 * A human at a VS Code can always accept work; agents can opt in via config.
	 */
	getExternalWorkAcceptors(): AgentDirectoryEntry[] {
		return this.getAllAgents().filter((a) => a.acceptsExternalWork || a.humanPresent)
	}

	/**
	 * Check if an agent can send work to another agent.
	 *
	 * Rules:
	 * 1. Supervisor can always send to subordinates (regular chain)
	 * 2. Any agent can send to nodes that accept external work
	 * 3. Human-present nodes accept from anyone
	 * 4. Peers can message each other (same supervisor)
	 */
	canSendWorkTo(fromId: string, toId: string): boolean {
		const target = this.cache.get(toId)
		if (!target) return false

		// Human-present nodes accept from anyone
		if (target.humanPresent) return true

		// Target explicitly accepts external work
		if (target.acceptsExternalWork) return true

		// Supervisor → subordinate (regular chain)
		if (target.supervisorId === fromId) return true

		// Peers (same supervisor) can message each other
		const from = this.cache.get(fromId)
		if (from && from.supervisorId === target.supervisorId) return true

		// Transitive supervision
		if (this.isSupervisorOf(fromId, toId)) return true

		return false
	}

	// ─── Supervision chain ────────────────────────────────────────

	/**
	 * Resolve the supervision chain from an agent up to the human.
	 *
	 * Example: worker-abc → supervisor-main → human
	 *
	 * Used for:
	 * - Escalation routing (who to ask next)
	 * - Permission inheritance (supervisor can override worker)
	 * - Audit trails (who authorized what)
	 */
	resolveSupervisionChain(agentId: string): SupervisionChain {
		const chain: string[] = []
		const visited = new Set<string>() // cycle detection
		let currentId: string | undefined = agentId

		while (currentId && currentId !== "human") {
			if (visited.has(currentId)) {
				getLog().warn(`[AgentDirectory] Cycle detected in supervision chain at ${currentId}`)
				break
			}
			visited.add(currentId)
			chain.push(currentId)

			const agent = this.cache.get(currentId)
			if (!agent) {
				// Agent not found — assume reports to human
				break
			}
			currentId = agent.supervisorId
		}

		chain.push("human")

		return {
			chain,
			humanNodeId: "human",
		}
	}

	/**
	 * Check if agentA supervises agentB (directly or transitively)
	 */
	isSupervisorOf(supervisorId: string, agentId: string): boolean {
		const chain = this.resolveSupervisionChain(agentId)
		const idx = chain.chain.indexOf(supervisorId)
		const agentIdx = chain.chain.indexOf(agentId)
		// supervisorId must appear AFTER agentId in the chain (i.e., higher in hierarchy)
		return idx > agentIdx
	}

	/**
	 * Get the next escalation target for an agent.
	 * Returns the immediate supervisor, or "human" if at top.
	 */
	getEscalationTarget(agentId: string): string {
		const agent = this.cache.get(agentId)
		return agent?.supervisorId || "human"
	}

	// ─── File I/O ─────────────────────────────────────────────────

	/**
	 * Read directory file (or create empty)
	 */
	private async readDirectoryFile(): Promise<DirectoryFile> {
		try {
			const content = await fs.readFile(this.directoryPath, "utf-8")
			return JSON.parse(content) as DirectoryFile
		} catch {
			return {
				version: 1,
				updatedAt: new Date().toISOString(),
				agents: {},
			}
		}
	}

	/**
	 * Write directory file atomically (write-to-temp then rename)
	 */
	private async writeDirectoryFile(dir: DirectoryFile): Promise<void> {
		dir.updatedAt = new Date().toISOString()
		const tmpPath = this.directoryPath + ".tmp"
		await fs.writeFile(tmpPath, JSON.stringify(dir, null, 2), "utf-8")
		await fs.rename(tmpPath, this.directoryPath)
	}

	/**
	 * Refresh the in-memory cache from disk
	 */
	private async refreshCache(): Promise<void> {
		const dir = await this.readDirectoryFile()
		this.cache.clear()
		for (const [id, entry] of Object.entries(dir.agents)) {
			this.cache.set(id, entry)
		}
	}

	// ─── Lifecycle ────────────────────────────────────────────────

	/**
	 * Dispose: stop cache refresh
	 */
	dispose(): void {
		if (this.refreshInterval) {
			clearInterval(this.refreshInterval)
			this.refreshInterval = undefined
		}
	}
}
