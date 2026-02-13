# Society Agent Messaging Guide

**Status**: Working System (Week 4 Complete)  
**Date**: February 10, 2026

---

## System Overview

Society Agent transforms KiloCode into a multi-agent system where multiple VS Code instances work together as specialized agents. Each agent uses the **standard KiloCode chat interface** to receive tasks and collaborate.

---

## Agent Structure

### Agent Identity

Each agent has two identifiers:

| Property     | Purpose                            | Example             | Where Used                     |
| ------------ | ---------------------------------- | ------------------- | ------------------------------ |
| **Agent ID** | Technical identifier for messaging | `backend-dev`       | CLI commands, message routing  |
| **Role**     | Human-readable job title           | `backend-developer` | VS Code status bar, UI display |

### Current Test Setup

Location: `/root/kilocode-test-workspace/.society-agent/project-plan.json`

```json
{
	"agents": [
		{
			"agentId": "supervisor-main",
			"role": "supervisor",
			"workspace": "supervisor",
			"capabilities": ["orchestration", "planning", "coordination"]
		},
		{
			"agentId": "backend-dev",
			"role": "backend-developer",
			"workspace": "backend-worker",
			"capabilities": ["api", "database", "server"]
		},
		{
			"agentId": "frontend-dev",
			"role": "frontend-developer",
			"workspace": "frontend-worker",
			"capabilities": ["react", "ui", "styling"]
		}
	]
}
```

---

## Messaging System

### Message Structure

Messages are stored in `.society-agent/messages.jsonl`:

```json
{
	"id": "msg-1770726370006-rxjfcul",
	"from": "user",
	"to": "backend-dev",
	"type": "task_assign",
	"content": "Build a REST API for authentication",
	"timestamp": "2026-02-10T12:26:10.006Z",
	"delivered": false
}
```

### Message Types

| Type            | Purpose               | Example Use Case               |
| --------------- | --------------------- | ------------------------------ |
| `message`       | General communication | "How's progress on the API?"   |
| `question`      | Request information   | "What database should we use?" |
| `task_assign`   | Assign work           | "Build the login endpoint"     |
| `task_complete` | Report completion     | "Authentication API is done"   |
| `status_update` | Share progress        | "50% complete, testing now"    |

---

## Sending Messages

### CLI Commands

```bash
# Send to specific agent (use Agent ID)
kilo society message <agent-id> "message text" --type <type>

# Examples:
kilo society message backend-dev "Create authentication API" --type task_assign
kilo society message frontend-dev "Build login form" --type task_assign
kilo society message supervisor-main "Coordinate the team" --type message

# Broadcast to all agents
kilo society broadcast "Team meeting in 5 minutes"

# Default type is 'message' if not specified
kilo society message backend-dev "How's it going?"
```

### Message Addressing Rules

**Use Agent ID for CLI commands:**

```bash
✅ kilo society message backend-dev "task"     # Correct
❌ kilo society message backend-developer "task"  # Wrong - this is the role, not ID
```

**Agent receives messages when:**

