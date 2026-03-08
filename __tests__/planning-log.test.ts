// Society Agent - Planning Log Tests
import { describe, it, expect, beforeEach, vi } from "vitest"
import {
	generateDecisionId,
	createDecision,
	proposeDecision,
	acceptDecision,
	markDecisionImplemented,
	supersedeDecision,
	rejectDecision,
	deferDecision,
	PlanningLog,
	Decision,
	DecisionCategory,
} from "../src/planning-log"

// Mock the logger
vi.mock("../src/logger", () => ({
	getLog: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}))

function createEmptyPlanningLog(projectId = "test-project"): PlanningLog {
	return {
		projectId,
		decisions: [],
		sequence: 0,
		updatedAt: new Date().toISOString(),
	}
}

describe("generateDecisionId", () => {
	it("should generate simple ID without category", () => {
		const id = generateDecisionId(1)
		expect(id).toBe("D-001")
	})

	it("should generate ID with category prefix", () => {
		const id = generateDecisionId(5, "architecture")
		expect(id).toBe("D-ARCH-005")
	})

	it("should handle 'other' category as no prefix", () => {
		const id = generateDecisionId(10, "other")
		expect(id).toBe("D-010")
	})

	it("should pad sequence numbers correctly", () => {
		expect(generateDecisionId(1)).toBe("D-001")
		expect(generateDecisionId(99)).toBe("D-099")
		expect(generateDecisionId(100)).toBe("D-100")
	})

	it("should generate IDs for all categories", () => {
		const categories: DecisionCategory[] = [
			"architecture",
			"technology",
			"api",
			"data",
			"workflow",
			"scope",
			"tradeoff",
			"risk",
		]
		for (const cat of categories) {
			const id = generateDecisionId(1, cat)
			expect(id).toMatch(/^D-[A-Z]{3,4}-001$/)
		}
	})
})

describe("createDecision", () => {
	let planningLog: PlanningLog

	beforeEach(() => {
		planningLog = createEmptyPlanningLog()
	})

	it("should create a decision with accepted status", () => {
		const decision = createDecision(planningLog, {
			title: "Use PostgreSQL for database",
			category: "technology",
			context: "Need persistent storage for user data",
			options: [
				{ id: "A", description: "PostgreSQL", pros: ["Reliable"], cons: ["Complex"] },
				{ id: "B", description: "SQLite", pros: ["Simple"], cons: ["Limited"] },
			],
			chosenOptionId: "A",
			decision: "Use PostgreSQL",
			rationale: "Better for production workloads",
			decidedBy: "backend-specialist",
		})

		expect(decision.status).toBe("accepted")
		expect(decision.id).toBe("D-TECH-001")
		expect(decision.title).toBe("Use PostgreSQL for database")
		expect(decision.options.find((o) => o.id === "A")?.chosen).toBe(true)
		expect(decision.options.find((o) => o.id === "B")?.chosen).toBe(false)
	})

	it("should increment sequence number", () => {
		createDecision(planningLog, {
			title: "First decision",
			category: "architecture",
			context: "Context",
			options: [{ id: "A", description: "Option A", pros: [], cons: [] }],
			chosenOptionId: "A",
			decision: "Decision",
			rationale: "Rationale",
			decidedBy: "agent-1",
		})

		const second = createDecision(planningLog, {
			title: "Second decision",
			category: "architecture",
			context: "Context",
			options: [{ id: "A", description: "Option A", pros: [], cons: [] }],
			chosenOptionId: "A",
			decision: "Decision",
			rationale: "Rationale",
			decidedBy: "agent-1",
		})

		expect(planningLog.sequence).toBe(2)
		expect(second.id).toBe("D-ARCH-002")
	})

	it("should add decision to planning log", () => {
		createDecision(planningLog, {
			title: "Test",
			category: "data",
			context: "Context",
			options: [{ id: "A", description: "Option A", pros: [], cons: [] }],
			chosenOptionId: "A",
			decision: "Decision",
			rationale: "Rationale",
			decidedBy: "agent-1",
		})

		expect(planningLog.decisions).toHaveLength(1)
	})

	it("should include optional fields when provided", () => {
		const decision = createDecision(planningLog, {
			title: "Test",
			category: "api",
			context: "Context",
			options: [{ id: "A", description: "Option A", pros: [], cons: [] }],
			chosenOptionId: "A",
			decision: "Decision",
			rationale: "Rationale",
			decidedBy: "agent-1",
			consequences: ["May need migration"],
			relatedTasks: ["TASK-001"],
			relatedDecisions: ["D-001"],
		})

		expect(decision.consequences).toEqual(["May need migration"])
		expect(decision.relatedTasks).toEqual(["TASK-001"])
		expect(decision.relatedDecisions).toEqual(["D-001"])
	})
})

