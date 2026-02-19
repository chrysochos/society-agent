// kilocode_change - new file
/**
 * Attachment Manager - Store, reference, and verify file attachments
 *
 * Attachments are stored by reference (not embedded in messages):
 *   .society-agent/attachments/<message-id>/filename.ext
 *
 * Each attachment has a SHA-256 hash in the message metadata.
 * Receivers verify the hash before processing.
 *
 * Size limits:
 *   Single file: 10 MB
 *   Total per message: 50 MB
 *   Max attachments per message: 10
 */

import * as crypto from "crypto"
import * as fs from "fs/promises"
import * as path from "path"
import { AttachmentRef } from "./agent-identity"
import { getLog } from "./logger" // kilocode_change

export interface AttachmentInput {
	/** Original filename */
	name: string

	/** MIME type */
	type: string

	/** File content (Buffer or path to source file) */
	content: Buffer | string
}

export const ATTACHMENT_LIMITS = {
	/** Max single file size: 10 MB */
	MAX_FILE_SIZE: 10 * 1024 * 1024,

	/** Max total per message: 50 MB */
	MAX_TOTAL_SIZE: 50 * 1024 * 1024,

	/** Max attachments per message */
	MAX_COUNT: 10,
} as const

export class AttachmentManager {
	private attachmentsRoot: string

	constructor(sharedDir: string) {
		this.attachmentsRoot = path.join(sharedDir, "attachments")
	}

	/**
	 * Store attachments for a message and return references
	 */
	async storeAttachments(messageId: string, inputs: AttachmentInput[]): Promise<AttachmentRef[]> {
		// Validate limits
		if (inputs.length > ATTACHMENT_LIMITS.MAX_COUNT) {
			throw new Error(`Too many attachments: ${inputs.length} (max ${ATTACHMENT_LIMITS.MAX_COUNT})`)
		}

		const messageDir = path.join(this.attachmentsRoot, messageId)
		await fs.mkdir(messageDir, { recursive: true })

		const refs: AttachmentRef[] = []
		let totalSize = 0

		for (const input of inputs) {
			// Read content
			let data: Buffer
			if (typeof input.content === "string") {
				// Path to source file — read it
				data = await fs.readFile(input.content)
			} else {
				data = input.content
			}

			// Check size limits
			if (data.length > ATTACHMENT_LIMITS.MAX_FILE_SIZE) {
				throw new Error(
					`Attachment ${input.name} too large: ${data.length} bytes (max ${ATTACHMENT_LIMITS.MAX_FILE_SIZE})`,
				)
			}
			totalSize += data.length
			if (totalSize > ATTACHMENT_LIMITS.MAX_TOTAL_SIZE) {
				throw new Error(
					`Total attachment size exceeds limit: ${totalSize} bytes (max ${ATTACHMENT_LIMITS.MAX_TOTAL_SIZE})`,
				)
			}

			// Sanitize filename
			const safeName = this.sanitizeFilename(input.name)

			// Write file
			const filePath = path.join(messageDir, safeName)
			await fs.writeFile(filePath, data)

			// Compute hash
			const hash = "sha256:" + crypto.createHash("sha256").update(data).digest("hex")

			// Create reference
			refs.push({
				name: input.name,
				type: input.type,
				path: path.join("attachments", messageId, safeName),
				size: data.length,
				hash,
			})
		}

		getLog().info(`[AttachmentManager] Stored ${refs.length} attachments for message ${messageId}`)
		return refs
	}

	/**
	 * Read an attachment by reference
	 */
	async readAttachment(ref: AttachmentRef): Promise<Buffer> {
		const fullPath = path.join(path.dirname(this.attachmentsRoot), ref.path)
		return fs.readFile(fullPath)
	}

	/**
	 * Verify an attachment's integrity
	 */
	async verifyAttachment(ref: AttachmentRef): Promise<boolean> {
		try {
			const data = await this.readAttachment(ref)
			const hash = "sha256:" + crypto.createHash("sha256").update(data).digest("hex")
			return hash === ref.hash
		} catch {
			return false
		}
	}

	/**
	 * Clean up attachments for a message
	 */
	async cleanupAttachments(messageId: string): Promise<void> {
		const messageDir = path.join(this.attachmentsRoot, messageId)
		try {
			await fs.rm(messageDir, { recursive: true, force: true })
			getLog().info(`[AttachmentManager] Cleaned up attachments for ${messageId}`)
		} catch {
			// Ignore
		}
	}

	/**
	 * Clean up all attachments older than maxAge (ms)
	 */
	async cleanupOld(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
		let cleaned = 0
		try {
			const dirs = await fs.readdir(this.attachmentsRoot)
			const now = Date.now()

			for (const dir of dirs) {
				const dirPath = path.join(this.attachmentsRoot, dir)
				const stats = await fs.stat(dirPath)

				if (now - stats.mtimeMs > maxAgeMs) {
					await fs.rm(dirPath, { recursive: true, force: true })
					cleaned++
				}
			}
		} catch {
			// Attachments dir may not exist yet
		}

		if (cleaned > 0) {
			getLog().info(`[AttachmentManager] Cleaned up ${cleaned} old attachment directories`)
		}
		return cleaned
	}

	/**
	 * Sanitize filename to prevent path traversal
	 */
	private sanitizeFilename(name: string): string {
		// Remove path separators and dangerous characters
		// eslint-disable-next-line no-control-regex
		const controlChars = /[\x00-\x1f]/g
		return name
			.replace(/[/\\]/g, "_")
			.replace(/\.\./g, "_")
			.replace(/[<>:"|?*]/g, "_")
			.replace(controlChars, "")
			.substring(0, 255) // Max filename length
	}
}
