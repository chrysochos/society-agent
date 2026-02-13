# Multi-VS Code Asynchronous Communication Scenarios

## Scenario 1: All Agents Online

```
Time: 10:00 AM
┌──────────────┐
│  Supervisor  │ ─┐
│   ONLINE     │  │ "Implement auth endpoint"
└──────────────┘  │
                  ├─► messages.jsonl
                  │   {from: "supervisor", to: "backend", type: "task_assign", ...}
┌──────────────┐  │
│   Backend    │ ◄┘
│   ONLINE     │ ─┐ (File watcher detects change)
└──────────────┘  │ (Processes message immediately)
                  │
                  │ "Task complete!"
                  └─► messages.jsonl
                      {from: "backend", to: "supervisor", type: "task_complete", ...}

┌──────────────┐
│  Supervisor  │ ◄── (File watcher detects change)
│   ONLINE     │     (Processes response immediately)
└──────────────┘

Result: Synchronous-like behavior (fast response)
```

---

## Scenario 2: Recipient Offline (The Interesting Case!)

```
Time: 6:00 PM (End of day)
┌──────────────┐
│  Supervisor  │ ─┐
│   ONLINE     │  │ "Implement auth endpoint - deadline: tomorrow 10am"
└──────────────┘  │
                  ├─► messages.jsonl
                  │   {id: "msg-042", from: "supervisor", to: "backend",
                  │    type: "task_assign", delivered: false, ...}
┌──────────────┐  │
│   Backend    │  X  OFFLINE (User went home)
│   OFFLINE    │
└──────────────┘

Supervisor doesn't wait - continues working or shuts down.
Message sits in queue.

═══════════════════════════════════════════════════════════════

Time: 9:00 AM (Next day)
User opens Backend workspace:

┌──────────────┐
│   Backend    │  1️⃣ VS Code opens
│   STARTING   │  2️⃣ Extension activates
└──────────────┘  3️⃣ Reads settings.json
                  4️⃣ Finds sharedDir configured
                  5️⃣ Initializes AgentRegistry

   ↓ initialize()

┌──────────────┐
│ AgentRegistry│  6️⃣ Registers agent in registry.jsonl
│              │  7️⃣ Calls catchUp()
└──────────────┘

   ↓ catchUp()

   Step 1: Read all messages
   ┌────────────────┐
   │ messages.jsonl │
   │ [1000 msgs]    │
   └────────────────┘
           │
           ├─► Filter: to = "backend" OR "broadcast"
           │   Found: 50 messages
           │
   Step 2: Read deliveries
   ┌──────────────────┐
   │ deliveries.jsonl │
   │ [800 delivered]  │
   └──────────────────┘
           │
           ├─► Filter: deliveredTo = "backend"
           │   Found: 45 already delivered
           │
   Step 3: Undelivered = 50 - 45 = 5 messages
           │
           ├─► msg-042: task_assign (from supervisor)
           ├─► msg-043: broadcast (from frontend)
           ├─► msg-044: question (from tester)
           ├─► msg-045: status_update (from devops)
           └─► msg-046: message (from supervisor)

   Step 4: Process each undelivered message
   ┌─────────────────────────────────────┐
   │ Process msg-042: task_assign        │
   │ "Implement auth endpoint"           │
   │                                     │
   │ → Agent sees the task              │
   │ → Shows notification in VS Code    │
   │ → Marks delivered in deliveries.jsonl │
   └─────────────────────────────────────┘

┌──────────────┐
│   Backend    │  ✓ Caught up!
│   ONLINE     │  ✓ Ready to work
└──────────────┘  ✓ Has 5 tasks to address

Agent can now:
- Start working on task from msg-042
- Respond to question from msg-044
- Acknowledge other messages

═══════════════════════════════════════════════════════════════

Time: 9:30 AM
Backend completes task:

┌──────────────┐
│   Backend    │ ─┐ "Task complete!"
│   ONLINE     │  │
└──────────────┘  │
                  ├─► messages.jsonl
                  │   {from: "backend", to: "supervisor", type: "task_complete",
                  │    delivered: false, timestamp: "9:30am"}
┌──────────────┐  │
│  Supervisor  │  ?  (May be online or offline)
│   UNKNOWN    │
└──────────────┘

If Supervisor online: Processes immediately ✓
If Supervisor offline: Processes on next wake-up ✓

No lost messages!
```

