/**
 * Task Manager - Stable Task IDs and State Machine
 *
 * Implements Proposals 1 and 2 from IMPROVEMENT_PROPOSALS.md:
 * - Stable Task IDs with T-PREFIX-NNN format
 * - 9-state task state machine with validated transitions
 * - Task execution logging
 * - Blocking reason tracking
 */

import * as fs from "fs/promises"
import * as path from "path"
import { getLog } from "./logger"

// ============================================================================
// TASK STATUS TYPES
// ============================================================================

/**
 * Extended task status with 9 states
 *
 * State machine transitions:
 *
 *                     ┌─────────────┐
 *                     │   planned   │
 *                     └──────┬──────┘
 *                            │ delegate
 *                     ┌──────▼──────┐
 *           ┌─────────│  delegated  │◄────────┐
 *           │ reject  └──────┬──────┘ return  │
 *           │                │ accept          │
 *           │         ┌──────▼──────┐         │
 *           │         │ in_progress │─────────┼─── blocked
 *           │         └──────┬──────┘         │
 *           │                │ complete       │ unblock
 *           │         ┌──────▼──────┐         │
 *           │         │   review    │─────────┘
 *           │         └──────┬──────┘
 *           │                │ approve
 *           │         ┌──────▼──────┐
 *           └────────►│    done     │
 *                     └──────┬──────┘
 *                            │ verify
 *                     ┌──────▼──────┐
 *                     │  verified   │
 *                     └─────────────┘
 */
export type TaskStatus =
	| "planned" // Created but not yet assigned
	| "delegated" // Assigned to an agent, awaiting acceptance
	| "in_progress" // Agent actively working
	| "blocked" // Cannot proceed, waiting for something
	| "review" // Work complete, awaiting verification
	| "done" // Accepted by delegator
	| "verified" // Independently verified (tests pass, commit exists)
	| "failed" // Terminated unsuccessfully
	| "cancelled" // Intentionally abandoned

/**
 * A transition event in task history
 */
export interface TaskStatusTransition {
	from: TaskStatus
	to: TaskStatus
	triggeredBy: string // Agent ID
	timestamp: string // ISO timestamp
	reason?: string // Why the transition happened
	metadata?: {
		commitHash?: string
		filesChanged?: string[]
		blockedBy?: string // Task ID that blocks this one
		blockReason?: string
		verificationResult?: VerificationCheckResult[]
	}
}

/**
 * Result of a verification check
 */
export interface VerificationCheckResult {
	check: string
	passed: boolean
	message?: string
}

/**
 * Full verification result for a task
 */
export interface VerificationResult {
	taskId: string
	timestamp: string
	allPassed: boolean
	checks: VerificationCheckResult[]
	commitHash?: string
}

/**
 * Blocking reason as first-class data (Proposal 7)
 */
export interface BlockingReason {
	/** What type of blocker this is */
	type: "dependency" | "question" | "resource" | "external" | "approval"
	/** Human-readable description */
	description: string
	/** Task ID that blocks this one (for dependency type) */
	blockedByTaskId?: string
	/** Question that needs answering (for question type) */
	question?: string
	/** Who can unblock this (agent ID or "human") */
	unblockRequires?: string
	/** When this blocker was created */
	since: string
	/** Expected resolution time (if known) */
	expectedResolution?: string
}

// ============================================================================
// TASK ID GENERATION
// ============================================================================

/**
 * Generate a stable task ID
 *
 * Format: T-{PREFIX}-{SEQUENCE}[-{SUFFIX}]
 *
 * Examples:
 * - T-ARCH-001     (Architect, task 1)
 * - T-ARCH-001-A   (Subtask A of task 1)
 * - T-BE-015       (Backend, task 15)
 *
 * @param projectPrefix - Short project/agent prefix (e.g., "ARCH", "BE", "FE")
 * @param sequence - Task sequence number
 * @param suffix - Optional suffix for subtasks (e.g., "A", "B", "RETRY")
 */
export function generateTaskId(projectPrefix: string, sequence: number, suffix?: string): string {
	// Normalize prefix: uppercase, remove special chars, limit to 6 chars
	const normalizedPrefix = projectPrefix.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)
	const paddedSequence = sequence.toString().padStart(3, "0")
	const base = `T-${normalizedPrefix}-${paddedSequence}`
	return suffix ? `${base}-${suffix.toUpperCase()}` : base
}

/**
 * Parse a task ID into its components
 */
export function parseTaskId(taskId: string): {
	prefix: string
	sequence: number
	suffix?: string
} | null {
	const match = taskId.match(/^T-([A-Z0-9]+)-(\d{3})(?:-([A-Z0-9]+))?$/)
	if (!match) return null

	return {
		prefix: match[1],
		sequence: parseInt(match[2], 10),
		suffix: match[3],
	}
}

