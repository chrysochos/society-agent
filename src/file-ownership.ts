/**
 * File Ownership Manager - Canonical File Ownership (Proposal 4)
 *
 * Tracks which agent owns which files and enforces ownership rules.
 * Provides handoff protocol for transferring ownership between agents.
 */

import * as fs from "fs/promises"
import * as path from "path"
import { getLog } from "./logger"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Ownership status of a file
 */
export type OwnershipStatus = "owned" | "shared" | "transferred" | "archived"

/**
 * File ownership record
 */
export interface FileOwnership {
	/** Relative path from project root */
	path: string

	/** Agent ID that owns this file */
	owner: string

	/** Ownership status */
	status: OwnershipStatus

	/** Brief description of the file */
	description?: string

	/** When ownership was established */
	ownedSince: string

	/** Task ID that created this file (if known) */
	createdByTask?: string

	/** Last modified timestamp */
	lastModified?: string

	/** Previous owners (for tracking history) */
	previousOwners?: Array<{
		owner: string
		from: string
		to: string
		reason?: string
	}>
}

/**
 * Shared file configuration
 */
export interface SharedFileConfig {
	/** Path or pattern (can use glob-like syntax) */
	pattern: string

	/** Agent IDs that can modify this path */
	owners: string[]

	/** Rule for coordination (e.g., "notify", "lock", "merge") */
	coordinationRule: "notify" | "lock" | "merge"

	/** Description of why this is shared */
	reason?: string
}

/**
 * Handoff request for transferring ownership
 */
export interface OwnershipHandoff {
	/** Unique handoff ID */
	id: string

	/** File path being transferred */
	path: string

	/** Current owner */
	fromAgent: string

	/** Requested new owner */
	toAgent: string

	/** Why the transfer is needed */
	reason: string

	/** Related task ID */
	taskId?: string

	/** Request timestamp */
	requestedAt: string

	/** Who approved (if approved) */
	approvedBy?: string

	/** When approved/denied */
	respondedAt?: string

	/** Status */
	status: "pending" | "approved" | "denied" | "completed" | "cancelled"

	/** Denial reason (if denied) */
	denialReason?: string
}

/**
 * Full ownership registry for a project
 */
export interface OwnershipRegistry {
	/** Individual file ownership records */
	files: FileOwnership[]

	/** Shared file configurations */
	shared: SharedFileConfig[]

	/** Pending and historical handoffs */
	handoffs: OwnershipHandoff[]

	/** Last time registry was synced with filesystem */
	lastSyncedAt?: string
}

/**
 * Result of checking if an agent can modify a file
 */
export interface CanModifyResult {
	/** Whether modification is allowed */
	allowed: boolean

	/** If allowed, what type of access */
	accessType?: "owner" | "shared" | "handoff" | "new"

	/** If not allowed, why */
	reason?: string

	/** Current owner (if any) */
	owner?: string

	/** Required action to gain access */
	requiredAction?: "request-handoff" | "notify-owners" | "wait-for-handoff"
}

// ============================================================================
// REGISTRY OPERATIONS
// ============================================================================

/**
 * Create an empty ownership registry
 */
export function createOwnershipRegistry(): OwnershipRegistry {
	return {
		files: [],
		shared: [],
		handoffs: [],
	}
}

/**
 * Check if an agent can modify a file
 */
