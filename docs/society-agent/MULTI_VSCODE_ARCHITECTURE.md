# Multi-VS Code Distributed Agent Architecture

## Overview

Extension of Society Agent to support multiple VS Code instances working as distributed agents with hierarchical coordination.

**Status**: Design Document  
**Created**: February 10, 2026  
**Supersedes**: Single-VS Code multi-agent design

---

## Architectural Models

### Model 1: Single VS Code with Multi-Agent (Current)

```
┌────────────────────────────────────────────┐
│          VS Code Extension                 │
│  ┌──────────────────────────────────────┐  │
│  │  Supervisor Agent (Task instance)    │  │
│  └──────────────────────────────────────┘  │
│  ┌────────┐ ┌────────┐ ┌────────┐        │
│  │Worker 1│ │Worker 2│ │Worker 3│        │
│  │(Task)  │ │(Task)  │ │(Task)  │        │
│  └────────┘ └────────┘ └────────┘        │
│                                            │
│  Shared: .society-agent/ directory         │
└────────────────────────────────────────────┘
```

**Pros:**

- Simpler implementation
- No network complexity
- Easier debugging
- All in one window

**Cons:**

- Resource contention (all agents in one process)
- Limited scalability
- Single point of failure
- Hard to visualize multiple agents

---

### Model 2: Multi-VS Code Distributed (Proposed)

```
┌─────────────────────────────────────────────┐
│  VS Code Instance 1 (Supervisor)            │
│  Workspace: /project/main                   │
│  Role: Coordination, planning, synthesis    │
│  ┌────────────────────────────────────────┐ │
│  │  Supervisor Agent                      │ │
│  │  - Receives human purpose              │ │
│  │  - Creates task breakdown              │ │
│  │  - Assigns to worker VS Codes          │ │
│  │  - Monitors progress                   │ │
│  │  - Synthesizes results                 │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
           │
           │ Communication Layer
           │ (File-based or Network)
           │
    ┌──────┴────────┬─────────────┐
    │               │             │
┌───▼────────┐  ┌───▼────────┐  ┌─▼──────────┐
│ VS Code 2  │  │ VS Code 3  │  │ VS Code 4  │
│ Backend    │  │ Frontend   │  │ Testing    │
│ Worker     │  │ Worker     │  │ Worker     │
└────────────┘  └────────────┘  └────────────┘
```

**Pros:**

