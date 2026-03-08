// Society Agent - Message Contracts Tests
import { describe, it, expect, vi } from "vitest"
import {
	createTaskAssignment,
	createTaskCompletion,
	createBlockedNotification,
	createQuery,
	createHandoffRequest,
	createReviewRequest,
	createEscalation,
	validateMessage,
	isValidMessage,
	formatMessageForDisplay,
	formatMessageAsMarkdown,
	TaskAssignmentMessage,
	QueryMessage,
} from "../src/message-contracts"

// Mock the logger
vi.mock("../src/logger", () => ({
	getLog: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}))

describe("createTaskAssignment", () => {
	it("should create a valid task assignment message", () => {
		const message = createTaskAssignment(
			"lead-agent",
			"backend-specialist",
			"project-1",
			{
				taskId: "TASK-001",
				taskTitle: "Implement user authentication",
				description: "Add JWT-based auth to the API",
				requirements: ["Use bcrypt for passwords", "Token expiry 24h"],
				acceptanceCriteria: ["Login endpoint works", "Tokens are validated"],
			},
		)

		expect(message.category).toBe("task")
		expect(message.type).toBe("assignment")
		expect(message.fromAgentId).toBe("lead-agent")
		expect(message.toAgentId).toBe("backend-specialist")
		expect(message.projectId).toBe("project-1")
		expect(message.priority).toBe("normal")
		expect(message.responseExpected).toBe("required")
		expect(message.taskId).toBe("TASK-001")
		expect(message.payload.taskTitle).toBe("Implement user authentication")
	})

	it("should accept custom priority", () => {
		const message = createTaskAssignment(
			"lead-agent",
			"backend-specialist",
			"project-1",
			{
				taskId: "TASK-002",
				taskTitle: "Critical hotfix",
				description: "Fix production bug",
				requirements: [],
				acceptanceCriteria: [],
			},
			"critical",
		)

		expect(message.priority).toBe("critical")
	})

	it("should include optional fields when provided", () => {
		const message = createTaskAssignment(
			"lead-agent",
			"backend-specialist",
			"project-1",
			{
				taskId: "TASK-003",
				taskTitle: "Task with context",
				description: "Description",
				requirements: [],
				acceptanceCriteria: [],
				deadline: "2025-12-31",
				context: "This relates to feature X",
				relatedFiles: ["src/auth.ts"],
				relatedDecisions: ["D-001"],
			},
		)

		expect(message.payload.deadline).toBe("2025-12-31")
		expect(message.payload.context).toBe("This relates to feature X")
		expect(message.payload.relatedFiles).toContain("src/auth.ts")
	})
})

describe("createTaskCompletion", () => {
	it("should create a task completion message", () => {
		const message = createTaskCompletion("backend-specialist", "lead-agent", "project-1", {
			taskId: "TASK-001",
			summary: "Auth system implemented successfully",
			filesCreated: ["src/auth/login.ts", "src/auth/middleware.ts"],
			filesModified: ["src/routes/index.ts"],
		})

		expect(message.category).toBe("task")
		expect(message.type).toBe("completion")
		expect(message.priority).toBe("normal")
		expect(message.responseExpected).toBe("optional")
		expect(message.payload.summary).toBe("Auth system implemented successfully")
	})

	it("should include optional fields", () => {
		const message = createTaskCompletion("backend-specialist", "lead-agent", "project-1", {
			taskId: "TASK-001",
			summary: "Done",
			filesCreated: [],
			filesModified: [],
			commitHash: "abc123",
			testsPassed: true,
			notes: "Refactored existing code",
		})

		expect(message.payload.commitHash).toBe("abc123")
		expect(message.payload.testsPassed).toBe(true)
		expect(message.payload.notes).toBe("Refactored existing code")
	})
})