/**
 * Check if a string is a valid task ID format
 */
export function isValidTaskId(taskId: string): boolean {
	return /^T-[A-Z0-9]{1,6}-\d{3}(-[A-Z0-9]+)?$/.test(taskId)
}

/**
 * Generate prefix from agent/project name
 *
 * Rules:
 * - Use uppercase initials
 * - Remove vowels if too long
 * - Max 4 characters
 */
export function generatePrefix(name: string): string {
	// Remove common suffixes
	let clean = name.replace(/[-_]?(agent|specialist|worker|manager)$/i, "").trim()

	// Try using initials for multi-word names
	const words = clean.split(/[-_\s]+/)
	if (words.length > 1) {
		const initials = words.map((w) => w[0]).join("")
		if (initials.length >= 2 && initials.length <= 4) {
			return initials.toUpperCase()
		}
	}

	// Single word: use first 4 chars, removing vowels if needed
	clean = clean.toUpperCase().replace(/[^A-Z0-9]/g, "")
	if (clean.length <= 4) {
		return clean
	}

	// Remove vowels to shorten
	const noVowels = clean.replace(/[AEIOU]/g, "")
	if (noVowels.length >= 2) {
		return noVowels.slice(0, 4)
	}

	return clean.slice(0, 4)
}

// ============================================================================
// STATE MACHINE
// ============================================================================

/**
 * Valid state transitions
 * Key: current state -> Value: array of allowed next states
 */
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
	planned: ["delegated", "cancelled", "in_progress"], // Can skip delegation for self-work
	delegated: ["in_progress", "planned", "cancelled"], // Accept, reject, or cancel
	in_progress: ["blocked", "review", "failed", "cancelled"],
	blocked: ["in_progress", "failed", "cancelled"], // Unblock, give up, or cancel
	review: ["done", "in_progress", "blocked"], // Approve, reject for rework, or block
	done: ["verified", "in_progress"], // Verify or reopen
	verified: [], // Terminal state
	failed: ["planned", "cancelled"], // Retry or give up
	cancelled: [], // Terminal state
}

/**
 * Terminal states - no further transitions allowed
 */
export const TERMINAL_STATES: TaskStatus[] = ["verified", "cancelled"]

/**
 * Active states - work is happening
 */
export const ACTIVE_STATES: TaskStatus[] = ["delegated", "in_progress", "review"]

/**
 * Check if a state transition is valid
 */
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
	return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

/**
 * Get all valid next states from current state
 */
export function getValidTransitions(from: TaskStatus): TaskStatus[] {
	return VALID_TRANSITIONS[from] ?? []
}

/**
 * Check if a task is in a terminal state
 */
export function isTerminalState(status: TaskStatus): boolean {
	return TERMINAL_STATES.includes(status)
}

/**
 * Check if a task is actively being worked on
 */
export function isActiveState(status: TaskStatus): boolean {
	return ACTIVE_STATES.includes(status)
}

// ============================================================================
// ENHANCED TASK TYPE
// ============================================================================

/**
 * Enhanced Task interface with stable IDs and full state tracking
 */
export interface ManagedTask {
	/** Stable task ID (e.g., T-ARCH-001) */
	taskId: string

	/** Sequence number within project/agent */
	sequence: number

	/** Parent task ID (for decomposition) */
	parentTaskId?: string

	/** Child task IDs (subtasks) */
	childTaskIds?: string[]

	/** Short title */
	title: string

	/** Full description of what to do */
	description: string

	/** Current status */
	status: TaskStatus

	/** Full status transition history */
	statusHistory: TaskStatusTransition[]

	/** Priority (1=highest, 5=lowest) */
	priority: 1 | 2 | 3 | 4 | 5

	/** Agent ID that created this task */
	createdBy: string

	/** Agent ID currently assigned to this task */
	assignedTo?: string

	/** Blocking reason (when status is 'blocked') */
	blockingReason?: BlockingReason

	/** Task IDs that must complete before this can start */
	dependsOn?: string[]

	/** Tasks that depend on this one */
	blockedTasks?: string[]

	/** Verification result (when verified) */
	verification?: VerificationResult

	/** Execution context */
	context: {
		workingDirectory?: string
		relevantFiles?: string[]
		expectedOutputs?: Record<string, string>
		conventions?: string
		notes?: string
	}

	/** Result after completion */
	result?: {
		filesCreated: string[]
		filesModified: string[]
		commitHash?: string
		summary: string
	}

	/** Error info if failed */
	error?: {
		message: string
		type: "validation" | "execution" | "timeout" | "external" | "unknown"
		recoverable: boolean
		details?: string
	}

