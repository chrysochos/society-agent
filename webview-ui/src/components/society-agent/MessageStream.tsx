// kilocode_change - new file
/**
 * MessageStream - Chat-style display of inter-agent communication
 *
 * Shows messages between supervisor and worker agents in chronological order
 */

import React from "react"
import "./MessageStream.css"

// kilocode_change start
export interface AgentMessage {
	id: string
	fromAgent: string
	toAgent?: string
	message: string
	timestamp: number
	type: "message" | "status" | "result" | "error"
}

interface MessageStreamProps {
	messages: AgentMessage[]
	filterAgent?: string // "all", "supervisor", specific agent ID
}
// kilocode_change end

export const MessageStream: React.FC<MessageStreamProps> = ({ messages, filterAgent }) => {
	// Filter messages based on selected agent
	const filteredMessages =
		filterAgent && filterAgent !== "all"
			? messages.filter((msg) => msg.fromAgent === filterAgent || msg.toAgent === filterAgent)
			: messages

	const formatTime = (timestamp: number) => {
		const date = new Date(timestamp)
		return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
	}

	const getMessageIcon = (type: string) => {
		switch (type) {
			case "message":
				return "💬"
			case "status":
				return "📊"
			case "result":
				return "✅"
			case "error":
				return "❌"
			default:
				return "•"
		}
	}

	return (
		<div className="message-stream">
			{filteredMessages.length === 0 ? (
				<div className="message-stream-empty">
					<p>No messages yet. Waiting for agent communication...</p>
				</div>
			) : (
				<div className="message-stream-list">
					{filteredMessages.map((msg) => (
						<div key={msg.id} className={`message-item message-type-${msg.type}`}>
							<div className="message-header">
								<span className="message-icon">{getMessageIcon(msg.type)}</span>
								<span className="message-from">{msg.fromAgent}</span>
								{msg.toAgent && (
									<>
										<span className="message-arrow">→</span>
										<span className="message-to">{msg.toAgent}</span>
									</>
								)}
								<span className="message-time">{formatTime(msg.timestamp)}</span>
							</div>
							<div className="message-content">{msg.message}</div>
						</div>
					))}
				</div>
			)}
		</div>
	)
}
