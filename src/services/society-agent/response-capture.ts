// kilocode_change - new file
import * as vscode from "vscode"
import { AgentRegistry } from "./agent-registry"

/**
 * Captures agent responses from completed tasks and routes them to appropriate recipients.
 * This enables automatic agent-to-agent communication without human intervention.
 */

export class ResponseCapture {
	private static instance: ResponseCapture | undefined
	private capturedResponses: Map<string, string> = new Map()

	constructor(
		private registry: AgentRegistry,
		private agentId: string,
	) {}

	static getInstance(registry: AgentRegistry, agentId: string): ResponseCapture {
		if (!ResponseCapture.instance) {
			ResponseCapture.instance = new ResponseCapture(registry, agentId)
		}
		return ResponseCapture.instance
	}

	/**
	 * Monitor task completion and capture final response
	 */
	async captureTaskResponse(taskId: string, response: string): Promise<void> {
		this.capturedResponses.set(taskId, response)
		console.log(`[ResponseCapture] Captured response for task ${taskId}`)

		// Route the response to the appropriate recipient
		await this.routeResponse(response)
	}

	/**
	 * Route response based on context or @mentions
	 */
	private async routeResponse(response: string): Promise<void> {
		try {
			// Check for @mentions in response
			const mentions = this.extractMentions(response)

			if (mentions.length > 0) {
				// Send to mentioned recipients
				for (const recipient of mentions) {
					await this.sendResponse(recipient, response)
				}
			} else {
				// Check ResponseHandler context for default recipient
				const { ResponseHandler } = await import("./response-handler")
				const handler = new ResponseHandler(this.registry, this.agentId) // kilocode_change - no getInstance
				const context = (handler as any).responseContext as
					| { lastSender?: string; replyTo?: string }
					| undefined // kilocode_change - access private field

				if (context?.lastSender && context.replyTo !== "user") {
					// Reply to the agent who sent the original message
					await this.sendResponse(context.lastSender!, response) // kilocode_change
				} else if (context?.lastSender === "user") {
					// Notify user
					vscode.window.showInformationMessage(
						`📨 ${this.agentId} completed task:\n\n${this.truncate(response, 200)}`,
					)
				}
			}
		} catch (error) {
			console.error("[ResponseCapture] Failed to route response:", error)
		}
	}

	/**
	 * Extract @mentions from response text
	 */
	private extractMentions(text: string): string[] {
		const mentionRegex = /@([\w-]+)/g
		const mentions: string[] = []
		let match

		while ((match = mentionRegex.exec(text)) !== null) {
			const recipient = match[1]
			if (recipient !== "all") {
				mentions.push(recipient)
			} else {
				// @all means broadcast
				return ["@all"]
			}
		}

		return mentions
	}

	/**
	 * Send response to recipient via AgentRegistry
	 */
	private async sendResponse(recipient: string, response: string): Promise<void> {
		try {
			await this.registry.sendMessage(recipient, "message", response) // kilocode_change - positional args

			console.log(`[ResponseCapture] Routed response to ${recipient}`)
		} catch (error) {
			console.error(`[ResponseCapture] Failed to send response to ${recipient}:`, error)
		}
	}

	/**
	 * Truncate text for display
	 */
	private truncate(text: string, maxLength: number): string {
		if (text.length <= maxLength) return text
		return text.substring(0, maxLength) + "..."
	}

	/**
	 * Clear captured responses (cleanup)
	 */
	clear(): void {
		this.capturedResponses.clear()
	}
}