	/** Timestamps */
	createdAt: string
	delegatedAt?: string
	startedAt?: string
	completedAt?: string
	verifiedAt?: string
}

// ============================================================================
// TASK OPERATIONS
// ============================================================================

/**
 * Create a new task with stable ID
 */
export function createTask(
	prefix: string,
	sequence: number,
	data: {
		title: string
		description: string
		createdBy: string
		priority?: ManagedTask["priority"]
		parentTaskId?: string
		dependsOn?: string[]
		context?: ManagedTask["context"]
	}
): ManagedTask {
	const taskId = generateTaskId(prefix, sequence)
	const now = new Date().toISOString()

	return {
		taskId,
		sequence,
		parentTaskId: data.parentTaskId,
		title: data.title,
		description: data.description,
		status: "planned",
		statusHistory: [
			{
				from: "planned",
				to: "planned",
				triggeredBy: data.createdBy,
				timestamp: now,
				reason: "Task created",
			},
		],
		priority: data.priority ?? 3,
		createdBy: data.createdBy,
		dependsOn: data.dependsOn,
		context: data.context ?? {},
		createdAt: now,
	}
}

/**
 * Transition a task to a new status
 *
 * @throws Error if transition is invalid
 */
export function transitionTask(
	task: ManagedTask,
	newStatus: TaskStatus,
	agentId: string,
	options: {
		reason?: string
		metadata?: TaskStatusTransition["metadata"]
	} = {}
): ManagedTask {
	if (!canTransition(task.status, newStatus)) {
		throw new Error(
			`Invalid transition: ${task.status} → ${newStatus} (valid: ${getValidTransitions(task.status).join(", ") || "none"})`
		)
	}

	const now = new Date().toISOString()
	const transition: TaskStatusTransition = {
		from: task.status,
		to: newStatus,
		triggeredBy: agentId,
		timestamp: now,
		reason: options.reason,
		metadata: options.metadata,
	}

	const updated: ManagedTask = {
		...task,
		status: newStatus,
		statusHistory: [...task.statusHistory, transition],
	}

	// Update timestamps based on transition
	switch (newStatus) {
		case "delegated":
			updated.delegatedAt = now
			break
		case "in_progress":
			updated.startedAt = updated.startedAt ?? now
			// Clear blocking reason when unblocking
			if (task.status === "blocked") {
				updated.blockingReason = undefined
			}
			break
		case "done":
		case "failed":
			updated.completedAt = now
			break
		case "verified":
			updated.verifiedAt = now
			break
		case "blocked":
			// Ensure blocking reason is set
			if (options.metadata?.blockReason) {
				updated.blockingReason = {
					type: options.metadata.blockedBy ? "dependency" : "external",
					description: options.metadata.blockReason,
					blockedByTaskId: options.metadata.blockedBy,
					since: now,
				}
			}
			break
	}

	return updated
}

/**
 * Delegate a task to an agent
 */
export function delegateTask(task: ManagedTask, toAgentId: string, byAgentId: string): ManagedTask {
	const updated = transitionTask(task, "delegated", byAgentId, {
		reason: `Delegated to ${toAgentId}`,
	})
	updated.assignedTo = toAgentId
	return updated
}

/**
 * Accept a delegated task and start working
 */
export function acceptTask(task: ManagedTask, agentId: string): ManagedTask {
	if (task.assignedTo !== agentId) {
		throw new Error(`Task ${task.taskId} is not assigned to ${agentId}`)
	}
	return transitionTask(task, "in_progress", agentId, {
		reason: "Task accepted, work started",
	})
}

/**
 * Reject a delegated task back to planned state
 */
export function rejectTask(task: ManagedTask, agentId: string, reason: string): ManagedTask {
	const updated = transitionTask(task, "planned", agentId, { reason })
	updated.assignedTo = undefined
	return updated
}

/**
 * Block a task with a reason
 */
export function blockTask(
	task: ManagedTask,
	agentId: string,
	blockingReason: BlockingReason
): ManagedTask {
	return transitionTask(task, "blocked", agentId, {
		reason: blockingReason.description,
		metadata: {
			blockedBy: blockingReason.blockedByTaskId,
			blockReason: blockingReason.description,
		},
	})
}

/**
 * Unblock a task and resume work
 */
export function unblockTask(task: ManagedTask, agentId: string, resolution: string): ManagedTask {
	return transitionTask(task, "in_progress", agentId, {
		reason: `Unblocked: ${resolution}`,
	})
}

/**
 * Submit task for review
 */
