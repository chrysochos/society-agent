# Browser-Based Terminal for Society Agent

> **Feature**: Interactive terminal accessible from web browser  
> **Status**: Implemented  
> **Date**: February 1, 2026

---

## Overview

The Society Agent system now includes a **full-featured interactive terminal** accessible through the web browser, eliminating the need for a local IDE terminal.

### Key Features

✅ **Real-time command execution** - Run shell commands from the browser  
✅ **Live output streaming** - See command output in real-time via WebSocket  
✅ **Command history** - Use ↑/↓ arrows to navigate previous commands  
✅ **Multiple sessions** - Support for multiple terminal instances  
✅ **Project context** - Commands run in project working directory  
✅ **Security** - Dangerous commands are blocked  
✅ **Kill commands** - Ctrl+C to interrupt running commands

---

## Architecture

### Components

```
Browser (Frontend)
  └── InteractiveTerminal.tsx
      ├── xterm.js (terminal emulator)
      └── Socket.IO (WebSocket client)
           ↓
Server (Backend)
  └── society-server.ts
      ├── Terminal API endpoints
      └── WebSocket events
           ↓
CommandExecutor
  └── Executes shell commands
  └── Streams output
  └── Manages process lifecycle
```

### Data Flow

```
User types command in browser
    ↓
POST /api/terminal/execute { command, cwd }
    ↓
CommandExecutor spawns process
    ↓
Output streams via WebSocket
    ↓
terminal-output events → Browser
    ↓
xterm.js displays output
    ↓
Process exits
    ↓
terminal-exit event → Browser
    ↓
Show exit code, prompt for next command
```

---

## API Endpoints

### POST /api/terminal/execute

Execute a shell command.

**Request:**

```json
{
	"command": "ls -la",
	"cwd": "/home/user/.kilocode/workspaces/user-abc/projects/my-app",
	"projectId": "project-123"
}
```

**Response:**

```json
{
	"success": true,
	"commandId": "cmd-1706832000000",
	"exitCode": 0,
	"output": ["total 24", "drwxr-xr-x  5 user  staff   160 Feb  1 10:00 ."]
}
```

**WebSocket Events (during execution):**

```javascript
// Output chunk
{
  "event": "terminal-output",
  "data": {
    "commandId": "cmd-1706832000000",
    "data": "file1.txt\nfile2.txt\n",
    "type": "stdout",
    "timestamp": 1706832001000
  }
}

// Command completed
{
  "event": "terminal-exit",
  "data": {
    "commandId": "cmd-1706832000000",
    "exitCode": 0,
    "timestamp": 1706832002000
  }
}
```

### POST /api/terminal/kill

Kill a running command.

**Request:**

```json
{
	"commandId": "cmd-1706832000000"
}
```

**Response:**

```json
{
	"success": true,
	"commandId": "cmd-1706832000000"
}
```

### GET /api/terminal/history

Get command execution history.

**Query Parameters:**

- `limit` (optional): Max number of results

**Response:**

```json
{
	"history": [
		{
			"id": "cmd-1706832000000",
			"command": "npm install",
			"cwd": "/path/to/project",
			"status": "success",
			"exitCode": 0,
			"output": ["..."],
			"startedAt": 1706832000000,
			"finishedAt": 1706832005000
		}
	]
}
```

### GET /api/terminal/running

Get currently running commands.

**Response:**

```json
{
	"running": ["cmd-1706832000000", "cmd-1706832010000"]
}
```

---

## Usage Examples

### Basic Command Execution

```typescript
// Execute a simple command
const response = await fetch("http://localhost:3000/api/terminal/execute", {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({
		command: "echo 'Hello World'",
		cwd: "/workspace",
	}),
})

const result = await response.json()
console.log(result.output) // ["Hello World"]
```

### Long-Running Commands with Live Output

```typescript
import { io } from "socket.io-client"

const socket = io("http://localhost:3000")

// Listen for output
socket.on("terminal-output", (data) => {
	console.log("Output:", data.data)
})

// Listen for completion
socket.on("terminal-exit", (data) => {
	console.log("Exit code:", data.exitCode)
})

// Execute command
await fetch("http://localhost:3000/api/terminal/execute", {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({
		command: "npm install",
		cwd: "/path/to/project",
	}),
})
```

### Kill Running Command

```typescript
// Get running commands
const runningResponse = await fetch("http://localhost:3000/api/terminal/running")
const { running } = await runningResponse.json()

// Kill the first one
if (running.length > 0) {
	await fetch("http://localhost:3000/api/terminal/kill", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			commandId: running[0],
		}),
	})
}
```

---

## Frontend Component Usage

### Interactive Terminal Component

