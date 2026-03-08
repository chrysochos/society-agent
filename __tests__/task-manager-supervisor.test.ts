// Society Agent - Task Manager Supervisor Override Tests
import { describe, it, expect, vi } from "vitest"
import {
	createTask,
	transitionTask,
	blockTask,
	delegateTask,
	acceptTask,
	supervisorForceUnblock,
	supervisorForceReassign,
	supervisorForceStatus,
	supervisorForceCancel,
	supervisorChangePriority,
	formatOverrideLogEntry,
	ManagedTask,
	SupervisorOverride,
} from "../src/task-manager"

// Mock the logger
vi.mock("../src/logger", () => ({
	getLog: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}))

function createBlockedTask(): ManagedTask {
	let task = createTask("TEST", 1, {
		title: "Test task",
		description: "A test task",
		createdBy: "lead-agent",
	})
	task = delegateTask(task, "backend-specialist", "lead-agent")
	task = acceptTask(task, "backend-specialist")
	task = blockTask(task, "backend-specialist", {
		type: "dependency",
		description: "Waiting for API spec",
		since: new Date().toISOString(),
	})
	return task
}

function createInProgressTask(): ManagedTask {
	let task = createTask("TEST", 1, {
		title: "Test task",
		description: "A test task",
		createdBy: "lead-agent",
	})
	task = delegateTask(task, "backend-specialist", "lead-agent")
	task = acceptTask(task, "backend-specialist")
	return task
}

describe("supervisorForceUnblock", () => {
	it("should unblock a blocked task", () => {
		const blockedTask = createBlockedTask()

		const { task, override } = supervisorForceUnblock(
			blockedTask,
			"supervisor-agent",
			"Need to proceed with deadline",
			"API spec will be provided later",
		)

		expect(task.status).toBe("in_progress")
		expect(task.blockingReason).toBeUndefined()
		expect(override.type).toBe("force_unblock")
		expect(override.supervisorId).toBe("supervisor-agent")
	})

	it("should record previous state in override", () => {
		const blockedTask = createBlockedTask()

		const { override } = supervisorForceUnblock(
			blockedTask,
			"supervisor-agent",
			"Reason",
			"Resolution",
		)

		expect(override.previousState.status).toBe("blocked")
		expect(override.previousState.blockingReason).toBeDefined()
		expect(override.newState.status).toBe("in_progress")
	})

	it("should add status history entry with supervisor tag", () => {
		const blockedTask = createBlockedTask()

		const { task } = supervisorForceUnblock(
			blockedTask,
			"supervisor-agent",
			"Override reason",
			"Resolution provided",
		)

		const lastTransition = task.statusHistory[task.statusHistory.length - 1]
		expect(lastTransition.reason).toContain("[SUPERVISOR OVERRIDE]")
		expect(lastTransition.triggeredBy).toBe("supervisor-agent")
	})

	it("should throw error if task is not blocked", () => {
		const inProgressTask = createInProgressTask()

		expect(() => {
			supervisorForceUnblock(inProgressTask, "supervisor-agent", "Reason", "Resolution")
		}).toThrow("not blocked")
	})
})

describe("supervisorForceReassign", () => {
	it("should reassign task to different agent", () => {
		const task = createInProgressTask()

		const { task: reassigned, override } = supervisorForceReassign(
			task,
			"supervisor-agent",
			"frontend-specialist",
			"Skill mismatch, frontend work needed",
		)

		expect(reassigned.assignedTo).toBe("frontend-specialist")
		expect(reassigned.status).toBe("delegated")
		expect(override.type).toBe("force_reassign")
	})

	it("should clear blocking reason on reassign", () => {
		const blockedTask = createBlockedTask()

		const { task } = supervisorForceReassign(
			blockedTask,
			"supervisor-agent",
			"another-agent",
			"Reassigning to unblock",
		)

		expect(task.blockingReason).toBeUndefined()
	})

	it("should record reassignment details in override", () => {
		const task = createInProgressTask()

		const { override } = supervisorForceReassign(
			task,
			"supervisor-agent",
			"new-agent",
			"Workload balancing",
		)

		expect(override.previousState.assignedTo).toBe("backend-specialist")
		expect(override.newState.assignedTo).toBe("new-agent")
	})

	it("should not allow reassign from terminal states", () => {
		let task = createInProgressTask()
		// Move to done/verified would require proper transitions
		// Instead, create a cancelled task
		task = { ...task, status: "cancelled" }

		expect(() => {
			supervisorForceReassign(task, "supervisor-agent", "new-agent", "Reason")
		}).toThrow("Cannot reassign")
	})
})

