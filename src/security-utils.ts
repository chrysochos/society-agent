/**
 * Security utilities for input validation and sanitization
 * Addresses CodeQL alerts for path injection, prototype pollution, etc.
 */

import * as path from "path"
import * as fs from "fs"

/**
 * Validate and normalize a file path to prevent path traversal attacks.
 * Ensures the resolved path stays within the allowed base directory.
 * 
 * @param userPath - The untrusted path from user/agent input
 * @param baseDir - The allowed base directory (e.g., projectsDir)
 * @returns The validated absolute path
 * @throws Error if path escapes baseDir or is invalid
 */
export function validatePath(userPath: string, baseDir: string): string {
	if (!userPath || typeof userPath !== "string") {
		throw new Error("Invalid path: must be a non-empty string")
	}
	
	// Resolve to absolute path
	const resolvedBase = path.resolve(baseDir)
	const resolvedPath = path.resolve(baseDir, userPath)
	
	// Check that resolved path is within base directory
	// Use path.sep to ensure we don't match partial directory names
	// e.g., /projects-backup should not match /projects
	if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
		throw new Error(`Path traversal blocked: ${userPath} escapes ${baseDir}`)
	}
	
	return resolvedPath
}

/**
 * Validate path and check that it exists.
 * 
 * @param userPath - The untrusted path
 * @param baseDir - The allowed base directory
 * @returns The validated absolute path
 * @throws Error if path is invalid or doesn't exist
 */
export function validateExistingPath(userPath: string, baseDir: string): string {
	const validated = validatePath(userPath, baseDir)
	if (!fs.existsSync(validated)) {
		throw new Error(`Path does not exist: ${userPath}`)
	}
	return validated
}

/**
 * Safely iterate over object entries, filtering out prototype pollution keys.
 * Use this when iterating over untrusted JSON objects.
 * 
 * @param obj - The object to iterate (may come from untrusted JSON)
 * @returns Array of [key, value] pairs, excluding dangerous properties
 */
export function safeObjectEntries<T>(obj: Record<string, T> | undefined | null): Array<[string, T]> {
	if (!obj || typeof obj !== "object") {
		return []
	}
	
	const dangerousKeys = new Set(["__proto__", "constructor", "prototype"])
	
	return Object.entries(obj).filter(([key]) => {
		// Filter out dangerous prototype properties
		if (dangerousKeys.has(key)) {
			return false
		}
		// Also check that it's own property, not inherited
		return Object.prototype.hasOwnProperty.call(obj, key)
	})
}

/**
 * Sanitize a git branch/ref name to prevent command injection.
 * Only allows alphanumeric, dash, underscore, slash, and dot.
 * 
 * @param ref - The git ref (branch, tag, commit hash)
 * @returns Sanitized ref safe for use in git commands
 */
export function sanitizeGitRef(ref: string): string {
	if (!ref || typeof ref !== "string") {
		return ""
	}
	// Git refs can contain: alphanumeric, -, _, /, .
	// They cannot contain: .., spaces, ~, ^, :, ?, *, [, @{, \
	// For safety, we only allow a strict subset
	const sanitized = ref.replace(/[^a-zA-Z0-9\-_\/\.]/g, "")
	
	// Additional checks
	if (sanitized.includes("..")) {
		throw new Error("Invalid git ref: contains '..'")
	}
	if (sanitized.startsWith("-")) {
		throw new Error("Invalid git ref: cannot start with '-'")
	}
	
	return sanitized
}

/**
 * Validate that a string is a valid git commit hash (SHA-1 or abbreviated).
 */
export function isValidGitHash(hash: string): boolean {
	if (!hash || typeof hash !== "string") {
		return false
	}
	// Full SHA-1 is 40 hex chars, abbreviated is typically 7+
	return /^[a-f0-9]{7,40}$/i.test(hash)
}

/**
 * Escape HTML special characters to prevent XSS.
 */
export function escapeHtml(str: string): string {
	if (!str || typeof str !== "string") {
		return ""
	}
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;")
}

/**
 * Create a safe filename from user input.
 * Removes path separators and dangerous characters.
 */
export function sanitizeFilename(name: string): string {
	if (!name || typeof name !== "string") {
		return "unnamed"
	}
	return name
		.replace(/[\/\\]/g, "_") // Replace path separators
		.replace(/\.\./g, "_")   // Prevent .. traversal
		.replace(/[<>:"|?*]/g, "_") // Windows forbidden chars
		.replace(/[\x00-\x1f]/g, "") // Control characters
		.substring(0, 255) // Max filename length
}

/**
 * Validate that an object key is safe (not a prototype pollution vector).
 */
export function isSafeKey(key: string): boolean {
	const dangerousKeys = ["__proto__", "constructor", "prototype"]
	return typeof key === "string" && !dangerousKeys.includes(key)
}

/**
 * Escape a string for safe use in shell single quotes.
 * Single quotes are the safest for shell - no expansion happens inside them.
 * The only character that needs escaping is the single quote itself.
 */
export function escapeShellArg(arg: string): string {
	if (!arg || typeof arg !== "string") {
		return "''"
	}
	// Replace ' with '\'' (end quote, escaped quote, start quote)
	return "'" + arg.replace(/'/g, "'\\''") + "'"
}

/**
 * Sanitize a commit message for git.
 * Removes/escapes shell special characters.
 */
export function sanitizeCommitMessage(message: string): string {
	if (!message || typeof message !== "string") {
		return "No message"
	}
	// Remove null bytes and other control characters except newlines
	return message
		.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
		.substring(0, 5000) // Reasonable limit
}
