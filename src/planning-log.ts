/**
 * Planning Log - Separate Decision Tracking (Proposal 3)
 *
 * Maintains PLANNING.md for decisions, rationale, and architectural choices
 * separate from PLAN.md which tracks task execution status.
 *
 * Key features:
 * - Decision records with context, options considered, and rationale
 * - Links decisions to tasks they affect
 * - Tracks who made decisions and when
 * - Supports decision revisions with history
 */

import * as fs from "fs/promises"
import * as path from "path"
import { getLog } from "./logger"

const log = getLog()

// ============================================================================
// TYPES
// ============================================================================

/**
 * Categories of decisions
 */
export type DecisionCategory =
	| "architecture" // System design, component structure
	| "technology" // Language, framework, library choices
	| "api" // API design, endpoints, contracts
	| "data" // Data models, storage, schemas
	| "workflow" // Process, delegation, coordination
	| "scope" // Feature scope, requirements interpretation
	| "tradeoff" // Performance vs. maintainability, etc.
	| "risk" // Risk assessment and mitigation
	| "other"

/**
 * Status of a decision
 */
export type DecisionStatus =
	| "proposed" // Under consideration
	| "accepted" // Approved and active
	| "implemented" // Decision has been executed
	| "superseded" // Replaced by another decision
	| "rejected" // Not accepted
	| "deferred" // Postponed for later

/**
 * An option that was considered for a decision
 */
export interface DecisionOption {
	/** Option identifier (e.g., "A", "B", "Option 1") */
	id: string
	/** Brief description of the option */
	description: string
	/** Pros of this option */
	pros: string[]
	/** Cons of this option */
	cons: string[]
	/** Was this the chosen option? */
	chosen: boolean
}

/**
 * A decision record
 */
export interface Decision {
	/** Unique decision ID (e.g., "D-001", "D-ARCH-001") */
	id: string
	/** Short title */
	title: string
	/** Decision category */
	category: DecisionCategory
	/** Current status */
	status: DecisionStatus
	/** The decision context - why this decision was needed */
	context: string
	/** Options that were considered */
	options: DecisionOption[]
	/** The actual decision made */
	decision: string
	/** Rationale for the decision */
	rationale: string
	/** Expected consequences or implications */
	consequences?: string[]
	/** Related task IDs that this decision affects */
	relatedTasks?: string[]
	/** Related decision IDs (prior decisions this builds on) */
	relatedDecisions?: string[]
	/** Who made this decision */
	decidedBy: string
	/** When the decision was made */
	decidedAt: string
	/** If superseded, the ID of the new decision */
	supersededBy?: string
	/** Revision history */
	revisions?: DecisionRevision[]
}

/**
 * A revision to a decision
 */
export interface DecisionRevision {
	/** When revised */
	revisedAt: string
	/** Who revised */
	revisedBy: string
	/** What changed */
	changes: string
	/** Why it changed */
	reason: string
}

/**
 * The full planning log
 */
export interface PlanningLog {
	/** Project identifier */
	projectId: string
	/** All decisions */
	decisions: Decision[]
	/** Decision sequence counter */
	sequence: number
	/** Last updated */
	updatedAt: string
}

// ============================================================================
// DECISION ID GENERATION
// ============================================================================

/**
 * Generate a decision ID
 */
export function generateDecisionId(
	sequence: number,
	category?: DecisionCategory,
): string {
	const num = String(sequence).padStart(3, "0")
	if (category && category !== "other") {
		const prefix = category.substring(0, 4).toUpperCase()
		return `D-${prefix}-${num}`
	}
	return `D-${num}`
}

// ============================================================================
// DECISION OPERATIONS
// ============================================================================

/**
 * Create a new decision
 */
