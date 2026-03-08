/**
 * Message Contracts - Typed Inter-Agent Messages (Proposal 9)
 *
 * Provides structured message types with schemas for agent-to-agent
 * and supervisor-to-agent communication. Enables validation,
 * better error handling, and clearer communication protocols.
 *
 * Key features:
 * - Strongly typed message categories
 * - Required vs optional fields
 * - Message validation
 * - Response expectations
 * - Priority levels
 */

import { getLog } from "./logger"

const log = getLog()

// ============================================================================
// MESSAGE TYPES
// ============================================================================

/**
 * Message categories
 */
export type MessageCategory =
	| "task" // Task-related messages
	| "query" // Questions and requests for information
	| "status" // Status updates
	| "handoff" // Work handoff between agents
	| "review" // Code/work review requests
	| "escalation" // Escalation to supervisor
	| "notification" // FYI messages
	| "coordination" // Coordination between agents
	| "system" // System-level messages

/**
 * Message priority levels
 */
export type MessagePriority = "critical" | "high" | "normal" | "low"

/**
 * Response expectation
 */
export type ResponseExpectation =
	| "required" // Must respond
	| "optional" // May respond
	| "none" // No response expected
	| "async" // Will respond asynchronously

/**
 * Base message structure
 */
export interface BaseMessage {
	/** Unique message ID */
	messageId: string
	/** Message category */
	category: MessageCategory
	/** Priority level */
	priority: MessagePriority
	/** Sender agent ID */
	fromAgentId: string
	/** Target agent ID */
	toAgentId: string
	/** Related project ID */
	projectId: string
	/** Timestamp */
	timestamp: string
	/** Whether a response is expected */
	responseExpected: ResponseExpectation
	/** ID of message this responds to (if any) */
	inResponseTo?: string
	/** Related task ID */
	taskId?: string
	/** Message expiry (ISO timestamp) */
	expiresAt?: string
}

// ============================================================================
// TASK MESSAGES
// ============================================================================

/**
 * Task assignment message
 */
export interface TaskAssignmentMessage extends BaseMessage {
	category: "task"
	type: "assignment"
	payload: {
		taskId: string
		taskTitle: string
		description: string
		requirements: string[]
		acceptanceCriteria: string[]
		deadline?: string
		context?: string
		relatedFiles?: string[]
		relatedDecisions?: string[]
	}
}

/**
 * Task completion message
 */
export interface TaskCompletionMessage extends BaseMessage {
	category: "task"
	type: "completion"
	payload: {
		taskId: string
		summary: string
		filesCreated: string[]
		filesModified: string[]
		commitHash?: string
		testsPassed?: boolean
		notes?: string
	}
}

/**
 * Task blocked message
 */
export interface TaskBlockedMessage extends BaseMessage {
	category: "task"
	type: "blocked"
	payload: {
		taskId: string
		blockingReason: {
			type: "dependency" | "question" | "approval" | "resource" | "external"
			description: string
			blockedByTaskId?: string
			question?: string
			unblockRequires?: string
		}
		suggestedResolution?: string
	}
}

/**
 * Task progress message
 */
export interface TaskProgressMessage extends BaseMessage {
	category: "task"
	type: "progress"
	payload: {
		taskId: string
		percentComplete: number
		currentActivity: string
		remainingWork?: string[]
		estimatedCompletion?: string
	}
}

// ============================================================================
// QUERY MESSAGES
// ============================================================================

/**
 * Information request message
 */
export interface QueryMessage extends BaseMessage {
	category: "query"
	type: "information_request"
	payload: {
		question: string
		context?: string
		urgency: "blocking" | "soon" | "when_available"
		relatedTo?: {
			files?: string[]
			tasks?: string[]
			decisions?: string[]
		}
	}
}

/**
 * Clarification request message
 */
export interface ClarificationMessage extends BaseMessage {
	category: "query"
	type: "clarification"
	payload: {
		originalMessageId: string
		whatNeedsClarification: string
		proposedInterpretation?: string
		options?: string[]
	}
}

/**
 * Query response message
 */
export interface QueryResponseMessage extends BaseMessage {
	category: "query"
	type: "response"
	payload: {
		answer: string
		confidence: "certain" | "likely" | "uncertain"
		references?: string[]
		followUpNeeded?: boolean
	}
}

