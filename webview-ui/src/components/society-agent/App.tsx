// kilocode_change - new file
/**
 * Society Agent App Root
 *
 * Main entry point for the web server UI.
 */

import React from "react"
import ChatInterface from "./ChatInterface"
import "./App.css"

export const App: React.FC = () => {
	return (
		<div className="app">
			<ChatInterface />
		</div>
	)
}

export default App
