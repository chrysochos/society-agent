# Multi-VS Code Architecture: Final Design

**Date**: February 10, 2026  
**Status**: Design Finalized, Ready for Implementation  
**Target**: Production multi-VS Code agent system

---

## Your Requirements

1. ✅ **Skip Phase 1** - Go straight to multi-VS Code
2. ✅ **Easy connection** - User opens VS Code, automatic connection
3. ✅ **Network communication** - Use network even on same machine for better many-to-many
4. ✅ **Persistent agents** - Agents persist per project
5. ✅ **Handle images** - Support image/file attachments in communication

---

## Final Architecture: Hybrid File + Network

### Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    VS Code Instance                         │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  KiloCode Extension                                    │ │
│  │  ┌──────────────┐  ┌─────────────┐  ┌──────────────┐ │ │
│  │  │ AgentRegistry│  │ AgentServer │  │ AgentClient  │ │ │
│  │  │ (Discovery)  │  │ (Receive)   │  │ (Send)       │ │ │
│  │  └──────┬───────┘  └──────┬──────┘  └──────┬───────┘ │ │
│  └─────────┼──────────────────┼──────────────────┼────────┘ │
└────────────┼──────────────────┼──────────────────┼──────────┘
             │                  │                  │
    ┌────────▼────────┐  ┌──────▼──────┐  ┌───────▼────────┐
    │ registry.jsonl  │  │ HTTP :3001  │  │ HTTP Requests  │
    │ (Discovery)     │  │ (Listen)    │  │ (Send to      │
    │                 │  │             │  │  other agents) │
    └─────────────────┘  └─────────────┘  └────────────────┘
```

### Three Communication Layers

**Layer 1: Discovery (File-Based)**

```
.society-agent/registry.jsonl
- Agent registration
- Heartbeat tracking
- URL discovery
- Simple, persistent, debuggable
```

**Layer 2: Real-Time (Network-Based)**

```
HTTP Server (per VS Code)
- POST /api/message       - Text messages
- POST /api/message-multi - With attachments
- POST /api/task          - Task assignment
- GET  /api/status        - Health check
- WS   /ws                - Real-time updates (optional)
```

**Layer 3: Offline Queue (File-Based)**

```
.society-agent/messages.jsonl
- Fallback when network fails
- Audit trail
- Offline delivery
```

---

## 1. Connection: How It Works

### User Experience

```bash
# First time setup (30 seconds)
cd ~/projects/my-app
pnpm setup:multi-vscode

# Creates:
# - .society-agent/ directory
# - .vscode/settings.json in each workspace
# - launch-all.sh script

# Every day after (instant)
code ~/projects/my-app/backend

# Extension automatically:
# ✓ Detects .society-agent/
# ✓ Reads settings.json
# ✓ Starts HTTP server
# ✓ Registers in registry.jsonl
# ✓ Catches up on missed messages
# ✓ Shows "Connected as backend-developer 🤖"
```

### Auto-Connection Logic

```typescript
// extension.ts activate()

