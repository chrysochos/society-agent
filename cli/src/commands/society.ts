// kilocode_change - new file
/**
 * CLI commands for Society Agent
 *
 * Usage:
 *   kilo society start "Build authentication"
 *   kilo society list
 *   kilo society attach <agent-id>
 *   kilo society stop [purpose-id]
 */

import { Command } from "commander"

// kilocode_change start
/**
 * Register Society Agent commands
 */
export function registerSocietyCommands(program: Command): void {
	const society = program.command("society").description("Society Agent - Purpose-driven multi-agent system")

	// Start a new purpose
	society
		.command("start <purpose>")
		.description("Start a new purpose with agent team")
		.option("-c, --context <text>", "Additional context for the purpose")
		.option("-a, --attach <files...>", "Attach files (images, docs, URLs)")
		.option("--constraint <constraints...>", "Constraints (e.g., 'TypeScript', 'Budget: 1 hour')")
		.option("--success <criteria...>", "Success criteria")
		.option("-p, --project <path>", "Project root directory", process.cwd())
		.action(async (purpose, options) => {
			// kilocode_change start - Write purpose request to .society-agent/
			try {
				const fs = await import("fs/promises")
				const path = await import("path")

				const projectRoot = options.project
				const sharedDir = path.join(projectRoot, ".society-agent")
				await fs.mkdir(sharedDir, { recursive: true })

				const purposeId = `purpose-${Date.now()}`
				const purposeRequest = {
					id: purposeId,
					description: purpose,
					context: options.context || null,
					attachments: options.attach || [],
					constraints: options.constraint || [],
					successCriteria: options.success || [],
					requestedAt: new Date().toISOString(),
					status: "pending",
				}

				const purposesDir = path.join(sharedDir, "purposes")
				await fs.mkdir(purposesDir, { recursive: true })
				await fs.writeFile(
					path.join(purposesDir, `${purposeId}.json`),
					JSON.stringify(purposeRequest, null, 2),
					"utf-8",
				)

				console.log(`✅ Purpose created: ${purposeId}`)
				console.log(`Description: ${purpose}`)
				if (options.context) console.log(`Context: ${options.context}`)
				if (options.constraint?.length) console.log(`Constraints: ${options.constraint.join(", ")}`)
				if (options.success?.length) console.log(`Success criteria: ${options.success.join(", ")}`)
				console.log(`\nPurpose file: ${path.join(purposesDir, `${purposeId}.json`)}`)
				console.log("Open the Society Agent sidebar in VS Code to monitor execution.")
			} catch (error) {
				console.error("❌ Failed to start purpose:", error)
				process.exit(1)
			}
			// kilocode_change end
		})

	// List active purposes
	society
		.command("list")
		.description("List active purposes and agents")
		.option("-p, --project <path>", "Project root directory", process.cwd())
		.action(async (options) => {
			// kilocode_change start - Read from .society-agent/ directory
			try {
				const fs = await import("fs/promises")
				const path = await import("path")

				const projectRoot = options.project
				const sharedDir = path.join(projectRoot, ".society-agent")

				// List registered agents
				const registryPath = path.join(sharedDir, "registry.jsonl")
				try {
					const content = await fs.readFile(registryPath, "utf-8")
					const agents = content.trim().split("\n").filter(Boolean).map((l: string) => JSON.parse(l))

					// Deduplicate by agentId (keep latest)
					const latest = new Map<string, any>()
					for (const a of agents) {
						latest.set(a.agentId, a)
					}

					console.log("📋 Registered Agents:")
					for (const [, agent] of latest) {
						const ago = Math.round((Date.now() - new Date(agent.lastSeen || agent.registeredAt).getTime()) / 1000)
						const status = ago < 60 ? "🟢 active" : ago < 300 ? "🟡 stale" : "🔴 offline"
						console.log(`  ${agent.agentId} (${agent.role}) ${status} — last seen ${ago}s ago`)
					}
				} catch {
					console.log("📋 No registered agents.")
				}

				// List purposes
				const purposesDir = path.join(sharedDir, "purposes")
				try {
					const files = await fs.readdir(purposesDir)
					const jsonFiles = files.filter((f: string) => f.endsWith(".json"))
					if (jsonFiles.length > 0) {
						console.log("\n📎 Purposes:")
						for (const file of jsonFiles) {
							const p = JSON.parse(await fs.readFile(path.join(purposesDir, file), "utf-8"))
							console.log(`  ${p.id} [${p.status}] — ${p.description}`)
						}
					}
				} catch {
					// No purposes directory
				}
			} catch (error) {
				console.error("❌ Failed to list:", error)
				process.exit(1)
			}
			// kilocode_change end
		})

	// Attach to agent terminal
	society
		.command("attach <agent-id>")
		.description("Attach to agent terminal (view agent logs)")
		.option("-p, --project <path>", "Project root directory", process.cwd())
		.action(async (agentId, options) => {
			// kilocode_change start - Tail agent logs from .society-agent/logs/
			try {
				const fs = await import("fs/promises")
				const path = await import("path")

				const projectRoot = options.project
				const sharedDir = path.join(projectRoot, ".society-agent")
				const logsDir = path.join(sharedDir, "logs")

				// Find log files matching agentId
				let logFiles: string[] = []
				try {
					const allFiles = await fs.readdir(logsDir)
					logFiles = allFiles.filter((f: string) => f.includes(agentId) && f.endsWith(".jsonl"))
				} catch {
					// fall through
				}

				if (logFiles.length === 0) {
					console.error(`❌ No logs found for agent: ${agentId}`)
					console.log(`Looked in: ${logsDir}`)
					process.exit(1)
				}

				const logFile = path.join(logsDir, logFiles[logFiles.length - 1])
				console.log(`📡 Attaching to agent ${agentId} — tailing ${logFile}\n`)

				// Print existing content
				try {
					const content = await fs.readFile(logFile, "utf-8")
					const lines = content.trim().split("\n").filter(Boolean)
					const recent = lines.slice(-20) // Last 20 entries
					for (const line of recent) {
						try {
							const entry = JSON.parse(line)
							const ts = new Date(entry.timestamp).toLocaleTimeString()
							console.log(`[${ts}] [${entry.level || "info"}] ${entry.event || entry.action || JSON.stringify(entry)}`)
						} catch {
							console.log(line)
						}
					}
				} catch {
					// empty log
				}

				// Watch for new content
				console.log("\n--- watching for new entries (Ctrl+C to exit) ---\n")
				const { watch } = await import("fs")
				let lastSize = 0
				try {
					const stat = await fs.stat(logFile)
					lastSize = stat.size
				} catch {
					// file may not exist yet
				}

				watch(logFile, async () => {
					try {
						const stat = await fs.stat(logFile)
						if (stat.size > lastSize) {
							const content = await fs.readFile(logFile, "utf-8")
							const allBytes = Buffer.from(content, "utf-8")
							const newContent = allBytes.subarray(lastSize).toString("utf-8")
							lastSize = stat.size

							const lines = newContent.trim().split("\n").filter(Boolean)
							for (const line of lines) {
								try {
									const entry = JSON.parse(line)
									const ts = new Date(entry.timestamp).toLocaleTimeString()
									console.log(`[${ts}] [${entry.level || "info"}] ${entry.event || entry.action || JSON.stringify(entry)}`)
								} catch {
									console.log(line)
								}
							}
						}
					} catch {
						// ignore read errors
					}
				})

				// Keep process running
				await new Promise(() => {})
			} catch (error) {
				console.error("❌ Failed to attach:", error)
				process.exit(1)
			}
			// kilocode_change end
		})

	// Stop purpose execution
	society
		.command("stop [purpose-id]")
		.description("Stop purpose execution")
		.option("-a, --all", "Stop all active purposes")
		.option("-p, --project <path>", "Project root directory", process.cwd())
		.action(async (purposeId, options) => {
			// kilocode_change start - Broadcast shutdown via inbox files
			try {
				const fs = await import("fs/promises")
				const path = await import("path")

				const projectRoot = options.project
				const sharedDir = path.join(projectRoot, ".society-agent")

				if (!purposeId && !options.all) {
					console.error("Error: Provide purpose-id or use --all")
					process.exit(1)
				}

				// Read registry to find active agents
				const registryPath = path.join(sharedDir, "registry.jsonl")
				let agents: any[] = []
				try {
					const content = await fs.readFile(registryPath, "utf-8")
					const entries = content.trim().split("\n").filter(Boolean).map((l: string) => JSON.parse(l))
					const latest = new Map<string, any>()
					for (const a of entries) {
						latest.set(a.agentId, a)
					}
					agents = Array.from(latest.values())
				} catch {
					console.log("No agents registered.")
					return
				}

				// Send shutdown to each agent's inbox
				let count = 0
				for (const agent of agents) {
					const inboxDir = path.join(sharedDir, "inbox", agent.agentId)
					await fs.mkdir(inboxDir, { recursive: true })

					const shutdownMsg = {
						id: `shutdown-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
						from: "user",
						to: agent.agentId,
						type: "shutdown",
						content: purposeId ? `Stop purpose: ${purposeId}` : "Stop all purposes",
						timestamp: new Date().toISOString(),
						queuedAt: new Date().toISOString(),
						attempts: 0,
					}

					await fs.writeFile(
						path.join(inboxDir, `${shutdownMsg.id}.json`),
						JSON.stringify(shutdownMsg, null, 2),
						"utf-8",
					)
					count++
				}

				// Update purpose status if specified
				if (purposeId) {
					const purposePath = path.join(sharedDir, "purposes", `${purposeId}.json`)
					try {
						const p = JSON.parse(await fs.readFile(purposePath, "utf-8"))
						p.status = "stopped"
						p.stoppedAt = new Date().toISOString()
						await fs.writeFile(purposePath, JSON.stringify(p, null, 2), "utf-8")
					} catch {
						// Purpose file may not exist
					}
				}

				console.log(`✅ Shutdown sent to ${count} agent(s)`)
			} catch (error) {
				console.error("❌ Failed to stop:", error)
				process.exit(1)
			}
			// kilocode_change end
		})

	// Society Agent status
	society
		.command("status")
		.description("Show Society Agent system status")
		.action(async () => {
			console.log("📊 Society Agent Status:")
			console.log("Status: Development")
			console.log("Active Purposes: 0")
			console.log("Total Agents: 0")
			console.log("\nWeek 1 Core Foundation: ✅ Complete")
			console.log("Week 2 Web Dashboard: ⏳ In Progress")
		})

	// kilocode_change start - Launch all agents
	// Launch all agents
	society
		.command("launch")
		.description("Launch all VS Code agents defined in project plan")
		.argument("[project-root]", "Project root directory", process.cwd())
		.option("--plan <path>", "Custom project-plan.json path")
		.option("--dev", "Launch in extension development mode") // kilocode_change
		.action(async (projectRoot: string, options: { plan?: string; dev?: boolean }) => {
			// kilocode_change
			console.log(`🚀 Launching agents for project: ${projectRoot}\n`)

			try {
				// Dynamic import
				const { AgentLauncher } = await import("../../../src/services/society-agent/agent-launcher")

				const launcher = new AgentLauncher()

				// Check if VS Code CLI is available
				const hasVSCode = await launcher.checkVSCodeCLI()
				if (!hasVSCode) {
					console.error("❌ VS Code CLI not found. Install: 'code' command in PATH")
					process.exit(1)
				}

				// kilocode_change start - Set development mode environment variable
				if (options.dev) {
					process.env.NODE_ENV = "development"
					process.env.VSCODE_DEBUG_MODE = "true"
					console.log("🔧 Development mode enabled - launching with extension\n")
				}
				// kilocode_change end

				// Launch with progress
				const results = await launcher.launchAllWithProgress(projectRoot, (update) => {
					if (update.type === "start") {
						console.log(update.message)
					} else if (update.type === "progress") {
						process.stdout.write(`\r[${update.current}/${update.total}] ${update.message}`)
					} else if (update.type === "success") {
						console.log(`\n${update.message}`)
					} else if (update.type === "error") {
						console.log(`\n${update.message}`)
					} else if (update.type === "complete") {
						console.log(`\n✅ ${update.message}`)
					}
				})

				const successful = results.filter((r) => r.success).length
				console.log(`\n🎉 Done! ${successful} VS Code window(s) launched.`)
			} catch (error) {
				console.error("❌ Failed:", error)
				process.exit(1)
			}
		})

	// Send message to agent
	society
		.command("message <agent-id> <text>")
		.description("Send a message to a specific agent")
		.option("-t, --type <type>", "Message type (message, question, task_assign)", "message")
		.option("-f, --from <sender>", "Sender agent ID (auto-detected from workspace if not provided)") // kilocode_change
		.option("-p, --project <path>", "Project root directory", process.cwd())
		.action(async (agentId, text, options) => {
			try {
				const fs = await import("fs/promises")
				const path = await import("path")
				const crypto = await import("crypto") // kilocode_change

				const projectRoot = options.project
				const sharedDir = path.join(projectRoot, ".society-agent")

				// kilocode_change start - Auto-detect sender from workspace directory
				let sender = options.from
				if (!sender) {
					// Try to detect agent ID from current directory (e.g., /path/frontend-worker -> frontend-dev)
					const cwd = process.cwd()
					const dirName = path.basename(cwd)
					if (dirName.includes("-worker")) {
						sender = dirName.replace("-worker", "-dev")
					} else {
						sender = "user"
					}
				}
				// kilocode_change end

				// Check if .society-agent exists
				try {
					await fs.stat(sharedDir)
				} catch {
					console.error("❌ No .society-agent/ directory found in:", projectRoot)
					console.log("Run 'kilo society launch' first to set up agents.")
					process.exit(1)
				}

				// Write message to messages.jsonl (backward compatibility)
				const messagesPath = path.join(sharedDir, "messages.jsonl")
				const message = {
					id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
					from: sender, // kilocode_change - use auto-detected or --from option
					to: agentId,
					type: options.type,
					content: text,
					timestamp: new Date().toISOString(),
					delivered: false,
				}

				await fs.appendFile(messagesPath, JSON.stringify(message) + "\n", "utf-8")

				// kilocode_change start - Sign message with sender's secret key
				const keysDir = path.join(sharedDir, "keys")
				await fs.mkdir(keysDir, { recursive: true })

				const senderKeyPath = path.join(keysDir, `${sender}.key`)
				let senderSecret: string
				try {
					senderSecret = await fs.readFile(senderKeyPath, "utf-8")
				} catch {
					// Generate new key for sender
					senderSecret = crypto.randomBytes(32).toString("hex")
					await fs.writeFile(senderKeyPath, senderSecret, { mode: 0o600 })
				}

				// Create signature
				const messageData = { ...message }
				const canonical = JSON.stringify(messageData, Object.keys(messageData).sort())
				const hmac = crypto.createHmac("sha256", senderSecret)
				hmac.update(canonical)
			;(message as any).signature = hmac.digest("hex") // eslint-disable-line @typescript-eslint/no-explicit-any -- kilocode_change
			// kilocode_change start - Also write to inbox for persistent queue
				const inboxDir = path.join(sharedDir, "inbox", agentId)
				await fs.mkdir(inboxDir, { recursive: true })

				const inboxMessage = {
					...message,
					queuedAt: new Date().toISOString(),
					attempts: 0,
				}

				const inboxFilePath = path.join(inboxDir, `${message.id}.json`)
				await fs.writeFile(inboxFilePath, JSON.stringify(inboxMessage, null, 2), "utf-8")
				// kilocode_change end

				console.log(`✅ Message sent to ${agentId}`)
				console.log(`Type: ${message.type}`)
				console.log(`Content: ${text}`)
				console.log(`\nThe agent will process this message and respond within a few seconds.`)
			} catch (error) {
				console.error("❌ Failed to send message:", error)
				process.exit(1)
			}
		})

	// Broadcast message to all agents
	society
		.command("broadcast <text>")
		.description("Broadcast a message to all agents")
		.option("-t, --type <type>", "Message type", "message")
		.option("-p, --project <path>", "Project root directory", process.cwd())
		.action(async (text, options) => {
			try {
				const fs = await import("fs/promises")
				const path = await import("path")

				const projectRoot = options.project
				const sharedDir = path.join(projectRoot, ".society-agent")

				const messagesPath = path.join(sharedDir, "messages.jsonl")
				const message = {
					id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
					from: "user",
					to: "broadcast",
					type: options.type,
					content: text,
					timestamp: new Date().toISOString(),
					delivered: false,
				}

				await fs.appendFile(messagesPath, JSON.stringify(message) + "\n", "utf-8")

				console.log(`✅ Broadcast sent to all agents`)
				console.log(`Type: ${message.type}`)
				console.log(`Content: ${text}`)
			} catch (error) {
				console.error("❌ Failed to broadcast:", error)
				process.exit(1)
			}
		})

	// Diagnose communication system
	society
		.command("diagnose")
		.description("Diagnose society agent communication system")
		.option("-p, --project <path>", "Project root directory", process.cwd())
		.action(async (_options) => {
			// kilocode_change
			const { createDiagnoseCommand } = await import("./diagnose")
			const diagnoseCmd = createDiagnoseCommand()
			await diagnoseCmd.parseAsync(["", "", ...process.argv.slice(3)], { from: "user" })
		})
	// kilocode_change end
}
// kilocode_change end
