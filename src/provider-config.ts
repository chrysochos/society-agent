/**
 * Provider Configuration for Society Agent standalone
 * Multi-provider implementation
 */

import * as fs from "fs"
import * as path from "path"
import { ApiHandler, buildApiHandler, buildOpenAIHandler } from "./api"
import { getLog } from "./logger"

const log = getLog()

// ============================================================================
// Types
// ============================================================================

export type ProviderType = "anthropic" | "openrouter" | "openai" | "minimax" | "custom" | "gemini" | "deepseek" | "groq" | "mistral"

export interface ProviderSettings {
	apiProvider: ProviderType
	// Anthropic
	anthropicApiKey?: string
	apiModelId?: string
	// OpenRouter
	openRouterApiKey?: string
	openRouterModelId?: string
	// OpenAI
	openAiApiKey?: string
	openAiModelId?: string
	// MiniMax
	minimaxApiKey?: string
	// Gemini
	geminiApiKey?: string
	// DeepSeek
	deepseekApiKey?: string
	// Groq
	groqApiKey?: string
	// Mistral
	mistralApiKey?: string
	// Ollama (local)
	ollamaModelId?: string
	// Generic
	apiKey?: string
	maxTokens?: number
	temperature?: number
}

export type ProviderName = ProviderType
export const providerNames = ["anthropic", "openrouter", "openai", "minimax", "custom", "gemini", "deepseek", "groq", "mistral"] as const

export interface ProviderConfig {
	provider: ProviderType
	apiKey: string
	model: string
	maxTokens?: number
	temperature?: number
}

// ============================================================================
// File Paths
// ============================================================================

function getProviderSettingsPath(workspacePath: string): string {
	return path.join(workspacePath, ".society-agent", "provider-settings.json")
}

function getLegacyConfigPath(workspacePath: string): string {
	return path.join(workspacePath, ".society-agent", "provider-config.json")
}

// ============================================================================
// Load/Save Settings
// ============================================================================

/**
 * Load provider settings from workspace or environment
 */
export function loadProviderSettings(workspacePath: string): ProviderSettings {
	const settingsPath = getProviderSettingsPath(workspacePath)

	// Try to load settings file
	if (fs.existsSync(settingsPath)) {
		try {
			const content = fs.readFileSync(settingsPath, "utf-8")
			const settings = JSON.parse(content) as ProviderSettings
			// Accept settings if any API key is configured (for any provider)
			const hasApiKey = !!(
				settings.anthropicApiKey ||
				settings.openRouterApiKey ||
				settings.openAiApiKey ||
				settings.geminiApiKey ||
				settings.minimaxApiKey ||
				settings.deepseekApiKey ||
				settings.groqApiKey ||
				settings.mistralApiKey ||
				settings.apiKey ||
				process.env.ANTHROPIC_API_KEY ||
				process.env.OPENROUTER_API_KEY ||
				process.env.OPENAI_API_KEY ||
				process.env.MINIMAX_API_KEY ||
				process.env.DEEPSEEK_API_KEY ||
				process.env.GROQ_API_KEY ||
				process.env.MISTRAL_API_KEY
			)
			if (hasApiKey) {
				log.info(`Loaded ProviderSettings from ${settingsPath}`)
				return settings
			}
		} catch (e) {
			log.warn(`Failed to load ${settingsPath}:`, e)
		}
	}

	// Try legacy config
	const legacyPath = getLegacyConfigPath(workspacePath)
	if (fs.existsSync(legacyPath)) {
		try {
			const content = fs.readFileSync(legacyPath, "utf-8")
			const config = JSON.parse(content)
			if (config.providers?.anthropic?.apiKey || process.env.ANTHROPIC_API_KEY) {
				log.info(`Loaded legacy config from ${legacyPath}`)
				return {
					apiProvider: "anthropic",
					anthropicApiKey: config.providers?.anthropic?.apiKey,
					apiModelId: config.providers?.anthropic?.model,
				}
			}
		} catch (e) {
			log.warn(`Failed to load ${legacyPath}:`, e)
		}
	}

	// Fall back to environment variables
	return {
		apiProvider: "anthropic",
		anthropicApiKey: process.env.ANTHROPIC_API_KEY,
		apiModelId: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
	}
}

/**
 * Save provider settings to file
 */