export function createDecision(
	planningLog: PlanningLog,
	params: {
		title: string
		category: DecisionCategory
		context: string
		options: Omit<DecisionOption, "chosen">[]
		chosenOptionId: string
		decision: string
		rationale: string
		consequences?: string[]
		relatedTasks?: string[]
		relatedDecisions?: string[]
		decidedBy: string
	},
): Decision {
	const sequence = (planningLog.sequence || 0) + 1
	const id = generateDecisionId(sequence, params.category)

	const options: DecisionOption[] = params.options.map((opt) => ({
		...opt,
		chosen: opt.id === params.chosenOptionId,
	}))

	const decision: Decision = {
		id,
		title: params.title,
		category: params.category,
		status: "accepted",
		context: params.context,
		options,
		decision: params.decision,
		rationale: params.rationale,
		consequences: params.consequences,
		relatedTasks: params.relatedTasks,
		relatedDecisions: params.relatedDecisions,
		decidedBy: params.decidedBy,
		decidedAt: new Date().toISOString(),
	}

	planningLog.decisions.push(decision)
	planningLog.sequence = sequence
	planningLog.updatedAt = new Date().toISOString()

	return decision
}

/**
 * Propose a decision (not yet accepted)
 */
export function proposeDecision(
	planningLog: PlanningLog,
	params: {
		title: string
		category: DecisionCategory
		context: string
		options: Omit<DecisionOption, "chosen">[]
		recommendedOptionId?: string
		decidedBy: string
		relatedTasks?: string[]
	},
): Decision {
	const sequence = (planningLog.sequence || 0) + 1
	const id = generateDecisionId(sequence, params.category)

	const options: DecisionOption[] = params.options.map((opt) => ({
		...opt,
		chosen: false, // Not yet chosen
	}))

	const decision: Decision = {
		id,
		title: params.title,
		category: params.category,
		status: "proposed",
		context: params.context,
		options,
		decision: params.recommendedOptionId
			? `Recommended: ${params.recommendedOptionId}`
			: "Pending decision",
		rationale: "Awaiting review",
		relatedTasks: params.relatedTasks,
		decidedBy: params.decidedBy,
		decidedAt: new Date().toISOString(),
	}

	planningLog.decisions.push(decision)
	planningLog.sequence = sequence
	planningLog.updatedAt = new Date().toISOString()

	return decision
}

/**
 * Accept a proposed decision
 */
export function acceptDecision(
	planningLog: PlanningLog,
	decisionId: string,
	params: {
		chosenOptionId: string
		decision: string
		rationale: string
		consequences?: string[]
		acceptedBy: string
	},
): Decision | null {
	const decision = planningLog.decisions.find((d) => d.id === decisionId)
	if (!decision || decision.status !== "proposed") {
		return null
	}

	// Mark chosen option
	decision.options = decision.options.map((opt) => ({
		...opt,
		chosen: opt.id === params.chosenOptionId,
	}))

	decision.status = "accepted"
	decision.decision = params.decision
	decision.rationale = params.rationale
	decision.consequences = params.consequences

	// Add revision record
	decision.revisions = decision.revisions || []
	decision.revisions.push({
		revisedAt: new Date().toISOString(),
		revisedBy: params.acceptedBy,
		changes: "Decision accepted",
		reason: params.rationale,
	})

	planningLog.updatedAt = new Date().toISOString()

	return decision
}

/**
 * Mark a decision as implemented
 */
export function markDecisionImplemented(
	planningLog: PlanningLog,
	decisionId: string,
	implementedBy: string,
): Decision | null {
	const decision = planningLog.decisions.find((d) => d.id === decisionId)
	if (!decision || decision.status !== "accepted") {
		return null
	}

	decision.status = "implemented"
	decision.revisions = decision.revisions || []
	decision.revisions.push({
		revisedAt: new Date().toISOString(),
		revisedBy: implementedBy,
		changes: "Decision implemented",
		reason: "Implementation complete",
	})

	planningLog.updatedAt = new Date().toISOString()

	return decision
}

/**
 * Supersede a decision with a new one
 */
