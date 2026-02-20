// Society Agent - new file
/**
 * Agent Identity System - Ed25519 asymmetric key identity for society agents
 *
 * Each agent has a unique Ed25519 keypair:
 * - Private key: stored in .society-agent/agents/<agentId>/key.pem (mode 600)
 * - Public key: registered in project-plan.json (shared with all agents)
 *
 * Identity chain of trust:
 * 1. Supervisor creates team → generates keypair per agent
 * 2. Public keys stored in project-plan.json
 * 3. Private key stored in agent's identity directory
 * 4. Agent loads identity from identity.json (path passed via env var)
 * 5. All messages signed with agent's private key
 * 6. Receivers verify with sender's public key from project-plan.json
 *
 * This prevents impersonation: only the holder of the private key can sign as that agent.
 */

import * as crypto from "crypto"
import * as fs from "fs/promises"
import * as path from "path"
import { getLog } from "./logger"

/**
 * Agent identity stored in identity.json
 */
export interface AgentIdentityFile {
	/** Unique agent ID */
	agentId: string

	/** Agent role */
	role: string

	/** Agent capabilities */
	capabilities: string[]

	/** Path to private key file (relative to identity.json) */
	privateKeyPath: string

	/** Domain/specialty */
	domain?: string

	/** Workspace path this agent should work in */
	workspace?: string

	/** Team ID this agent belongs to */
	teamId: string

	/** When this identity was created */
	createdAt: string
}

/**
 * Signed message format
 */
export interface SignedMessage {
	/** Unique message ID (UUID) */
	id: string

	/** Sender agent ID */
	from: string

	/** Receiver agent ID (or "all" for broadcast) */
	to: string

	/** ISO 8601 timestamp */
	timestamp: string

	/** Random nonce for replay prevention */
	nonce: string

	/** Message type */
	type: "task_assign" | "task_complete" | "message" | "question" | "status_update" | "review_request" | "shutdown"

	/** Text content */
	content: string

	/** Optional structured data */
	data?: Record<string, unknown>

	/** Attachment references */
	attachments?: AttachmentRef[]

	/** Reply-to message ID (for threading) */
	replyTo?: string

	/** Ed25519 signature (base64) covering all fields above */
	signature: string

	/** Delivery tracking (not covered by signature) */
	delivered?: boolean
	deliveredAt?: string
}

/**
 * Attachment reference (file stored separately, referenced by path + hash)
 */
export interface AttachmentRef {
	/** Filename */
	name: string

	/** MIME type */
	type: string

	/** Relative path in .society-agent/attachments/<message-id>/ */
	path: string

	/** File size in bytes */
	size: number

	/** SHA-256 hash of file content */
	hash: string
}

/**
 * Message priority for routing when agent is busy
 */
export type MessagePriority = "interrupt" | "queue" | "log"

/**
 * Get message priority based on type
 */
export function getMessagePriority(type: SignedMessage["type"]): MessagePriority {
	switch (type) {
		case "shutdown":
		case "question":
		case "message":
			return "interrupt" // inject into current conversation

		case "task_assign":
		case "review_request":
			return "queue" // wait until current task finishes

		case "task_complete":
		case "status_update":
			return "log" // just log, don't disturb
	}
}

// Replay prevention: track seen nonces with TTL
const REPLAY_WINDOW_MS = 5 * 60 * 1000 // 5 minutes
const processedNonces = new Map<string, number>() // nonce → timestamp

/**
 * Clean up expired nonces periodically
 */
function cleanupNonces(): void {
	const now = Date.now()
	for (const [nonce, timestamp] of processedNonces) {
		if (now - timestamp > REPLAY_WINDOW_MS) {
			processedNonces.delete(nonce)
		}
	}
}

// Cleanup every minute
setInterval(cleanupNonces, 60_000)

/**
 * Check if a message is a replay attack
 */
export function isReplayAttack(message: SignedMessage): boolean {
	// Check timestamp window
	const messageAge = Date.now() - new Date(message.timestamp).getTime()
	if (messageAge > REPLAY_WINDOW_MS) {
		getLog().warn(`Message too old (${Math.round(messageAge / 1000)}s) — possible replay`)
		return true
	}

	// Check nonce
	if (processedNonces.has(message.nonce)) {
		getLog().warn(`Duplicate nonce ${message.nonce} — replay attack`)
		return true
	}

	// Track nonce
	processedNonces.set(message.nonce, Date.now())
	return false
}

/**
 * AgentIdentityManager - Handles key generation, signing, and verification
 */
export class AgentIdentityManager {
	private identity: AgentIdentityFile | null = null
	private privateKey: crypto.KeyObject | null = null
	private publicKeys: Map<string, crypto.KeyObject> = new Map()
	private authorizedAgents: Set<string> = new Set()
	private sharedDir: string

	constructor(sharedDir: string) {
		this.sharedDir = sharedDir
	}

	// ─── Identity Creation (Supervisor) ───────────────────────────────

