# Communication Architecture Comparison

## File-Based vs Network-Based vs Hybrid

### Scenario: 5 Agents, 100 Messages/Hour

---

## Architecture 1: Pure File-Based (Current)

```
┌──────────────┐
│  Supervisor  │────┐
└──────────────┘    │
                    │ append
┌──────────────┐    │         ┌─────────────────────┐
│   Backend    │────┼────────▶│  messages.jsonl     │
└──────────────┘    │         │  (Shared File)      │
                    │         │                     │
┌──────────────┐    │         │  {msg-001}          │
│  Frontend    │────┼────────▶│  {msg-002}          │
└──────────────┘    │         │  {msg-003}          │
                    │         │  ...                │
┌──────────────┐    │         └─────────────────────┘
│    Tester    │────┼────────▶         │
└──────────────┘    │                  │ file watcher
                    │                  │ (all 5 agents)
┌──────────────┐    │                  │
│    DevOps    │────┘                  ▼
└──────────────┘         ┌──────────────────────────┐
                         │  Each agent reads file   │
                         │  Filters own messages    │
                         │  Processes               │
                         └──────────────────────────┘

Write Pattern:
  Agent → append → messages.jsonl (1 write per message)

Read Pattern:
  messages.jsonl → notify 5 watchers → 5 reads × filter

Per Message:
  1 write + 5 reads = 6 file operations

100 messages/hour:
  100 writes + 500 reads = 600 file ops/hour
  = 10 file ops/minute
  = 1 file op every 6 seconds

✅ Totally manageable!
```

**Pros**:

- Simple implementation
- Debuggable (just cat messages.jsonl)
- Persistent (survives crashes)
- No network setup

**Cons**:

- File system overhead
- All agents read all messages (wasteful)
- ~100-200ms latency
- Doesn't scale to 20+ agents

---

## Architecture 2: Pure Network-Based

```
┌──────────────┐
│  Supervisor  │ :3001
│  HTTP Server │────┐
└──────────────┘    │
                    │ POST /api/message
                    │ (direct TCP)
┌──────────────┐    │
│   Backend    │ :3002 ◄───┐
│  HTTP Server │────┐       │
└──────────────┘    │       │
                    │       │
┌──────────────┐    │       │
│  Frontend    │ :3003 ◄───┼───┐
│  HTTP Server │────┐       │   │
└──────────────┘    │       │   │
                    │       │   │
┌──────────────┐    │       │   │
│    Tester    │ :3004 ◄───┼───┼───┐
│  HTTP Server │────┐       │   │   │
└──────────────┘    │       │   │   │
                    │       │   │   │
┌──────────────┐    │       │   │   │
│    DevOps    │ :3005 ◄───┴───┴───┴───┘
│  HTTP Server │
└──────────────┘

Discovery:
  .society-agent/registry.jsonl (still file-based!)
  {agentId, role, url: "http://localhost:3001"}

Message Send:
  Agent A → lookup Agent B URL → POST to http://localhost:3002/api/message

Per Message:
  1 HTTP request (sender)
  1 HTTP response (receiver)
  = 2 network ops

100 messages/hour:
  200 network ops/hour
  = 3.3 ops/minute
  = 1 op every 18 seconds

✅ Even lighter!
✅ <10ms latency (vs 100-200ms file)
```

**Pros**:

- Fast (<10ms latency)
- Direct communication (no broadcast read overhead)
- Scales to many agents
- Real-time WebSocket possible

**Cons**:

- More complex (HTTP server in each VS Code)
- Port management
- Network failures to handle
- No persistence (unless logged)

---

## Architecture 3: Hybrid (RECOMMENDED)

```
Discovery & Registration:
┌─────────────────────────────────────┐
│  .society-agent/registry.jsonl      │
│  (File-based)                       │
│                                     │
│  {agentId: "backend-001",           │
│   url: "http://localhost:3002"}    │
│  {agentId: "frontend-001",          │
│   url: "http://localhost:3003"}    │
└─────────────────────────────────────┘
           │
           │ Agents read to discover each other
           │
           ▼
    ┌──────────────────────────────┐
    │  Agent Discovery Complete    │
    └──────────────────────────────┘

Real-Time Communication:
┌──────────────┐                    ┌──────────────┐
│  Backend     │ :3002              │  Frontend    │ :3003
│              │ ◄──────────────────│              │
│  "API ready" │  POST /api/message │  "Got it!"   │
│              │────────────────────▶│              │
└──────────────┘  <10ms latency     └──────────────┘

Offline Fallback:
┌──────────────┐                    ┌──────────────┐
│  Backend     │                    │  Tester      │
│  (online)    │                    │  (OFFLINE)   │
│              │  POST fails ✗      │              │
│              │─────X               │              │
│              │         ↓           │              │
│              │  Fallback to file   │              │
│              │         ↓           │              │
│              │  messages.jsonl     │              │
│              │  {msg for tester}   │              │
└──────────────┘                    └──────────────┘
                                            │
                                            │ Later...
                                            │ Tester wakes up
                                            ▼
                                    ┌──────────────┐
                                    │  Tester      │
                                    │  catchUp()   │
                                    │  → reads msg │
                                    └──────────────┘

Audit Trail:
Every network message also logged to:
  .society-agent/messages.jsonl (append-only)

For:
  - Debugging
  - Compliance
  - Replay
  - Offline delivery
```

