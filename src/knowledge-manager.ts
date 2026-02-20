// Society Agent - new file
/**
 * KnowledgeManager - Maintains persistent Markdown-based knowledge for agents
 *
 * Persistent agents get a .agent-knowledge/ directory with AI-created md files:
 * - chat-history.md: All conversations the agent has participated in
 * - inventory.md: Objects, entities, concepts — tangible and intangible
 * - state.md: Current state vs desired state
 * - relationships.md: How things relate to each other
 * - decisions.md: Key decisions and rationale
 *
 * These files are the agent's long-term memory. They persist across sessions
 * and purposes. Ephemeral agents skip this entirely.
 *
 * The AI agent is responsible for WRITING to these files based on what it learns.
 * The KnowledgeManager just provides the structure and read/append helpers.
 */

import * as fs from "fs/promises"
import * as path from "path"
import { getLog } from "./logger"
import type { AgentKnowledgeFiles } from "./types"

export interface ConversationEntry {
	timestamp: string
	from: string
	to: string
	type: string
	content: string
}

/**
 * Well-known knowledge file names
 */
const KNOWLEDGE_FILES = {
	chatHistory: "chat-history.md",
	inventory: "inventory.md",
	state: "state.md",
	relationships: "relationships.md",
	decisions: "decisions.md",
} as const

type KnowledgeFileKey = keyof typeof KNOWLEDGE_FILES

/**
 * Default templates for each knowledge file (created on first initialize)
 */
const FILE_TEMPLATES: Record<KnowledgeFileKey, string> = {
	chatHistory: `# Chat History

> All conversations this agent has participated in.
> New entries are appended at the bottom.

---

`,
	inventory: `# Inventory

> Objects, entities, concepts — tangible and intangible.
> The agent updates this as it discovers things in the codebase/project.

## Tangible (files, services, APIs, databases)

_None yet._

## Intangible (concepts, patterns, conventions, constraints)

_None yet._

`,
	state: `# State

> Current state vs desired state. Updated after each purpose/task.

## Current State

_Not yet assessed._

## Desired State

_Not yet defined._

## Gap Analysis

_None yet._

`,
	relationships: `# Relationships

> How things relate to each other — dependencies, ownership, data flow.

## Component Dependencies

_None yet._

## Agent Relationships

_None yet._

## Data Flow

_None yet._

`,
	decisions: `# Decisions

> Key decisions and rationale. Helps future sessions understand "why".

---

`,
}

export class KnowledgeManager {
	private workspaceRoot: string
	private knowledgeDir: string

	constructor(workspaceRoot: string) {
		this.workspaceRoot = workspaceRoot
		this.knowledgeDir = path.join(workspaceRoot, ".agent-knowledge")
	}

	/**
	 * Initialize knowledge directory and create template files if missing.
	 * Called on agent startup for persistent agents only.
	 */
	async initialize(): Promise<void> {
		await fs.mkdir(this.knowledgeDir, { recursive: true })

		// Create each knowledge file if it doesn't exist (preserve existing)
		for (const [key, filename] of Object.entries(KNOWLEDGE_FILES)) {
			const filePath = path.join(this.knowledgeDir, filename)
			try {
				await fs.access(filePath)
				// File exists — skip
			} catch {
				// File missing — create from template
				const template = FILE_TEMPLATES[key as KnowledgeFileKey]
				await fs.writeFile(filePath, template, "utf-8")
				getLog().info(`[KnowledgeManager] Created ${filename}`)
			}
		}

		getLog().info(`[KnowledgeManager] Initialized at ${this.knowledgeDir}`)
	}

	/**
	 * Get knowledge directory path
	 */
	getKnowledgeDir(): string {
		return this.knowledgeDir
	}

	// ─── Read operations ──────────────────────────────────────────

	/**
	 * Read a specific knowledge file
	 */
	async readFile(key: KnowledgeFileKey): Promise<string> {
		const filePath = path.join(this.knowledgeDir, KNOWLEDGE_FILES[key])
		try {
			return await fs.readFile(filePath, "utf-8")
		} catch {
			return ""
		}
	}

	/**
	 * Read all knowledge files (for giving the agent full context)
	 */
	async readAll(): Promise<AgentKnowledgeFiles> {
		const [chatHistory, inventory, state, relationships, decisions] = await Promise.all([
			this.readFile("chatHistory"),
			this.readFile("inventory"),
			this.readFile("state"),
			this.readFile("relationships"),
			this.readFile("decisions"),
		])
		return { chatHistory, inventory, state, relationships, decisions }
	}

