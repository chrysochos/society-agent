// Society Agent - new file
/**
 * Mock vscode module for standalone server mode
 * 
 * When running society-server outside of VS Code, this mock provides
 * dummy implementations for vscode APIs that are imported transitively.
 */

// Register the mock before any other imports
const Module = require('module')
const originalRequire = Module.prototype.require

Module.prototype.require = function(id: string, ...args: any[]) {
	if (id === 'vscode') {
		return {
			// Minimal mock for telemetry and other dependencies
			workspace: {
				getConfiguration: () => ({
					get: () => undefined,
					has: () => false,
					inspect: () => undefined,
					update: () => Promise.resolve(),
				}),
				workspaceFolders: [],
				onDidChangeConfiguration: () => ({ dispose: () => {} }),
			},
			window: {
				showInformationMessage: () => Promise.resolve(),
				showWarningMessage: () => Promise.resolve(),
				showErrorMessage: () => Promise.resolve(),
				createOutputChannel: () => ({
					appendLine: () => {},
					append: () => {},
					clear: () => {},
					show: () => {},
					hide: () => {},
					dispose: () => {},
				}),
			},
			ExtensionContext: class {},
			Uri: {
				file: (path: string) => ({ fsPath: path, path, scheme: 'file' }),
				parse: (str: string) => ({ fsPath: str, path: str, scheme: 'file' }),
			},
			EventEmitter: class {
				event = () => ({ dispose: () => {} })
				fire() {}
				dispose() {}
			},
			Disposable: {
				from: () => ({ dispose: () => {} }),
			},
			env: {
				machineId: 'standalone-server',
				sessionId: 'standalone-session',
			},
			version: '1.0.0',
		}
	}
	return originalRequire.apply(this, [id, ...args])
}

export {}
