// Society Agent - new file
/**
 * Society Agent Type Definitions
 * 
 * Core types for the Society Agent framework, enabling multiple AI agents
 * to collaborate, coordinate, and communicate under supervisor oversight.
 */

/**
 * Agent role in the society hierarchy
 */
export type AgentRole = 
	| 'worker'      // Regular agent that performs tasks
	| 'supervisor'  // Oversees and coordinates other agents
	| 'coordinator' // Manages task delegation and orchestration

/**
 * Agent capabilities - what tools/actions an agent can perform
 */
export type AgentCapability =
	| 'file-read'
	| 'file-write'
	| 'file-delete'
	| 'shell-execute'
	| 'browser-control'
	| 'api-request'
	| 'code-analysis'
	| 'test-execution'
	| 'git-operations'
	| 'agent-messaging'
	| 'task-delegation'
	| 'approval-grant'

/**
 * Agent identity - who the agent is
 */
export interface AgentIdentity {
	/** Unique identifier for this agent instance */
	id: string
	
	/** Human-readable name for the agent */
	name: string
	
	/** Role in the agent hierarchy */
	role: AgentRole
	
	/** List of capabilities this agent has permission to use */
	capabilities: AgentCapability[]
	
	/** Optional domain/specialty (e.g., "testing", "documentation", "frontend") */
	domain?: string
	
	/** Timestamp when agent was created */
	createdAt: Date
}

/**
 * Agent metadata for logging and tracking
 */
export interface AgentMetadata {
	/** Agent identity */
	identity: AgentIdentity
	
	/** Current task ID being worked on */
	currentTaskId?: string
	
	/** Parent agent ID (if this agent was spawned by another) */
	parentAgentId?: string
	
	/** Supervisor agent ID (if this agent reports to a supervisor) */
	supervisorId?: string
	
	/** Session ID for grouping related agent activities */
	sessionId: string
	
	/** Path to agent's history log file */
	historyPath: string
}

// Society Agent start - Hierarchy, discovery, and lifecycle types

/**
 * Each VS Code instance is a **node** — operated by a human AND acting as an agent.
 * The human can always intervene, accept work from other agents, or override decisions.
 * Supervisor hierarchy governs regular delegated work; humans can bypass it.
 */

/**
 * Agent lifecycle mode — determines folder and knowledge behavior per VS Code instance.
 * - ephemeral: Created per purpose, temp workspace, disposed after completion. No persistent knowledge.
 * - persistent: Each VS Code has its own permanent folder with .agent-knowledge/.
 *               Knowledge survives across purposes and sessions.
 */
export type AgentLifecycle = "ephemeral" | "persistent"

/**
 * Supervision chain — ordered path from agent up through supervisors to human.
 * Index 0 = the agent itself, last = human.
 *
 * Used for:
 * - Escalation routing (who to ask next when stuck)
 * - Permission inheritance (supervisor can override worker decisions)
 * - Regular work delegation (tasks flow down the chain)
 *
 * Note: Humans can always send work DIRECTLY to any agent, bypassing the chain.
 * The chain is for agent→agent delegation under normal operation.
 */
export interface SupervisionChain {
	/** Ordered node IDs from agent → supervisor → ... → human */
	chain: string[]
	/** The human user node (always last in chain) */
	humanNodeId: string
}

/**
 * Entry in the agent directory — everything needed for discovery and communication.
 * Published to .society-agent/directory.json by each VS Code instance on startup.
 *
 * Key design:
 * - Each VS Code window = 1 directory entry
 * - The human at that VS Code can accept work from other agents via channels
 * - Persistent VS Code instances have their own .agent-knowledge/ folder
 * - Ephemeral ones get temp folders, cleaned up after purpose completion
 */
export interface AgentDirectoryEntry {
	/** Agent unique ID (per VS Code instance) */
	agentId: string
	/** Human-readable name */
	name: string
	/** Role in supervisor hierarchy */
	role: AgentRole
	/** Capabilities offered */
	capabilities: AgentCapability[]
	/** Domain specialty (e.g., "testing", "frontend") */
	domain?: string
	/** Who supervises this agent for regular work (agentId or "human" for top-level) */
	supervisorId: string
	/** Lifecycle mode — determines folder persistence */
	lifecycle: AgentLifecycle
	/** Workspace folder this VS Code instance owns */
	workspace: string
	/** HTTP endpoint for channel communication */
	url?: string
	/** Status */
	status: "online" | "offline" | "busy" | "paused"
	/** Last heartbeat ISO timestamp */
	lastSeen: string
	/** Knowledge directory path (persistent instances only, per-workspace) */
	knowledgeDir?: string
	/** Whether a human is actively using this VS Code instance */
	humanPresent?: boolean
	/** Can accept work from any agent (not just supervisor chain) */
	acceptsExternalWork?: boolean
}

