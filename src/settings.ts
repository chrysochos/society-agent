// Society Agent - new file
/**
 * Society Agent Server - Standalone Settings System
 *
 * This is a self-contained settings system for the Society Agent Server.
 * It does NOT depend on Society Agent's settings - it's a separate product.
 *
 * Settings are stored in: .society-agent/settings.json
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

// ============================================================================
// Settings Manager
// ============================================================================

class SettingsManager {
	private settings: ServerSettings
	private settingsPath: string
	private initialized = false

	constructor() {
		this.settings = { ...DEFAULT_SETTINGS }
		this.settingsPath = ""
	}

	/**
	 * Initialize settings from a workspace path
	 */
	initialize(workspacePath: string): void {
		this.settingsPath = path.join(workspacePath, ".society-agent", "settings.json")
		this.settings.workspacePath = workspacePath
		this.settings.projectsDir = path.join(workspacePath, "projects")
		this.load()
		this.initialized = true
		log.info(`Settings initialized from ${this.settingsPath}`)
	}

	/**
	 * Load settings from disk
	 */
	load(): void {
		// Also check for legacy provider-settings.json
		const legacyPath = path.join(path.dirname(this.settingsPath), "provider-settings.json")

		if (fs.existsSync(this.settingsPath)) {
			try {
				const content = fs.readFileSync(this.settingsPath, "utf-8")
				const loaded = JSON.parse(content) as Partial<ServerSettings>
				this.settings = { ...DEFAULT_SETTINGS, ...loaded }
				log.info(`Loaded settings: provider=${this.settings.provider.type}, model=${this.settings.provider.model}`)
			} catch (error) {
				log.warn(`Failed to load settings from ${this.settingsPath}: ${error}`)
			}
		} else if (fs.existsSync(legacyPath)) {
			// Migrate from legacy provider-settings.json
			try {
				const content = fs.readFileSync(legacyPath, "utf-8")
				const legacy = JSON.parse(content)
				this.migrateFromLegacy(legacy)
				this.save() // Save in new format
				log.info(`Migrated settings from legacy provider-settings.json`)
			} catch (error) {
				log.warn(`Failed to migrate legacy settings: ${error}`)
			}
		} else {
			// Check environment variables
			this.loadFromEnv()
		}
	}

	/**
	 * Migrate from legacy provider-settings.json format
	 */
	private migrateFromLegacy(legacy: Record<string, any>): void {
		if (legacy.apiProvider === "openrouter") {
			this.settings.provider = {
				type: "openrouter",
				apiKey: legacy.openRouterApiKey || "",
				model: legacy.openRouterModelId || DEFAULT_MODELS.openrouter,
			}
		} else if (legacy.apiProvider === "anthropic") {
			this.settings.provider = {
				type: "anthropic",
				apiKey: legacy.apiKey || "",
				model: legacy.apiModelId || DEFAULT_MODELS.anthropic,
			}
		} else if (legacy.apiProvider === "minimax") {
			this.settings.provider = {
				type: "minimax",
				apiKey: legacy.minimaxApiKey || "",
				model: legacy.apiModelId || DEFAULT_MODELS.minimax,
			}
		}
		// Add more providers as needed
	}

	/**
	 * Load from environment variables
	 */
	private loadFromEnv(): void {
		// Check for explicit provider selection
		const activeProvider = process.env.ACTIVE_PROVIDER as ProviderType | undefined
		const activeModel = process.env.ACTIVE_MODEL

		if (activeProvider) {
			// Use explicitly selected provider
			const apiKeyEnvMap: Record<ProviderType, string> = {
				openrouter: "OPENROUTER_API_KEY",
				anthropic: "ANTHROPIC_API_KEY",
				openai: "OPENAI_API_KEY",
				minimax: "MINIMAX_API_KEY",
				gemini: "GEMINI_API_KEY",
				deepseek: "DEEPSEEK_API_KEY",
				groq: "GROQ_API_KEY",
				mistral: "MISTRAL_API_KEY",
			}

			const apiKeyEnv = apiKeyEnvMap[activeProvider]
			const apiKey = process.env[apiKeyEnv]

			if (apiKey) {
				this.settings.provider = {
					type: activeProvider,
					apiKey,
					model: activeModel || DEFAULT_MODELS[activeProvider],
				}
				log.info(`Loaded ${activeProvider} config from environment (ACTIVE_PROVIDER)`)
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
				log.info("Loaded OpenRouter config from environment")
			} else if (process.env.ANTHROPIC_API_KEY) {
				this.settings.provider = {
					type: "anthropic",
					apiKey: process.env.ANTHROPIC_API_KEY,
					model: process.env.API_MODEL_ID || DEFAULT_MODELS.anthropic,
				}
				log.info("Loaded Anthropic config from environment")
			} else if (process.env.OPENAI_API_KEY) {
				this.settings.provider = {
					type: "openai",
					apiKey: process.env.OPENAI_API_KEY,
					model: process.env.OPENAI_MODEL_ID || DEFAULT_MODELS.openai,
				}
				log.info("Loaded OpenAI config from environment")
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
	 * Save settings to disk
	 */
	save(): void {
		const dir = path.dirname(this.settingsPath)
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true })
		}
		fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2))
		log.info(`Settings saved to ${this.settingsPath}`)
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
