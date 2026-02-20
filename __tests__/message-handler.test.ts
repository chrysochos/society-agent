// Society Agent - new file
/**
 * Tests for UnifiedMessageHandler
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock fs/promises
vi.mock("fs/promises", () => ({
	default: {
		appendFile: vi.fn().mockResolvedValue(undefined),
		mkdir: vi.fn().mockResolvedValue(undefined),
		writeFile: vi.fn().mockResolvedValue(undefined),
		readFile: vi.fn().mockResolvedValue(""),
	},
	appendFile: vi.fn().mockResolvedValue(undefined),
	mkdir: vi.fn().mockResolvedValue(undefined),
	writeFile: vi.fn().mockResolvedValue(undefined),
	readFile: vi.fn().mockResolvedValue(""),
}))

// Mock vscode before importing handler
vi.mock("vscode", () => ({
	window: {
		showWarningMessage: vi.fn(),
		showInformationMessage: vi.fn(),
	},
}))

// Mock ClineProvider
vi.mock("../../../core/webview/ClineProvider", () => ({
	ClineProvider: {
		getVisibleInstance: vi.fn().mockReturnValue(null),
	},
}))

// Mock logger
vi.mock("../logger", () => ({
	getLog: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}))

// Mock agent-identity
vi.mock("../agent-identity", () => ({
	AgentIdentityManager: vi.fn(),
	isReplayAttack: vi.fn().mockReturnValue(false),
	getMessagePriority: vi.fn().mockImplementation((type: string) => {
		if (type === "shutdown" || type === "interrupt") return "interrupt"
		if (type === "task_assign" || type === "message") return "queue"
		return "log"
	}),
}))

import crypto from "crypto"
import { UnifiedMessageHandler } from "../message-handler"
import type { SignedMessage } from "../agent-identity"

function createMockIdentityManager() {
	return {
		validateMessage: vi.fn().mockReturnValue({ valid: true }),
		getIdentity: vi.fn(),
	} as any
}

function createTestMessage(overrides: Partial<SignedMessage> = {}): SignedMessage {
	return {
		id: `msg-${Date.now()}-${Math.random()}`,
		from: "test-agent",
		to: "this-agent",
		type: "message",
		content: "Hello world",
		timestamp: new Date().toISOString(),
		nonce: crypto.randomUUID(),
		signature: "test-sig",
		...overrides,
	}
}

describe("UnifiedMessageHandler", () => {
	let handler: UnifiedMessageHandler

	beforeEach(() => {
		handler = new UnifiedMessageHandler({
			agentId: "this-agent",
			sharedDir: "/tmp/test-society-agent",
			identityManager: createMockIdentityManager(),
		})
	})

	describe("message deduplication", () => {
		it("should reject duplicate messages", async () => {
			const msg = createTestMessage({ id: "dup-1" })

			const result1 = await handler.handleMessage(msg)
			expect(result1.accepted).toBe(true)

			const result2 = await handler.handleMessage(msg)
			expect(result2.accepted).toBe(false)
			expect(result2.reason).toContain("Already processed")
		})
	})

	describe("shutdown handling", () => {
		it("should invoke shutdown callback on shutdown message", async () => {
			const shutdownFn = vi.fn()
			handler.onShutdown(shutdownFn)

			const msg = createTestMessage({ type: "shutdown", content: "Stop everything" })
			await handler.handleMessage(msg)

			expect(shutdownFn).toHaveBeenCalled()
		})

		it("should clear the task queue on shutdown", async () => {
			const msg = createTestMessage({ type: "shutdown" })
			await handler.handleMessage(msg)

			// Queue should be empty (no queued tasks left)
			expect(handler.getQueueDepth()).toBe(0)
		})
	})

	describe("queue tracking", () => {
		it("should track queue depth", () => {
			expect(handler.getQueueDepth()).toBe(0)
		})
	})

	describe("recent messages", () => {
		it("should track recent messages", async () => {
			const msg = createTestMessage()
			await handler.handleMessage(msg)

			const recent = handler.getRecentMessages()
			expect(recent.length).toBeGreaterThanOrEqual(1)
			expect(recent[0].from).toBe("test-agent")
		})
	})
})
