// kilocode_change - new file
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { ExecutionLogger } from "../execution-logger"
import type { LogEntry } from "../execution-logger"

// Mock the logger
vi.mock("../logger", () => ({
	getLog: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}))

describe("ExecutionLogger", () => {
	let tmpDir: string
	let logger: ExecutionLogger

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "exec-log-test-"))
		logger = new ExecutionLogger({ workspaceRoot: tmpDir, enableConsole: false })
	})

	afterEach(() => {
		logger.dispose()
		fs.rmSync(tmpDir, { recursive: true, force: true })
	})

	describe("constructor", () => {
		it("creates log directory", () => {
			const logDir = path.join(tmpDir, ".society-agent", "logs")
			expect(fs.existsSync(logDir)).toBe(true)
		})
	})

	describe("info/warn/error/debug", () => {
		it("logs info entries", () => {
			logger.info("purpose-1", "test_event", { key: "value" })
			const logs = logger.readLogs("purpose-1")
			expect(logs).toHaveLength(1)
			expect(logs[0].level).toBe("info")
			expect(logs[0].event).toBe("test_event")
			expect(logs[0].data).toEqual({ key: "value" })
		})

		it("logs warn entries", () => {
			logger.warn("purpose-1", "warning_event")
			const logs = logger.readLogs("purpose-1")
			expect(logs).toHaveLength(1)
			expect(logs[0].level).toBe("warn")
		})

		it("logs error entries", () => {
			logger.error("purpose-1", "error_event")
			const logs = logger.readLogs("purpose-1")
			expect(logs).toHaveLength(1)
			expect(logs[0].level).toBe("error")
		})

		it("logs debug entries", () => {
			logger.debug("purpose-1", "debug_event")
			const logs = logger.readLogs("purpose-1")
			expect(logs).toHaveLength(1)
			expect(logs[0].level).toBe("debug")
		})

		it("includes agentId when provided", () => {
			logger.info("purpose-1", "test_event", undefined, "agent-1")
			const logs = logger.readLogs("purpose-1")
			expect(logs[0].agentId).toBe("agent-1")
		})

		it("logs have numeric timestamp", () => {
			logger.info("purpose-1", "test_event")
			const logs = logger.readLogs("purpose-1")
			expect(typeof logs[0].timestamp).toBe("number")
			expect(logs[0].timestamp).toBeGreaterThan(0)
		})
	})

	describe("logAgentMessage", () => {
		it("logs agent messages", () => {
			logger.logAgentMessage("purpose-1", "agent-1", "agent-2", "hello")
			const logs = logger.readLogs("purpose-1")
			expect(logs).toHaveLength(1)
			expect(logs[0].event).toBe("agent_message")
			expect(logs[0].data).toEqual({
				fromAgent: "agent-1",
				toAgent: "agent-2",
				message: "hello",
			})
		})
	})

	describe("logAgentStatus", () => {
		it("logs agent status changes", () => {
			logger.logAgentStatus("purpose-1", "agent-1", "working", "implement auth")
			const logs = logger.readLogs("purpose-1")
			expect(logs).toHaveLength(1)
			expect(logs[0].event).toBe("agent_status")
			expect(logs[0].data).toEqual({
				agentId: "agent-1",
				status: "working",
				task: "implement auth",
			})
		})
	})

	describe("logAgentResult", () => {
		it("logs success as info", () => {
			logger.logAgentResult("purpose-1", "agent-1", "completed", true)
			const logs = logger.readLogs("purpose-1")
			expect(logs[0].level).toBe("info")
			expect(logs[0].event).toBe("agent_result")
			expect(logs[0].data?.success).toBe(true)
		})

		it("logs failure as error", () => {
			logger.logAgentResult("purpose-1", "agent-1", "failed", false)
			const logs = logger.readLogs("purpose-1")
			expect(logs[0].level).toBe("error")
			expect(logs[0].data?.success).toBe(false)
		})
	})

	describe("readLogs", () => {
		it("returns empty array for nonexistent purpose", () => {
			const logs = logger.readLogs("nonexistent")
			expect(logs).toEqual([])
		})

		it("returns multiple entries in order", () => {
			logger.info("purpose-1", "event-1")
			logger.info("purpose-1", "event-2")
			logger.info("purpose-1", "event-3")
			const logs = logger.readLogs("purpose-1")
			expect(logs).toHaveLength(3)
			expect(logs[0].event).toBe("event-1")
			expect(logs[1].event).toBe("event-2")
			expect(logs[2].event).toBe("event-3")
		})

		it("separates logs per purpose", () => {
			logger.info("purpose-1", "event-a")
			logger.info("purpose-2", "event-b")
			expect(logger.readLogs("purpose-1")).toHaveLength(1)
			expect(logger.readLogs("purpose-2")).toHaveLength(1)
		})
	})

	describe("queryLogs", () => {
		beforeEach(() => {
			logger.info("purpose-1", "start", undefined, "agent-1")
			logger.warn("purpose-1", "slow_response", undefined, "agent-2")
			logger.error("purpose-1", "crash", { code: 1 }, "agent-1")
			logger.info("purpose-1", "finish", undefined, "agent-2")
		})

		it("returns all logs when no filter", () => {
			const logs = logger.queryLogs("purpose-1")
			expect(logs).toHaveLength(4)
		})

		it("filters by agentId", () => {
			const logs = logger.queryLogs("purpose-1", { agentId: "agent-1" })
			expect(logs).toHaveLength(2)
			expect(logs.every((l) => l.agentId === "agent-1")).toBe(true)
		})

		it("filters by level", () => {
			const logs = logger.queryLogs("purpose-1", { level: "error" })
			expect(logs).toHaveLength(1)
			expect(logs[0].event).toBe("crash")
		})

		it("filters by event substring", () => {
			const logs = logger.queryLogs("purpose-1", { event: "finish" })
			expect(logs).toHaveLength(1)
		})

		it("filters by timestamp (since)", () => {
			// All entries have close timestamps, but we can test the mechanism
			const logs = logger.queryLogs("purpose-1", { since: 0 })
			expect(logs).toHaveLength(4)

			const futureLogs = logger.queryLogs("purpose-1", { since: Date.now() + 100000 })
			expect(futureLogs).toHaveLength(0)
		})
	})

	describe("listLogFiles", () => {
		it("returns empty for fresh logger", () => {
			const files = logger.listLogFiles()
			expect(files).toEqual([])
		})

		it("returns log files after writing", () => {
			logger.info("purpose-1", "test")
			logger.info("purpose-2", "test")
			const files = logger.listLogFiles()
			expect(files).toHaveLength(2)
			expect(files).toContain("purpose-1.jsonl")
			expect(files).toContain("purpose-2.jsonl")
		})
	})

	describe("deleteLogs", () => {
		it("deletes logs for a specific purpose", () => {
			logger.info("purpose-1", "test")
			logger.info("purpose-2", "test")
			logger.deleteLogs("purpose-1")
			expect(logger.readLogs("purpose-1")).toEqual([])
			expect(logger.readLogs("purpose-2")).toHaveLength(1)
		})

		it("is safe to call for nonexistent purpose", () => {
			expect(() => logger.deleteLogs("nonexistent")).not.toThrow()
		})
	})

	describe("clearAllLogs", () => {
		it("removes all log files", () => {
			logger.info("purpose-1", "test")
			logger.info("purpose-2", "test")
			logger.clearAllLogs()
			expect(logger.listLogFiles()).toEqual([])
		})
	})
})
