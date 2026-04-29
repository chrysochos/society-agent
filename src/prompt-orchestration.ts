// Society Agent - prompt orchestration schema and helpers
/**
 * Prompt Orchestration
 *
 * A lightweight, reusable layer for:
 * - request classification
 * - task state tracking
 * - next-step/mode selection
 * - prompt package composition
 * - output validation and retry decisions
 */

export type TaskFamily =
	| "feature"
	| "bug_fix"
	| "refactor"
	| "test_generation"
	| "docs"
	| "review"
	| "migration"
	| "analysis"

export type PromptMode = "plan" | "patch" | "debug" | "review" | "generate"

export type AutonomyLevel = "suggest_only" | "propose_then_edit" | "full_execute"

export type RiskLevel = "low" | "medium" | "high"

export interface RequestIntent {
	taskFamily: TaskFamily
	subtype?: string
	deliverables: string[]
	autonomy: AutonomyLevel
	riskLevel: RiskLevel
	constraints: string[]
	qualityBars: string[]
}

export interface ContextFileRef {
	path: string
	why: string
	score?: number
	snippet?: string
}

export interface ContextPack {
	project: {
		name?: string
		stack?: string[]
		testFramework?: string
	}
	relevantFiles: ContextFileRef[]
	detectedConventions: string[]
	constraints: string[]
}

export interface PromptSections {
	system: string
	task: string
	context: string
	constraints: string
	outputContract: string
	toolGuidance?: string
}

export interface PromptPackage {
	taskFamily: TaskFamily
	mode: PromptMode
	temperature: number
	sections: PromptSections
	retrievedFiles: string[]
	verificationSteps: string[]
}

export type StepStatus = "pending" | "in_progress" | "completed" | "failed"

export interface TaskStepState {
	id: string
	objective: string
	status: StepStatus
	completionCriteria: string[]
	outputContract: string[]
}

export interface EvidenceFact {
	claim: string
	evidence: string[]
	confidence: "low" | "medium" | "high"
}

export interface PromptTaskState {
	taskId: string
	goal: string
	mode: PromptMode
	status: "in_progress" | "blocked" | "completed" | "failed"
	taskFamily: TaskFamily
	completedSteps: string[]
	remainingSteps: string[]
	steps: TaskStepState[]
	validatedFacts: EvidenceFact[]
	inferences: string[]
	unknowns: string[]
	allowedFiles: string[]
	constraints: string[]
	lastOutcome?: {
		stepId: string
		result: "success" | "failure"
		notes?: string
	}
	updatedAt: string
}

export type ValidationIssueType =
	| "schema_failure"
	| "evidence_failure"
	| "scope_failure"
	| "incomplete_step"
	| "conflict"

export interface ValidationIssue {
	type: ValidationIssueType
	message: string
}

export interface StepValidationResult {
	ok: boolean
	issues: ValidationIssue[]
	nextAction: "advance" | "retry" | "escalate"
}

export interface RetryPolicy {
	maxAttemptsPerStep: number
	strategyByIssue: Record<ValidationIssueType, "tighten_format" | "tighten_evidence" | "narrow_scope" | "resume_remaining" | "request_review">
}

export interface ModeRouterConfig {
	defaultModeByFamily: Record<TaskFamily, PromptMode>
	overrideRules?: Array<{
		when: {
			hasUnknowns?: boolean
			hasFailures?: boolean
			requiresNewFiles?: boolean
		}
		mode: PromptMode
	}>
}

export const DEFAULT_MODE_ROUTER: ModeRouterConfig = {
	defaultModeByFamily: {
		feature: "patch",
		bug_fix: "debug",
		refactor: "patch",
		test_generation: "generate",
		docs: "generate",
		review: "review",
		migration: "plan",
		analysis: "plan",
	},
	overrideRules: [
		{ when: { hasFailures: true }, mode: "debug" },
		{ when: { hasUnknowns: true }, mode: "plan" },
		{ when: { requiresNewFiles: true }, mode: "generate" },
	],
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
	maxAttemptsPerStep: 3,
	strategyByIssue: {
		schema_failure: "tighten_format",
		evidence_failure: "tighten_evidence",
		scope_failure: "narrow_scope",
		incomplete_step: "resume_remaining",
		conflict: "request_review",
	},
}

