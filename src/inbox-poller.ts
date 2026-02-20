// Society Agent - new file
/**
 * Inbox Poller - Polls inbox directory for new messages and feeds them
 * to the UnifiedMessageHandler
 *
 * This replaces the message-processing parts of SimpleAgentLoop and InboxManager.
 * It's one of two entry points into UnifiedMessageHandler (the other being HTTP).
 *
 * Polling flow:
 *   Every 3 seconds:
 *     scan .society-agent/inbox/<agentId>/
 *     for each .json file (not in processed/):
 *       read → parse → handler.handleMessage()
 *       handler deals with dedup, verify, route
 */

import * as fs from "fs/promises"
import * as path from "path"
import { UnifiedMessageHandler } from "./message-handler"
import { SignedMessage } from "./agent-identity"
import { getLog } from "./logger"

export interface InboxPollerOptions {
	/** Shared .society-agent directory path */
	sharedDir: string

	/** This agent's ID */
	agentId: string

	/** Poll interval in milliseconds (default: 3000) */
	pollIntervalMs?: number

	/** The unified message handler */
	handler: UnifiedMessageHandler
}

export class InboxPoller {
	private options: InboxPollerOptions
	private interval: NodeJS.Timeout | null = null
	private running = false
	private inboxDir: string

	constructor(options: InboxPollerOptions) {
		this.options = options
		this.inboxDir = path.join(options.sharedDir, "inbox", options.agentId)
	}

	/**
	 * Start polling
	 */
	async start(): Promise<void> {
		if (this.running) return

		this.running = true

		// Ensure inbox directory exists
		await fs.mkdir(this.inboxDir, { recursive: true })

		// Process any existing messages immediately (catch-up)
		await this.poll()

		// Start periodic polling
		const intervalMs = this.options.pollIntervalMs ?? 3000
		this.interval = setInterval(async () => {
			try {
				await this.poll()
			} catch (error) {
				getLog().error("Poll error:", error)
			}
		}, intervalMs)

		getLog().info(`Started for ${this.options.agentId} (${intervalMs}ms interval)`)
	}

	/**
	 * Stop polling
	 */
	stop(): void {
		if (this.interval) {
			clearInterval(this.interval)
			this.interval = null
		}
		this.running = false
		getLog().info(`Stopped for ${this.options.agentId}`)
	}

	/**
	 * Single poll cycle — scan inbox, process new messages
	 */
	private async poll(): Promise<void> {
		let files: string[]
		try {
			files = await fs.readdir(this.inboxDir)
		} catch {
			return // Inbox dir doesn't exist yet
		}

		// Filter to .json files only (skip processed/ directory)
		const messageFiles = files.filter((f) => f.endsWith(".json") && !f.startsWith("."))

		if (messageFiles.length === 0) return

		// Sort by filename (includes timestamp for ordering)
		messageFiles.sort()

		for (const file of messageFiles) {
			const filePath = path.join(this.inboxDir, file)

			try {
				// Check if it's a file (not directory like processed/)
				const stat = await fs.stat(filePath)
				if (!stat.isFile()) continue

				// Read and parse
				const content = await fs.readFile(filePath, "utf-8")
				const message: SignedMessage = JSON.parse(content)

				// Feed to unified handler
				const result = await this.options.handler.handleMessage(message)

				if (result.accepted) {
					// Handler moves to processed/ internally via confirmDelivery()
					getLog().info(`Delivered ${file}: ${result.reason || "accepted"}`)
				} else {
					getLog().info(`Skipped ${file}: ${result.reason}`)
					// If rejected (not just dedup), handler quarantines it
					// If dedup, leave it — confirmDelivery will clean up
					if (result.reason === "Already processed") {
						// Move to processed to avoid re-reading
						const processedDir = path.join(this.inboxDir, "processed")
						await fs.mkdir(processedDir, { recursive: true })
						await fs.rename(filePath, path.join(processedDir, file))
					}
				}
			} catch (error) {
				getLog().error(`Failed to process ${file}:`, error)
			}
		}
	}

	/**
	 * Get inbox stats
	 */
	async getStats(): Promise<{ pending: number; processed: number }> {
		let pending = 0
		let processed = 0

		try {
			const files = await fs.readdir(this.inboxDir)
			pending = files.filter((f) => f.endsWith(".json")).length
		} catch {
			// Inbox doesn't exist
		}

		try {
			const processedDir = path.join(this.inboxDir, "processed")
			const files = await fs.readdir(processedDir)
			processed = files.filter((f) => f.endsWith(".json")).length
		} catch {
			// Processed dir doesn't exist
		}

		return { pending, processed }
	}

	/**
	 * Clean up old processed messages (older than maxAge)
	 */
	async cleanupProcessed(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<number> {
		const processedDir = path.join(this.inboxDir, "processed")
		let cleaned = 0

		try {
			const files = await fs.readdir(processedDir)
			const now = Date.now()

			for (const file of files) {
				const filePath = path.join(processedDir, file)
				const stat = await fs.stat(filePath)

				if (now - stat.mtimeMs > maxAgeMs) {
					await fs.unlink(filePath)
					cleaned++
				}
			}
		} catch {
			// Dir doesn't exist
		}

		return cleaned
	}
}
