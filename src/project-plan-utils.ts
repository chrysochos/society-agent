// kilocode_change - new file
import * as fs from "fs/promises"
import * as path from "path"

/**
 * Project Plan Interface - Source of truth for multi-agent coordination
 */

export interface ProjectPlan {
	projectName: string
	version: string
	created: string
	lastModified: string
	structure: {
		root: string
		folders: Array<{
			path: string
			purpose: string
			technologies?: string[]
			responsibilities?: string[]
		}>
	}
	agents: Array<{
		agentId: string
		role: string
		workspace: string
		capabilities: string[]
		purpose: string
		responsibilities?: string[]
		communicatesWith?: string[]
		autoLaunch: boolean
	}>
	taskFlow?: {
		defaultWorkflow?: string[]
	}
}

/**
 * Auto-discovery helper - finds .society-agent/ in parent directories
 */
export async function findSocietyAgentDir(startDir: string, maxLevels: number = 5): Promise<string | undefined> {
	let current = startDir

	for (let i = 0; i < maxLevels; i++) {
		const candidate = path.join(current, ".society-agent")

		try {
			const stat = await fs.stat(candidate)
			if (stat.isDirectory()) {
				return candidate
			}
		} catch {
			// Directory doesn't exist, continue searching
		}

		// Move up one level
		const parent = path.dirname(current)
		if (parent === current) {
			// Reached root, stop
			break
		}
		current = parent
	}

	return undefined
}

/**
 * Load project plan from .society-agent/
 */
export async function loadProjectPlan(sharedDir: string): Promise<ProjectPlan | undefined> {
	const planPath = path.join(sharedDir, "project-plan.json")

	try {
		const content = await fs.readFile(planPath, "utf-8")
		return JSON.parse(content)
	} catch {
		return undefined
	}
}

/**
 * Find matching agent from project plan based on workspace path
 */
export function findMatchingAgent(plan: ProjectPlan, workspacePath: string): (typeof plan.agents)[0] | undefined {
	const projectRoot = plan.structure.root

	// Calculate relative path from project root
	const relativePath = path.relative(projectRoot, workspacePath)

	// Find agent with matching workspace
	return plan.agents.find((agent) => {
		// Exact match
		if (agent.workspace === relativePath) return true

		// Root workspace (. or empty)
		if ((agent.workspace === "." || agent.workspace === "") && relativePath === "") return true

		// Normalize paths for comparison
		const normalizedAgent = path.normalize(agent.workspace)
		const normalizedRelative = path.normalize(relativePath)

		return normalizedAgent === normalizedRelative
	})
}

/**
 * Generate agent ID if not exists
 */
export function generateAgentId(role: string): string {
	const random = Math.random().toString(36).substring(2, 8)
	return `${role}-${random}`
}

/**
 * Save project plan
 */
export async function saveProjectPlan(sharedDir: string, plan: ProjectPlan): Promise<void> {
	const planPath = path.join(sharedDir, "project-plan.json")
	plan.lastModified = new Date().toISOString()
	await fs.writeFile(planPath, JSON.stringify(plan, null, 2), "utf-8")
}

/**
 * Create initial project structure
 */
export async function createProjectStructure(plan: ProjectPlan): Promise<void> {
	const root = plan.structure.root

	// Create .society-agent/
	const sharedDir = path.join(root, ".society-agent")
	await fs.mkdir(sharedDir, { recursive: true })

	// Create coordination files
	const files = ["registry.jsonl", "messages.jsonl", "tasks.jsonl", "deliveries.jsonl"]
	for (const file of files) {
		const filePath = path.join(sharedDir, file)
		try {
			await fs.writeFile(filePath, "", { flag: "wx" }) // wx = create only if not exists
		} catch {
			// File already exists, skip
		}
	}

	// Save project plan
	await saveProjectPlan(sharedDir, plan)

	// Create workspace folders
	for (const folder of plan.structure.folders) {
		const folderPath = path.join(root, folder.path)
		await fs.mkdir(folderPath, { recursive: true })

		// Create .vscode/settings.json for each workspace
		const agent = plan.agents.find((a) => a.workspace === folder.path)
		if (agent) {
			await createWorkspaceSettings(folderPath, sharedDir, agent)
		}
	}
}

/**
 * Create .vscode/settings.json for a workspace
 */
async function createWorkspaceSettings(
	workspacePath: string,
	sharedDir: string,
	agent: ProjectPlan["agents"][0],
): Promise<void> {
	const settingsDir = path.join(workspacePath, ".vscode")
	await fs.mkdir(settingsDir, { recursive: true })

	const settingsPath = path.join(settingsDir, "settings.json")

	const settings = {
		"kilo-code.societyAgent.agentId": agent.agentId,
		"kilo-code.societyAgent.role": agent.role,
		"kilo-code.societyAgent.sharedDir": sharedDir,
		"kilo-code.societyAgent.capabilities": agent.capabilities,
	}

	await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf-8")
}