// ============================================================================
// HANDOFF MESSAGES
// ============================================================================

/**
 * Work handoff request
 */
export interface HandoffRequestMessage extends BaseMessage {
	category: "handoff"
	type: "request"
	payload: {
		reason: string
		workSummary: string
		filesInvolved: string[]
		currentState: string
		acceptanceCriteria: string[]
		contextFiles?: string[]
		blockers?: string[]
	}
}

/**
 * Handoff acceptance
 */
export interface HandoffAcceptMessage extends BaseMessage {
	category: "handoff"
	type: "accept"
	payload: {
		handoffMessageId: string
		acknowledgment: string
		questions?: string[]
		estimatedStart?: string
	}
}

/**
 * Handoff rejection
 */
export interface HandoffRejectMessage extends BaseMessage {
	category: "handoff"
	type: "reject"
	payload: {
		handoffMessageId: string
		reason: string
		alternativeSuggestion?: string
		canReconsiderIf?: string
	}
}

// ============================================================================
// REVIEW MESSAGES
// ============================================================================

/**
 * Review request message
 */
export interface ReviewRequestMessage extends BaseMessage {
	category: "review"
	type: "request"
	payload: {
		taskId: string
		workType: "code" | "design" | "documentation" | "api" | "other"
		filesToReview: string[]
		focusAreas?: string[]
		specificConcerns?: string[]
		commitRange?: { from: string; to: string }
	}
}

/**
 * Review feedback message
 */
export interface ReviewFeedbackMessage extends BaseMessage {
	category: "review"
	type: "feedback"
	payload: {
		reviewRequestId: string
		verdict: "approved" | "changes_requested" | "needs_discussion"
		overallComments: string
		fileComments?: Array<{
			file: string
			line?: number
			comment: string
			severity: "critical" | "suggestion" | "nitpick"
		}>
		mustFix?: string[]
		suggestions?: string[]
	}
}

// ============================================================================
// ESCALATION MESSAGES
// ============================================================================

/**
 * Escalation to supervisor
 */
export interface EscalationMessage extends BaseMessage {
	category: "escalation"
	type: "to_supervisor"
	payload: {
		reason: "blocked" | "conflict" | "decision_needed" | "error" | "overload"
		description: string
		taskId?: string
		involvedAgents?: string[]
		attemptedResolutions?: string[]
		suggestedAction?: string
		urgency: "immediate" | "soon" | "routine"
	}
}

/**
 * Supervisor directive
 */
export interface SupervisorDirectiveMessage extends BaseMessage {
	category: "escalation"
	type: "directive"
	payload: {
		directive: string
		reasoning?: string
		overrides?: {
			taskId?: string
			newAssignee?: string
			newPriority?: MessagePriority
			newDeadline?: string
		}
		mustAcknowledge: boolean
	}
}

// ============================================================================
// NOTIFICATION MESSAGES
// ============================================================================

/**
 * Status notification
 */
export interface StatusNotificationMessage extends BaseMessage {
	category: "notification"
	type: "status_update"
	payload: {
		subject: string
		status: string
		details?: string
		affectedItems?: string[]
	}
}

/**
 * Alert notification
 */
export interface AlertNotificationMessage extends BaseMessage {
	category: "notification"
	type: "alert"
	payload: {
		alertType: "error" | "warning" | "info"
		title: string
		description: string
		actionRequired?: string
	}
}

// ============================================================================
// COORDINATION MESSAGES
// ============================================================================

/**
 * Sync request (coordinate work)
 */
export interface SyncRequestMessage extends BaseMessage {
	category: "coordination"
	type: "sync_request"
	payload: {
		topic: string
		participants: string[]
		proposedTime?: string
		agenda?: string[]
		urgency: "immediate" | "scheduled"
	}
}

/**
 * Dependency notification
 */
export interface DependencyNotificationMessage extends BaseMessage {
	category: "coordination"
	type: "dependency"
	payload: {
		dependencyType: "waiting_on" | "provides" | "blocks"
		taskId: string
		relatedTaskId: string
		description: string
		estimatedResolution?: string
	}
}

// ============================================================================
// UNION TYPES
// ============================================================================

/**
 * All task message types
 */
