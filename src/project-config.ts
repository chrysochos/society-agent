// Society Agent - new file
/**
 * Project Configuration - Language-agnostic project detection and validation
 *
 * Detects project language/framework and provides appropriate validation commands.
 * Supports explicit configuration via .society.json or auto-detection.
 */

import * as fs from "fs/promises"
import * as path from "path"
import { getLog } from "./logger"

/**
 * Supported programming languages
 */
export type ProjectLanguage =
	| "typescript"
	| "javascript"
	| "python"
	| "go"
	| "rust"
	| "java"
	| "csharp"
	| "ruby"
	| "php"
	| "generic"

/**
 * Validation commands for a project
 */
export interface ValidationCommands {
	/** Type checking command (e.g., tsc, mypy, go vet) */
	typeCheck?: string
	/** Test runner command */
	test?: string
	/** Linter command */
	lint?: string
	/** Formatter check command */
	formatCheck?: string
	/** Build command */
	build?: string
	/** All-in-one validation (runs all checks) */
	validate?: string
}

/**
 * Project configuration - can be auto-detected or explicitly set
 */
export interface ProjectConfig {
	/** Primary programming language */
	language: ProjectLanguage

	/** Secondary languages (for polyglot projects) */
	secondaryLanguages?: ProjectLanguage[]

	/** Framework (e.g., fastapi, express, django, react) */
	framework?: string

	/** Package manager (npm, yarn, pip, poetry, cargo, etc.) */
	packageManager?: string

	/** Validation commands */
	validation: ValidationCommands

	/** Source directories */
	paths: {
		source: string[]
		tests: string[]
		docs?: string
		build?: string
	}

	/** Dependency files */
	dependencyFiles: string[]

	/** Detection confidence (0-1) */
	confidence: number

	/** Whether config was loaded from .society.json */
	explicit: boolean
}

/**
 * Language detection indicators
 */
interface LanguageIndicator {
	/** Files that indicate this language */
	files: string[]
	/** Extensions that indicate this language */
	extensions: string[]
	/** Default validation commands */
	validation: ValidationCommands
	/** Default paths */
	paths: { source: string[]; tests: string[] }
	/** Package manager */
	packageManager?: string
	/** Dependency files */
	dependencyFiles: string[]
}

const LANGUAGE_INDICATORS: Record<ProjectLanguage, LanguageIndicator> = {
	python: {
		files: ["pyproject.toml", "setup.py", "requirements.txt", "Pipfile", "poetry.lock"],
		extensions: [".py", ".pyi"],
		validation: {
			typeCheck: "mypy . --ignore-missing-imports",
			test: "pytest -v",
			lint: "ruff check . || flake8",
			formatCheck: "black --check . || ruff format --check .",
			validate: "mypy . && pytest && ruff check .",
		},
		paths: { source: ["src/", "."], tests: ["tests/", "test/"] },
		packageManager: "pip",
		dependencyFiles: ["requirements.txt", "pyproject.toml", "setup.py"],
	},
	typescript: {
		files: ["tsconfig.json", "package.json"],
		extensions: [".ts", ".tsx"],
		validation: {
			typeCheck: "npx tsc --noEmit",
			test: "npm test",
			lint: "npx eslint . --ext .ts,.tsx",
			formatCheck: "npx prettier --check .",
			validate: "npm run build && npm test",
		},
		paths: { source: ["src/"], tests: ["tests/", "__tests__/", "test/"] },
		packageManager: "npm",
		dependencyFiles: ["package.json"],
	},
	javascript: {
		files: ["package.json"],
		extensions: [".js", ".jsx", ".mjs", ".cjs"],
		validation: {
			test: "npm test",
			lint: "npx eslint .",
			formatCheck: "npx prettier --check .",
			validate: "npm test && npx eslint .",
		},
		paths: { source: ["src/", "lib/"], tests: ["tests/", "__tests__/", "test/"] },
		packageManager: "npm",
		dependencyFiles: ["package.json"],
	},
	go: {
		files: ["go.mod", "go.sum"],
		extensions: [".go"],
		validation: {
			typeCheck: "go vet ./...",
			test: "go test -v ./...",
			lint: "golangci-lint run",
			formatCheck: "gofmt -l .",
			build: "go build ./...",
			validate: "go vet ./... && go test ./... && golangci-lint run",
		},
		paths: { source: ["cmd/", "pkg/", "internal/"], tests: ["."] },
		packageManager: "go",
		dependencyFiles: ["go.mod"],
	},
	rust: {
		files: ["Cargo.toml", "Cargo.lock"],
		extensions: [".rs"],
		validation: {
			typeCheck: "cargo check",
			test: "cargo test",
			lint: "cargo clippy -- -D warnings",
			formatCheck: "cargo fmt --check",
			build: "cargo build",
			validate: "cargo check && cargo test && cargo clippy",
		},
		paths: { source: ["src/"], tests: ["tests/"] },
		packageManager: "cargo",
		dependencyFiles: ["Cargo.toml"],
	},
	java: {
		files: ["pom.xml", "build.gradle", "build.gradle.kts"],
		extensions: [".java"],
		validation: {
			typeCheck: "mvn compile -q || gradle compileJava",
			test: "mvn test -q || gradle test",
			lint: "mvn checkstyle:check || gradle checkstyleMain",
			build: "mvn package -q || gradle build",
			validate: "mvn verify || gradle check",
		},
		paths: { source: ["src/main/java/"], tests: ["src/test/java/"] },
		packageManager: "maven",
		dependencyFiles: ["pom.xml", "build.gradle"],
	},
	csharp: {
		files: ["*.csproj", "*.sln"],
		extensions: [".cs"],
		validation: {
			typeCheck: "dotnet build --no-restore",
			test: "dotnet test --no-build",
			build: "dotnet build",
			validate: "dotnet build && dotnet test",
		},
		paths: { source: ["src/"], tests: ["tests/", "test/"] },
		packageManager: "nuget",
		dependencyFiles: ["*.csproj"],
	},
	ruby: {
		files: ["Gemfile", "Gemfile.lock", "*.gemspec"],
		extensions: [".rb"],
		validation: {
			test: "bundle exec rspec || bundle exec rake test",
			lint: "bundle exec rubocop",
			validate: "bundle exec rubocop && bundle exec rspec",
		},
		paths: { source: ["lib/", "app/"], tests: ["spec/", "test/"] },
		packageManager: "bundler",
		dependencyFiles: ["Gemfile"],
	},
	php: {
		files: ["composer.json", "composer.lock"],
		extensions: [".php"],
		validation: {
			test: "vendor/bin/phpunit",
			lint: "vendor/bin/phpstan analyse || vendor/bin/psalm",
			formatCheck: "vendor/bin/php-cs-fixer fix --dry-run --diff",
			validate: "vendor/bin/phpstan analyse && vendor/bin/phpunit",
		},
		paths: { source: ["src/", "app/"], tests: ["tests/"] },
		packageManager: "composer",
		dependencyFiles: ["composer.json"],
	},
	generic: {
		files: [],
		extensions: [],
		validation: {},
		paths: { source: ["."], tests: ["tests/", "test/"] },
		dependencyFiles: [],
	},
}

/**
 * Explicit configuration file format (.society.json)
 */
export interface SocietyConfigFile {
	/** Override auto-detected language */
	language?: ProjectLanguage

	/** Custom validation commands (merged with defaults) */
	validation?: Partial<ValidationCommands>

	/** Custom paths */
	paths?: {
		source?: string[]
		tests?: string[]
		docs?: string
		build?: string
	}

	/** Task ID prefix for this project */
	taskPrefix?: string

	/** Project-specific settings */
	settings?: {
		/** Require tests for all tasks */
		requireTests?: boolean
		/** Require lint pass for all tasks */
		requireLint?: boolean
		/** Auto-verify completed tasks */
		autoVerify?: boolean
	}
}

/**
 * Load project configuration
 *
 * Priority:
 * 1. .society.json (explicit config)
 * 2. Auto-detection based on files
 */
