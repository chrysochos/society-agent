# Society Agents - Architecture Models

**Date**: January 31, 2026  
**Question**: VS Code Extension vs Standalone Web Server?

---

## Model 1: Current (VS Code Extension)

```
┌─────────────────────────────────────────┐
│         Your Machine                     │
├─────────────────────────────────────────┤
│                                          │
│  VS Code Application                     │
│  ├─ Society Agent Extension (backend)    │
│  │  └─ SocietyManager + AgentTeam       │
│  │                                       │
│  └─ Webview (React UI)                   │
│     └─ Dashboard + Agent Detail Pages    │
│                                          │
│  [All in one process]                    │
│                                          │
└─────────────────────────────────────────┘
```

**Pros**:

- ✅ Simple to install: 1-click in VS Code
- ✅ Integrated with editor (can analyze open files)
- ✅ No network needed
- ✅ No server to manage

**Cons**:

- ❌ Only works in VS Code
- ❌ Only one user per VS Code instance
- ❌ Can't access from browser
- ❌ Can't run headless on server
- ❌ Single machine only

---

## Model 2: Standalone Web Server (NEW)

```
┌──────────────────────────────────────────────────────────────┐
│              Your Network / Cloud                             │
├──────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌─────────────────────────────────────────┐                 │
│  │     Society Agents Server                │                 │
│  │     (Node.js process)                    │                 │
│  │                                          │                 │
│  │  SocietyManager                          │                 │
│  │  ├─ Purpose 1: Team A executing...       │                 │
│  │  ├─ Purpose 2: Team B executing...       │                 │
│  │  └─ Purpose 3: Team C executing...       │                 │
│  │                                          │                 │
│  │  Express/REST API                        │                 │
│  │  ├─ POST /api/purpose (start)            │                 │
│  │  ├─ GET /api/purposes (list)             │                 │
│  │  ├─ GET /api/agents/:id (details)        │                 │
│  │  ├─ WebSocket /ws (live updates)         │                 │
│  │  └─ POST /api/control (pause/stop)       │                 │
│  │                                          │                 │
│  └─────────────────────────────────────────┘                 │
│           ↑                          ↑                        │
│        HTTP/REST               WebSocket                     │
│           │                          │                       │
│  ┌────────┴──────────┬───────────────┴───────────┐           │
│  │                   │                           │           │
│  ▼                   ▼                           ▼           │
│ Browser 1          Browser 2              VS Code Ext       │
│ (React SPA)        (React SPA)            (Webview)         │
│ :3000             :3001                  (Optional)         │
│                                                               │
│ User A             User B                 Developer          │
│ Laptop             iPad                   Local Coding       │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

**Pros**:

- ✅ Works from any browser (Chrome, Safari, Firefox, etc.)
- ✅ Multiple users simultaneously
- ✅ Can run on remote server
- ✅ Cloud-deployable (AWS, Heroku, etc.)
- ✅ Mobile accessible
- ✅ Headless (no GUI needed)
- ✅ Can scale (multiple purposes at once)
- ✅ VS Code extension still optional (for deep integration)

**Cons**:

- ❌ Need to manage server
- ❌ Network required
- ❌ Need security/authentication
- ❌ More infrastructure

---

## Quick Comparison Table

| Feature                 | VS Code Extension | Web Server              |
| ----------------------- | ----------------- | ----------------------- |
| **Install complexity**  | Easy (1-click)    | Medium (install server) |
| **Browser access**      | ❌ No             | ✅ Yes                  |
| **Mobile access**       | ❌ No             | ✅ Yes                  |
| **Multiple users**      | ❌ No             | ✅ Yes                  |
| **Remote server**       | ❌ No             | ✅ Yes                  |
| **Cloud deployment**    | ❌ No             | ✅ Yes                  |
| **Headless/CLI only**   | ❌ No             | ✅ Yes                  |
| **Works offline**       | ✅ Yes            | ❌ Needs network        |
| **VS Code integration** | ✅ Deep           | ⚠️ Optional             |
| **Easy setup**          | ✅ Yes            | ⚠️ Moderate             |

---

## What I Recommend: Hybrid Model

**Best of both worlds:**

```
┌─────────────────────────────────────────────────────────────┐
│              Hybrid Architecture                             │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Core Layer (Shared)                                          │
│  ├─ SocietyManager (business logic)                           │
│  ├─ Agent Services (conversation, supervisor, etc.)          │
│  └─ Data Storage (.society-agent/ folder)                    │
│                                                               │
│  ┌─────────────────────────────────────────┐                │
│  │ Deployment Option 1: CLI/Server         │                │
│  │ $ npx society-agent --server             │                │
│  │ Server listening on :3000                │                │
│  │ Access from browser                      │                │
│  └─────────────────────────────────────────┘                │
│                                                               │
│  ┌─────────────────────────────────────────┐                │
│  │ Deployment Option 2: VS Code Extension  │                │
│  │ Install extension in VS Code             │                │
│  │ Webview shows same dashboard             │                │
│  │ Local, no network needed                 │                │
│  └─────────────────────────────────────────┘                │
│                                                               │
│  ┌─────────────────────────────────────────┐                │
│  │ Deployment Option 3: CLI Only           │                │
│  │ $ society-agent start "analyze code"    │                │
│  │ Works headless, logs to console          │                │
│  └─────────────────────────────────────────┘                │
│                                                               │
│  ┌─────────────────────────────────────────┐                │
│  │ Deployment Option 4: Docker/Cloud       │                │
│  │ docker run -p 3000:3000 society-agent   │                │
│  │ Run on AWS, GCP, Heroku, etc.           │                │
│  └─────────────────────────────────────────┘                │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Strategy: Hybrid

