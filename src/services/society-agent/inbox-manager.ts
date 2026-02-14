// kilocode_change - new file
/**
 * Inbox Manager - Persistent message queue for society agents
 * 
 * Messages are stored as files in .society-agent/inbox/<agent-id>/ until acknowledged.
 * This ensures guaranteed delivery regardless of agent state.
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import { AgentMessage } from './types'
import { MessageSecurity } from './message-security' // kilocode_change
import { getLog } from './logger' // kilocode_change

export interface InboxMessage extends AgentMessage {
	/** File path where message is stored */
	filePath?: string
	/** When message was queued */
	queuedAt: string
	/** Number of delivery attempts */
	attempts?: number
}

export class InboxManager {
	private inboxRoot: string
	private security: MessageSecurity // kilocode_change

	constructor(projectRoot: string) {
		this.inboxRoot = path.join(projectRoot, '.society-agent', 'inbox')
		this.security = new MessageSecurity(projectRoot) // kilocode_change
	}

	// kilocode_change start
	async initialize(): Promise<void> {
		await this.security.initialize()
	}
	// kilocode_change end

	/**
	 * Queue a message for an agent (write to their inbox)
	 */
	async queueMessage(agentId: string, message: AgentMessage): Promise<void> {
		const agentInbox = path.join(this.inboxRoot, agentId)
		await fs.mkdir(agentInbox, { recursive: true })

		const inboxMessage: InboxMessage = {
			...message,
			queuedAt: new Date().toISOString(),
			attempts: 0,
		}

		const fileName = `${message.id}.json`
		const filePath = path.join(agentInbox, fileName)

		await fs.writeFile(filePath, JSON.stringify(inboxMessage, null, 2), 'utf-8')
		getLog().info(`[InboxManager] Queued message ${message.id} for ${agentId}`)
	}

	/**
	 * Get all pending messages for an agent (with signature verification)
	 * kilocode_change: Added signature verification
	 */
	async getPendingMessages(agentId: string): Promise<InboxMessage[]> {
		const agentInbox = path.join(this.inboxRoot, agentId)

		try {
			await fs.access(agentInbox)
		} catch {
			// Inbox doesn't exist yet
			return []
		}

		const files = await fs.readdir(agentInbox)
		const messages: InboxMessage[] = []

		for (const file of files) {
			if (!file.endsWith('.json')) continue

			const filePath = path.join(agentInbox, file)
			try {
				const content = await fs.readFile(filePath, 'utf-8')
				const message: InboxMessage = JSON.parse(content)
				
				// kilocode_change start - Verify message signature
				if (message.signature) { // kilocode_change - signature is now in AgentMessage type
					const isValid = await this.security.verifyMessage(message, message.from)
					if (!isValid) {
						getLog().warn(`[InboxManager] INVALID SIGNATURE on message ${file} from ${message.from} - REJECTED`)
						// Move to quarantine instead of delivering
						const quarantineDir = path.join(path.dirname(this.inboxRoot), 'quarantine')
						await fs.mkdir(quarantineDir, { recursive: true })
						await fs.rename(filePath, path.join(quarantineDir, file))
						continue
					}
					getLog().info(`[InboxManager] Verified signature for message ${file} from ${message.from}`)
				} else {
					getLog().warn(`[InboxManager] Message ${file} missing signature - accepting for backward compatibility`)
				}
				// kilocode_change end
				
				message.filePath = filePath
				messages.push(message)
			} catch (error) {
				getLog().error(`[InboxManager] Failed to read message ${file}:`, error)
			}
		}

		// Sort by timestamp (oldest first)
		return messages.sort((a, b) => 
			new Date(a.queuedAt).getTime() - new Date(b.queuedAt).getTime()
		)
	}

	/**
	 * Mark a message as acknowledged (delete from inbox)
	 */
	async acknowledge(message: InboxMessage): Promise<void> {
		if (!message.filePath) {
			getLog().warn('[InboxManager] Cannot acknowledge message without filePath')
			return
		}

		try {
			await fs.unlink(message.filePath)
			getLog().info(`[InboxManager] Acknowledged message ${message.id}`)
		} catch (error) {
			getLog().error(`[InboxManager] Failed to acknowledge ${message.id}:`, error)
		}
	}

	/**
	 * Increment delivery attempt count for a message
	 */
	async incrementAttempt(message: InboxMessage): Promise<void> {
		if (!message.filePath) return

		message.attempts = (message.attempts || 0) + 1

		try {
			await fs.writeFile(message.filePath, JSON.stringify(message, null, 2), 'utf-8')
		} catch (error) {
			getLog().error(`[InboxManager] Failed to update attempt count:`, error)
		}
	}

	/**
	 * Get count of pending messages for an agent
	 */
	async getPendingCount(agentId: string): Promise<number> {
		const messages = await this.getPendingMessages(agentId)
		return messages.length
	}

	/**
	 * Clear all messages for an agent (use with caution)
	 */
	async clearInbox(agentId: string): Promise<void> {
		const agentInbox = path.join(this.inboxRoot, agentId)

		try {
			await fs.rm(agentInbox, { recursive: true, force: true })
			getLog().info(`[InboxManager] Cleared inbox for ${agentId}`)
		} catch (error) {
			getLog().error(`[InboxManager] Failed to clear inbox:`, error)
		}
	}
}