export function inferRequestIntent(request: string): RequestIntent {
	const text = (request || "").toLowerCase()
	const isExplainOnly = /\b(why|what happened|root cause|cause of)\b/.test(text)
	const isInspection = /\b(check|verify|inspect|review|audit|analyze|analyse|investigate|diagnose|status|list|find)\b/.test(text) || isExplainOnly
	const isBug = /\b(fix|bug|error|broken|issue|fail|failing|regression)\b/.test(text)
	const isDocs = /\b(doc|docs|readme|documentation|explain)\b/.test(text)
	const isReview = /\b(review|audit|inspect|critique)\b/.test(text)
	const isRefactor = /\b(refactor|cleanup|restructure|rename)\b/.test(text)
	const isTest = /\b(test|tests|coverage|regression test)\b/.test(text)
	const isMigration = /\b(migrate|migration|upgrade)\b/.test(text)
	const isExplicitModification = /\b(implement|update|modify|change|remove|delete|create|write|add|patch)\b/.test(text)
	const isOperationalRequest = /\b(run|start|stop|restart|install)\b/.test(text)

	let taskFamily: TaskFamily = "feature"
	if (isInspection && !isExplicitModification && !isOperationalRequest) taskFamily = "analysis"
	else if (isBug) taskFamily = "bug_fix"
	else if (isDocs) taskFamily = "docs"
	else if (isReview) taskFamily = "review"
	else if (isRefactor) taskFamily = "refactor"
	else if (isTest) taskFamily = "test_generation"
	else if (isMigration) taskFamily = "migration"

	const riskLevel: RiskLevel = /\b(auth|security|payment|billing|database|migration)\b/.test(text)
		? "high"
		: (taskFamily === "analysis" || taskFamily === "review" ? "low" : "medium")

	const autonomy: AutonomyLevel = (isInspection || /\b(plan|proposal|suggest|recommend)\b/.test(text)) && !isExplicitModification && !isOperationalRequest
		? "suggest_only"
		: "propose_then_edit"

	const deliverables: string[] = []
	if (taskFamily === "analysis" || taskFamily === "review") {
		deliverables.push("findings", "recommended_actions")
	} else {
		deliverables.push("code_changes")
		if (taskFamily === "bug_fix" || taskFamily === "feature" || taskFamily === "refactor") {
			deliverables.push("tests")
		}
		if (taskFamily === "docs") {
			deliverables.push("documentation")
		}
	}

	const constraints = [
		"prefer minimal diff",
		"follow existing repo conventions",
		"avoid unrelated file changes",
	]
	if (autonomy === "suggest_only") {
		constraints.push("read-only unless user explicitly approves changes")
		constraints.push("do not edit or delete files for inspection-only requests")
	}

	return {
		taskFamily,
		deliverables,
		autonomy,
		riskLevel,
		constraints,
		qualityBars: [
			"correctness first",
			"no hallucinated symbols",
			"ask before destructive or ambiguous changes",
			"add/update tests when behavior changes",
		],
	}
}

export function createInitialTaskState(taskId: string, goal: string, intent: RequestIntent, allowedFiles: string[] = []): PromptTaskState {
	const initialMode = DEFAULT_MODE_ROUTER.defaultModeByFamily[intent.taskFamily]
	return {
		taskId,
		goal,
		mode: initialMode,
		status: "in_progress",
		taskFamily: intent.taskFamily,
		completedSteps: [],
		remainingSteps: ["analyze_request", "select_context", "execute", "verify"],
		steps: [
			{
				id: "analyze_request",
				objective: "Classify request and derive execution policy",
				status: "pending",
				completionCriteria: ["task family selected", "constraints captured"],
				outputContract: ["intent summary"],
			},
			{
				id: "select_context",
				objective: "Select relevant files and conventions",
				status: "pending",
				completionCriteria: ["context pack prepared"],
				outputContract: ["relevant files", "conventions", "constraints"],
			},
			{
				id: "execute",
				objective: "Perform the requested work in selected mode",
				status: "pending",
				completionCriteria: ["requested deliverables produced"],
				outputContract: intent.deliverables,
			},
			{
				id: "verify",
				objective: "Validate output against constraints and tests",
				status: "pending",
				completionCriteria: ["verification steps passed"],
				outputContract: ["verification summary"],
			},
		],
		validatedFacts: [],
		inferences: [],
		unknowns: [],
		allowedFiles,
		constraints: intent.constraints,
		updatedAt: new Date().toISOString(),
	}
}

export function selectNextMode(state: PromptTaskState, config: ModeRouterConfig = DEFAULT_MODE_ROUTER): PromptMode {
	let mode = config.defaultModeByFamily[state.taskFamily]
	if (!config.overrideRules || config.overrideRules.length === 0) {
		return mode
	}

	for (const rule of config.overrideRules) {
		const hasUnknowns = !!rule.when.hasUnknowns && state.unknowns.length > 0
		const hasFailures = !!rule.when.hasFailures && state.lastOutcome?.result === "failure"
		const requiresNewFiles = !!rule.when.requiresNewFiles && state.allowedFiles.length === 0
		if (hasUnknowns || hasFailures || requiresNewFiles) {
			mode = rule.mode
		}
	}
	return mode
}