export async function loadProjectConfig(projectRoot: string): Promise<ProjectConfig> {
	// Try to load explicit config first
	const explicitConfig = await loadSocietyConfig(projectRoot)

	// Auto-detect language
	const detected = await detectProjectLanguage(projectRoot)

	// Merge explicit config with detected
	if (explicitConfig) {
		return mergeConfigs(detected, explicitConfig)
	}

	return detected
}

/**
 * Load .society.json if it exists
 */
async function loadSocietyConfig(projectRoot: string): Promise<SocietyConfigFile | null> {
	const configPath = path.join(projectRoot, ".society.json")
	try {
		const content = await fs.readFile(configPath, "utf-8")
		return JSON.parse(content)
	} catch {
		return null
	}
}

/**
 * Auto-detect project language from files
 */
export async function detectProjectLanguage(projectRoot: string): Promise<ProjectConfig> {
	const files = await listFiles(projectRoot)
	const scores: Record<ProjectLanguage, number> = {
		typescript: 0,
		javascript: 0,
		python: 0,
		go: 0,
		rust: 0,
		java: 0,
		csharp: 0,
		ruby: 0,
		php: 0,
		generic: 0,
	}

	// Score based on indicator files
	for (const [lang, indicator] of Object.entries(LANGUAGE_INDICATORS) as [ProjectLanguage, LanguageIndicator][]) {
		for (const indicatorFile of indicator.files) {
			if (indicatorFile.includes("*")) {
				// Glob pattern
				const pattern = indicatorFile.replace("*", "")
				if (files.some((f) => f.endsWith(pattern))) {
					scores[lang] += 10
				}
			} else if (files.includes(indicatorFile)) {
				scores[lang] += 10
			}
		}
	}

	// Score based on file extensions (sample first 100 files)
	const sampleFiles = files.slice(0, 100)
	for (const file of sampleFiles) {
		const ext = path.extname(file).toLowerCase()
		for (const [lang, indicator] of Object.entries(LANGUAGE_INDICATORS) as [ProjectLanguage, LanguageIndicator][]) {
			if (indicator.extensions.includes(ext)) {
				scores[lang] += 1
			}
		}
	}

	// Special case: TypeScript over JavaScript if tsconfig.json exists
	if (files.includes("tsconfig.json")) {
		scores.typescript += 20
	}

	// Find highest scoring language
	let bestLang: ProjectLanguage = "generic"
	let bestScore = 0
	for (const [lang, score] of Object.entries(scores) as [ProjectLanguage, number][]) {
		if (score > bestScore) {
			bestScore = score
			bestLang = lang
		}
	}

	// Calculate confidence
	const totalScore = Object.values(scores).reduce((a, b) => a + b, 0)
	const confidence = totalScore > 0 ? bestScore / totalScore : 0

	// Detect secondary languages (any with score > 5)
	const secondaryLanguages = (Object.entries(scores) as [ProjectLanguage, number][])
		.filter(([lang, score]) => lang !== bestLang && score > 5)
		.map(([lang]) => lang)

	const indicator = LANGUAGE_INDICATORS[bestLang]

	// Detect framework
	const framework = await detectFramework(projectRoot, bestLang, files)

	getLog().info(`[ProjectConfig] Detected: ${bestLang} (confidence: ${(confidence * 100).toFixed(0)}%)`)

	return {
		language: bestLang,
		secondaryLanguages: secondaryLanguages.length > 0 ? secondaryLanguages : undefined,
		framework,
		packageManager: indicator.packageManager,
		validation: { ...indicator.validation },
		paths: {
			source: indicator.paths.source,
			tests: indicator.paths.tests,
		},
		dependencyFiles: indicator.dependencyFiles,
		confidence,
		explicit: false,
	}
}

/**
 * Detect framework based on language and files
 */
async function detectFramework(projectRoot: string, language: ProjectLanguage, files: string[]): Promise<string | undefined> {
	if (language === "python") {
		// Check for Python frameworks
		const reqPath = path.join(projectRoot, "requirements.txt")
		const pyprojectPath = path.join(projectRoot, "pyproject.toml")

		let content = ""
		try {
			content = await fs.readFile(reqPath, "utf-8")
		} catch {
			try {
				content = await fs.readFile(pyprojectPath, "utf-8")
			} catch {
				// No dependency file found
			}
		}

		if (content.includes("fastapi")) return "fastapi"
		if (content.includes("django")) return "django"
		if (content.includes("flask")) return "flask"
		if (content.includes("streamlit")) return "streamlit"
		if (content.includes("pytorch") || content.includes("torch")) return "pytorch"
		if (content.includes("tensorflow")) return "tensorflow"
	}

	if (language === "typescript" || language === "javascript") {
		const pkgPath = path.join(projectRoot, "package.json")
		try {
			const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"))
			const deps = { ...pkg.dependencies, ...pkg.devDependencies }

			if (deps.next) return "nextjs"
			if (deps.nuxt) return "nuxt"
			if (deps.react) return "react"
			if (deps.vue) return "vue"
			if (deps.angular) return "angular"
			if (deps.express) return "express"
			if (deps.fastify) return "fastify"
			if (deps.nestjs || deps["@nestjs/core"]) return "nestjs"
		} catch {
			// No package.json
		}
	}

	if (language === "go") {
		if (files.some((f) => f.includes("gin"))) return "gin"
		if (files.some((f) => f.includes("echo"))) return "echo"
		if (files.some((f) => f.includes("fiber"))) return "fiber"
	}

	if (language === "rust") {
		const cargoPath = path.join(projectRoot, "Cargo.toml")
		try {
			const content = await fs.readFile(cargoPath, "utf-8")
			if (content.includes("actix")) return "actix"
			if (content.includes("axum")) return "axum"
			if (content.includes("rocket")) return "rocket"
		} catch {
			// No Cargo.toml
		}
	}

	return undefined
}

/**
 * List files in project root (non-recursive, for quick detection)
 */
async function listFiles(projectRoot: string): Promise<string[]> {
	try {
		const entries = await fs.readdir(projectRoot)
		return entries
	} catch {
		return []
	}
}

/**
 * Merge explicit config with auto-detected config
 */
function mergeConfigs(detected: ProjectConfig, explicit: SocietyConfigFile): ProjectConfig {
	return {
		...detected,
		language: explicit.language ?? detected.language,
		validation: {
			...detected.validation,
			...explicit.validation,
		},
		paths: {
			source: explicit.paths?.source ?? detected.paths.source,
			tests: explicit.paths?.tests ?? detected.paths.tests,
			docs: explicit.paths?.docs ?? detected.paths.docs,
			build: explicit.paths?.build ?? detected.paths.build,
		},
		explicit: true,
	}
}

/**
 * Get validation command for a specific check
 */
export function getValidationCommand(config: ProjectConfig, check: keyof ValidationCommands): string | undefined {
	return config.validation[check]
}

/**
 * Run a validation check and return result
 */
export interface ValidationResult {
	check: keyof ValidationCommands
	command: string
	passed: boolean
	output: string
	duration: number
}

/**
 * Generate a .society.json template for a project
 */
export function generateConfigTemplate(detected: ProjectConfig): SocietyConfigFile {
	return {
		language: detected.language,
		validation: {
			typeCheck: detected.validation.typeCheck,
			test: detected.validation.test,
			lint: detected.validation.lint,
			formatCheck: detected.validation.formatCheck,
		},
		paths: {
			source: detected.paths.source,
			tests: detected.paths.tests,
		},
		settings: {
			requireTests: true,
			requireLint: true,
			autoVerify: true,
		},
	}
}

// ============================================================================
// BROWNFIELD PROJECT BOOTSTRAPPING
// For existing projects that need to be onboarded into the Society Agent system
// ============================================================================

/**
 * Result of bootstrapping an existing project
 */
export interface BootstrapResult {
	/** Detected project configuration */
	config: ProjectConfig

	/** Generated FILES.md content */
	filesRegistry: string

	/** Generated PLAN.md content */
	planRegistry: string

	/** Generated AGENTS.md content */
	agentsKnowledge: string

	/** Detected TODOs and FIXMEs from code */
	detectedTasks: DetectedTask[]

