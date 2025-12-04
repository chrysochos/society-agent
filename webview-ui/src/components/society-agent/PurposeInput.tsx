// kilocode_change - new file
/**
 * PurposeInput - Purpose entry form
 *
 * Allows users to define purpose with context, attachments,
 * constraints, and success criteria.
 */

import React, { useState } from "react"
import { VSCodeButton, VSCodeTextArea } from "@vscode/webview-ui-toolkit/react" // kilocode_change
import "./PurposeInput.css"

// kilocode_change start
interface PurposeInputProps {
	onSubmit: (purpose: {
		description: string
		context?: string
		attachments?: string[]
		constraints?: string[]
		successCriteria?: string[]
	}) => void
}
// kilocode_change end

export const PurposeInput: React.FC<PurposeInputProps> = ({ onSubmit }) => {
	// kilocode_change start
	const [description, setDescription] = useState("")
	const [context, setContext] = useState("")
	const [constraints, setConstraints] = useState("")
	const [successCriteria, setSuccessCriteria] = useState("")
	const [showAdvanced, setShowAdvanced] = useState(false)

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault()

		console.log("🔍 Form submitted - description value:", description)
		console.log("🔍 Description length:", description.length)

		if (!description.trim()) {
			console.error("❌ Purpose description is required - field is empty")
			return
		}

		console.log("✅ Purpose form submitted:", description)

		const purposeData = {
			description: description.trim(),
			context: context.trim() || undefined,
			constraints: constraints
				.split("\n")
				.map((c) => c.trim())
				.filter((c) => c),
			successCriteria: successCriteria
				.split("\n")
				.map((s) => s.trim())
				.filter((s) => s),
		}

		console.log("📦 Purpose data prepared:", purposeData)
		onSubmit(purposeData)
	}

	const examplePurposes = [
		"Build authentication system with OAuth",
		"Add admin dashboard with user management",
		"Refactor database layer to use Prisma ORM",
		"Fix all TypeScript errors in the codebase",
		"Create REST API for product catalog",
	]

	const handleExampleClick = (example: string) => {
		setDescription(example)
	}

	return (
		<div className="purpose-input-container">
			<div className="purpose-input-content">
				<div className="purpose-header">
					<h1>🚀 Society Agent</h1>
					<p className="purpose-subtitle">Define your purpose and let an AI team achieve it autonomously</p>
				</div>

				<form onSubmit={handleSubmit} className="purpose-form">
					{/* Main Purpose */}
					<div className="form-group">
						<label htmlFor="purpose-description">What do you want to achieve?</label>
						<VSCodeTextArea
							id="purpose-description"
							value={description}
							onInput={(e: any) => {
								const newValue = e.target?.value || ""
								console.log("🔍 Input changed:", newValue)
								setDescription(newValue)
							}}
							placeholder="E.g., 'Build authentication system with OAuth'"
							rows={3}
							style={{ width: "100%" }}
						/>
					</div>

					{/* Example Purposes */}
					<div className="example-purposes">
						<div className="example-label">Examples:</div>
						<div className="example-chips">
							{examplePurposes.map((example, index) => (
								<button
									key={index}
									type="button"
									className="example-chip"
									onClick={() => handleExampleClick(example)}>
									{example}
								</button>
							))}
						</div>
					</div>

					{/* Advanced Options Toggle */}
					<div className="advanced-toggle">
						<VSCodeButton
							appearance="secondary"
							onClick={() => setShowAdvanced(!showAdvanced)}
							type="button">
							{showAdvanced ? "▼" : "▶"} Advanced Options
						</VSCodeButton>
					</div>

					{/* Advanced Options */}
					{showAdvanced && (
						<div className="advanced-options">
							<div className="form-group">
								<label htmlFor="purpose-context">Additional Context (optional)</label>
								<VSCodeTextArea
									id="purpose-context"
									value={context}
									onChange={(e: any) => setContext(e.target.value)}
									placeholder="Any additional information that might help..."
									rows={2}
									style={{ width: "100%" }}
								/>
							</div>

							<div className="form-group">
								<label htmlFor="purpose-constraints">Constraints (optional)</label>
								<VSCodeTextArea
									id="purpose-constraints"
									value={constraints}
									onChange={(e: any) => setConstraints(e.target.value)}
									placeholder="One per line, e.g.:&#10;Must use TypeScript&#10;Budget: 1 hour&#10;No external dependencies"
									rows={3}
									style={{ width: "100%" }}
								/>
							</div>

							<div className="form-group">
								<label htmlFor="purpose-success">Success Criteria (optional)</label>
								<VSCodeTextArea
									id="purpose-success"
									value={successCriteria}
									onChange={(e: any) => setSuccessCriteria(e.target.value)}
									placeholder="One per line, e.g.:&#10;User can log in&#10;All tests pass&#10;Security audit clean"
									rows={3}
									style={{ width: "100%" }}
								/>
							</div>
						</div>
					)}

					{/* Submit Button */}
					<div className="form-actions">
						<VSCodeButton type="submit" style={{ width: "100%" }}>
							🚀 Start Purpose
						</VSCodeButton>
					</div>
				</form>

				{/* Info Box */}
				<div className="info-box">
					<div className="info-title">ℹ️ How it works:</div>
					<ol className="info-list">
						<li>Supervisor analyzes your purpose and creates a team</li>
						<li>Workers autonomously execute tasks</li>
						<li>System escalates only critical decisions to you</li>
						<li>You monitor progress in the dashboard</li>
					</ol>
				</div>
			</div>
		</div>
	)
	// kilocode_change end
}
