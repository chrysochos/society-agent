// kilocode_change - new file
/**
 * KnowledgeManager - Maintains persistent Markdown-based knowledge for agents
 *
 * Each agent has a .agent-knowledge/ directory with:
 * - chat-history.md: All conversations
 * - inventory.md: Objects, entities, concepts (tangible and intangible)
 * - state.md: Current state vs desired state
 * - relationships.md: How things relate to each other
 * - decisions.md: Key decisions and rationale
 */

import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"

export interface ConversationEntry {
	timestamp: string
	from: string
	to: string
	type: string
	content: string
}

export class KnowledgeManager {
	private workspaceRoot: string
	private knowledgeDir: string

	constructor(workspaceRoot: string) {
		this.workspaceRoot = workspaceRoot
		this.knowledgeDir = path.join(workspaceRoot, ".agent-knowledge")
	}

	/**
	 * Initialize knowledge directory (just create empty directory)
	 */
	async initialize(): Promise<void> {
		await fs.mkdir(this.knowledgeDir, { recursive: true })
	}

	/**
	 * Get knowledge directory path
	 */
	getKnowledgeDir(): string {
		return this.knowledgeDir
	}
}