	/** File statistics */
	stats: {
		totalFiles: number
		sourceFiles: number
		testFiles: number
		configFiles: number
		totalLines: number
	}

	/** Git history summary (if available) */
	gitSummary?: {
		totalCommits: number
		contributors: string[]
		lastCommitDate: string
		activeBranches: string[]
	}
}

/**
 * A task detected from code comments (TODO, FIXME, etc.)
 * NOTE comments are informational, not actionable tasks
 */
export interface DetectedTask {
	type: "TODO" | "FIXME" | "HACK" | "XXX"
	text: string
	file: string
	line: number
	priority: "low" | "medium" | "high"
}

/**
 * Bootstrap an existing project into Society Agent
 *
 * This scans the project and generates:
 * - FILES.md: File ownership registry
 * - PLAN.md: Task registry with detected TODOs
 * - AGENTS.md: Initial agent knowledge base
 */
export async function bootstrapExistingProject(
	projectRoot: string,
	options: {
		/** Agent ID that will own the files initially */
		ownerAgentId?: string
		/** Project name for documentation */
		projectName?: string
		/** Scan for TODO/FIXME comments */
		scanTasks?: boolean
		/** Include git history analysis */
		analyzeGit?: boolean
		/** Maximum files to scan (for large projects) */
		maxFiles?: number
	} = {}
): Promise<BootstrapResult> {
	const {
		ownerAgentId = "architect",
		projectName = path.basename(projectRoot),
		scanTasks = true,
		analyzeGit = true,
		maxFiles = 1000,
	} = options

	getLog().info(`[Bootstrap] Starting bootstrap for: ${projectRoot}`)

	// 1. Detect project configuration
	const config = await detectProjectLanguage(projectRoot)
	getLog().info(`[Bootstrap] Detected language: ${config.language}`)

	// 2. Scan files
	const fileList = await scanProjectFiles(projectRoot, maxFiles)
	getLog().info(`[Bootstrap] Found ${fileList.length} files`)

	// 3. Categorize files
	const categorized = categorizeFiles(fileList, config)

	// 4. Detect TODOs/FIXMEs
	let detectedTasks: DetectedTask[] = []
	if (scanTasks) {
		detectedTasks = await scanForTasks(projectRoot, fileList.slice(0, 500)) // Limit for performance
		getLog().info(`[Bootstrap] Found ${detectedTasks.length} TODO/FIXME comments`)
	}

	// 5. Analyze git history (if available)
	let gitSummary: BootstrapResult["gitSummary"] | undefined
	if (analyzeGit) {
		gitSummary = await analyzeGitHistory(projectRoot)
	}

	// 6. Calculate stats
	const stats = await calculateFileStats(projectRoot, categorized)

	// 7. Generate FILES.md
	const filesRegistry = generateFilesRegistry(categorized, ownerAgentId, projectName)

	// 8. Generate PLAN.md
	const planRegistry = generatePlanRegistry(detectedTasks, projectName, config)

	// 9. Generate AGENTS.md
	const agentsKnowledge = generateAgentsKnowledge(config, stats, gitSummary, projectName)

	return {
		config,
		filesRegistry,
		planRegistry,
		agentsKnowledge,
		detectedTasks,
		stats,
		gitSummary,
	}
}

/**
 * Scan all files in project (respecting .gitignore patterns)
 */
async function scanProjectFiles(projectRoot: string, maxFiles: number): Promise<string[]> {
	const files: string[] = []
	const ignoreDirs = new Set([
		"node_modules",
		".git",
		"__pycache__",
		".pytest_cache",
		"venv",
		".venv",
		"env",
		"dist",
		"build",
		"target",
		".next",
		".nuxt",
		"coverage",
		".nyc_output",
	])

	async function walk(dir: string, depth = 0): Promise<void> {
		if (depth > 10 || files.length >= maxFiles) return

		try {
			const entries = await fs.readdir(dir, { withFileTypes: true })
			for (const entry of entries) {
				if (files.length >= maxFiles) break

				if (entry.isDirectory()) {
					if (!ignoreDirs.has(entry.name) && !entry.name.startsWith(".")) {
						await walk(path.join(dir, entry.name), depth + 1)
					}
				} else if (entry.isFile()) {
					const relativePath = path.relative(projectRoot, path.join(dir, entry.name))
					files.push(relativePath)
				}
			}
		} catch {
			// Skip unreadable directories
		}
	}

	await walk(projectRoot)
	return files
}

interface CategorizedFiles {
	source: string[]
	tests: string[]
	config: string[]
	docs: string[]
	other: string[]
}

/**
 * Categorize files by type
 */
function categorizeFiles(files: string[], config: ProjectConfig): CategorizedFiles {
	const result: CategorizedFiles = {
		source: [],
		tests: [],
		config: [],
		docs: [],
		other: [],
	}

	const configPatterns = [
		/^\..*rc$/,
		/config\./i,
		/\.config\./,
		/^tsconfig/,
		/^package\.json$/,
		/^pyproject\.toml$/,
		/^setup\.py$/,
		/^Cargo\.toml$/,
		/^go\.mod$/,
		/^Makefile$/,
		/^Dockerfile/,
		/\.ya?ml$/,
	]

	const docPatterns = [/\.md$/i, /\.rst$/i, /\.txt$/i, /^README/i, /^LICENSE/i, /^CHANGELOG/i, /docs?\//i]

	const testPatterns = [
		/test[_/]/i,
		/_test\./,
		/\.test\./,
		/\.spec\./,
		/tests?\//,
		/__tests__/,
		/spec\//,
	]

	for (const file of files) {
		if (testPatterns.some((p) => p.test(file))) {
			result.tests.push(file)
		} else if (configPatterns.some((p) => p.test(file))) {
			result.config.push(file)
		} else if (docPatterns.some((p) => p.test(file))) {
			result.docs.push(file)
		} else if (isSourceFile(file, config.language)) {
			result.source.push(file)
		} else {
			result.other.push(file)
		}
	}

	return result
}

function isSourceFile(file: string, language: ProjectLanguage): boolean {
	const sourceExtensions: Record<ProjectLanguage, string[]> = {
		python: [".py"],
		typescript: [".ts", ".tsx"],
		javascript: [".js", ".jsx", ".mjs", ".cjs"],
		go: [".go"],
		rust: [".rs"],
		java: [".java"],
		csharp: [".cs"],
		ruby: [".rb"],
		php: [".php"],
		generic: [".py", ".ts", ".js", ".go", ".rs", ".java", ".cs", ".rb", ".php"],
	}

	const ext = path.extname(file).toLowerCase()
	return sourceExtensions[language]?.includes(ext) ?? false
}

/**
 * Scan source files for TODO/FIXME comments
 */
async function scanForTasks(projectRoot: string, files: string[]): Promise<DetectedTask[]> {
	const tasks: DetectedTask[] = []
	// Only detect actionable items: TODO, FIXME, HACK, XXX
	// NOTE is informational, not a task
	const taskPattern = /\b(TODO|FIXME|HACK|XXX)\b\s*[:\-]?\s*(.+)$/gim

	for (const file of files) {
		if (!isSourceFile(file, "generic")) continue

		try {
			const content = await fs.readFile(path.join(projectRoot, file), "utf-8")
			const lines = content.split("\n")

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i]
				let match
				while ((match = taskPattern.exec(line)) !== null) {
					const type = match[1].toUpperCase() as DetectedTask["type"]
					tasks.push({
						type,
						text: match[2].trim(),
						file,
						line: i + 1,
						// FIXME/XXX = high, HACK = medium, TODO = low
						priority: type === "FIXME" || type === "XXX" ? "high" : type === "HACK" ? "medium" : "low",
					})
				}
			}
		} catch {
			// Skip unreadable files
		}
	}

	return tasks
}

/**
 * Analyze git history for project insights
 */
