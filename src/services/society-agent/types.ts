// kilocode_change - new file
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

/**
 * Agent action log entry
 */
export interface AgentAction {
	/** Timestamp of action */
	timestamp: Date
	
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
	type: 'request' | 'response' | 'notification' | 'delegation'
	
	/** Message payload */
	payload: unknown
	
	/** Timestamp */
	timestamp: Date
	
	/** Reply-to message ID (for threading) */
	replyTo?: string
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
