# Society Agent Quick Reference

## Send Messages

```bash
# Task assignment
kilo society message backend-dev "Build authentication API" --type task_assign

# Question
kilo society message frontend-dev "What UI library are you using?" --type question

# General message
kilo society message supervisor-main "Status update needed"

# Broadcast to all
kilo society broadcast "Team meeting now"
```

## Agent Identifiers

| Agent ID          | Role               | Use in CLI |
| ----------------- | ------------------ | ---------- |
| `backend-dev`     | backend-developer  | ✅         |
| `frontend-dev`    | frontend-developer | ✅         |
| `supervisor-main` | supervisor         | ✅         |

**Rule**: Use **Agent ID** in CLI, see **Role** in VS Code UI

## Check Messages

**In VS Code**: Click `🤖 role` status bar (bottom right)

**From CLI**:

```bash
# View all messages
cat .society-agent/messages.jsonl

# View undelivered
grep '"delivered":false' .society-agent/messages.jsonl
```

## Launch Agents

```bash
cd /path/to/project
kilo society launch
```

## Files

- `.society-agent/project-plan.json` - Agent definitions
- `.society-agent/messages.jsonl` - Message queue
- `.society-agent/registry.jsonl` - Active agents
- `<workspace>/.vscode/settings.json` - Agent config

## Troubleshooting

| Problem               | Solution                                  |
| --------------------- | ----------------------------------------- |
| No messages           | Check agent ID matches in CLI             |
| Agent not registering | Verify settings use `kilo-code.` prefix   |
| Chat empty            | Click status bar to check manually        |
| Extension not loading | `code --install-extension kilo-code.vsix` |

---

**Full documentation**: See `SOCIETY_AGENT_MESSAGING_GUIDE.md`
