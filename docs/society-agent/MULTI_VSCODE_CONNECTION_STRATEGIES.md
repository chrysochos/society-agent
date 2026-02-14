# Multi-VS Code Connection Strategies & Design Decisions

**Date**: February 10, 2026  
**Status**: Design Discussion  
**Goal**: Production-ready multi-VS Code architecture with easy connection and rich communication

---

## Overview

Key decisions to make:

1. **Connection Ease**: How does each VS Code join the agent network automatically?
2. **Communication Protocol**: File-based or network for many-to-many?
3. **Attachment Support**: How to send images/files between agents?

---

## 1. Connection Strategies: Making It Easy

### Problem Statement

**User workflow**:

```
User opens VS Code on /project/backend
  → How does it know it's part of an agent team?
  → How does it discover other agents?
  → How does it get its identity?
```

### Strategy A: Workspace Detection (Automatic)

**Concept**: VS Code detects it's in an agent-enabled project by finding `.society-agent/` directory

```typescript
// In extension.ts activation
async function activate(context: vscode.ExtensionContext) {
	// 1. Look for .society-agent/ in workspace or parent directories
	const sharedDir = await findSocietyAgentDir()

	if (sharedDir) {
		// 2. Found it! Read project config
		const projectConfig = await readProjectConfig(sharedDir)

		// 3. Auto-detect role based on workspace path
		const role = detectRoleFromPath(workspace, projectConfig)

		// 4. Auto-generate or reuse agentId
		const agentId = await getOrCreateAgentId(sharedDir, role)

		// 5. Join the network
		await initializeAgentRegistry(sharedDir, agentId, role)

		vscode.window.showInformationMessage(`Connected as ${role} (${agentId})`)
	}
}
```

**Finding .society-agent/ directory**:

```typescript
async function findSocietyAgentDir(): Promise<string | null> {
	const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
	if (!workspace) return null

	// Check current directory
	let current = workspace
	const maxLevels = 5

	for (let i = 0; i < maxLevels; i++) {
		const candidatePath = path.join(current, ".society-agent")
		if (await fs.exists(candidatePath)) {
			return candidatePath
		}

		// Go up one level
		const parent = path.dirname(current)
		if (parent === current) break // Reached root
		current = parent
	}

	return null
}
```

**Auto-detecting role from path**:

```typescript
// .society-agent/project.json
{
  "workspaces": {
    "/project": "supervisor",
    "/project/backend": "backend-developer",
    "/project/frontend": "frontend-developer",
    "/project/tests": "tester"
  }
}

function detectRoleFromPath(workspace: string, config: ProjectConfig): string {
  // Exact match
  if (config.workspaces[workspace]) {
    return config.workspaces[workspace]
  }

  // Fuzzy match (contains 'backend' → backend-developer)
  if (workspace.includes('backend')) return 'backend-developer'
  if (workspace.includes('frontend')) return 'frontend-developer'
  if (workspace.includes('test')) return 'tester'

  // Default
  return 'custom'
}
```

**Pros**:
✅ Zero configuration for users (automatic detection)  
✅ Just open VS Code, it connects  
✅ Role auto-detected from path  
✅ Works with monorepo structure

**Cons**:
❌ Less explicit control  
❌ May detect wrong role  
❌ Magic behavior (harder to debug)

---

### Strategy B: First-Run Wizard (Semi-Automatic)

**Concept**: When `.society-agent/` detected but agent not configured, show wizard

```typescript
if (sharedDirFound && !agentConfigured) {
	const choice = await vscode.window.showInformationMessage(
		"Society Agent project detected. Connect this VS Code?",
		"Connect as Supervisor",
		"Connect as Backend Worker",
		"Connect as Frontend Worker",
		"Not Now",
	)

	if (choice && choice !== "Not Now") {
		const role = parseRole(choice)
		await configureAgent(role, sharedDir)
		vscode.window.showInformationMessage(`Connected as ${role}!`)
	}
}
```