- Message `to` field matches their Agent ID (`backend-dev`)
- Message `to` field is `"broadcast"` (goes to all agents)
- Message `to` field is `"supervisor"` (if they're a supervisor)

---

## How Agents Receive Messages

### Automatic Processing

Agents poll for messages every 3 seconds:

1. **Message arrives** → Written to `.society-agent/messages.jsonl`
2. **Agent polls** → Reads undelivered messages
3. **Message appears in chat** → Injected into KiloCode chat interface
4. **Agent processes** → Uses full KiloCode capabilities to complete task
5. **Marked delivered** → Status updated in messages.jsonl

### Manual Check (Fallback)

If automatic polling doesn't work:

1. Click **`🤖 role`** status bar item (bottom right)
2. Checks for new messages
3. Opens chat and displays messages

---

## File Structure

```
project-root/
├── .society-agent/                    # Coordination directory
│   ├── project-plan.json             # Agent definitions
│   ├── registry.jsonl                # Active agents registry
│   ├── messages.jsonl                # Message queue
│   └── deliveries.jsonl              # Delivery tracking
│
├── supervisor/                        # Supervisor workspace
│   └── .vscode/
│       └── settings.json             # Agent configuration
│
├── backend-worker/                    # Backend developer workspace
│   └── .vscode/
│       └── settings.json
│
└── frontend-worker/                   # Frontend developer workspace
    └── .vscode/
        └── settings.json
```

### Agent Configuration Format

Each workspace needs `.vscode/settings.json`:

```json
{
	"kilo-code.societyAgent.agentId": "backend-dev",
	"kilo-code.societyAgent.role": "backend-developer",
	"kilo-code.societyAgent.sharedDir": "/absolute/path/.society-agent",
	"kilo-code.societyAgent.capabilities": ["api", "database", "server"]
}
```

**Critical**: Settings must use `kilo-code.` prefix for VS Code to read them correctly.

---

## Network Communication

### HTTP Servers

Each agent runs an HTTP server for real-time communication:

| Agent           | Port | URL                   |
| --------------- | ---- | --------------------- |
| supervisor-main | 3000 | http://127.0.0.1:3000 |
| backend-dev     | 3001 | http://127.0.0.1:3001 |
| frontend-dev    | 3002 | http://127.0.0.1:3002 |

### Communication Methods

**Hybrid approach:**

- **Network (HTTP)**: Fast path for online agents (<10ms)
- **File (JSONL)**: Fallback for offline agents, guaranteed delivery

Messages are:

1. First attempted via HTTP
2. Always written to `messages.jsonl` as backup
3. Polled every 3 seconds by receiving agent
4. Marked as delivered after processing

---

## Launching Agents

### From Scratch

```bash
cd /path/to/project
kilo society launch
```

This:

1. Reads `.society-agent/project-plan.json`
2. Opens VS Code for each agent with `autoLaunch: true`
3. Each VS Code auto-discovers `.society-agent/`
4. Each agent auto-configures from project plan
5. Agents start HTTP servers and register

### Prerequisites

1. **Extension installed**: `code --install-extension kilo-code-4.122.1.vsix`
2. **Project plan exists**: `.society-agent/project-plan.json`
3. **Workspace folders exist**: `supervisor/`, `backend-worker/`, etc.
4. **VS Code CLI available**: `which code` returns path

---

## Monitoring

### Check Active Agents

```bash
cat .society-agent/registry.jsonl | grep -o '"agentId":"[^"]*"' | sort -u
```

### View Message Queue

```bash
# All messages
cat .society-agent/messages.jsonl

# Undelivered messages
grep '"delivered":false' .society-agent/messages.jsonl

# Messages for specific agent
grep '"to":"backend-dev"' .society-agent/messages.jsonl
```

### Agent Status

In each VS Code window:

- **Status bar** (bottom right): `🤖 role` - Shows agent is active
- **Output panel**: View > Output > Select "KiloCode" - Shows Society Agent logs
- **Click status bar**: Manually check for messages

---

## Current Limitations (To Be Solved)

### ❌ Manual Setup Required

- Must manually create `.society-agent/project-plan.json`
- Must manually create workspace folders
- Must manually configure settings

**Solution**: Week 5 - Planning Agent with `kilo society init`

### ❌ Fixed Agent Team

- Can't easily add/remove agents
- No discussion about which agents to create

**Solution**: Week 5 - `kilo society add` and `kilo society remove` commands

### ❌ No Agent-to-Agent Responses

- Agents receive messages but don't auto-reply to each other
- No automatic collaboration workflows

**Solution**: Week 6 - Full ConversationAgent with LLM integration

### ❌ Manual Message Checking (Sometimes)

- Automatic polling works but no visual indicator
- Must click status bar if polling fails

**Solution**: Week 6 - Notification UI + persistent chat history

---

## Troubleshooting

### "No messages" when clicking status bar

**Check:**

```bash
# Verify agent ID matches
cat .vscode/settings.json | grep agentId

# Check if messages exist for that ID
grep '"to":"<your-agent-id>"' .society-agent/messages.jsonl
```

**Fix**: Ensure message is sent to correct Agent ID, not role name.

### Agent not appearing in registry

**Check:**

```bash
# Verify settings file exists and is correct
cat .vscode/settings.json
```

**Fix**: Settings must use `kilo-code.societyAgent.*` prefix.

### Extension not loading

**Check:**

```bash
# Verify extension is installed
code --list-extensions | grep kilo-code
```

**Fix**: Install extension: `code --install-extension /path/to/kilo-code.vsix --force`

### Messages marked delivered but not in chat

**Reason**: Previous runs already processed them.

**Fix**: Send fresh message with `kilo society message` command.

---

## Next Steps

### Week 5: Planning Agent (Priority)

- `kilo society init "project description"` → AI discussion
- AI analyzes and proposes agent team
- User approves/modifies
- Auto-generates project plan and structure

### Week 6: Full Autonomy

- Agents auto-respond to each other
- Supervisor coordinates workflows
- Full LLM integration for intelligent decisions
- Notification UI for message awareness

### Week 7: Production Ready

- Web dashboard for monitoring
- Multi-project support
- Agent templates
- Performance optimization

---

## Examples

### Example 1: Assign Task to Backend

```bash
kilo society message backend-dev "Create a REST API with these endpoints: POST /auth/login, POST /auth/register, GET /auth/me" --type task_assign
```

**What happens:**

1. Message written to `messages.jsonl`
2. backend-dev agent polls and finds it
3. Message appears in KiloCode chat
4. Agent starts working on the API
5. Message marked as delivered

### Example 2: Broadcast Team Announcement

```bash
kilo society broadcast "Code freeze in 1 hour for deployment"
```

**What happens:**

1. Message sent with `to: "broadcast"`
2. All agents receive it
3. Appears in each agent's chat
4. Each agent acknowledges

### Example 3: Frontend asks Backend

Currently manual (will be automatic in Week 6):

```bash
# Frontend developer asks backend
kilo society message backend-dev "What's the auth API endpoint format?" --type question
```

Backend developer sees it in chat and can:

1. Answer in their own chat
2. Send back a message: `kilo society message frontend-dev "POST /auth/login with {email, password}"`

---

## Summary

**Working Now:**

- ✅ Multi-agent setup with unique IDs and roles
- ✅ CLI messaging system
- ✅ Agents receive tasks in KiloCode chat
- ✅ Network + file-based communication
- ✅ Auto-registration and heartbeat

**Key Concepts:**

- **Agent ID**: Technical identifier for messaging
- **Role**: Human-readable display name
- **Messages**: JSONL queue with delivery tracking
- **Status Bar**: Click to manually check messages
- **Chat Integration**: Standard KiloCode interface

**Command Reference:**

```bash
kilo society message <agent-id> "text" --type <type>
kilo society broadcast "text"
kilo society launch
```

---

**Ready for Week 5: Planning Agent with AI-driven team creation!**
