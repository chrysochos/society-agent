# Society Agent

Standalone multi-agent orchestration system for managing AI agents.

## Features

- **Project-based organization**: Each project has its own workspace and agents
- **Agent management**: Create, configure, and monitor AI agents
- **Real-time chat**: Interactive conversations with agents via web UI
- **File explorer**: Browse and view files in agent workspaces
- **Knowledge management**: Persistent memory and context for agents
- **Skills system**: Reusable procedural knowledge (global and project-specific)
- **MCP integration**: Connect to external services via Model Context Protocol
- **Git management**: Agents can manage project repos with approval for push operations

## Documentation

See the [docs/](docs/) folder for detailed documentation:

- [**KNOWLEDGE_ARCHITECTURE.md**](docs/KNOWLEDGE_ARCHITECTURE.md) - Complete guide to Mind-Tool, Skills, and MCP systems

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment file and add your API key
cp .env.example .env

# Start the server
npm start
```

Open http://localhost:4000 in your browser.

## Project Structure

```
society-agent/
├── src/                    # TypeScript source files
│   ├── society-server.ts   # Main Express server
│   ├── conversation-agent.ts   # Agent LLM interface
│   ├── mcp-client.ts       # MCP server connections
│   └── ...
├── public/                 # Web UI
│   ├── index.html          # Main dashboard
│   ├── project.html        # Project view
│   └── agent.html          # Agent chat interface
├── docs/                   # Documentation
│   └── KNOWLEDGE_ARCHITECTURE.md
├── skills/                 # Global skills (user-managed)
├── mcp-config.json         # Global MCP servers
├── __tests__/              # Test files
└── projects/               # Agent workspaces (created at runtime)
    └── {project}/
        ├── skills/         # Project-specific skills
        └── mcp.json        # Project-specific MCPs
```

## API Endpoints

- `GET /` - Main dashboard
- `GET /project/:projectId` - Project view
- `GET /project/:projectId/agent/:agentId` - Agent chat
- `GET /api/projects` - List all projects
- `POST /api/projects` - Create new project
- `POST /api/agent/:agentId/chat` - Send message to agent
- `GET /api/agent/:agentId/workspace/files` - List agent files

## Configuration

Environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key | Required |
| `PORT` | Server port | 4000 |
| `PROJECTS_DIR` | Projects storage directory | ./projects |
| `ANTHROPIC_MODEL` | Model to use | claude-sonnet-4-20250514 |

## Skills

Skills are reusable capabilities that agents can discover and use. Agents can list available skills but cannot create them (user-managed only).

### Global Skills
Place skill folders in `/skills/` directory. Each skill needs a `SKILL.md` file:

```
skills/
└── compile-latex/
    ├── SKILL.md          # Metadata (name, description, version)
    ├── compile.sh        # Implementation
    └── README.md         # Usage docs
```

Example `SKILL.md`:
```markdown
---
name: compile-latex
description: Compile LaTeX documents with BibTeX support
version: 1.0
---
# Usage
Run `./compile.sh <filename>` to compile a .tex file.
```

### Project-Specific Skills
Place in `projects/{projectId}/skills/` with the same structure.

## MCP Servers

MCP (Model Context Protocol) servers extend agent capabilities with external tools. Agents can use MCPs but cannot register them (user-managed only).

### Global MCPs
Configure in `/mcp-config.json`:

```json
{
  "servers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-playwright"],
      "description": "Browser automation - navigate, click, screenshot",
      "enabled": true
    },
    "github": {
      "command": "npx", 
      "args": ["-y", "@anthropic/mcp-github"],
      "description": "GitHub API - issues, PRs, repos",
      "enabled": true
    }
  }
}
```

### Project-Specific MCPs
Configure in `projects/{projectId}/mcp.json` with the same format.

### Enable/Disable MCPs
- **Dashboard**: Go to http://localhost:4000, see "Global MCPs" in sidebar, click Enable/Disable
- **Project Page**: Open a project, see "MCP Servers" section with toggle buttons
- **API**: `POST /api/mcps/:name/toggle` or `POST /api/project/:projectId/mcps/:name/toggle`

### Available MCP Tools for Agents
Agents have these tools to interact with MCPs:
- `list_mcps()` - List available MCP servers (name + description)
- `list_mcp_tools(server)` - Get detailed tools from a specific MCP
- `use_mcp(server, tool, args)` - Execute an MCP tool

## License

MIT