describe("supervisorForceStatus", () => {
	it("should force task to any status", () => {
		const task = createInProgressTask()

		const { task: updated, override } = supervisorForceStatus(
			task,
			"supervisor-agent",
			"done",
			"Accepting as-is due to time constraints",
		)

		expect(updated.status).toBe("done")
		expect(override.type).toBe("force_status")
	})

	it("should update timestamps based on new status", () => {
		let task = createTask("TEST", 1, {
			title: "Test",
			description: "Test",
			createdBy: "agent",
		})

		// Force to in_progress should set startedAt
		const { task: inProgress } = supervisorForceStatus(
			task,
			"supervisor-agent",
			"in_progress",
			"Fast-tracking",
		)
		expect(inProgress.startedAt).toBeDefined()

		// Force to done should set completedAt
		const { task: done } = supervisorForceStatus(
			inProgress,
			"supervisor-agent",
			"done",
			"Accepting",
		)
		expect(done.completedAt).toBeDefined()
	})

	it("should clear blocking reason when moving out of blocked", () => {
		const blockedTask = createBlockedTask()

		const { task } = supervisorForceStatus(
			blockedTask,
			"supervisor-agent",
			"done",
			"Force completing blocked task",
		)

		expect(task.blockingReason).toBeUndefined()
	})

	it("should record status change in override", () => {
		const task = createInProgressTask()

		const { override } = supervisorForceStatus(task, "supervisor-agent", "review", "Reason")

		expect(override.previousState.status).toBe("in_progress")
		expect(override.newState.status).toBe("review")
	})
})

describe("supervisorForceCancel", () => {
	it("should cancel an active task", () => {
		const task = createInProgressTask()

		const { task: cancelled, override } = supervisorForceCancel(
			task,
			"supervisor-agent",
			"Requirements changed, task no longer needed",
		)

		expect(cancelled.status).toBe("cancelled")
		expect(override.type).toBe("force_cancel")
	})

	it("should cancel a blocked task", () => {
		const blockedTask = createBlockedTask()

		const { task } = supervisorForceCancel(
			blockedTask,
			"supervisor-agent",
			"Abandoning due to persistent blockers",
		)

		expect(task.status).toBe("cancelled")
		expect(task.blockingReason).toBeUndefined()
	})

	it("should not allow cancelling verified tasks", () => {
		const task = { ...createInProgressTask(), status: "verified" as const }

		expect(() => {
			supervisorForceCancel(task, "supervisor-agent", "Reason")
		}).toThrow("Cannot cancel")
	})

	it("should not allow cancelling already cancelled tasks", () => {
		const task = { ...createInProgressTask(), status: "cancelled" as const }

		expect(() => {
			supervisorForceCancel(task, "supervisor-agent", "Reason")
		}).toThrow("Cannot cancel")
	})
})

