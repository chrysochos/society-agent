// Society Agent - new file
/**
 * Minimal vscode module shim for standalone (non-VS Code) execution.
 *
 * Provides just enough of the vscode API surface so that transitive imports
 * (e.g. @roo-code/telemetry -> vscode) don't crash at require-time.
 * None of this actually does anything — it's all no-op stubs.
 */

export const env = {
	machineId: "standalone-server-" + Math.random().toString(36).slice(2, 10),
	appName: "Society Agent Standalone",
	language: "en",
	uriScheme: "society-agent",
}

export const workspace = {
	workspaceFolders: undefined as any,
	getConfiguration: (_section?: string) => ({
		get: (_key: string, defaultValue?: any) => defaultValue,
		has: (_key: string) => false,
		inspect: () => undefined,
		update: async () => {},
	}),
	onDidChangeConfiguration: () => ({ dispose: () => {} }),
	fs: {
		readFile: async () => Buffer.from(""),
		writeFile: async () => {},
		stat: async () => ({ type: 1, ctime: 0, mtime: 0, size: 0 }),
	},
}

export const window = {
	showInformationMessage: async (..._args: any[]) => undefined,
	showWarningMessage: async (..._args: any[]) => undefined,
	showErrorMessage: async (..._args: any[]) => undefined,
	createOutputChannel: (_name: string) => ({
		appendLine: (_msg: string) => {},
		append: (_msg: string) => {},
		show: () => {},
		dispose: () => {},
		clear: () => {},
	}),
	createTerminal: () => ({
		sendText: () => {},
		show: () => {},
		dispose: () => {},
	}),
	showQuickPick: async () => undefined,
	showInputBox: async () => undefined,
	withProgress: async (_options: any, task: any) =>
		task({ report: () => {} }, { isCancellationRequested: false }),
}

export const commands = {
	registerCommand: (_command: string, _callback: any) => ({ dispose: () => {} }),
	executeCommand: async (..._args: any[]) => undefined,
}

export const Uri = {
	file: (path: string) => ({ scheme: "file", fsPath: path, path, toString: () => `file://${path}` }),
	parse: (uri: string) => ({ scheme: "file", fsPath: uri, path: uri, toString: () => uri }),
}

export enum ProgressLocation {
	SourceControl = 1,
	Window = 10,
	Notification = 15,
}

export enum FileType {
	Unknown = 0,
	File = 1,
	Directory = 2,
	SymbolicLink = 64,
}

export class EventEmitter {
	event = () => ({ dispose: () => {} })
	fire() {}
	dispose() {}
}

export class CancellationTokenSource {
	token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) }
	cancel() {}
	dispose() {}
}

// Extension context stubs
export const ExtensionMode = { Production: 1, Development: 2, Test: 3 }
export const extensions = {
	getExtension: () => undefined,
	all: [],
}

export default {
	env,
	workspace,
	window,
	commands,
	Uri,
	ProgressLocation,
	FileType,
	EventEmitter,
	CancellationTokenSource,
	ExtensionMode,
	extensions,
}
