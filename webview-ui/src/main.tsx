// kilocode_change - new file
/**
 * Entry point for Society Agent Web UI
 */

import React from "react"
import ReactDOM from "react-dom/client"
import App from "./components/society-agent/App"

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement)

root.render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
)
