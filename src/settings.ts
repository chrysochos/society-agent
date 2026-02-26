// Society Agent - new file
/**
 * Society Agent Server - Standalone Settings System
 *
 * This is a self-contained settings system for the Society Agent Server.
 * It does NOT depend on Society Agent's settings - it's a separate product.
 *
 * Settings are stored in: .env file (single source of truth)
 */

import fs from "fs"
import path from "path"
import { getLog } from "./logger"

const log = getLog()

// ============================================================================
// Types
// ============================================================================

export type ProviderType =
	| "openrouter"
	| "anthropic"
	| "openai"
	| "minimax"
	| "gemini"
	| "deepseek"
	| "groq"
	| "mistral"

export interface ProviderConfig {
	type: ProviderType
	apiKey: string
	model: string
	baseUrl?: string // For custom endpoints
}

export interface ServerSettings {
	// Provider configuration
	provider: ProviderConfig

	// Server settings
	port: number
	workspacePath: string
	projectsDir: string

	// Agent defaults
	defaultMaxTokens: number
	defaultTemperature: number

	// Logging
	verboseLogging: boolean

	// Session management
	sessionTimeoutMinutes: number
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_SETTINGS: ServerSettings = {
	provider: {
		type: "openrouter",
		apiKey: "",
		model: "anthropic/claude-sonnet-4",
	},
	port: 4000,
	workspacePath: "/workspace",
	projectsDir: "/workspace/projects",
	defaultMaxTokens: 16384,
	defaultTemperature: 0.7,
	verboseLogging: false,
	sessionTimeoutMinutes: 60,
}

// Default models per provider
export const DEFAULT_MODELS: Record<ProviderType, string> = {
	openrouter: "anthropic/claude-sonnet-4",
	anthropic: "claude-sonnet-4-20250514",
	openai: "gpt-4o",
	minimax: "minimax/minimax-m2.5",
	gemini: "gemini-1.5-pro",
	deepseek: "deepseek-chat",
	groq: "llama-3.1-70b-versatile",
	mistral: "mistral-large-latest",
}

// Base URLs per provider
export const PROVIDER_BASE_URLS: Record<ProviderType, string> = {
	openrouter: "https://openrouter.ai/api/v1",
	anthropic: "https://api.anthropic.com",
	openai: "https://api.openai.com/v1",
	minimax: "https://api.minimax.io/anthropic",
	gemini: "https://generativelanguage.googleapis.com/v1beta",
	deepseek: "https://api.deepseek.com/v1",
	groq: "https://api.groq.com/openai/v1",
	mistral: "https://api.mistral.ai/v1",
}

// Map provider types to their API key environment variable names
const API_KEY_ENV_MAP: Record<ProviderType, string> = {
	openrouter: "OPENROUTER_API_KEY",
	anthropic: "ANTHROPIC_API_KEY",
	openai: "OPENAI_API_KEY",
	minimax: "MINIMAX_API_KEY",
	gemini: "GEMINI_API_KEY",
	deepseek: "DEEPSEEK_API_KEY",
	groq: "GROQ_API_KEY",
	mistral: "MISTRAL_API_KEY",
}

// ============================================================================
// .env File Utilities
// ============================================================================

/**
 * Parse .env file content into key-value pairs
 */
function parseEnvFile(content: string): Map<string, string> {
	const result = new Map<string, string>()
	const lines = content.split("\n")

	for (const line of lines) {
		const trimmed = line.trim()
		// Skip comments and empty lines
		if (!trimmed || trimmed.startsWith("#")) continue

		const eqIndex = trimmed.indexOf("=")
		if (eqIndex > 0) {
			const key = trimmed.slice(0, eqIndex).trim()
			let value = trimmed.slice(eqIndex + 1).trim()
			// Remove surrounding quotes if present
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
				value = value.slice(1, -1)
			}
			result.set(key, value)
		}
	}

	return result
}

/**
 * Update .env file with new values while preserving structure and comments
 */
function updateEnvFile(envPath: string, updates: Record<string, string>): void {
	let content = ""
	const existingKeys = new Set<string>()

	if (fs.existsSync(envPath)) {
		content = fs.readFileSync(envPath, "utf-8")
		const lines = content.split("\n")
		const updatedLines: string[] = []

		for (const line of lines) {
			const trimmed = line.trim()
			// Preserve comments and empty lines
			if (!trimmed || trimmed.startsWith("#")) {
				updatedLines.push(line)
				continue
			}

			const eqIndex = trimmed.indexOf("=")
			if (eqIndex > 0) {
				const key = trimmed.slice(0, eqIndex).trim()
				existingKeys.add(key)
				if (key in updates) {
					// Update existing key
					updatedLines.push(`${key}=${updates[key]}`)
				} else {
					// Keep existing line
					updatedLines.push(line)
				}
			} else {
				updatedLines.push(line)
			}
		}

		content = updatedLines.join("\n")
	}

	// Add any new keys that weren't in the file
	const newKeys = Object.keys(updates).filter((k) => !existingKeys.has(k))
	if (newKeys.length > 0) {
		if (content && !content.endsWith("\n")) content += "\n"
		for (const key of newKeys) {
			content += `${key}=${updates[key]}\n`
		}
	}

	fs.writeFileSync(envPath, content)
}

// ============================================================================
// Settings Manager
// ============================================================================

class SettingsManager {
	private settings: ServerSettings
	private envPath: string
	private initialized = false

	constructor() {
		this.settings = { ...DEFAULT_SETTINGS }
		this.envPath = ""
	}