async function analyzeGitHistory(projectRoot: string): Promise<BootstrapResult["gitSummary"] | undefined> {
	const { exec } = await import("child_process")
	const { promisify } = await import("util")
	const execAsync = promisify(exec)

	try {
		// Check if git repo exists
		await execAsync("git rev-parse --git-dir", { cwd: projectRoot })

		// Get commit count
		const { stdout: commitCount } = await execAsync("git rev-list --count HEAD", { cwd: projectRoot })

		// Get contributors
		const { stdout: contributors } = await execAsync(
			'git log --format="%aN" | sort | uniq',
			{ cwd: projectRoot }
		)

		// Get last commit date
		const { stdout: lastCommit } = await execAsync(
			'git log -1 --format="%ci"',
			{ cwd: projectRoot }
		)

		// Get active branches
		const { stdout: branches } = await execAsync(
			"git branch -a --format='%(refname:short)'",
			{ cwd: projectRoot }
		)

		return {
			totalCommits: parseInt(commitCount.trim()) || 0,
			contributors: contributors.trim().split("\n").filter(Boolean).slice(0, 10),
			lastCommitDate: lastCommit.trim(),
			activeBranches: branches.trim().split("\n").filter(Boolean).slice(0, 10),
		}
	} catch {
		return undefined
	}
}

/**
 * Calculate file statistics
 */
async function calculateFileStats(
	projectRoot: string,
	categorized: CategorizedFiles
): Promise<BootstrapResult["stats"]> {
	let totalLines = 0

	// Sample line count from source files (first 100 for performance)
	for (const file of categorized.source.slice(0, 100)) {
		try {
			const content = await fs.readFile(path.join(projectRoot, file), "utf-8")
			totalLines += content.split("\n").length
		} catch {
			// Skip
		}
	}

	// Estimate if we sampled
	if (categorized.source.length > 100) {
		totalLines = Math.round((totalLines / 100) * categorized.source.length)
	}

	return {
		totalFiles: categorized.source.length + categorized.tests.length + categorized.config.length + categorized.docs.length + categorized.other.length,
		sourceFiles: categorized.source.length,
		testFiles: categorized.tests.length,
		configFiles: categorized.config.length,
		totalLines,
	}
}

/**
 * Generate FILES.md content
 */
function generateFilesRegistry(
	categorized: CategorizedFiles,
	ownerAgentId: string,
	projectName: string
): string {
	const today = new Date().toISOString().split("T")[0]

	let content = `# File Ownership Registry - ${projectName}

> **Generated**: ${today}
> **Rule**: Only the owning agent may modify a file. Request handoff for exceptions.

## Ownership Map

| Path | Owner | Category | Last Modified |
|------|-------|----------|---------------|
`

	// Add source files
	for (const file of categorized.source.slice(0, 50)) {
		content += `| ${file} | ${ownerAgentId} | source | ${today} |\n`
	}

	if (categorized.source.length > 50) {
		content += `| ... and ${categorized.source.length - 50} more source files | ${ownerAgentId} | source | - |\n`
	}

	// Add test files
	for (const file of categorized.tests.slice(0, 20)) {
		content += `| ${file} | ${ownerAgentId} | test | ${today} |\n`
	}

	if (categorized.tests.length > 20) {
		content += `| ... and ${categorized.tests.length - 20} more test files | ${ownerAgentId} | test | - |\n`
	}

	content += `
## Shared Files (Multi-Owner)

| Path | Owners | Coordination Rule |
|------|--------|-------------------|
`

	for (const file of categorized.config.slice(0, 10)) {
		content += `| ${file} | ALL | Notify others after change |\n`
	}

	content += `
## Directory Ownership

| Directory | Owner | Purpose |
|-----------|-------|---------|
| src/ | ${ownerAgentId} | Main source code |
| tests/ | ${ownerAgentId} | Test files |
| docs/ | ${ownerAgentId} | Documentation |

## Pending Handoffs

| Path | From | To | Reason | Status |
|------|------|-----|--------|--------|
| (none) | - | - | - | - |
`

	return content
}

/**
 * Generate PLAN.md content
 */
function generatePlanRegistry(
	detectedTasks: DetectedTask[],
	projectName: string,
	config: ProjectConfig
): string {
	const today = new Date().toISOString().split("T")[0]
	const prefix = projectName.slice(0, 3).toUpperCase()

	let content = `# Project Plan - ${projectName}

> **Generated**: ${today}
> **Language**: ${config.language}${config.framework ? ` (${config.framework})` : ""}
> **Task Prefix**: ${prefix}

## Active Tasks

| Task ID | Status | Owner | Description | Priority |
|---------|--------|-------|-------------|----------|
`

	// Add detected TODO/FIXME as planned tasks
	const highPriority = detectedTasks.filter((t) => t.priority === "high")
	const mediumPriority = detectedTasks.filter((t) => t.priority === "medium")
	const lowPriority = detectedTasks.filter((t) => t.priority === "low")

	let taskNum = 1

	// High priority first (FIXME, XXX)
	for (const task of highPriority.slice(0, 10)) {
		const id = `T-${prefix}-${String(taskNum++).padStart(3, "0")}`
		content += `| ${id} | planned | - | ${task.type}: ${task.text.slice(0, 50)}${task.text.length > 50 ? "..." : ""} | high |\n`
	}

	// Medium priority (HACK)
	for (const task of mediumPriority.slice(0, 5)) {
		const id = `T-${prefix}-${String(taskNum++).padStart(3, "0")}`
		content += `| ${id} | planned | - | ${task.type}: ${task.text.slice(0, 50)}${task.text.length > 50 ? "..." : ""} | medium |\n`
	}

	// Low priority (TODO, NOTE)
	for (const task of lowPriority.slice(0, 10)) {
		const id = `T-${prefix}-${String(taskNum++).padStart(3, "0")}`
		content += `| ${id} | planned | - | ${task.type}: ${task.text.slice(0, 50)}${task.text.length > 50 ? "..." : ""} | low |\n`
	}

	if (detectedTasks.length === 0) {
		content += `| T-${prefix}-001 | planned | - | (Add your first task here) | medium |\n`
	}

	content += `
## Detected Code Comments

Found **${detectedTasks.length}** TODO/FIXME/HACK comments in the codebase.

### By Type
- FIXME: ${detectedTasks.filter((t) => t.type === "FIXME").length}
- TODO: ${detectedTasks.filter((t) => t.type === "TODO").length}
- HACK: ${detectedTasks.filter((t) => t.type === "HACK").length}
- XXX: ${detectedTasks.filter((t) => t.type === "XXX").length}
- NOTE: ${detectedTasks.filter((t) => t.type === "NOTE").length}

### All Detected (First 30)

| Type | File | Line | Text |
|------|------|------|------|
`

	for (const task of detectedTasks.slice(0, 30)) {
		content += `| ${task.type} | ${task.file} | L${task.line} | ${task.text.slice(0, 60)}${task.text.length > 60 ? "..." : ""} |\n`
	}

	if (detectedTasks.length > 30) {
		content += `\n*... and ${detectedTasks.length - 30} more*\n`
	}

	content += `
## Task States

- **planned**: Created but not assigned
- **delegated**: Assigned to an agent
- **in_progress**: Agent actively working
- **blocked**: Waiting for something
- **review**: Work complete, awaiting verification
- **done**: Accepted
- **verified**: Independently verified
`

	return content
}

/**
 * Generate AGENTS.md content for project knowledge
 */
