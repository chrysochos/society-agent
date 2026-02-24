# Society Agent System Objects Reference

> **Purpose**: Document all core system data structures for agent knowledge
> **Last Updated**: 2026-02-23

---

## 📊 Heartbeats

**What**: Real-time agent status tracking for the UI and monitoring.

**API Endpoint**: `GET /api/projects/:id/heartbeats`

**Structure**:
```typescript
{
  agentId: string       // Agent's unique ID
  status: string        // "idle" | "working" | "offline" | "blocked" | "waiting-for-boss"
  lastActiveAt: string  // ISO timestamp of last activity
}
```

**Status Values**:
| Status | Meaning |
|--------|---------|
| `idle` | Agent is active but not currently processing |
| `working` | Agent is actively processing a task |
| `offline` | No heartbeat for >2 minutes |
| `blocked` | Agent is blocked waiting for something |
| `waiting-for-boss` | Agent needs supervisor approval |

**Note**: Heartbeats are derived from `agent.lastActiveAt` and `activeAgents` map on the server.

---

## ⏰ Scheduled Tasks

**What**: Autonomous periodic work that runs on a cron schedule. Two types: AI tasks (use LLM) and Command tasks (shell commands, no tokens).

**Stored in**: `ProjectAgentConfig.scheduledTasks[]`

**Structure**:
```typescript
interface ScheduledTask {
  id: string              // Unique task ID
  name: string            // Human-readable name
  type: "ai" | "command"  // Task type
  
  // For type="ai" - uses LLM tokens
  prompt?: string         // What the agent should do
  
  // For type="command" - FREE, no tokens
  command?: string        // Shell command to run in agent's home folder
  
  cron: string            // Cron expression (e.g., "0 9 * * *" = 9am daily)
  enabled: boolean        // Whether schedule is active
  
  // Status tracking
  lastRunAt?: string      // ISO timestamp
  nextRunAt?: string      // Calculated next run
  lastRunStatus?: "success" | "failed" | "running"
  lastError?: string      // Error from last run
  lastOutput?: string     // Output from command type
  runCount: number        // Total runs
  createdAt: string       // When created
}
```

**Task Types**:
| Type | Cost | Use Case |
|------|------|----------|
| `ai` | LLM tokens | Complex decisions, analysis, file generation |
| `command` | FREE | Builds, backups, git pulls, health checks |

**Cron Examples**:
- `0 9 * * *` - Daily at 9am
- `0,30 * * * *` - Every 30 minutes
- `0 */2 * * *` - Every 2 hours
- `0 9 * * 1` - Every Monday at 9am

---

## 📋 Task Pool (Delegated Tasks)

**What**: Tasks in the project queue waiting to be claimed by workers.

**Stored in**: `Project.tasks[]`

**API Endpoint**: `GET /api/projects/:id/tasks`

**Structure**:
```typescript
interface Task {
  id: string
  title: string
  description: string
  priority: number               // Higher = more urgent
  status: "available" | "claimed" | "in-progress" | "completed" | "failed"
  
  // Ownership
  createdBy: string              // Agent that created this task
  assignedTo?: string            // Specific agent (null = open pool)
  claimedBy?: string             // Worker that claimed it
  claimedAt?: string
  
  // Hierarchy
  parentTaskId?: string          // For task breakdown
  urgency?: "normal" | "urgent" | "critical"
  
  // Context for execution
  context: {
    projectId: string
    projectKnowledge: string
    relevantFiles: string[]
    additionalContext?: string
  }
  
  // Results
  result?: {
    filesCreated: string[]
    filesModified: string[]
    summary: string
  }
  error?: string
  
  // Timestamps
  createdAt: string
  completedAt?: string
}
```

**Status Flow**:
```
available → claimed → in-progress → completed
                   ↘              ↘ failed
```

---

## 👤 Agent Configuration

**What**: Full agent definition within a project.

**Stored in**: `Project.agents[]`

