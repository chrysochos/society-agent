# Society Agent - Multi-Page Webview Architecture

**Date**: January 31, 2026  
**Purpose**: Design individual agent monitoring pages

---

## Current State

- ✅ Main Dashboard exists (`Dashboard.tsx`)
- ✅ Agent Cards exist (`AgentCard.tsx`)
- ❌ No way to drill-down into individual agent details

---

## Proposed Multi-Page System

### Architecture

```
SocietyAgentProvider (Backend)
    ↓
    ├─ WebviewView (Single webview instance)
    │   ↓
    └─ App Router (React component)
        ├─ Page 1: Dashboard
        │   └─ Agent Cards (clickable)
        ├─ Page 2: Agent Detail
        │   ├─ Agent Identity
        │   ├─ Current Task
        │   ├─ Action History (live)
        │   ├─ Logs/Output
        │   └─ Control Buttons
        └─ Page 3: Settings/Config (future)
```

### Key Features

#### Page 1: Main Dashboard (Current)

```
Purpose: "Review authentication code"
Progress: [████████░░] 80%

Active Agents (3):
┌────────────────────────────────────────┐
│ 🤖 supervisor-1      [Monitoring]     │ ← Click to view details
│    3 workers managed                   │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│ 🔧 worker-backend-1  [Working] 65%    │ ← Click to view details
│    Reviewing auth.ts (1m 23s)         │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│ 🛡️ worker-security-1 [Working] 40%    │ ← Click to view details
│    Security audit (30s)               │
└────────────────────────────────────────┘
```

#### Page 2: Agent Detail View (NEW)

```
┌─────────────────────────────────────────────────────────────┐
│ ← Back to Dashboard                                          │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Agent: worker-backend-1                                     │
│  Role: worker | Domain: backend | Status: Working            │
│                                                               │
│  ┌───────────────────────────────────────────────────────┐   │
│  │ Current Task                                            │   │
│  ├───────────────────────────────────────────────────────┤   │
│  │ Reviewing auth.ts                                       │   │
│  │ Progress: [████████░░] 65% (65/100 actions)           │   │
│  │ Started: 2m 15s ago                                     │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌───────────────────────────────────────────────────────┐   │
│  │ Recent Actions (Last 20)                               │   │
│  ├───────────────────────────────────────────────────────┤   │
│  │ 14:32:50 - file-read: auth.ts (1.2 KB)               │   │
│  │ 14:32:45 - analysis: Found 3 potential issues        │   │
│  │ 14:32:42 - api-call: Check OWASP standards           │   │
│  │ 14:32:38 - file-read: user.ts (2.1 KB)              │   │
│  │ 14:32:35 - analysis: Checking password hashing       │   │
│  │ [Show More...]                                         │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌───────────────────────────────────────────────────────┐   │
│  │ Live Output                                             │   │
│  ├───────────────────────────────────────────────────────┤   │
│  │ > Found potential SQL injection on line 45            │   │
│  │ > Checking bcrypt implementation...                    │   │
│  │ > Warning: Not using prepared statements              │   │
│  │ > Recommendations: Use parameterized queries          │   │
│  │ > Status: 65% complete                                │   │
│  │ [Auto-scroll enabled] [Download Logs]                 │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌───────────────────────────────────────────────────────┐   │
│  │ Agent Stats                                             │   │
│  ├───────────────────────────────────────────────────────┤   │
│  │ Actions Taken: 65/100                                 │   │
│  │ Files Read: 2                                         │   │
│  │ Files Written: 0                                      │   │
│  │ API Calls: 1                                          │   │
│  │ Errors: 0                                             │   │
│  │ Tokens Used: 12,450 / 500,000                         │   │
│  │ Cost Estimate: $0.62                                  │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                               │
│  [Pause Agent] [Stop Agent] [Send Message] [Download Logs]  │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Files

### 1. React Router Component

```typescript
// File: webview-ui/src/components/society-agent/SocietyAgentApp.tsx
// NEW - Router for navigation

import React, { useState } from "react"
import { Dashboard } from "./Dashboard"
import { AgentDetailView } from "./AgentDetailView"  // NEW

type ViewType = "dashboard" | "agent-detail"

interface SocietyAgentAppState {
    view: ViewType
    selectedAgentId?: string
}