export type TaskMessage =
	| TaskAssignmentMessage
	| TaskCompletionMessage
	| TaskBlockedMessage
	| TaskProgressMessage

/**
 * All query message types
 */
export type QueryMessageType =
	| QueryMessage
	| ClarificationMessage
	| QueryResponseMessage

/**
 * All handoff message types
 */
export type HandoffMessage =
	| HandoffRequestMessage
	| HandoffAcceptMessage
	| HandoffRejectMessage

/**
 * All review message types
 */
export type ReviewMessage = ReviewRequestMessage | ReviewFeedbackMessage

/**
 * All escalation message types
 */
export type EscalationMessageType =
	| EscalationMessage
	| SupervisorDirectiveMessage

/**
 * All notification message types
 */
export type NotificationMessage =
	| StatusNotificationMessage
	| AlertNotificationMessage

/**
 * All coordination message types
 */
export type CoordinationMessage =
	| SyncRequestMessage
	| DependencyNotificationMessage

/**
 * Any structured message
 */
export type StructuredMessage =
	| TaskMessage
	| QueryMessageType
	| HandoffMessage
	| ReviewMessage
	| EscalationMessageType
	| NotificationMessage
	| CoordinationMessage

// ============================================================================
// MESSAGE CREATION HELPERS
// ============================================================================

let messageSequence = 0

/**
 * Generate a unique message ID
 */
export function generateMessageId(): string {
	messageSequence++
	const timestamp = Date.now().toString(36)
	const seq = messageSequence.toString(36).padStart(4, "0")
	return `msg-${timestamp}-${seq}`
}

/**
 * Create base message fields
 */
function createBaseMessage(
	category: MessageCategory,
	fromAgentId: string,
	toAgentId: string,
	projectId: string,
	priority: MessagePriority = "normal",
	responseExpected: ResponseExpectation = "optional",
	taskId?: string,
	inResponseTo?: string,
): BaseMessage {
	return {
		messageId: generateMessageId(),
		category,
		priority,
		fromAgentId,
		toAgentId,
		projectId,
		timestamp: new Date().toISOString(),
		responseExpected,
		taskId,
		inResponseTo,
	}
}

/**
 * Create a task assignment message
 */
export function createTaskAssignment(
	fromAgentId: string,
	toAgentId: string,
	projectId: string,
	payload: TaskAssignmentMessage["payload"],
	priority: MessagePriority = "normal",
): TaskAssignmentMessage {
	return {
		...createBaseMessage(
			"task",
			fromAgentId,
			toAgentId,
			projectId,
			priority,
			"required",
			payload.taskId,
		),
		type: "assignment",
		payload,
	} as TaskAssignmentMessage
}

/**
 * Create a task completion message
 */
export function createTaskCompletion(
	fromAgentId: string,
	toAgentId: string,
	projectId: string,
	payload: TaskCompletionMessage["payload"],
): TaskCompletionMessage {
	return {
		...createBaseMessage(
			"task",
			fromAgentId,
			toAgentId,
			projectId,
			"normal",
			"optional",
			payload.taskId,
		),
		type: "completion",
		payload,
	} as TaskCompletionMessage
}

/**
 * Create a blocked notification
 */
export function createBlockedNotification(
	fromAgentId: string,
	toAgentId: string,
	projectId: string,
	payload: TaskBlockedMessage["payload"],
): TaskBlockedMessage {
	return {
		...createBaseMessage(
			"task",
			fromAgentId,
			toAgentId,
			projectId,
			"high",
			"required",
			payload.taskId,
		),
		type: "blocked",
		payload,
	} as TaskBlockedMessage
}

/**
 * Create a query message
 */
export function createQuery(
	fromAgentId: string,
	toAgentId: string,
	projectId: string,
	payload: QueryMessage["payload"],
	taskId?: string,
): QueryMessage {
	const priority =
		payload.urgency === "blocking" ? "high" : payload.urgency === "soon" ? "normal" : "low"
	return {
		...createBaseMessage(
			"query",
			fromAgentId,
			toAgentId,
			projectId,
			priority,
			"required",
			taskId,
		),
		type: "information_request",
		payload,
	} as QueryMessage
}

/**
 * Create a handoff request
 */
