// kilocode_change - new file
/**
 * Provider Configuration for Society Agent Standalone Server
 *
 * Uses the full KiloCode provider system via buildApiHandler.
 * Reads provider settings from:
 * 1. .society-agent/provider-settings.json in workspace (full ProviderSettings)
 * 2. .society-agent/provider-config.json (legacy format)
 * 3. Environment variables (fallback mapping to ProviderSettings)
 *
 * Supports ALL KiloCode providers (30+): anthropic, openrouter, gemini, bedrock,
 * vertex, openai, ollama, minimax, deepseek, mistral, groq, xai, etc.
 */

import * as fs from "fs"
import * as path from "path"
import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { type ProviderSettings, type ProviderName, providerNames } from "@roo-code/types"
import { buildApiHandler, type ApiHandler } from "../../api/index"
import { getLog } from "./logger"

const log = getLog()

// ============================================================================
// Types
// ============================================================================

// Legacy types for backward compatibility
export type ProviderType = "anthropic" | "openrouter" | "openai" | "minimax" | "custom"

export interface ProviderConfig {
	provider: ProviderType
	apiKey: string
	model: string
	baseUrl?: string
	maxTokens?: number
	temperature?: number
}

export interface ProviderConfigFile {
	activeProvider: ProviderType
	providers: {
		anthropic?: { apiKey: string; model: string }
		openrouter?: { apiKey: string; model: string }
		minimax?: { apiKey: string; model: string }
		openai?: { apiKey: string; model: string; baseUrl?: string }
		custom?: { apiKey: string; model: string; baseUrl: string }
	}
}

// Default models for common providers
const DEFAULT_MODELS: Record<string, string> = {
	anthropic: "claude-sonnet-4-20250514",
	openrouter: "anthropic/claude-3.5-sonnet",
	minimax: "MiniMax-M1-80k",
	openai: "gpt-4o",
	"openai-native": "gpt-4o",
	gemini: "gemini-2.0-flash",
	bedrock: "anthropic.claude-3-5-sonnet-20241022-v2:0",
	vertex: "claude-3-5-sonnet-v2@20241022",
	deepseek: "deepseek-chat",
	mistral: "mistral-large-latest",
	groq: "llama-3.1-70b-versatile",
	xai: "grok-beta",
	ollama: "llama3.1",
	lmstudio: "local-model",
	custom: "custom-model",
}

// ============================================================================
// File Paths
// ============================================================================

function getLegacyConfigPath(workspacePath: string): string {
	return path.join(workspacePath, ".society-agent", "provider-config.json")
}

function getProviderSettingsPath(workspacePath: string): string {
	return path.join(workspacePath, ".society-agent", "provider-settings.json")
}

// ============================================================================
// Full ProviderSettings (NEW - uses buildApiHandler)
// ============================================================================

/**
 * Load full ProviderSettings for use with buildApiHandler
 * Priority: provider-settings.json > legacy config > environment variables
 */
export function loadProviderSettings(workspacePath: string): ProviderSettings {
	const settingsPath = getProviderSettingsPath(workspacePath)

	// Try to load full provider settings file
	if (fs.existsSync(settingsPath)) {
		try {
			const content = fs.readFileSync(settingsPath, "utf-8")
			const settings: ProviderSettings = JSON.parse(content)
			if (settings.apiProvider) {
				log.info(`Loaded full ProviderSettings (${settings.apiProvider}) from ${settingsPath}`)
				return settings
			}
		} catch (error) {
			log.warn(`Failed to load provider settings from ${settingsPath}: ${error}`)
		}
	}

	// Try legacy config file
	const legacyPath = getLegacyConfigPath(workspacePath)
	if (fs.existsSync(legacyPath)) {
		try {
			const content = fs.readFileSync(legacyPath, "utf-8")
			const config: ProviderConfigFile = JSON.parse(content)
			const settings = legacyConfigToProviderSettings(config)
			if (settings) {
				log.info(`Loaded legacy config (${settings.apiProvider}) from ${legacyPath}`)
				return settings
			}
		} catch (error) {
			log.warn(`Failed to load legacy config from ${legacyPath}: ${error}`)
		}
	}

	// Fall back to environment variables
	return envToProviderSettings()
}