export async function activate(context: vscode.ExtensionContext) {
	// ... existing activation code ...

	// 1. Look for .society-agent/ directory
	const sharedDir = await findSocietyAgentDir()
	if (!sharedDir) {
		// Not an agent project
		return
	}

	// 2. Read settings
	const config = vscode.workspace.getConfiguration("kilo-code")
	let agentId = config.get<string>("societyAgent.agentId")
	let role = config.get<string>("societyAgent.role")

	// 3. Auto-configure if missing
	if (!agentId || !role) {
		const result = await showConnectionWizard(sharedDir)
		if (!result) return // User declined

		agentId = result.agentId
		role = result.role

		// Save to settings
		await config.update("societyAgent.agentId", agentId, vscode.ConfigurationTarget.Workspace)
		await config.update("societyAgent.role", role, vscode.ConfigurationTarget.Workspace)
		await config.update("societyAgent.sharedDir", sharedDir, vscode.ConfigurationTarget.Workspace)
	}

	// 4. Start HTTP server
	const port = await findAvailablePort(3000, 4000)
	const server = new AgentServer(port, agentId, role)
	await server.start()
	context.subscriptions.push(server)

	// 5. Initialize registry (with URL)
	const registry = new AgentRegistry(sharedDir, {
		agentId,
		role,
		url: `http://localhost:${port}`,
		wsUrl: `ws://localhost:${port}/ws`,
	})
	await registry.initialize()
	await registry.catchUp() // Process missed messages
	context.subscriptions.push(registry)

	// 6. Success!
	vscode.window.showInformationMessage(`Society Agent: Connected as ${role} 🤖`, "View Agents").then((choice) => {
		if (choice === "View Agents") {
			// Show agent dashboard
		}
	})
}
```

### Connection Wizard

```typescript
async function showConnectionWizard(sharedDir: string): Promise<{ agentId: string; role: string } | null> {
	// Step 1: Confirm connection
	const confirm = await vscode.window.showInformationMessage(
		"Society Agent project detected. Connect this VS Code?",
		{ modal: true },
		"Connect",
	)
	if (confirm !== "Connect") return null

	// Step 2: Select role
	const role = await vscode.window.showQuickPick(
		[
			{ label: "🎯 Supervisor", value: "supervisor", description: "Coordinates all agents" },
			{ label: "⚙️ Backend Developer", value: "backend-developer", description: "Server-side code" },
			{ label: "🎨 Frontend Developer", value: "frontend-developer", description: "UI/UX code" },
			{ label: "✅ Tester", value: "tester", description: "Testing and QA" },
			{ label: "🚀 DevOps", value: "devops", description: "Deployment" },
			{ label: "🔒 Security Reviewer", value: "security-reviewer", description: "Security audits" },
		],
		{
			title: "Select Agent Role",
			placeHolder: "What role should this VS Code play?",
		},
	)
	if (!role) return null

	// Step 3: Generate ID
	const agentId = `${role.value}-${randomId(6)}`

	// Step 4: Confirm
	const final = await vscode.window.showInformationMessage(
		`Connect as: ${role.label}\nAgent ID: ${agentId}`,
		{ modal: true },
		"Confirm",
	)
	if (final !== "Confirm") return null

	return { agentId, role: role.value }
}
```

---

## 2. Communication: Hybrid Architecture

### Sending a Message

```typescript
class AgentCommunication {
	async sendMessage(to: string, content: string, attachments?: File[]) {
		// 1. Find recipient
		const recipient = await this.registry.findAgent(to)
		if (!recipient) {
			throw new Error(`Agent not found: ${to}`)
		}

		// 2. Try network (fast path)
		if (recipient.url && (await this.isOnline(recipient))) {
			try {
				if (attachments && attachments.length > 0) {
					// With attachments: HTTP multipart
					await this.sendMultipart(recipient.url, content, attachments)
				} else {
					// Text only: JSON
					await this.sendJSON(recipient.url, content)
				}

				// Log for audit trail
				await this.logMessage(to, content, { delivered: true, via: "network" })
				return
			} catch (error) {
				console.warn(`Network failed to ${to}, using file fallback:`, error)
			}
		}

		// 3. File fallback (slow path, but reliable)
		if (attachments) {
			// Save attachments to shared directory
			const attachmentRefs = await this.saveAttachments(attachments)
			await this.fileRegistry.appendMessage({
				to,
				content,
				attachments: attachmentRefs,
				delivered: false,
			})
		} else {
			await this.fileRegistry.appendMessage({
				to,
				content,
				delivered: false,
			})
		}
	}

	private async sendJSON(url: string, content: string) {
		await fetch(`${url}/api/message`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				from: this.agentId,
				content: content,
				timestamp: new Date().toISOString(),
			}),
		})
	}

	private async sendMultipart(url: string, content: string, files: File[]) {
		const formData = new FormData()
		formData.append("from", this.agentId)
		formData.append("content", content)
		formData.append("timestamp", new Date().toISOString())

		for (const file of files) {
			formData.append("attachments", file)
		}

		await fetch(`${url}/api/message-multi`, {
			method: "POST",
			body: formData,
		})
	}
}
```

### Receiving Messages

```typescript
class AgentServer {
	private setupRoutes() {
		// Text message
		this.app.post("/api/message", async (req, res) => {
			const { from, content, timestamp } = req.body

			await this.handleMessage({
				from,
				to: this.agentId,
				content,
				timestamp,
			})

			res.json({ status: "received" })
		})

		// Message with attachments
		this.app.post("/api/message-multi", upload.array("attachments"), async (req, res) => {
			const { from, content, timestamp } = req.body
			const files = req.files as Express.Multer.File[]

			// Save attachments temporarily
			const attachments = []
			for (const file of files) {
				const savedPath = path.join(this.tempDir, file.originalname)
				await fs.writeFile(savedPath, file.buffer)
				attachments.push({
					filename: file.originalname,
					mimeType: file.mimetype,
					path: savedPath,
					size: file.size,
				})
			}

			await this.handleMessage({
				from,
				to: this.agentId,
				content,
				attachments,
				timestamp,
			})

			res.json({ status: "received", attachments: attachments.length })
		})

		// Health check
		this.app.get("/api/status", (req, res) => {
			res.json({
				agentId: this.agentId,
				role: this.role,
				status: "online",
				uptime: process.uptime(),
				timestamp: new Date().toISOString(),
			})
		})
	}

