/**
 * Verification Runner - Task Completion Verification (Proposal 6)
 *
 * Automated verification of task completion with language-agnostic checks.
 * Runs type checks, tests, lint, and validates git commits.
 */

import * as fs from "fs/promises"
import * as path from "path"
import { exec } from "child_process"
import { promisify } from "util"
import { getLog } from "./logger"
import { loadProjectConfig, type ProjectConfig } from "./project-config"
import type { ManagedTask, VerificationResult, VerificationCheckResult } from "./task-manager"

// Re-export types for consumers
export type { VerificationResult, VerificationCheckResult }

const execAsync = promisify(exec)

// ============================================================================
// TYPES
// ============================================================================

/**
 * A single verification check configuration
 */
export interface VerificationCheck {
	/** Check name */
	name: string
	/** Human-readable description */
	description: string
	/** Whether this check is required for verification to pass */
	required: boolean
	/** Current status */
	status: "pending" | "pass" | "fail" | "skip" | "error"
	/** Status details/message */
	details?: string
	/** Time taken in ms */
	duration?: number
}

/**
 * Full verification checklist for a task
 */
export interface VerificationChecklist {
	taskId: string
	projectDir: string
	checks: VerificationCheck[]
	overallResult: "pass" | "fail" | "partial" | "pending"
	startedAt: string
	completedAt?: string
	verifiedBy?: string
}

/**
 * Command execution result
 */
interface CommandResult {
	exitCode: number
	stdout: string
	stderr: string
	duration: number
	command: string
}

/**
 * Task context for determining which checks to run
 */
export interface TaskVerificationContext {
	/** Files created by the task */
	filesCreated?: string[]
	/** Files modified by the task */
	filesModified?: string[]
	/** Reported commit hash */
	commitHash?: string
	/** Task is an API change */
	isApiChange?: boolean
	/** Task requires tests */
	requiresTests?: boolean
	/** Task requires lint check */
	requiresLint?: boolean
	/** Task requires documentation */
	requiresDocs?: boolean
}

// ============================================================================
// COMMAND EXECUTION
// ============================================================================

/**
 * Run a shell command with timeout and capture output
 */
async function runCommand(
	command: string,
	cwd: string,
	timeoutMs: number = 120000
): Promise<CommandResult> {
	const startTime = Date.now()

	try {
		const { stdout, stderr } = await execAsync(command, {
			cwd,
			timeout: timeoutMs,
			maxBuffer: 10 * 1024 * 1024, // 10MB
			env: { ...process.env, CI: "true" }, // Disable interactive prompts
		})

		return {
			exitCode: 0,
			stdout,
			stderr,
			duration: Date.now() - startTime,
			command,
		}
	} catch (error: any) {
		return {
			exitCode: error.code ?? 1,
			stdout: error.stdout ?? "",
			stderr: error.stderr ?? error.message,
			duration: Date.now() - startTime,
			command,
		}
	}
}

// ============================================================================
// VERIFICATION CHECKS
// ============================================================================

/**
 * Check if a git commit exists in the repository
 */
async function checkCommitExists(
	projectDir: string,
	commitHash: string
): Promise<VerificationCheck> {
	const check: VerificationCheck = {
		name: "commit_exists",
		description: "Verify commit exists in git history",
		required: true,
		status: "pending",
	}

	const startTime = Date.now()

	try {
		// Use git rev-parse to verify commit
		const result = await runCommand(`git cat-file -t ${commitHash}`, projectDir, 5000)
		check.duration = Date.now() - startTime

		if (result.exitCode === 0 && result.stdout.trim() === "commit") {
			check.status = "pass"
			check.details = `Commit ${commitHash.slice(0, 7)} found in repository`
		} else {
			check.status = "fail"
			check.details = `Commit ${commitHash.slice(0, 7)} not found in git history`
		}
	} catch (error) {
		check.status = "error"
		check.details = `Failed to check commit: ${error}`
		check.duration = Date.now() - startTime
	}

	return check
}

/**
 * Check if files are tracked in git
 */