/**
 * Convert legacy ProviderConfigFile to ProviderSettings
 */
function legacyConfigToProviderSettings(config: ProviderConfigFile): ProviderSettings | null {
	const provider = config.activeProvider
	const providerSettings = config.providers[provider]

	if (!providerSettings?.apiKey) return null

	switch (provider) {
		case "anthropic":
			return {
				apiProvider: "anthropic",
				apiKey: providerSettings.apiKey,
				apiModelId: providerSettings.model || DEFAULT_MODELS.anthropic,
			}
		case "openrouter":
			return {
				apiProvider: "openrouter",
				openRouterApiKey: providerSettings.apiKey,
				openRouterModelId: providerSettings.model || DEFAULT_MODELS.openrouter,
			}
		case "minimax":
			return {
				apiProvider: "minimax",
				minimaxApiKey: providerSettings.apiKey,
				apiModelId: providerSettings.model || DEFAULT_MODELS.minimax,
			}
		case "openai":
			return {
				apiProvider: "openai",
				openAiApiKey: providerSettings.apiKey,
				openAiModelId: providerSettings.model || DEFAULT_MODELS.openai,
				openAiBaseUrl: (providerSettings as any).baseUrl,
			}
		default:
			return null
	}
}

/**
 * Convert environment variables to ProviderSettings
 */
function envToProviderSettings(): ProviderSettings {
	// Check providers in priority order

	// OpenRouter
	if (process.env.OPENROUTER_API_KEY) {
		log.info("Using OpenRouter from OPENROUTER_API_KEY environment variable")
		return {
			apiProvider: "openrouter",
			openRouterApiKey: process.env.OPENROUTER_API_KEY,
			openRouterModelId: process.env.OPENROUTER_MODEL_ID || DEFAULT_MODELS.openrouter,
		}
	}

	// MiniMax
	if (process.env.MINIMAX_API_KEY) {
		log.info("Using MiniMax from MINIMAX_API_KEY environment variable")
		return {
			apiProvider: "minimax",
			minimaxApiKey: process.env.MINIMAX_API_KEY,
			apiModelId: process.env.MINIMAX_MODEL_ID || DEFAULT_MODELS.minimax,
		}
	}

	// Anthropic
	if (process.env.ANTHROPIC_API_KEY) {
		log.info("Using Anthropic from ANTHROPIC_API_KEY environment variable")
		return {
			apiProvider: "anthropic",
			apiKey: process.env.ANTHROPIC_API_KEY,
			apiModelId: process.env.API_MODEL_ID || DEFAULT_MODELS.anthropic,
		}
	}

	// OpenAI Native
	if (process.env.OPENAI_API_KEY) {
		log.info("Using OpenAI from OPENAI_API_KEY environment variable")
		return {
			apiProvider: "openai-native",
			openAiNativeApiKey: process.env.OPENAI_API_KEY,
			apiModelId: process.env.OPENAI_MODEL_ID || DEFAULT_MODELS["openai-native"],
		}
	}

	// Gemini
	if (process.env.GEMINI_API_KEY) {
		log.info("Using Gemini from GEMINI_API_KEY environment variable")
		return {
			apiProvider: "gemini",
			geminiApiKey: process.env.GEMINI_API_KEY,
			apiModelId: process.env.GEMINI_MODEL_ID || DEFAULT_MODELS.gemini,
		}
	}

	// DeepSeek
	if (process.env.DEEPSEEK_API_KEY) {
		log.info("Using DeepSeek from DEEPSEEK_API_KEY environment variable")
		return {
			apiProvider: "deepseek",
			deepSeekApiKey: process.env.DEEPSEEK_API_KEY,
			apiModelId: process.env.DEEPSEEK_MODEL_ID || DEFAULT_MODELS.deepseek,
		}
	}

	// Mistral
	if (process.env.MISTRAL_API_KEY) {
		log.info("Using Mistral from MISTRAL_API_KEY environment variable")
		return {
			apiProvider: "mistral",
			mistralApiKey: process.env.MISTRAL_API_KEY,
			apiModelId: process.env.MISTRAL_MODEL_ID || DEFAULT_MODELS.mistral,
		}
	}

	// Groq
	if (process.env.GROQ_API_KEY) {
		log.info("Using Groq from GROQ_API_KEY environment variable")
		return {
			apiProvider: "groq",
			groqApiKey: process.env.GROQ_API_KEY,
			apiModelId: process.env.GROQ_MODEL_ID || DEFAULT_MODELS.groq,
		}
	}

	// xAI
	if (process.env.XAI_API_KEY) {
		log.info("Using xAI from XAI_API_KEY environment variable")
		return {
			apiProvider: "xai",
			xaiApiKey: process.env.XAI_API_KEY,
			apiModelId: process.env.XAI_MODEL_ID || DEFAULT_MODELS.xai,
		}
	}

	// Ollama (local)
	if (process.env.OLLAMA_BASE_URL || process.env.OLLAMA_MODEL) {
		log.info("Using Ollama from environment variables")
		return {
			apiProvider: "ollama",
			ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
			ollamaModelId: process.env.OLLAMA_MODEL || DEFAULT_MODELS.ollama,
		}
	}

	throw new Error(
		"No API key configured. Set one of these environment variables:\n" +
			"  ANTHROPIC_API_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY,\n" +
			"  DEEPSEEK_API_KEY, MISTRAL_API_KEY, GROQ_API_KEY, XAI_API_KEY, MINIMAX_API_KEY\n" +
			"Or create .society-agent/provider-settings.json with full ProviderSettings",
	)
}