	/**
	 * Get a summary of what knowledge exists (for quick context)
	 */
	async getSummary(): Promise<string> {
		const lines: string[] = ["## Agent Knowledge Summary", ""]

		for (const [key, filename] of Object.entries(KNOWLEDGE_FILES)) {
			const filePath = path.join(this.knowledgeDir, filename)
			try {
				const stat = await fs.stat(filePath)
				const content = await fs.readFile(filePath, "utf-8")
				const lineCount = content.split("\n").length
				const sizeKB = (stat.size / 1024).toFixed(1)
				lines.push(`- **${filename}**: ${lineCount} lines, ${sizeKB} KB`)
			} catch {
				lines.push(`- **${filename}**: _not created_`)
			}
		}

		return lines.join("\n")
	}

	// ─── Write operations (used by agents) ────────────────────────

	/**
	 * Append content to a knowledge file (most common operation).
	 * The agent calls this to add new information.
	 */
	async appendToFile(key: KnowledgeFileKey, content: string): Promise<void> {
		const filePath = path.join(this.knowledgeDir, KNOWLEDGE_FILES[key])
		await fs.appendFile(filePath, content + "\n", "utf-8")
	}

	/**
	 * Replace entire content of a knowledge file.
	 * Used when the agent rewrites/restructures knowledge.
	 */
	async writeFile(key: KnowledgeFileKey, content: string): Promise<void> {
		const filePath = path.join(this.knowledgeDir, KNOWLEDGE_FILES[key])
		await fs.writeFile(filePath, content, "utf-8")
	}

	/**
	 * Log a conversation entry to chat-history.md
	 */
	async logConversation(entry: ConversationEntry): Promise<void> {
		const md = [
			`### ${entry.timestamp}`,
			`**${entry.from}** → **${entry.to}** (${entry.type})`,
			"",
			entry.content,
			"",
			"---",
			"",
		].join("\n")

		await this.appendToFile("chatHistory", md)
	}

	/**
	 * Log a decision to decisions.md
	 */
	async logDecision(decision: {
		title: string
		context: string
		options: string[]
		chosen: string
		rationale: string
		agentId: string
	}): Promise<void> {
		const md = [
			`### ${new Date().toISOString()} — ${decision.title}`,
			"",
			`**Context:** ${decision.context}`,
			"",
			"**Options considered:**",
			...decision.options.map((o, i) => `${i + 1}. ${o}`),
			"",
			`**Chosen:** ${decision.chosen}`,
			"",
			`**Rationale:** ${decision.rationale}`,
			"",
			`_Decision by: ${decision.agentId}_`,
			"",
			"---",
			"",
		].join("\n")

		await this.appendToFile("decisions", md)
	}

	/**
	 * Update the state file (current vs desired)
	 */
	async updateState(current: string, desired: string, gaps?: string): Promise<void> {
		const md = [
			"# State",
			"",
			`> Last updated: ${new Date().toISOString()}`,
			"",
			"## Current State",
			"",
			current,
			"",
			"## Desired State",
			"",
			desired,
			"",
			"## Gap Analysis",
			"",
			gaps || "_No gaps identified._",
			"",
		].join("\n")

		await this.writeFile("state", md)
	}

	/**
	 * Add an item to the inventory
	 */
	async addInventoryItem(
		category: "tangible" | "intangible",
		name: string,
		description: string,
	): Promise<void> {
		const md = `- **${name}**: ${description}\n`
		// Simple append — the agent can rewrite the whole file if it wants to restructure
		await this.appendToFile("inventory", md)
	}

	/**
	 * Add a relationship entry
	 */
	async addRelationship(from: string, relation: string, to: string, notes?: string): Promise<void> {
		const md = `- ${from} —${relation}→ ${to}${notes ? ` _(${notes})_` : ""}\n`
		await this.appendToFile("relationships", md)
	}

	// ─── Lifecycle ────────────────────────────────────────────────

	/**
	 * Check if knowledge directory exists and has content
	 */
	async hasKnowledge(): Promise<boolean> {
		try {
			const files = await fs.readdir(this.knowledgeDir)
			return files.some((f) => f.endsWith(".md"))
		} catch {
			return false
		}
	}

	/**
	 * Delete all knowledge (for ephemeral cleanup)
	 */
	async clear(): Promise<void> {
		try {
			await fs.rm(this.knowledgeDir, { recursive: true, force: true })
			getLog().info(`[KnowledgeManager] Cleared knowledge at ${this.knowledgeDir}`)
		} catch {
			// Already gone
		}
	}
}

