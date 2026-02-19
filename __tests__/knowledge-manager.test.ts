// kilocode_change - new file
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import { KnowledgeManager } from "../knowledge-manager"

// Mock the logger
vi.mock("../logger", () => ({
	getLog: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}))

describe("KnowledgeManager", () => {
	let tmpDir: string
	let km: KnowledgeManager

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "knowledge-test-"))
		km = new KnowledgeManager(tmpDir)
	})

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	// ─── Initialization ───────────────────────────────────

	describe("initialize", () => {
		it("creates knowledge directory", async () => {
			await km.initialize()
			const stat = await fs.stat(km.getKnowledgeDir())
			expect(stat.isDirectory()).toBe(true)
		})

		it("creates all 5 template files", async () => {
			await km.initialize()
			const files = await fs.readdir(km.getKnowledgeDir())
			expect(files).toContain("chat-history.md")
			expect(files).toContain("inventory.md")
			expect(files).toContain("state.md")
			expect(files).toContain("relationships.md")
			expect(files).toContain("decisions.md")
		})

		it("populates templates with header content", async () => {
			await km.initialize()
			const content = await km.readFile("inventory")
			expect(content).toContain("# Inventory")
			expect(content).toContain("Tangible")
			expect(content).toContain("Intangible")
		})

		it("is idempotent — preserves existing files", async () => {
			await km.initialize()
			// Write custom content
			await km.writeFile("decisions", "# My Custom Decisions\n")
			// Re-initialize
			await km.initialize()
			// Should NOT overwrite
			const content = await km.readFile("decisions")
			expect(content).toBe("# My Custom Decisions\n")
		})
	})

	// ─── Read operations ──────────────────────────────────

	describe("readFile", () => {
		it("returns empty string for missing file", async () => {
			const content = await km.readFile("chatHistory")
			expect(content).toBe("")
		})

		it("returns file content after initialization", async () => {
			await km.initialize()
			const content = await km.readFile("state")
			expect(content).toContain("# State")
		})
	})

	describe("readAll", () => {
		it("returns all 5 files", async () => {
			await km.initialize()
			const all = await km.readAll()
			expect(all.chatHistory).toContain("Chat History")
			expect(all.inventory).toContain("Inventory")
			expect(all.state).toContain("State")
			expect(all.relationships).toContain("Relationships")
			expect(all.decisions).toContain("Decisions")
		})
	})

	describe("getSummary", () => {
		it("lists all files with line counts", async () => {
			await km.initialize()
			const summary = await km.getSummary()
			expect(summary).toContain("chat-history.md")
			expect(summary).toContain("inventory.md")
			expect(summary).toContain("lines")
		})

		it("shows 'not created' for missing files", async () => {
			const summary = await km.getSummary()
			expect(summary).toContain("not created")
		})
	})

	// ─── Write operations ─────────────────────────────────

	describe("appendToFile", () => {
		it("appends content to existing file", async () => {
			await km.initialize()
			await km.appendToFile("inventory", "- **API Server**: Express.js backend\n")
			const content = await km.readFile("inventory")
			expect(content).toContain("API Server")
		})

		it("accumulates multiple appends", async () => {
			await km.initialize()
			await km.appendToFile("inventory", "Item 1\n")
			await km.appendToFile("inventory", "Item 2\n")
			const content = await km.readFile("inventory")
			expect(content).toContain("Item 1")
			expect(content).toContain("Item 2")
		})
	})

	describe("writeFile", () => {
		it("replaces entire file content", async () => {
			await km.initialize()
			await km.writeFile("state", "# Completely New State\n")
			const content = await km.readFile("state")
			expect(content).toBe("# Completely New State\n")
			expect(content).not.toContain("Current State") // original template gone
		})
	})

	describe("logConversation", () => {
		it("appends formatted conversation entry", async () => {
			await km.initialize()
			await km.logConversation({
				timestamp: "2026-02-14T10:00:00Z",
				from: "supervisor-1",
				to: "worker-1",
				type: "task_assign",
				content: "Implement the login page",
			})
			const history = await km.readFile("chatHistory")
			expect(history).toContain("supervisor-1")
			expect(history).toContain("worker-1")
			expect(history).toContain("Implement the login page")
			expect(history).toContain("task_assign")
		})
	})

	describe("logDecision", () => {
		it("appends formatted decision entry", async () => {
			await km.initialize()
			await km.logDecision({
				title: "Auth Strategy",
				context: "Need user authentication",
				options: ["JWT tokens", "Session cookies", "OAuth2"],
				chosen: "JWT tokens",
				rationale: "Stateless, scales horizontally",
				agentId: "worker-1",
			})
			const decisions = await km.readFile("decisions")
			expect(decisions).toContain("Auth Strategy")
			expect(decisions).toContain("JWT tokens")
			expect(decisions).toContain("Stateless")
			expect(decisions).toContain("worker-1")
			expect(decisions).toContain("Session cookies") // option was listed
		})
	})

	describe("updateState", () => {
		it("replaces state file with current/desired/gaps", async () => {
			await km.initialize()
			await km.updateState(
				"Auth is not implemented",
				"Users can log in with JWT",
				"Need login endpoint + middleware",
			)
			const state = await km.readFile("state")
			expect(state).toContain("Auth is not implemented")
			expect(state).toContain("Users can log in with JWT")
			expect(state).toContain("Need login endpoint")
		})
	})

	describe("addInventoryItem", () => {
		it("appends item to inventory", async () => {
			await km.initialize()
			await km.addInventoryItem("tangible", "Redis Cache", "In-memory data store for sessions")
			const inv = await km.readFile("inventory")
			expect(inv).toContain("Redis Cache")
			expect(inv).toContain("In-memory data store")
		})
	})

	describe("addRelationship", () => {
		it("appends relationship entry", async () => {
			await km.initialize()
			await km.addRelationship("AuthService", "depends-on", "Database", "for user records")
			const rel = await km.readFile("relationships")
			expect(rel).toContain("AuthService")
			expect(rel).toContain("depends-on")
			expect(rel).toContain("Database")
			expect(rel).toContain("for user records")
		})

		it("works without notes", async () => {
			await km.initialize()
			await km.addRelationship("A", "calls", "B")
			const rel = await km.readFile("relationships")
			expect(rel).toContain("A —calls→ B")
		})
	})

	// ─── Lifecycle ────────────────────────────────────────

	describe("hasKnowledge", () => {
		it("returns false before initialization", async () => {
			expect(await km.hasKnowledge()).toBe(false)
		})

		it("returns true after initialization", async () => {
			await km.initialize()
			expect(await km.hasKnowledge()).toBe(true)
		})
	})

	describe("clear", () => {
		it("removes knowledge directory", async () => {
			await km.initialize()
			await km.clear()
			expect(await km.hasKnowledge()).toBe(false)
		})

		it("is safe to call when already cleared", async () => {
			await expect(km.clear()).resolves.not.toThrow()
		})
	})
})