export function createHandoffRequest(
	fromAgentId: string,
	toAgentId: string,
	projectId: string,
	payload: HandoffRequestMessage["payload"],
	taskId?: string,
): HandoffRequestMessage {
	return {
		...createBaseMessage(
			"handoff",
			fromAgentId,
			toAgentId,
			projectId,
			"high",
			"required",
			taskId,
		),
		type: "request",
		payload,
	} as HandoffRequestMessage
}

/**
 * Create a review request
 */
export function createReviewRequest(
	fromAgentId: string,
	toAgentId: string,
	projectId: string,
	payload: ReviewRequestMessage["payload"],
): ReviewRequestMessage {
	return {
		...createBaseMessage(
			"review",
			fromAgentId,
			toAgentId,
			projectId,
			"normal",
			"required",
			payload.taskId,
		),
		type: "request",
		payload,
	} as ReviewRequestMessage
}

/**
 * Create an escalation message
 */
export function createEscalation(
	fromAgentId: string,
	supervisorAgentId: string,
	projectId: string,
	payload: EscalationMessage["payload"],
): EscalationMessage {
	const priority = payload.urgency === "immediate" ? "critical" : payload.urgency === "soon" ? "high" : "normal"
	return {
		...createBaseMessage(
			"escalation",
			fromAgentId,
			supervisorAgentId,
			projectId,
			priority,
			"required",
			payload.taskId,
		),
		type: "to_supervisor",
		payload,
	} as EscalationMessage
}

/**
 * Create a supervisor directive
 */
export function createSupervisorDirective(
	fromAgentId: string,
	toAgentId: string,
	projectId: string,
	payload: SupervisorDirectiveMessage["payload"],
): SupervisorDirectiveMessage {
	return {
		...createBaseMessage(
			"escalation",
			fromAgentId,
			toAgentId,
			projectId,
			"high",
			payload.mustAcknowledge ? "required" : "none",
		),
		type: "directive",
		payload,
	} as SupervisorDirectiveMessage
}

// ============================================================================
// MESSAGE VALIDATION
// ============================================================================

/**
 * Validation error
 */
export interface ValidationError {
	field: string
	message: string
}

/**
 * Validate a structured message
 */
export function validateMessage(
	message: Partial<StructuredMessage>,
): ValidationError[] {
	const errors: ValidationError[] = []

	// Base message validation
	if (!message.messageId) {
		errors.push({ field: "messageId", message: "Message ID is required" })
	}
	if (!message.category) {
		errors.push({ field: "category", message: "Category is required" })
	}
	if (!message.fromAgentId) {
		errors.push({ field: "fromAgentId", message: "Sender agent ID is required" })
	}
	if (!message.toAgentId) {
		errors.push({ field: "toAgentId", message: "Target agent ID is required" })
	}
	if (!message.projectId) {
		errors.push({ field: "projectId", message: "Project ID is required" })
	}

	// Category-specific validation
	const msg = message as StructuredMessage
	if ("payload" in msg && msg.payload) {
		switch (msg.category) {
			case "task":
				if ("taskId" in msg.payload && !msg.payload.taskId) {
					errors.push({ field: "payload.taskId", message: "Task ID is required" })
				}
				break
			case "query":
				if ("question" in msg.payload && !msg.payload.question) {
					errors.push({ field: "payload.question", message: "Question is required" })
				}
				break
			case "handoff":
				if ("reason" in msg.payload && !msg.payload.reason) {
					errors.push({ field: "payload.reason", message: "Handoff reason is required" })
				}
				break
			case "escalation":
				if ("description" in msg.payload && !msg.payload.description) {
					errors.push({ field: "payload.description", message: "Description is required" })
				}
				break
		}
	}

	return errors
}

/**
 * Check if message is valid
 */
export function isValidMessage(message: Partial<StructuredMessage>): boolean {
	return validateMessage(message).length === 0
}

// ============================================================================
// MESSAGE FORMATTING
// ============================================================================

/**
 * Format a structured message for display/logging
 */
