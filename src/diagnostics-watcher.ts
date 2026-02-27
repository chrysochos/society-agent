/**
 * Society Agent - Diagnostics Watcher
 * Runs tsc, ruff, and pyright as background watchers per project folder.
 * Parses their output and maintains an in-memory diagnostics store.
 */

import { spawn, ChildProcess } from "child_process"
import * as fs from "fs"
import * as path from "path"
import { EventEmitter } from "events"

export interface Diagnostic {
	tool: "tsc" | "ruff" | "pyright"
	file: string
	line: number
	column: number
	endLine?: number
	endColumn?: number
	severity: "error" | "warning" | "info"
	code: string
	message: string
	timestamp: number
}

interface WatcherProcess {
	proc: ChildProcess
	tool: string
	folder: string
	restartCount: number
	restartTimer?: NodeJS.Timeout
}

interface ProjectWatchers {
	watchers: WatcherProcess[]
	diagnostics: Map<string, Diagnostic[]> // keyed by tool
	folder: string
}

export class DiagnosticsWatcher extends EventEmitter {
	private projects = new Map<string, ProjectWatchers>() // projectId -> watchers
	private workspacePath: string

	constructor(workspacePath: string) {
		super()
		this.workspacePath = workspacePath
	}

	/** Start watchers for a project. Idempotent - won't duplicate. */
	startProject(projectId: string, projectFolder: string) {
		if (this.projects.has(projectId)) return

		const projectDir = path.join(this.workspacePath, "projects", projectFolder)
		if (!fs.existsSync(projectDir)) return

		const state: ProjectWatchers = {
			watchers: [],
			diagnostics: new Map([["tsc", []], ["ruff", []], ["pyright", []]]),
			folder: projectDir,
		}
		this.projects.set(projectId, state)

		// Find TypeScript configs and start tsc watchers
		this._findTsconfigs(projectDir).forEach(tsconfigPath => {
			this._startTscWatcher(projectId, state, tsconfigPath)
		})

		// Check for Python files and start ruff + pyright
		if (this._hasPythonFiles(projectDir)) {
			this._startRuffWatcher(projectId, state, projectDir)
			this._startPyrightWatcher(projectId, state, projectDir)
		}
	}

	/** Stop all watchers for a project */
	stopProject(projectId: string) {
		const state = this.projects.get(projectId)
		if (!state) return

		for (const w of state.watchers) {
			if (w.restartTimer) clearTimeout(w.restartTimer)
			try { w.proc.kill("SIGTERM") } catch { /* ignore */ }
		}
		this.projects.delete(projectId)
	}

	/** Get all diagnostics for a project */
	getDiagnostics(projectId: string): { diagnostics: Diagnostic[], counts: { errors: number, warnings: number, total: number } } {
		const state = this.projects.get(projectId)
		if (!state) return { diagnostics: [], counts: { errors: 0, warnings: 0, total: 0 } }

		const all: Diagnostic[] = []
		for (const diags of state.diagnostics.values()) {
			all.push(...diags)
		}

		const errors = all.filter(d => d.severity === "error").length
		const warnings = all.filter(d => d.severity === "warning").length
		return { diagnostics: all, counts: { errors, warnings, total: all.length } }
	}

	/** Returns true if watchers are running for a project */
	isWatching(projectId: string): boolean {
		return this.projects.has(projectId)
	}

	// ── Private helpers ────────────────────────────────────────────

	private _findTsconfigs(projectDir: string): string[] {
		const results: string[] = []
		try {
			const entries = fs.readdirSync(projectDir, { withFileTypes: true })
			for (const entry of entries) {
				if (!entry.isDirectory()) continue
				if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
				const subdir = path.join(projectDir, entry.name)
				// Check direct tsconfig.json in subdir
				const tsconfig = path.join(subdir, "tsconfig.json")
				if (fs.existsSync(tsconfig)) {
					results.push(tsconfig)
				}
			}
			// Only add root tsconfig if no subfolder tsconfigs were found.
			// Projects like architect/ have real tsconfigs in backend-specialist/ and
			// frontend-specialist/; running the root tsconfig on top of those produces
			// phantom duplicate-export errors.
			if (results.length === 0) {
				const rootTsconfig = path.join(projectDir, "tsconfig.json")
				if (fs.existsSync(rootTsconfig)) results.push(rootTsconfig)
			}
		} catch { /* ignore */ }
		return results
	}

