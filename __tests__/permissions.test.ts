// Society Agent - new file
import { describe, it, expect, beforeEach, vi } from "vitest"
import { PermissionChecker, defaultToolCapabilityMap, getPermissionChecker, resetPermissionChecker } from "../permissions"
import type { AgentIdentity, AgentCapability } from "../types"

// Mock the logger
vi.mock("../logger", () => ({
	getLog: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}))

function makeAgent(capabilities: AgentCapability[], overrides?: Partial<AgentIdentity>): AgentIdentity {
	return {
		id: "test-agent",
		name: "Test Agent",
		role: "worker",
		capabilities,
		createdAt: new Date(),
		...overrides,
	}
}

describe("PermissionChecker", () => {
	let checker: PermissionChecker

	beforeEach(() => {
		checker = new PermissionChecker()
	})

	describe("canAgentUseTool", () => {
		it("allows safe tools with no capabilities required", () => {
			const agent = makeAgent([])
			expect(checker.canAgentUseTool(agent, "ask_followup_question")).toBe(true)
			expect(checker.canAgentUseTool(agent, "attempt_completion")).toBe(true)
			expect(checker.canAgentUseTool(agent, "report_bug")).toBe(true)
		})

		it("allows tool when agent has required capability", () => {
			const agent = makeAgent(["file-read"])
			expect(checker.canAgentUseTool(agent, "read_file")).toBe(true)
			expect(checker.canAgentUseTool(agent, "list_files")).toBe(true)
			expect(checker.canAgentUseTool(agent, "search_files")).toBe(true)
		})

		it("denies tool when agent lacks capability", () => {
			const agent = makeAgent(["file-read"])
			expect(checker.canAgentUseTool(agent, "write_to_file")).toBe(false)
			expect(checker.canAgentUseTool(agent, "execute_command")).toBe(false)
		})

		it("denies unknown tools (fail-safe)", () => {
			const agent = makeAgent(["file-read", "file-write", "shell-execute"])
			expect(checker.canAgentUseTool(agent, "nonexistent_tool")).toBe(false)
		})

		it("requires ALL capabilities for a tool", () => {
			// If a tool required multiple capabilities, agent needs all
			const customChecker = new PermissionChecker({
				multi_tool: ["file-read", "file-write"],
			})
			const readOnly = makeAgent(["file-read"])
			const readWrite = makeAgent(["file-read", "file-write"])
			expect(customChecker.canAgentUseTool(readOnly, "multi_tool")).toBe(false)
			expect(customChecker.canAgentUseTool(readWrite, "multi_tool")).toBe(true)
		})
	})

	describe("getToolsForAgent", () => {
		it("returns only tools agent can use", () => {
			const agent = makeAgent(["file-read"])
			const tools = checker.getToolsForAgent(agent)

			// Should include file-read tools and safe tools
			expect(tools).toContain("read_file")
			expect(tools).toContain("list_files")
			expect(tools).toContain("search_files")
			expect(tools).toContain("ask_followup_question") // safe

			// Should NOT include file-write tools
			expect(tools).not.toContain("write_to_file")
			expect(tools).not.toContain("execute_command")
		})

		it("returns only safe tools for agent with no capabilities", () => {
			const agent = makeAgent([])
			const tools = checker.getToolsForAgent(agent)

			// Safe tools only
			expect(tools).toContain("ask_followup_question")
			expect(tools).toContain("attempt_completion")
			expect(tools).toContain("report_bug")

			// No capability-gated tools
			expect(tools).not.toContain("read_file")
			expect(tools).not.toContain("write_to_file")
		})
	})

	describe("getRequiredCapabilities", () => {
		it("returns capabilities for known tool", () => {
			const caps = checker.getRequiredCapabilities("read_file")
			expect(caps).toEqual(["file-read"])
		})

		it("returns empty for safe tools", () => {
			const caps = checker.getRequiredCapabilities("attempt_completion")
			expect(caps).toEqual([])
		})

		it("returns empty for unknown tools", () => {
			const caps = checker.getRequiredCapabilities("nonexistent")
			expect(caps).toEqual([])
		})
	})

	describe("getMissingCapabilities", () => {
		it("returns missing capabilities", () => {
			const agent = makeAgent(["file-read"])
			const missing = checker.getMissingCapabilities(agent, "write_to_file")
			expect(missing).toEqual(["file-write"])
		})

		it("returns empty when agent has all capabilities", () => {
			const agent = makeAgent(["file-read"])
			const missing = checker.getMissingCapabilities(agent, "read_file")
			expect(missing).toEqual([])
		})
	})

	describe("formatPermissionDeniedMessage", () => {
		it("includes agent name and tool name", () => {
			const agent = makeAgent([], { name: "TestBot", id: "bot-1" })
			const msg = checker.formatPermissionDeniedMessage(agent, "write_to_file")
			expect(msg).toContain("TestBot")
			expect(msg).toContain("bot-1")
			expect(msg).toContain("write_to_file")
		})

		it("lists missing capabilities", () => {
			const agent = makeAgent(["file-read"], { name: "Reader" })
			const msg = checker.formatPermissionDeniedMessage(agent, "write_to_file")
			expect(msg).toContain("file-write")
		})
	})

	describe("addToolMapping", () => {
		it("adds new tool mapping", () => {
			checker.addToolMapping("custom_tool", ["file-read"])
			const agent = makeAgent(["file-read"])
			expect(checker.canAgentUseTool(agent, "custom_tool")).toBe(true)
		})

		it("overrides existing mapping", () => {
			checker.addToolMapping("execute_command", ["file-read"]) // change requirement
			const agent = makeAgent(["file-read"])
			expect(checker.canAgentUseTool(agent, "execute_command")).toBe(true)
		})
	})

	describe("updateCapabilityMap", () => {
		it("merges with existing map", () => {
			checker.updateCapabilityMap({ new_tool: ["shell-execute"] })

			// Old tools still work
			const agent = makeAgent(["file-read", "shell-execute"])
			expect(checker.canAgentUseTool(agent, "read_file")).toBe(true)

			// New tool also works
			expect(checker.canAgentUseTool(agent, "new_tool")).toBe(true)
		})
	})
})

describe("defaultToolCapabilityMap", () => {
	it("maps file operations to correct capabilities via checker", () => {
		const checker = new PermissionChecker()
		expect(checker.getRequiredCapabilities("read_file")).toEqual(["file-read"])
		expect(checker.getRequiredCapabilities("write_to_file")).toEqual(["file-write"])
		expect(checker.getRequiredCapabilities("delete_file")).toEqual(["file-delete"])
	})

	it("maps shell commands to shell-execute", () => {
		expect(defaultToolCapabilityMap["execute_command"]).toEqual(["shell-execute"])
	})

	it("has empty array for safe tools", () => {
		expect(defaultToolCapabilityMap["ask_followup_question"]).toEqual([])
		expect(defaultToolCapabilityMap["attempt_completion"]).toEqual([])
	})
})

describe("getPermissionChecker / resetPermissionChecker", () => {
	beforeEach(() => {
		resetPermissionChecker()
	})

	it("returns singleton instance", () => {
		const a = getPermissionChecker()
		const b = getPermissionChecker()
		expect(a).toBe(b)
	})

	it("reset creates new instance", () => {
		const a = getPermissionChecker()
		resetPermissionChecker()
		const b = getPermissionChecker()
		expect(a).not.toBe(b)
	})
})