export function formatMessageForDisplay(message: StructuredMessage): string {
	const lines: string[] = []

	lines.push(`[${message.category.toUpperCase()}] ${message.messageId}`)
	lines.push(`From: ${message.fromAgentId} → To: ${message.toAgentId}`)
	lines.push(`Priority: ${message.priority} | Response: ${message.responseExpected}`)

	if (message.taskId) {
		lines.push(`Task: ${message.taskId}`)
	}

	// Type-specific formatting
	if ("type" in message) {
		lines.push(`Type: ${message.type}`)
	}

	if ("payload" in message) {
		lines.push("---")
		const payload = message.payload as Record<string, unknown>
		for (const [key, value] of Object.entries(payload)) {
			if (Array.isArray(value)) {
				lines.push(`${key}: ${value.join(", ")}`)
			} else if (typeof value === "object" && value !== null) {
				lines.push(`${key}: ${JSON.stringify(value)}`)
			} else {
				lines.push(`${key}: ${value}`)
			}
		}
	}

	return lines.join("\n")
}

/**
 * Format message as markdown
 */
export function formatMessageAsMarkdown(message: StructuredMessage): string {
	const lines: string[] = []

	const priorityEmoji = {
		critical: "🔴",
		high: "🟠",
		normal: "🟢",
		low: "⚪",
	}[message.priority]

	lines.push(`## ${priorityEmoji} ${message.category.toUpperCase()}`)
	lines.push("")
	lines.push(`**ID:** \`${message.messageId}\``)
	lines.push(`**From:** ${message.fromAgentId}`)
	lines.push(`**To:** ${message.toAgentId}`)
	lines.push(`**Time:** ${message.timestamp}`)

	if (message.taskId) {
		lines.push(`**Task:** ${message.taskId}`)
	}

	if (message.inResponseTo) {
		lines.push(`**In Response To:** ${message.inResponseTo}`)
	}

	lines.push("")

	// Payload content
	if ("payload" in message) {
		const payload = message.payload as Record<string, unknown>

		// Format based on message type
		if ("description" in payload) {
			lines.push("### Description")
			lines.push(String(payload.description))
			lines.push("")
		}

		if ("question" in payload) {
			lines.push("### Question")
			lines.push(String(payload.question))
			lines.push("")
		}

		if ("summary" in payload) {
			lines.push("### Summary")
			lines.push(String(payload.summary))
			lines.push("")
		}

		if ("requirements" in payload && Array.isArray(payload.requirements)) {
			lines.push("### Requirements")
			for (const req of payload.requirements) {
				lines.push(`- ${req}`)
			}
			lines.push("")
		}

		if ("filesCreated" in payload && Array.isArray(payload.filesCreated)) {
			lines.push("### Files Created")
			for (const file of payload.filesCreated) {
				lines.push(`- \`${file}\``)
			}
			lines.push("")
		}
	}

	return lines.join("\n")
}

// ============================================================================
// MESSAGE PARSING
// ============================================================================

/**
 * Extract structured message from free-form text
 * This is a best-effort parser for agent messages
 */
export function parseMessageFromText(
	text: string,
	fromAgentId: string,
	toAgentId: string,
	projectId: string,
): Partial<StructuredMessage> | null {
	const lowerText = text.toLowerCase()

	// Try to detect message category
	let category: MessageCategory = "notification"
	let priority: MessagePriority = "normal"

	if (lowerText.includes("blocked") || lowerText.includes("stuck")) {
		category = "task"
		priority = "high"
	} else if (lowerText.includes("completed") || lowerText.includes("finished") || lowerText.includes("done")) {
		category = "task"
	} else if (lowerText.includes("question") || lowerText.includes("?") || lowerText.includes("how ") || lowerText.includes("what ")) {
		category = "query"
	} else if (lowerText.includes("handoff") || lowerText.includes("hand off") || lowerText.includes("take over")) {
		category = "handoff"
		priority = "high"
	} else if (lowerText.includes("review") || lowerText.includes("check this")) {
		category = "review"
	} else if (lowerText.includes("urgent") || lowerText.includes("critical") || lowerText.includes("escalate")) {
		category = "escalation"
		priority = "critical"
	}

	// Extract task ID if present
	const taskIdMatch = text.match(/T-[A-Z]+-\d+(-[A-Z])?/i)
	const taskId = taskIdMatch ? taskIdMatch[0] : undefined

	return {
		messageId: generateMessageId(),
		category,
		priority,
		fromAgentId,
		toAgentId,
		projectId,
		timestamp: new Date().toISOString(),
		responseExpected: category === "query" ? "required" : "optional",
		taskId,
	}
}