export async function saveProviderSettings(workspacePath: string, settings: ProviderSettings): Promise<void> {
	const settingsPath = getProviderSettingsPath(workspacePath)
	const dir = path.dirname(settingsPath)

	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true })
	}

	fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
	log.info(`Saved ProviderSettings to ${settingsPath}`)
}

// ============================================================================
// API Handler Creation
// ============================================================================

/**
 * Create API handler from ProviderSettings
 */
export function buildApiHandlerFromSettings(settings: ProviderSettings): ApiHandler {
	const provider = settings.apiProvider || "anthropic"

	// Determine API key based on provider
	let apiKey: string | undefined
	let model: string | undefined

	switch (provider) {
		case "anthropic":
			apiKey = settings.anthropicApiKey || process.env.ANTHROPIC_API_KEY
			model = settings.apiModelId || "claude-sonnet-4-20250514"
			if (!apiKey) {
				throw new Error("No Anthropic API key found in settings or environment")
			}
			return buildApiHandler({
				apiKey,
				model,
				maxTokens: settings.maxTokens,
				temperature: settings.temperature,
			})

		case "minimax":
			apiKey = settings.minimaxApiKey || process.env.MINIMAX_API_KEY
			model = settings.apiModelId || "MiniMax-Text-01"
			if (!apiKey) {
				throw new Error("No MiniMax API key found in settings or environment (minimaxApiKey or MINIMAX_API_KEY)")
			}
			return buildOpenAIHandler(provider, {
				apiKey,
				model,
				maxTokens: settings.maxTokens,
				temperature: settings.temperature,
			})

		case "openai":
			apiKey = settings.openAiApiKey || process.env.OPENAI_API_KEY
			model = settings.openAiModelId || settings.apiModelId || "gpt-4o"
			if (!apiKey) {
				throw new Error("No OpenAI API key found in settings or environment")
			}
			return buildOpenAIHandler(provider, {
				apiKey,
				model,
				maxTokens: settings.maxTokens,
				temperature: settings.temperature,
			})

		case "openrouter":
			apiKey = settings.openRouterApiKey || process.env.OPENROUTER_API_KEY
			model = settings.openRouterModelId || settings.apiModelId || "anthropic/claude-3.5-sonnet"
			if (!apiKey) {
				throw new Error("No OpenRouter API key found in settings or environment")
			}
			return buildOpenAIHandler(provider, {
				apiKey,
				model,
				maxTokens: settings.maxTokens,
				temperature: settings.temperature,
			})

		case "deepseek":
			apiKey = settings.deepseekApiKey || settings.apiKey || process.env.DEEPSEEK_API_KEY
			model = settings.apiModelId || "deepseek-chat"
			if (!apiKey) {
				throw new Error("No DeepSeek API key found in settings or environment")
			}
			return buildOpenAIHandler(provider, {
				apiKey,
				model,
				maxTokens: settings.maxTokens,
				temperature: settings.temperature,
			})

		case "groq":
			apiKey = settings.groqApiKey || settings.apiKey || process.env.GROQ_API_KEY
			model = settings.apiModelId || "llama-3.1-70b-versatile"
			if (!apiKey) {
				throw new Error("No Groq API key found in settings or environment")
			}
			return buildOpenAIHandler(provider, {
				apiKey,
				model,
				maxTokens: settings.maxTokens,
				temperature: settings.temperature,
			})

		case "mistral":
			apiKey = settings.mistralApiKey || settings.apiKey || process.env.MISTRAL_API_KEY
			model = settings.apiModelId || "mistral-large-latest"
			if (!apiKey) {
				throw new Error("No Mistral API key found in settings or environment")
			}
			return buildOpenAIHandler(provider, {
				apiKey,
				model,
				maxTokens: settings.maxTokens,
				temperature: settings.temperature,
			})

		case "gemini":
			apiKey = settings.geminiApiKey || process.env.GEMINI_API_KEY
			if (!apiKey) {
				throw new Error("No Gemini API key found in settings or environment")
			}
			// Gemini uses a different API format - for now fall back to error
			throw new Error("Gemini provider not yet fully implemented. Please use Anthropic, OpenAI, MiniMax, or OpenRouter.")

		default:
			throw new Error(`Unknown provider: ${provider}. Supported: anthropic, openai, minimax, openrouter, deepseek, groq, mistral`)
	}
}

/**
 * Create API handler from legacy ProviderConfig
 */