function generateAgentsKnowledge(
	config: ProjectConfig,
	stats: BootstrapResult["stats"],
	gitSummary: BootstrapResult["gitSummary"] | undefined,
	projectName: string
): string {
	const today = new Date().toISOString().split("T")[0]

	let content = `# ${projectName} - Agent Knowledge Base

> **Bootstrapped**: ${today}
> **Status**: Active

---

## 📋 HOW TO USE THIS INDEX

1. Read this file FIRST to understand the project
2. Check PLAN.md for current tasks
3. Check FILES.md before modifying files
4. Update this file with learnings and decisions

---

## 🏗️ Project Overview

| Aspect | Value |
|--------|-------|
| **Language** | ${config.language} |
| **Framework** | ${config.framework ?? "None detected"} |
| **Package Manager** | ${config.packageManager ?? "Unknown"} |
| **Source Files** | ${stats.sourceFiles} |
| **Test Files** | ${stats.testFiles} |
| **Est. Lines of Code** | ~${stats.totalLines.toLocaleString()} |
`

	if (gitSummary) {
		content += `
## 📜 Git History

| Metric | Value |
|--------|-------|
| **Total Commits** | ${gitSummary.totalCommits} |
| **Contributors** | ${gitSummary.contributors.length} |
| **Last Commit** | ${gitSummary.lastCommitDate} |
| **Active Branches** | ${gitSummary.activeBranches.length} |

### Contributors
${gitSummary.contributors.map((c) => `- ${c}`).join("\n")}
`
	}

	content += `
## 🔧 Validation Commands

\`\`\`bash
# Type checking
${config.validation.typeCheck ?? "# (not configured)"}

# Run tests
${config.validation.test ?? "# (not configured)"}

# Lint
${config.validation.lint ?? "# (not configured)"}
\`\`\`

---

## 🎯 Current State

- **Status**: Bootstrapped - needs review
- **Last Task**: Initial project analysis
- **Working On**: Familiarizing with codebase
- **Blocked By**: None

---

## 📚 Knowledge Files Index

| File | Contains | When to Read |
|------|----------|--------------|
| PLAN.md | Task registry | When planning work |
| FILES.md | File ownership | Before modifying files |
| KNOWLEDGE.md | Project-specific tips | When needing context |

---

## 🔄 Key Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| ${today} | Bootstrapped project | Onboarding existing codebase |

---

## 📝 Notes

### First Steps

1. Review the detected TODOs in PLAN.md
2. Verify file ownership in FILES.md is correct
3. Run the validation commands to check project health
4. Identify priority improvements

### Architecture Notes

*(Add notes about the codebase architecture as you learn it)*

---

*This file was auto-generated by Society Agent bootstrap. Update it as you learn about the project.*
`

	return content
}

/**
 * Write bootstrap files to disk
 */
export async function writeBootstrapFiles(
	projectRoot: string,
	result: BootstrapResult,
	options: { overwrite?: boolean } = {}
): Promise<{ written: string[]; skipped: string[] }> {
	const written: string[] = []
	const skipped: string[] = []

	const files = [
		{ name: "FILES.md", content: result.filesRegistry },
		{ name: "PLAN.md", content: result.planRegistry },
		{ name: "AGENTS.md", content: result.agentsKnowledge },
	]

	for (const file of files) {
		const filePath = path.join(projectRoot, file.name)
		const exists = await fs.access(filePath).then(() => true).catch(() => false)

		if (exists && !options.overwrite) {
			skipped.push(file.name)
		} else {
			await fs.writeFile(filePath, file.content, "utf-8")
			written.push(file.name)
		}
	}

	// Also write .society.json if it doesn't exist
	const configPath = path.join(projectRoot, ".society.json")
	const configExists = await fs.access(configPath).then(() => true).catch(() => false)

	if (!configExists) {
		const template = generateConfigTemplate(result.config)
		await fs.writeFile(configPath, JSON.stringify(template, null, 2), "utf-8")
		written.push(".society.json")
	} else {
		skipped.push(".society.json")
	}

	return { written, skipped }
}

/**
 * Get human-readable summary of project config
 */
export function summarizeConfig(config: ProjectConfig): string {
	const lines: string[] = [
		`Language: ${config.language}${config.framework ? ` (${config.framework})` : ""}`,
		`Confidence: ${(config.confidence * 100).toFixed(0)}%`,
		`Package Manager: ${config.packageManager ?? "unknown"}`,
		"",
		"Validation Commands:",
	]

	for (const [key, cmd] of Object.entries(config.validation)) {
		if (cmd) {
			lines.push(`  ${key}: ${cmd}`)
		}
	}

	return lines.join("\n")
}

/**
 * Generate project-specific prompt section for agents
 * This gets injected into agent system prompts automatically
 */
export function generateProjectPromptSection(config: ProjectConfig): string {
	const sections: string[] = []

	// Language and framework context
	sections.push(`## Project Technology Stack`)
	sections.push(`- **Language**: ${config.language}${config.framework ? ` with ${config.framework}` : ""}`)
	if (config.secondaryLanguages?.length) {
		sections.push(`- **Also uses**: ${config.secondaryLanguages.join(", ")}`)
	}
	if (config.packageManager) {
		sections.push(`- **Package Manager**: ${config.packageManager}`)
	}
	sections.push("")

	// Validation commands - what to run
	sections.push(`## Validation Commands`)
	sections.push(`Run these commands to verify your work:`)
	sections.push("```bash")
	
	if (config.validation.typeCheck) {
		sections.push(`# Type checking`)
		sections.push(config.validation.typeCheck)
	}
	if (config.validation.test) {
		sections.push(`# Run tests`)
		sections.push(config.validation.test)
	}
	if (config.validation.lint) {
		sections.push(`# Linting`)
		sections.push(config.validation.lint)
	}
	if (config.validation.formatCheck) {
		sections.push(`# Format check`)
		sections.push(config.validation.formatCheck)
	}
	sections.push("```")
	sections.push("")

	// Before marking task complete
	sections.push(`## Before Reporting Task Complete`)
	sections.push(`1. **Commit your changes** with task ID in message`)
	sections.push(`2. **Run validation**:`)
	
	const checks: string[] = []
	if (config.validation.typeCheck) checks.push(`Type check: \`${config.validation.typeCheck}\``)
	if (config.validation.test) checks.push(`Tests: \`${config.validation.test}\``)
	if (config.validation.lint) checks.push(`Lint: \`${config.validation.lint}\``)
	
	checks.forEach((check, i) => sections.push(`   ${i + 1}. ${check}`))
	
	sections.push(`3. **Update FILES.md** with any new/modified files`)
	sections.push(`4. **Report** with commit hash and files changed`)
	sections.push("")

	// Language-specific tips
	const tips = getLanguageTips(config.language)
	if (tips) {
		sections.push(`## ${config.language.charAt(0).toUpperCase() + config.language.slice(1)} Tips`)
		sections.push(tips)
	}

	return sections.join("\n")
}

/**
 * Get language-specific tips for agents
 */
function getLanguageTips(language: ProjectLanguage): string | null {
	const tips: Partial<Record<ProjectLanguage, string>> = {
		python: `- Use type hints for function signatures
- Prefer \`pathlib.Path\` over string paths
- Use \`async/await\` for I/O operations when appropriate
- Run \`pip install -e .\` for editable installs during development
- Use virtual environments: \`python -m venv .venv && source .venv/bin/activate\``,

		typescript: `- Use strict TypeScript (\`strict: true\` in tsconfig.json)
- Prefer \`interface\` over \`type\` for object shapes
- Use \`readonly\` for immutable properties
- Avoid \`any\` - use \`unknown\` if type is truly unknown
- Use barrel exports (\`index.ts\`) for cleaner imports`,

		go: `- Follow Go naming conventions (exported = uppercase)
- Handle errors explicitly, don't ignore them
- Use \`context.Context\` for cancellation
- Prefer composition over inheritance
- Run \`go mod tidy\` after adding dependencies`,

		rust: `- Use \`Result<T, E>\` for fallible operations
- Prefer \`&str\` over \`String\` in function parameters
- Use \`clippy\` suggestions seriously
- Derive common traits: \`Debug, Clone, PartialEq\`
- Use \`cargo fmt\` before committing`,

		java: `- Follow Java naming conventions (camelCase methods, PascalCase classes)
- Use dependency injection where appropriate
- Prefer interfaces over concrete types
- Handle checked exceptions properly
- Use \`Optional<T>\` instead of null`,
	}

	return tips[language] ?? null
}

/**
 * Generate a complete agent prompt with project context injected
 */
export function injectProjectContext(basePrompt: string, config: ProjectConfig): string {
	const projectSection = generateProjectPromptSection(config)
	
	// Insert project context after the first paragraph or "---" separator
	const separatorIndex = basePrompt.indexOf("---")
	if (separatorIndex > 0) {
		return basePrompt.slice(0, separatorIndex) + "\n" + projectSection + "\n---" + basePrompt.slice(separatorIndex + 3)
	}
	
	// Otherwise append at the end
	return basePrompt + "\n\n" + projectSection
}

