// Society Agent - new file
/**
 * Message Security - Cryptographic signing and verification for agent messages
 *
 * Uses HMAC-SHA256 with per-agent secrets to ensure:
 * - Sender authenticity (only sender with secret can create valid signature)
 * - Message integrity (tampering invalidates signature)
 */

import * as crypto from "crypto"
import * as fs from "fs/promises"
import * as path from "path"
import { getLog } from "./logger" // Society Agent

export class MessageSecurity {
	private keysDir: string

	constructor(sharedDir: string) {
		this.keysDir = path.join(sharedDir, ".society-agent", "keys")
	}

	/**
	 * Initialize keys directory
	 */
	async initialize(): Promise<void> {
		await fs.mkdir(this.keysDir, { recursive: true })
	}

	/**
	 * Generate or load secret key for an agent
	 */
	async getAgentSecret(agentId: string): Promise<string> {
		const keyPath = path.join(this.keysDir, `${agentId}.key`)

		try {
			// Try to load existing key
			return await fs.readFile(keyPath, "utf-8")
		} catch {
			// Generate new key
			const secret = crypto.randomBytes(32).toString("hex")
			await fs.writeFile(keyPath, secret, { mode: 0o600 }) // Owner read/write only
			getLog().info(`[MessageSecurity] Generated new key for ${agentId}`)
			return secret
		}
	}

	/**
	 * Sign a message with sender's secret
	 */
	async signMessage(message: any, senderId: string): Promise<string> {
		const secret = await this.getAgentSecret(senderId)

		// Create canonical message string (exclude signature field)
		const { signature, ...messageData } = message
		const canonical = JSON.stringify(messageData, Object.keys(messageData).sort())

		// Generate HMAC-SHA256 signature
		const hmac = crypto.createHmac("sha256", secret)
		hmac.update(canonical)
		return hmac.digest("hex")
	}

	/**
	 * Verify a message signature
	 */
	async verifyMessage(message: any, senderId: string): Promise<boolean> {
		if (!message.signature) {
			getLog().warn(`[MessageSecurity] Message missing signature`)
			return false
		}

		try {
			const secret = await this.getAgentSecret(senderId)

			// Recreate canonical message string
			const { signature, ...messageData } = message
			const canonical = JSON.stringify(messageData, Object.keys(messageData).sort())

			// Verify HMAC-SHA256 signature
			const hmac = crypto.createHmac("sha256", secret)
			hmac.update(canonical)
			const expectedSignature = hmac.digest("hex")

			// Constant-time comparison to prevent timing attacks
			return crypto.timingSafeEqual(Buffer.from(message.signature, "hex"), Buffer.from(expectedSignature, "hex"))
		} catch (error) {
			getLog().error(`[MessageSecurity] Verification failed:`, error)
			return false
		}
	}

	/**
	 * Check if an agent is registered (has a key)
	 */
	async isAgentRegistered(agentId: string): Promise<boolean> {
		const keyPath = path.join(this.keysDir, `${agentId}.key`)
		try {
			await fs.access(keyPath)
			return true
		} catch {
			return false
		}
	}

	/**
	 * List all registered agents
	 */
	async listAgents(): Promise<string[]> {
		try {
			const files = await fs.readdir(this.keysDir)
			return files.filter((f) => f.endsWith(".key")).map((f) => f.replace(".key", ""))
		} catch {
			return []
		}
	}
}
