# Society Agent

Standalone multi-agent orchestration system for managing AI agents.

## Features

- **Project-based organization**: Each project has its own workspace and agents
- **Agent management**: Create, configure, and monitor AI agents
- **Real-time chat**: Interactive conversations with agents via web UI
- **File explorer**: Browse and view files in agent workspaces
- **Knowledge management**: Persistent memory and context for agents

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
│   ├── project-store.ts    # Project persistence
│   └── ...
├── public/                 # Web UI
│   ├── index.html          # Main dashboard
│   ├── project.html        # Project view
│   └── agent.html          # Agent chat interface
├── __tests__/              # Test files
└── projects/               # Agent workspaces (created at runtime)
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

## License

MIT
