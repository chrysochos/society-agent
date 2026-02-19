/**
 * Minimal API handler for Society Agent standalone
 * Anthropic-only implementation using direct SDK calls
 */

import Anthropic from "@anthropic-ai/sdk"
import { ApiStream, ApiStreamChunk } from "./stream"

// Re-export stream types
export { ApiStream, ApiStreamChunk } from "./stream"

export interface ApiHandlerCreateMessageMetadata {
	allowedTools?: any[]
}

export interface ApiHandler {
	createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata
	): ApiStream

	// For token counting (used by condense)
	getModel(): { id: string; info: { contextWindow: number; maxTokens?: number } }
	countTokens?(messages: Anthropic.Messages.MessageParam[]): Promise<number>
}

export interface AnthropicHandlerOptions {
	apiKey: string
	model?: string
	maxTokens?: number
	temperature?: number
}

const DEFAULT_MODEL = "claude-sonnet-4-20250514"
const DEFAULT_MAX_TOKENS = 8192

/**
 * Minimal Anthropic handler - direct SDK usage
 */
export class AnthropicHandler implements ApiHandler {
	private client: Anthropic
	private model: string
	private maxTokens: number
	private temperature?: number

	constructor(options: AnthropicHandlerOptions) {
		this.client = new Anthropic({ apiKey: options.apiKey })
		this.model = options.model || DEFAULT_MODEL
		this.maxTokens = options.maxTokens || DEFAULT_MAX_TOKENS
		this.temperature = options.temperature
	}

	getModel() {
		return {
			id: this.model,
			info: {
				contextWindow: 200000, // Claude 3.5/4 context
				maxTokens: this.maxTokens,
			},
		}
	}

	async countTokens(messages: Anthropic.Messages.MessageParam[]): Promise<number> {
		// Simple approximation: ~4 chars per token
		const text = messages
			.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
			.join(" ")
		return Math.ceil(text.length / 4)
	}

	async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		_metadata?: ApiHandlerCreateMessageMetadata
	): ApiStream {
		try {
			const stream = this.client.messages.stream({
				model: this.model,
				max_tokens: this.maxTokens,
				system: systemPrompt,
				messages: messages,
				...(this.temperature !== undefined && { temperature: this.temperature }),
			})

			let inputTokens = 0
			let outputTokens = 0

			for await (const event of stream) {
				if (event.type === "content_block_delta") {
					const delta = event.delta as any
					if (delta.type === "text_delta" && delta.text) {
						yield { type: "text", text: delta.text } as ApiStreamChunk
					}
				} else if (event.type === "message_delta") {
					const usage = (event as any).usage
					if (usage) {
						outputTokens = usage.output_tokens || 0
					}
				} else if (event.type === "message_start") {
					const msg = (event as any).message
					if (msg?.usage) {
						inputTokens = msg.usage.input_tokens || 0
					}
				}
			}

			// Final usage
			yield {
				type: "usage",
				inputTokens,
				outputTokens,
			} as ApiStreamChunk
		} catch (error: any) {
			yield {
				type: "error",
				error: error.name || "ApiError",
				message: error.message || "Unknown error",
			} as ApiStreamChunk
		}
	}
}

/**
 * Build API handler from environment or config
 */
export function buildApiHandler(options?: Partial<AnthropicHandlerOptions>): ApiHandler {
	const apiKey = options?.apiKey || process.env.ANTHROPIC_API_KEY
	if (!apiKey) {
		throw new Error("ANTHROPIC_API_KEY environment variable required")
	}

	return new AnthropicHandler({
		apiKey,
		model: options?.model || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
		maxTokens: options?.maxTokens || parseInt(process.env.ANTHROPIC_MAX_TOKENS || String(DEFAULT_MAX_TOKENS)),
		temperature: options?.temperature,
	})
}