export function canModifyFile(
	agentId: string,
	filePath: string,
	registry: OwnershipRegistry
): CanModifyResult {
	// Normalize path
	const normalizedPath = filePath.replace(/\\/g, "/")

	// Check direct ownership
	const ownership = registry.files.find((f) => f.path === normalizedPath)

	if (!ownership) {
		// New file - agent becomes owner
		return {
			allowed: true,
			accessType: "new",
		}
	}

	if (ownership.owner === agentId) {
		return {
			allowed: true,
			accessType: "owner",
		}
	}

	// Check shared files
	for (const shared of registry.shared) {
		if (matchesPattern(normalizedPath, shared.pattern)) {
			if (shared.owners.includes(agentId)) {
				return {
					allowed: true,
					accessType: "shared",
					reason:
						shared.coordinationRule === "notify"
							? `Shared file - notify other owners: ${shared.owners.filter((o) => o !== agentId).join(", ")}`
							: undefined,
				}
			}
		}
	}

	// Check approved handoffs
	const handoff = registry.handoffs.find(
		(h) =>
			h.path === normalizedPath &&
			h.toAgent === agentId &&
			h.status === "approved"
	)

	if (handoff) {
		return {
			allowed: true,
			accessType: "handoff",
		}
	}

	// Check pending handoff
	const pendingHandoff = registry.handoffs.find(
		(h) =>
			h.path === normalizedPath &&
			h.toAgent === agentId &&
			h.status === "pending"
	)

	if (pendingHandoff) {
		return {
			allowed: false,
			reason: `Handoff pending approval from ${ownership.owner}`,
			owner: ownership.owner,
			requiredAction: "wait-for-handoff",
		}
	}

	return {
		allowed: false,
		reason: `File owned by ${ownership.owner}. Request handoff or ask supervisor.`,
		owner: ownership.owner,
		requiredAction: "request-handoff",
	}
}

/**
 * Simple pattern matching (supports * and **)
 */
function matchesPattern(filePath: string, pattern: string): boolean {
	// Convert glob pattern to regex
	const regexPattern = pattern
		.replace(/\*\*/g, "<<<DOUBLESTAR>>>")
		.replace(/\*/g, "[^/]*")
		.replace(/<<<DOUBLESTAR>>>/g, ".*")
		.replace(/\?/g, ".")

	return new RegExp(`^${regexPattern}$`).test(filePath)
}

/**
 * Register ownership of a new file
 */
export function registerFileOwnership(
	registry: OwnershipRegistry,
	filePath: string,
	owner: string,
	options: {
		description?: string
		taskId?: string
	} = {}
): FileOwnership {
	const normalizedPath = filePath.replace(/\\/g, "/")
	const now = new Date().toISOString()

	// Check if already registered
	const existing = registry.files.find((f) => f.path === normalizedPath)
	if (existing) {
		getLog().warn(`[FileOwnership] File already registered: ${normalizedPath} (owner: ${existing.owner})`)
		return existing
	}

	const ownership: FileOwnership = {
		path: normalizedPath,
		owner,
		status: "owned",
		description: options.description,
		ownedSince: now,
		createdByTask: options.taskId,
		lastModified: now,
	}

	registry.files.push(ownership)
	getLog().debug(`[FileOwnership] Registered ${normalizedPath} → ${owner}`)

	return ownership
}

/**
 * Register a batch of files for an owner
 */
export function registerFileBatch(
	registry: OwnershipRegistry,
	filePaths: string[],
	owner: string,
	taskId?: string
): FileOwnership[] {
	return filePaths.map((fp) =>
		registerFileOwnership(registry, fp, owner, { taskId })
	)
}

/**
 * Update file's last modified timestamp
 */
export function recordFileModification(
	registry: OwnershipRegistry,
	filePath: string,
	agentId: string
): void {
	const normalizedPath = filePath.replace(/\\/g, "/")
	const ownership = registry.files.find((f) => f.path === normalizedPath)

	if (ownership) {
		ownership.lastModified = new Date().toISOString()
	}
}

/**
 * Get the owner of a file
 */
export function getFileOwner(registry: OwnershipRegistry, filePath: string): string | undefined {
	const normalizedPath = filePath.replace(/\\/g, "/")
	return registry.files.find((f) => f.path === normalizedPath)?.owner
}

/**
 * Get all files owned by an agent
 */
export function getFilesOwnedBy(registry: OwnershipRegistry, agentId: string): FileOwnership[] {
	return registry.files.filter((f) => f.owner === agentId && f.status === "owned")
}

/**
 * Configure shared files
 */
export function addSharedConfig(
	registry: OwnershipRegistry,
	config: SharedFileConfig
): void {
	// Remove existing config for same pattern
	registry.shared = registry.shared.filter((s) => s.pattern !== config.pattern)
	registry.shared.push(config)
}

// ============================================================================
// HANDOFF OPERATIONS
// ============================================================================

let handoffCounter = 0

/**
 * Request ownership handoff
 */
