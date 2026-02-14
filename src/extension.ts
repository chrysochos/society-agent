import * as vscode from "vscode"
import * as dotenvx from "@dotenvx/dotenvx"
import * as path from "path"

// Load environment variables from .env file
try {
	// Specify path to .env file in the project root directory
	const envPath = path.join(__dirname, "..", ".env")
	dotenvx.config({ path: envPath })
} catch (e) {
	// Silently handle environment loading errors
	console.warn("Failed to load environment variables:", e)
}

import type { CloudUserInfo, AuthState } from "@roo-code/types"
import { CloudService, BridgeOrchestrator } from "@roo-code/cloud"
import { TelemetryService, PostHogTelemetryClient } from "@roo-code/telemetry"

import "./utils/path" // Necessary to have access to String.prototype.toPosix.
import { createOutputChannelLogger, createDualLogger } from "./utils/outputChannelLogger"

import { Package } from "./shared/package"
import { formatLanguage } from "./shared/language"
import { ContextProxy } from "./core/config/ContextProxy"
import { ClineProvider } from "./core/webview/ClineProvider"
import { DIFF_VIEW_URI_SCHEME } from "./integrations/editor/DiffViewProvider"
import { TerminalRegistry } from "./integrations/terminal/TerminalRegistry"
import { McpServerManager } from "./services/mcp/McpServerManager"
import { CodeIndexManager } from "./services/code-index/manager"
import { registerCommitMessageProvider } from "./services/commit-message"
import { MdmService } from "./services/mdm/MdmService"
import { migrateSettings } from "./utils/migrateSettings"
import { checkAndRunAutoLaunchingTask as checkAndRunAutoLaunchingTask } from "./utils/autoLaunchingTask"
import { autoImportSettings } from "./utils/autoImportSettings"
import { API } from "./extension/api"

import {
	handleUri,
	registerCommands,
	registerCodeActions,
	registerTerminalActions,
	CodeActionProvider,
} from "./activate"
import { initializeI18n } from "./i18n"
import { registerGhostProvider } from "./services/ghost" // kilocode_change
import { registerMainThreadForwardingLogger } from "./utils/fowardingLogger" // kilocode_change
import { getKiloCodeWrapperProperties } from "./core/kilocode/wrapper" // kilocode_change
import { flushModels, getModels } from "./api/providers/fetchers/modelCache"
import { ManagedIndexer } from "./services/code-index/managed/ManagedIndexer" // kilocode_change
import { registerSocietyAgentProvider } from "./core/webview/registerSocietyAgentProvider" // kilocode_change
import { AgentRegistry } from "./services/society-agent/agent-registry" // kilocode_change
import { createChannelLog, setSocietyLog } from "./services/society-agent/logger" // kilocode_change

/**
 * Built using https://github.com/microsoft/vscode-webview-ui-toolkit
 *
 * Inspired by:
 *  - https://github.com/microsoft/vscode-webview-ui-toolkit-samples/tree/main/default/weather-webview
 *  - https://github.com/microsoft/vscode-webview-ui-toolkit-samples/tree/main/frameworks/hello-world-react-cra
 */

let outputChannel: vscode.OutputChannel
let extensionContext: vscode.ExtensionContext
let cloudService: CloudService | undefined
let agentRegistry: AgentRegistry | undefined // kilocode_change

let authStateChangedHandler: ((data: { state: AuthState; previousState: AuthState }) => Promise<void>) | undefined
let settingsUpdatedHandler: (() => void) | undefined
let userInfoHandler: ((data: { userInfo: CloudUserInfo }) => Promise<void>) | undefined

