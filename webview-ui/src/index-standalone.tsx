// kilocode_change - new file
/**
 * Standalone Web App Entry Point
 * For Society Agent Web Server (not VS Code extension)
 */

import React from "react"
import { createRoot } from "react-dom/client"
import { ChatInterface } from "./components/society-agent/ChatInterface"
import "./index.css"

// Render the chat interface
createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<ChatInterface />
	</React.StrictMode>,
)