/**
 * Save full ProviderSettings to file
 */
export async function saveProviderSettings(workspacePath: string, settings: ProviderSettings): Promise<void> {
	const settingsPath = getProviderSettingsPath(workspacePath)
	const configDir = path.dirname(settingsPath)

	if (!fs.existsSync(configDir)) {
		fs.mkdirSync(configDir, { recursive: true })
	}

	fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
	log.info(`Saved ProviderSettings (${settings.apiProvider}) to ${settingsPath}`)
}

/**
 * Build API handler using full KiloCode provider system
 * This gives access to ALL 30+ providers supported by KiloCode
 */
export function buildSocietyApiHandler(workspacePath: string): ApiHandler {
	const settings = loadProviderSettings(workspacePath)
	return buildApiHandler(settings)
}

/**
 * Build API handler from explicit ProviderSettings
 */
export function buildApiHandlerFromSettings(settings: ProviderSettings): ApiHandler {
	return buildApiHandler(settings)
}

/**
 * Get list of all supported provider names
 */
export function getAllProviderNames(): readonly ProviderName[] {
	return providerNames
}

/**
 * Check if a provider name is valid
 */
export function isValidProvider(name: string): name is ProviderName {
	return providerNames.includes(name as ProviderName)
}

// ============================================================================
// Legacy Functions (backward compatibility)
// ============================================================================

/**
 * Load legacy provider configuration
 * @deprecated Use loadProviderSettings() instead
 */
