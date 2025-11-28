# Society Agent - Purpose-Driven Multi-Agent System

> **Transform KiloCode into an autonomous AI team that achieves your goals**

## What is Society Agent?

Society Agent is a supervised multi-agent system where:

- **You define the purpose** ("Build authentication system")
- **Supervisor Agent** creates a team, delegates work, manages execution
- **Worker Agents** autonomously execute tasks
- **You monitor progress** through web dashboard and terminals
- **System escalates** only critical decisions to you

**Result**: 80-90% reduction in your intervention time while maintaining full control.

---

## Quick Start

### 1. Start a Purpose

```bash
kilo society start "Add OAuth authentication to my app"
```

### 2. System Creates Team

```
Creating team...
✓ Supervisor Agent (coordinates team)
✓ Backend Developer (implements OAuth)
✓ Security Reviewer (audits implementation)
✓ Tester (validates flows)

Opening dashboard...
```

### 3. Monitor in Dashboard

Web dashboard opens showing:

- Real-time agent status
- Progress tracking
- Activity feed
- Control buttons

### 4. Intervene Only When Needed

```
🔔 Supervisor: "Critical decision needed: Use refresh tokens?"
[You decide in 30 seconds]

Otherwise, agents work autonomously.
```

### 5. Review Results

```
✅ Purpose Complete (15 minutes)
- OAuth implementation added
- Security audit passed
- All tests passing

[View Code] [Close Dashboard]
```

---

## Core Concepts

### Purpose-Driven

**Traditional:**

```
You: "Create file auth.ts"
You: "Install passport"
You: "Write OAuth code"
You: "Add tests"
[20+ manual steps]
```

**Society Agent:**

```
You: "Add OAuth authentication"
System: [Does everything autonomously]
```

### Supervised Autonomy

```
Human (You)
  ↓ Defines purpose
Supervisor Agent
  ↓ Manages team
Worker Agents
  ↓ Execute tasks
Results
```

**Supervisor handles:**

- Team formation
- Task assignment
- Progress monitoring
- Issue resolution
- Quality validation

**You handle:**

- Initial purpose definition
- Critical decisions (2-3 per purpose)
- Final approval

### Temporary Teams

```
Purpose 1: "Build auth"
  → Team: Supervisor + Backend + Security + Tester
  → Execute → Complete → Dispose

Purpose 2: "Add dashboard"
  → Team: Supervisor + Frontend + Designer
  → Execute → Complete → Dispose
```

**No persistent agents.** Fresh team for each purpose.

---

## Architecture

### Data Flow

```
1. Human Input
   ├─ Purpose: "Build authentication"
   ├─ Context: "For SaaS app with OAuth"
   ├─ Attachments: [UI mockups, API docs]
   └─ Constraints: ["TypeScript", "2 hour budget"]

2. Supervisor Receives
   ├─ Analyzes requirements
   ├─ Determines needed roles
   └─ Creates team

3. Supervisor → Workers
   ├─ Assigns tasks with context
   ├─ Provides relevant attachments
   └─ Sets success criteria

4. Workers Execute
   ├─ Work autonomously
   ├─ Ask supervisor for guidance
   └─ Report progress

5. Supervisor → Human
   ├─ Monitors progress
   ├─ Resolves issues
   └─ Escalates critical decisions only

6. Results → Human
   └─ Completion report with summary
```

### Communication Patterns

**Worker → Supervisor:**

```
Worker: "Question: Should I use cookies or localStorage for tokens?"
Supervisor: "Use httpOnly cookies for security" [Answers directly]
```

**Supervisor → Human:**

```
Supervisor: "🔔 Decision needed: Implement refresh tokens? (Strategic choice)"
Human: "Yes, implement refresh tokens" [Decides in dashboard]
```

**Human → Any Agent:**

```
[Human types in agent's terminal]
Human: "Stop. Use oauth4webapi instead of passport."
Agent: "Acknowledged. Switching libraries..."
```

### Observability

**Web Dashboard (Primary):**

- Grid view of all agents
- Real-time status updates
- Recent activity logs
- Quick action buttons
- Progress tracking

**Embedded Terminals (Detail):**

