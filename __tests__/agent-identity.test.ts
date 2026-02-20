// Society Agent - new file
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import {
	AgentIdentityManager,
	getMessagePriority,
	isReplayAttack,
	type SignedMessage,
} from "../agent-identity"

// Mock the logger
vi.mock("../logger", () => ({
	getLog: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}))

describe("getMessagePriority", () => {
	it("should return 'interrupt' for shutdown", () => {
		expect(getMessagePriority("shutdown")).toBe("interrupt")
	})

	it("should return 'interrupt' for question", () => {
		expect(getMessagePriority("question")).toBe("interrupt")
	})

	it("should return 'interrupt' for message", () => {
		expect(getMessagePriority("message")).toBe("interrupt")
	})

	it("should return 'queue' for task_assign", () => {
		expect(getMessagePriority("task_assign")).toBe("queue")
	})

	it("should return 'queue' for review_request", () => {
		expect(getMessagePriority("review_request")).toBe("queue")
	})

	it("should return 'log' for task_complete", () => {
		expect(getMessagePriority("task_complete")).toBe("log")
	})

	it("should return 'log' for status_update", () => {
		expect(getMessagePriority("status_update")).toBe("log")
	})
})

describe("isReplayAttack", () => {
	it("should reject messages older than 5 minutes", () => {
		const old = new Date(Date.now() - 6 * 60 * 1000).toISOString()
		const msg: SignedMessage = {
			id: "test-1",
			from: "a",
			to: "b",
			timestamp: old,
			nonce: "unique-nonce-old",
			type: "message",
			content: "hi",
			signature: "sig",
		}
		expect(isReplayAttack(msg)).toBe(true)
	})

	it("should accept fresh messages", () => {
		const msg: SignedMessage = {
			id: "test-2",
			from: "a",
			to: "b",
			timestamp: new Date().toISOString(),
			nonce: `fresh-nonce-${Date.now()}-${Math.random()}`,
			type: "message",
			content: "hi",
			signature: "sig",
		}
		expect(isReplayAttack(msg)).toBe(false)
	})

	it("should reject replayed nonces", () => {
		const nonce = `replay-nonce-${Date.now()}-${Math.random()}`
		const msg: SignedMessage = {
			id: "test-3",
			from: "a",
			to: "b",
			timestamp: new Date().toISOString(),
			nonce,
			type: "message",
			content: "hi",
			signature: "sig",
		}
		// First time: accept
		expect(isReplayAttack(msg)).toBe(false)
		// Second time: reject (same nonce)
		expect(isReplayAttack(msg)).toBe(true)
	})
})

describe("AgentIdentityManager", () => {
	let tmpDir: string
	let manager: AgentIdentityManager

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sa-identity-test-"))
		manager = new AgentIdentityManager(tmpDir)
	})

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	describe("createAgentIdentity", () => {
		it("should generate an Ed25519 keypair and write files", async () => {
			const result = await manager.createAgentIdentity(
				"agent-1",
				"worker",
				["file-read"],
				"team-1",
			)

			expect(result.identity.agentId).toBe("agent-1")
			expect(result.identity.role).toBe("worker")
			expect(result.identity.capabilities).toEqual(["file-read"])
			expect(result.identity.teamId).toBe("team-1")
			expect(result.publicKeyPem).toContain("PUBLIC KEY")

			// Verify files were written
			const agentDir = path.join(tmpDir, "agents", "agent-1")
			const identityContent = await fs.readFile(path.join(agentDir, "identity.json"), "utf-8")
			const identity = JSON.parse(identityContent)
			expect(identity.agentId).toBe("agent-1")

			const keyContent = await fs.readFile(path.join(agentDir, "key.pem"), "utf-8")
			expect(keyContent).toContain("PRIVATE KEY")
		})
	})

	describe("registerPublicKey + loadPublicKeys", () => {
		it("should store and reload public keys", async () => {
			// Create an identity to get a valid public key
			const result = await manager.createAgentIdentity("agent-2", "worker", [], "team-1")

			// Register the public key
			await manager.registerPublicKey("agent-2", result.publicKeyPem)

			// Create a fresh manager to test loading
			const manager2 = new AgentIdentityManager(tmpDir)
			await manager2.loadPublicKeys()

			expect(manager2.getIdentity()).toBeNull() // Not loaded own identity
		})
	})

	describe("sign and verify", () => {
		it("should create a signed message and verify it", async () => {
			// Create identity
			const result = await manager.createAgentIdentity("signer", "worker", [], "team-1")

			// Register own public key for verification
			await manager.registerPublicKey("signer", result.publicKeyPem)

			// Load identity to be able to sign
			const identityPath = path.join(tmpDir, "agents", "signer", "identity.json")
			await manager.loadIdentity(identityPath)

			// Create and sign a message
			const msg = manager.createSignedMessage("recipient", "message", "Hello world")

			expect(msg.from).toBe("signer")
			expect(msg.to).toBe("recipient")
			expect(msg.content).toBe("Hello world")
			expect(msg.signature).toBeTruthy()
			expect(msg.nonce).toBeTruthy()

			// Verify the message
			const validation = manager.validateMessage(msg)
			expect(validation.valid).toBe(true)
		})

		it("should reject tampered messages", async () => {
			const result = await manager.createAgentIdentity("signer2", "worker", [], "team-1")
			await manager.registerPublicKey("signer2", result.publicKeyPem)

			const identityPath = path.join(tmpDir, "agents", "signer2", "identity.json")
			await manager.loadIdentity(identityPath)

			const msg = manager.createSignedMessage("recipient", "message", "Original")

			// Tamper with the content
			const tampered = { ...msg, content: "Tampered!" }

			const validation = manager.validateMessage(tampered)
			expect(validation.valid).toBe(false)
		})

		it("should throw when signing without loaded identity", () => {
			const fresh = new AgentIdentityManager(tmpDir)
			expect(() => {
				fresh.createSignedMessage("to", "message", "test")
			}).toThrow("No identity loaded")
		})
	})
})