export function requestHandoff(
	registry: OwnershipRegistry,
	filePath: string,
	fromAgent: string,
	toAgent: string,
	reason: string,
	taskId?: string
): OwnershipHandoff {
	const normalizedPath = filePath.replace(/\\/g, "/")
	handoffCounter++

	const handoff: OwnershipHandoff = {
		id: `HO-${Date.now()}-${handoffCounter}`,
		path: normalizedPath,
		fromAgent,
		toAgent,
		reason,
		taskId,
		requestedAt: new Date().toISOString(),
		status: "pending",
	}

	registry.handoffs.push(handoff)
	getLog().info(`[FileOwnership] Handoff requested: ${normalizedPath} ${fromAgent} → ${toAgent}`)

	return handoff
}

/**
 * Approve a handoff request
 */
export function approveHandoff(
	registry: OwnershipRegistry,
	handoffId: string,
	approverId: string
): OwnershipHandoff {
	const handoff = registry.handoffs.find((h) => h.id === handoffId)
	if (!handoff) {
		throw new Error(`Handoff not found: ${handoffId}`)
	}

	if (handoff.status !== "pending") {
		throw new Error(`Handoff already ${handoff.status}`)
	}

	handoff.status = "approved"
	handoff.approvedBy = approverId
	handoff.respondedAt = new Date().toISOString()

	getLog().info(`[FileOwnership] Handoff approved: ${handoffId} by ${approverId}`)

	return handoff
}

/**
 * Deny a handoff request
 */
export function denyHandoff(
	registry: OwnershipRegistry,
	handoffId: string,
	approverId: string,
	reason: string
): OwnershipHandoff {
	const handoff = registry.handoffs.find((h) => h.id === handoffId)
	if (!handoff) {
		throw new Error(`Handoff not found: ${handoffId}`)
	}

	if (handoff.status !== "pending") {
		throw new Error(`Handoff already ${handoff.status}`)
	}

	handoff.status = "denied"
	handoff.approvedBy = approverId
	handoff.respondedAt = new Date().toISOString()
	handoff.denialReason = reason

	getLog().info(`[FileOwnership] Handoff denied: ${handoffId} - ${reason}`)

	return handoff
}

/**
 * Complete a handoff (actually transfer ownership)
 */
export function completeHandoff(
	registry: OwnershipRegistry,
	handoffId: string
): FileOwnership {
	const handoff = registry.handoffs.find((h) => h.id === handoffId)
	if (!handoff) {
		throw new Error(`Handoff not found: ${handoffId}`)
	}

	if (handoff.status !== "approved") {
		throw new Error(`Handoff not approved, status: ${handoff.status}`)
	}

	// Find ownership record
	const ownership = registry.files.find((f) => f.path === handoff.path)
	if (!ownership) {
		throw new Error(`File not found in registry: ${handoff.path}`)
	}

	// Record history
	ownership.previousOwners = ownership.previousOwners ?? []
	ownership.previousOwners.push({
		owner: ownership.owner,
		from: ownership.ownedSince,
		to: new Date().toISOString(),
		reason: handoff.reason,
	})

	// Transfer ownership
	ownership.owner = handoff.toAgent
	ownership.ownedSince = new Date().toISOString()
	ownership.status = "owned"

	// Mark handoff complete
	handoff.status = "completed"

	getLog().info(`[FileOwnership] Handoff completed: ${handoff.path} → ${handoff.toAgent}`)

	return ownership
}

/**
 * Get pending handoffs for an approver
 */
export function getPendingHandoffs(
	registry: OwnershipRegistry,
	approverAgentId: string
): OwnershipHandoff[] {
	return registry.handoffs.filter(
		(h) => h.status === "pending" && h.fromAgent === approverAgentId
	)
}

/**
 * Get handoffs waiting for an agent to accept
 */
export function getIncomingHandoffs(
	registry: OwnershipRegistry,
	agentId: string
): OwnershipHandoff[] {
	return registry.handoffs.filter(
		(h) => h.status === "approved" && h.toAgent === agentId
	)
}

// ============================================================================
// FILES.MD GENERATION
// ============================================================================

/**
 * Generate FILES.md content from registry
 */
