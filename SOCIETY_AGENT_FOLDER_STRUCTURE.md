# KiloCode Folder Structure - Society Agent Analysis

**Part 2 of 5**: Complete folder maps and component breakdown

---

## CLI Component Structure

Located in: `cli/`

```
cli/
├── package.json                  # CLI dependencies (Commander, Ink, Jotai)
├── tsconfig.json                 # TypeScript config
├── esbuild.config.mjs           # Build configuration
├── src/
│   ├── index.ts                 # **ENTRY POINT** - Argument parsing, validation
│   ├── cli.ts                   # **MAIN ORCHESTRATOR** - CLI class, store setup
│   ├── types.ts                 # Type definitions for CLI
│   │
│   ├── host/                    # Extension hosting in CLI context
│   │   ├── ExtensionHost.ts     # **CRITICAL** - Runs VSCode extension bundle
│   │   ├── vscode/              # VSCode API mocking
│   │   │   ├── ExtensionContext.ts
│   │   │   ├── SecretStorage.ts
│   │   │   ├── Uri.ts
│   │   │   └── ...
│   │   └── workspaceState/
│   │       └── WorkspaceState.ts
│   │
│   ├── services/                # Core CLI services
│   │   ├── extension.ts         # Extension service wrapper
│   │   ├── history.ts           # Command history
│   │   ├── identity.ts          # **INJECTION POINT** - Identity tracking
│   │   ├── input.ts             # User input handling
│   │   ├── store.ts             # Jotai store management
│   │   └── telemetry.ts         # Telemetry integration
│   │
│   ├── commands/                # CLI commands
│   │   ├── start.ts             # Start command handler
│   │   ├── history.ts           # History command
│   │   └── ...
│   │
│   ├── components/              # Ink React TUI components
│   │   ├── App.tsx              # Main app component
│   │   ├── ChatView.tsx         # Chat interface
│   │   ├── StatusBar.tsx        # Status display
│   │   └── ...
│   │
│   └── utils/                   # Utility functions
│       ├── config.ts            # Configuration loading
│       ├── logger.ts            # Logging utilities
│       └── ...
│
├── scripts/                     # Build and deployment scripts
└── docs/                        # CLI documentation
```

### Key CLI Files Detailed

#### `cli/src/index.ts` (~100 lines)
- **Purpose**: CLI entry point with Commander.js setup
- **Key Functions**:
  - Argument parsing and validation
  - Workspace directory checking
  - Configuration file loading
  - CLI class instantiation
- **Injection Opportunity**: Early input validation, configuration injection

#### `cli/src/cli.ts` (~350 lines)
- **Purpose**: Main CLI orchestration class
- **Key Components**:
  - Jotai store creation and management
  - ExtensionService initialization
  - Identity injection for multi-user environments
  - Ink app rendering
- **Injection Opportunity**: Store middleware, identity management

#### `cli/src/host/ExtensionHost.ts` (~800 lines)
- **Purpose**: Hosts VS Code extension bundle in CLI context
- **Key Features**:
  - VSCode API mocking (workspace, window, commands, etc.)
  - Extension bundle loading and activation
  - Message passing between CLI and extension
  - Lifecycle management (activate, deactivate)
- **Injection Opportunity**: API interception, message middleware

#### `cli/src/services/extension.ts` (~200 lines)
- **Purpose**: Extension service wrapper
- **Key Methods**:
  - `createMessage()` - Send messages to extension
  - `onMessage()` - Receive messages from extension
  - `executeCommand()` - Run extension commands
- **Injection Opportunity**: Message interception for agent coordination

---

## VS Code Extension Structure

Located in: `src/`

