/**
 * Delegation Tracker - Integrates task-manager and message-contracts into delegation flow
 *
 * When an agent delegates a task:
 * 1. Creates a ManagedTask with stable ID (T-PREFIX-NNN)
 * 2. Generates a TaskAssignmentMessage for audit trail
 * 3. Updates subordinate's PLAN.md with the received task
 * 4. Tracks task state transitions
 */

import * as fs from "fs"
import * as path from "path"
import { getLog } from "./logger"
import {
	ManagedTask,
	createTask,
	delegateTask,
	generatePrefix,
	TaskPriority,
} from "./task-manager"
import {
	createTaskAssignment,
	TaskAssignmentMessage,
	MessagePriority,
} from "./message-contracts"

const log = getLog()

// ============================================================================
// TYPES
// ============================================================================

export interface DelegationRequest {
	/** Project ID */
	projectId: string
	/** Delegating agent ID */
	fromAgentId: string
	/** Delegating agent name */
	fromAgentName: string
	/** Target agent ID */
	toAgentId: string
	/** Target agent name */
	toAgentName: string
	/** Task title/summary */
	task: string
	/** Desired state description */
	desiredState?: string
	/** Acceptance criteria */
	acceptanceCriteria?: string[]
	/** Constraints */
	constraints?: string[]
	/** Additional context */
	context?: string
	/** Priority */
	priority?: "low" | "medium" | "high" | "critical"
}

export interface DelegationResult {
	/** Created task with stable ID */
	task: ManagedTask
	/** Task assignment message for audit */
	message: TaskAssignmentMessage
	/** Task ID (e.g., T-FRO-001) */
	taskId: string
}

// ============================================================================
// TASK SEQUENCE TRACKING
// ============================================================================

interface ProjectTaskSequence {
	[agentPrefix: string]: number
}

interface TaskSequenceStore {
	[projectId: string]: ProjectTaskSequence
}

// In-memory sequence store (persisted to disk)
const sequenceStore: TaskSequenceStore = {}

function getSequenceFilePath(projectDir: string): string {
	return path.join(projectDir, ".society-agent", "task-sequences.json")
}

function loadSequences(projectDir: string): ProjectTaskSequence {
	const filePath = getSequenceFilePath(projectDir)
	try {
		if (fs.existsSync(filePath)) {
			return JSON.parse(fs.readFileSync(filePath, "utf-8"))
		}
	} catch (err) {
		log.warn(`[DelegationTracker] Failed to load sequences: ${err}`)
	}
	return {}
}

function saveSequences(projectDir: string, sequences: ProjectTaskSequence): void {
	const filePath = getSequenceFilePath(projectDir)
	try {
		const dir = path.dirname(filePath)
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true })
		}
		fs.writeFileSync(filePath, JSON.stringify(sequences, null, 2))
	} catch (err) {
		log.error(`[DelegationTracker] Failed to save sequences: ${err}`)
	}
}

function getNextSequence(projectDir: string, agentPrefix: string): number {
	if (!sequenceStore[projectDir]) {
		sequenceStore[projectDir] = loadSequences(projectDir)
	}
	const sequences = sequenceStore[projectDir]
	const current = sequences[agentPrefix] || 0
	sequences[agentPrefix] = current + 1
	saveSequences(projectDir, sequences)
	return sequences[agentPrefix]
}

// ============================================================================
// DELEGATION FUNCTIONS
// ============================================================================

/**
 * Create a delegation with full task tracking
 */
export function createDelegation(
	projectDir: string,
	request: DelegationRequest,
): DelegationResult {
	// Generate prefix from target agent ID
	const prefix = generatePrefix(request.toAgentId)
	const sequence = getNextSequence(projectDir, prefix)

	// Map priority to TaskPriority (1-5)
	const priorityMap: Record<string, TaskPriority> = {
		critical: 1,
		high: 2,
		medium: 3,
		low: 4,
	}
	const taskPriority = priorityMap[request.priority || "medium"] || 3

	// Build full description
	const description = buildTaskDescription(request)

	// Create the managed task
	let managedTask = createTask(prefix, sequence, {
		title: request.task,
		description,
		createdBy: request.fromAgentId,
		priority: taskPriority,
		context: {
			notes: request.context,
		},
	})

	// Transition to delegated state
	managedTask = delegateTask(managedTask, request.toAgentId, request.fromAgentId)

	// Create task assignment message for audit trail
	const messagePriorityMap: Record<string, MessagePriority> = {
		critical: "critical",
		high: "high",
		medium: "normal",
		low: "low",
	}

	const assignmentMessage = createTaskAssignment(
		request.fromAgentId,
		request.toAgentId,
		request.projectId,
		{
			taskId: managedTask.taskId,
			taskTitle: request.task,
			description,
			requirements: request.constraints || [],
			acceptanceCriteria: request.acceptanceCriteria || ["Task completed successfully"],
			context: request.context,
		},
		messagePriorityMap[request.priority || "medium"] || "normal",
	)

	log.info(
		`[DelegationTracker] Created delegation ${managedTask.taskId}: ${request.fromAgentId} → ${request.toAgentId}`,
	)

	return {
		task: managedTask,
		message: assignmentMessage,
		taskId: managedTask.taskId,
	}
}