**Pros**:
✅ User confirms intent  
✅ Explicit role selection  
✅ One-time setup per workspace  
✅ Clear feedback

**Cons**:
❌ Extra click required  
❌ Interrupts workflow

---

### Strategy C: Command Palette (Manual)

**Concept**: User runs command to join agent network

```
Cmd+Shift+P → "Society Agent: Connect to Project"
  → Select shared directory
  → Select role
  → Enter agent ID (or auto-generate)
  → Connected!
```

**Pros**:
✅ Full user control  
✅ Explicit and debuggable  
✅ No surprises

**Cons**:
❌ Most manual  
❌ Easy to forget  
❌ Not beginner-friendly

---

### Strategy D: Launcher Script + Settings (Hybrid) ⭐ RECOMMENDED

**Concept**: Setup script creates everything, user just opens VS Code

```bash
# Run once per project
pnpm setup:multi-vscode /project

# This creates:
# - .society-agent/ directory
# - .vscode/settings.json in each workspace with:
#   - agentId
#   - role
#   - sharedDir
# - launch-all.sh script
```

**Then user just**:

```bash
.society-agent/launch-scripts/launch-all.sh
# OR
code /project/backend  # Opens with settings.json already configured
```

**Extension reads settings.json and auto-connects**:

```typescript
const config = vscode.workspace.getConfiguration("kilo-code")
const sharedDir = config.get<string>("societyAgent.sharedDir")

if (sharedDir) {
	// All info in settings.json - just connect!
	await initializeAgentRegistry(sharedDir, agentId, role)
}
```

**Pros**:
✅ Best of both: one-time setup, then automatic  
✅ Settings explicit and visible  
✅ Easy to modify (edit settings.json)  
✅ Works with existing VS Code features  
✅ Git-friendly (commit .vscode/settings.json)

**Cons**:
❌ Requires setup script run once

**Verdict**: ⭐ **Use this approach** - It's what we already implemented!

---

## 2. Communication Protocol: File vs Network

### The Many-to-Many Problem

In multi-agent systems:

- Supervisor ↔ All Workers (1-to-N)
- Worker ↔ Worker (N-to-N)
- Broadcast to All (1-to-All)

**Example scenario**:

```
Frontend needs Backend's API types
Backend needs Frontend's component structure
Tester needs both
DevOps needs all three
Supervisor monitors all
```

### File-Based Communication (Current Implementation)

**How it works**:

```
Agent A: sendMessage() → Append to messages.jsonl
    ↓
File system (shared directory)
    ↓
Agent B: File watcher detects change → Read new lines → Process
Agent C: File watcher detects change → Read new lines → Process
Agent D: File watcher detects change → Read new lines → Process
```

**Pros**:
✅ Simple (no network setup)  
✅ Debuggable (can read .jsonl files)  
✅ Persistent (survives crashes)  
✅ Works on same machine  
✅ No ports or firewalls  
✅ Atomic writes (OS guarantees)

**Cons**:
❌ File system overhead (many watchers)  
❌ Latency (~50-200ms vs <10ms network)  
❌ Doesn't work across machines  
❌ File locking complexity for high concurrency  
❌ Many-to-many = many file watches

**Performance at scale**:

```
5 agents watching messages.jsonl:
- 5 file system watchers
- Each change triggers 5 read operations
- 100 messages/min = 500 reads/min
- Still manageable ✓

20 agents watching messages.jsonl:
- 20 file system watchers
- Each change triggers 20 read operations
- 100 messages/min = 2000 reads/min
- Getting heavy ⚠️
```

---

### Network-Based Communication

**How it works**:

```
Each VS Code runs HTTP server on localhost:
- Supervisor: :3001
- Backend:    :3002
- Frontend:   :3003
- Tester:     :3004

Agent A: sendMessage() → HTTP POST to localhost:3002/api/message
    ↓
Direct TCP connection
    ↓
Agent B: Receives POST → Process immediately
```

