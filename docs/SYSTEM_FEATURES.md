# Society Agent System Features

> **Purpose**: Complete system features documentation for development, operations, and maintenance
> **Last Updated**: 2026-02-23

---

## 🏗️ Architecture Overview

### Core Components
```
society-agent/
├── src/
│   ├── society-server.ts    # Main Express server (~8500 lines)
│   ├── project-store.ts     # Project/Agent persistence
│   ├── git-loader.ts        # Git/GitLab integration
│   ├── conversation-agent.ts # LLM agent loop
│   ├── mcp-client.ts        # MCP protocol client
│   └── public/              # Web UI (index.html, project.html)
├── projects/                # User projects folder
│   ├── .society/            # System data (credentials, approvals)
│   └── [project-folders]/   # Individual projects
└── skills/                  # Global skills
```

### Data Storage
| Data | Location | Format |
|------|----------|--------|
| Projects | `projects/.society/projects.json` | JSON |
| Credentials | `projects/.society/credentials.json` | JSON (encrypted) |
| Approvals | `projects/.society/approvals.json` | JSON |
| Agent Memory | `[project]/MEMORY.md` | Markdown |
| Agent Knowledge | `[project]/AGENTS.md`, `KNOWLEDGE.md` | Markdown |

---

## 🌐 API Endpoints Reference

### System Control
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/status` | Server status and stats |
| GET | `/api/system/state` | Paused state, active agents |
| POST | `/api/system/pause` | Pause all agents |
| POST | `/api/system/resume` | Resume all agents |

### Projects
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/projects` | List all projects |
| GET | `/api/projects/:id` | Get project with agents |
| POST | `/api/projects` | Create new project |
| PUT | `/api/projects/:id` | Update project metadata |
| DELETE | `/api/projects/:id` | Delete project |
| GET | `/api/projects/:id/heartbeats` | Agent status (idle/working/offline) |
| GET | `/api/projects/:id/tasks` | Task pool with counts |

### Agents
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/agents` | List all agents |
| GET | `/api/agent/:agentId` | Get single agent |
| POST | `/api/projects/:id/agents` | Add agent to project |
| PUT | `/api/projects/:projectId/agents/:agentId` | Update agent |
| DELETE | `/api/projects/:projectId/agents/:agentId` | Delete agent |
| POST | `/api/projects/:projectId/agents/:agentId/reset` | Reset agent memory |
| POST | `/api/agent/:agentId/chat` | Send message to agent (SSE stream) |
| GET | `/api/agent/:agentId/history` | Get conversation history |
| DELETE | `/api/agent/:agentId/history` | Clear history |

### Git Integration
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/projects/from-git` | Clone repo as new project |
| POST | `/api/projects/:id/git/init` | Initialize git in project |
| POST | `/api/projects/:id/git/pull` | Pull latest from remote |
| POST | `/api/projects/:id/git/push` | Push local changes |
| POST | `/api/projects/:id/git/checkout` | Switch branch |
| GET | `/api/projects/:id/git/status` | Git status info |
| GET | `/api/projects/:id/git/branches` | List branches |
| GET | `/api/projects/:id/git/diff` | Show uncommitted changes |
| POST | `/api/projects/:id/git/push-to-gitlab` | Create GitLab repo and push |

### Credentials
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/credentials` | List all credentials (secrets hidden) |
| POST | `/api/credentials` | Add new credential |
| DELETE | `/api/credentials/:id` | Remove credential |
| GET | `/api/credentials/:id/namespaces` | Get GitLab namespaces |

### Approvals
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/projects/:id/approvals` | All pending approvals |
| GET | `/api/projects/:id/approvals/human` | Human-only approvals |
| POST | `/api/approvals/:requestId/resolve` | Approve/deny request |