export function submitForReview(
	task: ManagedTask,
	agentId: string,
	result: ManagedTask["result"]
): ManagedTask {
	const updated = transitionTask(task, "review", agentId, {
		reason: result?.summary ?? "Work completed",
		metadata: {
			commitHash: result?.commitHash,
			filesChanged: [...(result?.filesCreated ?? []), ...(result?.filesModified ?? [])],
		},
	})
	updated.result = result
	return updated
}

/**
 * Approve a task after review
 */
export function approveTask(task: ManagedTask, reviewerAgentId: string): ManagedTask {
	return transitionTask(task, "done", reviewerAgentId, {
		reason: "Review approved",
	})
}

/**
 * Send task back for rework
 */
export function requestRework(task: ManagedTask, reviewerAgentId: string, feedback: string): ManagedTask {
	return transitionTask(task, "in_progress", reviewerAgentId, {
		reason: `Rework needed: ${feedback}`,
	})
}

/**
 * Mark task as verified (after automated checks pass)
 */
export function verifyTask(
	task: ManagedTask,
	agentId: string,
	verification: VerificationResult
): ManagedTask {
	const updated = transitionTask(task, "verified", agentId, {
		reason: verification.allPassed ? "All verification checks passed" : "Verified with notes",
		metadata: {
			verificationResult: verification.checks,
			commitHash: verification.commitHash,
		},
	})
	updated.verification = verification
	return updated
}

/**
 * Mark task as failed
 */
export function failTask(
	task: ManagedTask,
	agentId: string,
	error: ManagedTask["error"]
): ManagedTask {
	const updated = transitionTask(task, "failed", agentId, {
		reason: error?.message ?? "Task failed",
	})
	updated.error = error
	return updated
}

/**
 * Cancel a task
 */
export function cancelTask(task: ManagedTask, agentId: string, reason: string): ManagedTask {
	return transitionTask(task, "cancelled", agentId, { reason })
}

/**
 * Retry a failed task (creates new planned task with reference)
 */
export function retryTask(task: ManagedTask, agentId: string): ManagedTask {
	if (task.status !== "failed") {
		throw new Error(`Can only retry failed tasks, current status: ${task.status}`)
	}
	return transitionTask(task, "planned", agentId, {
		reason: "Retrying failed task",
	})
}

// ============================================================================
// TASK LOG GENERATION
// ============================================================================

/**
 * Format a task for the TASK_LOG.md file
 */
export function formatTaskLogEntry(task: ManagedTask): string {
	const lines: string[] = [
		`### ${task.taskId} | ${task.status} | ${task.assignedTo ?? "unassigned"}`,
		`**${task.title}**`,
		"",
	]

	// Key timestamps
	if (task.delegatedAt) {
		lines.push(`- **Delegated**: ${task.delegatedAt}`)
	}
	if (task.startedAt) {
		lines.push(`- **Started**: ${task.startedAt}`)
	}
	if (task.completedAt) {
		lines.push(`- **Completed**: ${task.completedAt}`)
	}
	if (task.verifiedAt) {
		lines.push(`- **Verified**: ${task.verifiedAt}`)
	}

	// Result info
	if (task.result) {
		if (task.result.commitHash) {
			lines.push(`- **Commit**: \`${task.result.commitHash}\``)
		}
		if (task.result.filesCreated?.length || task.result.filesModified?.length) {
			lines.push("- **Files Changed**:")
			for (const f of task.result.filesCreated ?? []) {
				lines.push(`  - \`${f}\` (created)`)
			}
			for (const f of task.result.filesModified ?? []) {
				lines.push(`  - \`${f}\` (modified)`)
			}
		}
		if (task.result.summary) {
			lines.push(`- **Summary**: ${task.result.summary}`)
		}
	}

	// Error info
	if (task.error) {
		lines.push(`- **Error**: ${task.error.message}`)
		if (task.error.details) {
			lines.push(`  - Details: ${task.error.details}`)
		}
		lines.push(`  - Recoverable: ${task.error.recoverable ? "Yes" : "No"}`)
	}

	// Verification checklist
	if (task.verification) {
		lines.push("- **Verification**:")
		for (const check of task.verification.checks) {
			const icon = check.passed ? "✓" : "✗"
			lines.push(`  - [${icon}] ${check.check}${check.message ? ` (${check.message})` : ""}`)
		}
	}

	// Blocking info (if blocked)
	if (task.status === "blocked" && task.blockingReason) {
		lines.push("- **Blocked**:")
		lines.push(`  - Type: ${task.blockingReason.type}`)
		lines.push(`  - Reason: ${task.blockingReason.description}`)
		if (task.blockingReason.blockedByTaskId) {
			lines.push(`  - Waiting for: ${task.blockingReason.blockedByTaskId}`)
		}
		lines.push(`  - Since: ${task.blockingReason.since}`)
	}

	return lines.join("\n")
}

