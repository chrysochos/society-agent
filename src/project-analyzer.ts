// Society Agent - new file
import * as fs from "fs/promises"
import * as path from "path"
import { getLog } from "./logger" // Society Agent

/**
 * Project Analyzer - Analyze existing projects and suggest agent structure
 */

export interface AnalysisResult {
	projectType: "monorepo" | "separated" | "monolithic" | "unknown"
	detectedComponents: DetectedComponent[]
	codeMetrics: CodeMetrics
	proposals: AgentProposal[]
}

export interface DetectedComponent {
	type: "backend" | "frontend" | "database" | "tests" | "shared" | "mobile" | "docs"
	location: string
	files: string[]
	lineCount: number
	technologies: string[]
	confidence: number // 0-1
}

export interface CodeMetrics {
	totalFiles: number
	totalLines: number
	languages: Record<string, number> // language -> line count
	dependencies: string[]
}

export interface AgentProposal {
	name: string
	description: string
	changes: FileOperation[]
	agents: AgentConfig[]
	effort: string
	benefits: string[]
	risks: string[]
}

export interface FileOperation {
	type: "move" | "create" | "delete" | "modify"
	from?: string
	to?: string
	description: string
}

export interface AgentConfig {
	agentId: string
	role: string
	workspace: string
	capabilities: string[]
	purpose: string
}

export class ProjectAnalyzer {
	/**
	 * Analyze existing project structure
	 */
	async analyze(projectRoot: string): Promise<AnalysisResult> {
		getLog().info(`[ProjectAnalyzer] Analyzing project: ${projectRoot}`)

		const components = await this.detectComponents(projectRoot)
		const metrics = await this.calculateMetrics(projectRoot)
		const projectType = this.determineProjectType(components)
		const proposals = this.generateProposals(projectType, components, metrics)

		return {
			projectType,
			detectedComponents: components,
			codeMetrics: metrics,
			proposals,
		}
	}

	/**
	 * Detect logical components in the project
	 */
	private async detectComponents(projectRoot: string): Promise<DetectedComponent[]> {
		const components: DetectedComponent[] = []
		const entries = await fs.readdir(projectRoot, { withFileTypes: true })

		// Check for package.json to detect technologies
		const packageJson = await this.readPackageJson(projectRoot)

		// Backend detection
		if (await this.hasBackend(projectRoot, packageJson)) {
			const backendFiles = await this.findBackendFiles(projectRoot) // Society Agent
			components.push({
				type: "backend",
				location: this.findBackendLocation(entries),
				files: backendFiles,
				lineCount: await this.countLines(backendFiles), // Society Agent
				technologies: this.detectBackendTech(packageJson),
				confidence: 0.9,
			})
		}

		// Frontend detection
		if (await this.hasFrontend(projectRoot, packageJson)) {
			const frontendFiles = await this.findFrontendFiles(projectRoot) // Society Agent
			components.push({
				type: "frontend",
				location: this.findFrontendLocation(entries),
				files: frontendFiles,
				lineCount: await this.countLines(frontendFiles), // Society Agent
				technologies: this.detectFrontendTech(packageJson),
				confidence: 0.9,
			})
		}

		// Tests detection
		if (await this.hasTests(projectRoot, entries)) {
			const testFiles = await this.findTestFiles(projectRoot) // Society Agent
			components.push({
				type: "tests",
				location: "tests/",
				files: testFiles,
				lineCount: await this.countLines(testFiles), // Society Agent
				technologies: this.detectTestTech(packageJson),
				confidence: 0.95,
			})
		}

		return components
	}

	/**
	 * Calculate code metrics
	 */
	private async calculateMetrics(projectRoot: string): Promise<CodeMetrics> {
		// Simplified metrics (full implementation would recursively scan all files)
		return {
			totalFiles: 0,
			totalLines: 0,
			languages: {},
			dependencies: [],
		}
	}

	/**
	 * Determine project type
	 */
	private determineProjectType(components: DetectedComponent[]): "monorepo" | "separated" | "monolithic" | "unknown" {
		const hasBackend = components.some((c) => c.type === "backend")
		const hasFrontend = components.some((c) => c.type === "frontend")

		if (hasBackend && hasFrontend) {
			// Check if they're separated
			const backendLoc = components.find((c) => c.type === "backend")?.location || ""
			const frontendLoc = components.find((c) => c.type === "frontend")?.location || ""

			if (backendLoc.includes("backend") || frontendLoc.includes("frontend")) {
				return "separated"
			}
			return "monolithic"
		}

		return "unknown"
	}

	/**
	 * Generate agent proposals
	 */
	private generateProposals(
		projectType: string,
		components: DetectedComponent[],
		metrics: CodeMetrics,
	): AgentProposal[] {
		if (projectType === "monolithic") {
			return this.proposeMonolithicSplit(components)
		} else if (projectType === "separated") {
			return this.proposeSeparatedAgents(components)
		}

		return []
	}