```tsx
import { InteractiveTerminal } from "./components/society-agent/InteractiveTerminal"

function MyApp() {
	return (
		<InteractiveTerminal
			projectId="project-123"
			cwd="/home/user/.kilocode/workspaces/user-abc/projects/my-app"
			onCommandExecute={(command) => {
				console.log("Executed:", command)
			}}
		/>
	)
}
```

### Features

1. **Command History**: Press ↑/↓ to navigate
2. **Copy/Paste**: Standard Ctrl+C/V works
3. **Interrupt**: Ctrl+C sends SIGTERM
4. **Clear**: Click 🗑️ button or type `clear`
5. **Auto-resize**: Terminal fits window size

---

## Security Considerations

### Blocked Commands

The following patterns are blocked for safety:

- `rm -rf /`
- `mkfs`
- `dd if=/dev/zero`
- Fork bombs: `:(){ :|:& };:`

### Working Directory Validation

- Directory existence is verified before execution
- Only directories within allowed paths are accessible
- Project isolation prevents cross-project access

### Command Timeout

- Default timeout: 60 seconds
- Configurable per-command
- Prevents runaway processes

---

## Integration with Workspace Architecture

### Project-Scoped Terminals

When integrated with the workspace architecture:

```typescript
// Terminal runs commands in project directory
const projectPath = "/home/user/.kilocode/workspaces/user-abc/projects/my-app"

await fetch("/api/terminal/execute", {
	method: "POST",
	body: JSON.stringify({
		command: "npm run build",
		cwd: projectPath,
		projectId: "my-app",
	}),
})
```

### Multi-Project Support

```
User has 3 projects:
  ├── Project A → Terminal 1 (cwd: /.../ projects/project-a)
  ├── Project B → Terminal 2 (cwd: /.../projects/project-b)
  └── Project C → Terminal 3 (cwd: /.../projects/project-c)

Each terminal is isolated to its project workspace.
```

---

## Future Enhancements

### Planned Features

1. **Tab Completion**: Intelligent command/path completion
2. **Syntax Highlighting**: Color-code command syntax
3. **File Browser Integration**: Click files to open in editor
4. **Command Suggestions**: AI-powered command suggestions
5. **Terminal Themes**: Customizable color schemes
6. **Split Terminals**: Multiple terminals side-by-side
7. **Persistent Sessions**: Resume terminals after refresh
8. **Agent Terminals**: Separate terminal per agent

### Advanced Use Cases

1. **Agent Command Execution**: Agents can run commands programmatically
2. **Build Monitoring**: Watch build output in real-time
3. **Log Tailing**: Monitor application logs
4. **Interactive Debugging**: Debug applications from browser
5. **Deployment**: Deploy apps directly from terminal

---

## Troubleshooting

### Terminal Not Connecting

**Problem**: Terminal shows "Disconnected"

**Solution**:

- Check server is running: `pnpm server:dev`
- Verify WebSocket port 3000 is open
- Check browser console for errors

### Commands Not Executing

**Problem**: Commands don't run

**Solution**:

- Verify working directory exists
- Check command is not blocked (dangerous commands)
- Ensure proper permissions

### Output Not Streaming

**Problem**: No real-time output

**Solution**:

- Check WebSocket connection
- Verify socket.io events are being received
- Check network tab in browser DevTools

---

## Example Commands

### Common Tasks

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build project
npm run build

# Run tests
npm test

# Check Git status
git status

# Create new file
touch index.html

# View file contents
cat package.json

# List directory
ls -la

# Change to directory
cd src/

# Show current directory
pwd
```

---

## Implementation Files

### Backend

- `/workspace/src/services/society-agent/command-executor.ts` (170 lines)
- `/workspace/src/api/society-server.ts` (+ 150 lines for terminal endpoints)

### Frontend

- `/workspace/webview-ui/src/components/society-agent/InteractiveTerminal.tsx` (300 lines)
- `/workspace/webview-ui/src/components/society-agent/InteractiveTerminal.css` (80 lines)

### Dependencies

- `xterm` - Terminal emulator
- `xterm-addon-fit` - Auto-resize addon
- `socket.io-client` - WebSocket client
- `child_process` - Command execution (Node.js)

---

## Summary

The browser-based terminal provides full IDE-like command execution capabilities through the web interface. Users can:

✅ Run any shell command  
✅ See real-time output  
✅ Navigate command history  
✅ Kill long-running processes  
✅ Work in project-specific directories  
✅ No local IDE required

This eliminates the dependency on VS Code or other IDEs, making Society Agent a fully self-contained web application.

---

**Next Step**: Integrate with workspace manager to automatically set terminal CWD to active project directory.
