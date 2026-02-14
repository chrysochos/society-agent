// kilocode_change - new file
/**
 * Society Agent Provider - Full Implementation
 *
 * Connects the Society Agent Dashboard to backend services.
 */

import * as vscode from "vscode"
import { getUri } from "./getUri"
import { getNonce } from "./getNonce"
import { SocietyManager, SocietyManagerConfig } from "../../services/society-agent/society-manager"
import { PurposeContext } from "../../services/society-agent/purpose-analyzer"
import { getLog } from "../../services/society-agent/logger"

// kilocode_change start - Monitor data source interface
export interface MonitorDataSource {
	getIdentity(): {
		id: string
		name: string
		role: string
		capabilities: string[]
		domain?: string
		fingerprint?: string
		teamId?: string
	} | null
	getRegisteredAgents(): Array<{
		id: string
		name: string
		role: string
		status: string
		currentTask: string | null
		lastSeen: number
		domain?: string
	}>
	getQueueDepth(): number
	getRecentMessages(): Array<{
		id: string
		from: string
		to?: string
		type: string
		content: string
		timestamp: number
	}>
	getTeamStatus(): {
		teamId: string
		supervisorId: string
		workerCount: number
		activeWorkers: number
	} | null
}
// kilocode_change end

// kilocode_change start - Narrow interface for ClineProvider dependency
interface ClineProviderLike {
	contextProxy: {
		getProviderSettings(): Record<string, unknown>
	}
}
// kilocode_change end