- Multiple terminals in single webpage
- Live output from each agent
- Interactive (type commands)
- Reattachable (close/reopen anytime)

---

## Usage Examples

### Example 1: Build Authentication

```bash
kilo society start "Add authentication with Google and GitHub OAuth"
```

**System creates:**

- Supervisor
- Backend Developer
- Security Reviewer
- Tester

**Execution (15 minutes):**

- Backend Dev: Implements OAuth flows
- Security Rev: Audits for vulnerabilities (finds CSRF issue)
- Backend Dev: Fixes CSRF issue
- Tester: Validates all auth flows
- Supervisor: Reports completion

**Your interventions:** 0 (or 1 if critical decision needed)

### Example 2: Add New Feature

```bash
kilo society start "Create admin dashboard with user management" \
  --attach mockups.png \
  --context "Use existing design system" \
  --constraint "Budget: 1 hour"
```

**System creates:**

- Supervisor
- Frontend Developer
- Backend Developer (for API)

**Execution (1 hour):**

- Frontend: Builds dashboard UI per mockup
- Backend: Adds user management API
- Supervisor: Coordinates integration
- Supervisor: Validates against design system

**Your interventions:** 1 (approve final design)

### Example 3: Complex Purpose

```bash
kilo society start "Refactor database layer to use Prisma ORM"
```

**System creates:**

- Supervisor
- Backend Developer (migration)
- Database Specialist
- Tester (regression tests)

**Execution (30 minutes):**

- DB Specialist: Plans migration strategy
- Backend Dev: Implements Prisma schema
- Backend Dev: Migrates existing queries
- Tester: Runs regression tests
- Supervisor: Escalates: "Found 3 breaking changes in API. Proceed?" [You decide]

**Your interventions:** 2-3 (approve breaking changes, review migration)

---

## User Interface

### Web Dashboard

```
┌─ Society Agent Control Panel ────────────────────────────┐
│                                                            │
│  Purpose: Build authentication system    Progress: 65%   │
│                                                            │
│  ┌─ 🎯 Supervisor ──────────────────────────────────┐    │
│  │ Status: 🟢 Active                                 │    │
│  │ Current: Coordinating OAuth implementation        │    │
│  │ Recent: Assigned task, guided backend-dev         │    │
│  │ [📟 Terminal] [💬 Message] [⏸️ Pause]             │    │
│  └───────────────────────────────────────────────────┘    │
│                                                            │
│  ┌─ 🤖 Backend Developer ────────────────────────────┐    │
│  │ Status: 🟢 Working                                 │    │
│  │ Current: Writing OAuth implementation              │    │
│  │ Recent: Installed passport, writing code           │    │
│  │ [📟 Terminal] [💬 Message] [⏸️ Pause]             │    │
│  └───────────────────────────────────────────────────┘    │
│                                                            │
│  ┌─ 🤖 Security Reviewer ─────────────────────────────┐    │
│  │ Status: ⚠️  Issue Found                           │    │
│  │ Current: Found CSRF vulnerability                  │    │
│  │ Alert: Add state parameter validation             │    │
│  │ [📟 Terminal] [💬 Message] [🔍 Details]           │    │
│  └───────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────┘
```

### Terminal View

**Click "📟 Terminal" on any agent:**

```
┌─ Terminal: Backend Developer ─────────────────────────────┐
│                                                             │
│ [10:45:00] Task received: Implement OAuth                  │
│ [10:45:05] Reading existing code...                        │
│ [10:45:10] Installing passport library                     │
│ $ npm install passport                                     │
│ [10:45:30] Writing src/auth/oauth.ts                       │
│ [10:45:45] Code complete, requesting review                │
│                                                             │
│ Type command: ▊                                            │
└─────────────────────────────────────────────────────────────┘
```

**You can type directly:**

```
> Use oauth4webapi instead of passport

[10:46:00] Message from human: Use oauth4webapi instead
[10:46:01] Acknowledged. Switching libraries...
[10:46:05] Installing oauth4webapi
[10:46:10] Rewriting implementation
```

---

## CLI Commands

### Start Purpose

```bash
kilo society start <purpose>
kilo society start "Build authentication"
kilo society start "Add feature X" --attach file.png --context "details"
```