/**
 * Append a task to TASK_LOG.md
 */
export async function appendToTaskLog(projectDir: string, task: ManagedTask): Promise<void> {
	const logPath = path.join(projectDir, "TASK_LOG.md")

	const entry = formatTaskLogEntry(task)
	const today = new Date().toISOString().split("T")[0]

	let existingContent = ""
	try {
		existingContent = await fs.readFile(logPath, "utf-8")
	} catch {
		existingContent = "# Task Execution Log\n\n*Append-only log of task execution with verification evidence.*\n"
	}

	let newContent = existingContent

	// Add date header if new day
	if (!existingContent.includes(`## ${today}`)) {
		newContent += `\n## ${today}\n`
	}

	newContent += `\n${entry}\n\n---\n`

	await fs.writeFile(logPath, newContent, "utf-8")
	getLog().debug(`[TaskManager] Appended ${task.taskId} to TASK_LOG.md`)
}

// ============================================================================
// PLAN.MD GENERATION
// ============================================================================

/**
 * Generate PLAN.md content from active tasks
 */
export function generatePlanContent(tasks: ManagedTask[], projectName?: string): string {
	const lines: string[] = [
		`# ${projectName ?? "Project"} Plan`,
		"",
		"*Active tasks only. See TASK_LOG.md for execution history.*",
		"",
	]

	// Filter to non-terminal tasks
	const activeTasks = tasks.filter((t) => !isTerminalState(t.status))
	const blockedTasks = activeTasks.filter((t) => t.status === "blocked")
	const inProgressTasks = activeTasks.filter((t) => t.status === "in_progress")
	const reviewTasks = activeTasks.filter((t) => t.status === "review")
	const plannedTasks = activeTasks.filter((t) => t.status === "planned" || t.status === "delegated")

	// Priority emoji
	const priorityIcon = (p: number) => ["🔴", "🟠", "🟡", "🟢", "⚪"][p - 1] ?? "⚪"

	// Main task table
	lines.push("## Active Tasks")
	lines.push("")
	lines.push("| Task ID | Pri | Status | Owner | Description | Blocked By |")
	lines.push("|---------|-----|--------|-------|-------------|------------|")

	const formatRow = (t: ManagedTask) => {
		const blockedBy = t.blockingReason?.blockedByTaskId ?? "-"
		const owner = t.assignedTo ?? "-"
		const desc = t.title.length > 40 ? t.title.slice(0, 37) + "..." : t.title
		return `| ${t.taskId} | ${priorityIcon(t.priority)} | ${t.status} | ${owner} | ${desc} | ${blockedBy} |`
	}

	// Order: in_progress, review, blocked, planned/delegated
	for (const t of [...inProgressTasks, ...reviewTasks, ...blockedTasks, ...plannedTasks]) {
		lines.push(formatRow(t))
	}

	// Blocked items detail section
	if (blockedTasks.length > 0) {
		lines.push("")
		lines.push("## Blocked Items")
		lines.push("")

		for (const t of blockedTasks) {
			lines.push(`### ${t.taskId} (${t.title})`)
			if (t.blockingReason) {
				lines.push(`- **Type**: ${t.blockingReason.type}`)
				lines.push(`- **Reason**: ${t.blockingReason.description}`)
				if (t.blockingReason.blockedByTaskId) {
					lines.push(`- **Waiting For**: ${t.blockingReason.blockedByTaskId}`)
				}
				if (t.blockingReason.unblockRequires) {
					lines.push(`- **Requires**: ${t.blockingReason.unblockRequires}`)
				}
				if (t.blockingReason.question) {
					lines.push(`- **Question**: ${t.blockingReason.question}`)
				}
				lines.push(`- **Since**: ${t.blockingReason.since}`)
			}
			lines.push("")
		}
	}

	// Upcoming tasks (planned but not yet delegated)
	const upcomingTasks = plannedTasks.filter((t) => t.status === "planned")
	if (upcomingTasks.length > 0) {
		lines.push("")
		lines.push("## Upcoming Tasks")
		lines.push("")
		for (const t of upcomingTasks.slice(0, 10)) {
			lines.push(`- **${t.taskId}**: ${t.title}`)
			if (t.dependsOn?.length) {
				lines.push(`  - Depends on: ${t.dependsOn.join(", ")}`)
			}
		}
		if (upcomingTasks.length > 10) {
			lines.push(`- *... and ${upcomingTasks.length - 10} more planned tasks*`)
		}
	}

	lines.push("")
	lines.push(`*Last updated: ${new Date().toISOString()}*`)

	return lines.join("\n")
}