/**
 * Build full task description from delegation request
 */
function buildTaskDescription(request: DelegationRequest): string {
	const parts: string[] = [request.task]

	if (request.desiredState) {
		parts.push(`\n**Desired State:**\n${request.desiredState}`)
	}

	if (request.acceptanceCriteria && request.acceptanceCriteria.length > 0) {
		parts.push(
			`\n**Acceptance Criteria:**\n${request.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}`,
		)
	}

	if (request.constraints && request.constraints.length > 0) {
		parts.push(`\n**Constraints:**\n${request.constraints.map((c) => `- ${c}`).join("\n")}`)
	}

	return parts.join("\n")
}

// ============================================================================
// PLAN.MD UPDATE FUNCTIONS
// ============================================================================

/**
 * Add a delegated task to an agent's PLAN.md
 */
export function addTaskToPlan(
	agentDir: string,
	task: ManagedTask,
	fromAgentName: string,
): boolean {
	const planPath = path.join(agentDir, "PLAN.md")

	try {
		let content = ""
		if (fs.existsSync(planPath)) {
			content = fs.readFileSync(planPath, "utf-8")
		} else {
			// Create minimal PLAN.md
			content = `# Project Plan

## Active Tasks

| Task ID | Status | Owner | Description | Priority |
|---------|--------|-------|-------------|----------|

## Task States

- **planned**: Created but not assigned
- **delegated**: Assigned to an agent
- **in_progress**: Agent actively working
- **blocked**: Waiting for something
- **review**: Work complete, awaiting verification
- **done**: Accepted
- **verified**: Independently verified
`
		}

		// Find the table and add the task
		const tablePattern = /(\| Task ID \| Status \| Owner \| Description \| Priority \|\n\|[-|]+\|)/
		const match = content.match(tablePattern)

		if (match) {
			const priorityText = ["", "critical", "high", "medium", "low", "low"][task.priority] || "medium"
			const newRow = `\n| ${task.taskId} | delegated | ${fromAgentName} | ${task.title} | ${priorityText} |`
			content = content.replace(tablePattern, `$1${newRow}`)
		} else {
			// Fallback: append to Active Tasks section
			const activeTasksMatch = content.match(/## Active Tasks\n/)
			if (activeTasksMatch) {
				const priorityText = ["", "critical", "high", "medium", "low", "low"][task.priority] || "medium"
				const newTask = `\n- [ ] **${task.taskId}** (from ${fromAgentName}): ${task.title} [${priorityText}]\n`
				content = content.replace(/## Active Tasks\n/, `## Active Tasks\n${newTask}`)
			}
		}

		fs.writeFileSync(planPath, content)
		log.info(`[DelegationTracker] Added ${task.taskId} to ${planPath}`)
		return true
	} catch (err) {
		log.error(`[DelegationTracker] Failed to update PLAN.md: ${err}`)
		return false
	}
}

/**
 * Mark a task as delegated in the parent's PLAN.md
 */
export function markTaskDelegatedInPlan(
	agentDir: string,
	taskTitle: string,
	taskId: string,
	toAgentId: string,
): boolean {
	const planPath = path.join(agentDir, "PLAN.md")

	try {
		if (!fs.existsSync(planPath)) {
			return false
		}

		let content = fs.readFileSync(planPath, "utf-8")

		// Look for the task in various formats and add delegation marker
		// Format 1: - [ ] Task title
		const checkboxPattern = new RegExp(
			`(- \\[ \\] ${escapeRegex(taskTitle)})(?![^\\n]*→)`,
			"i",
		)
		if (checkboxPattern.test(content)) {
			content = content.replace(
				checkboxPattern,
				`$1 (${taskId} → ${toAgentId})`,
			)
			fs.writeFileSync(planPath, content)
			log.info(`[DelegationTracker] Marked task delegated in ${planPath}`)
			return true
		}

		// Format 2: Table row
		const tableRowPattern = new RegExp(
			`(\\| [^|]+ \\| )(planned|in_progress)( \\| [^|]+ \\| ${escapeRegex(taskTitle)})`,
			"i",
		)
		if (tableRowPattern.test(content)) {
			content = content.replace(tableRowPattern, `$1delegated$3 (${taskId})`)
			fs.writeFileSync(planPath, content)
			return true
		}

		return false
	} catch (err) {
		log.error(`[DelegationTracker] Failed to mark task delegated: ${err}`)
		return false
	}
}

/**
 * Update task status in PLAN.md
 */
export function updateTaskStatusInPlan(
	agentDir: string,
	taskId: string,
	newStatus: string,
	commitHash?: string,
): boolean {
	const planPath = path.join(agentDir, "PLAN.md")

	try {
		if (!fs.existsSync(planPath)) {
			return false
		}

		let content = fs.readFileSync(planPath, "utf-8")

		// Update table row status
		const tableRowPattern = new RegExp(
			`(\\| ${escapeRegex(taskId)} \\| )([^|]+)( \\|)`,
			"i",
		)
		if (tableRowPattern.test(content)) {
			content = content.replace(tableRowPattern, `$1${newStatus}$3`)

			// If done/verified and has commit hash, add it
			if (commitHash && (newStatus === "done" || newStatus === "verified")) {
				content = content.replace(
					new RegExp(`(\\| ${escapeRegex(taskId)} [^\\n]+)\\|\\n`),
					`$1 *(commit: ${commitHash})* |\n`,
				)
			}

			fs.writeFileSync(planPath, content)
			log.info(`[DelegationTracker] Updated ${taskId} to ${newStatus} in ${planPath}`)
			return true
		}

		// Update checkbox format
		if (newStatus === "done" || newStatus === "verified") {
			const checkboxPattern = new RegExp(
				`- \\[ \\] (\\*\\*${escapeRegex(taskId)}\\*\\*[^\\n]+)`,
			)
			if (checkboxPattern.test(content)) {
				const replacement = commitHash
					? `- [x] $1 *(commit: ${commitHash})*`
					: `- [x] $1`
				content = content.replace(checkboxPattern, replacement)
				fs.writeFileSync(planPath, content)
				return true
			}
		}

		return false
	} catch (err) {
		log.error(`[DelegationTracker] Failed to update task status: ${err}`)
		return false
	}
}

// ============================================================================
// TASK STORAGE (File-based)
// ============================================================================

interface TaskStore {
	tasks: ManagedTask[]
	lastUpdated: string
}

function getTaskStorePath(projectDir: string): string {
	return path.join(projectDir, ".society-agent", "tasks.json")
}

/**
 * Load tasks from project storage
 */
export function loadTasks(projectDir: string): ManagedTask[] {
	const filePath = getTaskStorePath(projectDir)
	try {
		if (fs.existsSync(filePath)) {
			const store: TaskStore = JSON.parse(fs.readFileSync(filePath, "utf-8"))
			return store.tasks
		}
	} catch (err) {
		log.warn(`[DelegationTracker] Failed to load tasks: ${err}`)
	}
	return []
}

/**
 * Save task to project storage
 */
export function saveTask(projectDir: string, task: ManagedTask): void {
	const filePath = getTaskStorePath(projectDir)
	try {
		const dir = path.dirname(filePath)
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true })
		}

		const tasks = loadTasks(projectDir)
		const existingIndex = tasks.findIndex((t) => t.taskId === task.taskId)

		if (existingIndex >= 0) {
			tasks[existingIndex] = task
		} else {
			tasks.push(task)
		}

		const store: TaskStore = {
			tasks,
			lastUpdated: new Date().toISOString(),
		}

		fs.writeFileSync(filePath, JSON.stringify(store, null, 2))
		log.debug(`[DelegationTracker] Saved task ${task.taskId}`)
	} catch (err) {
		log.error(`[DelegationTracker] Failed to save task: ${err}`)
	}
}

/**
 * Get task by ID
 */
export function getTask(projectDir: string, taskId: string): ManagedTask | undefined {
	const tasks = loadTasks(projectDir)
	return tasks.find((t) => t.taskId === taskId)
}

/**
 * Get tasks by agent
 */
export function getTasksByAgent(projectDir: string, agentId: string): ManagedTask[] {
	const tasks = loadTasks(projectDir)
	return tasks.filter((t) => t.assignedTo === agentId)
}

/**
 * Get tasks created by agent
 */
export function getTasksCreatedBy(projectDir: string, agentId: string): ManagedTask[] {
	const tasks = loadTasks(projectDir)
	return tasks.filter((t) => t.createdBy === agentId)
}

// ============================================================================
// UTILITY
// ============================================================================

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// ============================================================================
// EXPORTS FOR EASY IMPORT
// ============================================================================

export {
	ManagedTask,
	TaskAssignmentMessage,
}
