// kilocode_change - new file
/**
 * Standalone Society Agent Server Launcher
 *
 * Shims the 'vscode' module so the server can run outside VS Code,
 * then launches the Express/Socket.IO server.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node -r tsx/cjs src/services/society-agent/standalone-server.ts
 *   # or via pnpm:
 *   ANTHROPIC_API_KEY=sk-ant-... pnpm server
 */

// ============================================================================
// Shim 'vscode' module before any imports touch it
// ============================================================================
const Module = require("module")
const originalResolveFilename = Module._resolveFilename

Module._resolveFilename = function (request: string, parent: any, isMain: boolean, options: any) {
	if (request === "vscode") {
		// Return our shim path instead of erroring
		return require.resolve("./vscode-shim")
	}
	return originalResolveFilename.call(this, request, parent, isMain, options)
}

// Now it's safe to import the real server
require("./society-server")