describe("proposeDecision", () => {
	let planningLog: PlanningLog

	beforeEach(() => {
		planningLog = createEmptyPlanningLog()
	})

	it("should create a decision with proposed status", () => {
		const decision = proposeDecision(planningLog, {
			title: "Consider caching strategy",
			category: "architecture",
			context: "Performance optimization needed",
			options: [
				{ id: "A", description: "Redis", pros: ["Fast"], cons: ["Extra service"] },
				{ id: "B", description: "In-memory", pros: ["Simple"], cons: ["Not shared"] },
			],
			decidedBy: "backend-specialist",
		})

		expect(decision.status).toBe("proposed")
		expect(decision.options.every((o) => o.chosen === false)).toBe(true)
	})

	it("should set recommended option in decision text", () => {
		const decision = proposeDecision(planningLog, {
			title: "Test",
			category: "technology",
			context: "Context",
			options: [{ id: "A", description: "Option A", pros: [], cons: [] }],
			recommendedOptionId: "A",
			decidedBy: "agent-1",
		})

		expect(decision.decision).toBe("Recommended: A")
	})
})

describe("acceptDecision", () => {
	let planningLog: PlanningLog
	let proposedDecision: Decision

	beforeEach(() => {
		planningLog = createEmptyPlanningLog()
		proposedDecision = proposeDecision(planningLog, {
			title: "Test decision",
			category: "technology",
			context: "Context",
			options: [
				{ id: "A", description: "Option A", pros: ["Pro"], cons: ["Con"] },
				{ id: "B", description: "Option B", pros: ["Pro"], cons: ["Con"] },
			],
			decidedBy: "agent-1",
		})
	})

	it("should accept a proposed decision", () => {
		const accepted = acceptDecision(planningLog, proposedDecision.id, {
			chosenOptionId: "B",
			decision: "Go with Option B",
			rationale: "Better fit for requirements",
			acceptedBy: "lead-agent",
		})

		expect(accepted).not.toBeNull()
		expect(accepted?.status).toBe("accepted")
		expect(accepted?.decision).toBe("Go with Option B")
		expect(accepted?.options.find((o) => o.id === "B")?.chosen).toBe(true)
	})

	it("should add revision record", () => {
		const accepted = acceptDecision(planningLog, proposedDecision.id, {
			chosenOptionId: "A",
			decision: "Option A",
			rationale: "Rationale",
			acceptedBy: "lead-agent",
		})

		expect(accepted?.revisions).toHaveLength(1)
		expect(accepted?.revisions?.[0].revisedBy).toBe("lead-agent")
	})

	it("should return null for non-proposed decisions", () => {
		// First accept it
		acceptDecision(planningLog, proposedDecision.id, {
			chosenOptionId: "A",
			decision: "Option A",
			rationale: "Rationale",
			acceptedBy: "lead-agent",
		})

		// Try to accept again
		const result = acceptDecision(planningLog, proposedDecision.id, {
			chosenOptionId: "A",
			decision: "Option A",
			rationale: "Rationale",
			acceptedBy: "another-agent",
		})

		expect(result).toBeNull()
	})

	it("should return null for non-existent decision", () => {
		const result = acceptDecision(planningLog, "D-NONEXISTENT", {
			chosenOptionId: "A",
			decision: "Option A",
			rationale: "Rationale",
			acceptedBy: "lead-agent",
		})

		expect(result).toBeNull()
	})
})