	private async handleMessage(message: AgentMessage) {
		// Display notification
		if (message.attachments && message.attachments.length > 0) {
			vscode.window
				.showInformationMessage(
					`Message from ${message.from}: ${message.content} (${message.attachments.length} attachments)`,
					"View",
				)
				.then((choice) => {
					if (choice === "View") {
						this.displayMessageWithAttachments(message)
					}
				})
		} else {
			vscode.window.showInformationMessage(`Message from ${message.from}: ${message.content}`)
		}

		// Emit event for other components
		this.emit("message", message)
	}
}
```

---

## 3. Attachment Support

### Sending Images

```typescript
// From VS Code extension
async function sendScreenshot(toAgentId: string) {
	// 1. User pastes screenshot or selects file
	const imageData = await getImageFromClipboard() // or file picker

	// 2. Create File object
	const blob = dataURLtoBlob(imageData)
	const file = new File([blob], "screenshot.png", { type: "image/png" })

	// 3. Send with message
	await agentCommunication.sendMessage(toAgentId, "Here is the bug screenshot", [file])
}

// Recipient displays image
function displayMessageWithAttachments(message: AgentMessage) {
	const panel = vscode.window.createWebviewPanel(
		"agentMessage",
		`Message from ${message.from}`,
		vscode.ViewColumn.One,
		{ enableScripts: true },
	)

	const imagesHtml = message.attachments
		.filter((a) => a.mimeType.startsWith("image/"))
		.map((a) => {
			const imageData = fs.readFileSync(a.path, "base64")
			return `<img src="data:${a.mimeType};base64,${imageData}" style="max-width:100%">`
		})
		.join("")

	panel.webview.html = `
    <!DOCTYPE html>
    <html>
    <body>
      <h2>Message from ${message.from}</h2>
      <p>${message.content}</p>
      <h3>Attachments:</h3>
      ${imagesHtml}
    </body>
    </html>
  `
}
```

### Integration with KiloCode Prompt

```typescript
// User attaches image to KiloCode prompt in Backend VS Code
// Backend agent forwards to Supervisor with context

async function forwardUserPromptWithImage(prompt: string, images: Image[]) {
	const supervisor = await registry.findAgent("supervisor")

	// Convert KiloCode images to files
	const files = images.map((img) => new File([img.data], img.filename, { type: img.mimeType }))

	await agentCommunication.sendMessage(supervisor.agentId, `User prompt: ${prompt}`, files)
}
```

---

## 4. Complete Flow Example

### Scenario: Frontend finds bug, sends screenshot to Backend

```
1. User (in Frontend VS Code):
   - Encounters bug
   - Takes screenshot (paste into chat or drag file)
   - Types: "API returns 500 error on login"
   - Clicks "Send to Backend Agent"

2. Frontend VS Code:
   - Creates File object from screenshot
   - Calls: sendMessage("backend-abc123", "API returns 500...", [screenshotFile])

3. Frontend Extension:
   - Finds backend-abc123 in registry: url = "http://localhost:3002"
   - Checks if online (heartbeat < 2 min): YES ✓
   - Sends HTTP POST to localhost:3002/api/message-multi
     Content-Type: multipart/form-data
     - from: frontend-def456
     - content: API returns 500 error on login
     - attachments: screenshot.png (binary data)

4. Network (localhost):
   - ~10ms transfer time
   - No internet, no firewall issues

5. Backend VS Code:
   - HTTP server receives POST on :3002/api/message-multi
   - Parses multipart form data
   - Saves screenshot to temp file
   - Calls handleMessage()

6. Backend Extension:
   - Shows notification: "Message from frontend: API returns 500... (1 attachment)"
   - User clicks "View"
   - Opens webview with message text and screenshot displayed

7. Backend Developer:
   - Reviews screenshot
   - Fixes bug in API code
   - Sends back: "Fixed! Issue was in auth middleware."

8. Frontend receives confirmation:
   - Tests API
   - Bug resolved ✓

Total time: <1 second (real-time collaboration!)
```

---

## 5. Offline Agent Handling

### Scenario: Tester offline, Backend sends report

```
1. Backend sends message to Tester:
   - Lookup Tester in registry
   - URL: http://localhost:3004
   - Heartbeat: 2024-02-10T09:00:00 (2 hours ago)
   - Status: OFFLINE ❌

2. Network attempt fails:
   - fetch("http://localhost:3004/api/message") → Connection refused
   - Catches error

3. File fallback:
   - Appends to .society-agent/messages.jsonl
   - {to: "tester-ghi123", content: "...", delivered: false}

4. Later: Tester wakes up (user opens Tester VS Code):
   - Extension activates
   - Calls catchUp()
   - Reads messages.jsonl
   - Finds undelivered message
   - Processes message
   - Marks delivered in deliveries.jsonl
   - Shows notification to user

5. Tester can respond:
   - Backend now online
   - Sends via network (fast)
   - Real-time response