```
src/
├── extension.ts                 # **ENTRY POINT** - Extension activation
├── package.json                 # Extension manifest
├── tsconfig.json                # TypeScript config
├── esbuild.mjs                  # Build configuration
│
├── core/                        # Core extension logic
│   ├── webview/                 # Webview management
│   │   ├── ClineProvider.ts     # **CRITICAL** - Main task coordinator (3471 lines)
│   │   ├── getNonce.ts
│   │   └── getUri.ts
│   │
│   ├── task/                    # Task execution
│   │   ├── Task.ts              # **MOST CRITICAL** - Agentic loop (3497 lines)
│   │   └── utils.ts
│   │
│   ├── prompts/                 # System prompts
│   │   ├── system.ts            # Main system prompt
│   │   ├── responses.ts         # Response templates
│   │   └── ...
│   │
│   └── tools/                   # Tool implementations (30+ tools)
│       ├── readFileTool.ts      # **INJECTION POINT** - File reads
│       ├── writeToFileTool.ts   # **INJECTION POINT** - File writes
│       ├── executeCommandTool.ts # **INJECTION POINT** - Command execution
│       ├── useMcpToolTool.ts    # MCP tool integration
│       ├── listFilesTool.ts
│       ├── searchFilesTool.ts
│       ├── listCodeDefinitionsToolTool.ts
│       ├── browserAction*.ts    # Browser automation tools
│       └── ... (20+ more tools)
│
├── api/                         # LLM API integration
│   ├── index.ts                 # **INJECTION POINT** - API handler factory
│   ├── transform/               # Request/response transformation
│   │   ├── stream.ts
│   │   └── ...
│   │
│   └── providers/               # Provider implementations
│       ├── anthropic.ts         # Anthropic Claude
│       ├── openai.ts            # OpenAI GPT
│       ├── bedrock.ts           # AWS Bedrock
│       ├── vertex.ts            # Google Vertex AI
│       ├── openrouter.ts        # OpenRouter
│       └── ... (25+ providers)
│
├── services/                    # Extension services
│   ├── mcp/                     # Model Context Protocol
│   │   ├── McpHub.ts            # MCP hub management
│   │   └── ...
│   │
│   ├── telemetry/               # Telemetry service
│   │   └── TelemetryService.ts
│   │
│   ├── browser/                 # Browser automation
│   ├── ghost/                   # Ghost services (kilocode-specific)
│   └── continuedev/             # Continue.dev integration
│
├── shared/                      # Shared utilities
│   ├── api.ts                   # API types
│   ├── messages.ts              # Message types
│   ├── ExtensionMessage.ts      # Extension messaging
│   ├── WebviewMessage.ts        # Webview messaging
│   ├── HistoryItem.ts           # History tracking
│   └── ...
│
├── integrations/                # External integrations
│   ├── diagnostics/             # Diagnostic providers
│   ├── editor/                  # Editor integrations
│   ├── misc/                    # Misc integrations
│   └── terminal/                # Terminal integrations
│
├── utils/                       # Utility functions
│   ├── path.ts
│   ├── fs.ts
│   ├── cost.ts                  # Token cost calculation
│   └── ...
│
└── __tests__/                   # Unit tests
    └── ...
```

### Key Extension Files Detailed

#### `src/extension.ts` (~400 lines)
- **Purpose**: Extension activation entry point
- **Key Functions**:
  - Extension activation/deactivation
  - ClineProvider initialization
  - Command registration
  - Telemetry setup
  - MCP Hub initialization
- **Injection Opportunity**: Early initialization middleware

#### `src/core/webview/ClineProvider.ts` (3,471 lines)
- **Purpose**: Main task coordinator and webview manager
- **Key Responsibilities**:
  - Creates Task instances for each request
  - Manages webview lifecycle
  - Handles user messages from webview
  - Coordinates API configurations
  - Manages history and state
- **Key Methods**:
  - `initClineWithTask()` - Creates new Task
  - `postMessageToWebview()` - Send updates to UI
  - `handleWebviewMessage()` - Process user actions
- **Injection Opportunity**: Task creation wrapper, message middleware

