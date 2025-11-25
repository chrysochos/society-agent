# KiloCode Execution Flows - Society Agent Analysis

**Part 3 of 5**: Pipeline diagrams and data flow documentation

---

## Overview

This document traces the execution flow from user input through the entire KiloCode system, showing how data moves between CLI, Extension, API handlers, and tools.

---

## 1. CLI Execution Pipeline

### User invokes CLI command → Extension execution

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLI EXECUTION FLOW                          │
└─────────────────────────────────────────────────────────────────────┘

USER INPUT: kilo start [task] --workspace=/path/to/project
    │
    ▼
┌──────────────────────────────────────┐
│  cli/src/index.ts                    │  Entry Point
│  - Parse arguments (Commander.js)    │
│  - Validate workspace path           │
│  - Load configuration files          │
│  - Create CLI instance               │
└──────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────┐
│  cli/src/cli.ts                      │  Main Orchestrator
│  - Create Jotai store                │
│  - Initialize services:              │
│    * IdentityService (user tracking) │
│    * TelemetryService                │
│    * HistoryService                  │
│  - Create ExtensionService           │
│  - Inject identity into store        │
│  - Render Ink React app (TUI)       │
└──────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────┐
│  cli/src/services/extension.ts       │  Extension Service
│  - Wrap ExtensionHost                │
│  - Provide message interface:        │
│    * createMessage(msg)              │
│    * onMessage(callback)             │
│    * executeCommand(cmd)             │
└──────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────┐
│  cli/src/host/ExtensionHost.ts       │  Extension Host
│  - Mock VSCode API:                  │
│    * vscode.workspace.*              │
│    * vscode.window.*                 │
│    * vscode.commands.*               │
│    * vscode.env.*                    │
│  - Load extension bundle             │
│  - Call extension.activate()         │
│  - Establish IPC bridge              │
└──────────────────────────────────────┘
    │
    │ IPC Bridge (Message Passing)
    │ ════════════════════════════════
    │
    ▼
[Continues to VS Code Extension Pipeline...]
```

### Key Data Structures in CLI Flow

**CLI Configuration Object**:
```typescript
{
  workspace: string,
  task?: string,
  apiProvider: string,
  apiKey?: string,
  model: string,
  identity: {
    userId: string,
    userName: string
  }
}
```

**IPC Message Format**:
```typescript
{
  type: "request" | "response" | "event",
  id: string,
  command?: string,
  data: any
}
```

---

## 2. VS Code Extension Execution Pipeline

### Extension activation → Task creation → Agentic loop

```
┌─────────────────────────────────────────────────────────────────────┐
│                    VS CODE EXTENSION EXECUTION FLOW                  │
└─────────────────────────────────────────────────────────────────────┘

[From CLI via IPC Bridge or Direct VS Code Activation]
    │
    ▼
┌──────────────────────────────────────┐
│  src/extension.ts                    │  Extension Entry Point
│  - activate(context)                 │
│  - Initialize ClineProvider          │
│  - Register commands:                │
│    * cline.plusButtonClicked         │
│    * cline.settingsButtonClicked     │
│    * cline.openInNewTab              │
│  - Setup telemetry                   │
│  - Initialize MCP Hub                │
│  - Register webview view provider    │
└──────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────┐
│  src/core/webview/ClineProvider.ts   │  Task Coordinator
│  - constructor()                     │  (3471 lines)
│  - Create webview panel              │
│  - Setup message handler             │
│  - Initialize state manager          │
│  - Load history                      │
└──────────────────────────────────────┘
    │
    │ USER MESSAGE from webview or CLI
    │ "Implement authentication feature"
    │
    ▼
┌──────────────────────────────────────┐
│  ClineProvider.initClineWithTask()   │  Create New Task
│  - Parse user message                │
│  - Load API configuration            │
│  - Get list of available tools       │
│  - Create Task instance              │
│  - Pass context:                     │
│    * workspace path                  │
│    * API handler                     │
│    * tools list                      │
│    * history                         │
│    * identity (if available)         │
└──────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────┐
│  new Task(context)                   │  Task Instance Created
│  - Store context                     │
│  - Initialize conversation history   │
│  - Setup tool registry               │
│  - Prepare system prompt             │
└──────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────┐
│  Task.startTask()                    │  Task Initialization
│  - Build system prompt               │
│  - Add user message to history       │
│  - Call initiateTaskLoop()           │
└──────────────────────────────────────┘
    │
    ▼