export function generateFilesMd(registry: OwnershipRegistry, projectName?: string): string {
	const lines: string[] = [
		`# ${projectName ?? "Project"} - File Ownership Registry`,
		"",
		"*Canonical source of file ownership. Update when creating or modifying files.*",
		"",
		"## File Ownership",
		"",
		"| File | Owner | Description | Last Modified |",
		"|------|-------|-------------|---------------|",
	]

	// Sort files by path
	const sortedFiles = [...registry.files].sort((a, b) => a.path.localeCompare(b.path))

	for (const file of sortedFiles) {
		if (file.status === "owned" || file.status === "shared") {
			const desc = file.description ?? ""
			const modified = file.lastModified?.split("T")[0] ?? "-"
			lines.push(`| ${file.path} | ${file.owner} | ${desc} | ${modified} |`)
		}
	}

	// Shared files section
	if (registry.shared.length > 0) {
		lines.push("")
		lines.push("## Shared Files")
		lines.push("")
		lines.push("| Pattern | Owners | Coordination |")
		lines.push("|---------|--------|--------------|")

		for (const shared of registry.shared) {
			lines.push(`| ${shared.pattern} | ${shared.owners.join(", ")} | ${shared.coordinationRule} |`)
		}
	}

	// Pending handoffs section
	const pending = registry.handoffs.filter((h) => h.status === "pending" || h.status === "approved")
	if (pending.length > 0) {
		lines.push("")
		lines.push("## Pending Transfers")
		lines.push("")
		lines.push("| File | From | To | Status | Reason |")
		lines.push("|------|------|-----|--------|--------|")

		for (const handoff of pending) {
			lines.push(`| ${handoff.path} | ${handoff.fromAgent} | ${handoff.toAgent} | ${handoff.status} | ${handoff.reason} |`)
		}
	}

	lines.push("")
	lines.push(`*Last updated: ${new Date().toISOString()}*`)

	return lines.join("\n")
}

/**
 * Write FILES.md to disk
 */
export async function writeFilesMd(projectDir: string, registry: OwnershipRegistry, projectName?: string): Promise<void> {
	const content = generateFilesMd(registry, projectName)
	const filesPath = path.join(projectDir, "FILES.md")
	await fs.writeFile(filesPath, content, "utf-8")
	getLog().debug(`[FileOwnership] Updated FILES.md`)
}

/**
 * Parse FILES.md into registry
 */
export async function parseFilesMd(projectDir: string): Promise<OwnershipRegistry> {
	const registry = createOwnershipRegistry()
	const filesPath = path.join(projectDir, "FILES.md")

	try {
		const content = await fs.readFile(filesPath, "utf-8")
		const lines = content.split("\n")

		// States for parsing
		let section: "files" | "shared" | "transfers" | null = null

		for (const line of lines) {
			// Detect section
			if (line.includes("## File Ownership")) {
				section = "files"
				continue
			}
			if (line.includes("## Shared Files")) {
				section = "shared"
				continue
			}
			if (line.includes("## Pending Transfers")) {
				section = "transfers"
				continue
			}

			// Parse table rows
			const tableMatch = line.match(/^\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]*)\s*\|\s*([^|]*)\s*\|/)
			if (!tableMatch) continue

			const [, col1, col2, col3, col4] = tableMatch.map((s) => s?.trim())

			// Skip header and separator rows
			if (col1 === "File" || col1 === "Pattern" || col1?.startsWith("-")) continue

			if (section === "files") {
				registry.files.push({
					path: col1,
					owner: col2,
					status: "owned",
					description: col3 || undefined,
					ownedSince: new Date().toISOString(), // Unknown from file
					lastModified: col4 !== "-" ? col4 : undefined,
				})
			} else if (section === "shared") {
				registry.shared.push({
					pattern: col1,
					owners: col2.split(",").map((o) => o.trim()),
					coordinationRule: (col3 as SharedFileConfig["coordinationRule"]) || "notify",
				})
			}
		}
	} catch (err) {
		getLog().debug(`[FileOwnership] No existing FILES.md found at ${filesPath}`)
	}

	return registry
}

// ============================================================================
// ENFORCEMENT
// ============================================================================

/**
 * Result of an ownership check
 */
export interface OwnershipCheckResult {
	file: string
	allowed: boolean
	owner?: string
	violation?: string
	suggestedAction?: string
}