/**
 * Get the validation checklist for task completion based on project config
 */
export function getTaskCompletionChecklist(config: ProjectConfig): string[] {
	const checklist: string[] = [
		"Commit exists with task ID in message",
		"Files registered in FILES.md",
	]

	if (config.validation.typeCheck) {
		checklist.push(`Type check passes: ${config.validation.typeCheck}`)
	}
	if (config.validation.test) {
		checklist.push(`Tests pass: ${config.validation.test}`)
	}
	if (config.validation.lint) {
		checklist.push(`Lint clean: ${config.validation.lint}`)
	}

	return checklist
}

// ============================================================================
// SUB-FOLDER BOOTSTRAP & SYNC FUNCTIONS
// ============================================================================

/**
 * Parsed entry from FILES.md
 */
interface FilesEntry {
	path: string
	owner: string
	description?: string
	status?: "active" | "removed" | "moved"
}

/**
 * Parsed task from PLAN.md
 */
interface PlanEntry {
	id: string
	title: string
	status: string
	assignee?: string
	source?: string // file:line for detected tasks
	originalLine: string // preserve original markdown format
}

/**
 * Result of syncing bootstrap files
 */
export interface SyncResult {
	filesAdded: string[]
	filesRemoved: string[]
	filesUnchanged: number
	tasksAdded: DetectedTask[]
	tasksRemoved: string[] // task IDs no longer in code
	tasksMoved: number // completed tasks moved from Active to Done
	conflicts: Array<{
		type: "file" | "task"
		path: string
		reason: string
	}>
}

/**
 * Bootstrap just a specific subfolder (useful for agent folders)
 * 
 * This creates FILES.md, PLAN.md, AGENTS.md within the subfolder
 * with paths relative to that folder.
 * 
 * @param projectRoot - Root of the main project (for inheriting config)
 * @param subFolder - Relative path to the subfolder to bootstrap
 */
export async function bootstrapSubFolder(
	projectRoot: string,
	subFolder: string,
	options: {
		ownerAgentId?: string
		projectName?: string
		scanTasks?: boolean
		maxFiles?: number
		/** If true, also inherit validation commands from parent project */
		inheritParentConfig?: boolean
	} = {}
): Promise<BootstrapResult> {
	const {
		ownerAgentId,
		projectName = path.basename(subFolder),
		scanTasks = true,
		maxFiles = 500,
		inheritParentConfig = true,
	} = options

	const fullPath = path.isAbsolute(subFolder) 
		? subFolder 
		: path.join(projectRoot, subFolder)

	getLog().info(`[Bootstrap] Bootstrapping subfolder: ${subFolder}`)

	// Get parent config for validation commands
	let parentConfig: ProjectConfig | undefined
	if (inheritParentConfig) {
		parentConfig = await loadProjectConfig(projectRoot)
	}

	// Detect language within the subfolder
	let config = await detectProjectLanguage(fullPath)
	
	// Inherit validation commands from parent if subfolder detection is generic
	if (parentConfig && config.language === "generic") {
		config = {
			...config,
			language: parentConfig.language,
			validation: parentConfig.validation,
			packageManager: parentConfig.packageManager,
		}
	}

	// Scan files within subfolder only
	const fileList = await scanProjectFiles(fullPath, maxFiles)
	
	// Make paths relative to subfolder for the registry
	const relativeFiles = fileList.map(f => path.relative(fullPath, f))

	getLog().info(`[Bootstrap] Found ${relativeFiles.length} files in subfolder`)

	// Categorize files
	const categorized = categorizeFiles(relativeFiles.map(f => path.join(fullPath, f)), config)
	
	// Convert back to relative paths
	for (const key of Object.keys(categorized) as Array<keyof typeof categorized>) {
		categorized[key] = categorized[key].map(f => path.relative(fullPath, f))
	}

	// Detect TODOs
	let detectedTasks: DetectedTask[] = []
	if (scanTasks) {
		detectedTasks = await scanForTasks(
			fullPath, 
			relativeFiles.map(f => path.join(fullPath, f))
		)
		// Make task paths relative
		detectedTasks = detectedTasks.map(t => ({
			...t,
			file: path.relative(fullPath, t.file),
		}))
	}

	// Calculate stats
	const stats = await calculateFileStats(fullPath, {
		source: categorized.source.map(f => path.join(fullPath, f)),
		tests: categorized.tests.map(f => path.join(fullPath, f)),
		config: categorized.config.map(f => path.join(fullPath, f)),
		docs: categorized.docs.map(f => path.join(fullPath, f)),
		other: categorized.other.map(f => path.join(fullPath, f)),
	})

	// Derive owner from folder name if not provided
	const effectiveOwner = ownerAgentId ?? path.basename(subFolder)

	// Generate registries
	const filesRegistry = generateFilesRegistry(categorized, effectiveOwner, projectName)
	const planRegistry = generatePlanRegistry(detectedTasks, projectName, config)
	const agentsKnowledge = generateAgentsKnowledge(config, stats, undefined, projectName)

	return {
		config,
		filesRegistry,
		planRegistry,
		agentsKnowledge,
		detectedTasks,
		stats,
		gitSummary: undefined, // Subfolder doesn't have its own git history
	}
}

/**
 * Sync existing FILES.md and PLAN.md with current filesystem state
 * 
 * This is for when files have been added/removed outside Society Agent
 * (e.g., manual edits, other tools, or desync issues).
 * 
 * @param targetPath - Path to folder containing FILES.md/PLAN.md
 * @param options - Sync options
 */