/**
 * Write PLAN.md to disk
 */
export async function writePlanFile(projectDir: string, tasks: ManagedTask[], projectName?: string): Promise<void> {
	const content = generatePlanContent(tasks, projectName)
	const planPath = path.join(projectDir, "PLAN.md")
	await fs.writeFile(planPath, content, "utf-8")
	getLog().debug(`[TaskManager] Updated PLAN.md with ${tasks.length} tasks`)
}

// ============================================================================
// TASK SEQUENCE TRACKING
// ============================================================================

/**
 * Task sequence tracker for a project/agent
 */
export interface TaskSequenceTracker {
	prefix: string
	nextSequence: number
	tasks: Map<string, ManagedTask>
}

/**
 * Create a new sequence tracker
 */
export function createSequenceTracker(prefix: string, startSequence: number = 1): TaskSequenceTracker {
	return {
		prefix: generatePrefix(prefix),
		nextSequence: startSequence,
		tasks: new Map(),
	}
}

/**
 * Add a new task using the sequence tracker
 */
export function addTaskToTracker(
	tracker: TaskSequenceTracker,
	data: Omit<Parameters<typeof createTask>[2], ""> // Same as createTask data param
): ManagedTask {
	const task = createTask(tracker.prefix, tracker.nextSequence, data)
	tracker.nextSequence++
	tracker.tasks.set(task.taskId, task)
	return task
}

/**
 * Get a task from the tracker by ID
 */
export function getTaskFromTracker(tracker: TaskSequenceTracker, taskId: string): ManagedTask | undefined {
	return tracker.tasks.get(taskId)
}

/**
 * Update a task in the tracker
 */
export function updateTaskInTracker(tracker: TaskSequenceTracker, task: ManagedTask): void {
	tracker.tasks.set(task.taskId, task)
}

/**
 * Get all tasks from tracker as array
 */
export function getTasksFromTracker(tracker: TaskSequenceTracker): ManagedTask[] {
	return Array.from(tracker.tasks.values())
}

/**
 * Serialize tracker for persistence
 */
export function serializeTracker(tracker: TaskSequenceTracker): {
	prefix: string
	nextSequence: number
	tasks: ManagedTask[]
} {
	return {
		prefix: tracker.prefix,
		nextSequence: tracker.nextSequence,
		tasks: getTasksFromTracker(tracker),
	}
}

/**
 * Deserialize tracker from persistence
 */
export function deserializeTracker(data: ReturnType<typeof serializeTracker>): TaskSequenceTracker {
	const tracker = createSequenceTracker(data.prefix, data.nextSequence)
	for (const task of data.tasks) {
		tracker.tasks.set(task.taskId, task)
	}
	return tracker
}

// ============================================================================
// DEPENDENCY CHECKING
// ============================================================================

/**
 * Check if a task can be started (all dependencies complete)
 */
export function canStartTask(task: ManagedTask, allTasks: ManagedTask[]): {
	canStart: boolean
	blockedBy: string[]
} {
	if (!task.dependsOn?.length) {
		return { canStart: true, blockedBy: [] }
	}

	const blockedBy: string[] = []
	for (const depId of task.dependsOn) {
		const depTask = allTasks.find((t) => t.taskId === depId)
		if (!depTask || !["done", "verified"].includes(depTask.status)) {
			blockedBy.push(depId)
		}
	}

	return {
		canStart: blockedBy.length === 0,
		blockedBy,
	}
}

/**
 * Find all tasks blocked by a given task
 */
export function findDependentTasks(taskId: string, allTasks: ManagedTask[]): ManagedTask[] {
	return allTasks.filter((t) => t.dependsOn?.includes(taskId))
}

/**
 * Get task execution order respecting dependencies (topological sort)
 */
export function getTaskExecutionOrder(tasks: ManagedTask[]): ManagedTask[] {
	const result: ManagedTask[] = []
	const visited = new Set<string>()
	const visiting = new Set<string>()

	const visit = (task: ManagedTask) => {
		if (visited.has(task.taskId)) return
		if (visiting.has(task.taskId)) {
			throw new Error(`Circular dependency detected involving ${task.taskId}`)
		}

		visiting.add(task.taskId)

		// Visit dependencies first
		for (const depId of task.dependsOn ?? []) {
			const depTask = tasks.find((t) => t.taskId === depId)
			if (depTask) {
				visit(depTask)
			}
		}

		visiting.delete(task.taskId)
		visited.add(task.taskId)
		result.push(task)
	}

	for (const task of tasks) {
		visit(task)
	}

	return result
}

// ============================================================================
// SUPERVISOR OVERRIDE OPERATIONS (Proposal 5)
// ============================================================================