	/**
	 * Propose split for monolithic project
	 */
	private proposeMonolithicSplit(components: DetectedComponent[]): AgentProposal[] {
		return [
			{
				name: "Reorganize into folders",
				description: "Split into backend/, frontend/, tests/ folders",
				changes: [
					{
						type: "create",
						to: "backend/",
						description: "Create backend folder",
					},
					{
						type: "create",
						to: "frontend/",
						description: "Create frontend folder",
					},
					{
						type: "move",
						from: "server.js, routes/, models/",
						to: "backend/",
						description: "Move backend files",
					},
					{
						type: "move",
						from: "src/, public/",
						to: "frontend/",
						description: "Move frontend files",
					},
				],
				agents: [
					{
						agentId: "supervisor-main",
						role: "supervisor",
						workspace: ".",
						capabilities: ["orchestration"],
						purpose: "Coordinate all agents",
					},
					{
						agentId: "backend-dev",
						role: "backend-developer",
						workspace: "backend",
						capabilities: ["api", "database"],
						purpose: "Build backend services",
					},
					{
						agentId: "frontend-dev",
						role: "frontend-developer",
						workspace: "frontend",
						capabilities: ["ui", "react"],
						purpose: "Build user interface",
					},
				],
				effort: "Medium (2-3 hours)",
				benefits: ["Clear separation", "Parallel work", "Better scalability"],
				risks: ["File moves", "Import updates", "Testing required"],
			},
			{
				name: "Keep current structure",
				description: "Assign agents to file patterns in current location",
				changes: [],
				agents: [
					{
						agentId: "supervisor-main",
						role: "supervisor",
						workspace: ".",
						capabilities: ["orchestration"],
						purpose: "Coordinate all agents",
					},
					{
						agentId: "backend-dev",
						role: "backend-developer",
						workspace: ".",
						capabilities: ["api", "database"],
						purpose: "Focus on server files",
					},
					{
						agentId: "frontend-dev",
						role: "frontend-developer",
						workspace: ".",
						capabilities: ["ui", "react"],
						purpose: "Focus on frontend files",
					},
				],
				effort: "Low (15 minutes)",
				benefits: ["No file changes", "Quick setup", "Safe"],
				risks: ["Potential conflicts", "Less clear boundaries"],
			},
		]
	}

	/**
	 * Propose agents for already separated project
	 */
	private proposeSeparatedAgents(components: DetectedComponent[]): AgentProposal[] {
		const agents: AgentConfig[] = [
			{
				agentId: "supervisor-main",
				role: "supervisor",
				workspace: ".",
				capabilities: ["orchestration"],
				purpose: "Coordinate all agents",
			},
		]

		for (const component of components) {
			agents.push({
				agentId: `${component.type}-agent`,
				role: `${component.type}-developer`,
				workspace: component.location,
				capabilities: component.technologies,
				purpose: `Manage ${component.type}`,
			})
		}

		return [
			{
				name: "Use existing structure",
				description: "Assign agents to existing folders",
				changes: [],
				agents,
				effort: "Low (10 minutes)",
				benefits: ["No reorganization", "Instant setup"],
				risks: [],
			},
		]
	}

	// Helper methods
	private async readPackageJson(projectRoot: string): Promise<any> {
		try {
			const content = await fs.readFile(path.join(projectRoot, "package.json"), "utf-8")
			return JSON.parse(content)
		} catch {
			return {}
		}
	}

	private async hasBackend(projectRoot: string, packageJson: any): Promise<boolean> {
		const backendDeps = ["express", "fastify", "koa", "nestjs", "hapi"]
		return backendDeps.some((dep) => packageJson.dependencies?.[dep] || packageJson.devDependencies?.[dep])
	}

	private async hasFrontend(projectRoot: string, packageJson: any): Promise<boolean> {
		const frontendDeps = ["react", "vue", "angular", "svelte", "next", "nuxt"]
		return frontendDeps.some((dep) => packageJson.dependencies?.[dep] || packageJson.devDependencies?.[dep])
	}

	private async hasTests(projectRoot: string, entries: any[]): Promise<boolean> {
		return entries.some(
			(e) => e.isDirectory() && (e.name === "tests" || e.name === "test" || e.name === "__tests__"),
		)
	}

	private findBackendLocation(entries: any[]): string {
		const backendEntry = entries.find((e) => e.isDirectory() && e.name === "backend")
		return backendEntry ? "backend/" : "."
	}

	private findFrontendLocation(entries: any[]): string {
		const frontendEntry = entries.find((e) => e.isDirectory() && (e.name === "frontend" || e.name === "src"))
		return frontendEntry ? frontendEntry.name + "/" : "."
	}

	private async findBackendFiles(projectRoot: string): Promise<string[]> {
		// Simplified - would recursively find .js/.ts files with backend patterns
		return []
	}

	private async findFrontendFiles(projectRoot: string): Promise<string[]> {
		return []
	}

	private async findTestFiles(projectRoot: string): Promise<string[]> {
		return []
	}

	// Society Agent start - Calculate total line count for a list of files
	private async countLines(files: string[]): Promise<number> {
		let total = 0
		for (const file of files) {
			try {
				const content = await fs.readFile(file, "utf-8")
				total += content.split("\n").length
			} catch {
				// Skip unreadable files
			}
		}
		return total
	}
	// Society Agent end

	private detectBackendTech(packageJson: any): string[] {
		const techs: string[] = []
		if (packageJson.dependencies?.express) techs.push("express")
		if (packageJson.dependencies?.mongoose) techs.push("mongodb")
		if (packageJson.dependencies?.pg) techs.push("postgresql")
		return techs
	}

	private detectFrontendTech(packageJson: any): string[] {
		const techs: string[] = []
		if (packageJson.dependencies?.react) techs.push("react")
		if (packageJson.dependencies?.vue) techs.push("vue")
		if (packageJson.dependencies?.["next"]) techs.push("nextjs")
		return techs
	}

	private detectTestTech(packageJson: any): string[] {
		const techs: string[] = []
		if (packageJson.devDependencies?.jest) techs.push("jest")
		if (packageJson.devDependencies?.cypress) techs.push("cypress")
		if (packageJson.devDependencies?.mocha) techs.push("mocha")
		return techs
	}
}