**How it works**:

```typescript
async sendMessage(to: string, content: any) {
  // 1. Find recipient
  const agent = await this.findAgent(to)

  // 2. Try network (fast path)
  if (agent.url) {
    try {
      await fetch(`${agent.url}/api/message`, {
        method: 'POST',
        body: JSON.stringify({ from: this.agentId, content })
      })

      // Also log for audit
      await this.logToFile({ to, content, delivered: true })
      return
    } catch (error) {
      console.warn('Network failed, using file fallback')
    }
  }

  // 3. File fallback (slow path, but reliable)
  await this.appendToFile({ to, content, delivered: false })
}
```

**Best of both**:
✅ Network speed when online  
✅ File reliability when offline  
✅ Simple discovery  
✅ Audit trail  
✅ Scales well

---

## Attachment Support Comparison

### Small Image (100 KB)

**File-Based (Base64)**:

```jsonl
{
	"id": "msg-1",
	"from": "frontend",
	"to": "supervisor",
	"content": "Bug screenshot",
	"attachments": [
		{
			"filename": "bug.png",
			"data": "iVBORw0KGgoAAAANSUhEU..."
		}
	]
}
```

Size: 133 KB (33% overhead)
Parse time: ~50ms

**File-Based (Reference)**:

```jsonl
{
	"id": "msg-1",
	"from": "frontend",
	"to": "supervisor",
	"content": "Bug screenshot",
	"attachments": [
		{
			"filename": "bug.png",
			"path": ".society-agent/attachments/msg-1-bug.png"
		}
	]
}
```

Message size: 200 bytes
File size: 100 KB (separate)
Parse time: 1ms (message) + 10ms (read file) = 11ms

**Network-Based (HTTP Multipart)**:

```http
POST /api/message HTTP/1.1
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary

------WebKitFormBoundary
Content-Disposition: form-data; name="from"

frontend-001
------WebKitFormBoundary
Content-Disposition: form-data; name="content"

Bug screenshot
------WebKitFormBoundary
Content-Disposition: form-data; name="attachment"; filename="bug.png"
Content-Type: image/png

<binary data>
------WebKitFormBoundary--
```

Transfer time: ~20ms (localhost)
Overhead: ~5% (HTTP headers)

**Winner**: Network (HTTP Multipart) ⭐

- Fast
- Standard protocol
- Efficient
- Streaming support

---

### Large File (10 MB)

**File-Based (Base64)**:
❌ Don't use - 13.3 MB message size, very slow

**File-Based (Reference)**:

```jsonl
{
	"id": "msg-1",
	"attachments": [
		{
			"path": ".society-agent/attachments/msg-1-video.mp4"
		}
	]
}
```

✅ Works, but recipient must read 10MB from disk

**Network-Based (HTTP Streaming)**:

```typescript
// Send
await fetch(`${agent.url}/api/upload`, {
	method: "POST",
	body: fs.createReadStream("video.mp4"),
})

// Receive (streaming)
app.post("/api/upload", (req, res) => {
	const writeStream = fs.createWriteStream("received.mp4")
	req.pipe(writeStream)
	writeStream.on("finish", () => res.json({ status: "ok" }))
})
```

✅ Streaming (low memory)
✅ Progress tracking
✅ Fast (~200ms for 10MB on localhost)

**Winner**: Network (HTTP Streaming) ⭐

---

## Performance Benchmark: 5 Agents, 1 Hour

### Scenario: Typical Development Session

- Supervisor sends 20 task assignments
- Workers send 30 status updates
- 10 questions between workers
- 5 broadcasts
- 10 file attachments (images, 500KB each)

**Total**: 75 messages + 10 attachments (5MB)

### File-Based Performance

