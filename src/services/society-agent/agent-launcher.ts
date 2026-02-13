// kilocode_change - new file
import * as child_process from "child_process"
import * as path from "path"
import * as fs from "fs/promises"
import { promisify } from "util"

const exec = promisify(child_process.exec)

/**
 * Agent Launcher - Automatically launch VS Code instances for agents
 */

export interface LaunchConfig {
	agentId: string
	role: string
	workspace: string
	autoLaunch: boolean
}

export interface ProjectPlan {
	projectName: string
	structure: {
		root: string
		folders: Array<{ path: string; purpose: string }>
	}
	agents: LaunchConfig[]
}

export class AgentLauncher {
	/**
	 * Launch all agents defined in project plan
	 */
	async launchAll(projectRoot: string, planPath?: string): Promise<LaunchResult[]> {
		// Load project plan
		const plan = await this.loadPlan(projectRoot, planPath)

		const results: LaunchResult[] = []

		// Launch each agent that has autoLaunch: true
		for (const agent of plan.agents) {
			if (!agent.autoLaunch) {
				console.log(`[AgentLauncher] Skipping ${agent.agentId} (autoLaunch: false)`)
				continue
			}

			const result = await this.launchAgent(projectRoot, agent)
			results.push(result)

			// Delay between launches to avoid conflicts
			await this.delay(2000)
		}

		return results
	}

