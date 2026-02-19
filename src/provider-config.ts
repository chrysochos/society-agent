/**
 * Simplified Provider Configuration for Society Agent standalone
 * Anthropic-only implementation
 */

import * as fs from "fs"
import * as path from "path"
import { ApiHandler, buildApiHandler } from "./api"
import { getLog } from "./logger"

const log = getLog()

// ============================================================================
// Types (simplified from @roo-code/types)
// ============================================================================

export interface ProviderSettings {
	apiProvider: "anthropic"
	anthropicApiKey?: string
	apiModelId?: string
	maxTokens?: number
	temperature?: number
}

export type ProviderName = "anthropic"
export const providerNames = ["anthropic"] as const

export type ProviderType = "anthropic"

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
			if (settings.anthropicApiKey || process.env.ANTHROPIC_API_KEY) {
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
	const apiKey = settings.anthropicApiKey || process.env.ANTHROPIC_API_KEY
	if (!apiKey) {
		throw new Error("No Anthropic API key found in settings or environment")
	}

	return buildApiHandler({
		apiKey,
		model: settings.apiModelId || "claude-sonnet-4-20250514",
		maxTokens: settings.maxTokens,
		temperature: settings.temperature,
	})
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
	if (!settings.anthropicApiKey && !process.env.ANTHROPIC_API_KEY) {
		return null
	}
	return getCurrentProviderConfig(workspacePath)
}

/**
 * Save legacy provider config
 */
export async function saveProviderConfig(workspacePath: string, config: ProviderConfig): Promise<void> {
	const settings: ProviderSettings = {
		apiProvider: "anthropic",
		anthropicApiKey: config.apiKey,
		apiModelId: config.model,
		maxTokens: config.maxTokens,
		temperature: config.temperature,
	}
	await saveProviderSettings(workspacePath, settings)
}

/**
 * Get configured providers (Anthropic only in standalone)
 */
export function getConfiguredProviders(workspacePath: string): ProviderType[] {
	if (isProviderConfigured(workspacePath)) {
		return ["anthropic"]
	}
	return []
}

/**
 * Get all provider names (Anthropic only in standalone)
 */
export function getAllProviderNames(): ProviderName[] {
	return ["anthropic"]
}

/**
 * Check if provider name is valid
 */
export function isValidProvider(name: string): name is ProviderName {
	return name === "anthropic"
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

