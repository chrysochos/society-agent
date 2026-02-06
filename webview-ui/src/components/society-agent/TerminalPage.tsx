// kilocode_change - new file
/**
 * Standalone Terminal Page
 * Full-screen terminal for command execution
 */

import React from "react"
import { InteractiveTerminal } from "./InteractiveTerminal"
import "./TerminalPage.css"

export const TerminalPage: React.FC = () => {
	return (
		<div className="terminal-page">
			<div className="terminal-page-header">
				<h1>🖥️ Terminal</h1>
				<div className="terminal-page-info">Execute shell commands directly from your browser</div>
			</div>
			<div className="terminal-page-content">
				<InteractiveTerminal
					cwd="/workspace"
					onCommandExecute={(cmd) => {
						console.log("Command executed:", cmd)
					}}
				/>
			</div>
		</div>
	)
}
