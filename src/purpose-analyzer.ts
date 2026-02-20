// Society Agent - new file
/**
 * PurposeAnalyzer - Analyzes purpose text and suggests team composition
 *
 * Provides intelligent suggestions for what agents are needed based on
 * the purpose description, context, and constraints.
 */

// Society Agent start
export interface PurposeAnalysis {
	purposeType: "development" | "debugging" | "refactoring" | "testing" | "deployment" | "mixed"
	complexity: "simple" | "moderate" | "complex"
	estimatedDuration: "short" | "medium" | "long" // < 30min, 30-60min, > 60min
	suggestedWorkers: {
		workerType: "backend" | "frontend" | "security" | "tester" | "devops" | "custom"
		count: number
		priority: "required" | "recommended" | "optional"
		reason: string
	}[]
	risks: string[]
	dependencies: string[]
}

export interface PurposeContext {
	description: string
	context?: string
	attachments?: string[]
	constraints?: string[]
	successCriteria?: string[]
}
// Society Agent end

/**
 * Analyzes purpose and provides team recommendations
 */
export class PurposeAnalyzer {
	/**
	 * Analyze purpose and suggest team composition
	 */
	static analyze(purpose: PurposeContext): PurposeAnalysis {
		// Society Agent start
		const text = `${purpose.description} ${purpose.context || ""}`.toLowerCase()

		// Detect purpose type
		const purposeType = this.detectPurposeType(text)

		// Assess complexity
		const complexity = this.assessComplexity(text, purpose)

		// Estimate duration
		const estimatedDuration = this.estimateDuration(complexity, purpose)

		// Suggest workers based on purpose type and complexity
		const suggestedWorkers = this.suggestWorkers(purposeType, complexity, text)

		// Identify risks
		const risks = this.identifyRisks(text, purpose)

		// Identify dependencies
		const dependencies = this.identifyDependencies(text, purpose)

		return {
			purposeType,
			complexity,
			estimatedDuration,
			suggestedWorkers,
			risks,
			dependencies,
		}
		// Society Agent end
	}

	/**
	 * Detect purpose type from description
	 */
	private static detectPurposeType(text: string): PurposeAnalysis["purposeType"] {
		// Society Agent start
		const patterns = {
			development: /\b(build|create|add|implement|develop|feature)\b/,
			debugging: /\b(fix|debug|resolve|error|bug|issue)\b/,
			refactoring: /\b(refactor|improve|optimize|restructure|clean)\b/,
			testing: /\b(test|validate|verify|coverage)\b/,
			deployment: /\b(deploy|release|publish|ci\/cd|pipeline)\b/,
		}

		const matches: string[] = []
		for (const [type, pattern] of Object.entries(patterns)) {
			if (pattern.test(text)) {
				matches.push(type)
			}
		}

		if (matches.length === 0) return "mixed"
		if (matches.length > 2) return "mixed"
		return matches[0] as PurposeAnalysis["purposeType"]
		// Society Agent end
	}

	/**
	 * Assess complexity based on various factors
	 */
	private static assessComplexity(text: string, purpose: PurposeContext): PurposeAnalysis["complexity"] {
		// Society Agent start
		let complexityScore = 0

		// Check for complexity indicators
		const complexityIndicators = [
			/\b(authentication|authorization|security)\b/,
			/\b(database|migration|schema)\b/,
			/\b(api|integration|external)\b/,
			/\b(multiple|many|several)\b/,
			/\b(refactor|restructure|redesign)\b/,
		]

		for (const indicator of complexityIndicators) {
			if (indicator.test(text)) complexityScore++
		}

		// Constraints add complexity
		if (purpose.constraints && purpose.constraints.length > 2) complexityScore++

		// Multiple success criteria suggest complexity
		if (purpose.successCriteria && purpose.successCriteria.length > 3) complexityScore++

		if (complexityScore <= 1) return "simple"
		if (complexityScore <= 3) return "moderate"
		return "complex"
		// Society Agent end
	}

