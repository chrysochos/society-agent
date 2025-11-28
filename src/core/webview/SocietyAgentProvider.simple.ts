// kilocode_change - new file
/**
 * Simplified Society Agent Provider - MVP Version
 *
 * This version focuses on dashboard rendering and message passing.
 * Full backend integration will be completed after API refinements.
 */

import * as vscode from "vscode"
import { getUri } from "./getUri"
import { getNonce } from "./getNonce"

export class SocietyAgentProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = "kilocode.societyAgentView"

	private _view?: vscode.WebviewView

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly context: vscode.ExtensionContext,
	) {}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri],
		}

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview)

		// Handle messages - simplified for MVP
		webviewView.webview.onDidReceiveMessage(async (data) => {
			await this._handleMessage(data)
		})
	}

	private async _handleMessage(data: any): Promise<void> {
		try {
			switch (data.type) {
				case "start-purpose":
					console.log("🚀 Purpose start requested:", data.description)
					this._sendToWebview({
						type: "error",
						message: "Society Agent backend integration in progress. Full functionality coming soon!",
					})
					break

				case "pause-agent":
				case "pause-all":
				case "resume-all":
				case "stop-purpose":
				case "send-message-to-agent":
				case "terminal-input":
				case "get-agent-status":
					console.log(`📬 Message received: ${data.type}`)
					this._sendToWebview({
						type: "error",
						message: `${data.type} - Backend integration coming soon`,
					})
					break

				default:
					console.warn("Unknown message type:", data.type)
			}
		} catch (error) {
			console.error("Error handling message:", error)
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

	private _getHtmlForWebview(webview: vscode.Webview): string {
		const scriptUri = getUri(webview, this._extensionUri, ["webview-ui", "build", "assets", "index.js"])
		const styleUri = getUri(webview, this._extensionUri, ["webview-ui", "build", "assets", "index.css"])
		const nonce = getNonce()

		// kilocode_change - Set viewType to indicate Society Agent view
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
</body>
</html>`
	}
}