/**
 * Task priority type (matches ManagedTask.priority)
 */
export type TaskPriority = 1 | 2 | 3 | 4 | 5

/**
 * Supervisor override record
 */
export interface SupervisorOverride {
	/** Override ID */
	overrideId: string
	/** Task that was overridden */
	taskId: string
	/** Type of override */
	type: "force_unblock" | "force_reassign" | "force_status" | "force_cancel" | "priority_change"
	/** Previous state before override */
	previousState: {
		status: TaskStatus
		assignedTo?: string
		blockingReason?: BlockingReason
		priority?: TaskPriority
	}
	/** New state after override */
	newState: {
		status?: TaskStatus
		assignedTo?: string
		blockingReason?: BlockingReason
		priority?: TaskPriority
	}
	/** Supervisor agent ID */
	supervisorId: string
	/** Reason for override */
	reason: string
	/** When override was applied */
	appliedAt: string
	/** Whether affected agent was notified */
	agentNotified: boolean
}

let overrideSequence = 0

/**
 * Generate override ID
 */
function generateOverrideId(): string {
	overrideSequence++
	return `OVR-${Date.now().toString(36)}-${overrideSequence.toString(36).padStart(3, "0")}`
}

/**
 * Force unblock a task by supervisor
 * This bypasses normal unblock requirements
 */
export function supervisorForceUnblock(
	task: ManagedTask,
	supervisorId: string,
	reason: string,
	resolution: string,
): { task: ManagedTask; override: SupervisorOverride } {
	if (task.status !== "blocked") {
		throw new Error(`Task ${task.taskId} is not blocked (status: ${task.status})`)
	}

	const override: SupervisorOverride = {
		overrideId: generateOverrideId(),
		taskId: task.taskId,
		type: "force_unblock",
		previousState: {
			status: task.status,
			assignedTo: task.assignedTo,
			blockingReason: task.blockingReason,
		},
		newState: {
			status: "in_progress",
		},
		supervisorId,
		reason,
		appliedAt: new Date().toISOString(),
		agentNotified: false,
	}

	const newHistory: TaskStatusTransition = {
		from: task.status,
		to: "in_progress",
		triggeredBy: supervisorId,
		timestamp: new Date().toISOString(),
		reason: `[SUPERVISOR OVERRIDE] ${reason}`,
		metadata: {
			blockReason: `Supervisor resolved: ${resolution}`,
		},
	}

	const updated: ManagedTask = {
		...task,
		status: "in_progress",
		blockingReason: undefined,
		statusHistory: [...task.statusHistory, newHistory],
	}

	return { task: updated, override }
}

/**
 * Force reassign a task to a different agent
 */
export function supervisorForceReassign(
	task: ManagedTask,
	supervisorId: string,
	newAgentId: string,
	reason: string,
): { task: ManagedTask; override: SupervisorOverride } {
	if (!["delegated", "in_progress", "blocked", "review"].includes(task.status)) {
		throw new Error(`Cannot reassign task in status: ${task.status}`)
	}

	const override: SupervisorOverride = {
		overrideId: generateOverrideId(),
		taskId: task.taskId,
		type: "force_reassign",
		previousState: {
			status: task.status,
			assignedTo: task.assignedTo,
			blockingReason: task.blockingReason,
		},
		newState: {
			status: "delegated",
			assignedTo: newAgentId,
		},
		supervisorId,
		reason,
		appliedAt: new Date().toISOString(),
		agentNotified: false,
	}

	const newHistory: TaskStatusTransition = {
		from: task.status,
		to: "delegated",
		triggeredBy: supervisorId,
		timestamp: new Date().toISOString(),
		reason: `[SUPERVISOR OVERRIDE] Reassigned from ${task.assignedTo} to ${newAgentId}: ${reason}`,
	}

	const updated: ManagedTask = {
		...task,
		status: "delegated",
		assignedTo: newAgentId,
		blockingReason: undefined, // Clear blocking reason on reassign
		delegatedAt: new Date().toISOString(),
		statusHistory: [...task.statusHistory, newHistory],
	}

	return { task: updated, override }
}

/**
 * Force a task to a specific status
 */
