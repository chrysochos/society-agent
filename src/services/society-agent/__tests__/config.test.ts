// kilocode_change - new file
import { describe, it, expect, vi } from "vitest"
import {
	defaultConfig,
	supervisorCapabilities,
	coordinatorCapabilities,
	getDefaultCapabilitiesForRole,
	validateCapabilities,
	requiresApproval,
	validateRole,
	mergeConfig,
} from "../config"

// Mock the logger
vi.mock("../logger", () => ({
	getLog: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}))

describe("defaultConfig", () => {
	it("should be disabled by default", () => {
		expect(defaultConfig.enabled).toBe(false)
	})

	it("should default to worker role", () => {
		expect(defaultConfig.defaultRole).toBe("worker")
	})

	it("should have logging enabled", () => {
		expect(defaultConfig.logAllActions).toBe(true)
	})
})

describe("getDefaultCapabilitiesForRole", () => {
	it("should return supervisor capabilities", () => {
		const caps = getDefaultCapabilitiesForRole("supervisor")
		expect(caps).toEqual(supervisorCapabilities)
		expect(caps).toContain("approval-grant")
		expect(caps).toContain("task-delegation")
	})

	it("should return coordinator capabilities", () => {
		const caps = getDefaultCapabilitiesForRole("coordinator")
		expect(caps).toEqual(coordinatorCapabilities)
		expect(caps).toContain("agent-messaging")
		expect(caps).not.toContain("approval-grant")
	})

	it("should return worker capabilities", () => {
		const caps = getDefaultCapabilitiesForRole("worker")
		expect(caps).toEqual(defaultConfig.defaultCapabilities)
	})

	it("should default to worker for unknown roles", () => {
		const caps = getDefaultCapabilitiesForRole("unknown" as any)
		expect(caps).toEqual(defaultConfig.defaultCapabilities)
	})
})

describe("validateCapabilities", () => {
	it("should accept valid capabilities", () => {
		const result = validateCapabilities(["file-read", "file-write", "code-analysis"])
		expect(result).toEqual(["file-read", "file-write", "code-analysis"])
	})

	it("should filter out invalid capabilities", () => {
		const result = validateCapabilities(["file-read", "fly-to-moon", "code-analysis"])
		expect(result).toEqual(["file-read", "code-analysis"])
	})

	it("should return empty array for all invalid", () => {
		const result = validateCapabilities(["invalid-1", "invalid-2"])
		expect(result).toEqual([])
	})

	it("should handle empty input", () => {
		const result = validateCapabilities([])
		expect(result).toEqual([])
	})
})

describe("validateRole", () => {
	it("should accept valid roles", () => {
		expect(validateRole("worker")).toBe("worker")
		expect(validateRole("supervisor")).toBe("supervisor")
		expect(validateRole("coordinator")).toBe("coordinator")
	})

	it("should default to worker for invalid roles", () => {
		expect(validateRole("king")).toBe("worker")
		expect(validateRole("")).toBe("worker")
	})
})

describe("requiresApproval", () => {
	it("should require approval for high-risk operations", () => {
		expect(requiresApproval("file-delete")).toBe(true)
		expect(requiresApproval("shell-execute")).toBe(true)
		expect(requiresApproval("git-operations")).toBe(true)
	})

	it("should not require approval for safe operations", () => {
		expect(requiresApproval("file-read")).toBe(false)
		expect(requiresApproval("code-analysis")).toBe(false)
	})

	it("should skip approval when config disables it", () => {
		const noApproval = { ...defaultConfig, requireApproval: false }
		expect(requiresApproval("file-delete", noApproval)).toBe(false)
	})
})

describe("mergeConfig", () => {
	it("should merge partial config with defaults", () => {
		const merged = mergeConfig({ enabled: true, defaultRole: "supervisor" })
		expect(merged.enabled).toBe(true)
		expect(merged.defaultRole).toBe("supervisor")
		expect(merged.logAllActions).toBe(true) // kept from default
	})

	it("should return defaults when empty", () => {
		const merged = mergeConfig({})
		expect(merged).toEqual(defaultConfig)
	})
})
