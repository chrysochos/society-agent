// kilocode_change - new file
import * as vscode from "vscode"
import { AgentRegistry } from "./agent-registry"
import { AgentMessage } from "./types" // kilocode_change
import { getLog } from "./logger" // kilocode_change

/**
 * Custom tool that allows agents to send messages to other agents directly from chat.
 * This enables agent-to-agent communication without human intervention.
 */

export interface AgentMessagingToolParams {
	recipient: string // Agent ID or "user" or "@all"
	message: string
	type?: "message" | "question" | "task_assign"
}

export class AgentMessagingTool {
	constructor(
		private registry: AgentRegistry,
		private agentId: string,
	) {}

	/**
	 * Tool definition that gets injected into agent's available tools
	 */
	static getToolDefinition() {
		return {
			name: "send_agent_message",
			description: `Send a message to another agent or to the user. Use this when you need information from another agent, want to delegate work, or need to respond to a question. The recipient will receive your message and can respond.`,
			input_schema: {
				type: "object",
				properties: {
					recipient: {
						type: "string",
						description:
							"Who to send to: agent ID (e.g., 'backend-dev', 'frontend-dev'), 'user', or '@all' for broadcast",
					},
					message: {
						type: "string",
						description:
							"The message content. Be clear and specific about what you need or what you're providing.",
					},
					type: {
						type: "string",
						enum: ["message", "question", "task_assign"],
						description:
							"Message type: 'message' for info, 'question' for asking something, 'task_assign' to delegate work",
						default: "message",
					},
				},
				required: ["recipient", "message"],
			},
		}
	}

	/**
	 * Execute the tool - send the message via AgentRegistry
	 */
	async execute(params: AgentMessagingToolParams): Promise<string> {
		const { recipient, message, type = "message" } = params

		try {
			// Validate recipient
			if (recipient !== "user" && recipient !== "@all" && !recipient.includes("-")) {
				return `❌ Invalid recipient: ${recipient}. Use agent ID (e.g., 'backend-dev'), 'user', or '@all'`
			}

			// Send the message
			await this.registry.sendMessage(recipient, type as AgentMessage["type"], message) // kilocode_change - positional args

			// Format success response based on type
			const typeLabel = type === "question" ? "Question" : type === "task_assign" ? "Task" : "Message"
			const recipientLabel = recipient === "@all" ? "all agents" : recipient

			return `✅ ${typeLabel} sent to ${recipientLabel}

Your message:
"${message}"

Message sent successfully.

${recipient === "user" ? "The user will see this message." : `${recipientLabel} will receive this message and can respond.`}`
		} catch (error) {
			getLog().error("[AgentMessagingTool] Failed to send message:", error)
			return `❌ Failed to send message: ${error instanceof Error ? error.message : String(error)}`
		}
	}
}

/**
 * Tool executor function that KiloCode's tool system can call
 */
export async function executeAgentMessagingTool(
	params: AgentMessagingToolParams,
	registry: AgentRegistry,
	agentId: string,
): Promise<string> {
	const tool = new AgentMessagingTool(registry, agentId)
	return await tool.execute(params)
}