/**
 * Check a list of files an agent wants to modify
 */
export function checkFileModifications(
	agentId: string,
	filePaths: string[],
	registry: OwnershipRegistry
): OwnershipCheckResult[] {
	return filePaths.map((filePath) => {
		const result = canModifyFile(agentId, filePath, registry)
		return {
			file: filePath,
			allowed: result.allowed,
			owner: result.owner,
			violation: result.allowed ? undefined : result.reason,
			suggestedAction: result.requiredAction,
		}
	})
}

/**
 * Get ownership violation report for agent prompt injection
 */
export function getOwnershipPromptSection(
	agentId: string,
	registry: OwnershipRegistry
): string {
	const ownedFiles = getFilesOwnedBy(registry, agentId)
	const pending = getPendingHandoffs(registry, agentId)
	const incoming = getIncomingHandoffs(registry, agentId)

	const lines: string[] = ["## File Ownership Rules", ""]

	if (ownedFiles.length > 0) {
		lines.push("### Files You Own")
		lines.push("You can freely modify these files:")
		for (const file of ownedFiles.slice(0, 20)) {
			lines.push(`- \`${file.path}\``)
		}
		if (ownedFiles.length > 20) {
			lines.push(`- ... and ${ownedFiles.length - 20} more`)
		}
		lines.push("")
	}

	if (pending.length > 0) {
		lines.push("### Pending Handoff Requests")
		lines.push("Other agents want ownership of your files:")
		for (const h of pending) {
			lines.push(`- **${h.path}** → ${h.toAgent}: ${h.reason}`)
		}
		lines.push("")
	}

	if (incoming.length > 0) {
		lines.push("### Incoming Handoffs")
		lines.push("You have approved access to:")
		for (const h of incoming) {
			lines.push(`- **${h.path}** (from ${h.fromAgent})`)
		}
		lines.push("")
	}

	lines.push("### Rules")
	lines.push("1. Before modifying a file, check if you own it")
	lines.push("2. For new files, register ownership in FILES.md")
	lines.push("3. To modify someone else's file, request a handoff")
	lines.push("4. Shared files require notifying other owners")
	lines.push("")

	return lines.join("\n")
}

// ============================================================================
// SYNC WITH FILESYSTEM
// ============================================================================

/**
 * Sync registry with actual filesystem
 * Finds untracked files and removed files
 */
export async function syncRegistryWithFilesystem(
	projectDir: string,
	registry: OwnershipRegistry,
	options: {
		maxFiles?: number
		ignoreDirs?: string[]
	} = {}
): Promise<{
	untracked: string[]
	removed: string[]
	matched: number
}> {
	const { maxFiles = 1000, ignoreDirs = ["node_modules", ".git", "dist", "build"] } = options

	const trackedPaths = new Set(registry.files.map((f) => f.path))
	const foundFiles: Set<string> = new Set()

	// Scan filesystem
	async function walk(dir: string, depth = 0): Promise<void> {
		if (depth > 10 || foundFiles.size >= maxFiles) return

		try {
			const entries = await fs.readdir(dir, { withFileTypes: true })
			for (const entry of entries) {
				if (foundFiles.size >= maxFiles) break

				if (entry.isDirectory()) {
					if (!ignoreDirs.includes(entry.name) && !entry.name.startsWith(".")) {
						await walk(path.join(dir, entry.name), depth + 1)
					}
				} else {
					const relativePath = path.relative(projectDir, path.join(dir, entry.name)).replace(/\\/g, "/")
					foundFiles.add(relativePath)
				}
			}
		} catch {
			// Skip inaccessible directories
		}
	}

	await walk(projectDir)

	// Find untracked (in filesystem but not registry)
	const untracked: string[] = []
	for (const file of Array.from(foundFiles)) {
		if (!trackedPaths.has(file)) {
			untracked.push(file)
		}
	}

	// Find removed (in registry but not filesystem)
	const removed: string[] = []
	for (const tracked of Array.from(trackedPaths)) {
		if (!foundFiles.has(tracked)) {
			removed.push(tracked)
		}
	}

	const matched = trackedPaths.size - removed.length

	return { untracked, removed, matched }
}
