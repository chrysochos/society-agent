# Society Agent

> **A multi-agent orchestration system for building AI agent teams**

Society Agent lets you create, organize, and collaborate with specialized AI agents. Build hierarchical teams where agents can delegate tasks, share knowledge, and work together on complex projects.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)

## ✨ Features

- **🏢 Project Workspaces** - Organize agents into isolated projects with their own files and settings
- **👥 Hierarchical Teams** - Build agent org charts where leads can delegate to subordinates
- **💬 Real-time Chat** - Interactive web UI for conversations with streaming responses
- **🧠 Persistent Knowledge** - Agents maintain memory across sessions via Mind-Tool architecture
- **🔧 Skills System** - Reusable procedural knowledge agents can discover and execute
- **🔌 MCP Integration** - Connect to external services via Model Context Protocol
- **📁 File Management** - Agents have full access to their workspace with terminal capabilities
- **🌐 Multi-Provider** - Support for Anthropic, OpenRouter, OpenAI, Gemini, and more

## 🚀 Quick Start

```bash
# Clone the repository
git clone https://github.com/yourusername/society-agent.git
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

## 📖 How It Works

### Agent Teams

Society Agent uses a hierarchical team structure. Each project has a **lead agent** who can have subordinates:

```
projects/my-startup/
├── lead/                    # Project lead - the main contact
│   ├── frontend-dev/        # Reports to lead
│   ├── backend-dev/         # Reports to lead
│   │   └── db-specialist/   # Reports to backend-dev
│   └── qa-engineer/         # Reports to lead
```

Agents can:
- **Delegate tasks** to their subordinates
- **Escalate issues** to their supervisor
- **Share context** through the knowledge system

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

## 📄 License

[MIT](LICENSE) - Built with ❤️ for the AI agent community