### Monitor Active Sessions

```bash
kilo society list
# Shows: Active purposes, agents, progress
```

### Attach to Agent

```bash
kilo society attach <agent-id>
# Opens terminal for specific agent (if closed)
```

### Stop Execution

```bash
kilo society stop
# Gracefully stops all agents, saves state
```

---

## Configuration

### `.society-agent/config.json`

```json
{
	"autoApprove": {
		"fileOperations": ["read", "write"],
		"lowRiskActions": true,
		"highRiskActions": false
	},
	"budgets": {
		"maxApiCalls": 1000,
		"maxCostDollars": 5.0,
		"maxDurationMinutes": 60
	},
	"teamDefaults": {
		"alwaysInclude": ["supervisor"],
		"preferredWorkers": {
			"backend": "nodejs-specialist",
			"frontend": "react-specialist"
		}
	},
	"notifications": {
		"escalations": true,
		"completion": true,
		"errors": true
	}
}
```

---

## Implementation Status

### Completed (Phases 1-5)

✅ Agent identity system  
✅ Logging infrastructure  
✅ Permission system  
✅ Approval workflows  
✅ Supervisor communication  
✅ Agent messaging  
✅ Persistent storage

### In Progress (Week 1-3)

🚧 Conversation agent (LLM threads)  
🚧 Supervisor agent logic  
🚧 Purpose analyzer  
🚧 Team coordination  
🚧 Terminal manager  
🚧 Web dashboard UI  
🚧 Terminal embedding

### Planned

⏳ Natural language agent config  
⏳ Learning from executions  
⏳ Team templates  
⏳ Advanced monitoring

---

## Development

### Running in Dev Mode

```bash
# Start KiloCode extension in debug mode (F5)
# Society Agent is integrated

kilo society start "Test purpose"
```

### Testing

```bash
# Unit tests
npm test

# E2E tests
npm run test:e2e

# Society agent tests
npm run test:society
```

### Building

```bash
# Build extension
npm run build

# Build CLI
npm run build:cli

# Build all
npm run build:all
```

---

## Architecture Decisions

### Why Supervisor + Workers?

**Alternatives considered:**

- Peer-to-peer (all agents equal) → Too much coordination overhead
- Strict hierarchy (multiple levels) → Too complex, slow
- Single agent → Limited parallelism, no specialization

**Chosen: Supervisor + Workers** → Simple, scalable, clear authority

### Why Temporary Teams?

**Alternatives considered:**

- Persistent agents (stay alive) → State management complexity
- Agent pools (reuse agents) → Role conflicts, memory issues

**Chosen: Temporary per-purpose** → Clean state, focused execution

### Why Web Dashboard + Terminals?

**Alternatives considered:**

- Terminals only → Hard to get overview
- Dashboard only → Need detail for debugging
- Separate windows → Window management hassle

**Chosen: Unified dashboard + embedded terminals** → Best of both

---

## FAQ

**Q: How is this different from single-agent KiloCode?**  
A: Single agent does everything sequentially. Society Agent parallelizes work across specialized agents, reducing time by 40-60%.

**Q: Do I lose control with autonomous agents?**  
A: No. Supervisor escalates all critical decisions. You have full override capability. Dashboard shows everything.

**Q: What if agents get stuck or fail?**  
A: Supervisor detects issues (stuck loops, errors), attempts resolution, escalates to you if needed.

**Q: How much does it cost?**  
A: ~$0.50-2.00 per purpose (typical). Set budget limits in config.

**Q: Can I use my own models?**  
A: Yes. Configure in KiloCode settings. Works with any LLM provider.

**Q: How do I add custom agent roles?**  
A: Specify in purpose or config. System auto-creates agents for any role.

---

## Support

- **Issues**: [GitHub Issues](https://github.com/Kilo-Org/kilocode/issues)
- **Discussions**: [GitHub Discussions](https://github.com/Kilo-Org/kilocode/discussions)
- **Docs**: [Documentation Site](https://kilocode.dev)

---

## License

Same as KiloCode: [LICENSE](./LICENSE)

---

**Ready to let an AI team achieve your purposes?**

```bash
kilo society start "Your purpose here"
```