	/**
	 * Launch a single agent in its workspace
	 */
	async launchAgent(projectRoot: string, agent: LaunchConfig): Promise<LaunchResult> {
		const workspacePath = path.join(projectRoot, agent.workspace)

		console.log(`[AgentLauncher] Launching ${agent.agentId} in ${workspacePath}`)

		try {
			// Check if folder exists
			const exists = await fs
				.stat(workspacePath)
				.then(() => true)
				.catch(() => false)

			if (!exists) {
				return {
					agentId: agent.agentId,
					success: false,
					error: `Workspace folder not found: ${workspacePath}`,
				}
			}

			// Create README with agent context if it doesn't exist
			await this.createAgentReadme(workspacePath, agent)

			// kilocode_change start - Launch with extension dev mode if in development
			const isDevelopment = process.env.VSCODE_DEBUG_MODE === "true" || process.env.NODE_ENV === "development"
			let command: string

			if (isDevelopment) {
				// Launch with extension development path
				const extensionPath = path.join(projectRoot, "src")
				command = `code --new-window --extensionDevelopmentPath="${extensionPath}" "${workspacePath}"`
			} else {
				// Production mode - use regular code command
				command = `code --new-window "${workspacePath}"`
			}
			// kilocode_change end

			await exec(command, {
				cwd: projectRoot,
				env: {
					...process.env,
					// Pass agent info as environment variables (VS Code can read these)
					SOCIETY_AGENT_ID: agent.agentId,
					SOCIETY_AGENT_ROLE: agent.role,
				},
			})

			return {
				agentId: agent.agentId,
				success: true,
				workspace: workspacePath,
			}
		} catch (error) {
			return {
				agentId: agent.agentId,
				success: false,
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}

	/**
	 * Launch agents with custom VS Code executable path
	 */
	async launchAgentCustom(projectRoot: string, agent: LaunchConfig, vscodePath: string): Promise<LaunchResult> {
		const workspacePath = path.join(projectRoot, agent.workspace)

		console.log(`[AgentLauncher] Launching ${agent.agentId} with custom VS Code: ${vscodePath}`)

		try {
			const command = `"${vscodePath}" "${workspacePath}"`

			await exec(command, {
				cwd: projectRoot,
				env: {
					...process.env,
					SOCIETY_AGENT_ID: agent.agentId,
					SOCIETY_AGENT_ROLE: agent.role,
				},
			})

			return {
				agentId: agent.agentId,
				success: true,
				workspace: workspacePath,
			}
		} catch (error) {
			return {
				agentId: agent.agentId,
				success: false,
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}

	/**
	 * Launch agents in new window (not reuse existing)
	 */
	async launchAgentNewWindow(projectRoot: string, agent: LaunchConfig): Promise<LaunchResult> {
		const workspacePath = path.join(projectRoot, agent.workspace)

		console.log(`[AgentLauncher] Launching ${agent.agentId} in new window`)

		try {
			// --new-window flag forces new VS Code window
			const command = `code --new-window "${workspacePath}"`

			await exec(command, {
				cwd: projectRoot,
				env: {
					...process.env,
					SOCIETY_AGENT_ID: agent.agentId,
					SOCIETY_AGENT_ROLE: agent.role,
				},
			})

			return {
				agentId: agent.agentId,
				success: true,
				workspace: workspacePath,
			}
		} catch (error) {
			return {
				agentId: agent.agentId,
				success: false,
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}

	/**
	 * Create README.md in agent workspace with context
	 */
	private async createAgentReadme(workspacePath: string, agent: LaunchConfig): Promise<void> {
		const readmePath = path.join(workspacePath, "README.md")

		// Check if README already exists
		const exists = await fs
			.stat(readmePath)
			.then(() => true)
			.catch(() => false)

		if (exists) return // Don't overwrite existing README

		const content = `# ${agent.agentId} Workspace

**Role**: ${agent.role}  
**Capabilities**: ${agent.capabilities.join(", ")}

## About This Workspace

This workspace is for the **${agent.agentId}** agent. You will receive task messages here and work on assigned features or fixes.

### Your Responsibilities

${this.getRoleDescription(agent.role)}

### Workflow

1. Wait for task messages (they appear in KiloCode chat)
2. Work on the task using your capabilities
3. Respond with results when complete
4. Messages go back to the sender automatically

### Workspace Structure

This workspace starts empty. You'll create files and folders as needed based on tasks you receive.

**Note**: When you receive follow-up messages, continue working without re-exploring the workspace. You already know the structure.
`

		await fs.writeFile(readmePath, content, "utf-8")
		console.log(`[AgentLauncher] Created README.md in ${workspacePath}`)
	}

	/**
	 * Get role description for README
	 */
	private getRoleDescription(role: string): string {
		const descriptions: Record<string, string> = {
			"backend-developer":
				"- Build and maintain REST APIs\n- Design database schemas\n- Implement server-side logic\n- Write backend tests",
			"frontend-developer":
				"- Build user interfaces\n- Implement React components\n- Style with CSS/Tailwind\n- Write frontend tests",
			supervisor:
				"- Coordinate team members\n- Review code and decisions\n- Ensure project goals are met\n- Resolve conflicts",
			tester: "- Write comprehensive test suites\n- Perform integration testing\n- Document test results\n- Report bugs",
			devops: "- Set up CI/CD pipelines\n- Configure deployment\n- Manage infrastructure\n- Monitor services",
			"security-reviewer":
				"- Review code for vulnerabilities\n- Implement security best practices\n- Audit dependencies\n- Document security concerns",
		}

		return descriptions[role] || "- Work on assigned tasks\n- Collaborate with team\n- Follow best practices"
	}

	/**
	 * Load project plan from .society-agent/project-plan.json
	 */
	private async loadPlan(projectRoot: string, planPath?: string): Promise<ProjectPlan> {
		const defaultPath = path.join(projectRoot, ".society-agent", "project-plan.json")
		const finalPath = planPath || defaultPath

		const content = await fs.readFile(finalPath, "utf-8")
		return JSON.parse(content)
	}

	/**
	 * Delay helper
	 */
	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms))
	}

	/**
	 * Check if VS Code CLI is available
	 */
	async checkVSCodeCLI(): Promise<boolean> {
		try {
			await exec("code --version")
			return true
		} catch {
			return false
		}
	}

	/**
	 * Get VS Code CLI path (platform-specific)
	 */
	getVSCodePath(): string {
		const platform = process.platform

		if (platform === "darwin") {
			// macOS
			return "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
		} else if (platform === "win32") {
			// Windows
			return "C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd"
		} else {
			// Linux
			return "code"
		}
	}

	/**
	 * Launch with progress reporting
	 */
	async launchAllWithProgress(
		projectRoot: string,
		onProgress: (status: ProgressUpdate) => void,
	): Promise<LaunchResult[]> {
		const plan = await this.loadPlan(projectRoot)
		const agentsToLaunch = plan.agents.filter((a) => a.autoLaunch)

		onProgress({
			type: "start",
			total: agentsToLaunch.length,
			message: `Launching ${agentsToLaunch.length} agents...`,
		})

		const results: LaunchResult[] = []

		for (let i = 0; i < agentsToLaunch.length; i++) {
			const agent = agentsToLaunch[i]

			onProgress({
				type: "progress",
				current: i + 1,
				total: agentsToLaunch.length,
				agentId: agent.agentId,
				message: `Launching ${agent.agentId}...`,
			})

			const result = await this.launchAgent(projectRoot, agent)
			results.push(result)

			if (result.success) {
				onProgress({
					type: "success",
					current: i + 1,
					total: agentsToLaunch.length,
					agentId: agent.agentId,
					message: `✓ ${agent.agentId} launched`,
				})
			} else {
				onProgress({
					type: "error",
					current: i + 1,
					total: agentsToLaunch.length,
					agentId: agent.agentId,
					message: `✗ ${agent.agentId} failed: ${result.error}`,
				})
			}

			// Delay between launches
			if (i < agentsToLaunch.length - 1) {
				await this.delay(2000)
			}
		}

		onProgress({
			type: "complete",
			total: agentsToLaunch.length,
			message: `Launched ${results.filter((r) => r.success).length}/${results.length} agents`,
		})

		return results
	}
}

export interface LaunchResult {
	agentId: string
	success: boolean
	workspace?: string
	error?: string
}

export interface ProgressUpdate {
	type: "start" | "progress" | "success" | "error" | "complete"
	current?: number
	total: number
	agentId?: string
	message: string
}
