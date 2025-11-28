// kilocode_change - new file
/**
 * MessageDialog - Send messages to agents
 *
 * Allows user to send messages/commands to specific agents
 * for guidance or intervention.
 */

import React, { useState } from "react"
import { VSCodeButton, VSCodeTextArea } from "@vscode/webview-ui-toolkit/react"
import "./MessageDialog.css"

// kilocode_change start
interface Agent {
	id: string
	name: string
	role: "supervisor" | "worker"
	status: string
}

interface MessageDialogProps {
	agent: Agent
	onClose: () => void
}
// kilocode_change end

export const MessageDialog: React.FC<MessageDialogProps> = ({ agent, onClose }) => {
	// kilocode_change start
	const [message, setMessage] = useState("")
	const [sending, setSending] = useState(false)

	const quickMessages = [
		"What's your current status?",
		"Pause and wait for my guidance",
		"Continue with the current approach",
		"Try a different approach",
		"Show me what you've done so far",
	]

	const handleSend = async () => {
		if (!message.trim()) {
			return
		}

		setSending(true)

		// Send message to extension
		vscode.postMessage({
			type: "send-message-to-agent",
			agentId: agent.id,
			message: message.trim(),
		})

		// Wait for response (simulated for now)
		setTimeout(() => {
			setSending(false)
			setMessage("")
			onClose()
		}, 500)
	}

	const handleQuickMessage = (quickMsg: string) => {
		setMessage(quickMsg)
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
			handleSend()
		}
	}

	return (
		<div className="message-dialog-overlay" onClick={onClose}>
			<div className="message-dialog" onClick={(e) => e.stopPropagation()}>
				<div className="message-dialog-header">
					<div className="message-dialog-title">💬 Send Message to {agent.name}</div>
					<VSCodeButton appearance="icon" onClick={onClose}>
						✕
					</VSCodeButton>
				</div>

				<div className="message-dialog-body">
					{/* Quick Messages */}
					<div className="quick-messages">
						<div className="quick-messages-label">Quick messages:</div>
						<div className="quick-messages-list">
							{quickMessages.map((quickMsg, index) => (
								<button
									key={index}
									className="quick-message-button"
									onClick={() => handleQuickMessage(quickMsg)}>
									{quickMsg}
								</button>
							))}
						</div>
					</div>

					{/* Message Input */}
					<div className="message-input-container">
						<label htmlFor="message-input">Your message:</label>
						<VSCodeTextArea
							id="message-input"
							value={message}
							onChange={(e: any) => setMessage(e.target.value)}
							onKeyDown={handleKeyDown as any}
							placeholder="Type your message... (Ctrl+Enter to send)"
							rows={6}
							style={{ width: "100%" }}
							disabled={sending}
						/>
						<div className="message-hint">
							Press <kbd>Ctrl+Enter</kbd> to send
						</div>
					</div>
				</div>

				<div className="message-dialog-footer">
					<VSCodeButton appearance="secondary" onClick={onClose}>
						Cancel
					</VSCodeButton>
					<VSCodeButton onClick={handleSend} disabled={!message.trim() || sending}>
						{sending ? "Sending..." : "Send Message"}
					</VSCodeButton>
				</div>
			</div>
		</div>
	)
	// kilocode_change end
}

// VSCode API global
declare const vscode: {
	postMessage: (message: any) => void
}