- True parallelism (separate processes)
- Visual clarity (see each agent's work)
- Resource isolation
- Scalable (add more VS Codes)
- Natural workspace separation

**Cons:**

- More complex communication
- Requires coordination protocol
- Multiple windows to manage
- Synchronization challenges

---

## Communication Protocols

### Protocol 1: File-Based (Shared Directory)

**Mechanism**: All VS Code instances share `.society-agent/` directory

```
/shared-project/
  .society-agent/
    registry.jsonl          # All agent registrations
    tasks.jsonl             # Shared task list
    messages.jsonl          # Inter-agent messages
    locks/                  # File locks for coordination
      task-claim-001.lock
      file-write-foo.lock
```

**Message Format**:

```jsonl
{"type":"task_assign","from":"supervisor-001","to":"backend-001","task":{"id":"t1","desc":"Implement auth"},"timestamp":"2026-02-10T10:00:00Z"}
{"type":"task_complete","from":"backend-001","to":"supervisor-001","task":"t1","status":"success","timestamp":"2026-02-10T10:15:00Z"}
{"type":"message","from":"backend-001","to":"frontend-001","content":"Auth API ready at /api/auth","timestamp":"2026-02-10T10:16:00Z"}
```

**File Watching**:

```typescript
// Each VS Code instance watches for changes
const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(societyAgentDir, "*.jsonl"))

watcher.onDidChange(async (uri) => {
	if (uri.path.endsWith("messages.jsonl")) {
		const newMessages = await readNewMessages(uri)
		for (const msg of newMessages) {
			if (msg.to === currentAgentId) {
				await handleMessage(msg)
			}
		}
	}
})
```

**Pros:**

- Simple (no network setup)
- Works on local filesystem
- Auditable (can inspect files)
- Survives crashes (persistent state)

**Cons:**

- Requires shared filesystem
- Polling overhead (even with watchers)
- File lock contention
- Not suitable for remote agents

---

### Protocol 2: Network-Based (HTTP/WebSocket)

**Mechanism**: Each VS Code instance runs a local HTTP server

```typescript
// Agent Server in each VS Code
interface AgentServer {
  port: number              // 3001, 3002, 3003...
  agentId: string
  role: string

  // REST API
  POST /api/task            // Receive task assignment
  POST /api/message         // Receive message from another agent
  GET /api/status           // Report current status
  GET /api/results/:taskId  // Return task results
  POST /api/shutdown        // Graceful shutdown

  // WebSocket for real-time updates
  WS /ws                    // Bidirectional communication
}
```

**Discovery Service**:

```typescript
// Registry server (could be in supervisor VS Code)
interface AgentRegistry {
	agents: Map<string, AgentEndpoint>

	register(agent: AgentEndpoint): void
	unregister(agentId: string): void
	getAgent(agentId: string): AgentEndpoint | undefined
	listAgents(role?: string): AgentEndpoint[]
}

interface AgentEndpoint {
	id: string
	role: string
	capabilities: string[]
	url: string // http://localhost:3001
	wsUrl: string // ws://localhost:3001/ws
	status: "idle" | "busy" | "offline"
	lastHeartbeat: Date
}
```

**Communication Example**:

```typescript
// Supervisor assigns task to worker
async function assignTask(workerId: string, task: Task) {
	const worker = registry.getAgent(workerId)
	const response = await fetch(`${worker.url}/api/task`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			from: supervisorId,
			task: task,
			context: {
				projectId: currentProject.id,
				sharedDir: ".society-agent/",
				deadline: task.deadline,
			},
		}),
	})

	return response.json()
}

// Worker reports completion
async function reportCompletion(taskId: string, results: TaskResults) {
	const supervisor = registry.getAgent("supervisor")
	await fetch(`${supervisor.url}/api/message`, {
		method: "POST",
		body: JSON.stringify({
			from: currentAgentId,
			type: "task_complete",
			taskId: taskId,
			results: results,
		}),
	})
}
```

**Pros:**

- Standard protocols (HTTP/WebSocket)
- Real-time bidirectional communication
- Works across machines (distributed)
- Rich error handling
- Easy to monitor (can use curl, Postman)

**Cons:**

- More complex setup
- Need port management
- Firewall/security considerations
- Network failures to handle

---

### Protocol 3: VS Code Extension Host IPC

**Mechanism**: Use VS Code's inter-extension communication (if on same machine)

```typescript
// Extension A (Supervisor)
export function activate(context: vscode.ExtensionContext) {
	return {
		sendMessage: async (to: string, message: any) => {
			// Exposed API
		},
		assignTask: async (task: Task) => {
			// Exposed API
		},
	}
}

// Extension B (Worker)
const supervisorExt = vscode.extensions.getExtension("kilocode.society-supervisor")
if (supervisorExt) {
	const api = await supervisorExt.activate()
	await api.sendMessage("worker-001", { type: "status", status: "ready" })
}
```

**Pros:**

- Native VS Code integration
- No additional infrastructure
- Type-safe APIs
- Fast (in-process or local IPC)

**Cons:**

- Only works on same machine
- Requires separate extensions
- Limited by VS Code extension host
- Harder to scale

---

## Agent Persistence Models

### Model A: Ephemeral (Current)

```typescript
interface PurposeExecution {
	purposeId: string
	agents: Agent[] // Created for this purpose
	lifecycle: {
		created: Date
		started: Date
		completed?: Date
	}
}

// After purpose completion:
// - All agents destroyed
// - History saved to .jsonl
// - Context lost
```

**Use Case**: One-off tasks, independent purposes

---

### Model B: Persistent Agent Pool

```typescript
interface ProjectAgentPool {
	projectId: string
	agents: Map<string, PersistentAgent>

	getAgent(role: string): PersistentAgent
	getIdleAgent(): PersistentAgent | undefined
	assignPurpose(agentId: string, purpose: Purpose): void
}

interface PersistentAgent {
	id: string
	role: string
	created: Date
	purposes: Purpose[] // History of all purposes
	context: AgentContext // Accumulated knowledge
	status: "idle" | "busy" | "paused"
	vsCodeInstance?: string // Which VS Code it lives in
}
```

**Benefits**:

- Agents remember past work
- Build expertise over time
- Faster (no re-initialization)
- Can specialize

**Management**:

```typescript
// Start of project: Create agent pool
await createAgentPool({
	projectId: "auth-redesign",
	agents: [
		{ role: "supervisor", count: 1 },
		{ role: "backend-developer", count: 2 },
		{ role: "frontend-developer", count: 1 },
		{ role: "tester", count: 1 },
	],
})

// Purpose 1: Assign to existing agents
await assignPurpose("Implement OAuth", {
	agents: ["backend-001", "frontend-001"],
})

// Purpose 2: Reuse agents with accumulated context
await assignPurpose("Add 2FA support", {
	agents: ["backend-001"], // Already knows OAuth system
})

// End of project: Save agent knowledge, optionally destroy
await saveAgentKnowledge()
await destroyAgentPool()
```

---

### Model C: Hybrid (Purpose + Project Agents)

```typescript
interface HybridAgentSystem {
	// Persistent agents for project lifetime
	projectAgents: {
		supervisor: PersistentAgent
		coordinator: PersistentAgent
	}

	// Ephemeral agents created per purpose
	purposeAgents: Map<string, EphemeralAgent>
}

// Persistent agents coordinate, ephemeral agents execute
```

---

## Workspace Sharing Strategies

### Strategy 1: Monorepo with Subdirectories

```
/project/
  .git/
  .society-agent/           # Shared coordination layer
    registry.jsonl
    tasks.jsonl
    messages.jsonl
    locks/

  backend/                  # VS Code 2 workspace
    src/
    tests/

  frontend/                 # VS Code 3 workspace
    src/
    components/

  shared/                   # Common code
    types/
    utils/

  docs/                     # Documentation agent workspace
```

**VS Code Workspace Configs**:

```json
// Backend agent: .vscode/settings.json
{
	"kilo-code.societyAgent.role": "backend-developer",
	"kilo-code.societyAgent.workingDirectory": "/project/backend",
	"kilo-code.societyAgent.sharedDir": "/project/.society-agent"
}
```

---

### Strategy 2: Git Worktrees (Parallel Branches)

```bash
# Main workspace (supervisor)
git worktree add ../project-backend feature/auth-backend
git worktree add ../project-frontend feature/auth-frontend
git worktree add ../project-tests feature/auth-tests

# Each worktree is separate directory, same git repo
/project/                   # Main (supervisor)
/project-backend/           # Backend agent workspace
/project-frontend/          # Frontend agent workspace
/project-tests/             # Test agent workspace

# All share .society-agent/ via symlink or network share
```

**Benefits**:

- Clean separation
- Branch-based workflow
- Easy merge back
- Git built-in

---

### Strategy 3: Separate Repos with Shared Volume

```
/workspaces/
  .society-agent/           # Shared coordination (Docker volume or NFS)

  project-main/             # Supervisor
    .git/
    README.md
    architecture/

  project-backend/          # Backend agent
    .git/
    src/

  project-frontend/         # Frontend agent
    .git/
    src/
```

**Use Case**: Microservices, separate repos that need coordination

---

## Implementation Phases

### Phase 1: Enhanced Single-VS Code (Current → Improved)

**Goal**: Improve current multi-agent in single VS Code

**Tasks**:

1. ✅ Add persistent agent pool (agents survive across purposes)
2. ✅ Agent specialization tracking (what each agent has worked on)
3. ✅ File ownership to prevent conflicts
4. ✅ Shared context loading (.claw.md, project docs)

**Timeline**: Week 4 (1 week)

---

### Phase 2: Multi-VS Code Prototype (File-Based)

**Goal**: Prove multi-VS Code coordination with file-based communication

**Tasks**:

1. Create `.society-agent/registry.jsonl` for agent discovery
2. Implement file watcher for messages/tasks
3. Add VS Code setting: `kilo-code.societyAgent.role` (supervisor/worker)
4. Test with 2 VS Code instances: 1 supervisor + 1 worker

**Implementation**:

```typescript
// src/services/society-agent/multi-vscode-coordinator.ts
export class MultiVSCodeCoordinator {
	private agentId: string
	private role: "supervisor" | "worker"
	private sharedDir: string
	private watcher: vscode.FileSystemWatcher

	async initialize() {
		// Register this VS Code instance as an agent
		await this.registerAgent()

		// Start watching for messages
		this.startMessageWatcher()

		// Heartbeat to show we're alive
		this.startHeartbeat()
	}

	private async registerAgent() {
		const registration = {
			agentId: this.agentId,
			role: this.role,
			vsCodePid: process.pid,
			workspace: vscode.workspace.workspaceFolders?.[0].uri.fsPath,
			capabilities: this.getCapabilities(),
			timestamp: new Date().toISOString(),
		}

		await appendToJSONL(`${this.sharedDir}/registry.jsonl`, registration)
	}

	private startMessageWatcher() {
		this.watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(this.sharedDir, "messages.jsonl"),
		)

		this.watcher.onDidChange(async (uri) => {
			const messages = await this.readNewMessages(uri)
			for (const msg of messages) {
				if (msg.to === this.agentId) {
					await this.handleMessage(msg)
				}
			}
		})
	}

	async sendMessage(to: string, content: any) {
		const message = {
			from: this.agentId,
			to: to,
			content: content,
			timestamp: new Date().toISOString(),
		}

		await appendToJSONL(`${this.sharedDir}/messages.jsonl`, message)
	}
}
```

**Timeline**: Week 5 (1 week)

---

### Phase 3: Network-Based Communication

**Goal**: Replace file-based with HTTP/WebSocket for real-time communication

**Tasks**:

1. Implement HTTP server in each VS Code instance
2. Agent discovery service (registry server)
3. WebSocket for real-time updates
4. Fallback to file-based if network unavailable

**Timeline**: Week 6-7 (2 weeks)

---

### Phase 4: Visual Coordination UI

**Goal**: Dashboard showing all VS Code instances and their agents

**Tasks**:

1. Web dashboard showing all active agents across VS Codes
2. Click agent to switch focus to that VS Code
3. Visual task flow showing which agent is working on what
4. Real-time log aggregation

**Timeline**: Week 8 (1 week)

---

## Configuration

### Per-VS Code Settings

```json
// VS Code Instance 1 (Supervisor)
{
  "kilo-code.societyAgent.role": "supervisor",
  "kilo-code.societyAgent.agentId": "supervisor-001",
  "kilo-code.societyAgent.sharedDir": "/project/.society-agent",
  "kilo-code.societyAgent.serverPort": 3001
}

// VS Code Instance 2 (Backend Worker)
{
  "kilo-code.societyAgent.role": "backend-developer",
  "kilo-code.societyAgent.agentId": "backend-001",
  "kilo-code.societyAgent.sharedDir": "/project/.society-agent",
  "kilo-code.societyAgent.serverPort": 3002,
  "kilo-code.societyAgent.supervisorUrl": "http://localhost:3001"
}
```

### Project-Level Configuration

```json
// .society-agent/project.json
{
	"projectId": "auth-system-redesign",
	"created": "2026-02-10T10:00:00Z",
	"team": {
		"supervisor": {
			"agentId": "supervisor-001",
			"vsCodeInstance": "main",
			"workspace": "/project",
			"port": 3001
		},
		"workers": [
			{
				"agentId": "backend-001",
				"role": "backend-developer",
				"vsCodeInstance": "worker-1",
				"workspace": "/project/backend",
				"port": 3002
			},
			{
				"agentId": "frontend-001",
				"role": "frontend-developer",
				"vsCodeInstance": "worker-2",
				"workspace": "/project/frontend",
				"port": 3003
			}
		]
	},
	"communication": {
		"protocol": "file-based", // or "network"
		"fallback": "file-based"
	}
}
```

---

## Decision Matrix

| Aspect                  | Single-VS Code          | Multi-VS Code File        | Multi-VS Code Network     |
| ----------------------- | ----------------------- | ------------------------- | ------------------------- |
| **Setup Complexity**    | Low                     | Medium                    | High                      |
| **Scalability**         | Limited (one process)   | Medium (shared FS)        | High (distributed)        |
| **Visual Clarity**      | Low (all in one window) | High (separate windows)   | High                      |
| **Resource Isolation**  | None                    | Full (separate processes) | Full                      |
| **Communication Speed** | Instant (in-memory)     | Fast (file watch)         | Fast (WebSocket)          |
| **Debugging**           | Easy                    | Medium                    | Complex                   |
| **Failure Isolation**   | None                    | Full                      | Full                      |
| **Remote Workers**      | No                      | No (requires shared FS)   | Yes                       |
| **Cost**                | Lower (shared context)  | Medium                    | Higher (network overhead) |

---

## Recommended Approach

### Phase 1: Enhance Current (Week 4)

- Persistent agent pool in single VS Code
- File ownership tracking
- Shared context loading

**Then evaluate user feedback before committing to multi-VS Code**

### Phase 2: Multi-VS Code Prototype (Week 5)

- File-based communication
- Simple: 1 supervisor + 1-2 workers
- Prove the concept

### Phase 3: Decision Point

Based on Phase 2 results:

- If valuable → Continue to network-based (Phases 3-4)
- If not → Stay with enhanced single-VS Code

---

## Open Questions

1. **Window Management**: How does user manage multiple VS Code windows?

    - Manual (user opens each)
    - Automatic (extension opens new windows)
    - External tool (CLI script)

2. **Agent Identity**: How is agentId assigned?

    - User configures manually
    - Auto-generated on first launch
    - Derived from workspace path

3. **Workspace Sharing**: Which strategy?

    - Monorepo subdirectories (simpler)
    - Git worktrees (Git-native)
    - Separate repos (microservices)

4. **Communication Protocol**: Start with which?

    - File-based (simpler, test first)
    - Network-based (more scalable, do later)
    - Both with fallback (most robust)

5. **Agent Persistence**: Which model?
    - Ephemeral per purpose (current)
    - Persistent per project (proposed)
    - Hybrid (some persistent, some ephemeral)

---

## Next Steps

1. **Discuss with stakeholders**: Which phases to implement?
2. **User testing**: Would users manage multiple VS Codes?
3. **Performance testing**: File-watch latency acceptable?
4. **Security review**: Network protocol security implications?

---

## References

- [Anthropic Agent Teams](https://code.claude.com/docs/en/agent-teams)
- [Git Worktrees](https://git-scm.com/docs/git-worktree)
- [VS Code Extension API](https://code.visualstudio.com/api)
- Society Agent Documentation (AGENTS.md, other docs)

---

**Document Status**: Design Proposal  
**Next Review**: After Phase 1 completion  
**Maintainer**: KiloCode Team