describe("supervisorChangePriority", () => {
	it("should change task priority", () => {
		const task = createInProgressTask()
		expect(task.priority).toBe(3) // Default priority

		const { task: updated, override } = supervisorChangePriority(
			task,
			"supervisor-agent",
			1,
			"Customer escalation, making critical",
		)

		expect(updated.priority).toBe(1)
		expect(override.type).toBe("priority_change")
	})

	it("should record priority change in override", () => {
		const task = { ...createInProgressTask(), priority: 3 as const }

		const { override } = supervisorChangePriority(task, "supervisor-agent", 5, "Deprioritizing")

		expect(override.previousState.priority).toBe(3)
		expect(override.newState.priority).toBe(5)
	})

	it("should not change task status", () => {
		const task = createInProgressTask()

		const { task: updated } = supervisorChangePriority(
			task,
			"supervisor-agent",
			2,
			"Increasing priority",
		)

		expect(updated.status).toBe("in_progress")
	})

	it("should add history entry for priority change", () => {
		const task = createInProgressTask()

		const { task: updated } = supervisorChangePriority(
			task,
			"supervisor-agent",
			1,
			"Urgent now",
		)

		const lastTransition = updated.statusHistory[updated.statusHistory.length - 1]
		expect(lastTransition.reason).toContain("Priority changed")
		expect(lastTransition.reason).toContain("[SUPERVISOR OVERRIDE]")
	})
})

describe("Override ID Generation", () => {
	it("should generate unique override IDs", () => {
		const task = createBlockedTask()

		const { override: override1 } = supervisorForceUnblock(task, "sup", "r", "res")
		const { override: override2 } = supervisorForceUnblock(task, "sup", "r", "res")

		expect(override1.overrideId).not.toBe(override2.overrideId)
		expect(override1.overrideId).toMatch(/^OVR-/)
	})
})

describe("formatOverrideLogEntry", () => {
	it("should format override as markdown", () => {
		const blockedTask = createBlockedTask()
		const { override } = supervisorForceUnblock(
			blockedTask,
			"supervisor-agent",
			"Deadline approaching",
			"Proceeding without spec",
		)

		const formatted = formatOverrideLogEntry(override)

		expect(formatted).toContain("### ")
		expect(formatted).toContain("force_unblock")
		expect(formatted).toContain("T-TEST-001")
		expect(formatted).toContain("**Supervisor**: supervisor-agent")
		expect(formatted).toContain("**Reason**: Deadline approaching")
		expect(formatted).toContain("**Before:**")
		expect(formatted).toContain("**After:**")
	})

	it("should include all state changes", () => {
		const task = createInProgressTask()
		const { override } = supervisorForceReassign(
			task,
			"supervisor-agent",
			"new-agent",
			"Workload",
		)

		const formatted = formatOverrideLogEntry(override)

		expect(formatted).toContain("Assigned to: backend-specialist")
		expect(formatted).toContain("Assigned to: new-agent")
	})

	it("should format priority changes", () => {
		const task = createInProgressTask()
		const { override } = supervisorChangePriority(task, "supervisor-agent", 1, "Critical")

		const formatted = formatOverrideLogEntry(override)

		expect(formatted).toContain("priority_change")
		expect(formatted).toContain("Priority:")
	})
})

describe("Override Integration with Task State", () => {
	it("should maintain consistent task history", () => {
		let task = createTask("TEST", 1, {
			title: "Test",
			description: "Test",
			createdBy: "lead",
		})

		// Normal flow
		task = delegateTask(task, "agent-1", "lead")
		task = acceptTask(task, "agent-1")
		task = blockTask(task, "agent-1", {
			type: "question",
			description: "Need clarification",
			since: new Date().toISOString(),
		})

		// Supervisor intervention
		const { task: unblocked } = supervisorForceUnblock(
			task,
			"supervisor",
			"Answering question",
			"Use option A",
		)

		// Verify complete history
		expect(unblocked.statusHistory.length).toBeGreaterThan(3)
		const statuses = unblocked.statusHistory.map((h) => h.to)
		expect(statuses).toContain("planned")
		expect(statuses).toContain("delegated")
		expect(statuses).toContain("in_progress")
		expect(statuses).toContain("blocked")
		expect(statuses[statuses.length - 1]).toBe("in_progress")
	})

	it("should allow normal operations after override", () => {
		const blockedTask = createBlockedTask()

		// Supervisor unblocks
		const { task: unblocked } = supervisorForceUnblock(
			blockedTask,
			"supervisor",
			"Unblocking",
			"Resolution",
		)

		// Should be able to continue normal transitions
		// This simulates completing the task after unblock
		expect(unblocked.status).toBe("in_progress")
		// In a real scenario, agent would call transitionTask or completion functions
	})
})