async function checkFilesInGit(
	projectDir: string,
	files: string[]
): Promise<VerificationCheck> {
	const check: VerificationCheck = {
		name: "files_tracked",
		description: "Verify files are tracked in git",
		required: true,
		status: "pending",
	}

	if (!files.length) {
		check.status = "skip"
		check.details = "No files to check"
		return check
	}

	const startTime = Date.now()
	const untracked: string[] = []

	try {
		for (const file of files) {
			const result = await runCommand(`git ls-files --error-unmatch "${file}"`, projectDir, 5000)
			if (result.exitCode !== 0) {
				untracked.push(file)
			}
		}

		check.duration = Date.now() - startTime

		if (untracked.length === 0) {
			check.status = "pass"
			check.details = `All ${files.length} files are tracked in git`
		} else {
			check.status = "fail"
			check.details = `Untracked files: ${untracked.join(", ")}`
		}
	} catch (error) {
		check.status = "error"
		check.details = `Failed to check files: ${error}`
		check.duration = Date.now() - startTime
	}

	return check
}

/**
 * Check if FILES.md contains the modified files
 */
async function checkFilesRegistry(
	projectDir: string,
	files: string[]
): Promise<VerificationCheck> {
	const check: VerificationCheck = {
		name: "files_in_registry",
		description: "Verify files are registered in FILES.md",
		required: true,
		status: "pending",
	}

	if (!files.length) {
		check.status = "skip"
		check.details = "No files to check"
		return check
	}

	const startTime = Date.now()

	try {
		const filesPath = path.join(projectDir, "FILES.md")
		const content = await fs.readFile(filesPath, "utf-8")
		
		const missing: string[] = []
		for (const file of files) {
			// Check if file path appears in FILES.md
			if (!content.includes(file)) {
				missing.push(file)
			}
		}

		check.duration = Date.now() - startTime

		if (missing.length === 0) {
			check.status = "pass"
			check.details = `All ${files.length} files are in FILES.md`
		} else {
			check.status = "fail"
			check.details = `Missing from FILES.md: ${missing.join(", ")}`
		}
	} catch (error: any) {
		if (error.code === "ENOENT") {
			check.status = "fail"
			check.details = "FILES.md not found in project"
		} else {
			check.status = "error"
			check.details = `Failed to read FILES.md: ${error.message}`
		}
		check.duration = Date.now() - startTime
	}

	return check
}

/**
 * Run type checking for the project
 */
async function checkTypeErrors(
	projectDir: string,
	config: ProjectConfig
): Promise<VerificationCheck> {
	const check: VerificationCheck = {
		name: "type_check",
		description: `Run ${config.language} type checker`,
		required: true,
		status: "pending",
	}

	const typeCheckCmd = config.validation.typeCheck
	if (!typeCheckCmd) {
		check.status = "skip"
		check.details = `No type checker configured for ${config.language}`
		return check
	}

	getLog().debug(`[Verification] Running type check: ${typeCheckCmd}`)
	const result = await runCommand(typeCheckCmd, projectDir)
	check.duration = result.duration

	if (result.exitCode === 0) {
		check.status = "pass"
		check.details = `${config.language} type check passed`
	} else {
		check.status = "fail"
		// Truncate error output
		const errorOutput = (result.stderr || result.stdout).slice(0, 1000)
		check.details = `Type errors:\n${errorOutput}`
	}

	return check
}

/**
 * Run tests for the project
 */
async function checkTests(
	projectDir: string,
	config: ProjectConfig,
	required: boolean
): Promise<VerificationCheck> {
	const check: VerificationCheck = {
		name: "tests_pass",
		description: `Run ${config.language} tests`,
		required,
		status: "pending",
	}

	if (!required) {
		check.status = "skip"
		check.details = "Tests not required for this task"
		return check
	}

	const testCmd = config.validation.test
	if (!testCmd) {
		check.status = "skip"
		check.details = `No test command configured for ${config.language}`
		return check
	}

	getLog().debug(`[Verification] Running tests: ${testCmd}`)
	const result = await runCommand(testCmd, projectDir, 300000) // 5 min timeout
	check.duration = result.duration

	if (result.exitCode === 0) {
		check.status = "pass"
		// Extract summary from test output
		const output = result.stdout.slice(-500)
		check.details = `Tests passed\n${output}`
	} else {
		check.status = "fail"
		const errorOutput = (result.stderr || result.stdout).slice(-1000)
		check.details = `Tests failed:\n${errorOutput}`
	}

	return check
}