[Continues to Agentic Loop Pipeline...]
```

---

## 3. Core Agentic Loop Pipeline ⭐ **MOST CRITICAL**

### The heart of KiloCode: Task.recursivelyMakeClineRequests()

```
┌─────────────────────────────────────────────────────────────────────┐
│                      CORE AGENTIC LOOP FLOW                          │
│                    (src/core/task/Task.ts)                          │
└─────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────┐
│  Task.initiateTaskLoop()             │
│  - Validate task state               │
│  - Start recursion                   │
└──────────────────────────────────────┘
    │
    ▼
┌────────────────────────────────────────────────────────────────┐
│  Task.recursivelyMakeClineRequests()    ◄─────────────┐       │
│  ══════════════════════════════════════                │       │
│                                                         │       │
│  STEP 1: Prepare API Request                          │       │
│  ─────────────────────────                            │       │
│  - Build conversation history                          │       │
│  - Add previous tool results                           │       │
│  - Include system prompt + tools definitions           │       │
│                                                         │       │
│  STEP 2: Call LLM API                                 │       │
│  ──────────────────────                               │       │
│  - api.createMessage({                                │       │
│      systemPrompt,                                     │       │
│      messages: conversationHistory,                    │       │
│      tools: toolDefinitions                            │       │
│    })                                                  │       │
│  - Handle streaming response                           │       │
│  - Parse response for:                                 │       │
│    * Text content                                      │       │
│    * Tool use requests                                 │       │
│    * Stop reason                                       │       │
│                                                         │       │
│  ────────────────────────────────────────────────────  │       │
│                                                         │       │
│  STEP 3: Process Response                             │       │
│  ──────────────────────                               │       │
│  IF response contains text:                            │       │
│    → Display to user via say()                         │       │
│                                                         │       │
│  IF response contains tool calls:                      │       │
│    → FOR EACH tool request:                            │       │
│        ┌────────────────────────────────────────────┐  │       │
│        │  Task.executeTool(toolName, params)       │  │       │
│        │  ────────────────────────────────          │  │       │
│        │  - Route to specific tool:                 │  │       │
│        │    * readFileTool                          │  │       │
│        │    * writeToFileTool                       │  │       │
│        │    * executeCommandTool                    │  │       │
│        │    * listFilesTool                         │  │       │
│        │    * searchFilesTool                       │  │       │
│        │    * useMcpToolTool                        │  │       │
│        │    * browserAction*                        │  │       │
│        │    * ... (30+ tools)                       │  │       │
│        │  - Execute tool logic                      │  │       │
│        │  - Handle errors                           │  │       │
│        │  - Return result                           │  │       │
│        └────────────────────────────────────────────┘  │       │
│    → Check approval requirements:                      │       │
│        IF tool needs approval (file write, command):   │       │
│          → Task.ask() - Request user approval         │       │
│          → Wait for response                           │       │
│          → IF denied: Skip tool                        │       │
│    → Collect all tool results                          │       │
│                                                         │       │
│  STEP 4: Update State                                 │       │
│  ──────────────────                                   │       │
│  - Add assistant response to history                   │       │
│  - Add tool results to history                         │       │
│  - Update token usage statistics                       │       │
│  - Send progress update to webview                     │       │
│                                                         │       │
│  STEP 5: Determine Next Action                        │       │
│  ───────────────────────────                          │       │
│  IF stop_reason == "end_turn" AND no tool calls:      │       │
│    → Task complete, exit loop                          │       │
│  ELSE IF user requested abort:                         │       │
│    → Exit loop                                         │       │
│  ELSE:                                                 │       │
│    → RECURSE ──────────────────────────────────────────┘       │
│      (go back to STEP 1)                                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────┐
│  Task Complete                       │
│  - Final state saved to history      │
│  - Telemetry sent                    │
│  - UI updated                        │
└──────────────────────────────────────┘
```

### Agentic Loop Pseudo-code

```typescript
async recursivelyMakeClineRequests() {
  while (true) {
    // STEP 1: Prepare request
    const messages = this.conversationHistory
    const tools = this.availableTools
    
    // STEP 2: Call LLM
    const response = await this.api.createMessage({
      systemPrompt: this.systemPrompt,
      messages,
      tools
    })
    
    // STEP 3: Process response
    if (response.text) {
      await this.say(response.text)
    }
    
    if (response.toolCalls?.length > 0) {
      for (const toolCall of response.toolCalls) {
        // Check approval
        if (this.needsApproval(toolCall)) {
          const approved = await this.ask("Approve this action?")
          if (!approved) continue
        }
        
        // Execute tool
        const result = await this.executeTool(
          toolCall.name,
          toolCall.parameters
        )
        
        toolResults.push(result)
      }
      
      // STEP 4: Update state
      this.conversationHistory.push({
        role: "assistant",
        content: response.toolCalls
      })
      this.conversationHistory.push({
        role: "user",
        content: toolResults
      })
      
      // STEP 5: Recurse
      continue
    }
    
    // Exit condition
    if (response.stopReason === "end_turn") {
      break
    }
  }
}
```

---

## 4. API Handler Pipeline

### LLM API request/response flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         API HANDLER FLOW                             │
│                      (src/api/index.ts)                             │
└─────────────────────────────────────────────────────────────────────┘

Task.recursivelyMakeClineRequests()
    │
    │ api.createMessage(request)
    │
    ▼
┌──────────────────────────────────────┐
│  buildApiHandler()                   │  API Factory
│  - Check provider type:              │
│    * anthropic                       │
│    * openai                          │
│    * bedrock                         │
│    * vertex                          │
│    * azure                           │
│    * openrouter                      │
│    * ... (30+ providers)             │
│  - Load provider-specific handler    │
│  - Inject credentials                │
│  - Configure streaming               │
└──────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────┐
│  Provider-specific Handler           │  e.g., anthropic.ts
│  - Transform request format          │
│  - Add provider-specific headers     │
│  - Handle rate limiting              │
│  - Make HTTP request                 │
└──────────────────────────────────────┘
    │
    │ HTTPS Request
    │
    ▼
┌──────────────────────────────────────┐
│  LLM API Endpoint                    │  External Service
│  - Process request                   │
│  - Generate response                 │
│  - Stream back results               │
└──────────────────────────────────────┘
    │
    │ Streaming Response
    │
    ▼
┌──────────────────────────────────────┐
│  Response Transformation             │  src/api/transform/
│  - Parse SSE stream                  │
│  - Extract text chunks               │
│  - Parse tool use blocks             │
│  - Calculate token usage             │
│  - Handle errors                     │
└──────────────────────────────────────┘
    │
    │ Structured Response
    │
    ▼
┌──────────────────────────────────────┐
│  Return to Task                      │
│  {                                   │
│    text: "...",                      │
│    toolCalls: [...],                 │
│    usage: { input: X, output: Y },   │
│    stopReason: "end_turn"            │
│  }                                   │
└──────────────────────────────────────┘
    │
    ▼
[Back to Agentic Loop]
```

