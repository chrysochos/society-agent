// kilocode_change - new file
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import { AgentDirectory } from "../agent-directory"
import type { AgentDirectoryEntry } from "../types"

// Mock the logger
vi.mock("../logger", () => ({
	getLog: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}))

function makeEntry(overrides: Partial<AgentDirectoryEntry> = {}): AgentDirectoryEntry {
	return {
		agentId: "worker-1",
		name: "Worker One",
		role: "worker",
		capabilities: ["file-read", "file-write"],
		domain: "backend",
		supervisorId: "supervisor-main",
		lifecycle: "ephemeral",
		workspace: "/workspace/worker-1",
		status: "online",
		lastSeen: new Date().toISOString(),
		...overrides,
	}
}

describe("AgentDirectory", () => {
	let tmpDir: string
	let directory: AgentDirectory

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-dir-test-"))
		directory = new AgentDirectory({
			sharedDir: tmpDir,
			refreshIntervalMs: 60000, // long interval — we'll refresh manually
		})
		await directory.initialize()
	})

	afterEach(async () => {
		directory.dispose()
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	// ─── Publishing ───────────────────────────────────────

	describe("publish / unpublish", () => {
		it("publishes an agent entry", async () => {
			const entry = makeEntry()
			await directory.publish(entry)
			expect(directory.getAgent("worker-1")).toBeDefined()
			expect(directory.getAgent("worker-1")?.role).toBe("worker")
		})

		it("persists to disk", async () => {
			await directory.publish(makeEntry())
			const content = JSON.parse(await fs.readFile(path.join(tmpDir, "directory.json"), "utf-8"))
			expect(content.agents["worker-1"]).toBeDefined()
		})

		it("unpublishes an agent", async () => {
			await directory.publish(makeEntry())
			await directory.unpublish("worker-1")
			expect(directory.getAgent("worker-1")).toBeUndefined()
		})

		it("updates existing entry on re-publish", async () => {
			await directory.publish(makeEntry({ status: "online" }))
			await directory.publish(makeEntry({ status: "busy" }))
			expect(directory.getAgent("worker-1")?.status).toBe("busy")
		})
	})

	// ─── Discovery ────────────────────────────────────────

	describe("discovery queries", () => {
		beforeEach(async () => {
			await directory.publish(makeEntry({ agentId: "worker-1", role: "worker", domain: "backend", capabilities: ["file-read", "file-write"] }))
			await directory.publish(makeEntry({ agentId: "worker-2", role: "worker", domain: "frontend", capabilities: ["file-read", "browser-control"] }))
			await directory.publish(makeEntry({ agentId: "supervisor-main", role: "supervisor", domain: undefined, supervisorId: "human", capabilities: ["agent-messaging", "task-delegation"] }))
			await directory.publish(makeEntry({ agentId: "tester-1", role: "worker", domain: "testing", supervisorId: "supervisor-main", capabilities: ["test-execution"] }))
		})

		it("getAllAgents returns all published agents", () => {
			expect(directory.getAllAgents()).toHaveLength(4)
		})

		it("findByRole returns agents with matching role", () => {
			const workers = directory.findByRole("worker")
			expect(workers).toHaveLength(3) // worker-1, worker-2, tester-1
		})

		it("findByCapability returns agents with all requested caps", () => {
			const fileAgents = directory.findByCapability("file-read")
			expect(fileAgents).toHaveLength(2) // worker-1, worker-2

			const fullFileAgents = directory.findByCapability("file-read", "file-write")
			expect(fullFileAgents).toHaveLength(1) // only worker-1
		})

		it("findByDomain returns matching domain agents", () => {
			const backend = directory.findByDomain("backend")
			expect(backend).toHaveLength(1)
			expect(backend[0].agentId).toBe("worker-1")
		})

		it("findBySupervisor returns agents supervised by given ID", () => {
			const supervised = directory.findBySupervisor("supervisor-main")
			// worker-1, worker-2, tester-1 all default to supervisor-main
			expect(supervised.length).toBeGreaterThanOrEqual(1)
		})

		it("findByLifecycle filters by lifecycle mode", async () => {
			await directory.publish(makeEntry({ agentId: "persist-1", lifecycle: "persistent" }))
			const persistent = directory.findByLifecycle("persistent")
			expect(persistent).toHaveLength(1)
			expect(persistent[0].agentId).toBe("persist-1")
		})
	})

	// ─── Contacts ─────────────────────────────────────────

	describe("getContactsFor", () => {
		beforeEach(async () => {
			await directory.publish(makeEntry({ agentId: "supervisor-main", role: "supervisor", supervisorId: "human" }))
			await directory.publish(makeEntry({ agentId: "worker-1", role: "worker", supervisorId: "supervisor-main" }))
			await directory.publish(makeEntry({ agentId: "worker-2", role: "worker", supervisorId: "supervisor-main" }))
		})

		it("returns supervisor for a worker", () => {
			const contacts = directory.getContactsFor("worker-1")
			expect(contacts.supervisor?.agentId).toBe("supervisor-main")
		})

		it("returns peers (same supervisor)", () => {
			const contacts = directory.getContactsFor("worker-1")
			expect(contacts.peers).toHaveLength(1)
			expect(contacts.peers[0].agentId).toBe("worker-2")
		})

		it("returns subordinates for a supervisor", () => {
			const contacts = directory.getContactsFor("supervisor-main")
			expect(contacts.subordinates).toHaveLength(2)
		})

		it("returns empty for unknown agent", () => {
			const contacts = directory.getContactsFor("nonexistent")
			expect(contacts.supervisor).toBeUndefined()
			expect(contacts.peers).toEqual([])
			expect(contacts.subordinates).toEqual([])
		})
	})

	// ─── Supervision chain ────────────────────────────────

	describe("resolveSupervisionChain", () => {
		beforeEach(async () => {
			await directory.publish(makeEntry({ agentId: "human-proxy", role: "supervisor", supervisorId: "human" }))
			await directory.publish(makeEntry({ agentId: "supervisor-main", role: "supervisor", supervisorId: "human-proxy" }))
			await directory.publish(makeEntry({ agentId: "worker-1", role: "worker", supervisorId: "supervisor-main" }))
		})

		it("resolves full chain: worker → supervisor → proxy → human", () => {
			const chain = directory.resolveSupervisionChain("worker-1")
			expect(chain.chain).toEqual(["worker-1", "supervisor-main", "human-proxy", "human"])
			expect(chain.humanNodeId).toBe("human")
		})

		it("resolves short chain for top-level supervisor", () => {
			const chain = directory.resolveSupervisionChain("human-proxy")
			expect(chain.chain).toEqual(["human-proxy", "human"])
		})

		it("handles unknown agent gracefully", () => {
			const chain = directory.resolveSupervisionChain("unknown")
			expect(chain.chain).toEqual(["unknown", "human"])
		})

		it("detects cycles without infinite loop", async () => {
			// Create a cycle: a → b → a
			await directory.publish(makeEntry({ agentId: "cycle-a", supervisorId: "cycle-b" }))
			await directory.publish(makeEntry({ agentId: "cycle-b", supervisorId: "cycle-a" }))
			const chain = directory.resolveSupervisionChain("cycle-a")
			// Should terminate, ending with "human"
			expect(chain.chain[chain.chain.length - 1]).toBe("human")
			expect(chain.chain.length).toBeLessThan(10) // not infinite
		})
	})

	describe("isSupervisorOf", () => {
		beforeEach(async () => {
			await directory.publish(makeEntry({ agentId: "super", role: "supervisor", supervisorId: "human" }))
			await directory.publish(makeEntry({ agentId: "worker-1", role: "worker", supervisorId: "super" }))
		})

		it("returns true for direct supervisor", () => {
			expect(directory.isSupervisorOf("super", "worker-1")).toBe(true)
		})

		it("returns false for non-supervisor", () => {
			expect(directory.isSupervisorOf("worker-1", "super")).toBe(false)
		})

		it("human supervises everyone transitively", () => {
			expect(directory.isSupervisorOf("human", "worker-1")).toBe(true)
		})
	})

	describe("getEscalationTarget", () => {
		it("returns supervisor ID", async () => {
			await directory.publish(makeEntry({ agentId: "worker-1", supervisorId: "super" }))
			expect(directory.getEscalationTarget("worker-1")).toBe("super")
		})

		it("returns human for unknown agent", () => {
			expect(directory.getEscalationTarget("unknown")).toBe("human")
		})
	})

	// ─── Heartbeat ────────────────────────────────────────

	describe("heartbeat", () => {
		it("updates lastSeen", async () => {
			const oldDate = "2020-01-01T00:00:00.000Z"
			await directory.publish(makeEntry({ agentId: "worker-1", lastSeen: oldDate }))
			await directory.heartbeat("worker-1")
			const agent = directory.getAgent("worker-1")
			expect(new Date(agent!.lastSeen).getTime()).toBeGreaterThan(new Date(oldDate).getTime())
		})

		it("updates status if provided", async () => {
			await directory.publish(makeEntry({ agentId: "worker-1", status: "online" }))
			await directory.heartbeat("worker-1", "busy")
			expect(directory.getAgent("worker-1")?.status).toBe("busy")
		})

		it("is no-op for unknown agent", async () => {
			await expect(directory.heartbeat("unknown")).resolves.not.toThrow()
		})
	})

	// ─── Human + External work ────────────────────────────

	describe("human-present and external work", () => {
		beforeEach(async () => {
			// Supervisor (human-present)
			await directory.publish(makeEntry({
				agentId: "supervisor-main",
				role: "supervisor",
				supervisorId: "human",
				humanPresent: true,
				acceptsExternalWork: true,
			}))
			// Worker 1 — accepts external work
			await directory.publish(makeEntry({
				agentId: "worker-1",
				role: "worker",
				supervisorId: "supervisor-main",
				acceptsExternalWork: true,
			}))
			// Worker 2 — does NOT accept external work
			await directory.publish(makeEntry({
				agentId: "worker-2",
				role: "worker",
				supervisorId: "supervisor-main",
				acceptsExternalWork: false,
			}))
		})

		it("getHumanPresentNodes returns only human-present nodes", () => {
			const nodes = directory.getHumanPresentNodes()
			expect(nodes).toHaveLength(1)
			expect(nodes[0].agentId).toBe("supervisor-main")
		})

		it("getExternalWorkAcceptors includes human-present and opt-in agents", () => {
			const acceptors = directory.getExternalWorkAcceptors()
			const ids = acceptors.map((a) => a.agentId)
			expect(ids).toContain("supervisor-main") // humanPresent
			expect(ids).toContain("worker-1") // acceptsExternalWork
			expect(ids).not.toContain("worker-2") // neither
		})
	})

	describe("canSendWorkTo", () => {
		beforeEach(async () => {
			await directory.publish(makeEntry({
				agentId: "supervisor-main",
				role: "supervisor",
				supervisorId: "human",
				humanPresent: true,
			}))
			await directory.publish(makeEntry({
				agentId: "worker-1",
				role: "worker",
				supervisorId: "supervisor-main",
			}))
			await directory.publish(makeEntry({
				agentId: "worker-2",
				role: "worker",
				supervisorId: "supervisor-main",
			}))
			await directory.publish(makeEntry({
				agentId: "external-agent",
				role: "worker",
				supervisorId: "other-supervisor",
				acceptsExternalWork: false,
			}))
			await directory.publish(makeEntry({
				agentId: "open-agent",
				role: "worker",
				supervisorId: "other-supervisor",
				acceptsExternalWork: true,
			}))
		})

		it("supervisor can send to its subordinates", () => {
			expect(directory.canSendWorkTo("supervisor-main", "worker-1")).toBe(true)
		})

		it("anyone can send to human-present nodes", () => {
			expect(directory.canSendWorkTo("external-agent", "supervisor-main")).toBe(true)
		})

		it("anyone can send to external-work-accepting nodes", () => {
			expect(directory.canSendWorkTo("worker-1", "open-agent")).toBe(true)
		})

		it("peers can message each other", () => {
			expect(directory.canSendWorkTo("worker-1", "worker-2")).toBe(true)
		})

		it("cannot send to closed agent from outside hierarchy", () => {
			expect(directory.canSendWorkTo("worker-1", "external-agent")).toBe(false)
		})

		it("returns false for unknown target", () => {
			expect(directory.canSendWorkTo("worker-1", "nonexistent")).toBe(false)
		})
	})
})
