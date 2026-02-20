// Society Agent - new file
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import { MessageSecurity } from "../message-security"

// Mock the logger
vi.mock("../logger", () => ({
	getLog: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}))

describe("MessageSecurity", () => {
	let tmpDir: string
	let security: MessageSecurity

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "msg-sec-test-"))
		security = new MessageSecurity(tmpDir)
	})

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	describe("initialize", () => {
		it("creates keys directory", async () => {
			await security.initialize()
			const keysDir = path.join(tmpDir, ".society-agent", "keys")
			const stat = await fs.stat(keysDir)
			expect(stat.isDirectory()).toBe(true)
		})

		it("is idempotent", async () => {
			await security.initialize()
			await security.initialize() // should not throw
			const keysDir = path.join(tmpDir, ".society-agent", "keys")
			const stat = await fs.stat(keysDir)
			expect(stat.isDirectory()).toBe(true)
		})
	})

	describe("getAgentSecret", () => {
		it("generates a new secret for unknown agent", async () => {
			await security.initialize()
			const secret = await security.getAgentSecret("agent-1")
			expect(secret).toBeDefined()
			expect(typeof secret).toBe("string")
			expect(secret.length).toBeGreaterThan(0)
		})

		it("returns same secret on repeated calls", async () => {
			await security.initialize()
			const secret1 = await security.getAgentSecret("agent-1")
			const secret2 = await security.getAgentSecret("agent-1")
			expect(secret1).toBe(secret2)
		})

		it("generates different secrets for different agents", async () => {
			await security.initialize()
			const secret1 = await security.getAgentSecret("agent-1")
			const secret2 = await security.getAgentSecret("agent-2")
			expect(secret1).not.toBe(secret2)
		})

		it("persists secret to filesystem", async () => {
			await security.initialize()
			const secret = await security.getAgentSecret("agent-1")
			const keyPath = path.join(tmpDir, ".society-agent", "keys", "agent-1.key")
			const stored = await fs.readFile(keyPath, "utf8")
			expect(stored).toBe(secret)
		})
	})

	describe("signMessage", () => {
		it("returns a hex string signature", async () => {
			await security.initialize()
			const message = { type: "test", content: "hello" }
			const signature = await security.signMessage(message, "agent-1")
			expect(typeof signature).toBe("string")
			expect(signature.length).toBeGreaterThan(0)
			// HMAC-SHA256 hex = 64 chars
			expect(signature).toMatch(/^[0-9a-f]{64}$/)
		})

		it("produces different signatures for different messages", async () => {
			await security.initialize()
			const sig1 = await security.signMessage({ content: "hello" }, "agent-1")
			const sig2 = await security.signMessage({ content: "world" }, "agent-1")
			expect(sig1).not.toBe(sig2)
		})

		it("produces different signatures for different agents", async () => {
			await security.initialize()
			const message = { content: "same" }
			const sig1 = await security.signMessage(message, "agent-1")
			const sig2 = await security.signMessage(message, "agent-2")
			expect(sig1).not.toBe(sig2)
		})

		it("produces deterministic signature for same input", async () => {
			await security.initialize()
			const message = { content: "hello" }
			const sig1 = await security.signMessage(message, "agent-1")
			const sig2 = await security.signMessage(message, "agent-1")
			expect(sig1).toBe(sig2)
		})

		it("ignores existing signature field in message", async () => {
			await security.initialize()
			const msg1 = { content: "hello" }
			const msg2 = { content: "hello", signature: "old-sig" }
			const sig1 = await security.signMessage(msg1, "agent-1")
			const sig2 = await security.signMessage(msg2, "agent-1")
			expect(sig1).toBe(sig2)
		})
	})

	describe("verifyMessage", () => {
		it("verifies a correctly signed message", async () => {
			await security.initialize()
			const message: any = { type: "test", content: "hello" }
			message.signature = await security.signMessage(message, "agent-1")
			const isValid = await security.verifyMessage(message, "agent-1")
			expect(isValid).toBe(true)
		})

		it("rejects tampered message content", async () => {
			await security.initialize()
			const message: any = { content: "original" }
			message.signature = await security.signMessage(message, "agent-1")
			message.content = "tampered"
			const isValid = await security.verifyMessage(message, "agent-1")
			expect(isValid).toBe(false)
		})

		it("rejects wrong sender id", async () => {
			await security.initialize()
			const message: any = { content: "hello" }
			message.signature = await security.signMessage(message, "agent-1")
			// verify with different agent's key
			const isValid = await security.verifyMessage(message, "agent-2")
			expect(isValid).toBe(false)
		})

		it("rejects modified signature", async () => {
			await security.initialize()
			const message: any = { content: "hello" }
			message.signature = await security.signMessage(message, "agent-1")
			message.signature = "0".repeat(64) // valid hex, wrong value
			const isValid = await security.verifyMessage(message, "agent-1")
			expect(isValid).toBe(false)
		})

		it("rejects message without signature", async () => {
			await security.initialize()
			const message = { content: "hello" }
			const isValid = await security.verifyMessage(message, "agent-1")
			expect(isValid).toBe(false)
		})
	})

	describe("isAgentRegistered", () => {
		it("returns false for unknown agent", async () => {
			await security.initialize()
			const registered = await security.isAgentRegistered("unknown")
			expect(registered).toBe(false)
		})

		it("returns true after secret generation", async () => {
			await security.initialize()
			await security.getAgentSecret("agent-1")
			const registered = await security.isAgentRegistered("agent-1")
			expect(registered).toBe(true)
		})
	})

	describe("listAgents", () => {
		it("returns empty array initially", async () => {
			await security.initialize()
			const agents = await security.listAgents()
			expect(agents).toEqual([])
		})

		it("returns agents after registration", async () => {
			await security.initialize()
			await security.getAgentSecret("agent-1")
			await security.getAgentSecret("agent-2")
			const agents = await security.listAgents()
			expect(agents).toHaveLength(2)
			expect(agents).toContain("agent-1")
			expect(agents).toContain("agent-2")
		})
	})
})
