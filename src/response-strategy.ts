// Society Agent - new file
/**
 * ResponseStrategy - Determines whether to respond via chat or create files
 *
 * Analyzes the user's purpose to decide if it requires:
 * - Chat response (conversational, questions, explanations)
 * - File creation (building, coding, generating content)
 */

import { PurposeContext } from "./purpose-analyzer"

export type ResponseType = "chat" | "files" | "both"

export interface ResponseDecision {
	type: ResponseType
	reason: string
	shouldCreateProject: boolean
}

export class ResponseStrategy {
	/**
	 * Determine how to respond to a purpose
	 */
	static determineResponseType(purpose: PurposeContext): ResponseDecision {
		const description = purpose.description.toLowerCase()

		// Conversational greetings
		const greetings = ["hi", "hello", "hey", "good morning", "good afternoon", "good evening"]
		if (greetings.some((g) => description === g || description.startsWith(g + " "))) {
			return {
				type: "chat",
				reason: "Greeting - respond conversationally",
				shouldCreateProject: false,
			}
		}

		// Questions (what, why, how, when, where, who, can you, do you, etc.)
		const questionWords = [
			"what",
			"why",
			"how",
			"when",
			"where",
			"who",
			"which",
			"can you",
			"do you",
			"are you",
			"is it",
			"tell me",
			"explain",
			"describe",
			"compare",
		]
		if (questionWords.some((q) => description.startsWith(q))) {
			return {
				type: "chat",
				reason: "Question - provide explanation in chat",
				shouldCreateProject: false,
			}
		}

		// File/code creation keywords
		const fileKeywords = [
			"build",
			"create",
			"implement",
			"develop",
			"write code",
			"generate",
			"make a",
			"design a",
			"add",
			"setup",
			"configure",
			"install",
		]
		if (fileKeywords.some((kw) => description.includes(kw))) {
			return {
				type: "files",
				reason: "Action-oriented task requiring file creation",
				shouldCreateProject: true,
			}
		}

		// Analysis/review keywords (might need both)
		const analysisKeywords = ["analyze", "review", "check", "test", "debug", "fix"]
		if (analysisKeywords.some((kw) => description.includes(kw))) {
			return {
				type: "both",
				reason: "Analysis task - respond in chat and may modify files",
				shouldCreateProject: false,
			}
		}

		// Default: if uncertain, respond in chat first
		return {
			type: "chat",
			reason: "Unclear intent - responding conversationally to gather more information",
			shouldCreateProject: false,
		}
	}

	/**
	 * Generate a conversational response prompt for the supervisor
	 */
	static getConversationalPrompt(purpose: PurposeContext): string {
		return `Respond conversationally to the user's message: "${purpose.description}"

You are a helpful AI assistant. Respond naturally in a chat format.
Do NOT create files. Do NOT generate JSON. Just respond conversationally.

If the user asks about your capabilities or identity:
- You are powered by Claude 3.5 Sonnet (Anthropic)
- You can help with coding, writing, analysis, and creative tasks
- You can create files and projects when asked

If the user greets you:
- Greet them warmly and ask what you can help with

If the user asks a question:
- Provide a clear, helpful answer
- Use markdown formatting if helpful
- Be concise but thorough

Respond now:`
	}

	/**
	 * Generate a file creation prompt for the supervisor
	 */
	static getFileCreationPrompt(purpose: PurposeContext): string {
		return `Task: ${purpose.description}

Context: ${purpose.context || "No additional context provided"}

Constraints:
${purpose.constraints?.map((c) => `- ${c}`).join("\n") || "No specific constraints"}

Create the necessary files to complete this task.
Respond with a JSON object listing all files to create:

{
  "files": [
    {"path": "file1.ext", "content": "actual content"},
    {"path": "file2.ext", "content": "actual content"}
  ]
}

Important:
- Create actual files with complete content
- Use appropriate file extensions
- Include all necessary files (code, configs, docs)
- Ensure files work together as a cohesive solution`
	}
}
