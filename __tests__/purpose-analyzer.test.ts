// Society Agent - new file
import { describe, it, expect } from "vitest"
import { PurposeAnalyzer, type PurposeContext } from "../purpose-analyzer"

describe("PurposeAnalyzer", () => {
	describe("analyze", () => {
		it("should detect development purpose type", () => {
			const purpose: PurposeContext = {
				description: "Build user authentication system with OAuth",
			}
			const result = PurposeAnalyzer.analyze(purpose)
			expect(result.purposeType).toBe("development")
		})

		it("should detect debugging purpose type", () => {
			const purpose: PurposeContext = {
				description: "Fix the login error that occurs when user submits empty form",
			}
			const result = PurposeAnalyzer.analyze(purpose)
			expect(result.purposeType).toBe("debugging")
		})

		it("should detect testing purpose type", () => {
			const purpose: PurposeContext = {
				description: "Test all the API endpoints and verify correct responses",
			}
			const result = PurposeAnalyzer.analyze(purpose)
			expect(result.purposeType).toBe("testing")
		})

		it("should detect refactoring purpose type", () => {
			const purpose: PurposeContext = {
				description: "Refactor the database layer to use repository pattern",
			}
			const result = PurposeAnalyzer.analyze(purpose)
			expect(result.purposeType).toBe("refactoring")
		})

		it("should detect deployment purpose type", () => {
			const purpose: PurposeContext = {
				description: "Deploy the application to production with CI/CD pipeline",
			}
			const result = PurposeAnalyzer.analyze(purpose)
			expect(result.purposeType).toBe("deployment")
		})

		it("should assess simple complexity", () => {
			const purpose: PurposeContext = {
				description: "Fix a typo in the README",
			}
			const result = PurposeAnalyzer.analyze(purpose)
			expect(result.complexity).toBe("simple")
		})

		it("should assess complex complexity for multi-constraint purposes", () => {
			const purpose: PurposeContext = {
				description: "Build a microservices architecture with authentication, database integration, API gateway, and real-time notifications",
				constraints: ["Must use TypeScript", "Must be production-ready", "Budget: 4 hours"],
				successCriteria: ["All tests pass", "No security vulnerabilities", "99.9% uptime"],
			}
			const result = PurposeAnalyzer.analyze(purpose)
			expect(result.complexity).toBe("complex")
		})

		it("should suggest at least one worker", () => {
			const purpose: PurposeContext = {
				description: "Create a simple utility function",
			}
			const result = PurposeAnalyzer.analyze(purpose)
			expect(result.suggestedWorkers.length).toBeGreaterThanOrEqual(1)
		})

		it("should return risks array", () => {
			const purpose: PurposeContext = {
				description: "Build something",
			}
			const result = PurposeAnalyzer.analyze(purpose)
			expect(Array.isArray(result.risks)).toBe(true)
		})

		it("should return dependencies array", () => {
			const purpose: PurposeContext = {
				description: "Build something",
			}
			const result = PurposeAnalyzer.analyze(purpose)
			expect(Array.isArray(result.dependencies)).toBe(true)
		})

		it("should include context in analysis", () => {
			const purpose: PurposeContext = {
				description: "Add a feature",
				context: "This is a React frontend application with security requirements",
			}
			const result = PurposeAnalyzer.analyze(purpose)
			// With security context, there should be security-related workers suggested
			const workerTypes = result.suggestedWorkers.map((w) => w.workerType)
			expect(workerTypes.length).toBeGreaterThan(0)
		})

		it("should estimate short duration for simple tasks", () => {
			const purpose: PurposeContext = {
				description: "Fix a small bug",
			}
			const result = PurposeAnalyzer.analyze(purpose)
			expect(["short", "medium"]).toContain(result.estimatedDuration)
		})
	})
})