---

## Scenario 3: Broadcast to Mixed Online/Offline

```
Time: 11:00 AM
┌──────────────┐
│  Frontend    │ ─┐
│   ONLINE     │  │ "API schema changed - review new types"
└──────────────┘  │
                  ├─► messages.jsonl (broadcast)
                  │   {from: "frontend", to: "broadcast",
                  │    type: "status_update", ...}
                  │
                  ├─► Backend (ONLINE)    ✓ Receives immediately
                  ├─► Tester (OFFLINE)    ⏱ Queued for later
                  ├─► DevOps (ONLINE)     ✓ Receives immediately
                  └─► Supervisor (OFFLINE) ⏱ Queued for later

Result: Online agents aware immediately
        Offline agents will catch up when they wake
```

---

## Scenario 4: Question to Sleeping Agent

```
Time: 2:00 PM
┌──────────────┐
│   Backend    │ ─┐ "Which OAuth library should we use?"
│   ONLINE     │  │
└──────────────┘  │
                  ├─► messages.jsonl
                  │   {from: "backend", to: "security-reviewer",
                  │    type: "question", ...}
┌──────────────┐  │
│  Security    │  X  OFFLINE (Only runs during security review phase)
│   OFFLINE    │
└──────────────┘

Backend doesn't block - continues with other work.
Question queued.

═══════════════════════════════════════════════════════════════

Time: 4:00 PM (Security review phase)
User launches Security Reviewer:

┌──────────────┐
│  Security    │  1️⃣ Opens
│   ONLINE     │  2️⃣ catchUp()
└──────────────┘  3️⃣ Finds question from backend
                  4️⃣ Shows notification with question

User (via Security agent) reviews and responds:

┌──────────────┐
│  Security    │ ─┐ "Use OAuth2-Server library - OWASP recommended"
│   ONLINE     │  │
└──────────────┘  │
                  ├─► messages.jsonl
                  │   {from: "security-reviewer", to: "backend",
                  │    type: "message", inReplyTo: "msg-xyz", ...}
┌──────────────┐  │
│   Backend    │ ◄┘ (If online, receives immediately)
│   ONLINE     │    (If offline, queues for later)
└──────────────┘

Result: Asynchronous Q&A works perfectly!
        No agent needs to wait blocked.
```

---

## Scenario 5: Overnight Task Assignment

```
Friday 6:00 PM - Developer leaves for weekend
┌──────────────┐
│  Supervisor  │ ─┐ "Generate test suite for auth module"
│   ONLINE     │  │ "Priority: Low, Deadline: Monday 9am"
└──────────────┘  │
                  ├─► messages.jsonl
                  │   Multiple tasks assigned to:
                  │   - Backend: Code review
                  │   - Frontend: Update types
                  │   - Tester: Generate tests
                  └─► All agents OFFLINE (weekend)

Messages queue...

═══════════════════════════════════════════════════════════════

Monday 9:00 AM - Developer returns
All agents launched:

┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   Backend    │  │  Frontend    │  │   Tester     │
│   ONLINE     │  │   ONLINE     │  │   ONLINE     │
└──────────────┘  └──────────────┘  └──────────────┘
      ↓                  ↓                  ↓
   catchUp()         catchUp()         catchUp()
      ↓                  ↓                  ↓
   3 tasks           2 tasks           1 task
      ↓                  ↓                  ↓
   Ready to          Ready to          Ready to
   work!             work!             work!

Result: Seamless handoff over time!
        Work assigned Friday, picked up Monday.
```

---

## Key Insights

### Why This Works

1. **File-Based Persistence**

    - Messages don't disappear
    - Append-only log (JSONL)
    - Survives crashes, restarts, shutdowns