export function supersedeDecision(
	planningLog: PlanningLog,
	oldDecisionId: string,
	newDecisionParams: Parameters<typeof createDecision>[1],
): { oldDecision: Decision; newDecision: Decision } | null {
	const oldDecision = planningLog.decisions.find((d) => d.id === oldDecisionId)
	if (!oldDecision) {
		return null
	}

	// Create the new decision
	const newDecision = createDecision(planningLog, {
		...newDecisionParams,
		relatedDecisions: [
			...(newDecisionParams.relatedDecisions || []),
			oldDecisionId,
		],
	})

	// Mark old decision as superseded
	oldDecision.status = "superseded"
	oldDecision.supersededBy = newDecision.id
	oldDecision.revisions = oldDecision.revisions || []
	oldDecision.revisions.push({
		revisedAt: new Date().toISOString(),
		revisedBy: newDecisionParams.decidedBy,
		changes: `Superseded by ${newDecision.id}`,
		reason: newDecisionParams.rationale,
	})

	return { oldDecision, newDecision }
}

/**
 * Reject a proposed decision
 */
export function rejectDecision(
	planningLog: PlanningLog,
	decisionId: string,
	params: {
		reason: string
		rejectedBy: string
	},
): Decision | null {
	const decision = planningLog.decisions.find((d) => d.id === decisionId)
	if (!decision || decision.status !== "proposed") {
		return null
	}

	decision.status = "rejected"
	decision.rationale = params.reason
	decision.revisions = decision.revisions || []
	decision.revisions.push({
		revisedAt: new Date().toISOString(),
		revisedBy: params.rejectedBy,
		changes: "Decision rejected",
		reason: params.reason,
	})

	planningLog.updatedAt = new Date().toISOString()

	return decision
}

/**
 * Defer a decision
 */
export function deferDecision(
	planningLog: PlanningLog,
	decisionId: string,
	params: {
		reason: string
		deferredBy: string
		deferUntil?: string
	},
): Decision | null {
	const decision = planningLog.decisions.find((d) => d.id === decisionId)
	if (!decision || !["proposed", "accepted"].includes(decision.status)) {
		return null
	}

	decision.status = "deferred"
	decision.revisions = decision.revisions || []
	decision.revisions.push({
		revisedAt: new Date().toISOString(),
		revisedBy: params.deferredBy,
		changes: `Deferred${params.deferUntil ? ` until ${params.deferUntil}` : ""}`,
		reason: params.reason,
	})

	planningLog.updatedAt = new Date().toISOString()

	return decision
}

// ============================================================================
// QUERY FUNCTIONS
// ============================================================================

/**
 * Get decisions by category
 */
export function getDecisionsByCategory(
	planningLog: PlanningLog,
	category: DecisionCategory,
): Decision[] {
	return planningLog.decisions.filter((d) => d.category === category)
}

/**
 * Get decisions by status
 */
export function getDecisionsByStatus(
	planningLog: PlanningLog,
	status: DecisionStatus,
): Decision[] {
	return planningLog.decisions.filter((d) => d.status === status)
}

/**
 * Get decisions affecting a task
 */
export function getDecisionsForTask(
	planningLog: PlanningLog,
	taskId: string,
): Decision[] {
	return planningLog.decisions.filter((d) =>
		d.relatedTasks?.includes(taskId),
	)
}

/**
 * Get active decisions (accepted or implemented)
 */
export function getActiveDecisions(planningLog: PlanningLog): Decision[] {
	return planningLog.decisions.filter((d) =>
		["accepted", "implemented"].includes(d.status),
	)
}

/**
 * Get pending decisions (proposed)
 */
export function getPendingDecisions(planningLog: PlanningLog): Decision[] {
	return planningLog.decisions.filter((d) => d.status === "proposed")
}

// ============================================================================
// PLANNING.MD GENERATION
// ============================================================================

/**
 * Generate PLANNING.md content
 */