### Phase 1: Extract Core Services (Already Done!)

```typescript
// src/services/society-agent/
// ├─ SocietyManager
// ├─ SupervisorAgent
// ├─ ConversationAgent
// ├─ AgentTeam
// └─ ... (all backend logic)

// This is AGNOSTIC - works with ANY UI
```

### Phase 2: Create Express Server (New)

```typescript
// src/api/society-server.ts (NEW)
// Express.js REST API

import express from "express"
import { SocietyManager } from "../services/society-agent"

const app = express()

// REST endpoints
app.post("/api/purpose", async (req, res) => {
	const result = await societyManager.startPurpose(req.body)
	res.json(result)
})

app.get("/api/purposes", (req, res) => {
	const state = societyManager.getState()
	res.json({
		active: Array.from(state.activePurposes.values()),
		completed: state.completedPurposes,
	})
})

app.get("/api/agents/:id", (req, res) => {
	const agent = getAgent(req.params.id)
	res.json(agent.getState())
})

// WebSocket for live updates
io.on("connection", (socket) => {
	socket.on("subscribe-purpose", (purposeId) => {
		// Stream live updates
	})
})

app.listen(3000, () => console.log("Server running on :3000"))
```

### Phase 3: React UI (Browser-Based)

```typescript
// webview-ui/src/app.tsx
// Same Dashboard + AgentDetailView components

// But now they fetch from HTTP instead of VS Code messages
const Dashboard = () => {
	const [purposes, setPurposes] = useState([])

	useEffect(() => {
		// Fetch from server (instead of VS Code message)
		fetch("http://localhost:3000/api/purposes")
			.then((r) => r.json())
			.then(setPurposes)
	}, [])

	// Rest of component...
}

// WebSocket connection for live updates
const ws = new WebSocket("ws://localhost:3000/ws")
ws.onmessage = (event) => {
	const message = JSON.parse(event.data)
	// Update UI...
}
```

### Phase 4: Package for All Deployment Options

```
├─ CLI: society-agent (command line)
├─ Server: society-agent --server (web server)
├─ Extension: VS Code Extension (webview)
├─ Docker: Dockerfile for containerization
└─ Web: Standalone SPA deployment
```

---

## Path Forward: What Should We Do?

### Option A: Keep Current (VS Code Only)

```
✅ Works now
✅ Simple for developers
❌ Limited to VS Code
❌ Single user
❌ No remote access
```

**Time to production**: Done now

---

### Option B: Build Web Server + Keep Extension

```
✅ Works in browser AND VS Code
✅ Multiple users
✅ Remote access
✅ Cloud deployment
⚠️ More complex setup
```

**Time to implement**: 8-10 hours

- 3-4 hours: Express API + WebSocket
- 2-3 hours: Refactor UI to use HTTP
- 2-3 hours: Docker + deployment docs

**Time to production**: ~1.5 days

---

### Option C: Web Server ONLY (Recommended for Real Product)

```
✅ Simplest long-term
✅ Unified codebase
✅ Works everywhere
✅ Easy to scale
✅ VS Code extension optional later
```

**Time to implement**: 6-8 hours

- 2-3 hours: Create Express API
- 2-3 hours: Move UI to browser
- 1-2 hours: Add authentication + docs

**Time to production**: ~1 day

---

## My Recommendation: **Option B or C**

**Why?**

1. Your core logic (SocietyManager) is already UI-agnostic
2. Web server is only 3-4 hours of work
3. Gives you massive flexibility
4. Future-proofs your design

**Suggestion**:

1. Build Express API (~2 hours)
2. Move React UI to browser (~2 hours)
3. Keep VS Code extension optional (works either way)
4. Docker container for deployment (~1 hour)

**Result**: Same functionality, but works from:

- ✅ Browser (any machine)
- ✅ Mobile (iOS/Android)
- ✅ VS Code (if you want)
- ✅ Cloud servers
- ✅ Docker containers
- ✅ Docker Compose (multi-service)

---

## Architecture Decision Matrix

**Choose based on your use case:**

| Use Case            | Recommendation               |
| ------------------- | ---------------------------- |
| Personal dev tool   | **Keep current (Extension)** |
| Team tool           | **Option B (Hybrid)**        |
| SaaS product        | **Option C (Web Server)**    |
| Enterprise deploy   | **Option C + Docker**        |
| Research/playground | **Option C + local**         |

---

## What Are You Building For?

**Tell me:**

1. Is this for personal use or team?
2. Do multiple people need to use it simultaneously?
3. Should it run on servers/cloud?
4. Do you want to offer it as a service?
5. Do you need it accessible from anywhere?

**Based on your answers, I can recommend the exact path.** 🚀

---

## Quick Start Comparison

### Just Want It Working Now?

**Current setup**: Already works with VS Code Extension ✅

- `pnpm run build`
- `F5` to debug
- Done!

### Want Maximum Flexibility?

**Switch to Web Server Model**:

```bash
# Start server
npx society-agent --server

# Open browser
open http://localhost:3000

# Or multiple browser windows
# Or on different machines
# Or on mobile
# Or deploy to cloud
```

---

**What do you prefer? Should we:**

A) Keep it as VS Code Extension (done now)
B) Add web server alongside (hybrid)
C) Switch to web server (more flexible)

?