#### `src/core/task/Task.ts` (3,497 lines) ⭐ **MOST IMPORTANT**
- **Purpose**: Core agentic execution loop
- **Key Methods**:
  - `startTask()` - Initialize task execution
  - `initiateTaskLoop()` - Start the agentic loop
  - `recursivelyMakeClineRequests()` - **THE MAIN LOOP**
  - `executeTool()` - Execute individual tools
  - `say()` - Send messages to user
  - `ask()` - Request user input
- **The Agentic Loop Flow**:
  ```
  startTask()
    → initiateTaskLoop()
      → recursivelyMakeClineRequests()
        → api.createMessage() [calls LLM]
        → Parse tool calls from response
        → FOR EACH tool:
            → executeTool()
              → readFileTool/writeToFileTool/executeCommandTool/etc.
            → Record result
        → Add results to conversation
        → REPEAT until task complete
  ```
- **Injection Opportunity**: **PRIMARY INJECTION POINT** for all middleware

#### `src/api/index.ts` (~800 lines)
- **Purpose**: API handler factory and provider routing
- **Key Function**: `buildApiHandler()`
  - Routes to correct provider (Anthropic, OpenAI, etc.)
  - Handles streaming responses
  - Manages API credentials
  - Error handling and retries
- **Injection Opportunity**: Request/response middleware, logging, rate limiting

#### `src/core/tools/*.ts` (30+ files, ~100-300 lines each)
- **Purpose**: Individual tool implementations
- **Common Pattern**:
  ```typescript
  export const toolDefinition = { name, description, parameters }
  export async function executeTool(params, context) {
    // Tool logic
    return result
  }
  ```
- **Key Tools**:
  - `readFileTool.ts` - Read file contents
  - `writeToFileTool.ts` - Write/edit files
  - `executeCommandTool.ts` - Run shell commands
  - `useMcpToolTool.ts` - Execute MCP tools
  - `listFilesTool.ts` - List directory contents
  - `searchFilesTool.ts` - Search in files
  - `browserAction*.ts` - Browser automation
- **Injection Opportunity**: Wrap each tool execution for logging/approval

---

## Webview UI Structure

Located in: `webview-ui/`

```
webview-ui/
├── package.json
├── vite.config.ts
├── index.html
├── src/
│   ├── App.tsx                  # Main React app
│   ├── main.tsx                 # Entry point
│   │
│   ├── components/              # React components
│   │   ├── ChatView.tsx
│   │   ├── MessageList.tsx
│   │   ├── InputArea.tsx
│   │   └── ...
│   │
│   ├── hooks/                   # React hooks
│   │   └── useExtensionState.ts # Extension state management
│   │
│   ├── utils/                   # Utilities
│   │   ├── vscode.ts            # VSCode API wrapper
│   │   └── ...
│   │
│   └── styles/                  # CSS styles
│
└── public/                      # Static assets
```

**Note**: Webview is the UI layer. Society Agent modifications primarily focus on backend (Task.ts, API, Tools).

---

## Summary: Critical Paths

### For Middleware Injection:
1. **CLI Entry**: `cli/src/index.ts` → `cli/src/cli.ts`
2. **Extension Host**: `cli/src/host/ExtensionHost.ts`
3. **Extension Entry**: `src/extension.ts` → `src/core/webview/ClineProvider.ts`
4. **Agentic Core**: `src/core/task/Task.ts` (PRIMARY)
5. **API Layer**: `src/api/index.ts`
6. **Tool Layer**: `src/core/tools/*.ts`

### For Identity Management:
- `cli/src/services/identity.ts` (CLI identity injection)
- `src/core/task/Task.ts` (extend with agent identity tracking)
- `src/shared/HistoryItem.ts` (add agent metadata to history)

### For Agent Communication:
- `src/core/webview/ClineProvider.ts` (add agent messaging)
- `src/shared/messages.ts` (extend message types)
- `cli/src/services/extension.ts` (CLI-extension bridge)

---

**Next**: See `SOCIETY_AGENT_EXECUTION_FLOWS.md` for detailed pipeline diagrams
