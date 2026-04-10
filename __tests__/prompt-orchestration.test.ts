import { describe, it, expect } from "vitest"
import {
	inferRequestIntent,
	createInitialTaskState,
	selectNextMode,
	composePromptPackage,
	validateStepOutput,
	validateCompletionSummary,
	toPromptString,
	type RequestIntent,
} from "../src/prompt-orchestration"

describe("prompt-orchestration", () => {
	describe("inferRequestIntent", () => {
		it("classifies bug-fix requests and high risk domains", () => {
			const intent = inferRequestIntent("Fix authentication bug in payment flow and database writes")
			expect(intent.taskFamily).toBe("bug_fix")
			expect(intent.riskLevel).toBe("high")
			expect(intent.deliverables).toContain("tests")
		})

		it("classifies docs requests and adds documentation deliverable", () => {
			const intent = inferRequestIntent("Update docs and README for setup")
			expect(intent.taskFamily).toBe("docs")
			expect(intent.deliverables).toContain("documentation")
		})

		it("uses suggest_only autonomy for planning phrasing", () => {
			const intent = inferRequestIntent("Suggest a migration plan for module split")
			expect(intent.autonomy).toBe("suggest_only")
		})
	})

	describe("createInitialTaskState + selectNextMode", () => {
		it("seeds initial state and preserves allowed files", () => {
			const intent: RequestIntent = inferRequestIntent("Implement feature")
			const state = createInitialTaskState("task_1", "Implement feature", intent, ["src/a.ts"])
			expect(state.taskId).toBe("task_1")
			expect(state.status).toBe("in_progress")
			expect(state.allowedFiles).toEqual(["src/a.ts"])
			expect(state.mode).toBe("patch")
			expect(state.steps.length).toBe(4)
		})

		it("switches to debug mode when last outcome failed", () => {
			const intent = inferRequestIntent("fix regression")
			const state = createInitialTaskState("task_2", "Fix regression", intent, ["src/x.ts"])
			state.lastOutcome = { stepId: "execute", result: "failure" }
			state.unknowns = []
			expect(selectNextMode(state)).toBe("debug")
		})
	})

	describe("composePromptPackage + toPromptString", () => {
		it("composes package with retrieved files and sections", () => {
			const intent = inferRequestIntent("add a feature")
			const state = createInitialTaskState("task_3", "Add feature", intent, ["src/feature.ts"])
			const pkg = composePromptPackage({
				intent,
				state,
				context: {
					project: { name: "society-agent", stack: ["typescript"] },
					relevantFiles: [{ path: "src/feature.ts", why: "feature entry" }],
					detectedConventions: ["minimal diff"],
					constraints: ["stay in scope"],
				},
				verificationSteps: ["npm test"],
			})

			expect(pkg.retrievedFiles).toEqual(["src/feature.ts"])
			expect(pkg.verificationSteps).toEqual(["npm test"])
			expect(pkg.sections.context).toContain("Relevant files:")
			expect(pkg.sections.task).toContain("Task family")

			const prompt = toPromptString(pkg)
			expect(prompt).toContain("<system>")
			expect(prompt).toContain("<task>")
			expect(prompt).toContain("<context>")
			expect(prompt).toContain("<constraints>")
			expect(prompt).toContain("<output_contract>")
		})
	})

	describe("validateStepOutput", () => {
		it("passes when required fields, evidence, and scope are valid", () => {
			const result = validateStepOutput({
				requiredFields: ["summary", "tests"],
				providedFields: ["summary", "tests"],
				evidenceCount: 2,
				outOfScopeEdits: [],
			})
			expect(result.ok).toBe(true)
			expect(result.nextAction).toBe("advance")
		})

		it("returns retry for scope failures", () => {
			const result = validateStepOutput({
				requiredFields: ["summary"],
				providedFields: ["summary"],
				evidenceCount: 1,
				outOfScopeEdits: ["src/unrelated.ts"],
			})
			expect(result.ok).toBe(false)
			expect(result.nextAction).toBe("retry")
			expect(result.issues.some((i) => i.type === "scope_failure")).toBe(true)
		})

		it("returns escalate for schema/evidence failures without scope issues", () => {
			const result = validateStepOutput({
				requiredFields: ["summary", "tests"],
				providedFields: ["summary"],
				evidenceCount: 0,
				outOfScopeEdits: [],
			})
			expect(result.ok).toBe(false)
			expect(result.nextAction).toBe("escalate")
			expect(result.issues.some((i) => i.type === "schema_failure")).toBe(true)
			expect(result.issues.some((i) => i.type === "evidence_failure")).toBe(true)
		})
	})

	describe("validateCompletionSummary", () => {
		it("requires only summary when tool count is low", () => {
			const result = validateCompletionSummary({
				responseText: "Summary: done.",
				totalToolCalls: 1,
				writeActions: 0,
				executeActions: 0,
			})
			expect(result.ok).toBe(true)
		})

		it("requires summary, files, and tests for tool-heavy completions", () => {
			const result = validateCompletionSummary({
				responseText: "Summary: implemented fix.",
				totalToolCalls: 5,
				writeActions: 2,
				executeActions: 1,
			})
			expect(result.ok).toBe(false)
			expect(result.issues.some((i) => i.type === "schema_failure")).toBe(true)
		})

		it("passes when summary includes files and verification details", () => {
			const result = validateCompletionSummary({
				responseText: "Summary: implemented fix. Files modified: src/a.ts. Tests: npm test passed.",
				totalToolCalls: 6,
				writeActions: 2,
				executeActions: 2,
			})
			expect(result.ok).toBe(true)
			expect(result.nextAction).toBe("advance")
		})
	})
})
