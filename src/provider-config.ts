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
// .env File Utilities
// ============================================================================

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
	custom: "CUSTOM_API_KEY",
}

function getEnvPath(workspacePath: string): string {
	return path.join(workspacePath, ".env")
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
// Load/Save Settings
// ============================================================================

/**
 * Load provider settings from environment variables (.env is the single source of truth)
 */
export function loadProviderSettings(workspacePath: string): ProviderSettings {
	// Determine active provider from ACTIVE_PROVIDER or detect from available API keys
	const activeProvider = (process.env.ACTIVE_PROVIDER as ProviderType) || detectActiveProvider()
	const activeModel = process.env.ACTIVE_MODEL

	const settings: ProviderSettings = {
		apiProvider: activeProvider,
		apiModelId: activeModel,
		anthropicApiKey: process.env.ANTHROPIC_API_KEY,
		openRouterApiKey: process.env.OPENROUTER_API_KEY,
		openAiApiKey: process.env.OPENAI_API_KEY,
		minimaxApiKey: process.env.MINIMAX_API_KEY,
		geminiApiKey: process.env.GEMINI_API_KEY,
		deepseekApiKey: process.env.DEEPSEEK_API_KEY,
		groqApiKey: process.env.GROQ_API_KEY,
		mistralApiKey: process.env.MISTRAL_API_KEY,
	}

	log.info(`Loaded ProviderSettings from .env: provider=${activeProvider}`)
	return settings
}

/**
 * Detect which provider to use based on available API keys
 */
function detectActiveProvider(): ProviderType {
	if (process.env.OPENROUTER_API_KEY) return "openrouter"
	if (process.env.ANTHROPIC_API_KEY) return "anthropic"
	if (process.env.OPENAI_API_KEY) return "openai"
	if (process.env.MINIMAX_API_KEY) return "minimax"
	if (process.env.DEEPSEEK_API_KEY) return "deepseek"
	if (process.env.GROQ_API_KEY) return "groq"
	if (process.env.MISTRAL_API_KEY) return "mistral"
	return "anthropic" // fallback
}

/**
 * Save provider settings to .env file
 */
export async function saveProviderSettings(workspacePath: string, settings: ProviderSettings): Promise<void> {
	const envPath = getEnvPath(workspacePath)
	const updates: Record<string, string> = {
		ACTIVE_PROVIDER: settings.apiProvider,
	}

	if (settings.apiModelId) {
		updates.ACTIVE_MODEL = settings.apiModelId
	}

	// Set provider-specific API keys
	if (settings.anthropicApiKey) updates.ANTHROPIC_API_KEY = settings.anthropicApiKey
	if (settings.openRouterApiKey) updates.OPENROUTER_API_KEY = settings.openRouterApiKey
	if (settings.openAiApiKey) updates.OPENAI_API_KEY = settings.openAiApiKey
	if (settings.minimaxApiKey) updates.MINIMAX_API_KEY = settings.minimaxApiKey
	if (settings.geminiApiKey) updates.GEMINI_API_KEY = settings.geminiApiKey
	if (settings.deepseekApiKey) updates.DEEPSEEK_API_KEY = settings.deepseekApiKey
	if (settings.groqApiKey) updates.GROQ_API_KEY = settings.groqApiKey
	if (settings.mistralApiKey) updates.MISTRAL_API_KEY = settings.mistralApiKey
	if (settings.apiKey) {
		// Generic apiKey - use for active provider
		const keyEnv = API_KEY_ENV_MAP[settings.apiProvider]
		if (keyEnv) updates[keyEnv] = settings.apiKey
	}

	updateEnvFile(envPath, updates)

	// Update process.env so changes take effect immediately
	Object.entries(updates).forEach(([key, value]) => {
		process.env[key] = value
	})

	log.info(`Saved ProviderSettings to .env`)
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