---

## 5. Tool Execution Pipeline

### Individual tool execution flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        TOOL EXECUTION FLOW                           │
│                   (src/core/tools/*.ts)                             │
└─────────────────────────────────────────────────────────────────────┘

Task.executeTool(toolName, params)
    │
    ▼
┌──────────────────────────────────────┐
│  Tool Router                         │
│  - Match toolName to handler         │
│  - Validate parameters               │
│  - Check permissions                 │
└──────────────────────────────────────┘
    │
    ├─ readFileTool ──────────────────────────────────────┐
    │  - Resolve file path                                 │
    │  - Check file exists                                 │
    │  - Read file contents                                │
    │  - Return { success: true, content: "..." }          │
    │                                                       │
    ├─ writeToFileTool ───────────────────────────────────┤
    │  - Check approval (if needed)                        │
    │  - Resolve file path                                 │
    │  - Create parent directories                         │
    │  - Write file contents                               │
    │  - Return { success: true }                          │
    │                                                       │
    ├─ executeCommandTool ────────────────────────────────┤
    │  - Check approval (ALWAYS needed)                    │
    │  - Validate command                                  │
    │  - Spawn shell process                               │
    │  - Capture stdout/stderr                             │
    │  - Return { success: true, output: "..." }           │
    │                                                       │
    ├─ listFilesTool ─────────────────────────────────────┤
    │  - Resolve directory path                            │
    │  - Read directory contents                           │
    │  - Apply filters                                     │
    │  - Return { success: true, files: [...] }            │
    │                                                       │
    ├─ searchFilesTool ───────────────────────────────────┤
    │  - Parse search regex                                │
    │  - Search in specified paths                         │
    │  - Collect matches                                   │
    │  - Return { success: true, matches: [...] }          │
    │                                                       │
    ├─ useMcpToolTool ────────────────────────────────────┤
    │  - Connect to MCP server                             │
    │  - Call MCP tool                                     │
    │  - Transform result                                  │
    │  - Return { success: true, result: ... }             │
    │                                                       │
    └─ browserAction* ────────────────────────────────────┘
       - Initialize browser (if needed)
       - Execute browser automation
       - Capture result/screenshot
       - Return { success: true, result: ... }
    │
    ▼
┌──────────────────────────────────────┐
│  Tool Result                         │
│  {                                   │
│    success: boolean,                 │
│    result?: any,                     │
│    error?: string                    │
│  }                                   │
└──────────────────────────────────────┘
    │
    ▼
[Back to Agentic Loop - Add to conversation history]
```

---

## 6. Complete End-to-End Flow

### From CLI command to task completion

```
USER: kilo start "Add login feature"
    │
    ▼
CLI Entry (index.ts) → CLI Orchestrator (cli.ts)
    │
    ▼
ExtensionHost → IPC Bridge
    │
    ▼
Extension Activation (extension.ts)
    │
    ▼
ClineProvider.initClineWithTask()
    │
    ▼
new Task() → Task.startTask()
    │
    ▼
┌─────────────────────────────────────────┐
│ AGENTIC LOOP                            │
│                                         │
│ Loop 1:                                 │
│   LLM: "I'll list files first"          │
│   Tool: listFilesTool("/workspace")     │
│   Result: [file1.ts, file2.ts, ...]    │
│                                         │
│ Loop 2:                                 │
│   LLM: "Let me read the auth file"     │
│   Tool: readFileTool("auth.ts")         │
│   Result: <file contents>               │
│                                         │
│ Loop 3:                                 │
│   LLM: "I'll create login component"    │
│   Tool: writeToFileTool("login.tsx")    │
│   [USER APPROVAL REQUIRED]              │
│   Result: File written                  │
│                                         │
│ Loop 4:                                 │
│   LLM: "Install auth library"           │
│   Tool: executeCommandTool("npm i auth")│
│   [USER APPROVAL REQUIRED]              │
│   Result: Command executed              │
│                                         │
│ Loop 5:                                 │
│   LLM: "Login feature complete"         │
│   No tools                              │
│   STOP REASON: end_turn                 │
│                                         │
└─────────────────────────────────────────┘
    │
    ▼
Task Complete → Save to History → Update UI
```

---

## 7. Message Flow Diagram

### How messages flow between components

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│   Webview    │◄───────►│  Extension   │◄───────►│    CLI       │
│   (React UI) │  msgs   │  (Backend)   │   IPC   │  (Terminal)  │
└──────────────┘         └──────────────┘         └──────────────┘
       │                        │                        │
       │ User Input             │                        │
       ├───────────────────────►│                        │
       │                        │                        │
       │                        │ Create Task            │
       │                        ├───────────────────────►│
       │                        │                        │
       │                        │◄───────────────────────┤
       │                        │ Task Started           │
       │                        │                        │
       │◄───────────────────────┤                        │
       │ Progress Update        │                        │
       │                        │                        │
       │◄───────────────────────┤                        │
       │ Tool Execution         │                        │
       │                        │                        │
       │ Approval Request       │                        │
       │◄───────────────────────┤                        │
       │                        │                        │
       │ Approval Response      │                        │
       ├───────────────────────►│                        │
       │                        │                        │
       │◄───────────────────────┤                        │
       │ Task Complete          │                        │
```

---

## 8. State Management Flow

### How state is maintained across components

```
┌─────────────────────────────────────────────────────────────┐
│                      STATE MANAGEMENT                        │
└─────────────────────────────────────────────────────────────┘

CLI State (Jotai Store)
├─ identity: { userId, userName }
├─ workspace: { path, config }
├─ history: HistoryItem[]
└─ activeTask: Task | null

Extension State (ClineProvider)
├─ currentTask: Task | null
├─ conversationHistory: Message[]
├─ apiConfiguration: ApiConfig
├─ mcpHub: McpHub
└─ telemetry: TelemetryService

Task State (Task instance)
├─ conversationHistory: Message[]
├─ currentToolResults: ToolResult[]
├─ tokenUsage: { input: number, output: number }
├─ state: "idle" | "running" | "waiting_approval" | "complete"
└─ approval: { pending: boolean, request: string }

Persistence
├─ History → ~/.kilo/history/
├─ Configuration → ~/.kilo/config.json
└─ Logs → ~/.kilo/logs/
```

---

## Summary: Key Injection Points in Flow

1. **CLI Entry** (`cli/src/index.ts`) - Input validation, configuration loading
2. **CLI Identity** (`cli/src/services/identity.ts`) - User/agent identity injection
3. **Extension Message Handler** (`src/core/webview/ClineProvider.ts`) - Message interception
4. **Task Creation** (`ClineProvider.initClineWithTask()`) - Task wrapper
5. **Agentic Loop** (`Task.recursivelyMakeClineRequests()`) - **PRIMARY INJECTION**
6. **API Calls** (`src/api/index.ts`) - Request/response middleware
7. **Tool Execution** (`Task.executeTool()`) - Tool-specific middleware
8. **Approval Check** (`Task.ask()`) - Supervision injection

---

**Next**: See `SOCIETY_AGENT_INJECTION_POINTS.md` for detailed code examples