export function loadProviderConfig(workspacePath: string): ProviderConfig {
	const configPath = getLegacyConfigPath(workspacePath)

	// Try to load from config file
	if (fs.existsSync(configPath)) {
		try {
			const content = fs.readFileSync(configPath, "utf-8")
			const config: ProviderConfigFile = JSON.parse(content)
			const activeProvider = config.activeProvider || "anthropic"
			const providerSettings = config.providers[activeProvider]

			if (providerSettings?.apiKey) {
				log.info(`[Legacy] Loaded ${activeProvider} configuration from ${configPath}`)
				return {
					provider: activeProvider,
					apiKey: providerSettings.apiKey,
					model: providerSettings.model || DEFAULT_MODELS[activeProvider] || "claude-sonnet-4-20250514",
					baseUrl: (providerSettings as any).baseUrl,
				}
			}
		} catch (error) {
			log.warn(`Failed to load provider config from ${configPath}: ${error}`)
		}
	}

	// Fall back to environment variables
	if (process.env.OPENROUTER_API_KEY) {
		return {
			provider: "openrouter",
			apiKey: process.env.OPENROUTER_API_KEY,
			model: process.env.OPENROUTER_MODEL_ID || DEFAULT_MODELS.openrouter,
		}
	}

	if (process.env.MINIMAX_API_KEY) {
		return {
			provider: "minimax",
			apiKey: process.env.MINIMAX_API_KEY,
			model: process.env.MINIMAX_MODEL_ID || DEFAULT_MODELS.minimax,
		}
	}

	if (process.env.ANTHROPIC_API_KEY) {
		return {
			provider: "anthropic",
			apiKey: process.env.ANTHROPIC_API_KEY,
			model: process.env.API_MODEL_ID || DEFAULT_MODELS.anthropic,
		}
	}

	if (process.env.OPENAI_API_KEY) {
		return {
			provider: "openai",
			apiKey: process.env.OPENAI_API_KEY,
			model: process.env.OPENAI_MODEL_ID || DEFAULT_MODELS.openai,
		}
	}

	throw new Error(
		"No API key configured. Set ANTHROPIC_API_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY, or MINIMAX_API_KEY " +
			"environment variable, or create .society-agent/provider-config.json",
	)
}

/**
 * Save legacy provider configuration to file
 * @deprecated Use saveProviderSettings() instead
 */
export async function saveProviderConfig(
	workspacePath: string,
	provider: ProviderType,
	apiKey: string,
	model?: string,
): Promise<void> {
	const configPath = getLegacyConfigPath(workspacePath)
	const configDir = path.dirname(configPath)

	if (!fs.existsSync(configDir)) {
		fs.mkdirSync(configDir, { recursive: true })
	}

	let config: ProviderConfigFile = {
		activeProvider: provider,
		providers: {},
	}

	if (fs.existsSync(configPath)) {
		try {
			config = JSON.parse(fs.readFileSync(configPath, "utf-8"))
		} catch {
			// Use default
		}
	}

	config.activeProvider = provider
	;(config.providers as any)[provider] = {
		apiKey,
		model: model || DEFAULT_MODELS[provider] || "claude-sonnet-4-20250514",
	}

	fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
	log.info(`[Legacy] Saved ${provider} configuration to ${configPath}`)
}

/**
 * Get list of configured providers (legacy types)
 */
export function getConfiguredProviders(workspacePath: string): ProviderType[] {
	const providers: ProviderType[] = []
	const configPath = getLegacyConfigPath(workspacePath)

	if (fs.existsSync(configPath)) {
		try {
			const config: ProviderConfigFile = JSON.parse(fs.readFileSync(configPath, "utf-8"))
			for (const [provider, settings] of Object.entries(config.providers || {})) {
				if (settings?.apiKey) {
					providers.push(provider as ProviderType)
				}
			}
		} catch {
			// Ignore
		}
	}

	// Check environment variables
	if (process.env.ANTHROPIC_API_KEY && !providers.includes("anthropic")) {
		providers.push("anthropic")
	}
	if (process.env.OPENROUTER_API_KEY && !providers.includes("openrouter")) {
		providers.push("openrouter")
	}
	if (process.env.MINIMAX_API_KEY && !providers.includes("minimax")) {
		providers.push("minimax")
	}
	if (process.env.OPENAI_API_KEY && !providers.includes("openai")) {
		providers.push("openai")
	}

	return providers
}

/**
 * Create simple API handler for legacy provider config
 * @deprecated Use buildSocietyApiHandler() instead
 */
export function createApiHandler(config: ProviderConfig) {
	switch (config.provider) {
		case "anthropic":
			return createAnthropicHandler(config)
		case "minimax":
			return createMiniMaxHandler(config)
		case "openrouter":
			return createOpenRouterHandler(config)
		case "openai":
			return createOpenAIHandler(config)
		default:
			throw new Error(`Unsupported provider: ${config.provider}`)
	}
}

