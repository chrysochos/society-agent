// kilocode_change - new file
/**
 * Settings Component - Configure API keys and preferences
 */

import React, { useState, useEffect } from "react"
import "./Settings.css"

interface SettingsProps {
	isOpen: boolean
	onClose: () => void
}

export function Settings({ isOpen, onClose }: SettingsProps) {
	const [apiKey, setApiKey] = useState("")
	const [isSaved, setIsSaved] = useState(false)

	useEffect(() => {
		// Load saved API key from localStorage
		const saved = localStorage.getItem("anthropic_api_key")
		if (saved) {
			setApiKey(saved)
			setIsSaved(true)
		}
	}, [])

	const handleSave = async () => {
		if (apiKey.trim()) {
			// Save to localStorage (for immediate use)
			localStorage.setItem("anthropic_api_key", apiKey.trim())

			// Save to server .env file (for persistence)
			try {
				const response = await fetch("http://localhost:3000/api/config/api-key", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ apiKey: apiKey.trim() }),
				})

				if (response.ok) {
					console.log("✅ API key saved to server")
				} else {
					const error = await response.json()
					console.error("❌ Failed to save API key to server:", error)
					alert(
						"Warning: API key saved locally but failed to save to server. It may not persist after restart.",
					)
				}
			} catch (error) {
				console.error("❌ Error saving API key to server:", error)
				alert("Warning: API key saved locally but could not reach server. It may not persist after restart.")
			}

			setIsSaved(true)
			setTimeout(() => {
				onClose()
			}, 500)
		}
	}

	const handleClear = () => {
		localStorage.removeItem("anthropic_api_key")
		setApiKey("")
		setIsSaved(false)
	}

	if (!isOpen) return null

	return (
		<div className="settings-overlay" onClick={onClose}>
			<div className="settings-modal" onClick={(e) => e.stopPropagation()}>
				<div className="settings-header">
					<h2>⚙️ Settings</h2>
					<button className="close-button" onClick={onClose}>
						✕
					</button>
				</div>

				<div className="settings-content">
					<div className="setting-group">
						<label htmlFor="api-key">Anthropic API Key</label>
						<div className="input-with-hint">
							<input
								id="api-key"
								type="password"
								value={apiKey}
								onChange={(e) => {
									setApiKey(e.target.value)
									setIsSaved(false)
								}}
								placeholder="sk-ant-api03-..."
								className="api-key-input"
							/>
							<p className="hint">
								Get your API key from{" "}
								<a
									href="https://console.anthropic.com/settings/keys"
									target="_blank"
									rel="noopener noreferrer">
									console.anthropic.com
								</a>
							</p>
						</div>
					</div>

					{isSaved && <div className="success-message">✅ API key saved successfully!</div>}
				</div>

				<div className="settings-footer">
					<button className="secondary-button" onClick={handleClear}>
						Clear Key
					</button>
					<button className="primary-button" onClick={handleSave} disabled={!apiKey.trim()}>
						Save Settings
					</button>
				</div>
			</div>
		</div>
	)
}
