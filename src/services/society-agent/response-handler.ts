// kilocode_change - new file
/**
 * Response Handler - Captures agent responses and routes them
 *
 * Monitors the chat for agent responses and sends them to appropriate recipients.
 * Supports @mentions and @all for routing.
 */

import * as vscode from "vscode"
import { AgentRegistry } from "./agent-registry"

export interface ResponseContext {
	lastSender: string // Who sent the last message to this agent
	conversationId: string
	timestamp: string
}

export class ResponseHandler {
	private registry: AgentRegistry
	private agentId: string
	private responseContext: ResponseContext | undefined

	constructor(registry: AgentRegistry, agentId: string) {
		this.registry = registry
		this.agentId = agentId
	}

	/**
	 * Set context from incoming message
	 */
	setContext(from: string, messageId: string): void {
		this.responseContext = {
			lastSender: from,
			conversationId: messageId,
			timestamp: new Date().toISOString(),
		}
	}

	/**
	 * Parse agent response and route it
	 *
	 * Supports:
	 * - Default: Routes to last sender
	 * - @agent-id: Routes to specific agent
	 * - @all: Broadcasts to everyone
	 */
	async routeResponse(responseText: string): Promise<void> {
		if (!this.responseContext) {
			console.log("[ResponseHandler] No context, skipping routing")
			return
		}

		// Parse @mentions
		const mentions = this.parseMentions(responseText)

		if (mentions.length === 0) {
			// No mentions - send to last sender
			await this.sendTo(this.responseContext.lastSender, responseText, "message")
		} else {
			// Has mentions - send to each mentioned agent
			for (const mention of mentions) {
				if (mention === "all") {
					// Broadcast
					await this.sendTo("broadcast", responseText, "message")
				} else {
					// Specific agent
					await this.sendTo(mention, responseText, "message")
				}
			}
		}
	}

	/**
	 * Parse @mentions from text
	 * Returns array of agent IDs
	 */
	private parseMentions(text: string): string[] {
		// Match @agent-id or @all
		const mentionRegex = /@([\w-]+)/g
		const matches = text.matchAll(mentionRegex)
		const mentions: string[] = []

		for (const match of matches) {
			mentions.push(match[1])
		}

		return mentions
	}

	/**
	 * Send message to recipient
	 */
	private async sendTo(to: string, content: string, type: string): Promise<void> {
		try {
			await this.registry.sendMessage({
				to,
				type,
				content,
			})
			console.log(`[ResponseHandler] Sent response to ${to}`)
		} catch (error) {
			console.error(`[ResponseHandler] Failed to send to ${to}:`, error)
		}
	}

	/**
	 * Clear context after routing
	 */
	clearContext(): void {
		this.responseContext = undefined
	}
}