```

---

## 6. File Structure

```
/project/
  .society-agent/
    # Discovery & Registration
    registry.jsonl              # Agent URLs, heartbeats
    project.json                # Project config (workspaces)

    # Communication
    messages.jsonl              # Audit trail, offline queue
    deliveries.jsonl            # Delivery tracking

    # Attachments
    attachments/
      msg-001-screenshot.png
      msg-002-report.pdf
      msg-003-diagram.png

    # Documentation
    README.md                   # Generated by setup script

    # Launch Scripts
    launch-scripts/
      launch-all.sh
      launch-supervisor.sh
      launch-backend-worker.sh
      launch-frontend-worker.sh

  # Workspaces
  backend/
    .vscode/
      settings.json             # Agent config
    src/

  frontend/
    .vscode/
      settings.json             # Agent config
    src/
```

---

## 7. Settings Schema

```json
// .vscode/settings.json (per workspace)
{
	// Required
	"kilo-code.societyAgent.sharedDir": "/project/.society-agent",
	"kilo-code.societyAgent.agentId": "backend-abc123",
	"kilo-code.societyAgent.role": "backend-developer",

	// Optional
	"kilo-code.societyAgent.capabilities": ["api", "database"],
	"kilo-code.societyAgent.workingDirectory": "/project/backend",

	// Network settings
	"kilo-code.societyAgent.useNetwork": true, // Enable HTTP server
	"kilo-code.societyAgent.portRange": [3000, 4000], // Auto-select in range

	// Attachment settings
	"kilo-code.societyAgent.maxAttachmentSize": 10485760, // 10MB
	"kilo-code.societyAgent.allowedMimeTypes": ["image/*", "application/pdf", "text/*"]
}
```

---

## 8. Implementation Plan

### Week 4: Network Layer ⬅️ NEXT

**Files to create**:

- `src/services/society-agent/agent-server.ts` (HTTP server)
- `src/services/society-agent/agent-client.ts` (HTTP client)
- `src/services/society-agent/port-manager.ts` (Find available ports)

**Files to modify**:

- `src/services/society-agent/agent-registry.ts` (Add network support)
- `src/extension.ts` (Start HTTP server on activation)
- `src/package.json` (Add network settings)

**Tasks**:

1. ✅ Create HTTP server with Express
2. ✅ Add POST /api/message endpoint
3. ✅ Add POST /api/message-multi endpoint
4. ✅ Add GET /api/status endpoint
5. ✅ Port auto-selection (3000-4000 range)
6. ✅ Update AgentRegistry to use network
7. ✅ Fallback to file-based on network failure
8. ✅ Test with 2 VS Code instances

**Deliverables**:

- Network communication working
- File fallback working
- Tests passing

---

### Week 5: Attachment Support

**Tasks**:

1. ✅ HTTP multipart upload support
2. ✅ File attachment UI in webview
3. ✅ Image preview in messages
4. ✅ Integration with KiloCode prompt attachments
5. ✅ Attachment size limits
6. ✅ MIME type validation

---

### Week 6: Polish & Testing

**Tasks**:

1. ✅ Error handling (network failures, timeouts)
2. ✅ Performance testing (10+ agents)
3. ✅ Memory leak checks
4. ✅ Reconnection logic
5. ✅ Agent monitoring dashboard
6. ✅ Documentation updates

---

## 9. Success Criteria

✅ **Connection Ease**

- User opens VS Code → automatic connection
- < 2 seconds from open to "Connected" notification
- Settings visible and editable

✅ **Communication Speed**

- Network: < 10ms latency (localhost)
- File fallback: < 200ms latency
- Handles 100 messages/hour smoothly

✅ **Attachment Support**

- Images up to 10MB
- Multiple attachments per message
- Preview in VS Code webview
- Integration with KiloCode prompts

✅ **Reliability**

- Handles offline agents gracefully
- No lost messages
- Survives VS Code crashes/restarts
- Audit trail in messages.jsonl

✅ **Scalability**

- Works with 5-20 agents
- Low CPU/memory overhead
- Minimal file system churn

---

## 10. Summary

**Architecture Finalized**: ⭐ Hybrid (File + Network)

**Key Features**:

1. ✅ **Automatic connection** - Just open VS Code
2. ✅ **Network communication** - Fast, real-time, many-to-many
3. ✅ **Offline support** - File fallback, no lost messages
4. ✅ **Attachment support** - Images, files via HTTP multipart
5. ✅ **Persistent agents** - Live for project lifetime
6. ✅ **Easy setup** - One command: `pnpm setup:multi-vscode`
7. ✅ **Debuggable** - Files visible, logs available
8. ✅ **Scalable** - Works from 3 to 50+ agents

**Status**: Ready for Week 4 implementation! 🚀

**Next Action**: Implement HTTP server and network communication layer.

---

**Let's build it!** 💪