export class SocietyAgentProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = "kilocode.societyAgentView"

	private _view?: vscode.WebviewView
	private societyManager?: SocietyManager
	private currentPurposeId?: string // kilocode_change
	private monitorDataSource?: MonitorDataSource // kilocode_change

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly context: vscode.ExtensionContext,
		private readonly clineProvider: ClineProviderLike, // kilocode_change
	) {
		// Society Manager will be initialized when webview resolves
		getLog().info("SocietyAgentProvider constructed")
		getLog().info("Extension URI:", _extensionUri.toString())
		getLog().info("ClineProvider available:", !!clineProvider)
	}

	// kilocode_change start - Real backend initialization
	private async initializeSocietyManager() {
		try {
			getLog().info("Initializing Society Manager...")
			
			// Get API handler from current provider settings
			const { buildApiHandler } = require("../../api")
			const providerSettings = this.clineProvider.contextProxy.getProviderSettings()
			
			getLog().info("Provider settings loaded:", {
				provider: providerSettings.apiProvider,
				model: providerSettings.apiModelId,
			})
			
		const apiHandler = buildApiHandler(providerSettings)
		getLog().info("API handler created successfully")

		// Get workspace folder path
		const workspaceFolders = vscode.workspace.workspaceFolders
		const workspacePath = workspaceFolders?.[0]?.uri.fsPath
		getLog().info("Workspace path:", workspacePath || "No workspace folder open")

		// Initialize Society Manager with callbacks
		// kilocode_change start - Derive sharedDir and enable multiWindow from config
		const path = require("path")
		const sharedDir = workspacePath ? path.join(workspacePath, ".society-agent") : undefined
		const config = vscode.workspace.getConfiguration("kilo-code")
		const multiWindow = config.get<boolean>("societyAgent.multiWindow", false)
		// kilocode_change end

		this.societyManager = new SocietyManager({
			apiHandler,
			workspacePath,
			sharedDir, // kilocode_change
			multiWindow, // kilocode_change
				onPurposeStarted: (purpose) => {
					getLog().info("Purpose started:", purpose.id)
					this._sendToWebview({
						type: "purpose-started",
						purpose: {
							id: purpose.id,
							description: purpose.description,
							progress: 10,
							status: "forming-team",
							startedAt: Date.now(),
						},
					})
				},
				onTeamFormed: (purposeId, teamSize) => {
					getLog().info("Team formed:", teamSize, "agents")
					const activePurpose = this.societyManager?.getState().activePurposes.get(purposeId)
					if (activePurpose) {
						const agents = activePurpose.team.getAllMembers().map((member) => ({
							id: member.identity.id,
							name: `${member.identity.role === "supervisor" ? "Supervisor" : "Worker"} (${member.identity.id.slice(-8)})`,
							role: member.identity.role,
							workerType: member.identity.workerType,
							status: "idle",
							currentTask: member.identity.role === "supervisor" ? "Planning work" : "Awaiting task",
							recentActivity: ["Agent created"],
						}))

						this._sendToWebview({
							type: "team-formed",
							agents,
						})

						this._sendToWebview({
							type: "progress-update",
							purposeId,
							progress: 25,
							status: "executing",
						})
					}
				},
				onProgressUpdate: (purposeId, progress) => {
					getLog().info(`Progress update: ${progress}%`)
					this._sendToWebview({
						type: "progress-update",
						purposeId,
						progress,
						status: "executing",
					})
				},
				onPurposeCompleted: (purpose, summary) => {
					getLog().info("Purpose completed:", purpose.id)
					this._sendToWebview({
						type: "purpose-completed",
						purposeId: purpose.id,
						result: summary,
					})
				},
				onMessage: (purposeId, agentId, message) => {
					this._sendToWebview({
						type: "terminal-output",
						agentId,
						output: message,
					})
				},
				onStatusChange: (purposeId, agentId, status, task) => {
					getLog().info(`Agent ${agentId} status: ${status}, task: ${task || "none"}`)
					this._sendToWebview({
						type: "agent-status-update",
						agentId,
						status,
						currentTask: task || "",
					})
				},
			})

			getLog().info("Society Manager initialized with real backend")
		} catch (error) {
			getLog().error("Failed to initialize Society Manager:", error)
			getLog().error("Error details:", error instanceof Error ? error.stack : String(error))
			
			// Show error notification
			vscode.window.showErrorMessage(
				"Failed to initialize Society Agent system. Check console for details.",
			)
		}
	}
	// kilocode_change end

	public async resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		getLog().info("Society Agent webview resolving...")
		this._view = webviewView

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri],
		}

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview)

	// Handle messages from webview
	webviewView.webview.onDidReceiveMessage(async (data) => {
		getLog().info("Received message from webview:", data.type, data)
		await this._handleMessage(data)
	})		// Initialize Society Manager now that webview is ready
		getLog().info("Initializing Society Manager...")
		await this.initializeSocietyManager()
		
		// Send initial status
		getLog().info("Sending status to webview:", this.societyManager ? "initialized" : "failed")
		this._sendToWebview({
			type: "status",
			initialized: !!this.societyManager,
		})
	}

	private async _handleMessage(data: any): Promise<void> {
		try {
			switch (data.type) {
				case "webview-ready": {
					getLog().info("Webview ready, Society Manager:", this.societyManager ? "initialized" : "not initialized")
					this._sendToWebview({
						type: "status",
						initialized: !!this.societyManager,
					})
					break
				}
				
				case "start-purpose": {
					// kilocode_change start - Real backend implementation
					getLog().info("Purpose start requested:", data.description)

					if (!this.societyManager) {
						getLog().error("Society Manager not initialized")
						this._sendToWebview({
							type: "error",
							message: "Society Agent system not initialized",
						})
						break
					}

					try {
						const purposeContext: PurposeContext = {
							description: data.description,
							constraints: data.constraints || [],
							successCriteria: data.successCriteria || [],
							context: data.context || "",
							attachments: data.attachments || [],
						}

						getLog().info("Starting purpose with Society Manager...")
						getLog().info("Purpose:", data.description)

						// Start the purpose - this will trigger callbacks
						const purposeId = await this.societyManager.startPurpose(purposeContext)
						this.currentPurposeId = purposeId

						getLog().info("Purpose started successfully with ID:", purposeId)
					} catch (error) {
						getLog().error("Failed to start purpose:", error)
						getLog().error("Error details:", error instanceof Error ? error.stack : String(error))
						
						this._sendToWebview({
							type: "error",
							message: error instanceof Error ? error.message : "Failed to start purpose",
						})
						
						// Show error notification
						vscode.window.showErrorMessage(`Society Agent Error: ${error instanceof Error ? error.message : "Failed to start purpose"}`)
					}
					// kilocode_change end

					break
				}

				case "pause-agent": {
					// kilocode_change start - Real pause agent implementation
					getLog().info("Pause agent:", data.agentId)
					if (this.societyManager && this.currentPurposeId) {
						try {
							const activePurpose = this.societyManager.getState().activePurposes.get(this.currentPurposeId)
							if (activePurpose) {
								const member = activePurpose.team.getAllMembers().find((m) => m.identity.id === data.agentId)
								if (member) {
									member.agent.pause()
									this._sendToWebview({
										type: "agent-status-update",
										agentId: data.agentId,
										status: "paused",
									})
								}
							}
						} catch (error) {
							getLog().error("Failed to pause agent:", error)
						}
					}
					break
					// kilocode_change end
				}

				case "pause-all": {
					// kilocode_change start - Real pause all implementation
					getLog().info("Pause all agents")
					if (this.societyManager && this.currentPurposeId) {
						try {
							this.societyManager.pausePurpose(this.currentPurposeId)
							// Notify webview of each agent's new status
							const activePurpose = this.societyManager.getState().activePurposes.get(this.currentPurposeId)
							if (activePurpose) {
								for (const member of activePurpose.team.getAllMembers()) {
									this._sendToWebview({
										type: "agent-status-update",
										agentId: member.identity.id,
										status: "paused",
									})
								}
							}
						} catch (error) {
							getLog().error("Failed to pause all:", error)
						}
					}
					break
					// kilocode_change end
				}

				case "resume-all": {
					// kilocode_change start - Real resume all implementation
					getLog().info("Resume all agents")
					if (this.societyManager && this.currentPurposeId) {
						try {
							this.societyManager.resumePurpose(this.currentPurposeId)
							// Notify webview of each agent's new status
							const activePurpose = this.societyManager.getState().activePurposes.get(this.currentPurposeId)
							if (activePurpose) {
								for (const member of activePurpose.team.getAllMembers()) {
									this._sendToWebview({
										type: "agent-status-update",
										agentId: member.identity.id,
										status: "working",
									})
								}
							}
						} catch (error) {
							getLog().error("Failed to resume all:", error)
						}
					}
					break
					// kilocode_change end
				}

				case "stop-purpose": {
					// kilocode_change start - Real stop implementation
					getLog().info("Stop purpose")
					if (this.societyManager && this.currentPurposeId) {
						try {
							this.societyManager.stopPurpose(this.currentPurposeId, "User requested stop")
							this.currentPurposeId = undefined
						} catch (error) {
							getLog().error("Failed to stop purpose:", error)
						}
					}
					break
					// kilocode_change end
				}

				case "send-message-to-agent": {
					// kilocode_change start - Real send message implementation
					getLog().info("Send message to agent:", data.agentId, data.message)
					if (this.societyManager && this.currentPurposeId) {
						try {
							const response = await this.societyManager.sendMessageToAgent(
								this.currentPurposeId,
								data.agentId,
								data.message,
							)
							// Send response back as a society-agent-message
							this._sendToWebview({
								type: "society-agent-message",
								agentId: data.agentId,
								toAgent: "human",
								message: response,
								timestamp: Date.now(),
							})
						} catch (error) {
							getLog().error("Failed to send message:", error)
							this._sendToWebview({
								type: "error",
								message: `Failed to send message to ${data.agentId}: ${error instanceof Error ? error.message : "Unknown error"}`,
							})
						}
					} else {
						this._sendToWebview({
							type: "error",
							message: "No active purpose — cannot send message",
						})
					}
					break
					// kilocode_change end
				}

				case "terminal-input": {
					// kilocode_change start - Real terminal input handling
					getLog().info("Terminal input:", data.agentId, data.input)

					if (!this.societyManager || !this.currentPurposeId) {
						break
					}

					try {
						const activePurpose = this.societyManager.getState().activePurposes.get(this.currentPurposeId)
						if (activePurpose) {
							const member = activePurpose.team.getAllMembers().find((m) => m.identity.id === data.agentId)
							if (member) {
								// Send input to agent's conversation
								const response = await member.agent.sendMessage(data.input)
								// Send response back to terminal
								this._sendToWebview({
									type: "terminal-output",
									agentId: data.agentId,
									output: `\n${response}\n`,
								})
							}
						}
					} catch (error) {
						getLog().error("Failed to send terminal input:", error)
					}
					break
					// kilocode_change end
				}

				case "get-agent-status": {
					// kilocode_change start - Real get-agent-status implementation
					getLog().info("Get agent status")
					if (this.societyManager && this.currentPurposeId) {
						const activePurpose = this.societyManager.getState().activePurposes.get(this.currentPurposeId)
						if (activePurpose) {
							const agents = activePurpose.team.getAllMembers().map((member) => ({
								id: member.identity.id,
								name: `${member.identity.role === "supervisor" ? "Supervisor" : "Worker"} (${member.identity.id.slice(-8)})`,
								role: member.identity.role,
								workerType: member.identity.workerType,
								status: member.agent.getState().status,
								currentTask: member.agent.getState().currentTask || undefined,
								recentActivity: [],
							}))
							this._sendToWebview({
								type: "team-formed",
								agents,
							})
						}
					}
					break
					// kilocode_change end
				}

				// kilocode_change start - Agent Monitor data refresh
				case "agent-monitor-refresh": {
					const monitorData = this.gatherMonitorData()
					this._sendToWebview({
						type: "agent-monitor-data",
						data: monitorData,
					})
					break
				}
				// kilocode_change end

				default:
					getLog().warn("Unknown message type:", data.type)
			}
		} catch (error) {
			getLog().error("Error handling message:", error)
			this._sendToWebview({
				type: "error",
				message: error instanceof Error ? error.message : "Unknown error",
			})
		}
	}

	private _sendToWebview(message: any): void {
		if (this._view) {
			this._view.webview.postMessage(message)
		}
	}

	// kilocode_change start - Push a new message event to the monitor in real time
	/**
	 * Push a real-time "agent-monitor-message" event to the webview.
	 * Called from extension.ts whenever a new message arrives.
	 */
	public pushMonitorMessage(message: {
		id: string
		from: string
		to?: string
		type: string
		content: string
		timestamp: number
	}): void {
		this._sendToWebview({
			type: "agent-monitor-message",
			message,
			queueDepth: this.monitorDataSource?.getQueueDepth() ?? 0,
		})
	}

	/**
	 * Push a full monitor data refresh to the webview.
	 */
	public pushMonitorRefresh(): void {
		const data = this.gatherMonitorData()
		this._sendToWebview({ type: "agent-monitor-data", data })
	}
	// kilocode_change end

	// kilocode_change start - Gather monitor data from all sources
	private gatherMonitorData() {
		if (this.monitorDataSource) {
			return {
				identity: this.monitorDataSource.getIdentity(),
				agents: this.monitorDataSource.getRegisteredAgents(),
				queueDepth: this.monitorDataSource.getQueueDepth(),
				recentMessages: this.monitorDataSource.getRecentMessages(),
				teamStatus: this.monitorDataSource.getTeamStatus(),
			}
		}

		// Fallback: gather from SocietyManager if available
		const state = this.societyManager?.getState()
		if (state && state.activePurposes.size > 0) {
			const firstPurpose = Array.from(state.activePurposes.values())[0]
			const members = firstPurpose?.team?.getAllMembers?.() ?? []
			return {
				identity: null,
				agents: members.map((m: any) => ({
					id: m.identity.id,
					name: m.identity.role === "supervisor"
						? `Supervisor (${m.identity.id.slice(-8)})`
						: `Worker (${m.identity.id.slice(-8)})`,
					role: m.identity.role,
					status: m.agent?.getState?.().status === "completed" ? "idle" : "busy",
					currentTask: m.agent?.getState?.().currentTask ?? null,
					lastSeen: Date.now(),
					domain: m.identity.workerType,
				})),
				queueDepth: 0,
				recentMessages: [],
				teamStatus: null,
			}
		}

		// No data available
		return {
			identity: null,
			agents: [],
			queueDepth: 0,
			recentMessages: [],
			teamStatus: null,
		}
	}
	// kilocode_change end

	// kilocode_change start - Set monitor data source (called from extension.ts after backend init)
	public setMonitorDataSource(source: MonitorDataSource): void {
		this.monitorDataSource = source
		getLog().info("Monitor data source connected to SocietyAgentProvider")
	}
	// kilocode_change end

	// kilocode_change start - Cleanup
	public dispose(): void {
		// Cleanup any active purposes
		if (this.societyManager && this.currentPurposeId) {
			this.societyManager.stopPurpose(this.currentPurposeId, "Extension disposing")
		}
	}
	// kilocode_change end

	private _getHtmlForWebview(webview: vscode.Webview): string {
		const scriptUri = getUri(webview, this._extensionUri, ["webview-ui", "build", "assets", "index.js"])
		const styleUri = getUri(webview, this._extensionUri, ["webview-ui", "build", "assets", "index.css"])
		const nonce = getNonce()

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<link rel="stylesheet" type="text/css" href="${styleUri}">
	<title>Society Agent</title>
</head>
<body data-vscode-view-type="societyAgent">
	<div id="root"></div>
	<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
	<script nonce="${nonce}">
		console.log("🌐 Society Agent webview loaded, view type:", document.body.dataset.vscodeViewType);
	</script>
</body>
</html>`
	}
}
