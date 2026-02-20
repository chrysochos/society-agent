// Society Agent - new file
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import { JsonlStorage, getStoragePaths, ensureStorageDirectories } from "../storage"

// Mock the logger
vi.mock("../logger", () => ({
	getLog: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}))

describe("getStoragePaths", () => {
	it("should return correct paths for a workspace root", () => {
		const paths = getStoragePaths("/home/user/project")
		expect(paths.baseDir).toBe("/home/user/project/.society-agent")
		expect(paths.logsDir).toBe("/home/user/project/.society-agent/logs")
		expect(paths.registryFile).toBe("/home/user/project/.society-agent/registry.jsonl")
		expect(paths.messagesFile).toBe("/home/user/project/.society-agent/messages.jsonl")
		expect(paths.approvalsFile).toBe("/home/user/project/.society-agent/approvals.jsonl")
	})
})

describe("ensureStorageDirectories", () => {
	let tmpDir: string

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sa-storage-test-"))
	})

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	it("should create logs directory", async () => {
		const paths = getStoragePaths(tmpDir)
		await ensureStorageDirectories(paths)

		const stat = await fs.stat(paths.logsDir)
		expect(stat.isDirectory()).toBe(true)
	})
})

describe("JsonlStorage", () => {
	let tmpDir: string
	let filePath: string
	let storage: JsonlStorage<{ id: number; name: string }>

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sa-jsonl-test-"))
		filePath = path.join(tmpDir, "test.jsonl")
		storage = new JsonlStorage(filePath)
	})

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	describe("append", () => {
		it("should create file and write entry", async () => {
			await storage.append({ id: 1, name: "first" })

			const content = await fs.readFile(filePath, "utf-8")
			expect(content.trim()).toBe('{"id":1,"name":"first"}')
		})

		it("should append multiple entries", async () => {
			await storage.append({ id: 1, name: "first" })
			await storage.append({ id: 2, name: "second" })

			const content = await fs.readFile(filePath, "utf-8")
			const lines = content.trim().split("\n")
			expect(lines).toHaveLength(2)
		})
	})

	describe("readAll", () => {
		it("should read all appended entries", async () => {
			await storage.append({ id: 1, name: "a" })
			await storage.append({ id: 2, name: "b" })
			await storage.append({ id: 3, name: "c" })

			const entries = await storage.readAll()
			expect(entries).toHaveLength(3)
			expect(entries[0]).toEqual({ id: 1, name: "a" })
			expect(entries[2]).toEqual({ id: 3, name: "c" })
		})

		it("should return empty array when file does not exist", async () => {
			const noFile = new JsonlStorage<{ id: number }>(path.join(tmpDir, "nonexistent.jsonl"))
			const entries = await noFile.readAll()
			expect(entries).toEqual([])
		})
	})

	describe("readFiltered", () => {
		it("should filter entries by predicate", async () => {
			await storage.append({ id: 1, name: "cat" })
			await storage.append({ id: 2, name: "dog" })
			await storage.append({ id: 3, name: "cat" })

			const cats = await storage.readFiltered((e) => e.name === "cat")
			expect(cats).toHaveLength(2)
		})
	})

	describe("readLast", () => {
		it("should read only the last N entries", async () => {
			for (let i = 1; i <= 10; i++) {
				await storage.append({ id: i, name: `item-${i}` })
			}

			const last3 = await storage.readLast(3)
			expect(last3).toHaveLength(3)
			expect(last3[0].id).toBe(8)
			expect(last3[2].id).toBe(10)
		})
	})

	describe("count", () => {
		it("should return the correct count", async () => {
			await storage.append({ id: 1, name: "a" })
			await storage.append({ id: 2, name: "b" })

			expect(await storage.count()).toBe(2)
		})

		it("should return 0 for empty", async () => {
			expect(await storage.count()).toBe(0)
		})
	})

	describe("clear", () => {
		it("should remove the file", async () => {
			await storage.append({ id: 1, name: "a" })
			await storage.clear()

			const entries = await storage.readAll()
			expect(entries).toEqual([])
		})

		it("should not throw when file does not exist", async () => {
			await expect(storage.clear()).resolves.toBeUndefined()
		})
	})
})