### Workspace/Files
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/workspace` | Root workspace info |
| GET | `/api/workspace/files` | List directory |
| GET | `/api/workspace/file` | Read file content |
| POST | `/api/workspace/file` | Write file |
| DELETE | `/api/workspace/file` | Delete file |
| POST | `/api/workspace/dir` | Create directory |
| POST | `/api/workspace/move` | Move/rename file |
| GET | `/api/workspace/raw` | Raw file download |

### Skills & MCPs
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/skills` | List global skills |
| GET | `/api/mcps` | List available MCPs |
| POST | `/api/mcps/:name/toggle` | Enable/disable MCP |
| GET | `/api/project/:id/skills` | Project-specific skills |
| GET | `/api/project/:id/mcps` | Project-specific MCPs |

### Terminal
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/terminal/execute` | Run shell command |
| POST | `/api/terminal/kill` | Kill running process |
| GET | `/api/terminal/history` | Command history |
| GET | `/api/terminal/running` | Running processes |

### Configuration
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/config/provider` | Current LLM provider/model |
| POST | `/api/config/provider` | Set provider/model |
| GET | `/api/config/providers` | List available providers |
| GET | `/api/settings` | All settings |
| POST | `/api/settings` | Update settings |
| POST | `/api/config/api-key` | Set API key for provider |

### Usage & Limits
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/usage` | Token usage stats |
| GET | `/api/usage/recent` | Recent usage |
| DELETE | `/api/usage` | Clear usage history |
| GET | `/api/limits` | Rate limits config |
| PUT | `/api/limits` | Update limits |
| POST | `/api/limits/reset` | Reset limits |

---

## ⏰ Scheduled Tasks Feature

### Overview
Agents can have autonomous scheduled tasks that run on cron schedules. Two types:

### Task Types

#### 1. AI Tasks (`type: "ai"`)
- **Cost**: Uses LLM tokens
- **Use cases**: Analysis, file generation, complex decisions
- **Field**: `prompt` - what the agent should do

#### 2. Command Tasks (`type: "command"`)
- **Cost**: FREE (no tokens)
- **Use cases**: Builds, backups, git operations, health checks
- **Field**: `command` - shell command to run in agent's home folder

### Cron Syntax
```
┌───────────── minute (0-59)
│ ┌─────────── hour (0-23)
│ │ ┌───────── day of month (1-31)
│ │ │ ┌─────── month (1-12)
│ │ │ │ ┌───── day of week (0-6, 0=Sunday)
│ │ │ │ │
* * * * *
```

### Common Schedules
| Cron | Meaning |
|------|---------|
| `0 9 * * *` | Daily at 9am |
| `0 */2 * * *` | Every 2 hours |
| `0,30 * * * *` | Every 30 minutes |
| `0 9 * * 1` | Every Monday at 9am |
| `0 0 1 * *` | First day of month |

### UI Location
- Project page → Agent card → Scheduled Tasks button
- Shows task list with enable/disable toggles
- "Add Task" modal for creating new tasks

---

## 👁️ Heartbeats (Agent Status Monitoring)

### Status Values
| Status | Meaning | Calculation |
|--------|---------|-------------|
| `idle` | Active but not processing | Has recent heartbeat, not in activeAgents |
| `working` | Currently processing | In activeAgents map |
| `offline` | No recent activity | lastActiveAt > 2 minutes ago |
| `blocked` | Waiting for resource | Set by agent |
| `waiting-for-boss` | Needs approval | Set when approval pending |

### API
```
GET /api/projects/:id/heartbeats
Response: [{ agentId, status, lastActiveAt }]
```

### UI
- Colored indicator on agent cards
- Real-time updates via Socket.IO

---

## 📋 Task Pool System

### Purpose
Supervisors can create tasks that workers claim and execute.

### Task Lifecycle
```
available → claimed → in-progress → completed
                   ↘              ↘ failed
```

### Task Priority
Higher number = more urgent. Workers should claim highest priority first.

### Task Assignment
- `assignedTo: null` - Open pool, any worker can claim
- `assignedTo: "agent-id"` - Only that agent can claim

---

## 🔐 Permissions System

### Agent Permissions
```typescript
permissions: {
  canDeleteFiles: false,      // Dangerous - requires approval
  canRunCommands: false,      // Dangerous - requires approval
  canOverwriteFiles: true,    // Usually safe
  canSpawnWorkers: true,      // Supervisors only
  canMessageAgents: true,     // Inter-agent communication
  canCreateAgents: false,     // Admin only
}
```

### Approval Flow
1. Agent attempts restricted operation
2. Creates ApprovalRequest
3. Routes to supervisor (or human for top-level)
4. Approver approves/denies
5. If approved, operation proceeds

---

## 🔗 Git Integration

### Credential Types
- **Token**: Personal Access Token (GitLab, GitHub)
- **SSH**: SSH key pair (future)

### Protocol Detection
- IP addresses → `http://`
- Domains → `https://`