export async function syncBootstrapFiles(
	targetPath: string,
	options: {
		/** How to handle new files */
		newFileOwner?: string
		/** Whether to scan for new TODOs in new files only */
		scanNewTasks?: boolean
		/** Scan ALL files for tasks (not just new files) */
		scanAllTasks?: boolean
		/** Pre-detected tasks to add (skips scanning) */
		tasksToAdd?: DetectedTask[]
		/** Mark removed files as 'removed' instead of deleting entries */
		preserveRemovedFiles?: boolean
		/** Don't modify existing entries, only add new ones */
		addOnly?: boolean
		/** Max files to scan */
		maxFiles?: number
	} = {}
): Promise<SyncResult> {
	const {
		newFileOwner = "unassigned",
		scanNewTasks = true,
		scanAllTasks = false,
		tasksToAdd,
		preserveRemovedFiles = true,
		addOnly = false,
		maxFiles = 1000,
	} = options

	const result: SyncResult = {
		filesAdded: [],
		filesRemoved: [],
		filesUnchanged: 0,
		tasksAdded: [],
		tasksRemoved: [],
		tasksMoved: 0,
		conflicts: [],
	}

	getLog().info(`[Sync] Starting sync for: ${targetPath}`)

	// 1. Read existing FILES.md
	const filesPath = path.join(targetPath, "FILES.md")
	const existingFiles = await parseFilesRegistry(filesPath)
	getLog().info(`[Sync] Parsed ${existingFiles.length} entries from existing FILES.md`)

	// 2. Scan current filesystem
	const currentFiles = await scanProjectFiles(targetPath, maxFiles)
	const currentFilesRelative = new Set(currentFiles.map(f => path.relative(targetPath, f)))
	getLog().info(`[Sync] Found ${currentFilesRelative.size} files on disk`)

	// 3. Build sets for comparison
	const existingPaths = new Set(existingFiles.map(e => e.path))

	// 4. Find new files (in filesystem but not in FILES.md)
	const newFiles: string[] = []
	for (const file of currentFilesRelative) {
		if (!existingPaths.has(file)) {
			newFiles.push(file)
			result.filesAdded.push(file)
		}
	}
	getLog().info(`[Sync] Found ${newFiles.length} new files`)

	// 5. Find removed files (in FILES.md but not in filesystem)
	const removedFiles: FilesEntry[] = []
	for (const entry of existingFiles) {
		if (!currentFilesRelative.has(entry.path) && entry.status !== "removed") {
			removedFiles.push(entry)
			result.filesRemoved.push(entry.path)
		}
	}
	getLog().info(`[Sync] Found ${removedFiles.length} removed files`)

	// 6. Count unchanged
	result.filesUnchanged = existingFiles.length - removedFiles.length

	// 7. Scan for tasks
	if (tasksToAdd && tasksToAdd.length > 0) {
		// Use pre-detected tasks
		result.tasksAdded = tasksToAdd
		getLog().info(`[Sync] Adding ${result.tasksAdded.length} pre-detected tasks`)
	} else if (scanAllTasks) {
		// Scan ALL files for tasks
		const allFilePaths = currentFiles
		const allTasks = await scanForTasks(targetPath, allFilePaths)
		result.tasksAdded = allTasks.map(t => ({
			...t,
			file: path.relative(targetPath, t.file),
		}))
		getLog().info(`[Sync] Found ${result.tasksAdded.length} tasks in all files`)
	} else if (scanNewTasks && newFiles.length > 0) {
		// Scan only new files
		const newFilePaths = newFiles.map(f => path.join(targetPath, f))
		const newTasks = await scanForTasks(targetPath, newFilePaths)
		result.tasksAdded = newTasks.map(t => ({
			...t,
			file: path.relative(targetPath, t.file),
		}))
		getLog().info(`[Sync] Found ${result.tasksAdded.length} new tasks in new files`)
	}

	// 8. Generate updated FILES.md
	const updatedFilesContent = generateSyncedFilesRegistry(
		existingFiles,
		newFiles,
		removedFiles,
		newFileOwner,
		preserveRemovedFiles,
		addOnly
	)

	// 9. Reorganize PLAN.md (move completed tasks from Active to Done)
	const planPath = path.join(targetPath, "PLAN.md")
	const { content: reorganizedPlan, movedCount } = await reorganizePlanTasks(planPath)
	result.tasksMoved = movedCount

	// 10. Generate updated PLAN.md (append new tasks to reorganized content)
	const updatedPlanContent = await generateSyncedPlanRegistry(
		planPath,
		result.tasksAdded,
		reorganizedPlan
	)

	// 11. Write updated files
	await fs.writeFile(filesPath, updatedFilesContent, "utf-8")
	getLog().info(`[Sync] Updated FILES.md`)

	const planChanged = result.tasksAdded.length > 0 || movedCount > 0
	if (planChanged) {
		await fs.writeFile(planPath, updatedPlanContent, "utf-8")
		getLog().info(`[Sync] Updated PLAN.md: ${movedCount} tasks moved to Done, ${result.tasksAdded.length} new tasks`)
	}

	return result
}

/**
 * Parse existing FILES.md into structured entries
 */
async function parseFilesRegistry(filesPath: string): Promise<FilesEntry[]> {
	const entries: FilesEntry[] = []

	try {
		const content = await fs.readFile(filesPath, "utf-8")
		const lines = content.split("\n")

		// Look for table rows: | path | owner | description |
		const tableRowRegex = /^\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]*)\s*\|/
		
		for (const line of lines) {
			const match = line.match(tableRowRegex)
			if (match) {
				const [, pathCell, ownerCell, descCell] = match
				const filePath = pathCell.trim()
				
				// Skip header row and separator
				if (filePath === "File" || filePath.startsWith("-")) continue
				
				entries.push({
					path: filePath,
					owner: ownerCell.trim(),
					description: descCell.trim() || undefined,
					status: line.includes("[removed]") ? "removed" : "active",
				})
			}
		}
	} catch (err) {
		// FILES.md doesn't exist yet
		getLog().debug(`[Sync] No existing FILES.md found at ${filesPath}`)
	}

	return entries
}

/**
 * Generate synced FILES.md content
 */
function generateSyncedFilesRegistry(
	existingEntries: FilesEntry[],
	newFiles: string[],
	removedFiles: FilesEntry[],
	newFileOwner: string,
	preserveRemovedFiles: boolean,
	addOnly: boolean
): string {
	const lines: string[] = [
		"# FILES.md - File Ownership Registry",
		"",
		"*Auto-synced with filesystem. Last sync: " + new Date().toISOString() + "*",
		"",
		"| File | Owner | Description |",
		"|------|-------|-------------|",
	]

	// Add existing entries (possibly marking removed ones)
	for (const entry of existingEntries) {
		const isRemoved = removedFiles.some(r => r.path === entry.path)
		
		if (isRemoved && !addOnly) {
			if (preserveRemovedFiles) {
				lines.push(`| ${entry.path} | ${entry.owner} | [removed] ${entry.description ?? ""} |`)
			}
			// else: skip entirely
		} else {
			lines.push(`| ${entry.path} | ${entry.owner} | ${entry.description ?? ""} |`)
		}
	}

	// Add new files
	if (newFiles.length > 0) {
		lines.push("", "<!-- New files detected -->")
		for (const file of newFiles.sort()) {
			const desc = inferFileDescription(file)
			lines.push(`| ${file} | ${newFileOwner} | ${desc} |`)
		}
	}

	return lines.join("\n")
}

/**
 * Infer a description for a file based on its name/path
 */
function inferFileDescription(filePath: string): string {
	const fileName = path.basename(filePath)
	const ext = path.extname(fileName)
	const nameWithoutExt = path.basename(fileName, ext)

	// Common patterns
	if (fileName.startsWith("test") || fileName.includes(".test.") || fileName.includes("_test.")) {
		return "Test file"
	}
	if (fileName.includes(".spec.")) {
		return "Spec file"
	}
	if (fileName === "index.ts" || fileName === "index.js") {
		return "Module entry point"
	}
	if (fileName === "README.md") {
		return "Documentation"
	}
	if (filePath.includes("/types") || nameWithoutExt === "types") {
		return "Type definitions"
	}
	if (filePath.includes("/utils") || nameWithoutExt === "utils") {
		return "Utility functions"
	}
	if (filePath.includes("/config") || nameWithoutExt.includes("config")) {
		return "Configuration"
	}
	if (filePath.includes("/components/")) {
		return "UI Component"
	}
	if (filePath.includes("/hooks/")) {
		return "React hook"
	}
	if (filePath.includes("/api/") || filePath.includes("/routes/")) {
		return "API endpoint"
	}

	// Default: use camelCase/kebab-case name as description
	return nameWithoutExt.replace(/[-_]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2")
}

/**
 * Reorganize PLAN.md by moving completed tasks from Active to Done section
 * 
 * Handles both formats:
 * - Checklist: `- [x] Task description` (completed) vs `- [ ] Task` (pending)
 * - Table: rows with status column
 */
async function reorganizePlanTasks(planPath: string): Promise<{ content: string; movedCount: number }> {
	let content: string
	try {
		content = await fs.readFile(planPath, "utf-8")
	} catch {
		// No PLAN.md exists
		return { content: "", movedCount: 0 }
	}

	const lines = content.split("\n")
	let movedCount = 0
	
	// Find section boundaries
	let activeStart = -1
	let activeEnd = -1
	let doneStart = -1
	let doneEnd = -1
	
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].toLowerCase().trim()
		if (line.startsWith("## active") || line === "## active tasks") {
			activeStart = i
		} else if (line.startsWith("## done") || line === "## done tasks" || line.startsWith("## completed")) {
			if (activeStart >= 0 && activeEnd < 0) {
				activeEnd = i
			}
			doneStart = i
		} else if (line.startsWith("## ") && doneStart >= 0 && doneEnd < 0) {
			doneEnd = i
		}
	}
	
	// Set end boundaries if not found
	if (activeStart >= 0 && activeEnd < 0) {
		activeEnd = doneStart >= 0 ? doneStart : lines.length
	}
	if (doneStart >= 0 && doneEnd < 0) {
		doneEnd = lines.length
	}
	
	if (activeStart < 0) {
		// No Active section found
		return { content, movedCount: 0 }
	}
	
	// Extract completed tasks from Active section
	const completedTasks: string[] = []
	const remainingActiveLines: string[] = []
	
	for (let i = activeStart + 1; i < activeEnd; i++) {
		const line = lines[i]
		const trimmed = line.trim()
		
		// Check for completed checklist item: - [x] or * [x]
		if (/^[-*]\s*\[x\]/i.test(trimmed)) {
			completedTasks.push(line)
			movedCount++
		} else {
			remainingActiveLines.push(line)
		}
	}
	
	if (movedCount === 0) {
		return { content, movedCount: 0 }
	}
	
	// Check if Active section would be empty (only whitespace/placeholders left)
	const hasRemainingTasks = remainingActiveLines.some(l => {
		const t = l.trim()
		return t.length > 0 && 
			!t.startsWith("*No ") && 
			!t.startsWith("|") && 
			!t.startsWith("-") ||
			/^[-*]\s*\[[ ]\]/.test(t) // uncompleted checkbox
	})
	
	// Build new content
	const newLines: string[] = []
	
	// Add everything before Active section
	for (let i = 0; i <= activeStart; i++) {
		newLines.push(lines[i])
	}
	
	// Add remaining active tasks (or placeholder if empty)
	if (hasRemainingTasks) {
		newLines.push(...remainingActiveLines)
	} else {
		newLines.push("")
		newLines.push("*No active tasks*")
		newLines.push("")
	}
	
	// Add Done section header if it doesn't exist
	if (doneStart < 0) {
		newLines.push("")
		newLines.push("## Done Tasks")
		newLines.push("")
	} else {
		// Add any lines between Active and Done sections (excluding those already in Active)
		for (let i = activeEnd; i <= doneStart; i++) {
			newLines.push(lines[i])
		}
	}
	
	// Add moved tasks at the top of Done section
	newLines.push(...completedTasks)
	
	// Add existing Done section content (if it existed)
	if (doneStart >= 0) {
		for (let i = doneStart + 1; i < doneEnd; i++) {
			newLines.push(lines[i])
		}
	}
	
	// Add anything after Done section
	if (doneEnd < lines.length) {
		for (let i = doneEnd; i < lines.length; i++) {
			newLines.push(lines[i])
		}
	}
	
	getLog().info(`[Sync] Moved ${movedCount} completed tasks from Active to Done`)
	
	return { 
		content: newLines.join("\n"), 
		movedCount 
	}
}