	/**
	 * Estimate duration based on complexity
	 */
	private static estimateDuration(
		complexity: PurposeAnalysis["complexity"],
		purpose: PurposeContext,
	): PurposeAnalysis["estimatedDuration"] {
		// Society Agent start
		// Check for explicit time constraints
		const timeConstraint = purpose.constraints?.find((c) => /\b(minute|hour|quick|fast)\b/i.test(c))

		if (timeConstraint) {
			if (/\b(minute|quick|fast)\b/i.test(timeConstraint)) return "short"
		}

		// Default based on complexity
		if (complexity === "simple") return "short"
		if (complexity === "moderate") return "medium"
		return "long"
		// Society Agent end
	}

	/**
	 * Suggest workers based on purpose type and complexity
	 */
	private static suggestWorkers(
		purposeType: PurposeAnalysis["purposeType"],
		complexity: PurposeAnalysis["complexity"],
		text: string,
	): PurposeAnalysis["suggestedWorkers"] {
		// Society Agent start
		const workers: PurposeAnalysis["suggestedWorkers"] = []

		// Analyze what domains are mentioned
		const hasBackend = /\b(api|server|backend|database|auth)\b/.test(text)
		const hasFrontend = /\b(ui|frontend|component|page|interface|dashboard)\b/.test(text)
		const hasSecurity = /\b(security|auth|oauth|encrypt|vulnerability)\b/.test(text)
		const hasTesting = /\b(test|coverage|validation)\b/.test(text)
		const hasDevOps = /\b(deploy|ci\/cd|pipeline|docker|kubernetes)\b/.test(text)

		// Backend developer
		if (hasBackend || purposeType === "development") {
			workers.push({
				workerType: "backend",
				count: 1,
				priority: hasBackend ? "required" : "recommended",
				reason: hasBackend ? "Backend implementation needed" : "General development support",
			})
		}

		// Frontend developer
		if (hasFrontend) {
			workers.push({
				workerType: "frontend",
				count: 1,
				priority: "required",
				reason: "UI/frontend implementation needed",
			})
		}

		// Security reviewer
		if (hasSecurity || complexity === "complex") {
			workers.push({
				workerType: "security",
				count: 1,
				priority: hasSecurity ? "required" : "recommended",
				reason: hasSecurity
					? "Security implementation/audit needed"
					: "Complex code should be security reviewed",
			})
		}

		// Tester
		if (hasTesting || purposeType === "development" || complexity !== "simple") {
			workers.push({
				workerType: "tester",
				count: 1,
				priority: hasTesting ? "required" : "recommended",
				reason: hasTesting ? "Testing explicitly requested" : "Code should be validated with tests",
			})
		}

		// DevOps
		if (hasDevOps) {
			workers.push({
				workerType: "devops",
				count: 1,
				priority: "required",
				reason: "Deployment/infrastructure work needed",
			})
		}

		// If no workers suggested, add a generic backend developer
		if (workers.length === 0) {
			workers.push({
				workerType: "backend",
				count: 1,
				priority: "required",
				reason: "General purpose implementation",
			})
		}

		return workers
		// Society Agent end
	}

	/**
	 * Identify potential risks
	 */
	private static identifyRisks(text: string, purpose: PurposeContext): string[] {
		// Society Agent start
		const risks: string[] = []

		if (/\b(database|migration|schema)\b/.test(text)) {
			risks.push("Database changes may require downtime or migration")
		}

		if (/\b(breaking|remove|delete)\b/.test(text)) {
			risks.push("Potential breaking changes to existing functionality")
		}

		if (/\b(security|auth|password|token)\b/.test(text)) {
			risks.push("Security-sensitive changes require careful review")
		}

		if (/\b(production|prod|live)\b/.test(text)) {
			risks.push("Production environment changes need extra caution")
		}

		return risks
		// Society Agent end
	}

	/**
	 * Identify dependencies or prerequisites
	 */
	private static identifyDependencies(text: string, purpose: PurposeContext): string[] {
		// Society Agent start
		const dependencies: string[] = []

		if (/\b(api|integration|external)\b/.test(text)) {
			dependencies.push("May require API keys or external service access")
		}

		if (/\b(database|migration)\b/.test(text)) {
			dependencies.push("Database access and backup recommended")
		}

		if (/\b(oauth|sso|third-party)\b/.test(text)) {
			dependencies.push("Third-party service credentials may be needed")
		}

		return dependencies
		// Society Agent end
	}
}