**Structure**:
```typescript
interface ProjectAgentConfig {
  id: string              // Unique agent ID
  name: string            // Display name
  role: string            // Role description
  systemPrompt?: string   // Personality/expertise
  homeFolder: string      // Working directory (relative to project)
  
  // LLM settings
  provider?: string       // Override server default
  model?: string          // Override server default
  
  // Lifecycle
  ephemeral?: boolean     // Temporary worker (deleted after task)
  createdBy?: string      // Who spawned this agent
  lastActiveAt?: string
  memorySummary?: string  // Past conversation summary
  
  // Hierarchy
  reportsTo?: string      // Boss agent ID (null = top-level)
  scope?: string          // Domain owned (e.g., "backend", "frontend")
  
  // Server (if applicable)
  port?: number
  serverType?: "frontend" | "backend" | "api" | "database" | "none"
  
  // Permissions
  permissions?: {
    canDeleteFiles?: boolean      // Default: false
    canRunCommands?: boolean      // Default: false
    canOverwriteFiles?: boolean   // Default: true
    canSpawnWorkers?: boolean     // Default: true for supervisors
    canMessageAgents?: boolean    // Default: true
    canCreateAgents?: boolean     // Default: false
  }
  
  // Inherited folders from retired agents
  inheritedFolders?: Array<{
    path: string
    fromAgent: string
    inheritedAt: string
    reason: string
  }>
  
  // Scheduled autonomous work
  scheduledTasks?: ScheduledTask[]
  
  // Granted permissions from others
  grantedPermissions?: Array<{
    fromAgentId: string
    operations: string[]
    permanent: boolean
    grantedAt: string
    grantedBy: string
    scope?: string
  }>
}
```

---

## 📁 Project

**What**: The primary organizing unit. Contains agents, tasks, knowledge.

**Structure**:
```typescript
interface Project {
  id: string              // Unique ID (also folder name)
  name: string            // Display name
  description: string
  folder: string          // Path relative to projects/
  knowledge: string       // Shared knowledge
  
  agents: ProjectAgentConfig[]
  tasks: Task[]           // Task pool
  maxConcurrentWorkers: number  // Default: 3
  
  status: "active" | "archived" | "paused"
  
  // Git integration
  gitConfig?: {
    url: string           // Repository URL
    defaultRef: string    // Default branch
    currentRef?: string   // Checked out ref
    credentialId?: string // Auth credential
    lastSyncedAt?: string
    cloneStatus?: "pending" | "cloning" | "ready" | "error"
    cloneError?: string
  }
  
  createdAt: string
  updatedAt: string
}
```

---

## 🔐 Credentials

**What**: Stored authentication tokens for Git providers.

**Stored in**: `projects/.society/credentials.json`

**Structure**:
```typescript
interface Credential {
  id: string              // UUID
  name: string            // Display name (e.g., "GitLab Token")
  type: "token" | "ssh"   // Auth type
  host: string            // e.g., "gitlab.com" or "192.168.10.136"
  secret: string          // The actual token (encrypted at rest)
  createdAt: string
  lastUsedAt?: string
}
```

**API Endpoints**:
- `GET /api/credentials` - List all
- `POST /api/credentials` - Add new
- `DELETE /api/credentials/:id` - Remove
- `GET /api/credentials/:id/namespaces` - Get GitLab namespaces

---

## ✅ Approval Requests

**What**: Pending permission requests needing supervisor/human approval.

**Stored in**: `projects/.society/approvals.json`

**Structure**:
```typescript
interface ApprovalRequest {
  id: string
  projectId: string
  targetAgentId: string      // Agent who needs to act
  requestingAgentId: string  // Agent who made request
  approverAgentId: string | "human"  // Who must approve
  
  operation: string          // "delete_file", "run_command", etc.
  operationDetails: {
    originalRequest: string
    parameters?: Record<string, any>
  }
  
  status: "pending" | "approved" | "denied" | "escalated"
  summary: string
  createdAt: string
  resolvedAt?: string
}
```

---

## 🔗 Key Relationships

```
Project
  ├── agents[] ──────────────> ProjectAgentConfig
  │                               ├── scheduledTasks[] ──> ScheduledTask
  │                               └── grantedPermissions[]
  ├── tasks[] ───────────────> Task (pool)
  └── gitConfig ─────────────> Credential (via credentialId)

Heartbeats ← derived from agents + activeAgents map

ApprovalRequest ← links project, agents, operations
```

---

## 📡 API Quick Reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/projects` | GET | List all projects |
| `/api/projects/:id` | GET | Get project with agents |
| `/api/projects/:id/heartbeats` | GET | Agent status |
| `/api/projects/:id/tasks` | GET | Task pool |
| `/api/projects/:id/approvals` | GET | Pending approvals |
| `/api/credentials` | GET/POST | Manage credentials |
| `/api/projects/:id/git/push-to-gitlab` | POST | Push to GitLab |

---

*This document is part of the Mind-Tool knowledge system. Keep it updated when system structures change.*