	private _hasPythonFiles(projectDir: string): boolean {
		try {
			const check = (dir: string, depth = 0): boolean => {
				if (depth > 3) return false
				const entries = fs.readdirSync(dir, { withFileTypes: true })
				for (const e of entries) {
					if (e.name.startsWith(".") || e.name === "node_modules") continue
					if (e.isFile() && e.name.endsWith(".py")) return true
					if (e.isDirectory() && check(path.join(dir, e.name), depth + 1)) return true
				}
				return false
			}
			return check(projectDir)
		} catch { return false }
	}

	private _startTscWatcher(projectId: string, state: ProjectWatchers, tsconfigPath: string) {
		const dir = path.dirname(tsconfigPath)
		const toolKey = `tsc:${dir}`
		let buffer = ""
		let pendingDiagnostics: Diagnostic[] = []

		const start = (restartCount = 0) => {
			// --pretty defaults to false when stdout is piped, so no need to pass it.
			const proc = spawn("npx", ["tsc", "--noEmit", "--watch"], {
				cwd: dir,
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env },
			})

			const wp: WatcherProcess = { proc, tool: "tsc", folder: dir, restartCount }
			state.watchers.push(wp)

			const onData = (chunk: Buffer) => {
				// Strip ANSI color codes (some tsc versions emit them even when piped)
				// eslint-disable-next-line no-control-regex
				buffer += chunk.toString().replace(/\x1b\[[0-9;]*m/g, "").replace(/\r/g, "")
				const lines = buffer.split("\n")
				buffer = lines.pop() || ""

				for (const line of lines) {
					// Cycle complete signal
					if (line.includes("Watching for file changes")) {
						// Replace diagnostics for this folder
						const existing = state.diagnostics.get("tsc") || []
						const other = existing.filter(d => !d.file.startsWith(dir) && !d.file.startsWith(path.relative(this.workspacePath, dir)))
						state.diagnostics.set("tsc", [...other, ...pendingDiagnostics])
						pendingDiagnostics = []
						this.emit("updated", projectId)
						continue
					}

					// Parse: path(line,col): error TS1234: message
					const m = line.match(/^(.+?)\((\d+),(\d+)\):\s+(error|warning|message)\s+(TS\d+):\s+(.+)$/)
					if (m) {
						const [, filePath, lineNum, colNum, sev, code, message] = m
						const absFile = path.isAbsolute(filePath) ? filePath : path.resolve(dir, filePath)
						const relFile = absFile.startsWith(this.workspacePath)
							? absFile.substring(this.workspacePath.length + 1)
							: absFile
						pendingDiagnostics.push({
							tool: "tsc",
							file: relFile,
							line: parseInt(lineNum),
							column: parseInt(colNum),
							severity: sev === "message" ? "info" : sev as "error" | "warning",
							code,
							message: message.trim(),
							timestamp: Date.now(),
						})
					}
				}
			}

			proc.stdout?.on("data", onData)
			proc.stderr?.on("data", onData)

			proc.on("error", (err: any) => {
				state.watchers = state.watchers.filter(w => w !== wp)
				if (err.code === "ENOENT") return // npx/tsc not found - give up silently
				// Other errors: restart with backoff
				const delay = Math.min(1000 * Math.pow(2, restartCount), 30000)
				wp.restartTimer = setTimeout(() => start(restartCount + 1), delay)
			})

			proc.on("exit", (code, signal) => {
				state.watchers = state.watchers.filter(w => w !== wp)
				if (signal === "SIGTERM") return // Intentional stop
				// Restart with backoff
				const delay = Math.min(1000 * Math.pow(2, restartCount), 30000)
				wp.restartTimer = setTimeout(() => start(restartCount + 1), delay)
			})
		}

		start()
	}