export function supervisorForceStatus(
	task: ManagedTask,
	supervisorId: string,
	newStatus: TaskStatus,
	reason: string,
): { task: ManagedTask; override: SupervisorOverride } {
	const override: SupervisorOverride = {
		overrideId: generateOverrideId(),
		taskId: task.taskId,
		type: "force_status",
		previousState: {
			status: task.status,
			assignedTo: task.assignedTo,
			blockingReason: task.blockingReason,
		},
		newState: {
			status: newStatus,
		},
		supervisorId,
		reason,
		appliedAt: new Date().toISOString(),
		agentNotified: false,
	}

	const newHistory: TaskStatusTransition = {
		from: task.status,
		to: newStatus,
		triggeredBy: supervisorId,
		timestamp: new Date().toISOString(),
		reason: `[SUPERVISOR OVERRIDE] Forced status change: ${reason}`,
	}

	const now = new Date().toISOString()
	const updated: ManagedTask = {
		...task,
		status: newStatus,
		statusHistory: [...task.statusHistory, newHistory],
		// Update relevant timestamps based on new status
		...(newStatus === "in_progress" && !task.startedAt ? { startedAt: now } : {}),
		...(newStatus === "done" && !task.completedAt ? { completedAt: now } : {}),
		...(newStatus === "verified" && !task.verifiedAt ? { verifiedAt: now } : {}),
		// Clear blocking reason if moving out of blocked
		...(task.status === "blocked" && newStatus !== "blocked" ? { blockingReason: undefined } : {}),
	}

	return { task: updated, override }
}

/**
 * Force cancel a task
 */
export function supervisorForceCancel(
	task: ManagedTask,
	supervisorId: string,
	reason: string,
): { task: ManagedTask; override: SupervisorOverride } {
	if (["verified", "cancelled"].includes(task.status)) {
		throw new Error(`Cannot cancel task in status: ${task.status}`)
	}

	const override: SupervisorOverride = {
		overrideId: generateOverrideId(),
		taskId: task.taskId,
		type: "force_cancel",
		previousState: {
			status: task.status,
			assignedTo: task.assignedTo,
			blockingReason: task.blockingReason,
		},
		newState: {
			status: "cancelled",
		},
		supervisorId,
		reason,
		appliedAt: new Date().toISOString(),
		agentNotified: false,
	}

	const newHistory: TaskStatusTransition = {
		from: task.status,
		to: "cancelled",
		triggeredBy: supervisorId,
		timestamp: new Date().toISOString(),
		reason: `[SUPERVISOR OVERRIDE] Cancelled: ${reason}`,
	}

	const updated: ManagedTask = {
		...task,
		status: "cancelled",
		blockingReason: undefined,
		statusHistory: [...task.statusHistory, newHistory],
	}

	return { task: updated, override }
}

/**
 * Change task priority
 * Priority: 1 (critical) to 5 (low)
 */
export function supervisorChangePriority(
	task: ManagedTask,
	supervisorId: string,
	newPriority: TaskPriority,
	reason: string,
): { task: ManagedTask; override: SupervisorOverride } {
	const override: SupervisorOverride = {
		overrideId: generateOverrideId(),
		taskId: task.taskId,
		type: "priority_change",
		previousState: {
			status: task.status,
			priority: task.priority,
		},
		newState: {
			priority: newPriority,
		},
		supervisorId,
		reason,
		appliedAt: new Date().toISOString(),
		agentNotified: false,
	}

	const newHistory: TaskStatusTransition = {
		from: task.status,
		to: task.status, // Status doesn't change
		triggeredBy: supervisorId,
		timestamp: new Date().toISOString(),
		reason: `[SUPERVISOR OVERRIDE] Priority changed from ${task.priority} to ${newPriority}: ${reason}`,
	}

	const updated: ManagedTask = {
		...task,
		priority: newPriority,
		statusHistory: [...task.statusHistory, newHistory],
	}

	return { task: updated, override }
}

/**
 * Format override for logging
 */
export function formatOverrideLogEntry(override: SupervisorOverride): string {
	const lines: string[] = [
		`### ${override.overrideId} | ${override.type} | ${override.taskId}`,
		"",
		`- **Supervisor**: ${override.supervisorId}`,
		`- **Applied**: ${override.appliedAt}`,
		`- **Reason**: ${override.reason}`,
		"",
		"**Before:**",
		`- Status: ${override.previousState.status}`,
	]

	if (override.previousState.assignedTo) {
		lines.push(`- Assigned to: ${override.previousState.assignedTo}`)
	}
	if (override.previousState.blockingReason) {
		lines.push(`- Blocked: ${override.previousState.blockingReason.description}`)
	}
	if (override.previousState.priority) {
		lines.push(`- Priority: ${override.previousState.priority}`)
	}

	lines.push("")
	lines.push("**After:**")

	if (override.newState.status) {
		lines.push(`- Status: ${override.newState.status}`)
	}
	if (override.newState.assignedTo) {
		lines.push(`- Assigned to: ${override.newState.assignedTo}`)
	}
	if (override.newState.priority) {
		lines.push(`- Priority: ${override.newState.priority}`)
	}

	lines.push("")
	lines.push("---")

	return lines.join("\n")
}
