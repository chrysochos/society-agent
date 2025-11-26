// kilocode_change - new file
/**
 * Task-specific logging utilities for Society Agent framework
 * 
 * This module provides helper functions for logging agent actions
 * within the Task execution context, including tool executions,
 * API calls, and decision points in the agentic loop.
 */

import { SocietyAgentLogger, createAgentLogger } from "./logger"
import type { AgentMetadata, AgentCapability } from "./types"

/**
 * Extended metadata for task-specific logging
 */
export interface TaskLoggerMetadata extends AgentMetadata {
	/** Current task ID being executed */
	currentTaskId: string
	/** Root task ID (for nested task hierarchies) */
	rootTaskId?: string
	/** Parent task ID (for subtasks) */
	parentTaskId?: string
}

/**
 * Task logger with specialized methods for common task operations
 */
export class TaskLogger extends SocietyAgentLogger {
	private taskId: string
	private rootTaskId?: string
	private parentTaskId?: string

	constructor(metadata: TaskLoggerMetadata) {
		super(metadata)
		this.taskId = metadata.currentTaskId
		this.rootTaskId = metadata.rootTaskId
		this.parentTaskId = metadata.parentTaskId
	}

	/**
	 * Log a tool execution
	 */
	async logToolExecution(
		toolName: string,
		params: Record<string, unknown>,
		result?: unknown,
		error?: Error,
		requiredApproval?: boolean,
		approvedBy?: string,
	): Promise<void> {
		const action = `tool:${toolName}`
		if (error) {
			await this.logError(action, error)
		} else {
			await this.logAction(action, params, { success: true, data: result }, requiredApproval, approvedBy)
		}
	}

	/**
	 * Log an LLM API call
	 */
	async logApiCall(
		provider: string,
		model: string,
		tokensUsed: number,
		latencyMs: number,
		error?: Error,
	): Promise<void> {
		const action = "api:llm-call"
		const params = { provider, model, tokensUsed, latencyMs }
		
		if (error) {
			await this.logError(action, error)
		} else {
			await this.logSuccess(action, params)
		}
	}

	/**
	 * Log a capability check
	 */
	async logCapabilityCheck(
		capability: AgentCapability,
		allowed: boolean,
		reason?: string,
	): Promise<void> {
		await this.logAction(
			"permission:capability-check",
			{ capability, allowed, reason },
			{ success: true, data: { allowed } },
		)
	}

	/**
	 * Log an approval request
	 */
	async logApprovalRequested(
		operation: string,
		details: Record<string, unknown>,
		approved: boolean,
		approvedBy?: string,
	): Promise<void> {
		await this.logAction(
			"approval:requested",
			{ operation, ...details },
			{ success: true, data: { approved, approvedBy } },
			true, // This required approval
			approvedBy,
		)
	}

	/**
	 * Log task delegation to another agent
	 */
	async logTaskDelegation(
		delegateToId: string,
		delegateToRole: string,
		taskDescription: string,
		requiredCapabilities: AgentCapability[],
	): Promise<void> {
		await this.logAction(
			"task:delegation",
			{
				delegateToId,
				delegateToRole,
				taskDescription,
				requiredCapabilities,
			},
		)
	}

	/**
	 * Log a decision point in the agentic loop
	 */
	async logDecision(
		decisionType: string,
		options: string[],
		chosen: string,
		reasoning?: string,
	): Promise<void> {
		await this.logAction(
			`decision:${decisionType}`,
			{ options, reasoning },
			{ success: true, data: { chosen } },
		)
	}

	/**
	 * Log task completion
	 */
	async logTaskComplete(
		success: boolean,
		result?: unknown,
		error?: Error,
	): Promise<void> {
		const action = "task:complete"
		if (error) {
			await this.logError(action, error)
		} else {
			await this.logSuccess(action, { success, result })
		}
	}

	/**
	 * Get task context for logging
	 */
	getTaskContext(): { taskId: string; rootTaskId?: string; parentTaskId?: string } {
		return {
			taskId: this.taskId,
			rootTaskId: this.rootTaskId,
			parentTaskId: this.parentTaskId,
		}
	}
}

/**
 * Create a task logger with task-specific metadata
 */
export function createTaskLogger(metadata: TaskLoggerMetadata): TaskLogger {
	return new TaskLogger(metadata)
}

/**
 * Helper to check if agent metadata is available
 */
export function hasAgentMetadata(metadata: unknown): metadata is AgentMetadata {
	return (
		typeof metadata === "object" &&
		metadata !== null &&
		"identity" in metadata &&
		typeof (metadata as AgentMetadata).identity === "object" &&
		"sessionId" in metadata &&
		"historyPath" in metadata
	)
}
