/**
 * Minimal API handler for Society Agent standalone
 * Multi-provider implementation using Anthropic and OpenAI SDKs
 */

import Anthropic from "@anthropic-ai/sdk"
import OpenAI from "openai"
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

// OpenAI-compatible provider base URLs
const OPENAI_COMPATIBLE_BASE_URLS: Record<string, string> = {
	openai: "https://api.openai.com/v1",
	minimax: "https://api.minimax.chat/v1",
	deepseek: "https://api.deepseek.com/v1",
	groq: "https://api.groq.com/openai/v1",
	mistral: "https://api.mistral.ai/v1",
	openrouter: "https://openrouter.ai/api/v1",
}

export interface OpenAIHandlerOptions {
	apiKey: string
	model: string
	maxTokens?: number
	temperature?: number
	baseURL?: string
	providerName?: string
}

/**
 * OpenAI-compatible handler - works with OpenAI, MiniMax, DeepSeek, Groq, Mistral, OpenRouter
 */
export class OpenAIHandler implements ApiHandler {
	private client: OpenAI
	private model: string
	private maxTokens: number
	private temperature?: number
	private providerName: string

	constructor(options: OpenAIHandlerOptions) {
		// Add OpenRouter-specific headers for app identification
		const defaultHeaders: Record<string, string> = {}
		if (options.providerName === "openrouter") {
			defaultHeaders["HTTP-Referer"] = "https://github.com/chrysochos/society-agent"
			defaultHeaders["X-Title"] = "Society Agent"
		}

		this.client = new OpenAI({ 
			apiKey: options.apiKey,
			baseURL: options.baseURL,
			defaultHeaders: Object.keys(defaultHeaders).length > 0 ? defaultHeaders : undefined,
		})
		this.model = options.model
		this.maxTokens = options.maxTokens || DEFAULT_MAX_TOKENS
		this.temperature = options.temperature
		this.providerName = options.providerName || "openai"
	}

	getModel() {
		return {
			id: this.model,
			info: {
				contextWindow: 128000, // Most OpenAI models have ~128k context
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
		metadata?: ApiHandlerCreateMessageMetadata
	): ApiStream {
		try {
			// Convert Anthropic message format to OpenAI format
			const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
				{ role: "system", content: systemPrompt },
				...messages.map((m) => ({
					role: m.role as "user" | "assistant",
					content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
				})),
			]

			// Build tools if provided
			const tools = metadata?.allowedTools?.map((tool: any) => ({
				type: "function" as const,
				function: {
					name: tool.name,
					description: tool.description || "",
					parameters: tool.input_schema || tool.parameters || {},
				},
			}))

			const stream = await this.client.chat.completions.create({
				model: this.model,
				max_tokens: this.maxTokens,
				messages: openaiMessages,
				stream: true,
				...(this.temperature !== undefined && { temperature: this.temperature }),
				...(tools && tools.length > 0 && { tools }),
			})

			let inputTokens = 0
			let outputTokens = 0

			for await (const chunk of stream) {
				const choice = chunk.choices[0]
				if (choice?.delta?.content) {
					yield { type: "text", text: choice.delta.content } as ApiStreamChunk
				}
				// Handle tool calls
				if (choice?.delta?.tool_calls) {
					for (const toolCall of choice.delta.tool_calls) {
						if (toolCall.function?.name) {
							yield {
								type: "tool_use",
								id: toolCall.id || `tool_${Date.now()}`,
								name: toolCall.function.name,
								input: toolCall.function.arguments || "{}",
							} as ApiStreamChunk
						}
					}
				}
				// Track usage
				if (chunk.usage) {
					inputTokens = chunk.usage.prompt_tokens || 0
					outputTokens = chunk.usage.completion_tokens || 0
				}
			}

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

/**
 * Build OpenAI-compatible API handler
 */
export function buildOpenAIHandler(provider: string, options: OpenAIHandlerOptions): ApiHandler {
	const baseURL = options.baseURL || OPENAI_COMPATIBLE_BASE_URLS[provider]
	if (!baseURL) {
		throw new Error(`Unknown provider: ${provider}. Provide a baseURL or use a known provider.`)
	}
	return new OpenAIHandler({
		...options,
		baseURL,
		providerName: provider,
	})
}