// Simple legacy handlers (used by createApiHandler)
function createAnthropicHandler(config: ProviderConfig) {
	const anthropic = new Anthropic({ apiKey: config.apiKey })
	return {
		createMessage: async function* (systemPrompt: string, messages: any[]) {
			const stream = await anthropic.messages.stream({
				model: config.model,
				max_tokens: config.maxTokens || 8096,
				system: systemPrompt,
				messages: messages.map((m) => ({
					role: m.role === "assistant" ? "assistant" : "user",
					content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
				})),
			})
			for await (const chunk of stream) {
				if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
					yield { type: "text", text: chunk.delta.text }
				}
			}
			const finalMessage = await stream.finalMessage()
			return { stopReason: finalMessage.stop_reason || "end_turn" }
		},
	}
}

function createMiniMaxHandler(config: ProviderConfig) {
	const anthropic = new Anthropic({
		apiKey: config.apiKey,
		baseURL: "https://api.minimax.io/anthropic",
	})
	return {
		createMessage: async function* (systemPrompt: string, messages: any[]) {
			const stream = await anthropic.messages.stream({
				model: config.model,
				max_tokens: config.maxTokens || 8096,
				system: systemPrompt,
				messages: messages.map((m) => ({
					role: m.role === "assistant" ? "assistant" : "user",
					content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
				})),
			})
			for await (const chunk of stream) {
				if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
					yield { type: "text", text: chunk.delta.text }
				}
			}
			const finalMessage = await stream.finalMessage()
			return { stopReason: finalMessage.stop_reason || "end_turn" }
		},
	}
}

function createOpenRouterHandler(config: ProviderConfig) {
	const openai = new OpenAI({
		apiKey: config.apiKey,
		baseURL: "https://openrouter.ai/api/v1",
		defaultHeaders: {
			"HTTP-Referer": "https://kilocode.ai",
			"X-Title": "Society Agent",
		},
	})
	return {
		createMessage: async function* (systemPrompt: string, messages: any[]) {
			const stream = await openai.chat.completions.create({
				model: config.model,
				max_tokens: config.maxTokens || 8096,
				stream: true,
				messages: [
					{ role: "system", content: systemPrompt },
					...messages.map((m) => ({
						role: m.role as "user" | "assistant",
						content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
					})),
				],
			})
			for await (const chunk of stream) {
				const delta = chunk.choices[0]?.delta
				if (delta?.content) {
					yield { type: "text", text: delta.content }
				}
			}
			return { stopReason: "end_turn" }
		},
	}
}

function createOpenAIHandler(config: ProviderConfig) {
	const openai = new OpenAI({
		apiKey: config.apiKey,
		baseURL: config.baseUrl,
	})
	return {
		createMessage: async function* (systemPrompt: string, messages: any[]) {
			const stream = await openai.chat.completions.create({
				model: config.model,
				max_tokens: config.maxTokens || 8096,
				stream: true,
				messages: [
					{ role: "system", content: systemPrompt },
					...messages.map((m) => ({
						role: m.role as "user" | "assistant",
						content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
					})),
				],
			})
			for await (const chunk of stream) {
				const delta = chunk.choices[0]?.delta
				if (delta?.content) {
					yield { type: "text", text: delta.content }
				}
			}
			return { stopReason: "end_turn" }
		},
	}
}

// ============================================================================
// One-Shot Completion (for inter-agent communication)
// ============================================================================

/**
 * Make a simple one-shot completion request (non-streaming)
 * Useful for inter-agent communication and quick queries
 * Uses the full KiloCode API handler system
 */