export function generatePlanningMd(planningLog: PlanningLog): string {
	const lines: string[] = [
		"# Planning Log",
		"",
		"> This document tracks architectural decisions, design choices, and their rationale.",
		"> It is separate from PLAN.md which tracks task execution status.",
		"",
		`Last updated: ${planningLog.updatedAt}`,
		"",
	]

	// Group decisions by status
	const pending = getPendingDecisions(planningLog)
	const active = getActiveDecisions(planningLog)
	const superseded = planningLog.decisions.filter(
		(d) => d.status === "superseded",
	)
	const rejected = planningLog.decisions.filter((d) => d.status === "rejected")
	const deferred = planningLog.decisions.filter((d) => d.status === "deferred")

	// Pending decisions first (need attention)
	if (pending.length > 0) {
		lines.push("## ⏳ Pending Decisions", "")
		for (const d of pending) {
			lines.push(...formatDecision(d))
		}
	}

	// Active decisions
	if (active.length > 0) {
		lines.push("## ✅ Active Decisions", "")
		for (const d of active) {
			lines.push(...formatDecision(d))
		}
	}

	// Deferred decisions
	if (deferred.length > 0) {
		lines.push("## ⏸️ Deferred Decisions", "")
		for (const d of deferred) {
			lines.push(...formatDecision(d))
		}
	}

	// Superseded and rejected in collapsed section
	if (superseded.length > 0 || rejected.length > 0) {
		lines.push("## 📜 Historical Decisions", "")
		lines.push("<details>")
		lines.push("<summary>Superseded and rejected decisions</summary>")
		lines.push("")

		if (superseded.length > 0) {
			lines.push("### Superseded", "")
			for (const d of superseded) {
				lines.push(...formatDecision(d, true))
			}
		}

		if (rejected.length > 0) {
			lines.push("### Rejected", "")
			for (const d of rejected) {
				lines.push(...formatDecision(d, true))
			}
		}

		lines.push("</details>", "")
	}

	// Summary by category
	lines.push("## 📊 Decision Summary", "")
	lines.push("| Category | Active | Pending | Total |")
	lines.push("|----------|--------|---------|-------|")

	const categories: DecisionCategory[] = [
		"architecture",
		"technology",
		"api",
		"data",
		"workflow",
		"scope",
		"tradeoff",
		"risk",
		"other",
	]

	for (const cat of categories) {
		const catDecisions = getDecisionsByCategory(planningLog, cat)
		if (catDecisions.length > 0) {
			const activeCount = catDecisions.filter((d) =>
				["accepted", "implemented"].includes(d.status),
			).length
			const pendingCount = catDecisions.filter(
				(d) => d.status === "proposed",
			).length
			lines.push(
				`| ${cat} | ${activeCount} | ${pendingCount} | ${catDecisions.length} |`,
			)
		}
	}

	lines.push("")

	return lines.join("\n")
}

/**
 * Format a single decision for markdown
 */