export function createApiHandler(config: ProviderConfig): ApiHandler {
	const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY
	if (!apiKey) {
		throw new Error("No Anthropic API key found in config or environment")
	}

	return buildApiHandler({
		apiKey,
		model: config.model || "claude-sonnet-4-20250514",
		maxTokens: config.maxTokens,
		temperature: config.temperature,
	})
}

/**
 * Build Society API handler (uses settings or falls back to environment)
 */
export function buildSocietyApiHandler(workspacePath?: string): ApiHandler {
	if (workspacePath) {
		const settings = loadProviderSettings(workspacePath)
		return buildApiHandlerFromSettings(settings)
	}

	// No workspace - use environment directly
	return buildApiHandler()
}

/**
 * Get current provider config from workspace or environment
 */
export function getCurrentProviderConfig(workspacePath: string): ProviderConfig {
	const settings = loadProviderSettings(workspacePath)
	return {
		provider: "anthropic",
		apiKey: settings.anthropicApiKey || process.env.ANTHROPIC_API_KEY || "",
		model: settings.apiModelId || "claude-sonnet-4-20250514",
		maxTokens: settings.maxTokens,
		temperature: settings.temperature,
	}
}

/**
 * Check if provider is configured
 */
export function isProviderConfigured(workspacePath?: string): boolean {
	const apiKey = process.env.ANTHROPIC_API_KEY
	if (apiKey) return true

	if (workspacePath) {
		const settings = loadProviderSettings(workspacePath)
		return !!settings.anthropicApiKey
	}

	return false
}

// ============================================================================
// Legacy Compatibility Functions
// ============================================================================

/**
 * Load legacy provider config (backwards compatibility)
 */
export function loadProviderConfig(workspacePath: string): ProviderConfig | null {
	const settings = loadProviderSettings(workspacePath)
	// Check for any configured API key
	const hasKey = settings.anthropicApiKey || settings.openRouterApiKey || settings.openAiApiKey || 
		settings.minimaxApiKey || settings.apiKey || process.env.ANTHROPIC_API_KEY || 
		process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY
	if (!hasKey) {
		return null
	}
	return getCurrentProviderConfig(workspacePath)
}

/**
 * Save legacy provider config
 */
export async function saveProviderConfig(workspacePath: string, config: ProviderConfig): Promise<void> {
	const settings: ProviderSettings = {
		apiProvider: config.provider,
		apiKey: config.apiKey,
		apiModelId: config.model,
		maxTokens: config.maxTokens,
		temperature: config.temperature,
	}
	// Set provider-specific keys
	if (config.provider === "anthropic") {
		settings.anthropicApiKey = config.apiKey
	} else if (config.provider === "openrouter") {
		settings.openRouterApiKey = config.apiKey
		settings.openRouterModelId = config.model
	} else if (config.provider === "openai") {
		settings.openAiApiKey = config.apiKey
		settings.openAiModelId = config.model
	} else if (config.provider === "minimax") {
		settings.minimaxApiKey = config.apiKey
	}
	await saveProviderSettings(workspacePath, settings)
}

/**
 * Get configured providers
 */
export function getConfiguredProviders(workspacePath: string): ProviderType[] {
	const providers: ProviderType[] = []
	if (process.env.ANTHROPIC_API_KEY) providers.push("anthropic")
	if (process.env.OPENROUTER_API_KEY) providers.push("openrouter")
	if (process.env.OPENAI_API_KEY) providers.push("openai")
	if (process.env.MINIMAX_API_KEY) providers.push("minimax")
	return providers.length > 0 ? providers : ["anthropic"]
}

/**
 * Get all provider names
 */
export function getAllProviderNames(): ProviderName[] {
	return [...providerNames]
}

/**
 * Check if provider name is valid
 */
export function isValidProvider(name: string): name is ProviderName {
	return providerNames.includes(name as ProviderType)
}

/**
 * Create one-shot completion (without streaming)
 */
export async function createOneShot(
	workspacePath: string,
	systemPrompt: string,
	userMessage: string
): Promise<string> {
	const handler = buildSocietyApiHandler(workspacePath)
	const stream = handler.createMessage(systemPrompt, [{ role: "user", content: userMessage }])

	let result = ""
	for await (const chunk of stream) {
		if (chunk.type === "text") {
			result += chunk.text
		}
	}
	return result
}