**Architecture**:

```typescript
interface AgentServer {
  port: number

  // REST API
  POST /api/message       // Receive message
  POST /api/task          // Receive task assignment
  GET  /api/status        // Health check
  GET  /api/agents        // List known agents

  // WebSocket (optional)
  WS   /ws                // Real-time bidirectional
}
```

**Agent Discovery**:

```typescript
// .society-agent/registry.jsonl
{"agentId":"supervisor-001","role":"supervisor","url":"http://localhost:3001","ws":"ws://localhost:3001/ws"}
{"agentId":"backend-001","role":"backend-developer","url":"http://localhost:3002","ws":"ws://localhost:3002/ws"}
{"agentId":"frontend-001","role":"frontend-developer","url":"http://localhost:3003","ws":"ws://localhost:3003/ws"}

// Send message
const agent = findAgent("backend-001")
await fetch(`${agent.url}/api/message`, {
  method: 'POST',
  body: JSON.stringify(message)
})
```

**Pros**:
✅ Fast (<10ms latency)  
✅ Real-time (WebSocket)  
✅ Scales to many agents  
✅ Works across machines (future)  
✅ Standard protocols  
✅ Better for many-to-many

**Cons**:
❌ More complex setup  
❌ Port management  
❌ Network failures to handle  
❌ Requires server in each VS Code  
❌ Firewall issues (if remote)

---

### Hybrid Approach: File + Network ⭐ RECOMMENDED

**Concept**: Use file for discovery, network for communication

```
1. Agent Registration & Discovery:
   ├─ Use file-based (.society-agent/registry.jsonl)
   ├─ Persistent, survives restarts
   └─ Simple, debuggable

2. Real-Time Communication:
   ├─ Use HTTP/WebSocket
   ├─ Fast, low latency
   └─ Scales to many agents

3. Message Persistence (Optional):
   ├─ Also log to messages.jsonl
   ├─ For audit trail
   └─ For offline agents (fallback)
```

**Implementation**:

```typescript
class AgentCommunication {
	private fileRegistry: FileRegistry // Registry in .jsonl
	private networkClient: NetworkClient // HTTP/WS client

	async sendMessage(to: string, content: any) {
		// 1. Look up agent
		const agent = await this.fileRegistry.findAgent(to)

		// 2. Try network first (fast path)
		if (agent.url) {
			try {
				await this.networkClient.send(agent.url, content)
				return
			} catch (error) {
				// Network failed, fall through to file
			}
		}

		// 3. Fallback to file (slow path, but reliable)
		await this.fileRegistry.appendMessage(to, content)
	}
}
```

**When to use each**:

```
File-based:
- Agent registration
- Agent discovery
- Offline message queue
- Audit trail

Network-based:
- Real-time messages
- Task assignment
- Status updates
- File transfers (images!)
```

**Pros**:
✅ Best of both worlds  
✅ Fast when online  
✅ Reliable when offline  
✅ Simple discovery  
✅ Scales well

**Cons**:
❌ More implementation complexity  
❌ Two code paths to maintain

---

## 3. Attachment Support: Images & Files

### Problem Statement

Agent needs to send:

- 📷 Screenshot of UI bug
- 📄 Generated code file
- 📊 Performance report chart
- 🎨 Design mockup

Current implementation: Only text in messages.jsonl

### Approach A: Base64 Encoding (File-Based)

**Concept**: Encode image/file as base64 string in message

```typescript
interface MessageWithAttachment {
	id: string
	from: string
	to: string
	content: string
	attachments?: Array<{
		filename: string
		mimeType: string
		data: string // base64 encoded
	}>
}
```

**Example**:

```jsonl
{
	"id": "msg-001",
	"from": "frontend-001",
	"to": "supervisor",
	"content": "UI bug screenshot",
	"attachments": [
		{
			"filename": "bug.png",
			"mimeType": "image/png",
			"data": "iVBORw0KGgoAAAANSUhEUgAA..."
		}
	]
}
```

**Pros**:
✅ Works with file-based system  
✅ Self-contained messages  
✅ Easy to implement

**Cons**:
❌ Large messages (base64 = 33% larger)  
❌ Slow to read/parse  
❌ File system churn  
❌ Not practical for videos or large files

**Limit**: Use only for small images (<1MB)

---

### Approach B: File References (File-Based)

**Concept**: Store files separately, reference in message

```typescript
interface MessageWithAttachment {
	id: string
	from: string
	to: string
	content: string
	attachments?: Array<{
		filename: string
		mimeType: string
		path: string // Path to file in .society-agent/attachments/
	}>
}
```

**Structure**:

```
.society-agent/
  messages.jsonl
  attachments/
    msg-001-bug.png
    msg-002-report.pdf
    msg-003-mockup.png
```

**Example**:

```jsonl
{
	"id": "msg-001",
	"from": "frontend-001",
	"to": "supervisor",
	"content": "UI bug screenshot",
	"attachments": [
		{
			"filename": "bug.png",
			"mimeType": "image/png",
			"path": ".society-agent/attachments/msg-001-bug.png"
		}
	]
}
```

**Agent receives message**:

```typescript
async handleMessage(message: Message) {
  console.log(`Message: ${message.content}`)

  for (const attachment of message.attachments) {
    // Read file from shared directory
    const filePath = path.join(sharedDir, attachment.path)
    const fileData = await fs.readFile(filePath)

    // Process attachment (display image, etc.)
    await displayAttachment(attachment.filename, fileData)
  }
}
```

**Pros**:
✅ Efficient (no base64 overhead)  
✅ Fast message parsing  
✅ Supports large files  
✅ Works with file-based system

**Cons**:
❌ Two-step process (message + file)  
❌ Need cleanup (orphaned files)  
❌ File references can break

**Verdict**: ⭐ **Use this for file-based communication**

---

### Approach C: HTTP Multipart (Network-Based) ⭐ BEST

**Concept**: Use HTTP multipart/form-data for file uploads

```typescript
// Send message with attachments
async sendMessageWithAttachments(
  to: string,
  content: string,
  files: File[]
) {
  const formData = new FormData()
  formData.append('from', this.agentId)
  formData.append('content', content)

  for (const file of files) {
    formData.append('attachments', file)
  }

  const agent = await this.findAgent(to)
  await fetch(`${agent.url}/api/message`, {
    method: 'POST',
    body: formData
  })
}
```

**Server endpoint**:

```typescript
app.post("/api/message", async (req, res) => {
	const { from, content } = req.body
	const files = req.files // Multer or similar

	// Save attachments temporarily
	const attachments = []
	for (const file of files) {
		const savedPath = await saveFile(file)
		attachments.push({
			filename: file.originalname,
			mimeType: file.mimetype,
			path: savedPath,
		})
	}

	// Process message
	await handleMessage({
		from,
		to: this.agentId,
		content,
		attachments,
	})

	res.json({ status: "ok" })
})
```

**Pros**:
✅ Standard HTTP multipart protocol  
✅ Efficient (streaming)  
✅ Supports any file size  
✅ Built-in by HTTP servers  
✅ Can show upload progress

**Cons**:
❌ Requires network communication

**Verdict**: ⭐ **Use this for network-based communication**

---

### Approach D: Hybrid with KiloCode Attachments

**Concept**: Leverage KiloCode's existing attachment support

KiloCode already supports:

- Images in prompt (paste screenshot)
- Files attached to messages
- Context attachments

**Extend to inter-agent**:

```typescript
// User attaches image to prompt in Backend VS Code
// Backend agent sends to Supervisor with attachment

interface AgentMessage extends KiloCodeMessage {
	// KiloCode message already has:
	// - text content
	// - images (base64 or URLs)
	// - attachments (file references)

	// Add agent routing:
	routing: {
		from: string // agentId
		to: string // agentId or "broadcast"
	}
}

// Just forward KiloCode message format between agents!
```

**Pros**:
✅ Reuse existing infrastructure  
✅ User experience consistent  
✅ Already tested and working  
✅ Supports all KiloCode features

**Cons**:
❌ Tied to KiloCode message format  
❌ May be heavier than needed

**Verdict**: ⭐ **Best for KiloCode integration**

---

## 4. Recommended Architecture

### Overall Design: Hybrid Communication

```
┌─────────────────────────────────────────────────┐
│  Discovery & Registration: File-Based           │
│  .society-agent/registry.jsonl                  │
│  - Simple, persistent, debuggable               │
└─────────────────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
┌───────▼──────────┐  ┌─────────▼──────────┐
│  Real-Time Comms │  │  Offline Queue     │
│  HTTP/WebSocket  │  │  messages.jsonl    │
│  - Fast          │  │  - Reliable        │
│  - Many-to-many  │  │  - Audit trail     │
└──────────────────┘  └────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
┌───────▼──────────┐  ┌─────────▼──────────┐
│  Attachments     │  │  Large Files       │
│  HTTP Multipart  │  │  File refs         │
│  - Images        │  │  - Videos          │
│  - Small files   │  │  - Archives        │
└──────────────────┘  └────────────────────┘
```

### Implementation Phases

**Phase 1: File-Based Foundation (DONE ✓)**

- Agent registration
- File-based messaging
- Heartbeat
- Offline catch-up
- File references for attachments

**Phase 2: Network Layer (NEXT)**

- HTTP server in each VS Code
- WebSocket for real-time
- Fallback to file-based
- Port management

**Phase 3: Attachment Support**

- HTTP multipart for images
- File references for large files
- Integration with KiloCode attachments

**Phase 4: Production Polish**

- Error handling
- Reconnection logic
- Performance optimization
- Monitoring dashboard

---

## 5. Connection Ease: Practical Workflow

### User Experience Goal

```bash
# Developer starts work on a project
cd ~/projects/my-app

# First time: Setup (30 seconds)
pnpm setup:multi-vscode

# Every day after: Just open VS Code (5 seconds)
code .
# Extension: "Connected as backend-developer (backend-abc123)" ✓

# Or launch all at once
.society-agent/launch-scripts/launch-all.sh
```

### What Happens Behind the Scenes

```typescript
// extension.ts activate()

// 1. Check if workspace has .society-agent/
const sharedDir = await findNearestSocietyAgent()

if (!sharedDir) {
	// Not an agent project, normal operation
	return
}

// 2. Read settings.json
const config = vscode.workspace.getConfiguration("kilo-code")
const agentId = config.get("societyAgent.agentId")
const role = config.get("societyAgent.role")

if (!agentId || !role) {
	// Settings missing - show wizard
	await showConnectionWizard(sharedDir)
	return
}

// 3. Initialize network server (if enabled)
const useNetwork = config.get("societyAgent.useNetwork") ?? true
if (useNetwork) {
	const port = await findAvailablePort(3000, 4000)
	await startAgentServer(port)
}

// 4. Register agent
await agentRegistry.initialize(sharedDir, {
	agentId,
	role,
	url: useNetwork ? `http://localhost:${port}` : undefined,
})

// 5. Catch up on missed messages
await agentRegistry.catchUp()