	/**
	 * Create a new agent identity with Ed25519 keypair
	 * Called by the supervisor when creating a team
	 */
	async createAgentIdentity(
		agentId: string,
		role: string,
		capabilities: string[],
		teamId: string,
		workspace?: string,
		domain?: string,
	): Promise<{ identity: AgentIdentityFile; publicKeyPem: string }> {
		// Generate Ed25519 keypair
		const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
			publicKeyEncoding: { type: "spki", format: "pem" },
			privateKeyEncoding: { type: "pkcs8", format: "pem" },
		})

		// Create agent directory
		const agentDir = path.join(this.sharedDir, "agents", agentId)
		await fs.mkdir(agentDir, { recursive: true })

		// Write private key (owner-only permissions)
		const keyPath = path.join(agentDir, "key.pem")
		await fs.writeFile(keyPath, privateKey as string, { mode: 0o600 })

		// Create identity file
		const identity: AgentIdentityFile = {
			agentId,
			role,
			capabilities,
			privateKeyPath: "key.pem",
			teamId,
			workspace,
			domain,
			createdAt: new Date().toISOString(),
		}

		const identityPath = path.join(agentDir, "identity.json")
		await fs.writeFile(identityPath, JSON.stringify(identity, null, 2), "utf-8")

		getLog().info(`Created identity for ${agentId} at ${agentDir}`)

		return {
			identity,
			publicKeyPem: publicKey as string,
		}
	}

	/**
	 * Register an agent's public key in the team plan
	 * Called after createAgentIdentity for each agent
	 */
	async registerPublicKey(agentId: string, publicKeyPem: string): Promise<void> {
		const keysDir = path.join(this.sharedDir, "keys")
		await fs.mkdir(keysDir, { recursive: true })

		// Store public key
		const pubKeyPath = path.join(keysDir, `${agentId}.pub.pem`)
		await fs.writeFile(pubKeyPath, publicKeyPem, "utf-8")

		// Load into memory
		this.publicKeys.set(agentId, crypto.createPublicKey(publicKeyPem))
		this.authorizedAgents.add(agentId)

		getLog().info(`Registered public key for ${agentId}`)
	}

	// ─── Identity Loading (Agent Startup) ─────────────────────────────

	/**
	 * Load this agent's identity from identity.json
	 * Uses SOCIETY_AGENT_IDENTITY env var or explicit path
	 */
	async loadIdentity(identityPath?: string): Promise<AgentIdentityFile> {
		// Try env var first, then explicit path
		const resolvedPath = identityPath || process.env.SOCIETY_AGENT_IDENTITY

		if (!resolvedPath) {
			throw new Error("No identity path provided. Set SOCIETY_AGENT_IDENTITY env var or pass identityPath.")
		}

		// Read identity file
		const content = await fs.readFile(resolvedPath, "utf-8")
		this.identity = JSON.parse(content)

		// Load private key (relative to identity.json directory)
		const identityDir = path.dirname(resolvedPath)
		const keyPath = path.join(identityDir, this.identity!.privateKeyPath)
		const keyPem = await fs.readFile(keyPath, "utf-8")
		this.privateKey = crypto.createPrivateKey(keyPem)

		getLog().info(`Loaded identity: ${this.identity!.agentId} (${this.identity!.role})`)

		return this.identity!
	}

	/**
	 * Load all public keys from the keys directory
	 * Called on agent startup to know how to verify other agents
	 */
	async loadPublicKeys(): Promise<void> {
		const keysDir = path.join(this.sharedDir, "keys")

		try {
			const files = await fs.readdir(keysDir)
			for (const file of files) {
				if (!file.endsWith(".pub.pem")) continue

				const agentId = file.replace(".pub.pem", "")
				const keyPem = await fs.readFile(path.join(keysDir, file), "utf-8")
				this.publicKeys.set(agentId, crypto.createPublicKey(keyPem))
				this.authorizedAgents.add(agentId)
			}

			getLog().info(`Loaded ${this.publicKeys.size} public keys`)
		} catch {
			getLog().warn(`No keys directory found at ${keysDir}`)
		}
	}

	/**
	 * Load authorized agents list from project-plan.json
	 */
	async loadAuthorizedAgents(): Promise<void> {
		const planPath = path.join(this.sharedDir, "project-plan.json")

		try {
			const content = await fs.readFile(planPath, "utf-8")
			const plan = JSON.parse(content)

			if (plan.agents && Array.isArray(plan.agents)) {
				for (const agent of plan.agents) {
					if (agent.id || agent.agentId) {
						this.authorizedAgents.add(agent.id || agent.agentId)
					}
				}
			}

			getLog().info(`${this.authorizedAgents.size} authorized agents`)
		} catch {
			getLog().warn(`No project-plan.json found`)
		}
	}

	// ─── Signing ──────────────────────────────────────────────────────

	/**
	 * Sign a message with this agent's private key
	 * Returns the signature (base64)
	 */
	signMessage(message: Omit<SignedMessage, "signature" | "delivered" | "deliveredAt">): string {
		if (!this.privateKey) {
			throw new Error("No private key loaded. Call loadIdentity() first.")
		}

		const canonical = this.canonicalize(message)
		const signature = crypto.sign(null, Buffer.from(canonical), this.privateKey)
		return signature.toString("base64")
	}

	/**
	 * Create and sign a complete message
	 */
	createSignedMessage(
		to: string,
		type: SignedMessage["type"],
		content: string,
		options?: {
			data?: Record<string, unknown>
			attachments?: AttachmentRef[]
			replyTo?: string
		},
	): SignedMessage {
		if (!this.identity) {
			throw new Error("No identity loaded. Call loadIdentity() first.")
		}

		const messageBase = {
			id: crypto.randomUUID(),
			from: this.identity.agentId,
			to,
			timestamp: new Date().toISOString(),
			nonce: crypto.randomBytes(16).toString("hex"),
			type,
			content,
			...(options?.data && { data: options.data }),
			...(options?.attachments && { attachments: options.attachments }),
			...(options?.replyTo && { replyTo: options.replyTo }),
		}

		const signature = this.signMessage(messageBase)

		return {
			...messageBase,
			signature,
		}
	}

	// ─── Verification ─────────────────────────────────────────────────

	/**
	 * Verify a message's signature against the sender's public key
	 * Returns true if authentic, false if impersonation attempt
	 */
	verifyMessage(message: SignedMessage): boolean {
		const senderId = message.from

		// Check if sender is authorized
		if (!this.authorizedAgents.has(senderId)) {
			getLog().warn(`UNAUTHORIZED sender: ${senderId}`)
			return false
		}

		// Get sender's public key
		const publicKey = this.publicKeys.get(senderId)
		if (!publicKey) {
			getLog().warn(`No public key for sender: ${senderId}`)
			return false
		}

		// Verify signature
		const { signature, delivered, deliveredAt, ...messageData } = message
		const canonical = this.canonicalize(messageData)

		try {
			const isValid = crypto.verify(null, Buffer.from(canonical), publicKey, Buffer.from(signature, "base64"))

			if (!isValid) {
				getLog().warn(`INVALID SIGNATURE from ${senderId} — possible impersonation!`)
			}

			return isValid
		} catch (error) {
			getLog().error(`Verification error for ${senderId}:`, error)
			return false
		}
	}

	/**
	 * Full message validation: signature + replay + authorization
	 */
	validateMessage(message: SignedMessage): { valid: boolean; reason?: string } {
		// 1. Check authorization
		if (!this.authorizedAgents.has(message.from)) {
			return { valid: false, reason: `Unauthorized sender: ${message.from}` }
		}

		// 2. Check replay
		if (isReplayAttack(message)) {
			return { valid: false, reason: `Replay attack detected (nonce: ${message.nonce})` }
		}

		// 3. Verify signature
		if (!this.verifyMessage(message)) {
			return { valid: false, reason: `Invalid signature from ${message.from}` }
		}

		return { valid: true }
	}

	// ─── Helpers ──────────────────────────────────────────────────────

	/**
	 * Create canonical JSON string for signing/verification
	 * Sorts keys deterministically so signature is reproducible
	 */
	private canonicalize(obj: Record<string, unknown>): string {
		return JSON.stringify(obj, Object.keys(obj).sort())
	}

	/**
	 * Get this agent's ID
	 */
	getAgentId(): string {
		if (!this.identity) {
			throw new Error("No identity loaded")
		}
		return this.identity.agentId
	}

	/**
	 * Get this agent's role
	 */
	getRole(): string {
		if (!this.identity) {
			throw new Error("No identity loaded")
		}
		return this.identity.role
	}

	/**
	 * Get this agent's identity
	 */
	getIdentity(): AgentIdentityFile | null {
		return this.identity
	}

	// Society Agent start - Public key fingerprint for monitor display
	/**
	 * Get a short hex fingerprint of this agent's public key.
	 * Returns first 16 hex chars of the SHA-256 hash of the public key DER encoding.
	 */
	getFingerprint(): string | undefined {
		if (!this.privateKey) {
			return undefined
		}
		try {
			// Derive the public key from the private key
			const pubKey = crypto.createPublicKey(this.privateKey)
			const der = pubKey.export({ type: "spki", format: "der" })
			const hash = crypto.createHash("sha256").update(der).digest("hex")
			return hash.slice(0, 16)
		} catch {
			return undefined
		}
	}
	// Society Agent end

	/**
	 * Check if a given agent ID is authorized
	 */
	isAuthorized(agentId: string): boolean {
		return this.authorizedAgents.has(agentId)
	}

	/**
	 * Get the identity file path for an agent
	 */
	getIdentityPath(agentId: string): string {
		return path.join(this.sharedDir, "agents", agentId, "identity.json")
	}
}