```
Messages:
  75 writes to messages.jsonl
  + 375 reads (5 agents × 75 messages)
  = 450 file operations

Attachments (file reference):
  10 writes to .society-agent/attachments/
  + 10 reads when recipient opens
  = 20 file operations

Total: 470 file operations in 1 hour
Average: ~8 ops/minute
Peak: ~30 ops/minute (busy period)

Disk I/O:
  Messages: ~100 KB (75 × ~1.3KB)
  Attachments: 5 MB
  Total: 5.1 MB

Latency per message: 100-200ms
```

**Verdict**: ✅ Acceptable for 5 agents

---

### Network-Based Performance

```
Messages:
  75 HTTP requests
  + 75 HTTP responses
  = 150 network operations

Attachments:
  10 HTTP multipart uploads
  + 10 HTTP responses
  = 20 network operations

Total: 170 network operations in 1 hour
Average: ~3 ops/minute
Peak: ~15 ops/minute

Network I/O:
  Messages: ~150 KB (75 × 2KB with headers)
  Attachments: 5 MB
  Total: 5.15 MB

Latency per message: <10ms
```

**Verdict**: ✅ Fast and lightweight

---

### Hybrid Performance

```
Messages (online agents):
  60 HTTP requests (80% online)
  + 60 HTTP responses
  = 120 network operations

Messages (offline agents):
  15 file writes (20% offline)
  + 15 file reads (on wake-up)
  = 30 file operations

Audit trail:
  75 file writes to messages.jsonl (background)

Attachments:
  10 HTTP multipart uploads
  = 20 network operations

Total:
  140 network ops + 105 file ops

Latency:
  Online: <10ms (network)
  Offline: Queued (file)
```

**Verdict**: ⭐ Best balance - fast + reliable

---

## Scaling Comparison

### 5 Agents

| Metric             | File-Based | Network   | Hybrid    |
| ------------------ | ---------- | --------- | --------- |
| Setup Complexity   | Low        | Medium    | Medium    |
| Message Latency    | 100-200ms  | <10ms     | <10ms     |
| File Ops/Hour      | 450        | 0         | 105       |
| Network Ops/Hour   | 0          | 170       | 140       |
| CPU Usage          | Low        | Low       | Low       |
| Memory Usage       | Low        | Low       | Low       |
| Offline Support    | ✅         | ❌        | ✅        |
| Attachment Support | Limited    | Excellent | Excellent |

**All work fine for 5 agents.**

---

### 20 Agents

| Metric              | File-Based | Network | Hybrid |
| ------------------- | ---------- | ------- | ------ |
| Setup Complexity    | Low        | Medium  | Medium |
| Message Latency     | 200-500ms  | <10ms   | <10ms  |
| File Ops/Hour       | 7,200 ⚠️   | 0       | 420    |
| Network Ops/Hour    | 0          | 680     | 560    |
| CPU Usage           | Medium⚠️   | Low     | Low    |
| Memory Usage        | Medium     | Low     | Low    |
| File Watch Overhead | High⚠️     | None    | Low    |
| Offline Support     | ✅         | ❌      | ✅     |

**File-based starts to struggle at 20 agents (20 watchers, 20× reads per message).**

---

## Recommendation by Use Case

### Small Team (3-5 Agents)

**Use**: File-Based ✅

- Simplest setup
- No network needed
- Performance acceptable
- Easy to debug

### Medium Team (5-10 Agents)

**Use**: Hybrid ⭐

- Balance speed and reliability
- Handles offline agents well
- Scales to growth
- Good performance

### Large Team (10+ Agents)

**Use**: Network-Based 🚀

- Best performance
- Real-time communication
- Handles attachments well
- Scales indefinitely

### Distributed (Remote Agents)

**Use**: Network-Based (REQUIRED) 🌐

- File-based won't work across machines
- HTTP/WebSocket standard
- Can add authentication
- Cloud-ready

---

## Summary

**For your use case (many VS Codes, many-to-many, images)**:

⭐ **Recommend: Hybrid Architecture**

Why:

1. ✅ Fast network for online agents (<10ms)
2. ✅ File fallback for offline agents (no lost messages)
3. ✅ HTTP multipart for images/attachments
4. ✅ Scales from 5 to 50+ agents
5. ✅ Simple discovery (file-based registry)
6. ✅ Audit trail (messages logged to file)
7. ✅ Works on same machine (localhost)
8. ✅ Future: works remotely (just change URLs)

**Start with**: File-based (Week 3 ✅ DONE)  
**Add next**: Network layer (Week 4)  
**Result**: Production-ready multi-agent system

---

**Implementation ready!** 🚀