	private _startRuffWatcher(projectId: string, state: ProjectWatchers, projectDir: string) {
		let buffer = ""
		let jsonBuffer = ""
		let inJson = false

		const start = (restartCount = 0) => {
			// Check ruff is available
			const proc = spawn("ruff", ["check", ".", "--watch", "--output-format=json"], {
				cwd: projectDir,
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env },
			})

			const wp: WatcherProcess = { proc, tool: "ruff", folder: projectDir, restartCount }
			state.watchers.push(wp)

			const onData = (chunk: Buffer) => {
				buffer += chunk.toString().replace(/\r/g, "")
				const lines = buffer.split("\n")
				buffer = lines.pop() || ""

				for (const line of lines) {
					// Ruff outputs a JSON array per check cycle
					if (line.startsWith("[")) {
						inJson = true
						jsonBuffer = line
					} else if (inJson) {
						jsonBuffer += line
					}

					if (inJson && (line.trimEnd().endsWith("]") || jsonBuffer.trimEnd().endsWith("]"))) {
						inJson = false
						try {
							const items = JSON.parse(jsonBuffer)
							const diags: Diagnostic[] = items.map((item: any) => ({
								tool: "ruff" as const,
								file: path.isAbsolute(item.filename)
									? item.filename.startsWith(this.workspacePath)
										? item.filename.substring(this.workspacePath.length + 1)
										: item.filename
									: path.join(path.relative(this.workspacePath, projectDir), item.filename),
								line: item.location?.row ?? 1,
								column: item.location?.column ?? 1,
								endLine: item.end_location?.row,
								endColumn: item.end_location?.column,
								severity: (item.severity === "warning" ? "warning" : "error") as "error" | "warning",
								code: item.code ?? "",
								message: item.message ?? "",
								timestamp: Date.now(),
							}))
							state.diagnostics.set("ruff", diags)
							this.emit("updated", projectId)
						} catch { /* bad json, ignore */ }
						jsonBuffer = ""
					}
				}
			}

			proc.stdout?.on("data", onData)
			proc.stderr?.on("data", onData)

			proc.on("error", (err: any) => {
				state.watchers = state.watchers.filter(w => w !== wp)
				// ENOENT = ruff not installed; silently skip, no restart
			})

			proc.on("exit", (code, signal) => {
				state.watchers = state.watchers.filter(w => w !== wp)
				if (signal === "SIGTERM") return
				// ruff exited with error - don't spam restarts
				if (restartCount > 2) return
				const delay = Math.min(5000 * Math.pow(2, restartCount), 60000)
				wp.restartTimer = setTimeout(() => start(restartCount + 1), delay)
			})
		}

		start()
	}

	private _startPyrightWatcher(projectId: string, state: ProjectWatchers, projectDir: string) {
		let buffer = ""

		const start = (restartCount = 0) => {
			const proc = spawn("pyright", ["--watch", "--outputjson"], {
				cwd: projectDir,
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env },
			})

			const wp: WatcherProcess = { proc, tool: "pyright", folder: projectDir, restartCount }
			state.watchers.push(wp)

			const onData = (chunk: Buffer) => {
				buffer += chunk.toString()
				// Pyright outputs a JSON object per cycle, terminated by a closing brace + newline
				// Try to extract complete JSON objects
				const lines = buffer.split("\n")
				let remaining = ""
				let jsonStr = ""
				let depth = 0

				for (let i = 0; i < lines.length; i++) {
					const line = lines[i]
					for (const ch of line) {
						if (ch === "{") depth++
						if (ch === "}") depth--
					}
					jsonStr += line + "\n"
					if (depth === 0 && jsonStr.trim().startsWith("{")) {
						try {
							const data = JSON.parse(jsonStr.trim())
							const diags: Diagnostic[] = []
							for (const diag of (data.generalDiagnostics || [])) {
								const file = diag.file ?? ""
								const relFile = file.startsWith(this.workspacePath)
									? file.substring(this.workspacePath.length + 1)
									: file
								diags.push({
									tool: "pyright",
									file: relFile,
									line: (diag.range?.start?.line ?? 0) + 1,
									column: (diag.range?.start?.character ?? 0) + 1,
									endLine: diag.range?.end?.line !== undefined ? diag.range.end.line + 1 : undefined,
									endColumn: diag.range?.end?.character,
									severity: (diag.severity === "warning" ? "warning" : diag.severity === "information" ? "info" : "error") as "error" | "warning" | "info",
									code: diag.rule ?? "pyright",
									message: diag.message ?? "",
									timestamp: Date.now(),
								})
							}
							state.diagnostics.set("pyright", diags)
							this.emit("updated", projectId)
						} catch { /* bad json */ }
						jsonStr = ""
					} else if (i === lines.length - 1) {
						remaining = jsonStr
					}
				}
				buffer = remaining
			}

			proc.stdout?.on("data", onData)
			proc.stderr?.on("data", onData)

			proc.on("error", (err: any) => {
				state.watchers = state.watchers.filter(w => w !== wp)
				// ENOENT = pyright not installed; silently skip, no restart
			})

			proc.on("exit", (code, signal) => {
				state.watchers = state.watchers.filter(w => w !== wp)
				if (signal === "SIGTERM") return
				if (restartCount > 2) return
				const delay = Math.min(5000 * Math.pow(2, restartCount), 60000)
				wp.restartTimer = setTimeout(() => start(restartCount + 1), delay)
			})
		}

		start()
	}

	/** Stop all watchers for all projects */
	stopAll() {
		for (const projectId of this.projects.keys()) {
			this.stopProject(projectId)
		}
	}
}