2. **Delivery Tracking**

    - Separate deliveries.jsonl
    - Know exactly what each agent has seen
    - No duplicate processing

3. **Catch-Up Protocol**

    - Every agent wake-up calls catchUp()
    - Processes ALL missed messages
    - Marks each as delivered

4. **Non-Blocking**
    - Sender never waits for recipient
    - Fire and forget
    - Async by default

### When to Use Sleeping Agents

✅ **Intermittent Workers**

- Security reviewer (only during audits)
- Performance tester (weekly runs)
- Documentation writer (end of sprint)

✅ **Time-Shifted Work**

- Assign tasks before leaving
- Agents pick up next morning
- Global teams (different time zones)

✅ **Resource Management**

- Only run agents when needed
- Save CPU/memory
- Scale up/down dynamically

✅ **Development Workflow**

- Test in isolation (turn off other agents)
- Debug single agent
- Staged rollout

### Comparison with Always-Online

| Aspect               | Always-Online        | Sleeping Agents        |
| -------------------- | -------------------- | ---------------------- |
| **Responsiveness**   | Instant              | Delayed (until wake)   |
| **Resource Usage**   | High (all running)   | Low (only active)      |
| **Flexibility**      | Must coordinate      | Can work independently |
| **Failure Handling** | All down together    | Isolated failures      |
| **Cost**             | Higher (more tokens) | Lower (fewer agents)   |
| **Use Case**         | Real-time collab     | Async workflow         |

---

## Implementation Details

### Catch-Up Code Flow

```typescript
async catchUp(): Promise<void> {
  console.log(`Agent ${this.agentId} catching up...`)

  // 1. Get all messages for this agent
  const allMessages = await this.readMessages()
  const myMessages = allMessages.filter(
    msg => msg.to === this.agentId || msg.to === "broadcast"
  )

  // 2. Get already delivered message IDs
  const deliveries = await this.readDeliveries()
  const deliveredIds = new Set(
    deliveries
      .filter(d => d.deliveredTo === this.agentId)
      .map(d => d.messageId)
  )

  // 3. Find undelivered
  const undelivered = myMessages.filter(
    msg => !deliveredIds.has(msg.id)
  )

  console.log(`Found ${undelivered.length} undelivered messages`)

  // 4. Process each
  for (const message of undelivered) {
    await this.handleMessage(message)
    await this.markDelivered(message.id)
  }

  console.log(`Catch-up complete`)
}
```

### Message File Watcher

```typescript
private startMessageWatcher(): void {
  this.watcher = vscode.workspace.createFileSystemWatcher(
    this.messagesPath
  )

  this.watcher.onDidChange(async (uri) => {
    // Only read NEW content (using file position)
    const newMessages = await this.readNewMessages()

    for (const msg of newMessages) {
      if (msg.to === this.agentId || msg.to === "broadcast") {
        await this.handleMessage(msg)
        await this.markDelivered(msg.id)
      }
    }
  })
}
```

### Heartbeat for Online Detection

```typescript
private startHeartbeat(): void {
  // Update every 30 seconds
  this.heartbeatInterval = setInterval(async () => {
    await this.appendJSONL(this.registryPath, {
      agentId: this.agentId,
      status: "idle",
      lastHeartbeat: new Date().toISOString()
    })
  }, 30000)
}

// Other agents check:
async getOnlineAgents(): Promise<Agent[]> {
  const all = await this.getAgents()
  const twoMinutesAgo = Date.now() - 120000

  return all.filter(agent => {
    const lastHeartbeat = new Date(agent.lastHeartbeat).getTime()
    return lastHeartbeat > twoMinutesAgo
  })
}
```

---

## Summary

**The sleeping agent pattern is a feature, not a limitation!**

✅ Messages queue automatically  
✅ Delivered on wake-up  
✅ No blocking or waiting  
✅ Perfect for asynchronous work  
✅ Resource-efficient  
✅ Natural workflow

**This is how distributed systems should work.** 🚀