export function composePromptPackage(params: {
	intent: RequestIntent
	context: ContextPack
	state: PromptTaskState
	verificationSteps: string[]
}): PromptPackage {
	const { intent, context, state, verificationSteps } = params
	const mode = selectNextMode(state)

	const sections: PromptSections = {
		system: [
			"Prioritize correctness over creativity.",
			"Prefer minimal diff and existing project patterns.",
			"Do not invent files/APIs/symbols.",
			"No claim without evidence.",
		].join("\n"),
		task: [
			`Task family: ${intent.taskFamily}`,
			`Subtype: ${intent.subtype || "n/a"}`,
			`Deliverables: ${intent.deliverables.join(", ")}`,
			`Autonomy: ${intent.autonomy}`,
			`Risk: ${intent.riskLevel}`,
			`Current mode: ${mode}`,
			`Goal: ${state.goal}`,
		].join("\n"),
		context: [
			`Project: ${context.project.name || "unknown"}`,
			context.project.stack?.length ? `Stack: ${context.project.stack.join(", ")}` : "",
			context.project.testFramework ? `Tests: ${context.project.testFramework}` : "",
			"Relevant files:",
			...context.relevantFiles.map((f) => `- ${f.path} (${f.why})`),
			context.detectedConventions.length ? `Conventions: ${context.detectedConventions.join("; ")}` : "",
		].filter(Boolean).join("\n"),
		constraints: [
			...intent.constraints,
			...context.constraints,
			...state.constraints,
		].map((c) => `- ${c}`).join("\n"),
		outputContract: [
			"1) Summary",
			"2) Files to change",
			"3) Proposed implementation",
			"4) Risks",
			"5) Patch/code",
			"6) Tests",
		].join("\n"),
		toolGuidance: [
			"Read only relevant files first.",
			"Keep edits scoped to allowed files.",
			"Run verification steps before claiming done.",
		].join("\n"),
	}

	return {
		taskFamily: intent.taskFamily,
		mode,
		temperature: mode === "review" || mode === "debug" ? 0.1 : 0.2,
		sections,
		retrievedFiles: context.relevantFiles.map((f) => f.path),
		verificationSteps,
	}
}

export function validateStepOutput(params: {
	requiredFields: string[]
	providedFields: string[]
	evidenceCount: number
	outOfScopeEdits: string[]
}): StepValidationResult {
	const issues: ValidationIssue[] = []
	const missing = params.requiredFields.filter((f) => !params.providedFields.includes(f))
	if (missing.length > 0) {
		issues.push({ type: "schema_failure", message: `Missing required fields: ${missing.join(", ")}` })
	}
	if (params.evidenceCount <= 0) {
		issues.push({ type: "evidence_failure", message: "No evidence provided for claims." })
	}
	if (params.outOfScopeEdits.length > 0) {
		issues.push({ type: "scope_failure", message: `Out-of-scope edits: ${params.outOfScopeEdits.join(", ")}` })
	}

	if (issues.length === 0) {
		return { ok: true, issues: [], nextAction: "advance" }
	}

	const hasScopeIssue = issues.some((i) => i.type === "scope_failure")
	return {
		ok: false,
		issues,
		nextAction: hasScopeIssue ? "retry" : "escalate",
	}
}

export function validateCompletionSummary(params: {
	responseText: string
	totalToolCalls: number
	writeActions: number
	executeActions: number
}): StepValidationResult {
	const { responseText, totalToolCalls, writeActions, executeActions } = params
	const text = (responseText || "").toLowerCase()

	const providedFields: string[] = []
	if (/summary|accomplish|completed|done|implemented|changed/.test(text)) providedFields.push("summary")
	if (/files?|modified|created|updated|patch|src\//.test(text)) providedFields.push("files")
	if (/approach|implementation|fix|solution/.test(text)) providedFields.push("implementation")
	if (/risk|caveat|limitation|trade-?off/.test(text)) providedFields.push("risks")
	if (/test|verify|verification|typecheck|lint|passed|failing|error/.test(text)) providedFields.push("tests")

	const requiredFields = totalToolCalls >= 3
		? ["summary", "files", "tests"]
		: ["summary"]

	return validateStepOutput({
		requiredFields,
		providedFields,
		evidenceCount: Math.max(0, totalToolCalls + writeActions + executeActions),
		outOfScopeEdits: [],
	})
}

export function toPromptString(pkg: PromptPackage): string {
	const s = pkg.sections
	return [
		"<system>",
		s.system,
		"</system>",
		"<task>",
		s.task,
		"</task>",
		"<context>",
		s.context,
		"</context>",
		"<constraints>",
		s.constraints,
		"</constraints>",
		s.toolGuidance ? `<tool_guidance>\n${s.toolGuidance}\n</tool_guidance>` : "",
		"<output_contract>",
		s.outputContract,
		"</output_contract>",
	].filter(Boolean).join("\n\n")
}
