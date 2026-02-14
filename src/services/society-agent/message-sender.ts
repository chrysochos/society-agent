// kilocode_change - new file
/**
 * Message Sender - Sends messages to other agents via HTTP + inbox file
 *
 * Dual-delivery strategy:
 *   1. Always writes to recipient's inbox file (guaranteed delivery)
 *   2. Also tries HTTP for instant delivery (best-effort)
 *
 * The HTTP path is optional — if the agent is offline, the inbox file
 * ensures the message is there when the agent comes back online.
 */

import * as fs from "fs/promises"
import * as path from "path"
import * as http from "http"
import { AgentIdentityManager, SignedMessage, AttachmentRef } from "./agent-identity"
import { AttachmentManager, AttachmentInput } from "./attachment-manager"

export interface AgentEndpoint {
	agentId: string
	url?: string // HTTP URL if agent is online
	status: "online" | "offline" | "idle" | "busy"
}

export interface SendOptions {
	/** Recipient agent ID (or "all" for broadcast) */
	to: string

	/** Message type */
	type: SignedMessage["type"]

	/** Text content */
	content: string

	/** Optional structured data */
	data?: Record<string, unknown>

	/** Optional attachments */
	attachments?: AttachmentInput[]

	/** Reply to a specific message */
	replyTo?: string
}

export class MessageSender {
	private identityManager: AgentIdentityManager
	private attachmentManager: AttachmentManager
	private sharedDir: string
	private agentEndpoints: Map<string, AgentEndpoint> = new Map()

	constructor(sharedDir: string, identityManager: AgentIdentityManager) {
		this.sharedDir = sharedDir
		this.identityManager = identityManager
		this.attachmentManager = new AttachmentManager(sharedDir)
	}

	/**
	 * Update known agent endpoints (call periodically from registry)
	 */
	updateEndpoints(endpoints: AgentEndpoint[]): void {
		for (const ep of endpoints) {
			this.agentEndpoints.set(ep.agentId, ep)
		}
	}

	/**
	 * Send a message to another agent
	 */
	async send(options: SendOptions): Promise<SignedMessage> {
		const { to, type, content, data, attachments, replyTo } = options

		// 1. Store attachments if any
		let attachmentRefs: AttachmentRef[] | undefined
		let tempMessageId: string | undefined

		if (attachments && attachments.length > 0) {
			// Use a temp ID for attachment storage, will be replaced by actual message ID
			const crypto = await import("crypto")
			tempMessageId = crypto.randomUUID()
			attachmentRefs = await this.attachmentManager.storeAttachments(tempMessageId, attachments)
		}

		// 2. Create and sign message
		const message = this.identityManager.createSignedMessage(to, type, content, {
			data,
			attachments: attachmentRefs,
			replyTo,
		})

		// If we used a temp ID for attachments, rename the directory
		if (tempMessageId && attachmentRefs) {
			const oldDir = path.join(this.sharedDir, "attachments", tempMessageId)
			const newDir = path.join(this.sharedDir, "attachments", message.id)
			try {
				await fs.rename(oldDir, newDir)
				// Update paths in attachments
				message.attachments = attachmentRefs.map((ref) => ({
					...ref,
					path: ref.path.replace(tempMessageId!, message.id),
				}))
				// Re-sign with updated paths
				const { signature, delivered, deliveredAt, ...messageData } = message
				message.signature = this.identityManager.signMessage(messageData)
			} catch {
				// Keep temp ID if rename fails
			}
		}

		// 3. Determine recipients
		const recipients = to === "all" ? this.getAllAgentIds() : [to]

		for (const recipientId of recipients) {
			// Always write to inbox file (guaranteed delivery)
			await this.writeToInbox(recipientId, message)

			// Try HTTP for instant delivery (best-effort)
			const endpoint = this.agentEndpoints.get(recipientId)
			if (endpoint?.url && endpoint.status !== "offline") {
				try {
					await this.sendHttp(endpoint.url, message)
					console.log(`[MessageSender] HTTP delivery to ${recipientId} succeeded`)
				} catch (error) {
					console.log(`[MessageSender] HTTP delivery to ${recipientId} failed (inbox file will be picked up)`)
				}
			}
		}

		console.log(`[MessageSender] Sent ${type} to ${to}: ${content.substring(0, 80)}`)
		return message
	}

	/**
	 * Write message to recipient's inbox directory
	 */
	private async writeToInbox(agentId: string, message: SignedMessage): Promise<void> {
		const inboxDir = path.join(this.sharedDir, "inbox", agentId)
		await fs.mkdir(inboxDir, { recursive: true })

		const filePath = path.join(inboxDir, `${message.id}.json`)
		await fs.writeFile(filePath, JSON.stringify(message, null, 2), "utf-8")
	}

	/**
	 * Send message via HTTP (best-effort instant delivery)
	 */
	private async sendHttp(url: string, message: SignedMessage): Promise<void> {
		const postUrl = new URL("/api/message", url)
		const body = JSON.stringify(message)

		return new Promise<void>((resolve, reject) => {
			const req = http.request(
				{
					hostname: postUrl.hostname,
					port: postUrl.port,
					path: postUrl.pathname,
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"Content-Length": Buffer.byteLength(body),
					},
					timeout: 5000,
				},
				(res) => {
					if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
						resolve()
					} else {
						reject(new Error(`HTTP ${res.statusCode}`))
					}

					// Consume response body
					res.resume()
				},
			)

			req.on("error", reject)
			req.on("timeout", () => {
				req.destroy()
				reject(new Error("HTTP timeout"))
			})

			req.write(body)
			req.end()
		})
	}

	/**
	 * Get all known agent IDs (for broadcast)
	 */
	private getAllAgentIds(): string[] {
		return Array.from(this.agentEndpoints.keys()).filter((id) => id !== this.identityManager.getAgentId())
	}
}