// 6. Show notification
vscode.window.showInformationMessage(`Society Agent: Connected as ${role} 🤖`)
```

### Auto-Connection Features

✅ **Auto-detect project**: Find `.society-agent/` in current or parent dirs  
✅ **Read settings**: Get agentId, role from `.vscode/settings.json`  
✅ **Auto-generate ID**: If missing, create unique ID  
✅ **Port auto-select**: Find available port automatically  
✅ **Catch up**: Process missed messages on start  
✅ **Status notification**: Show "Connected as X" message

### Fallback Handling

```typescript
// If settings missing
if (!agentId) {
	const choice = await vscode.window.showInformationMessage(
		"Connect to Society Agent project?",
		"Yes, connect",
		"Not now",
	)

	if (choice === "Yes, connect") {
		const role = await vscode.window.showQuickPick([
			"supervisor",
			"backend-developer",
			"frontend-developer",
			"tester",
			"devops",
		])

		const agentId = `${role}-${randomId()}`

		await config.update("societyAgent.agentId", agentId)
		await config.update("societyAgent.role", role)
		await config.update("societyAgent.sharedDir", sharedDir)

		// Now initialize
		await initializeAgent()
	}
}
```

---

## 6. Summary of Recommendations

### Connection Strategy

⭐ **Use**: Launcher Script + Settings (Hybrid)

- Setup once: `pnpm setup:multi-vscode`
- Then just open VS Code: settings.json auto-configures
- Easy, explicit, Git-friendly

### Communication Protocol

⭐ **Use**: Hybrid (File for discovery, Network for messages)

- File-based: Registration, discovery, offline queue
- Network-based: Real-time messages, attachments
- Fallback: Network fails → file-based

### Attachment Support

⭐ **Use**: Approach D (KiloCode native) + HTTP multipart

- Small images: KiloCode attachment format
- Large files: HTTP multipart upload
- File references: For offline/file-based fallback

### Agent Persistence

✅ **Confirmed**: Persistent per project

- Agents live for project lifetime
- Build expertise over time
- Settings stored in `.vscode/settings.json`

---

## 7. Next Implementation Steps

### Week 4: Network Communication Layer

1. **Add HTTP server to each VS Code**

    ```typescript
    // src/services/society-agent/agent-server.ts
    class AgentServer {
    	async start(port: number) {
    		const app = express()
    		app.post("/api/message", handleMessage)
    		app.post("/api/task", handleTask)
    		app.get("/api/status", handleStatus)
    		app.listen(port)
    	}
    }
    ```

2. **Update AgentRegistry to use network**

    ```typescript
    async sendMessage(to: string, content: any) {
      const agent = await this.findAgent(to)

      if (agent.url) {
        // Network fast path
        await fetch(`${agent.url}/api/message`, {...})
      } else {
        // File fallback
        await this.fileRegistry.appendMessage(to, content)
      }
    }
    ```

3. **Port management**
    - Auto-find available port
    - Store in registry
    - Handle conflicts

### Week 5: Attachment Support

1. **HTTP multipart upload**
2. **File reference storage**
3. **KiloCode message format integration**

### Week 6: Testing & Polish

1. **Test with 5+ agents**
2. **Performance benchmarks**
3. **Error handling**
4. **Documentation**

---

## Questions for Discussion

1. **Network on localhost**: Should we use network even on same machine?

    - 👍 Pro: Faster, scales better, supports attachments
    - 👎 Con: More complex, ports to manage
    - **Verdict**: YES for many-to-many

2. **Attachment size limit**: What's the max file size?

    - Small: <1MB (inline in message)
    - Medium: 1-10MB (HTTP multipart)
    - Large: >10MB (file reference or S3/cloud)
    - **Suggest**: 10MB limit, reject larger

3. **Message persistence**: Keep all messages or cleanup?

    - Keep: Full audit trail, can replay
    - Cleanup: Save disk space, faster reads
    - **Suggest**: Keep last 1000 messages, archive older

4. **Authentication**: Should agents authenticate each other?
    - Currently: Trust-based (same machine, shared dir)
    - Future: Token-based (for remote agents)
    - **Suggest**: Not needed for same-machine, add later for remote

---

**Status**: Ready for implementation feedback and approval to proceed! 🚀