function formatDecision(decision: Decision, compact = false): string[] {
	const lines: string[] = []

	const statusIcon = {
		proposed: "⏳",
		accepted: "✅",
		implemented: "✓",
		superseded: "↩️",
		rejected: "❌",
		deferred: "⏸️",
	}[decision.status]

	lines.push(`### ${statusIcon} ${decision.id}: ${decision.title}`)
	lines.push("")

	if (!compact) {
		lines.push(`**Category:** ${decision.category}`)
		lines.push(`**Status:** ${decision.status}`)
		lines.push(`**Decided by:** ${decision.decidedBy}`)
		lines.push(`**Date:** ${decision.decidedAt.split("T")[0]}`)
		lines.push("")

		lines.push("**Context:**")
		lines.push(decision.context)
		lines.push("")

		if (decision.options.length > 0) {
			lines.push("**Options Considered:**")
			for (const opt of decision.options) {
				const marker = opt.chosen ? "✓" : "○"
				lines.push(`- ${marker} **${opt.id}:** ${opt.description}`)
				if (opt.pros.length > 0) {
					lines.push(`  - Pros: ${opt.pros.join(", ")}`)
				}
				if (opt.cons.length > 0) {
					lines.push(`  - Cons: ${opt.cons.join(", ")}`)
				}
			}
			lines.push("")
		}

		lines.push("**Decision:**")
		lines.push(decision.decision)
		lines.push("")

		lines.push("**Rationale:**")
		lines.push(decision.rationale)
		lines.push("")

		if (decision.consequences && decision.consequences.length > 0) {
			lines.push("**Consequences:**")
			for (const c of decision.consequences) {
				lines.push(`- ${c}`)
			}
			lines.push("")
		}

		if (decision.relatedTasks && decision.relatedTasks.length > 0) {
			lines.push(`**Related Tasks:** ${decision.relatedTasks.join(", ")}`)
			lines.push("")
		}

		if (decision.relatedDecisions && decision.relatedDecisions.length > 0) {
			lines.push(
				`**Related Decisions:** ${decision.relatedDecisions.join(", ")}`,
			)
			lines.push("")
		}

		if (decision.supersededBy) {
			lines.push(`**Superseded by:** ${decision.supersededBy}`)
			lines.push("")
		}
	} else {
		// Compact format for historical decisions
		lines.push(`- **Category:** ${decision.category}`)
		lines.push(`- **Decision:** ${decision.decision}`)
		if (decision.supersededBy) {
			lines.push(`- **Superseded by:** ${decision.supersededBy}`)
		}
		lines.push("")
	}

	lines.push("---")
	lines.push("")

	return lines
}

// ============================================================================
// PLANNING.MD PARSING
// ============================================================================

/**
 * Parse PLANNING.md content back to PlanningLog
 * Note: This is a best-effort parser that recovers decision IDs and basic info
 */
export function parsePlanningMd(content: string): Partial<PlanningLog> {
	const decisions: Decision[] = []
	let maxSequence = 0

	// Match decision headers: ### ✅ D-001: Title
	const decisionPattern = /^### [^\s]+ (D-[A-Z]*-?\d+): (.+)$/gm
	let match

	while ((match = decisionPattern.exec(content)) !== null) {
		const id = match[1]
		const title = match[2]

		// Extract sequence number
		const seqMatch = id.match(/(\d+)$/)
		if (seqMatch) {
			const seq = parseInt(seqMatch[1], 10)
			if (seq > maxSequence) {
				maxSequence = seq
			}
		}

		// Create minimal decision record
		decisions.push({
			id,
			title,
			category: "other",
			status: "accepted",
			context: "",
			options: [],
			decision: "",
			rationale: "",
			decidedBy: "unknown",
			decidedAt: new Date().toISOString(),
		})
	}

	return {
		decisions,
		sequence: maxSequence,
	}
}

// ============================================================================
// FILE OPERATIONS
// ============================================================================

/**
 * Load planning log from project directory
 */
export async function loadPlanningLog(
	projectDir: string,
): Promise<PlanningLog> {
	const planningPath = path.join(projectDir, "PLANNING.md")

	try {
		const content = await fs.readFile(planningPath, "utf-8")
		const parsed = parsePlanningMd(content)

		return {
			projectId: path.basename(projectDir),
			decisions: parsed.decisions || [],
			sequence: parsed.sequence || 0,
			updatedAt: new Date().toISOString(),
		}
	} catch {
		// Return empty planning log
		return {
			projectId: path.basename(projectDir),
			decisions: [],
			sequence: 0,
			updatedAt: new Date().toISOString(),
		}
	}
}

/**
 * Save planning log to project directory
 */
export async function savePlanningLog(
	projectDir: string,
	planningLog: PlanningLog,
): Promise<void> {
	const planningPath = path.join(projectDir, "PLANNING.md")
	const content = generatePlanningMd(planningLog)

	await fs.writeFile(planningPath, content, "utf-8")
	log.info(`Updated PLANNING.md in ${projectDir}`)
}

/**
 * Initialize an empty planning log
 */
export function initPlanningLog(projectId: string): PlanningLog {
	return {
		projectId,
		decisions: [],
		sequence: 0,
		updatedAt: new Date().toISOString(),
	}
}