/**
 * Run linter for the project
 */
async function checkLint(
	projectDir: string,
	config: ProjectConfig,
	required: boolean
): Promise<VerificationCheck> {
	const check: VerificationCheck = {
		name: "lint_clean",
		description: `Run ${config.language} linter`,
		required,
		status: "pending",
	}

	if (!required) {
		check.status = "skip"
		check.details = "Lint not required for this task"
		return check
	}

	const lintCmd = config.validation.lint
	if (!lintCmd) {
		check.status = "skip"
		check.details = `No linter configured for ${config.language}`
		return check
	}

	getLog().debug(`[Verification] Running lint: ${lintCmd}`)
	const result = await runCommand(lintCmd, projectDir)
	check.duration = result.duration

	if (result.exitCode === 0) {
		check.status = "pass"
		check.details = "Lint check passed"
	} else {
		check.status = "fail"
		const errorOutput = (result.stderr || result.stdout).slice(0, 1000)
		check.details = `Lint issues:\n${errorOutput}`
	}

	return check
}

/**
 * Check if commit message contains task ID
 */
async function checkCommitMessage(
	projectDir: string,
	commitHash: string,
	taskId: string
): Promise<VerificationCheck> {
	const check: VerificationCheck = {
		name: "commit_message",
		description: "Verify commit message references task ID",
		required: false, // Nice to have, not critical
		status: "pending",
	}

	try {
		const result = await runCommand(`git log -1 --format=%s ${commitHash}`, projectDir, 5000)
		check.duration = result.duration

		if (result.exitCode === 0) {
			const message = result.stdout.trim()
			if (message.includes(taskId)) {
				check.status = "pass"
				check.details = `Commit message includes task ID: "${message.slice(0, 80)}"`
			} else {
				check.status = "fail"
				check.details = `Commit message missing task ID ${taskId}: "${message.slice(0, 80)}"`
			}
		} else {
			check.status = "error"
			check.details = "Failed to read commit message"
		}
	} catch (error) {
		check.status = "error"
		check.details = `Failed to check commit message: ${error}`
	}

	return check
}

/**
 * Check build succeeds (if configured)
 */
async function checkBuild(
	projectDir: string,
	config: ProjectConfig
): Promise<VerificationCheck> {
	const check: VerificationCheck = {
		name: "build_succeeds",
		description: `Run ${config.language} build`,
		required: false,
		status: "pending",
	}

	const buildCmd = config.validation.build
	if (!buildCmd) {
		check.status = "skip"
		check.details = "No build command configured"
		return check
	}

	getLog().debug(`[Verification] Running build: ${buildCmd}`)
	const result = await runCommand(buildCmd, projectDir, 300000)
	check.duration = result.duration

	if (result.exitCode === 0) {
		check.status = "pass"
		check.details = "Build succeeded"
	} else {
		check.status = "fail"
		const errorOutput = (result.stderr || result.stdout).slice(0, 1000)
		check.details = `Build failed:\n${errorOutput}`
	}

	return check
}

// ============================================================================
// MAIN VERIFICATION FUNCTION
// ============================================================================

/**
 * Create a verification checklist for a task
 */
export function createChecklist(
	taskId: string,
	projectDir: string,
	context: TaskVerificationContext = {}
): VerificationChecklist {
	const checklist: VerificationChecklist = {
		taskId,
		projectDir,
		checks: [],
		overallResult: "pending",
		startedAt: new Date().toISOString(),
	}

	// Required checks
	if (context.commitHash) {
		checklist.checks.push({
			name: "commit_exists",
			description: "Verify commit exists in git history",
			required: true,
			status: "pending",
		})
		checklist.checks.push({
			name: "commit_message",
			description: "Verify commit message references task ID",
			required: false,
			status: "pending",
		})
	}

	const allFiles = [...(context.filesCreated ?? []), ...(context.filesModified ?? [])]
	if (allFiles.length > 0) {
		checklist.checks.push({
			name: "files_tracked",
			description: "Verify files are tracked in git",
			required: true,
			status: "pending",
		})
		checklist.checks.push({
			name: "files_in_registry",
			description: "Verify files are registered in FILES.md",
			required: true,
			status: "pending",
		})
	}

	// Type check (always run if available)
	checklist.checks.push({
		name: "type_check",
		description: "Run type checker",
		required: true,
		status: "pending",
	})

	// Conditional checks
	checklist.checks.push({
		name: "tests_pass",
		description: "Run tests",
		required: context.requiresTests ?? false,
		status: "pending",
	})

	checklist.checks.push({
		name: "lint_clean",
		description: "Run linter",
		required: context.requiresLint ?? false,
		status: "pending",
	})

	checklist.checks.push({
		name: "build_succeeds",
		description: "Run build",
		required: false,
		status: "pending",
	})

	return checklist
}

