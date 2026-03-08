# Society Agent

> **A multi-agent orchestration system for building AI agent teams**

Society Agent lets you create, organize, and collaborate with specialized AI agents. Build hierarchical teams where agents can delegate tasks, share knowledge, and work together on complex projects.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)

## ⚠️ Security Warning

**Agents are autonomous and can execute arbitrary code.** They have full access to the terminal, file system, and network within their environment.

**Recommended precautions:**
- Run in an **isolated environment** (VM, container, or dedicated machine)
- **Never** run on a machine with access to production systems or sensitive data
- Keep **regular backups** of important data
- Review agent actions in the chat history

*You are responsible for the environment where agents operate.*

## ✨ Features

- **🏢 Project Workspaces** - Organize agents into isolated projects with their own files and settings
- **👥 Hierarchical Teams** - Build agent org charts where leads can delegate to subordinates
- **💬 Real-time Chat** - Interactive web UI for conversations with streaming responses
- **🧠 Persistent Knowledge** - Agents maintain memory across sessions via Mind-Tool architecture
- **🔧 Skills System** - Reusable procedural knowledge agents can discover and execute
- **🔌 MCP Integration** - Connect to external services via Model Context Protocol
- **📁 File Management** - Agents have full access to their workspace with terminal capabilities
- **🌐 Multi-Provider** - Support for Anthropic, OpenRouter, OpenAI, Gemini, and more
- **📋 Decision Tracking** - Agents log architectural decisions with full audit trail and PLANNING.md generation
- **🚦 Supervisor Override** - Force unblock, reassign, cancel, or reprioritize stuck tasks
- **⚡ Real-time Updates** - Socket.IO events for live UI updates on decisions, tasks, and supervisor actions

## 🚀 Quick Start

```bash
# Clone the repository
git clone https://github.com/chrysochos/society-agent.git
cd society-agent

# Install dependencies
npm install

# Configure your API key
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY

# Start the server
npm start
```

Open **http://localhost:4000** in your browser.

## � Docker (Recommended for Isolation)

Docker provides a safe, isolated environment for running autonomous agents.

```bash
# Clone and configure
git clone https://github.com/chrysochos/society-agent.git
cd society-agent
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY

# Start with Docker Compose
docker compose up -d
```

Open **http://localhost:4000** in your browser.

### Data Persistence

The `projects/` directory is mounted as a volume - all agent workspaces, files, and knowledge persist across container restarts.

### Installing Additional Packages

Agents may need tools not included in the base image (Python, LaTeX, etc.). Two approaches:

**Option 1: Modify Dockerfile (Permanent)**

Edit `Dockerfile` to add packages, then rebuild:

```dockerfile
# Add to Dockerfile after the existing apt-get install
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    texlive-latex-base \
    && rm -rf /var/lib/apt/lists/*
```

```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```

**Option 2: Install at Runtime (Temporary)**

Install packages inside the running container - these are lost when container restarts:

```bash
docker compose exec society-agent apt-get update
docker compose exec society-agent apt-get install -y python3
```

> **Note:** Option 1 is recommended. Runtime installs (Option 2) must be repeated after every container restart.
## 🏛️ Architecture Philosophy

Society Agent models AI teams after human organizations:

**Hierarchical Structure**
- Agents form org charts with unlimited depth - from startups to enterprises
- Each agent owns a folder (their "desk") and supervises subordinates
- Supervisors can have both **persistent** agents (always available) and **ephemeral** agents (created for specific tasks)

**Communication Channels**
- Agents communicate through structured messaging
- Supervisors delegate work down, subordinates escalate issues up
- Cross-team coordination through shared knowledge systems

**Human-AI Transition**
- Every agent seat can be occupied by AI or a human
- Humans can step in to handle edge cases, then step back out
- Enables gradual transition: start with humans, add AI assistants, eventually AI-led with human oversight

```
┌─────────────────────────────────────────────────────┐
│                    Organization                      │
├─────────────────────────────────────────────────────┤
│  CEO (human/AI)                                     │
│   ├── Engineering Lead (AI)                         │
│   │    ├── Backend Team Lead (AI)                   │
│   │    │    ├── API Developer (AI)                  │
│   │    │    └── DB Specialist (AI)                  │
│   │    └── Frontend Team Lead (human)               │
│   │         └── UI Developer (AI)                   │
│   └── Operations Lead (AI)                          │
│        └── DevOps Engineer (AI)                     │
└─────────────────────────────────────────────────────┘
```
## 📖 How It Works

### Agent Teams

Each project has a **lead agent** who can have subordinates. The folder structure mirrors the org chart:

```
projects/my-startup/
├── lead/                    # Project lead - owns this folder
│   ├── MIND.md              # Lead's persistent memory
│   ├── frontend-dev/        # Reports to lead
│   ├── backend-dev/         # Reports to lead
│   │   └── db-specialist/   # Reports to backend-dev
│   └── qa-engineer/         # Reports to lead
```

Agents can:
- **Delegate tasks** to subordinates via messaging
- **Escalate issues** to their supervisor
- **Share context** through knowledge files
- **Spawn ephemeral agents** for one-off tasks

### Knowledge Architecture

Agents have three types of knowledge:

| Type | Scope | Purpose |
|------|-------|---------|
| **Mind-Tool** | Per-agent | Persistent memory, notes, and context |
| **Skills** | Global/Project | Reusable procedures (LaTeX compilation, deployments, etc.) |
| **MCP Servers** | Global/Project | External tools and APIs |