### Push to GitLab Flow
1. Select credential
2. Choose namespace (or leave empty for personal)
3. Enter repo name
4. Creates repo via GitLab API
5. Initializes local git (if needed)
6. Pushes with token auth

### URL Conversion for Push
SSH URLs are converted to HTTPS with token:
```
git@host:user/repo.git → http://oauth2:TOKEN@host/user/repo.git
```

---

## 🛠️ Skills System

### Skill Structure
```
skills/
  skill-name/
    SKILL.md      # YAML frontmatter + instructions
    context.md    # Optional context
    script.sh     # Optional executable
```

### SKILL.md Format
```yaml
---
trigger: /skill-name
description: What this skill does
---

Instructions for the agent to follow...
```

### Built-in Skills
- `/compile-latex` - Full LaTeX + BibTeX compilation

---

## 🔌 MCP (Model Context Protocol)

### Configuration
`mcp-config.json` at project root

### Per-Project MCPs
Projects can enable/disable MCPs independently.

### Available MCPs
Depends on configuration - common ones:
- File system access
- Web browsing
- Database access
- External APIs

---

## 📡 Real-time Events (Socket.IO)

### Event Types
| Event | Data | Purpose |
|-------|------|---------|
| `heartbeat` | `{agentId, status}` | Agent status update |
| `task-claimed` | `{taskId, agentId}` | Worker claimed task |
| `task-completed` | `{taskId, result}` | Task finished |
| `task-failed` | `{taskId, error}` | Task errored |
| `system-event` | `{type, ...}` | General system events |
| `agent-message` | `{from, to, content}` | Inter-agent communication |

---

## 🖥️ Web UI Pages

### Main Pages
- `/` - Projects list (`index.html`)
- `/project/:id` - Project details (`project.html`)
- `/chat/:agentId` - Agent chat interface

### Key UI Components

#### index.html
- Project cards with status
- Create project modal
- Clone from Git modal
- Push to GitLab modal
- Credentials management

#### project.html
- Agent hierarchy tree
- Task pool panel
- File browser
- Approvals panel
- Settings tab
- Scheduled tasks modal
- Git operations buttons

---

## 🔧 Operations Guide

### Starting the Server
```bash
npx tsx src/society-server.ts
# Or
npm run dev
```

### Default Port
- `4000` (or `PORT` env var)

### Health Check
```bash
curl http://localhost:4000/api/status
```

### Common Operations

#### Restart Server
```bash
pkill -f "tsx.*society-server"; sleep 2; npx tsx src/society-server.ts &
```

#### Check Running Processes
```bash
lsof -i :4000
```

#### Test API
```bash
curl -s http://localhost:4000/api/projects | jq .
```

---

## 🐛 Troubleshooting

### Server Not Responding
1. Check if process is running: `lsof -i :4000`
2. Kill stale processes: `pkill -f tsx`
3. Restart: `npx tsx src/society-server.ts`

### API Returns HTML Instead of JSON
- Usually means 404 - endpoint doesn't exist
- Check endpoint path and method

### GitLab Push Fails
1. Check credential has `api` scope
2. Verify protocol (http vs https for IP)
3. Check namespace exists
4. Repo name might already exist

### Agent Shows "Offline"
- `lastActiveAt` is > 2 minutes old
- Start a chat to wake the agent

---

## 📊 Monitoring

### Key Metrics
- Active agents count
- Token usage per agent
- Task completion rate
- Error rate

### Log Locations
- Server console output
- Browser DevTools console
- `execution.log` (if enabled)

---

*This document should be updated whenever system features change.*