/**
 * Run all verification checks for a task
 */
export async function runVerification(
	task: ManagedTask,
	projectDir: string,
	options: {
		/** Skip slow checks like tests */
		quickMode?: boolean
		/** Only run required checks */
		requiredOnly?: boolean
		/** Custom verification context override */
		context?: TaskVerificationContext
	} = {}
): Promise<VerificationResult> {
	const { quickMode = false, requiredOnly = false } = options

	getLog().info(`[Verification] Starting verification for task ${task.taskId}`)
	const startTime = Date.now()

	// Build context from task result
	const context: TaskVerificationContext = options.context ?? {
		filesCreated: task.result?.filesCreated,
		filesModified: task.result?.filesModified,
		commitHash: task.result?.commitHash,
		requiresTests: !quickMode,
		requiresLint: !quickMode,
	}

	// Load project configuration
	const config = await loadProjectConfig(projectDir)
	getLog().debug(`[Verification] Project language: ${config.language}`)

	// Run checks
	const checks: VerificationCheckResult[] = []
	const allFiles = [...(context.filesCreated ?? []), ...(context.filesModified ?? [])]

	// Commit exists
	if (context.commitHash) {
		const commitCheck = await checkCommitExists(projectDir, context.commitHash)
		checks.push({
			check: commitCheck.name,
			passed: commitCheck.status === "pass",
			message: commitCheck.details,
		})

		// Commit message (if not quick mode)
		if (!quickMode) {
			const msgCheck = await checkCommitMessage(projectDir, context.commitHash, task.taskId)
			if (!requiredOnly || msgCheck.required) {
				checks.push({
					check: msgCheck.name,
					passed: msgCheck.status === "pass",
					message: msgCheck.details,
				})
			}
		}
	} else {
		checks.push({
			check: "commit_exists",
			passed: false,
			message: "No commit hash reported for task",
		})
	}

	// Files tracked in git
	if (allFiles.length > 0) {
		const filesCheck = await checkFilesInGit(projectDir, allFiles)
		checks.push({
			check: filesCheck.name,
			passed: filesCheck.status === "pass",
			message: filesCheck.details,
		})

		// Files in registry
		const registryCheck = await checkFilesRegistry(projectDir, allFiles)
		checks.push({
			check: registryCheck.name,
			passed: registryCheck.status === "pass",
			message: registryCheck.details,
		})
	}

	// Type check
	const typeCheck = await checkTypeErrors(projectDir, config)
	checks.push({
		check: typeCheck.name,
		passed: typeCheck.status === "pass" || typeCheck.status === "skip",
		message: typeCheck.details,
	})

	// Tests (unless quick mode)
	if (!quickMode) {
		const testsCheck = await checkTests(projectDir, config, context.requiresTests ?? false)
		if (!requiredOnly || testsCheck.required) {
			checks.push({
				check: testsCheck.name,
				passed: testsCheck.status === "pass" || testsCheck.status === "skip",
				message: testsCheck.details,
			})
		}
	}

	// Lint (unless quick mode)
	if (!quickMode) {
		const lintCheck = await checkLint(projectDir, config, context.requiresLint ?? false)
		if (!requiredOnly || lintCheck.required) {
			checks.push({
				check: lintCheck.name,
				passed: lintCheck.status === "pass" || lintCheck.status === "skip",
				message: lintCheck.details,
			})
		}
	}

	// Build (unless quick mode and required only)
	if (!quickMode && !requiredOnly) {
		const buildCheck = await checkBuild(projectDir, config)
		checks.push({
			check: buildCheck.name,
			passed: buildCheck.status === "pass" || buildCheck.status === "skip",
			message: buildCheck.details,
		})
	}

	// Calculate overall result
	// Required checks must all pass (skip counts as pass)
	const requiredChecks = ["commit_exists", "files_tracked", "files_in_registry", "type_check"]
	const allPassed = checks
		.filter((c) => requiredChecks.includes(c.check))
		.every((c) => c.passed)

	const duration = Date.now() - startTime
	getLog().info(
		`[Verification] Complete for ${task.taskId}: ${allPassed ? "PASS" : "FAIL"} (${duration}ms)`
	)

	return {
		taskId: task.taskId,
		timestamp: new Date().toISOString(),
		allPassed,
		checks,
		commitHash: context.commitHash,
	}
}