export async function createOneShot(
	systemPrompt: string,
	userMessage: string,
	providerSettings?: ProviderSettings,
	maxTokens?: number,
): Promise<{ text: string; usage?: { inputTokens: number; outputTokens: number } }> {
	const workspacePath = process.env.WORKSPACE_PATH || process.cwd()
	const settings = providerSettings || loadProviderSettings(workspacePath)

	// Use direct SDK calls for one-shot (simpler than streaming)
	const provider = settings.apiProvider

	// Anthropic and Anthropic-compatible (minimax)
	if (provider === "anthropic" || provider === "minimax") {
		const anthropic = new Anthropic({
			apiKey: provider === "anthropic" ? settings.apiKey : settings.minimaxApiKey,
			baseURL: provider === "minimax" ? "https://api.minimax.io/anthropic" : undefined,
		})
		const response = await anthropic.messages.create({
			model: settings.apiModelId || DEFAULT_MODELS[provider],
			max_tokens: maxTokens || 1024,
			system: systemPrompt,
			messages: [{ role: "user", content: userMessage }],
		})
		const text = response.content[0]?.type === "text" ? response.content[0].text : ""
		return {
			text,
			usage: {
				inputTokens: response.usage.input_tokens,
				outputTokens: response.usage.output_tokens,
			},
		}
	}

	// OpenAI-compatible (openrouter, openai, openai-native, deepseek, groq, mistral, xai)
	const openaiCompatible = ["openrouter", "openai", "openai-native", "deepseek", "groq", "mistral", "xai"]
	if (openaiCompatible.includes(provider || "")) {
		let apiKey: string | undefined
		let baseUrl: string | undefined
		let model: string

		switch (provider) {
			case "openrouter":
				apiKey = settings.openRouterApiKey
				baseUrl = "https://openrouter.ai/api/v1"
				model = settings.openRouterModelId || DEFAULT_MODELS.openrouter
				break
			case "openai":
				apiKey = settings.openAiApiKey
				baseUrl = settings.openAiBaseUrl
				model = settings.openAiModelId || DEFAULT_MODELS.openai
				break
			case "openai-native":
				apiKey = settings.openAiNativeApiKey
				baseUrl = settings.openAiNativeBaseUrl
				model = settings.apiModelId || DEFAULT_MODELS["openai-native"]
				break
			case "deepseek":
				apiKey = settings.deepSeekApiKey
				baseUrl = settings.deepSeekBaseUrl || "https://api.deepseek.com/v1"
				model = settings.apiModelId || DEFAULT_MODELS.deepseek
				break
			case "groq":
				apiKey = settings.groqApiKey
				baseUrl = "https://api.groq.com/openai/v1"
				model = settings.apiModelId || DEFAULT_MODELS.groq
				break
			case "mistral":
				apiKey = settings.mistralApiKey
				baseUrl = "https://api.mistral.ai/v1"
				model = settings.apiModelId || DEFAULT_MODELS.mistral
				break
			case "xai":
				apiKey = settings.xaiApiKey
				baseUrl = "https://api.x.ai/v1"
				model = settings.apiModelId || DEFAULT_MODELS.xai
				break
			default:
				throw new Error(`Unsupported provider for one-shot: ${provider}`)
		}

		const openai = new OpenAI({
			apiKey,
			baseURL: baseUrl,
			defaultHeaders:
				provider === "openrouter"
					? { "HTTP-Referer": "https://kilocode.ai", "X-Title": "Society Agent" }
					: undefined,
		})
		const response = await openai.chat.completions.create({
			model,
			max_tokens: maxTokens || 1024,
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userMessage },
			],
		})
		const text = response.choices[0]?.message?.content || ""
		return {
			text,
			usage: response.usage
				? {
						inputTokens: response.usage.prompt_tokens || 0,
						outputTokens: response.usage.completion_tokens || 0,
					}
				: undefined,
		}
	}

	// For other providers, use the streaming API handler and collect
	const handler = buildApiHandler(settings)
	const stream = handler.createMessage(systemPrompt, [{ role: "user", content: userMessage }], { taskId: "oneshot" })

	let text = ""
	let usage: { inputTokens: number; outputTokens: number } | undefined

	for await (const chunk of stream) {
		if (chunk.type === "text") {
			text += chunk.text
		} else if (chunk.type === "usage") {
			usage = {
				inputTokens: chunk.inputTokens,
				outputTokens: chunk.outputTokens,
			}
		}
	}

	return { text, usage }
}