/**
 * Generate synced PLAN.md content (appends new tasks)
 * Detects format (checklist vs table) and matches it
 */
async function generateSyncedPlanRegistry(
	planPath: string,
	newTasks: DetectedTask[],
	preReorganizedContent?: string
): Promise<string> {
	let existingContent = ""
	
	if (preReorganizedContent) {
		existingContent = preReorganizedContent
	} else {
		try {
			existingContent = await fs.readFile(planPath, "utf-8")
		} catch {
			// Start fresh
			existingContent = `# PLAN.md - Task Registry

## Active Tasks

| ID | Task | Status | Assignee |
|----|------|--------|----------|
`
		}
	}

	if (newTasks.length === 0) {
		return existingContent
	}

	// Deduplicate: filter out tasks whose file:line already appears in PLAN.md
	const filteredTasks = newTasks.filter(task => {
		const fileLineRef = `${task.file}:${task.line}`
		return !existingContent.includes(fileLineRef)
	})

	if (filteredTasks.length === 0) {
		getLog().info(`[Sync] All ${newTasks.length} tasks already exist in PLAN.md, skipping`)
		return existingContent
	}

	getLog().info(`[Sync] Adding ${filteredTasks.length} new tasks (${newTasks.length - filteredTasks.length} duplicates skipped)`)

	// Detect format: checklist (- [ ]) vs table (| ... |)
	const hasChecklist = /^[-*]\s*\[[ x]\]/m.test(existingContent)
	const hasTable = /^\|.*\|.*\|/m.test(existingContent)
	const useChecklist = hasChecklist && !hasTable
	
	// Generate task lines in the appropriate format
	const newTaskLines: string[] = []
	
	if (useChecklist) {
		// Checklist format: - [ ] TYPE: description (file:line)
		for (const task of filteredTasks) {
			const priority = task.priority === "high" ? "🔴 " : task.priority === "medium" ? "🟡 " : ""
			newTaskLines.push(
				`- [ ] ${priority}${task.type}: ${task.text.slice(0, 80)}${task.text.length > 80 ? "..." : ""} *(${task.file}:${task.line})*`
			)
		}
	} else {
		// Table format with task IDs
		const idMatches = existingContent.matchAll(/T-SYNC-(\d+)/g)
		let maxId = 0
		for (const match of idMatches) {
			const num = parseInt(match[1], 10)
			if (num > maxId) maxId = num
		}
		
		for (const task of filteredTasks) {
			maxId++
			const taskId = `T-SYNC-${String(maxId).padStart(3, "0")}`
			const priority = task.priority === "high" ? "🔴" : task.priority === "medium" ? "🟡" : "⚪"
			newTaskLines.push(
				`| ${taskId} | ${priority} ${task.type}: ${task.text.slice(0, 60)}${task.text.length > 60 ? "..." : ""} | pending | unassigned | *${task.file}:${task.line}* |`
			)
		}
	}

	// Find where to insert: after "## Active Tasks" section header, before "## Done" or "## Completed"
	const lines = existingContent.split("\n")
	let insertIndex = -1
	let activeSectionEnd = -1
	
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].toLowerCase().trim()
		if (line.startsWith("## active")) {
			// Find the end of Active section (next ## or end of file)
			for (let j = i + 1; j < lines.length; j++) {
				if (lines[j].trim().startsWith("## ")) {
					activeSectionEnd = j
					break
				}
			}
			if (activeSectionEnd < 0) activeSectionEnd = lines.length
			
			// Insert before the Done/Completed section, but within Active
			insertIndex = activeSectionEnd
			break
		}
	}

	if (insertIndex < 0) {
		// No Active section found, append at end
		return existingContent + "\n\n<!-- Detected tasks -->\n" + newTaskLines.join("\n")
	}

	// Insert tasks before the end of Active section
	const taskComment = `<!-- Detected TODO/FIXME - ${new Date().toISOString().split("T")[0]} -->`
	const result = [
		...lines.slice(0, insertIndex),
		"",
		taskComment,
		...newTaskLines,
		"",
		...lines.slice(insertIndex),
	]

	return result.join("\n")
}

/**
 * Quick check if bootstrap files exist in a folder
 */
export async function hasBootstrapFiles(targetPath: string): Promise<{
	hasFiles: boolean
	hasPlan: boolean
	hasAgents: boolean
	hasConfig: boolean
}> {
	const check = async (name: string) => {
		try {
			await fs.access(path.join(targetPath, name))
			return true
		} catch {
			return false
		}
	}

	return {
		hasFiles: await check("FILES.md"),
		hasPlan: await check("PLAN.md"),
		hasAgents: await check("AGENTS.md"),
		hasConfig: await check(".society.json"),
	}
}

/**
 * Smart bootstrap: full bootstrap if no files exist, sync if they do
 */
export async function smartBootstrap(
	targetPath: string,
	options: {
		ownerAgentId?: string
		projectName?: string
		scanTasks?: boolean
		maxFiles?: number
		/** Force full bootstrap even if files exist */
		force?: boolean
	} = {}
): Promise<{ mode: "bootstrap" | "sync"; result: BootstrapResult | SyncResult }> {
	const existing = await hasBootstrapFiles(targetPath)
	
	if (options.force || (!existing.hasFiles && !existing.hasPlan)) {
		// Full bootstrap
		getLog().info(`[SmartBootstrap] No existing files, doing full bootstrap`)
		const result = await bootstrapExistingProject(targetPath, options)
		await writeBootstrapFiles(targetPath, result, { overwrite: options.force })
		return { mode: "bootstrap", result }
	} else {
		// Sync mode
		getLog().info(`[SmartBootstrap] Existing files found, syncing`)
		const result = await syncBootstrapFiles(targetPath, {
			newFileOwner: options.ownerAgentId ?? "unassigned",
			scanNewTasks: options.scanTasks ?? true,
			maxFiles: options.maxFiles,
		})
		return { mode: "sync", result }
	}
}