	/**
	 * Initialize settings from a workspace path
	 */
	initialize(workspacePath: string): void {
		this.envPath = path.join(workspacePath, ".env")
		this.settings.workspacePath = workspacePath
		this.settings.projectsDir = path.join(workspacePath, "projects")
		this.loadFromEnv()
		this.initialized = true
		log.info(`Settings initialized from .env`)
	}

	/**
	 * Load from environment variables (the single source of truth)
	 */
	private loadFromEnv(): void {
		// Check for explicit provider selection
		const activeProvider = process.env.ACTIVE_PROVIDER as ProviderType | undefined
		const activeModel = process.env.ACTIVE_MODEL

		if (activeProvider) {
			// Use explicitly selected provider
			const apiKeyEnv = API_KEY_ENV_MAP[activeProvider]
			const apiKey = process.env[apiKeyEnv]

			if (apiKey) {
				this.settings.provider = {
					type: activeProvider,
					apiKey,
					model: activeModel || DEFAULT_MODELS[activeProvider],
				}
				log.info(`Loaded ${activeProvider} config from .env (ACTIVE_PROVIDER)`)
			} else {
				log.warn(`ACTIVE_PROVIDER=${activeProvider} but ${apiKeyEnv} is not set`)
			}
		} else {
			// Fallback: Check providers in priority order (legacy behavior)
			if (process.env.OPENROUTER_API_KEY) {
				this.settings.provider = {
					type: "openrouter",
					apiKey: process.env.OPENROUTER_API_KEY,
					model: process.env.OPENROUTER_MODEL_ID || DEFAULT_MODELS.openrouter,
				}
				log.info("Loaded OpenRouter config from .env")
			} else if (process.env.ANTHROPIC_API_KEY) {
				this.settings.provider = {
					type: "anthropic",
					apiKey: process.env.ANTHROPIC_API_KEY,
					model: process.env.API_MODEL_ID || DEFAULT_MODELS.anthropic,
				}
				log.info("Loaded Anthropic config from .env")
			} else if (process.env.OPENAI_API_KEY) {
				this.settings.provider = {
					type: "openai",
					apiKey: process.env.OPENAI_API_KEY,
					model: process.env.OPENAI_MODEL_ID || DEFAULT_MODELS.openai,
				}
				log.info("Loaded OpenAI config from .env")
			}
		}

		// Load other settings from env
		if (process.env.PORT) {
			this.settings.port = parseInt(process.env.PORT, 10)
		}
		if (process.env.VERBOSE_LOGGING === "true") {
			this.settings.verboseLogging = true
		}
	}

	/**
	 * Save settings to .env file
	 */
	save(): void {
		const updates: Record<string, string> = {
			ACTIVE_PROVIDER: this.settings.provider.type,
			ACTIVE_MODEL: this.settings.provider.model,
			PORT: String(this.settings.port),
			VERBOSE_LOGGING: String(this.settings.verboseLogging),
		}

		// Set the appropriate API key for the active provider
		const apiKeyEnv = API_KEY_ENV_MAP[this.settings.provider.type]
		if (apiKeyEnv && this.settings.provider.apiKey) {
			updates[apiKeyEnv] = this.settings.provider.apiKey
		}

		updateEnvFile(this.envPath, updates)

		// Also update process.env so changes take effect immediately
		Object.entries(updates).forEach(([key, value]) => {
			process.env[key] = value
		})

		log.info(`Settings saved to .env`)
	}

	/**
	 * Get current settings
	 */
	get(): ServerSettings {
		return { ...this.settings }
	}

	/**
	 * Get provider config
	 */
	getProvider(): ProviderConfig {
		return { ...this.settings.provider }
	}

	/**
	 * Update settings
	 */
	update(partial: Partial<ServerSettings>): void {
		this.settings = { ...this.settings, ...partial }
		this.save()
	}

	/**
	 * Update provider config
	 */
	updateProvider(provider: Partial<ProviderConfig>): void {
		this.settings.provider = { ...this.settings.provider, ...provider }
		this.save()
	}

	/**
	 * Check if API key is configured
	 */
	hasApiKey(): boolean {
		return !!this.settings.provider.apiKey
	}

	/**
	 * Get masked API key for display
	 */
	getMaskedApiKey(): string {
		const key = this.settings.provider.apiKey
		if (!key || key.length < 12) return "Not configured"
		return `${key.slice(0, 8)}...${key.slice(-4)}`
	}

	/**
	 * Get all supported providers
	 */
	getSupportedProviders(): ProviderType[] {
		return Object.keys(DEFAULT_MODELS) as ProviderType[]
	}

	/**
	 * Get default model for a provider
	 */
	getDefaultModel(provider: ProviderType): string {
		return DEFAULT_MODELS[provider]
	}

	/**
	 * Check if initialized
	 */
	isInitialized(): boolean {
		return this.initialized
	}
}

// ============================================================================
// Singleton Export
// ============================================================================

export const settings = new SettingsManager()

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Initialize settings for the server
 */
export function initializeSettings(workspacePath: string): void {
	settings.initialize(workspacePath)
}

/**
 * Get settings summary for logging/display
 */
export function getSettingsSummary(): string {
	const s = settings.get()
	return `
Society Agent Server Settings
=============================
Provider: ${s.provider.type}
Model: ${s.provider.model}
API Key: ${settings.getMaskedApiKey()}
Port: ${s.port}
Workspace: ${s.workspacePath}
Projects: ${s.projectsDir}
Verbose: ${s.verboseLogging}
`.trim()
}