describe("createBlockedNotification", () => {
	it("should create a blocked notification with high priority", () => {
		const message = createBlockedNotification("backend-specialist", "lead-agent", "project-1", {
			taskId: "TASK-001",
			blockingReason: {
				type: "dependency",
				description: "Waiting for database schema",
				blockedByTaskId: "TASK-002",
			},
		})

		expect(message.category).toBe("task")
		expect(message.type).toBe("blocked")
		expect(message.priority).toBe("high")
		expect(message.responseExpected).toBe("required")
		expect(message.payload.blockingReason.type).toBe("dependency")
	})

	it("should handle question blockers", () => {
		const message = createBlockedNotification("frontend-specialist", "lead-agent", "project-1", {
			taskId: "TASK-003",
			blockingReason: {
				type: "question",
				description: "Need clarification on design",
				question: "Should the modal auto-close?",
			},
			suggestedResolution: "Ask product owner",
		})

		expect(message.payload.blockingReason.question).toBe("Should the modal auto-close?")
		expect(message.payload.suggestedResolution).toBe("Ask product owner")
	})
})

describe("createQuery", () => {
	it("should create a query with urgency-based priority", () => {
		const blockingQuery = createQuery("agent-1", "agent-2", "project-1", {
			question: "What auth method should I use?",
			urgency: "blocking",
		})

		expect(blockingQuery.priority).toBe("high")
		expect(blockingQuery.responseExpected).toBe("required")

		const soonQuery = createQuery("agent-1", "agent-2", "project-1", {
			question: "When is the deadline?",
			urgency: "soon",
		})

		expect(soonQuery.priority).toBe("normal")

		const lowQuery = createQuery("agent-1", "agent-2", "project-1", {
			question: "Any style preferences?",
			urgency: "when_available",
		})

		expect(lowQuery.priority).toBe("low")
	})

	it("should include related context", () => {
		const message = createQuery(
			"agent-1",
			"agent-2",
			"project-1",
			{
				question: "How should I structure this?",
				urgency: "soon",
				context: "Building a new module",
				relatedTo: {
					files: ["src/module.ts"],
					tasks: ["TASK-001"],
					decisions: ["D-001"],
				},
			},
			"TASK-001",
		)

		expect(message.payload.relatedTo?.files).toContain("src/module.ts")
		expect(message.taskId).toBe("TASK-001")
	})
})

describe("createHandoffRequest", () => {
	it("should create a handoff request with high priority", () => {
		const message = createHandoffRequest("agent-1", "agent-2", "project-1", {
			reason: "Need frontend expertise",
			workSummary: "API endpoints complete",
			filesInvolved: ["src/api/users.ts"],
			currentState: "Backend ready, needs UI",
			acceptanceCriteria: ["User can login via UI"],
		})

		expect(message.category).toBe("handoff")
		expect(message.type).toBe("request")
		expect(message.priority).toBe("high")
		expect(message.responseExpected).toBe("required")
	})
})

describe("createReviewRequest", () => {
	it("should create a review request", () => {
		const message = createReviewRequest("backend-specialist", "lead-agent", "project-1", {
			taskId: "TASK-001",
			workType: "code",
			filesToReview: ["src/auth.ts", "src/middleware.ts"],
			focusAreas: ["Security", "Error handling"],
		})

		expect(message.category).toBe("review")
		expect(message.type).toBe("request")
		expect(message.priority).toBe("normal")
		expect(message.payload.workType).toBe("code")
		expect(message.payload.focusAreas).toContain("Security")
	})
})

describe("createEscalation", () => {
	it("should set priority based on urgency", () => {
		const immediate = createEscalation("agent-1", "supervisor", "project-1", {
			taskId: "TASK-001",
			type: "blocker",
			urgency: "immediate",
			description: "Production is down",
		})

		expect(immediate.priority).toBe("critical")

		const soon = createEscalation("agent-1", "supervisor", "project-1", {
			taskId: "TASK-002",
			type: "resource",
			urgency: "soon",
			description: "Need more capacity",
		})

		expect(soon.priority).toBe("high")

		const normal = createEscalation("agent-1", "supervisor", "project-1", {
			taskId: "TASK-003",
			type: "clarification",
			urgency: "normal",
			description: "Unclear requirements",
		})

		expect(normal.priority).toBe("normal")
	})
})