// This method is called when your extension is activated.
// Your extension is activated the very first time the command is executed.
export async function activate(context: vscode.ExtensionContext) {
	extensionContext = context
	outputChannel = vscode.window.createOutputChannel("Kilo-Code")
	context.subscriptions.push(outputChannel)
	outputChannel.appendLine(`${Package.name} extension activated - ${JSON.stringify(Package)}`)

	// kilocode_change - Wire OutputChannel-based logger for society-agent services
	setSocietyLog(createChannelLog(outputChannel))

	// Migrate old settings to new
	await migrateSettings(context, outputChannel)

	// Initialize telemetry service.
	const telemetryService = TelemetryService.createInstance()

	try {
		telemetryService.register(new PostHogTelemetryClient())
	} catch (error) {
		console.warn("Failed to register PostHogTelemetryClient:", error.message)
	}

	// Create logger for cloud services.
	const cloudLogger = createDualLogger(createOutputChannelLogger(outputChannel))

	// kilocode_change start: no Roo cloud service
	// Initialize Roo Code Cloud service.
	// const cloudService = await CloudService.createInstance(context, cloudLogger)

	// try {
	// 	if (cloudService.telemetryClient) {
	// 		TelemetryService.instance.register(cloudService.telemetryClient)
	// 	}
	// } catch (error) {
	// 	outputChannel.appendLine(
	// 		`[CloudService] Failed to register TelemetryClient: ${error instanceof Error ? error.message : String(error)}`,
	// 	)
	// }

	// const postStateListener = () => {
	// 	ClineProvider.getVisibleInstance()?.postStateToWebview()
	// }

	// cloudService.on("auth-state-changed", postStateListener)
	// cloudService.on("user-info", postStateListener)
	// cloudService.on("settings-updated", postStateListener)

	// // Add to subscriptions for proper cleanup on deactivate
	// context.subscriptions.push(cloudService)
	// kilocode_change end

	// Initialize MDM service
	const mdmService = await MdmService.createInstance(cloudLogger)

	// Initialize i18n for internationalization support
	initializeI18n(context.globalState.get("language") ?? formatLanguage(vscode.env.language))

	// Initialize terminal shell execution handlers.
	TerminalRegistry.initialize()

	// Get default commands from configuration.
	const defaultCommands = vscode.workspace.getConfiguration(Package.name).get<string[]>("allowedCommands") || []

	// Initialize global state if not already set.
	if (!context.globalState.get("allowedCommands")) {
		context.globalState.update("allowedCommands", defaultCommands)
	}

	const contextProxy = await ContextProxy.getInstance(context)

	// Initialize code index managers for all workspace folders.
	const codeIndexManagers: CodeIndexManager[] = []

	if (vscode.workspace.workspaceFolders) {
		for (const folder of vscode.workspace.workspaceFolders) {
			const manager = CodeIndexManager.getInstance(context, folder.uri.fsPath)

			if (manager) {
				codeIndexManagers.push(manager)

				// Initialize in background; do not block extension activation
				void manager.initialize(contextProxy).catch((error) => {
					const message = error instanceof Error ? error.message : String(error)
					outputChannel.appendLine(
						`[CodeIndexManager] Error during background CodeIndexManager configuration/indexing for ${folder.uri.fsPath}: ${message}`,
					)
				})

				context.subscriptions.push(manager)
			}
		}
	}

	// Initialize the provider *before* the Roo Code Cloud service.
	const provider = new ClineProvider(context, outputChannel, "sidebar", contextProxy, mdmService)
	// const initManagedCodeIndexing = updateCodeIndexWithKiloProps(provider) // kilocode_change

	// kilocode_change start - Initialize Society Agent with ClineProvider reference
	const societyLog = createChannelLog(outputChannel) // kilocode_change
	societyLog.info("Registering Society Agent provider...")
	let societyAgentProvider: ReturnType<typeof registerSocietyAgentProvider> | undefined // kilocode_change
	try {
		societyAgentProvider = registerSocietyAgentProvider(context, provider)
		societyLog.info("Society Agent provider registered successfully")
	} catch (error) {
		societyLog.error("Failed to register Society Agent:", error)
		vscode.window.showErrorMessage(`Failed to register Society Agent: ${error}`)
	}

	// kilocode_change - Auto-open chat for Society Agents
	const config = vscode.workspace.getConfiguration("kilo-code")
	const agentRole = config.get<string>("societyAgent.role")
	if (agentRole) {
		// Show the chat interface when this is a Society Agent workspace
		setTimeout(() => {
			vscode.commands.executeCommand("kilo-code.plusButtonTapped")
			outputChannel.appendLine(`[Society Agent] Opened chat interface for ${agentRole}`)
		}, 1000)
	}

	// Initialize multi-VS Code agent registry
	// kilocode_change start - Week 4 + Auto-discovery
	try {
		const config = vscode.workspace.getConfiguration("kilo-code")
		let sharedDir = config.get<string>("societyAgent.sharedDir")
		let agentId = config.get<string>("societyAgent.agentId")
		let role = config.get<string>("societyAgent.role")
		let capabilities = config.get<string[]>("societyAgent.capabilities")

		// Auto-discovery: Find .society-agent/ in parent directories
		if (!sharedDir || sharedDir.trim() === "") {
			const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
			if (workspaceRoot) {
				const { findSocietyAgentDir } = await import("./services/society-agent/project-plan-utils")
				sharedDir = await findSocietyAgentDir(workspaceRoot, 5)
			}
		}

		if (sharedDir && sharedDir.trim() !== "") {
			// Load project plan if exists
			const { loadProjectPlan, findMatchingAgent, generateAgentId } = await import(
				"./services/society-agent/project-plan-utils"
			)
			const plan = await loadProjectPlan(sharedDir)

			// Auto-configure from project plan
			if (plan && (!agentId || !role)) {
				const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
				if (workspaceRoot) {
					const matchingAgent = findMatchingAgent(plan, workspaceRoot)

					if (matchingAgent) {
						// Auto-assign from plan
						agentId = matchingAgent.agentId
						role = matchingAgent.role
						capabilities = matchingAgent.capabilities

						// Save to workspace settings
						await config.update(
							"societyAgent.agentId",
							agentId,
							vscode.ConfigurationTarget.Workspace,
						)
						await config.update("societyAgent.role", role, vscode.ConfigurationTarget.Workspace)
						await config.update(
							"societyAgent.sharedDir",
							sharedDir,
							vscode.ConfigurationTarget.Workspace,
						)
						await config.update(
							"societyAgent.capabilities",
							capabilities,
							vscode.ConfigurationTarget.Workspace,
						)

						outputChannel.appendLine(
							`[Society Agent] Auto-configured from project plan: ${role} (${agentId})`,
						)
					}
				}
			}

			// Generate agentId if still missing
			if (!agentId && role) {
				const { generateAgentId: genId } = await import("./services/society-agent/project-plan-utils")
				agentId = genId(role)
				await config.update("societyAgent.agentId", agentId, vscode.ConfigurationTarget.Workspace)
			}

			// Start agent server and connect
			if (agentId && role) {
				const { AgentServer } = await import("./services/society-agent/agent-server")
				const { PortManager } = await import("./services/society-agent/port-manager")

				const port = await PortManager.findAvailablePort(3000, 4000)
				const agentServer = new AgentServer(port, agentId, role)
				await agentServer.start()

				const serverUrl = agentServer.getUrl()
				outputChannel.appendLine(`[Society Agent] HTTP server started on ${serverUrl}`)

				// kilocode_change start - Initialize identity system (Ed25519)
				const { AgentIdentityManager } = await import("./services/society-agent/agent-identity")
				const identityManager = new AgentIdentityManager(sharedDir)

				// Try loading identity from env var (set by supervisor at launch)
				const identityEnvPath = process.env.SOCIETY_AGENT_IDENTITY
				if (identityEnvPath) {
					try {
						await identityManager.loadIdentity(identityEnvPath)
						outputChannel.appendLine(`[Society Agent] Identity loaded from env: ${identityManager.getAgentId()}`)
					} catch (error) {
						outputChannel.appendLine(`[Society Agent] Failed to load identity from env: ${error}`)
					}
				} else {
					// Fallback: try loading from default path
					const defaultIdentityPath = require("path").join(sharedDir, "agents", agentId, "identity.json")
					try {
						await identityManager.loadIdentity(defaultIdentityPath)
						outputChannel.appendLine(`[Society Agent] Identity loaded from default path`)
					} catch {
						outputChannel.appendLine(`[Society Agent] No identity file found — running without Ed25519 signing`)
					}
				}

				// Load public keys for verification
				await identityManager.loadPublicKeys()
				await identityManager.loadAuthorizedAgents()
				// kilocode_change end

				// kilocode_change start - Initialize unified message handler
				const { UnifiedMessageHandler } = await import("./services/society-agent/message-handler")
				const messageHandler = new UnifiedMessageHandler({
					sharedDir,
					identityManager,
					agentId,
				})
				// kilocode_change end

				agentRegistry = new AgentRegistry(sharedDir, serverUrl)
				await agentRegistry.initialize()
				await agentRegistry.catchUp()
				agentRegistry.startCacheRefresh() // kilocode_change - start background cache for monitor

				// kilocode_change start - Route registry-discovered messages through unified handler
				agentRegistry.setMessageHandler(async (msg) => {
					await messageHandler.handleMessage(msg as any)
				})
				outputChannel.appendLine(`[Society Agent] Registry message handler wired`)
				// kilocode_change end

				// kilocode_change start - Wire HTTP server to unified handler (instant delivery)
				agentServer.on("message", async (message: any) => {
					outputChannel.appendLine(
						`[Society Agent] HTTP message from ${message.from}: ${message.type}`,
					)
					// Feed to unified handler (same handler as inbox poller)
					const result = await messageHandler.handleMessage(message)
					if (!result.accepted) {
						outputChannel.appendLine(`[Society Agent] HTTP message rejected: ${result.reason}`)
					}
				})

				agentServer.on("task", async (task: any) => {
					outputChannel.appendLine(`[Society Agent] HTTP task from ${task.from}: ${task.taskId}`)
					// Convert task to message format and feed to handler
					const taskMessage = {
						id: task.taskId || require("crypto").randomUUID(),
						from: task.from || "unknown",
						to: agentId!, // kilocode_change - agentId is guaranteed non-null here (inside if block)
						timestamp: task.timestamp || new Date().toISOString(),
						nonce: require("crypto").randomBytes(16).toString("hex"),
						type: "task_assign" as const,
						content: task.description || JSON.stringify(task),
						signature: task.signature || "",
					}
					await messageHandler.handleMessage(taskMessage)
				})
				// kilocode_change end

				context.subscriptions.push({
					dispose: async () => {
						agentRegistry?.stopCacheRefresh() // kilocode_change
						await agentRegistry?.dispose()
						await agentServer.stop()
						PortManager.releasePort(port)
					},
				})

				outputChannel.appendLine(
					`[Society Agent] Connected: ${role} (${agentId}) on ${serverUrl}`,
				)

				// kilocode_change start - Start inbox poller (replaces SimpleAgentLoop for message processing)
				const { InboxPoller } = await import("./services/society-agent/inbox-poller")
				const inboxPoller = new InboxPoller({
					sharedDir,
					agentId,
					handler: messageHandler,
					pollIntervalMs: 3000,
				})
				await inboxPoller.start()

				context.subscriptions.push({
					dispose: () => inboxPoller.stop(),
				})
				// kilocode_change end

				// kilocode_change start - Initialize message sender for outgoing messages
				const { MessageSender } = await import("./services/society-agent/message-sender")
				const messageSender = new MessageSender(sharedDir, identityManager)

				// Wire sender into handler for auto-routing responses
				messageHandler.setMessageSender({
					send: async (to: string, type: string, content: string, replyTo?: string) => {
						await messageSender.send({ to, type: type as any, content, replyTo })
					},
				})

				// Store sender in workspace state so other components can use it
				await context.workspaceState.update("societyAgent.messageSender", "initialized")
				// kilocode_change end

				// kilocode_change start - Wire monitor data source to Society Agent webview
				if (societyAgentProvider && typeof societyAgentProvider.setMonitorDataSource === "function") {
					const monitorAgentId = agentId
					const monitorRole = role
					societyAgentProvider.setMonitorDataSource({
						getIdentity: () => {
							const id = identityManager.getAgentId()
							if (!id) return null
							return {
								id,
								name: `${monitorRole} (${id.slice(-8)})`,
								role: monitorRole || "worker",
								capabilities: capabilities || [],
								fingerprint: identityManager.getFingerprint() ?? undefined, // kilocode_change
								teamId: undefined,
							}
						},
						getRegisteredAgents: () => {
							try {
								const agents = agentRegistry?.getRegisteredAgents() ?? [] // kilocode_change
								return agents.map((a: any) => ({
									id: a.agentId || a.id,
									name: `${a.role} (${(a.agentId || a.id || "").slice(-8)})`,
									role: a.role,
									status: a.status === "online" ? "busy" : a.status === "idle" ? "idle" : "offline",
									currentTask: null,
									lastSeen: a.lastHeartbeat ? new Date(a.lastHeartbeat).getTime() : Date.now(),
									domain: a.role,
								}))
							} catch {
								return []
							}
						},
						getQueueDepth: () => {
							return messageHandler.getQueueDepth() // kilocode_change
						},
						getRecentMessages: () => {
							return messageHandler.getRecentMessages() // kilocode_change
						},
						getTeamStatus: () => null,
					})
					outputChannel.appendLine(`[Society Agent] Monitor data source wired to webview provider`)

				// kilocode_change start - Wire real-time push: new messages → webview monitor
				messageHandler.onMessage((msg) => {
					societyAgentProvider!.pushMonitorMessage(msg)
				})
				outputChannel.appendLine(`[Society Agent] Real-time push wired to monitor`)
				// kilocode_change end
				}
				// kilocode_change end

				outputChannel.appendLine(`[Society Agent] Unified message system started for ${role} (inbox poller + HTTP handler)`)
				
				// kilocode_change start - Resume last task immediately to prevent "welcome message" showing
				// Wait for provider to be available and resume last task if it exists
				try {
					const { ClineProvider } = await import("./core/webview/ClineProvider")
					
					// Wait for provider to be created (max 3 seconds)
					let attempts = 0
					while (attempts < 30) {
						await new Promise(resolve => setTimeout(resolve, 100))
						const provider = ClineProvider.getVisibleInstance()
						if (provider) {
							outputChannel.appendLine(`[Society Agent] Provider available, checking for task history`)
							const taskHistory = provider.getTaskHistory()
							if (taskHistory && taskHistory.length > 0) {
								const lastTask = taskHistory[0]
								if (lastTask && lastTask.id) {
									// Check if task already loaded
									const currentTask = provider.getCurrentTask()
									if (!currentTask || currentTask.taskId !== lastTask.id) {
										outputChannel.appendLine(`[Society Agent] Resuming last task: ${lastTask.id}`)
										provider.resumeTask(lastTask.id)
										await new Promise(resolve => setTimeout(resolve, 500)) // Wait for task to load
										await provider.postStateToWebview()
										outputChannel.appendLine(`[Society Agent] Task resumed successfully`)
									} else {
										outputChannel.appendLine(`[Society Agent] Task already active: ${currentTask.taskId}`)
									}
								}
							} else {
								outputChannel.appendLine(`[Society Agent] No task history found`)
							}
							break
						}
						attempts++
					}
					if (attempts >= 30) {
						outputChannel.appendLine(`[Society Agent] Timeout waiting for provider`)
					}
				} catch (error) {
					outputChannel.appendLine(`[Society Agent] Failed to resume task: ${error}`)
				}
				// kilocode_change end

				// Configure agent identity in the provider
				const { getAgentSystemPrompt, getAgentWelcomeMessage } = await import(
					"./services/society-agent/agent-prompts"
				)
				const customInstructions = getAgentSystemPrompt(role, capabilities || [], agentId)
				const welcomeMessage = getAgentWelcomeMessage(role, agentId)

				// Store agent identity in workspace state for the provider to use
				await context.workspaceState.update("societyAgent.customInstructions", customInstructions)
				await context.workspaceState.update("societyAgent.welcomeMessage", welcomeMessage)
				await context.workspaceState.update("societyAgent.identity", {
					id: agentId,
					role,
					capabilities,
				})

				outputChannel.appendLine(`[Society Agent] Configured chat identity for ${role}`)

				// Create status bar item for Society Agent
				const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
				statusBarItem.text = `🤖 ${role}`
				statusBarItem.tooltip = `Society Agent: ${agentId}\nClick to check messages`
				statusBarItem.command = "kilo-code.societyCheckMessages"
				statusBarItem.show()
				context.subscriptions.push(statusBarItem)
				
				// kilocode_change start - Add Stop Agent button
				const stopAgentButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99)
				stopAgentButton.text = `$(debug-stop) Stop Agent`
				stopAgentButton.tooltip = `Stop ${role} agent and close this window`
				stopAgentButton.command = "kilo-code.societyStopAgent"
				stopAgentButton.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground')
				stopAgentButton.show()
				context.subscriptions.push(stopAgentButton)
				
				// Register stop agent command
				const stopAgentCommand = vscode.commands.registerCommand(
					"kilo-code.societyStopAgent",
					async () => {
						const answer = await vscode.window.showWarningMessage(
							`Stop ${role} agent and close this window?`,
							{ modal: true },
							"Stop Agent",
							"Cancel"
						)
						
						if (answer === "Stop Agent") {
							outputChannel.appendLine(`[Society Agent] Stopping ${role} agent`)
							
							// Cleanup agent resources
							if (agentRegistry) {
								await agentRegistry.dispose()
							}
							
							// Close this VS Code window
							await vscode.commands.executeCommand("workbench.action.closeWindow")
						}
					}
				)
				context.subscriptions.push(stopAgentCommand)
				// kilocode_change end

				// Register command to manually check messages
				const checkMessagesCommand = vscode.commands.registerCommand(
					"kilo-code.societyCheckMessages",
					async () => {
						const messages = await agentRegistry?.getUndeliveredMessages() // kilocode_change - null safety
						if (!messages || messages.length === 0) {
							vscode.window.showInformationMessage(`No new messages for ${role}`)
							return
						}

						vscode.window.showInformationMessage(`${messages.length} new message(s) for ${role}`)

						// Process messages
						for (const msg of messages) {
							await agentRegistry?.markDelivered(msg.id) // kilocode_change - null safety
							const sender = msg.from === "user" ? "User" : msg.from
							const content =
								typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)

							// Show in chat
							const { ClineProvider } = await import("./core/webview/ClineProvider")
							const p = ClineProvider.getVisibleInstance()
							if (p) {
								const formatted = `📨 **Message from ${sender}** (${msg.type})\n\n${content}`
								await p.createTask(formatted)
							}
						}
					},
				)
				context.subscriptions.push(checkMessagesCommand)

				// kilocode_change end

				vscode.window.showInformationMessage(`🤖 Agent active: ${role} (waiting for messages)`)
			} else if (sharedDir) {
				// kilocode_change start - Initialize supervisor inbox for main workspace
				// This allows the supervisor in the main window to receive messages from workers
				const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
				const isMainWorkspace = workspacePath && !workspacePath.includes("-worker")
				
				if (isMainWorkspace) {
					outputChannel.appendLine(`[Society Agent] Setting up supervisor inbox for main workspace`)
					
					// Create simple agent registry for supervisor
					agentRegistry = new AgentRegistry(sharedDir, "supervisor")
					await agentRegistry.initialize()
					
					// Start supervisor agent loop
					const { SimpleAgentLoop } = await import("./services/society-agent/simple-agent-loop")
					const supervisorLoop = new SimpleAgentLoop(agentRegistry, "supervisor", "Supervisor", ["coordination"], sharedDir)
					await supervisorLoop.start()
					
					context.subscriptions.push({
						dispose: () => supervisorLoop.stop(),
					})
					
					// kilocode_change start - Add Stop All Agents button for supervisor
					const stopAllButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99)
					stopAllButton.text = `$(debug-stop) Stop All Agents`
					stopAllButton.tooltip = `Stop all worker agents and close supervisor`
					stopAllButton.command = "kilo-code.societyStopAllAgents"
					stopAllButton.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground')
					stopAllButton.show()
					context.subscriptions.push(stopAllButton)
					
					// Register stop all agents command
					const stopAllCommand = vscode.commands.registerCommand(
						"kilo-code.societyStopAllAgents",
						async () => {
							const answer = await vscode.window.showWarningMessage(
								`Stop all agents and close all windows?\n\nThis will:\n• Close all worker agent windows\n• Close supervisor window\n• Stop all agent processes`,
								{ modal: true },
								"Stop All",
								"Cancel"
							)
							
							if (answer === "Stop All") {
								outputChannel.appendLine(`[Society Agent] Stopping all agents`)
								
								// Kill all VS Code windows with "-worker" in their path
								const { exec } = await import("child_process")
								const util = await import("util")
								const execAsync = util.promisify(exec)
								
								try {
									// Close worker windows
									if (process.platform === "win32") {
										// Windows: taskkill
										await execAsync('taskkill /F /FI "WINDOWTITLE eq *-worker*" /IM Code.exe')
									} else {
										// Linux/Mac: pkill
										await execAsync('pkill -f "code.*-worker"')
									}
									
									outputChannel.appendLine(`[Society Agent] Worker windows closed`)
								} catch (error) {
									outputChannel.appendLine(`[Society Agent] Note: Some workers may already be closed`)
								}
								
								// Cleanup supervisor resources
								if (agentRegistry) {
									await agentRegistry.dispose()
								}
								
								// Close supervisor window
								await vscode.commands.executeCommand("workbench.action.closeWindow")
							}
						}
					)
					context.subscriptions.push(stopAllCommand)
					// kilocode_change end
					
					outputChannel.appendLine(`[Society Agent] Supervisor inbox polling started`)
				} else {
					outputChannel.appendLine("[Society Agent] Discovered .society-agent/ but no agent configured")
				}
				// kilocode_change end
			} else {
				outputChannel.appendLine("[Society Agent] Discovered .society-agent/ but no agent configured")
			}
		} else {
			outputChannel.appendLine("[Society Agent] Not a multi-agent project (no .society-agent/ found)")
		}
	} catch (error) {
		outputChannel.appendLine(`[Society Agent] Failed to initialize agent: ${error}`) // kilocode_change
	}
	// kilocode_change end

	// Initialize Roo Code Cloud service.
	const postStateListener = () => ClineProvider.getVisibleInstance()?.postStateToWebview()

	authStateChangedHandler = async (data: { state: AuthState; previousState: AuthState }) => {
		postStateListener()

		if (data.state === "logged-out") {
			try {
				await provider.remoteControlEnabled(false)
			} catch (error) {
				cloudLogger(
					`[authStateChangedHandler] remoteControlEnabled(false) failed: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		}

		// Handle Roo models cache based on auth state
		const handleRooModelsCache = async () => {
			try {
				await flushModels("roo")

				if (data.state === "active-session") {
					// Reload models with the new auth token
					const sessionToken = cloudService?.authService?.getSessionToken()
					await getModels({
						provider: "roo",
						baseUrl: process.env.ROO_CODE_PROVIDER_URL ?? "https://api.roocode.com/proxy",
						apiKey: sessionToken,
					})
					cloudLogger(`[authStateChangedHandler] Reloaded Roo models cache for active session`)
				} else {
					cloudLogger(`[authStateChangedHandler] Flushed Roo models cache on logout`)
				}
			} catch (error) {
				cloudLogger(
					`[authStateChangedHandler] Failed to handle Roo models cache: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		}

		if (data.state === "active-session" || data.state === "logged-out") {
			// kilocode_change: await handleRooModelsCache()
		}
	}

	settingsUpdatedHandler = async () => {
		const userInfo = CloudService.instance.getUserInfo()

		if (userInfo && CloudService.instance.cloudAPI) {
			try {
				provider.remoteControlEnabled(CloudService.instance.isTaskSyncEnabled())
			} catch (error) {
				cloudLogger(
					`[settingsUpdatedHandler] remoteControlEnabled failed: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		}

		postStateListener()
	}

	userInfoHandler = async ({ userInfo }: { userInfo: CloudUserInfo }) => {
		postStateListener()

		if (!CloudService.instance.cloudAPI) {
			cloudLogger("[userInfoHandler] CloudAPI is not initialized")
			return
		}

		try {
			provider.remoteControlEnabled(CloudService.instance.isTaskSyncEnabled())
		} catch (error) {
			cloudLogger(
				`[userInfoHandler] remoteControlEnabled failed: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	cloudService = await CloudService.createInstance(context, cloudLogger, {
		"auth-state-changed": authStateChangedHandler,
		"settings-updated": settingsUpdatedHandler,
		"user-info": userInfoHandler,
	})

	try {
		if (cloudService.telemetryClient) {
			// TelemetryService.instance.register(cloudService.telemetryClient) kilocode_change
		}
	} catch (error) {
		outputChannel.appendLine(
			`[CloudService] Failed to register TelemetryClient: ${error instanceof Error ? error.message : String(error)}`,
		)
	}

	// Add to subscriptions for proper cleanup on deactivate.
	context.subscriptions.push(cloudService)

	// Trigger initial cloud profile sync now that CloudService is ready.
	try {
		await provider.initializeCloudProfileSyncWhenReady()
	} catch (error) {
		outputChannel.appendLine(
			`[CloudService] Failed to initialize cloud profile sync: ${error instanceof Error ? error.message : String(error)}`,
		)
	}

	// Finish initializing the provider.
	TelemetryService.instance.setProvider(provider)

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ClineProvider.sideBarId, provider, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
	)

	// kilocode_change start
	if (!context.globalState.get("firstInstallCompleted")) {
		outputChannel.appendLine("First installation detected, opening Kilo Code sidebar!")
		try {
			await vscode.commands.executeCommand("kilo-code.SidebarProvider.focus")

			outputChannel.appendLine("Opening Kilo Code walkthrough")

			// this can crash, see:
			// https://discord.com/channels/1349288496988160052/1395865796026040470
			await vscode.commands.executeCommand(
				"workbench.action.openWalkthrough",
				"kilocode.kilo-code#kiloCodeWalkthrough",
				false,
			)

			// Enable autocomplete by default for new installs
			const currentGhostSettings = contextProxy.getValue("ghostServiceSettings")
			await contextProxy.setValue("ghostServiceSettings", {
				...currentGhostSettings,
				enableAutoTrigger: true,
				enableQuickInlineTaskKeybinding: true,
				enableSmartInlineTaskKeybinding: true,
			})
		} catch (error) {
			outputChannel.appendLine(`Error during first-time setup: ${error.message}`)
		} finally {
			await context.globalState.update("firstInstallCompleted", true)
		}
	}
	// kilocode_change end

	// Auto-import configuration if specified in settings
	try {
		await autoImportSettings(outputChannel, {
			providerSettingsManager: provider.providerSettingsManager,
			contextProxy: provider.contextProxy,
			customModesManager: provider.customModesManager,
		})
	} catch (error) {
		outputChannel.appendLine(
			`[AutoImport] Error during auto-import: ${error instanceof Error ? error.message : String(error)}`,
		)
	}

	registerCommands({ context, outputChannel, provider })

	/**
	 * We use the text document content provider API to show the left side for diff
	 * view by creating a virtual document for the original content. This makes it
	 * readonly so users know to edit the right side if they want to keep their changes.
	 *
	 * This API allows you to create readonly documents in VSCode from arbitrary
	 * sources, and works by claiming an uri-scheme for which your provider then
	 * returns text contents. The scheme must be provided when registering a
	 * provider and cannot change afterwards.
	 *
	 * Note how the provider doesn't create uris for virtual documents - its role
	 * is to provide contents given such an uri. In return, content providers are
	 * wired into the open document logic so that providers are always considered.
	 *
	 * https://code.visualstudio.com/api/extension-guides/virtual-documents
	 */
	const diffContentProvider = new (class implements vscode.TextDocumentContentProvider {
		provideTextDocumentContent(uri: vscode.Uri): string {
			return Buffer.from(uri.query, "base64").toString("utf-8")
		}
	})()

	context.subscriptions.push(
		vscode.workspace.registerTextDocumentContentProvider(DIFF_VIEW_URI_SCHEME, diffContentProvider),
	)

	context.subscriptions.push(vscode.window.registerUriHandler({ handleUri }))

	// Register code actions provider.
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider({ pattern: "**/*" }, new CodeActionProvider(), {
			providedCodeActionKinds: CodeActionProvider.providedCodeActionKinds,
		}),
	)

	// kilocode_change start - Kilo Code specific registrations
	const { kiloCodeWrapped } = getKiloCodeWrapperProperties()
	if (!kiloCodeWrapped) {
		// Only use autocomplete in VS Code
		registerGhostProvider(context, provider)
	} else {
		// Only foward logs in Jetbrains
		registerMainThreadForwardingLogger(context)
	}
	registerCommitMessageProvider(context, outputChannel) // kilocode_change
	// kilocode_change end - Kilo Code specific registrations

	registerCodeActions(context)
	registerTerminalActions(context)

	// Allows other extensions to activate once Kilo Code is ready.
	vscode.commands.executeCommand(`${Package.name}.activationCompleted`)

	// Implements the `RooCodeAPI` interface.
	const socketPath = process.env.KILO_IPC_SOCKET_PATH ?? process.env.ROO_CODE_IPC_SOCKET_PATH // kilocode_change
	const enableLogging = typeof socketPath === "string"

	// Watch the core files and automatically reload the extension host.
	if (process.env.NODE_ENV === "development") {
		const watchPaths = [
			{ path: context.extensionPath, pattern: "**/*.ts" },
			{ path: path.join(context.extensionPath, "../packages/types"), pattern: "**/*.ts" },
			{ path: path.join(context.extensionPath, "../packages/telemetry"), pattern: "**/*.ts" },
			{ path: path.join(context.extensionPath, "node_modules/@roo-code/cloud"), pattern: "**/*" },
		]

		console.log(
			`♻️♻️♻️ Core auto-reloading: Watching for changes in ${watchPaths.map(({ path }) => path).join(", ")}`,
		)

		// Create a debounced reload function to prevent excessive reloads
		let reloadTimeout: NodeJS.Timeout | undefined
		const DEBOUNCE_DELAY = 1_000

		const debouncedReload = (uri: vscode.Uri) => {
			if (reloadTimeout) {
				clearTimeout(reloadTimeout)
			}

			console.log(`♻️ ${uri.fsPath} changed; scheduling reload...`)

			reloadTimeout = setTimeout(() => {
				console.log(`♻️ Reloading host after debounce delay...`)
				vscode.commands.executeCommand("workbench.action.reloadWindow")
			}, DEBOUNCE_DELAY)
		}

		watchPaths.forEach(({ path: watchPath, pattern }) => {
			const relPattern = new vscode.RelativePattern(vscode.Uri.file(watchPath), pattern)
			const watcher = vscode.workspace.createFileSystemWatcher(relPattern, false, false, false)

			// Listen to all change types to ensure symlinked file updates trigger reloads.
			watcher.onDidChange(debouncedReload)
			watcher.onDidCreate(debouncedReload)
			watcher.onDidDelete(debouncedReload)

			context.subscriptions.push(watcher)
		})

		// Clean up the timeout on deactivation
		context.subscriptions.push({
			dispose: () => {
				if (reloadTimeout) {
					clearTimeout(reloadTimeout)
				}
			},
		})
	}

	// kilocode_change start: Initialize ManagedIndexer
	await checkAndRunAutoLaunchingTask(context)
	const managedIndexer = new ManagedIndexer(contextProxy)
	context.subscriptions.push(managedIndexer)
	void managedIndexer.start().catch((error) => {
		outputChannel.appendLine(
			`Failed to start ManagedIndexer: ${error instanceof Error ? error.message : String(error)}`,
		)
	})
	// kilocode_change end

	return new API(outputChannel, provider, socketPath, enableLogging)
}

// This method is called when your extension is deactivated.
export async function deactivate() {
	outputChannel.appendLine(`${Package.name} extension deactivated`)

	if (cloudService && CloudService.hasInstance()) {
		try {
			if (authStateChangedHandler) {
				CloudService.instance.off("auth-state-changed", authStateChangedHandler)
			}

			if (settingsUpdatedHandler) {
				CloudService.instance.off("settings-updated", settingsUpdatedHandler)
			}

			if (userInfoHandler) {
				CloudService.instance.off("user-info", userInfoHandler as any)
			}

			outputChannel.appendLine("CloudService event handlers cleaned up")
		} catch (error) {
			outputChannel.appendLine(
				`Failed to clean up CloudService event handlers: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	const bridge = BridgeOrchestrator.getInstance()

	if (bridge) {
		await bridge.disconnect()
	}

	await McpServerManager.cleanup(extensionContext)
	TelemetryService.instance.shutdown()
	TerminalRegistry.cleanup()
}
