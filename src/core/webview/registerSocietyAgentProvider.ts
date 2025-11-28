// kilocode_change - new file
import * as vscode from "vscode"
// Use simplified provider for MVP
import { SocietyAgentProvider } from "./SocietyAgentProvider.simple"

/**
 * Register Society Agent provider with VS Code extension
 */
export function registerSocietyAgentProvider(context: vscode.ExtensionContext): vscode.Disposable {
	const provider = new SocietyAgentProvider(context.extensionUri, context)

	const disposable = vscode.window.registerWebviewViewProvider(SocietyAgentProvider.viewType, provider, {
		webviewOptions: {
			retainContextWhenHidden: true, // Keep state when hidden
		},
	})

	context.subscriptions.push(disposable)

	// Register commands
	context.subscriptions.push(
		vscode.commands.registerCommand("kilocode.societyAgent.showDashboard", () => {
			vscode.commands.executeCommand("kilocode.societyAgentView.focus")
		}),
	)

	return disposable
}
