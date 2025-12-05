// kilocode_change - new file
import * as vscode from "vscode"
// kilocode_change - switched to full provider
import { SocietyAgentProvider } from "./SocietyAgentProvider"
import { ClineProvider } from "./ClineProvider" // kilocode_change

/**
 * Register Society Agent provider with VS Code extension
 */
export function registerSocietyAgentProvider(
	context: vscode.ExtensionContext,
	clineProvider: ClineProvider,
): vscode.Disposable {
	// kilocode_change - added clineProvider param
	// Create output channel for Society Agent logs
	const outputChannel = vscode.window.createOutputChannel("Society Agent")
	context.subscriptions.push(outputChannel)

	outputChannel.appendLine("Society Agent system initializing...")
	console.log("Society Agent: Registering provider...")

	try {
		const provider = new SocietyAgentProvider(context.extensionUri, context, clineProvider) // kilocode_change

		const disposable = vscode.window.registerWebviewViewProvider(SocietyAgentProvider.viewType, provider, {
			webviewOptions: {
				retainContextWhenHidden: true, // Keep state when hidden
			},
		})

		outputChannel.appendLine("✅ Society Agent provider registered successfully")
		console.log("Society Agent: Provider registered successfully")

		context.subscriptions.push(disposable)

		// Register commands
		context.subscriptions.push(
			vscode.commands.registerCommand("kilocode.societyAgent.showDashboard", () => {
				vscode.commands.executeCommand("kilocode.societyAgentView.focus")
			}),
		)

		outputChannel.appendLine("✅ Society Agent commands registered")
		outputChannel.appendLine("Open 'Society Agent' view to start using the system")

		return disposable
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error)
		outputChannel.appendLine(`❌ Failed to register Society Agent: ${errorMsg}`)
		console.error("Society Agent registration error:", error)
		vscode.window.showErrorMessage(`Society Agent failed to initialize: ${errorMsg}`)
		throw error
	}
}