/**
 * Quick verification - only essential checks, skips tests/lint
 */
export async function runQuickVerification(
	task: ManagedTask,
	projectDir: string
): Promise<VerificationResult> {
	return runVerification(task, projectDir, { quickMode: true })
}

/**
 * Full verification - all checks including tests and lint
 */
export async function runFullVerification(
	task: ManagedTask,
	projectDir: string
): Promise<VerificationResult> {
	return runVerification(task, projectDir, { quickMode: false })
}

// ============================================================================
// VERIFICATION UTILITIES
// ============================================================================

/**
 * Check if a task can be marked as verified based on checklist
 */
export function canMarkVerified(
	taskStatus: string,
	verification: VerificationResult
): { allowed: boolean; reason?: string } {
	if (taskStatus !== "done") {
		return {
			allowed: false,
			reason: `Task must be in 'done' status first, currently: ${taskStatus}`,
		}
	}

	if (!verification.allPassed) {
		const failed = verification.checks.filter((c) => !c.passed)
		return {
			allowed: false,
			reason: `Verification failed: ${failed.map((c) => c.check).join(", ")}`,
		}
	}

	return { allowed: true }
}

/**
 * Format verification result as markdown
 */
export function formatVerificationMarkdown(result: VerificationResult): string {
	const lines: string[] = [
		`## Verification: ${result.taskId}`,
		"",
		`**Result**: ${result.allPassed ? "✅ PASSED" : "❌ FAILED"}`,
		`**Time**: ${result.timestamp}`,
	]

	if (result.commitHash) {
		lines.push(`**Commit**: \`${result.commitHash}\``)
	}

	lines.push("", "### Checks", "")

	for (const check of result.checks) {
		const icon = check.passed ? "✓" : "✗"
		lines.push(`- [${icon}] **${check.check}**`)
		if (check.message) {
			// Indent message
			lines.push(`  ${check.message.split("\n")[0]}`)
		}
	}

	return lines.join("\n")
}

/**
 * Append verification to TASK_LOG.md
 */
export async function logVerification(
	projectDir: string,
	result: VerificationResult
): Promise<void> {
	const logPath = path.join(projectDir, "TASK_LOG.md")
	const today = new Date().toISOString().split("T")[0]

	let content = ""
	try {
		content = await fs.readFile(logPath, "utf-8")
	} catch {
		content = "# Task Execution Log\n"
	}

	// Add date header if needed
	if (!content.includes(`## ${today}`)) {
		content += `\n## ${today}\n`
	}

	// Add verification entry
	content += `\n### Verification: ${result.taskId}\n`
	content += `- **Result**: ${result.allPassed ? "PASS" : "FAIL"}\n`
	content += `- **Time**: ${result.timestamp}\n`
	if (result.commitHash) {
		content += `- **Commit**: \`${result.commitHash}\`\n`
	}
	content += "\n**Checks**:\n"
	for (const check of result.checks) {
		const icon = check.passed ? "✓" : "✗"
		content += `- [${icon}] ${check.check}${check.message ? `: ${check.message.split("\n")[0]}` : ""}\n`
	}
	content += "\n---\n"

	await fs.writeFile(logPath, content, "utf-8")
	getLog().debug(`[Verification] Logged to TASK_LOG.md`)
}
