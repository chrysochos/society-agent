/**
 * Simplified conversation condensation for Society Agent standalone
 * Based on Society Agent's core/condense/index.ts but minimal implementation
 */

import Anthropic from "@anthropic-ai/sdk"
import { ApiHandler } from "../api"

// ApiMessage is just Anthropic.MessageParam with optional extras
export type ApiMessage = Anthropic.MessageParam & { ts?: number; isSummary?: boolean }

export const N_MESSAGES_TO_KEEP = 3
export const MIN_CONDENSE_THRESHOLD = 5
export const MAX_CONDENSE_THRESHOLD = 100

const SUMMARY_PROMPT = `\
Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.
This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing with the conversation.

Your summary should be structured as follows:
1. Previous Conversation: High level details about what was discussed
2. Current Work: What was being worked on prior to this summary request
3. Key Technical Concepts: Important technical concepts, technologies, and frameworks discussed
4. Relevant Files and Code: Files and code sections examined, modified, or created
5. Problem Solving: Problems solved and ongoing troubleshooting
6. Pending Tasks and Next Steps: Outstanding work and next steps

Output only the summary without additional commentary.
`

export interface SummarizeResponse {
	messages: ApiMessage[]
	summary: string
	cost: number
	newContextTokens?: number
	error?: string
}

/**
 * Simplified conversation summarization
 * @param messages - The conversation messages
 * @param apiHandler - The API handler for making LLM calls
 * @param systemPrompt - The system prompt (used for token counting)
 * @param taskId - Task ID for logging
 * @param prevContextTokens - Current context token count
 * @param isAutomaticTrigger - Whether this is auto-triggered
 * @param customCondensingPrompt - Custom prompt (optional)
 * @param condensingApiHandler - Alternative handler for condensing (optional)
 * @param preserveFirstMessage - Whether to preserve the first message in addition to recent ones
 */
export async function summarizeConversation(
	messages: ApiMessage[],
	apiHandler: ApiHandler,
	systemPrompt: string,
	taskId: string,
	prevContextTokens: number = 0,
	isAutomaticTrigger: boolean = false,
	customCondensingPrompt?: string,
	condensingApiHandler?: ApiHandler,
	preserveFirstMessage: boolean = false
): Promise<SummarizeResponse> {
	const handler = condensingApiHandler || apiHandler

	// Not enough messages to summarize
	if (messages.length <= N_MESSAGES_TO_KEEP + 1) {
		return {
			messages,
			summary: "",
			cost: 0,
		}
	}

	try {
		// Prepare prompt
		const conversationText = messages
			.map((m) => {
				const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content)
				return `${m.role}: ${content.substring(0, 2000)}...` // Truncate for summary request
			})
			.join("\n\n")

		const prompt = customCondensingPrompt || SUMMARY_PROMPT

		// Make summarization call
		let summaryText = ""
		let inputTokens = 0
		let outputTokens = 0

		const stream = handler.createMessage(prompt, [
			{ role: "user", content: `Summarize this conversation:\n\n${conversationText}` },
		])

		for await (const chunk of stream) {
			if (chunk.type === "text") {
				summaryText += chunk.text
			} else if (chunk.type === "usage") {
				inputTokens = chunk.inputTokens
				outputTokens = chunk.outputTokens
			} else if (chunk.type === "error") {
				return {
					messages,
					summary: "",
					cost: 0,
					error: chunk.message,
				}
			}
		}

		// Build new messages array
		const keepCount = preserveFirstMessage ? N_MESSAGES_TO_KEEP + 1 : N_MESSAGES_TO_KEEP
		const newMessages: ApiMessage[] = []

		// Optionally keep first message
		if (preserveFirstMessage && messages.length > 0) {
			newMessages.push(messages[0])
		}

		// Add summary as system-like message
		newMessages.push({
			role: "user",
			content: `[Previous conversation summary]\n${summaryText}`,
			isSummary: true,
		})

		// Add assistant acknowledgment
		newMessages.push({
			role: "assistant",
			content: "I understand the context from the summary. Continuing from where we left off.",
			isSummary: true,
		})

		// Keep recent messages
		const recentStart = preserveFirstMessage ? messages.length - N_MESSAGES_TO_KEEP : messages.length - N_MESSAGES_TO_KEEP
		const recentMessages = messages.slice(Math.max(recentStart, preserveFirstMessage ? 1 : 0))
		
		// Avoid duplicates
		for (const msg of recentMessages) {
			if (!newMessages.some((m) => m === msg)) {
				newMessages.push(msg)
			}
		}

		// Estimate cost (rough approximation: $3/M input, $15/M output for Claude)
		const cost = (inputTokens * 3 + outputTokens * 15) / 1_000_000

		return {
			messages: newMessages,
			summary: summaryText,
			cost,
			newContextTokens: inputTokens + outputTokens,
		}
	} catch (error: any) {
		console.error(`[${taskId}] Summarization error:`, error.message)
		return {
			messages,
			summary: "",
			cost: 0,
			error: error.message,
		}
	}
}