/**
 * Markdown-based knowledge files maintained per persistent VS Code workspace.
 * Each VS Code instance has its own .agent-knowledge/ folder.
 * The AI creates and updates these files based on what it learns.
 * Humans can also read/edit them directly.
 */
export interface AgentKnowledgeFiles {
	/** All conversations the agent has participated in */
	chatHistory: string     // chat-history.md
	/** Objects, entities, concepts — tangible and intangible */
	inventory: string       // inventory.md
	/** Current state vs desired state */
	state: string           // state.md
	/** How things relate to each other */
	relationships: string   // relationships.md
	/** Key decisions and rationale */
	decisions: string       // decisions.md
}

// Society Agent end

/**
 * Agent action log entry
 */
export interface AgentAction {
	/** Timestamp of action (ISO 8601 string) */
	timestamp: string // Society Agent - standardize to ISO string for JSON round-trip
	
	/** Agent ID that performed the action */
	agentId: string
	
	/** Type of action performed */
	action: string
	
	/** Action parameters/details */
	params?: Record<string, unknown>
	
	/** Result of the action */
	result?: {
		success: boolean
		data?: unknown
		error?: string
	}
	
	/** Whether this action required approval */
	requiredApproval?: boolean
	
	/** Approver agent ID (if approval was needed) */
	approvedBy?: string
}

/**
 * Inter-agent message
 */
export interface AgentMessage {
	/** Message ID */
	id: string
	
	/** Sender agent ID */
	from: string
	
	/** Recipient agent ID */
	to: string
	
	/** Message type */
	type: 'message' | 'question' | 'task_assign' | 'task_complete' | 'status_update' | 'shutdown' // Society Agent - match actual usage
	
	/** Message content */
	content: any // Society Agent - match actual usage
	
	/** Timestamp (ISO string) */
	timestamp: string // Society Agent - match actual usage
	
	/** Delivery status */
	delivered: boolean // Society Agent - match actual usage
	
	/** Delivery timestamp */
	deliveredAt?: string // Society Agent
	
	/** Reply-to message ID (for threading) */
	replyTo?: string
	
	/** Message signature for verification */
	signature?: string // Society Agent
}

/**
 * Task delegation request
 */
export interface TaskDelegation {
	/** Delegation ID */
	id: string
	
	/** Delegating agent ID */
	delegatorId: string
	
	/** Agent ID to delegate to */
	delegateToId: string
	
	/** Task description */
	task: string
	
	/** Task context/parameters */
	context?: Record<string, unknown>
	
	/** Required capabilities for this task */
	requiredCapabilities: AgentCapability[]
	
	/** Priority level */
	priority: 'low' | 'medium' | 'high' | 'critical'
	
	/** Status */
	status: 'pending' | 'accepted' | 'in-progress' | 'completed' | 'failed'
	
	/** Result (when completed) */
	result?: unknown
	
	/** Timestamps */
	createdAt: Date
	acceptedAt?: Date
	completedAt?: Date
}

/**
 * Approval request for risky operations
 */
export interface ApprovalRequest {
	/** Request ID */
	id: string
	
	/** Requesting agent ID */
	requesterId: string
	
	/** Operation requiring approval */
	operation: string
	
	/** Operation details */
	details: Record<string, unknown>
	
	/** Risk level */
	riskLevel: 'low' | 'medium' | 'high' | 'critical'
	
	/** Status */
	status: 'pending' | 'approved' | 'denied'
	
	/** Approver ID (supervisor or human) */
	approverId?: string
	
	/** Approval reason/notes */
	notes?: string
	
	/** Timestamps */
	createdAt: Date
	respondedAt?: Date
}

/**
 * Society Agent configuration
 */
export interface SocietyAgentConfig {
	/** Enable Society Agent features */
	enabled: boolean
	
	/** Default agent role if not specified */
	defaultRole: AgentRole
	
	/** Default capabilities for worker agents */
	defaultCapabilities: AgentCapability[]
	
	/** Require approval for high-risk operations */
	requireApproval: boolean
	
	/** Operations that always require approval */
	alwaysRequireApproval: string[]
	
	/** Enable inter-agent messaging */
	enableMessaging: boolean
	
	/** Enable task delegation */
	enableDelegation: boolean
	
	/** Log all agent actions */
	logAllActions: boolean
	
	/** Log directory path */
	logDirectory: string
}
