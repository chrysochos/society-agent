// kilocode_change - new file
/**
 * API request/response logging utilities for Society Agent framework
 * 
 * This module provides logging for LLM API calls, tracking token usage,
 * latency, errors, and model information for debugging and auditing.
 */

import { SocietyAgentLogger } from "./logger"
import type { AgentMetadata } from "./types"

/**
 * API request metadata
 */
export interface ApiRequestMetadata {
	/** Provider name (e.g., 'anthropic', 'openai', 'bedrock') */
	provider: string
	/** Model identifier */
	model: string
	/** Request timestamp */
	timestamp: Date
	/** Request ID for correlation */
	requestId?: string
}

/**
 * API response metadata
 */
export interface ApiResponseMetadata {
	/** Tokens used in request */
	inputTokens?: number
	/** Tokens generated in response */
	outputTokens?: number
	/** Total tokens used */
	totalTokens?: number
	/** Response latency in milliseconds */
	latencyMs: number
	/** HTTP status code */
	statusCode?: number
	/** Whether request was successful */
	success: boolean
	/** Error message if request failed */
	error?: string
}

/**
 * Logger specialized for API requests and responses
 */
export class ApiLogger {
	private logger: SocietyAgentLogger | null = null
	private agentMetadata: AgentMetadata | null = null

	/**
	 * Initialize the API logger with agent metadata
	 */
	initialize(metadata: AgentMetadata): void {
		this.agentMetadata = metadata
		// Lazy initialization - only create logger when metadata is available
	}

	/**
	 * Get or create the logger instance
	 */
	private getLogger(): SocietyAgentLogger | null {
		if (!this.agentMetadata) {
			return null
		}
		if (!this.logger) {
			const { SocietyAgentLogger } = require("./logger")
			this.logger = new SocietyAgentLogger(this.agentMetadata)
		}
		return this.logger
	}

	/**
	 * Check if logger is initialized
	 */
	isInitialized(): boolean {
		return this.agentMetadata !== null
	}

	/**
	 * Log an API request
	 */
	async logRequest(metadata: ApiRequestMetadata, params?: Record<string, unknown>): Promise<void> {
		const logger = this.getLogger()
		if (!logger) return

		await logger.logAction(
			"api:request",
			{
				...metadata,
				...params,
			},
		)
	}

	/**
	 * Log an API response
	 */
	async logResponse(
		requestMetadata: ApiRequestMetadata,
		responseMetadata: ApiResponseMetadata,
	): Promise<void> {
		const logger = this.getLogger()
		if (!logger) return

		const action = "api:response"
		const params = {
			provider: requestMetadata.provider,
			model: requestMetadata.model,
			requestId: requestMetadata.requestId,
		}
		const result = responseMetadata

		if (responseMetadata.success) {
			await logger.logSuccess(action, { ...params, ...result })
		} else {
			const error = new Error(responseMetadata.error || "API request failed")
			await logger.logError(action, error)
		}
	}

	/**
	 * Log a complete API call (request + response)
	 */
	async logApiCall(
		requestMetadata: ApiRequestMetadata,
		responseMetadata: ApiResponseMetadata,
		additionalParams?: Record<string, unknown>,
	): Promise<void> {
		const logger = this.getLogger()
		if (!logger) return

		const action = "api:call"
		const params = {
			provider: requestMetadata.provider,
			model: requestMetadata.model,
			requestId: requestMetadata.requestId,
			...additionalParams,
		}
		const result = responseMetadata

		if (responseMetadata.success) {
			await logger.logSuccess(action, { ...params, ...result })
		} else {
			const error = new Error(responseMetadata.error || "API call failed")
			await logger.logError(action, error)
		}
	}

	/**
	 * Log token usage statistics
	 */
	async logTokenUsage(
		provider: string,
		model: string,
		inputTokens: number,
		outputTokens: number,
		totalTokens: number,
	): Promise<void> {
		const logger = this.getLogger()
		if (!logger) return

		await logger.logAction(
			"api:token-usage",
			{ provider, model },
			{ success: true, data: { inputTokens, outputTokens, totalTokens } },
		)
	}

	/**
	 * Log API rate limit hit
	 */
	async logRateLimitHit(
		provider: string,
		model: string,
		retryAfter?: number,
	): Promise<void> {
		const logger = this.getLogger()
		if (!logger) return

		await logger.logAction(
			"api:rate-limit",
			{ provider, model, retryAfter },
		)
	}

	/**
	 * Log API error with details
	 */
	async logApiError(
		provider: string,
		model: string,
		error: Error,
		statusCode?: number,
	): Promise<void> {
		const logger = this.getLogger()
		if (!logger) return

		await logger.logError("api:error", error)
	}

	/**
	 * Get agent metadata if initialized
	 */
	getAgentMetadata(): AgentMetadata | null {
		return this.agentMetadata
	}
}

/**
 * Singleton API logger instance
 */
let apiLoggerInstance: ApiLogger | null = null

/**
 * Get or create the API logger singleton
 */
export function getApiLogger(): ApiLogger {
	if (!apiLoggerInstance) {
		apiLoggerInstance = new ApiLogger()
	}
	return apiLoggerInstance
}

/**
 * Initialize the API logger with agent metadata
 */
export function initializeApiLogger(metadata: AgentMetadata): void {
	const logger = getApiLogger()
	logger.initialize(metadata)
}

/**
 * Helper to create request metadata
 */
export function createRequestMetadata(
	provider: string,
	model: string,
	requestId?: string,
): ApiRequestMetadata {
	return {
		provider,
		model,
		timestamp: new Date(),
		requestId,
	}
}

/**
 * Helper to create response metadata
 */
export function createResponseMetadata(
	success: boolean,
	latencyMs: number,
	options: {
		inputTokens?: number
		outputTokens?: number
		totalTokens?: number
		statusCode?: number
		error?: string
	} = {},
): ApiResponseMetadata {
	return {
		success,
		latencyMs,
		inputTokens: options.inputTokens,
		outputTokens: options.outputTokens,
		totalTokens: options.totalTokens,
		statusCode: options.statusCode,
		error: options.error,
	}
}
