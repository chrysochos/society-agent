// Society Agent - new file
/**
 * Tests for SupervisorAgent escalation mechanism
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock vscode
vi.mock("vscode", () => ({
	window: {
		showWarningMessage: vi.fn(),
		showInformationMessage: vi.fn(),
	},
	workspace: {
		getConfiguration: vi.fn().mockReturnValue({
			get: vi.fn(),
		}),
		workspaceFolders: [],
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

// Mock the API handler dependencies
vi.mock("../conversation-agent", () => {
	return {
		ConversationAgent: class {
			protected conversationHistory: any[] = []
			protected config: any = {}
			constructor(config: any) {
				this.config = config
			}
			async sendMessage(content: string): Promise<string> {
				return "OK"
			}
		},
	}
})

import { SupervisorAgent, type EscalationRequest } from "../supervisor-agent"

describe("SupervisorAgent", () => {
	describe("escalation mechanism", () => {
		let supervisor: SupervisorAgent

		beforeEach(() => {
			supervisor = new SupervisorAgent({
				identity: {
					id: "supervisor-1",
					role: "supervisor",
					capabilities: [],
					createdAt: Date.now(),
				},
				apiHandler: {} as any,
				purpose: {
					id: "purpose-1",
					description: "Test purpose",
					context: "Testing",
					successCriteria: [],
					createdAt: Date.now(),
				},
			})
		})

		it("should resolve escalation when respondToEscalation is called", async () => {
			const onEscalation = vi.fn((esc: EscalationRequest) => {
				// Simulate human responding after 10ms
				setTimeout(() => {
					supervisor.respondToEscalation(esc.id, "Go with option A")
				}, 10)
			})

			// Set the callback directly
			;(supervisor as any).onEscalation = onEscalation

			const result = await supervisor.escalateToHuman("high", "Which option?", "Testing", ["A", "B"])

			expect(result).toBe("Go with option A")
			expect(onEscalation).toHaveBeenCalled()
		})

		it("should timeout after 5 minutes with default response", async () => {
			vi.useFakeTimers()

			const promise = supervisor.escalateToHuman("low", "Timeout test?", "context")

			// Advance past the 5 minute timeout
			vi.advanceTimersByTime(5 * 60 * 1000 + 100)

			const result = await promise
			expect(result).toContain("No human response")

			vi.useRealTimers()
		})
	})
})