export const SocietyAgentApp: React.FC = () => {
    const [state, setState] = useState<SocietyAgentAppState>({
        view: "dashboard"
    })

    // Navigation functions
    const goToDashboard = () => {
        setState({ view: "dashboard" })
    }

    const goToAgentDetail = (agentId: string) => {
        setState({ view: "agent-detail", selectedAgentId: agentId })
    }

    return (
        <div className="society-agent-app">
            {state.view === "dashboard" && (
                <Dashboard onAgentClick={goToAgentDetail} />
            )}
            {state.view === "agent-detail" && state.selectedAgentId && (
                <AgentDetailView
                    agentId={state.selectedAgentId}
                    onBack={goToDashboard}
                />
            )}
        </div>
    )
}
```

### 2. New Agent Detail View Component

```typescript
// File: webview-ui/src/components/society-agent/AgentDetailView.tsx
// NEW - Individual agent monitoring

import React, { useState, useEffect } from "react"
import { AgentState } from "./types"
import "./AgentDetailView.css"

interface AgentDetailViewProps {
    agentId: string
    onBack: () => void
}

export const AgentDetailView: React.FC<AgentDetailViewProps> = ({
    agentId,
    onBack
}) => {
    const [agent, setAgent] = useState<AgentState | null>(null)
    const [actions, setActions] = useState<any[]>([])
    const [logs, setLogs] = useState<string[]>([])
    const [autoScroll, setAutoScroll] = useState(true)

    // Listen for agent status updates
    useEffect(() => {
        const listener = (e: MessageEvent) => {
            const message = e.data

            if (message.type === "agent-status-update" && message.agentId === agentId) {
                setAgent(message.agent)
            }

            if (message.type === "agent-action" && message.agentId === agentId) {
                setActions(prev => [message.action, ...prev.slice(0, 19)])
            }

            if (message.type === "agent-log" && message.agentId === agentId) {
                setLogs(prev => [...prev, message.log].slice(-100))
            }
        }

        window.addEventListener("message", listener)
        return () => window.removeEventListener("message", listener)
    }, [agentId])

    return (
        <div className="agent-detail-view">
            {/* Header with back button */}
            <div className="header">
                <button className="back-button" onClick={onBack}>
                    ← Back to Dashboard
                </button>
                <h2>{agent?.name}</h2>
            </div>

            {/* Agent Info */}
            <div className="agent-info">
                <span className="role">{agent?.role}</span>
                <span className="status">{agent?.status}</span>
                {agent?.task && <span className="task">{agent.task}</span>}
            </div>

            {/* Current Task */}
            {agent?.task && (
                <div className="current-task">
                    <h3>Current Task</h3>
                    <div className="task-description">{agent.task}</div>
                    <div className="progress-bar">
                        <div className="progress" style={{ width: `${agent.progress}%` }}></div>
                    </div>
                    <div className="progress-text">
                        {agent.progress}% complete ({agent.actionCount}/100 actions)
                    </div>
                </div>
            )}

            {/* Recent Actions */}
            <div className="recent-actions">
                <h3>Recent Actions</h3>
                <div className="actions-list">
                    {actions.map((action, i) => (
                        <div key={i} className="action-item">
                            <span className="time">{new Date(action.timestamp).toLocaleTimeString()}</span>
                            <span className="type">{action.action}</span>
                            <span className="detail">{action.detail}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Live Output/Logs */}
            <div className="live-output">
                <div className="header-with-controls">
                    <h3>Live Output</h3>
                    <label>
                        <input
                            type="checkbox"
                            checked={autoScroll}
                            onChange={(e) => setAutoScroll(e.target.checked)}
                        />
                        Auto-scroll
                    </label>
                    <button onClick={() => downloadLogs(agentId, logs)}>
                        📥 Download Logs
                    </button>
                </div>
                <div className="logs-container" id="logs-container">
                    {logs.map((log, i) => (
                        <div key={i} className="log-line">{log}</div>
                    ))}
                </div>
            </div>

            {/* Stats */}
            <div className="stats">
                <h3>Agent Stats</h3>
                <div className="stats-grid">
                    <div>Actions: {agent?.actionCount || 0}/100</div>
                    <div>Files Read: {agent?.filesRead || 0}</div>
                    <div>Files Written: {agent?.filesWritten || 0}</div>
                    <div>API Calls: {agent?.apiCalls || 0}</div>
                    <div>Errors: {agent?.errorCount || 0}</div>
                    <div>Cost: ${(agent?.costEstimate || 0).toFixed(2)}</div>
                </div>
            </div>

            {/* Controls */}
            <div className="controls">
                <button className="pause-btn" onClick={() => pauseAgent(agentId)}>
                    ⏸️ Pause Agent
                </button>
                <button className="stop-btn" onClick={() => stopAgent(agentId)}>
                    ⏹️ Stop Agent
                </button>
                <button className="message-btn" onClick={() => sendMessage(agentId)}>
                    💬 Send Message
                </button>
            </div>
        </div>
    )
}

// Helper functions
async function pauseAgent(agentId: string) {
    window.parent.postMessage({ command: "pause-agent", agentId }, "*")
}

async function stopAgent(agentId: string) {
    window.parent.postMessage({ command: "stop-agent", agentId }, "*")
}

async function sendMessage(agentId: string) {
    const message = prompt("Send message to agent:")
    if (message) {
        window.parent.postMessage({ command: "send-message", agentId, message }, "*")
    }
}

async function downloadLogs(agentId: string, logs: string[]) {
    const content = logs.join("\n")
    const blob = new Blob([content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `agent-${agentId}-logs.txt`
    a.click()
    URL.revokeObjectURL(url)
}
```

### 3. CSS Styling

```css
/* File: webview-ui/src/components/society-agent/AgentDetailView.css */
/* NEW - Styling for agent detail page */

.agent-detail-view {
	display: flex;
	flex-direction: column;
	height: 100%;
	gap: 16px;
	padding: 16px;
}

.header {
	display: flex;
	align-items: center;
	gap: 12px;
	border-bottom: 1px solid var(--vscode-editorWidget-border);
	padding-bottom: 12px;
}

.back-button {
	padding: 6px 12px;
	background: var(--vscode-button-background);
	color: var(--vscode-button-foreground);
	border: none;
	border-radius: 4px;
	cursor: pointer;
	font-size: 12px;
}

.back-button:hover {
	background: var(--vscode-button-hoverBackground);
}

.header h2 {
	margin: 0;
	flex: 1;
	font-size: 18px;
}

.agent-info {
	display: flex;
	gap: 12px;
	font-size: 12px;
}

.agent-info span {
	padding: 4px 12px;
	border-radius: 4px;
	background: var(--vscode-badge-background);
	color: var(--vscode-badge-foreground);
}

.current-task {
	border: 1px solid var(--vscode-editorWidget-border);
	border-radius: 4px;
	padding: 12px;
}

.task-description {
	margin: 8px 0;
	padding: 8px;
	background: var(--vscode-editorCodeLens-background);
	border-left: 3px solid var(--vscode-statusBar-debuggingBackground);
	border-radius: 2px;
}

.progress-bar {
	width: 100%;
	height: 4px;
	background: var(--vscode-editorCodeLens-background);
	border-radius: 2px;
	overflow: hidden;
	margin: 8px 0;
}

.progress {
	height: 100%;
	background: var(--vscode-statusBar-debuggingBackground);
	transition: width 0.3s ease;
}

.progress-text {
	font-size: 12px;
	color: var(--vscode-editorCodeLens-foreground);
}

.recent-actions {
	border: 1px solid var(--vscode-editorWidget-border);
	border-radius: 4px;
	padding: 12px;
	max-height: 200px;
	overflow-y: auto;
}

.actions-list {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.action-item {
	display: flex;
	gap: 8px;
	font-size: 12px;
	font-family: monospace;
	padding: 4px;
	border-left: 2px solid transparent;
}

.action-item:hover {
	background: var(--vscode-editorCodeLens-background);
	border-left-color: var(--vscode-statusBar-debuggingBackground);
}

.action-item .time {
	color: var(--vscode-editorCodeLens-foreground);
	min-width: 60px;
}

.action-item .type {
	color: var(--vscode-statusBar-debuggingBackground);
	font-weight: bold;
}

.action-item .detail {
	color: var(--vscode-editor-foreground);
	flex: 1;
	word-break: break-word;
}

.live-output {
	border: 1px solid var(--vscode-editorWidget-border);
	border-radius: 4px;
	padding: 12px;
	flex: 1;
	display: flex;
	flex-direction: column;
}

.live-output .header-with-controls {
	display: flex;
	align-items: center;
	gap: 12px;
	margin-bottom: 12px;
	padding-bottom: 8px;
	border-bottom: 1px solid var(--vscode-editorWidget-border);
}

.live-output h3 {
	margin: 0;
}

.live-output label {
	font-size: 12px;
	display: flex;
	align-items: center;
	gap: 4px;
	margin-left: auto;
}

.live-output button {
	padding: 4px 8px;
	font-size: 12px;
	background: var(--vscode-button-secondaryBackground);
	color: var(--vscode-button-secondaryForeground);
	border: none;
	border-radius: 2px;
	cursor: pointer;
}

.live-output button:hover {
	background: var(--vscode-button-secondaryHoverBackground);
}

.logs-container {
	flex: 1;
	overflow-y: auto;
	background: var(--vscode-editor-background);
	border-radius: 2px;
	padding: 8px;
	font-family: monospace;
	font-size: 11px;
}

.log-line {
	color: var(--vscode-editor-foreground);
	line-height: 1.4;
	word-wrap: break-word;
	white-space: pre-wrap;
	word-break: break-word;
}

.stats {
	border: 1px solid var(--vscode-editorWidget-border);
	border-radius: 4px;
	padding: 12px;
}

.stats h3 {
	margin-top: 0;
}

.stats-grid {
	display: grid;
	grid-template-columns: repeat(2, 1fr);
	gap: 12px;
	font-size: 12px;
}

.stats-grid > div {
	padding: 8px;
	background: var(--vscode-editorCodeLens-background);
	border-radius: 2px;
}

.controls {
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
}

.controls button {
	flex: 1;
	min-width: 100px;
	padding: 8px 12px;
	border: none;
	border-radius: 4px;
	cursor: pointer;
	font-size: 12px;
	font-weight: bold;
}

.pause-btn {
	background: var(--vscode-button-secondaryBackground);
	color: var(--vscode-button-secondaryForeground);
}

.pause-btn:hover {
	background: var(--vscode-button-secondaryHoverBackground);
}

.stop-btn {
	background: #d13438;
	color: white;
}

.stop-btn:hover {
	background: #e81123;
}

.message-btn {
	background: var(--vscode-button-background);
	color: var(--vscode-button-foreground);
}

.message-btn:hover {
	background: var(--vscode-button-hoverBackground);
}
```

### 4. Update Dashboard to Make Cards Clickable

```typescript
// File: webview-ui/src/components/society-agent/Dashboard.tsx
// UPDATE - Add onClick handler to cards

interface DashboardProps {
    onAgentClick?: (agentId: string) => void  // NEW
}

export const Dashboard: React.FC<DashboardProps> = ({ onAgentClick }) => {
    // ... existing code ...

    // In the agent cards section:
    return (
        <div className="agents-grid">
            {agents.map(agent => (
                <div
                    key={agent.id}
                    className="agent-card"
                    onClick={() => onAgentClick?.(agent.id)}  // NEW
                    style={{ cursor: "pointer" }}             // NEW
                >
                    {/* Card content */}
                </div>
            ))}
        </div>
    )
}
```

### 5. Update Backend Message Handler

```typescript
// File: src/core/webview/SocietyAgentProvider.ts
// UPDATE - Handle new messages for agent detail view

private handleMessage(message: any) {
    switch (message.command) {
        // ... existing cases ...

        case "get-agent-detail":  // NEW
            this.handleGetAgentDetail(message.agentId)
            break

        case "pause-agent":        // NEW
            this.handlePauseAgent(message.agentId)
            break

        case "stop-agent":         // NEW
            this.handleStopAgent(message.agentId)
            break

        case "send-message":       // NEW
            this.handleSendMessage(message.agentId, message.message)
            break
    }
}

// NEW methods
private async handleGetAgentDetail(agentId: string) {
    const state = this.societyManager?.getState()
    if (!state || !this.currentPurposeId) return

    const purpose = state.activePurposes.get(this.currentPurposeId)
    if (!purpose) return

    const agent = purpose.team.getAgent(agentId)
    if (!agent) return

    // Send agent state to webview
    this._sendToWebview({
        type: "agent-detail",
        agent: {
            id: agent.identity.id,
            name: agent.identity.name,
            role: agent.identity.role,
            status: agent.getState().status,
            task: agent.getState().currentTask,
            progress: agent.getState().progress || 0,
            actionCount: agent.getState().actionCount || 0,
            filesRead: agent.getState().filesRead || 0,
            filesWritten: agent.getState().filesWritten || 0,
            apiCalls: agent.getState().apiCalls || 0,
            errorCount: agent.getState().errorCount || 0,
            costEstimate: agent.getState().costEstimate || 0,
            recentActions: agent.getState().recentActions || [],
            logs: agent.getState().logs || []
        }
    })
}

private async handlePauseAgent(agentId: string) {
    const state = this.societyManager?.getState()
    if (!state || !this.currentPurposeId) return

    const purpose = state.activePurposes.get(this.currentPurposeId)
    if (!purpose) return

    const agent = purpose.team.getAgent(agentId)
    if (!agent) return

    await agent.pause()
    this._sendToWebview({ type: "agent-paused", agentId })
}

private async handleStopAgent(agentId: string) {
    const state = this.societyManager?.getState()
    if (!state || !this.currentPurposeId) return

    const purpose = state.activePurposes.get(this.currentPurposeId)
    if (!purpose) return

    const agent = purpose.team.getAgent(agentId)
    if (!agent) return

    await agent.stop()
    this._sendToWebview({ type: "agent-stopped", agentId })
}

private async handleSendMessage(agentId: string, message: string) {
    const state = this.societyManager?.getState()
    if (!state || !this.currentPurposeId) return

    const purpose = state.activePurposes.get(this.currentPurposeId)
    if (!purpose) return

    const agent = purpose.team.getAgent(agentId)
    if (!agent) return

    await agent.sendMessage(message)
    this._sendToWebview({ type: "message-sent", agentId })
}
```

---

## User Experience Flow

### Scenario: Developer Wants to See What Worker Agent is Doing

1. **Main Dashboard** - See overview

    - All 3 agents listed with status cards
    - Shows "worker-backend-1: Working 65%"

2. **Click on agent card** - Navigate to detail

    - Transition to Agent Detail page
    - Shows full information

3. **Watch live work**

    - See recent actions in real-time
    - Watch live output stream
    - Monitor resource usage

4. **Control agent**

    - Can pause to inspect
    - Can send guidance message
    - Can stop if stuck

5. **Download logs** - For analysis

    - Export agent logs
    - Share with team

6. **Go back** - Return to dashboard
    - See overall progress
    - Check other agents

---

## Implementation Checklist

### Phase 1: Navigation Layer (2 hours)

- [ ] Create `SocietyAgentApp.tsx` with router
- [ ] Create `AgentDetailView.tsx` component (basic layout)
- [ ] Update `Dashboard.tsx` to handle clicks
- [ ] Update `SocietyAgentProvider.ts` message handlers
- [ ] Wire up navigation between views

### Phase 2: Agent State Display (2 hours)

- [ ] Display agent identity (name, role, capabilities)
- [ ] Show current task and progress
- [ ] Display recent actions list
- [ ] Show live output/logs
- [ ] Display agent stats

### Phase 3: Controls & Features (1.5 hours)

- [ ] Pause/stop buttons
- [ ] Send message functionality
- [ ] Download logs button
- [ ] Auto-scroll logs
- [ ] Auto-refresh agent state

### Phase 4: Styling & Polish (1 hour)

- [ ] Apply VS Code theme colors
- [ ] Responsive layout
- [ ] Smooth transitions
- [ ] Mobile-friendly (if needed)

**Total Implementation Time**: 6-7 hours

---

## Benefits

✅ **Better Visibility**: See exactly what each agent is doing  
✅ **Deeper Debugging**: Inspect individual agent logs  
✅ **Fine-Grained Control**: Pause/stop individual agents  
✅ **Educational**: Learn what agents are thinking  
✅ **Professional**: Shows agent reasoning to stakeholders

---

## Should We Build This?

**Yes!** This adds significant value:

1. **Debugging** - Essential when agents get stuck
2. **Learning** - Understand how agents reason
3. **Control** - Stop individual agents without stopping purpose
4. **Transparency** - Show exactly what happened

**Estimated time**: 6-7 hours (manageable afternoon/evening session)

**Want me to implement this now?** 🚀

---

I can start with Phase 1 (navigation) and have something clickable in 30 minutes!