See [docs/KNOWLEDGE_ARCHITECTURE.md](docs/KNOWLEDGE_ARCHITECTURE.md) for details.

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key | Required |
| `OPENROUTER_API_KEY` | OpenRouter API key | Optional |
| `OPENAI_API_KEY` | OpenAI API key | Optional |
| `PORT` | Server port | 4000 |
| `PROJECTS_DIR` | Project storage path | ./projects |
| `API_PROVIDER` | Default provider | anthropic |

### LLM Provider Hierarchy

Models can be configured at three levels (most specific wins):

1. **Agent level** - Override for a specific agent
2. **Project level** - Override for all agents in a project  
3. **Server level** - Global default (environment variables)

Supported providers: `anthropic`, `openrouter`, `openai`, `gemini`, `deepseek`, `groq`, `mistral`

## 📁 Project Structure

```
society-agent/
├── src/                      # TypeScript source
│   ├── society-server.ts     # Express server + API
│   ├── conversation-agent.ts # LLM conversation handling
│   ├── mcp-client.ts         # MCP server connections
│   └── public/               # Web UI (HTML/CSS/JS)
├── docs/                     # Documentation
├── skills/                   # Global skills directory
├── __tests__/                # Test suite
└── projects/                 # Runtime project workspaces
```

## 🔌 API Overview

| Endpoint | Description |
|----------|-------------|
| `GET /api/projects` | List all projects |
| `POST /api/projects` | Create a new project |
| `GET /api/projects/:id` | Get project details |
| `POST /api/projects/:id/agents` | Create an agent |
| `POST /api/agent/:id/chat` | Chat with an agent |
| `GET /api/agent/:id/workspace/files` | List agent files |
| `GET /api/projects/:id/decisions` | List project decisions |
| `POST /api/projects/:id/decisions` | Create a decision |
| `POST /api/decisions/:id/accept` | Accept a proposed decision |
| `GET /api/projects/:id/blocked-tasks` | List blocked tasks |
| `POST /api/supervisor/force-unblock` | Supervisor: unblock a task |
| `POST /api/supervisor/force-reassign` | Supervisor: reassign task to another agent |

## 🛠️ Skills

Skills are user-managed procedures that agents can discover and execute. Create a skill by adding a folder with a `SKILL.md` file:

```
skills/compile-latex/
├── SKILL.md        # Metadata and description
├── compile.sh      # Implementation
└── README.md       # Usage documentation
```

Skills can be **global** (`/skills/`) or **project-specific** (`/projects/{id}/skills/`).

## 🔗 MCP Servers

Connect agents to external tools via [Model Context Protocol](https://modelcontextprotocol.io/):

```json
// mcp-config.json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "..." }
    }
  }
}
```

## 🎯 Supervisor & Decision System

### Decision Tracking

Agents can record architectural decisions with full context and rationale:

```javascript
// POST /api/projects/:id/decisions
{
  "title": "Use PostgreSQL for persistence",
  "category": "architecture",
  "proposedBy": "backend-specialist",
  "rationale": "Better performance for complex queries",
  "alternatives": ["MongoDB", "SQLite"],
  "impact": "high"
}
```

Decisions go through a lifecycle: `draft` → `proposed` → `accepted` → `implemented`. All transitions are logged with timestamps in `PLANNING.md`.

### Supervisor Override

When agents get blocked or stuck, supervisors can intervene:

| Action | Description |
|--------|-------------|
| **Force Unblock** | Unblock a task with a provided resolution |
| **Force Reassign** | Move task to a different agent |
| **Force Status** | Change task status directly |
| **Force Cancel** | Cancel a stuck task |
| **Change Priority** | Reprioritize task (critical/high/medium/low) |

### Real-time Updates

Socket.IO events broadcast all changes:

```javascript
socket.on('decision-created', (decision) => { /* ... */ });
socket.on('decision-updated', (decision) => { /* ... */ });
socket.on('task-blocked', (task) => { /* ... */ });
socket.on('task-unblocked', (task) => { /* ... */ });
socket.on('supervisor-override', (data) => { /* ... */ });
```

The agent page UI automatically updates when these events fire.

## 📚 Documentation

- [Knowledge Architecture](docs/KNOWLEDGE_ARCHITECTURE.md) - Mind-Tool, Skills, and MCP systems
- [Security Architecture](docs/SECURITY_ARCHITECTURE.md) - Permissions and sandboxing
- [System Features](docs/SYSTEM_FEATURES.md) - Detailed feature documentation

## 🧪 Development

```bash
# Run in development mode (auto-reload)
npm run dev

# Run tests
npm test

# Run tests in watch mode
npm run test:watch
```

## � History

Society Agent started in **November 2025** as an experiment in multi-agent collaboration using VS Code.

**v1 (Nov 2025)** - Built on [Kilo Code](https://kilocode.ai) VS Code extension. Each agent ran in its own VS Code instance, with file-based message passing between agents. While powerful, this approach was resource-heavy and complex to orchestrate.

**v2 (Feb 2026)** - Complete rewrite as a lightweight web server. Single Express server, agents as web pages, real-time WebSocket communication. Simpler, faster, more flexible.

The current version prioritizes:
- **Simplicity** - One server, no VS Code dependency
- **Accessibility** - Web UI works from any browser
- **Flexibility** - Easy to extend and customize

## 📄 License

[MIT](LICENSE) - Built with ❤️ for the AI agent community

