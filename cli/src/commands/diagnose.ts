// kilocode_change - new file
/**
 * Diagnostic tool for society agent communication system
 */

import { Command } from "commander"
import * as fs from "fs/promises"
import * as path from "path"
import * as crypto from "crypto"

export function createDiagnoseCommand(): Command {
	const diagnose = new Command("diagnose")
		.description("Diagnose society agent communication system")
		.option("-p, --project <path>", "Project root directory", process.cwd())
		.action(async (options) => {
			console.log("🔍 Society Agent Communication Diagnostics\n")

			const projectRoot = options.project
			const sharedDir = path.join(projectRoot, ".society-agent")

			let issues = 0
			let warnings = 0

			// 1. Check .society-agent directory
			console.log("📁 Checking directory structure...")
			try {
				await fs.access(sharedDir)
				console.log("  ✅ .society-agent/ exists")
			} catch {
				console.log("  ❌ .society-agent/ does NOT exist")
				console.log("     Run: kilo society launch")
				issues++
				return
			}

			// 2. Check inbox directory
			const inboxDir = path.join(sharedDir, "inbox")
			try {
				await fs.access(inboxDir)
				console.log("  ✅ inbox/ exists")

				const inboxContents = await fs.readdir(inboxDir)
				if (inboxContents.length > 0) {
					console.log(`  ℹ️  Inbox contains: ${inboxContents.join(", ")}`)
				} else {
					console.log("  ⚠️  Inbox is empty (no agent directories)")
					warnings++
				}
			} catch {
				console.log("  ❌ inbox/ does NOT exist")
				issues++
			}

			// 3. Check keys directory
			const keysDir = path.join(sharedDir, "keys")
			try {
				await fs.access(keysDir)
				console.log("  ✅ keys/ exists")

				const keyFiles = await fs.readdir(keysDir)
				if (keyFiles.length > 0) {
					console.log(`  ℹ️  Keys found: ${keyFiles.join(", ")}`)
				} else {
					console.log("  ⚠️  No keys found (no messages sent yet)")
					warnings++
				}
			} catch {
				console.log("  ❌ keys/ does NOT exist")
				issues++
			}

			// 4. Check registry
			console.log("\n📋 Checking agent registry...")
			const registryPath = path.join(sharedDir, "registry.jsonl")
			try {
				const content = await fs.readFile(registryPath, "utf-8")
				const lines = content.split("\n").filter((line) => line.trim())

				// Find unique agents
				const agents = new Map<string, Record<string, unknown>>() // kilocode_change
				for (const line of lines) {
					const entry = JSON.parse(line)
					if (entry.agentId) {
						agents.set(entry.agentId, entry)
					}
				}

				if (agents.size > 0) {
					console.log(`  ✅ Found ${agents.size} registered agent(s):`)
					for (const [agentId, agent] of agents) {
						const status = agent.status || "unknown"
						const lastSeen = agent.lastHeartbeat
							? new Date(agent.lastHeartbeat).toLocaleTimeString()
							: "never"
						console.log(`     - ${agentId} (${agent.role}) - ${status} - last seen: ${lastSeen}`)
					}
				} else {
					console.log("  ⚠️  No agents registered")
					warnings++
				}
			} catch {
				console.log("  ❌ registry.jsonl not found or invalid")
				issues++
			}

			// 5. Check pending messages
			console.log("\n📬 Checking pending messages...")
			try {
				const inboxDirs = await fs.readdir(inboxDir)
				let totalMessages = 0

				for (const agentId of inboxDirs) {
					const agentInboxPath = path.join(inboxDir, agentId)
					const stat = await fs.stat(agentInboxPath)

					if (stat.isDirectory()) {
						const messages = await fs.readdir(agentInboxPath)
						const jsonMessages = messages.filter((f) => f.endsWith(".json"))

						if (jsonMessages.length > 0) {
							console.log(`  ⚠️  ${agentId} has ${jsonMessages.length} undelivered message(s):`)

							for (const msgFile of jsonMessages) {
								const msgPath = path.join(agentInboxPath, msgFile)
								const msgContent = await fs.readFile(msgPath, "utf-8")
								const msg = JSON.parse(msgContent)

								console.log(`     - ${msgFile}:`)
								console.log(`       From: ${msg.from}`)
								console.log(`       Type: ${msg.type}`)
								console.log(`       Time: ${new Date(msg.timestamp).toLocaleString()}`)
								console.log(`       Has signature: ${msg.signature ? "✅ YES" : "❌ NO"}`)

								if (!msg.signature) {
									issues++
								}

								totalMessages++
							}
							warnings++
						}
					}
				}

				if (totalMessages === 0) {
					console.log("  ✅ No pending messages (all delivered)")
				}
			} catch (error) {
				console.log(`  ⚠️  Could not check pending messages: ${error}`)
			}

			// 6. Test message signing
			console.log("\n🔐 Testing message security...")
			try {
				const keyFiles = await fs.readdir(keysDir)
				if (keyFiles.length > 0) {
					const testKeyFile = keyFiles[0]
					const keyPath = path.join(keysDir, testKeyFile)
					const secret = await fs.readFile(keyPath, "utf-8")

					// Test signing
					const testMessage = {
						id: "test-123",
						from: "test",
						to: "test",
						type: "message",
						content: "test",
						timestamp: new Date().toISOString(),
					}

					const canonical = JSON.stringify(testMessage, Object.keys(testMessage).sort())
					const hmac = crypto.createHmac("sha256", secret)
					hmac.update(canonical)
					const signature = hmac.digest("hex")

					console.log(`  ✅ Message signing works (tested with ${testKeyFile})`)
					console.log(`     Signature length: ${signature.length} hex chars`)
				} else {
					console.log("  ⚠️  No keys to test")
					warnings++
				}
			} catch (error) {
				console.log(`  ❌ Message signing test failed: ${error}`)
				issues++
			}

			// 7. Summary
			console.log("\n" + "=".repeat(60))
			if (issues === 0 && warnings === 0) {
				console.log("✅ All checks passed! Communication system is healthy.")
			} else {
				console.log(`⚠️  Found ${issues} issue(s) and ${warnings} warning(s)`)

				if (issues > 0) {
					console.log("\n🔧 Recommended actions:")
					console.log("  1. Reload all agent VS Code windows (Ctrl+Shift+P → 'Developer: Reload Window')")
					console.log("  2. Check agent configuration in each window's settings")
					console.log("  3. Verify agents show in status bar (bottom right)")
				}

				if (warnings > 0 && issues === 0) {
					console.log("\n💡 System is functional but has pending items to review")
				}
			}
		})

	return diagnose
}
