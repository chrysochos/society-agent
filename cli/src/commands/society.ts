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
		.action(async (purpose, options) => {
			console.log("🚀 Starting purpose:", purpose)

			if (options.context) {
				console.log("Context:", options.context)
			}

			if (options.attach) {
				console.log("Attachments:", options.attach)
			}

			if (options.constraint) {
				console.log("Constraints:", options.constraint)
			}

			if (options.success) {
				console.log("Success criteria:", options.success)
			}

			// TODO: Implement actual Society Agent integration
			console.log("\n⚠️  Society Agent implementation in progress...")
			console.log("This will create a supervisor agent and worker team to achieve your purpose.")
			console.log("\nFor now, use the standard KiloCode interface.")
		})

	// List active purposes
	society
		.command("list")
		.description("List active purposes and agents")
		.action(async () => {
			console.log("📋 Active Purposes:")

			// TODO: Implement actual listing
			console.log("\n⚠️  No active purposes (Society Agent in development)")
		})

	// Attach to agent terminal
	society
		.command("attach <agent-id>")
		.description("Attach to agent terminal")
		.action(async (agentId) => {
			console.log(`🔗 Attaching to agent: ${agentId}`)

			// TODO: Implement terminal attachment
			console.log("\n⚠️  Terminal attachment not yet implemented")
		})

	// Stop purpose execution
	society
		.command("stop [purpose-id]")
		.description("Stop purpose execution")
		.option("-a, --all", "Stop all active purposes")
		.action(async (purposeId, options) => {
			if (options.all) {
				console.log("⏹️  Stopping all purposes...")
			} else if (purposeId) {
				console.log(`⏹️  Stopping purpose: ${purposeId}`)
			} else {
				console.error("Error: Provide purpose-id or use --all")
				process.exit(1)
			}

			// TODO: Implement stop functionality
			console.log("\n⚠️  Stop not yet implemented")
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
				message.signature = hmac.digest("hex")
				// kilocode_change end

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