describe("validateMessage", () => {
	it("should return empty array for valid message", () => {
		const message = createTaskAssignment("agent-1", "agent-2", "project-1", {
			taskId: "TASK-001",
			taskTitle: "Test",
			description: "Description",
			requirements: [],
			acceptanceCriteria: [],
		})

		const errors = validateMessage(message)
		expect(errors).toHaveLength(0)
	})

	it("should return errors for missing required fields", () => {
		const errors = validateMessage({})

		expect(errors.length).toBeGreaterThan(0)
		expect(errors.some((e) => e.field === "messageId")).toBe(true)
		expect(errors.some((e) => e.field === "category")).toBe(true)
		expect(errors.some((e) => e.field === "fromAgentId")).toBe(true)
		expect(errors.some((e) => e.field === "toAgentId")).toBe(true)
		expect(errors.some((e) => e.field === "projectId")).toBe(true)
	})

	it("should validate task category requires taskId in payload", () => {
		const message = {
			messageId: "MSG-001",
			category: "task" as const,
			fromAgentId: "agent-1",
			toAgentId: "agent-2",
			projectId: "project-1",
			priority: "normal" as const,
			timestamp: new Date().toISOString(),
			responseExpected: "required" as const,
			type: "assignment",
			payload: {
				taskId: "", // Empty
				taskTitle: "Test",
				description: "Test",
				requirements: [],
				acceptanceCriteria: [],
			},
		}

		const errors = validateMessage(message)
		expect(errors.some((e) => e.field === "payload.taskId")).toBe(true)
	})

	it("should validate query category requires question", () => {
		const message = {
			messageId: "MSG-001",
			category: "query" as const,
			fromAgentId: "agent-1",
			toAgentId: "agent-2",
			projectId: "project-1",
			priority: "normal" as const,
			timestamp: new Date().toISOString(),
			responseExpected: "required" as const,
			type: "information_request",
			payload: {
				question: "", // Empty
				urgency: "soon" as const,
			},
		}

		const errors = validateMessage(message)
		expect(errors.some((e) => e.field === "payload.question")).toBe(true)
	})
})

describe("isValidMessage", () => {
	it("should return true for valid message", () => {
		const message = createTaskAssignment("agent-1", "agent-2", "project-1", {
			taskId: "TASK-001",
			taskTitle: "Test",
			description: "Description",
			requirements: [],
			acceptanceCriteria: [],
		})

		expect(isValidMessage(message)).toBe(true)
	})

	it("should return false for invalid message", () => {
		expect(isValidMessage({})).toBe(false)
	})
})

describe("formatMessageForDisplay", () => {
	it("should format message with key information", () => {
		const message = createTaskAssignment("lead-agent", "backend-specialist", "project-1", {
			taskId: "TASK-001",
			taskTitle: "Test task",
			description: "Description",
			requirements: ["Req 1", "Req 2"],
			acceptanceCriteria: [],
		})

		const formatted = formatMessageForDisplay(message)

		expect(formatted).toContain("[TASK]")
		expect(formatted).toContain("lead-agent")
		expect(formatted).toContain("backend-specialist")
		expect(formatted).toContain("TASK-001")
	})
})

describe("formatMessageAsMarkdown", () => {
	it("should format message as markdown", () => {
		const message = createTaskAssignment("lead-agent", "backend-specialist", "project-1", {
			taskId: "TASK-001",
			taskTitle: "Test task",
			description: "Description",
			requirements: [],
			acceptanceCriteria: [],
		})

		const markdown = formatMessageAsMarkdown(message)

		expect(markdown).toContain("## ")
		expect(markdown).toContain("**ID:**")
		expect(markdown).toContain("**From:**")
		expect(markdown).toContain("**To:**")
	})

	it("should use correct priority emoji", () => {
		const critical = createTaskAssignment(
			"a",
			"b",
			"p",
			{
				taskId: "T",
				taskTitle: "T",
				description: "D",
				requirements: [],
				acceptanceCriteria: [],
			},
			"critical",
		)

		const normal = createTaskAssignment("a", "b", "p", {
			taskId: "T",
			taskTitle: "T",
			description: "D",
			requirements: [],
			acceptanceCriteria: [],
		})

		expect(formatMessageAsMarkdown(critical)).toContain("🔴")
		expect(formatMessageAsMarkdown(normal)).toContain("🟢")
	})
})