describe("markDecisionImplemented", () => {
	let planningLog: PlanningLog

	beforeEach(() => {
		planningLog = createEmptyPlanningLog()
		createDecision(planningLog, {
			title: "Test decision",
			category: "architecture",
			context: "Context",
			options: [{ id: "A", description: "Option A", pros: [], cons: [] }],
			chosenOptionId: "A",
			decision: "Decision",
			rationale: "Rationale",
			decidedBy: "agent-1",
		})
	})

	it("should mark accepted decision as implemented", () => {
		const result = markDecisionImplemented(
			planningLog,
			planningLog.decisions[0].id,
			"implementing-agent",
		)

		expect(result).not.toBeNull()
		expect(result?.status).toBe("implemented")
	})

	it("should add revision record", () => {
		const result = markDecisionImplemented(
			planningLog,
			planningLog.decisions[0].id,
			"implementing-agent",
		)

		expect(result?.revisions).toHaveLength(1)
		expect(result?.revisions?.[0].changes).toContain("implemented")
	})
})

describe("supersededDecision", () => {
	let planningLog: PlanningLog

	beforeEach(() => {
		planningLog = createEmptyPlanningLog()
		createDecision(planningLog, {
			title: "Original decision",
			category: "technology",
			context: "Context",
			options: [{ id: "A", description: "Option A", pros: [], cons: [] }],
			chosenOptionId: "A",
			decision: "Decision",
			rationale: "Rationale",
			decidedBy: "agent-1",
		})
	})

	it("should mark decision as superseded", () => {
		const result = supersedeDecision(planningLog, planningLog.decisions[0].id, {
			title: "New decision replacing original",
			category: "technology",
			context: "Requirements changed",
			options: [{ id: "A", description: "New option", pros: ["Better"], cons: [] }],
			chosenOptionId: "A",
			decision: "Using new approach",
			rationale: "Original no longer valid",
			decidedBy: "agent-2",
		})

		expect(result).not.toBeNull()
		expect(result?.oldDecision.status).toBe("superseded")
		expect(result?.oldDecision.supersededBy).toBe(result?.newDecision.id)
	})
})

describe("rejectDecision", () => {
	let planningLog: PlanningLog
	let proposedDecision: Decision

	beforeEach(() => {
		planningLog = createEmptyPlanningLog()
		proposedDecision = proposeDecision(planningLog, {
			title: "Test decision",
			category: "architecture",
			context: "Context",
			options: [{ id: "A", description: "Option A", pros: [], cons: [] }],
			decidedBy: "agent-1",
		})
	})

	it("should reject a proposed decision", () => {
		const result = rejectDecision(
			planningLog,
			proposedDecision.id,
			{
				reason: "Not aligned with goals",
				rejectedBy: "lead-agent",
			},
		)

		expect(result).not.toBeNull()
		expect(result?.status).toBe("rejected")
	})

	it("should return null for non-proposed decisions", () => {
		// Create an accepted decision
		const accepted = createDecision(planningLog, {
			title: "Accepted",
			category: "technology",
			context: "Context",
			options: [{ id: "A", description: "Option A", pros: [], cons: [] }],
			chosenOptionId: "A",
			decision: "Decision",
			rationale: "Rationale",
			decidedBy: "agent-1",
		})

		const result = rejectDecision(planningLog, accepted.id, {
			reason: "Reason",
			rejectedBy: "lead-agent",
		})

		expect(result).toBeNull()
	})
})

describe("deferDecision", () => {
	let planningLog: PlanningLog
	let proposedDecision: Decision

	beforeEach(() => {
		planningLog = createEmptyPlanningLog()
		proposedDecision = proposeDecision(planningLog, {
			title: "Test decision",
			category: "workflow",
			context: "Context",
			options: [{ id: "A", description: "Option A", pros: [], cons: [] }],
			decidedBy: "agent-1",
		})
	})

	it("should defer a proposed decision", () => {
		const result = deferDecision(
			planningLog,
			proposedDecision.id,
			{
				reason: "Need more information",
				deferredBy: "lead-agent",
			},
		)

		expect(result).not.toBeNull()
		expect(result?.status).toBe("deferred")
	})

	it("should add revision with reason", () => {
		const result = deferDecision(
			planningLog,
			proposedDecision.id,
			{
				reason: "Waiting for stakeholder input",
				deferredBy: "lead-agent",
			},
		)

		expect(result?.revisions?.[0].reason).toBe("Waiting for stakeholder input")
	})
})
