# Society Agent Integration Plan

## Current Architecture Understanding

**KiloCode (existing)** = Single agent mode (works perfectly)

- User chats with one AI agent in VS Code
- Agent has access to all VS Code features (file explorer, editor, terminal)
- Executes tasks, creates files, runs commands in workspace

**Society Agent (new)** = Multi-agent addon

- KiloCode agent becomes **Supervisor**
- Supervisor spawns **Worker agents** for complex tasks
- Workers are specialized (Backend, Tester, DevOps, etc.)
- All work happens in VS Code workspace

## Integration Points

### 1. Multi-Agent Detection (Task.ts)

**Location**: `src/core/task/Task.ts` - `recursivelyMakeClineRequests()` method

**Implementation**:

```typescript
// Add properties to Task class
private societyManager?: SocietyManager
public agentMetadata?: AgentMetadata // For worker agents

// Add method to detect complexity
private async shouldUseSocietyAgent(userContent): Promise<boolean> {
  // Worker agents never spawn more agents
  if (this.agentMetadata) return false

  // Check for explicit triggers
  const taskText = extractText(userContent).toLowerCase()
  const triggers = ["use multiple agents", "spawn agents", etc.]
  if (triggers.some(t => taskText.includes(t))) return true

  // Future: Add AI complexity analysis
  return false
}

// At start of recursivelyMakeClineRequests
if (!this.agentMetadata && await this.shouldUseSocietyAgent(userContent)) {
  // Initialize SocietyManager
  // Delegate to multi-agent system
  // Forward messages to webview
  // Return result
}
```

### 2. Monitoring Dashboard (webview-ui)

**Location**: `webview-ui/src/components/society-agent/Dashboard.tsx`

**Current**: Separate standalone dashboard  
**Needed**: Chat-style interface showing agent messages

**Implementation**:

```tsx
<Dashboard>
	{/* Agent filter tabs */}
	<AgentTabs>
		<Tab>All</Tab>
		<Tab>Supervisor</Tab>
		<Tab>Backend</Tab>
		<Tab>Tester</Tab>
	</AgentTabs>

	{/* Message stream */}
	<MessageStream>
		<Message from="supervisor" to="backend">
			Create authentication module in core/auth.ts
		</Message>
		<Message from="backend" to="supervisor">
			Should I use JWT or sessions?
		</Message>
		<Message from="supervisor" to="backend">
			Use JWT tokens
		</Message>
	</MessageStream>

	{/* VS Code terminal remains visible in VS Code */}
</Dashboard>
```

### 3. Message Forwarding (ClineProvider.ts)

**Location**: `src/core/webview/ClineProvider.ts`

**Implementation**:

```typescript
// In Task.ts - when initializing SocietyManager
new SocietyManager({
	apiHandler: this.api,
	workspacePath: this.cwd,
	onMessage: (purposeId, agentId, message) => {
		provider.postMessageToWebview({
			type: "society-agent-message",
			purposeId,
			agentId,
			message,
			timestamp: Date.now(),
		})
	},
	onStatusChange: (purposeId, agentId, status, task) => {
		provider.postMessageToWebview({
			type: "society-agent-status",
			purposeId,
			agentId,
			status,
			task,
			timestamp: Date.now(),
		})
	},
})

// In Dashboard.tsx - handle messages
useEffect(() => {
	const handleMessage = (event) => {
		if (event.data.type === "society-agent-message") {
			// Add to message stream
		}
		if (event.data.type === "society-agent-status") {
			// Update agent status
		}
	}
	window.addEventListener("message", handleMessage)
	return () => window.removeEventListener("message", handleMessage)
}, [])
```

### 4. Workspace Integration

**Key insight**: VS Code already provides:

- ✅ Working directory (workspace root)
- ✅ File explorer (shows all created files)
- ✅ Code editor (open any file)
- ✅ Integrated terminal (run commands)

**Society Agent needs**:

- Use `vscode.workspace.workspaceFolders[0].uri.fsPath` as base directory
- Single agent: Works in workspace root
- Multi-agent: Each worker gets subfolder (core/, tests/, docs/)
- Files appear in VS Code file explorer automatically

## Implementation Steps

### Phase 1: Basic Integration ✅

1. Add SocietyManager import to Task.ts ✅
2. Add properties (societyManager, agentMetadata) ✅
3. Add shouldUseSocietyAgent() method
4. Add integration logic at start of recursivelyMakeClineRequests

### Phase 2: Message Forwarding

1. Update SocietyManager constructor to accept callbacks
2. Wire up onMessage and onStatusChange in Task.ts
3. Forward messages via ClineProvider.postMessageToWebview()

### Phase 3: Monitoring Dashboard

1. Refactor Dashboard.tsx to show message stream
2. Add agent filter tabs
3. Display inter-agent communication
4. Add manual controls (pause, message, complete)

### Phase 4: Testing

1. Test simple task (no multi-agent)
2. Test explicit trigger: "Use multiple agents to build authentication"
3. Verify worker communication visible in dashboard
4. Verify files created in workspace appear in VS Code explorer

## Current Status

- ✅ Society Agent core implemented (supervisor-agent.ts, conversation-agent.ts, etc.)
- ✅ SocietyManager exists and works
- ✅ Dashboard component exists
- ✅ Properties added to Task.ts (societyManager, agentMetadata)
- ⏳ shouldUseSocietyAgent() method (in progress)
- ⏳ Integration logic in recursivelyMakeClineRequests (in progress)
- 📋 Message forwarding (not started)
- 📋 Dashboard refactor (not started)
- 📋 Testing (not started)

## Next Actions

1. Complete Task.ts integration (add shouldUseSocietyAgent and detection logic)
2. Test with: "Use multiple agents to create a calculator with tests"
3. Verify multi-agent system activates
4. Add message forwarding
5. Refactor dashboard to show messages
6. End-to-end test
