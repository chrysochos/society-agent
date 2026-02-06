# Society Agent Workspace Architecture

> **Critical Issue**: Response appearing as file instead of in web UI  
> **Root Cause**: No proper workspace separation between agent system and user projects  
> **Status**: Architecture Design - Ready for Implementation

---

## The Problem

### Current Behavior (Incorrect)

```
User: "hi"
→ Agent creates: /workspace/greeting_response.txt
→ User sees: File created (not response in web UI)
→ Problem: Files mix with Society Agent system code
```

### Expected Behavior (Correct)

```
User: "hi"
→ Agent responds in web UI chat
→ If creating files → Goes to user's project workspace
→ System files stay separate from user files
```

---

## Core Architectural Principles

### 1. **Separation of Concerns**

```
/workspace/                              # Society Agent System (READ-ONLY for agents)
  ├── src/                               # System code
  ├── webview-ui/                        # System UI
  └── cli/                               # System CLI

~/.kilocode/                             # System configuration
  ├── workspaces/                        # User workspaces (AGENT WORK HERE)
  │   ├── user-{hash}/                   # Per-user directory
  │   │   ├── projects/                  # User projects
  │   │   │   ├── project-1/             # Individual project
  │   │   │   │   ├── src/
  │   │   │   │   ├── docs/
  │   │   │   │   └── .kilocode/         # Project metadata
  │   │   │   │       ├── purpose.json   # Original purpose
  │   │   │   │       ├── agents.json    # Agents assigned
  │   │   │   │       └── history.jsonl  # Action history
  │   │   │   └── project-2/
  │   │   └── shared/                    # Cross-project resources
  │   └── registry.jsonl                 # Active agents
  └── logs/                              # System logs
```

### 2. **Project as Knowledge Inventory**

**Key Insight**: A folder = A brain = A project

- Each project is a **knowledge container**
- Evolves as purpose evolves
- Contains: code, docs, tests, configs
- Persists across sessions
- Agents work **inside** project folders

### 3. **User-Based Persistence**

```typescript
interface User {
	id: string // Unique user ID (email hash?)
	workspaceRoot: string // ~/.kilocode/workspaces/user-{hash}/
	currentProject?: string // Active project path
	projects: Project[] // All user projects
}

interface Project {
	id: string // Unique project ID
	name: string // User-friendly name
	path: string // Absolute path to project folder
	purpose: PurposeContext // Original purpose
	createdAt: number
	updatedAt: number
	agents: AgentReference[] // Agents working on this project
	status: "active" | "completed" | "archived"
}
```

---

## Workspace Organization Strategies

### Strategy A: One Agent Per Project (Simple)

```
projects/
  ├── auth-system/              # Purpose: "Build authentication"
  │   ├── src/
  │   ├── tests/
  │   └── .kilocode/
  │       └── agent-backend-001.json  # One agent owns this project
  └── frontend-ui/              # Purpose: "Create dashboard UI"
      ├── components/
      ├── styles/
      └── .kilocode/
          └── agent-frontend-001.json
```

**Pros**: Clear ownership, no conflicts  
**Cons**: Limited for complex projects

### Strategy B: Multi-Agent Per Project (Complex)

```
projects/
  └── full-stack-app/           # Purpose: "Build complete app"
      ├── backend/              # Folder assigned to backend agent
      │   └── .agent-owner → agent-backend-001
      ├── frontend/             # Folder assigned to frontend agent
      │   └── .agent-owner → agent-frontend-001
      ├── tests/                # Shared folder
      └── .kilocode/
          ├── agents.json       # All agents on this project
          └── folder-map.json   # Agent → Folder assignments
```

**Pros**: Complex projects, parallel work  
**Cons**: Requires coordination

### Strategy C: Purpose-Based Evolution (Recommended)

```
projects/
  └── my-app/                   # Starts simple
      ├── .kilocode/
      │   ├── purpose-v1.json   # "Build auth"
      │   ├── purpose-v2.json   # "Add dashboard"
      │   ├── purpose-v3.json   # "Implement API"
      │   └── evolution.jsonl   # Tracks how project evolved
      ├── auth/                 # Created by purpose-v1
      ├── dashboard/            # Created by purpose-v2
      └── api/                  # Created by purpose-v3
```

**Pros**: Natural evolution, tracks history  
**Cons**: Needs smart folder management

---

## Implementation Plan

### Phase 1: User Workspace Setup (Week 1)

**Goal**: Separate user workspaces from system code

**Files to Create**:

```typescript
// src/services/society-agent/workspace-manager.ts
export class WorkspaceManager {
	constructor(userId: string)

	// Core methods
	initializeUserWorkspace(): Promise<string>
	getCurrentProject(): Promise<Project | null>
	createProject(name: string, purpose: PurposeContext): Promise<Project>
	switchProject(projectId: string): Promise<void>
	listProjects(): Promise<Project[]>

	// Project paths
	getProjectPath(projectId: string): string
	getUserWorkspaceRoot(): string
	getSharedResourcesPath(): string
}

// src/services/society-agent/project-manager.ts
export class ProjectManager {
	constructor(projectPath: string)

	// Project lifecycle
	initialize(purpose: PurposeContext): Promise<void>
	assignAgent(agent: AgentIdentity, folder?: string): Promise<void>
	removeAgent(agentId: string): Promise<void>

	// Folder management
	createFolder(path: string, owner?: string): Promise<void>
	getFolderOwner(path: string): Promise<string | null>
	getAgentFolders(agentId: string): Promise<string[]>

	// History
	logAction(action: ProjectAction): Promise<void>
	getHistory(): Promise<ProjectAction[]>
}
```

**Server API Updates**:

```typescript
// POST /api/workspace/projects/create
POST /api/workspace/projects/:id/switch
GET /api/workspace/projects/list
GET /api/workspace/projects/:id

// POST /api/workspace/projects/:id/folders/create
GET /api/workspace/projects/:id/structure
```

### Phase 2: Agent-Workspace Integration (Week 2)

**Goal**: Agents work in project folders, not system code

**Changes**:

1. **Agent Working Directory**:

```typescript
// Current (WRONG)
const workingDir = "/workspace" // System code!

// New (CORRECT)
const workingDir = project.path // User project
```

2. **File Operations**:

```typescript
// Before: Agent creates files
agent.createFile("/workspace/greeting.txt") // ❌ Wrong

// After: Agent creates files in project
agent.createFile(`${project.path}/greeting.txt`) // ✅ Correct
```

3. **Response vs File Creation**:

```typescript
// Supervisor decides: response or file?
if (purpose.requiresFiles) {
  agent.createFile(...)
} else {
  agent.sendResponse(...)  // Show in web UI
}
```

### Phase 3: Web UI Integration (Week 2-3)

**New UI Components**:

1. **Project Selector** (top bar)

    - Current project name
    - Switch project dropdown
    - New project button

2. **Project Browser** (left sidebar)

    - Folder tree view
    - File explorer
    - Agent ownership indicators
    - Right-click: Open folder, view agent

3. **Workspace Settings** (settings modal)
    - User workspace path
    - Default project template
    - Auto-create project on purpose?

---

## Response Strategy: When to Create Files vs Chat

### Decision Tree

```
User inputs purpose
    ↓
Supervisor analyzes
    ↓
Is it conversational? → YES → Respond in chat
    ↓ NO
Does it need files? → YES → Create project + files
    ↓ NO
Is it a question? → YES → Respond in chat
    ↓ NO
Does it need code? → YES → Create project + code files
```

### Examples

| Purpose                   | Response Type | Location        |
| ------------------------- | ------------- | --------------- |
| "hi"                      | Chat response | Web UI chat     |
| "What is TypeScript?"     | Chat response | Web UI chat     |
| "Build authentication"    | Files         | Project folder  |
| "Create a React app"      | Files         | Project folder  |
| "Explain my code"         | Chat response | Web UI chat     |
| "Add tests to my project" | Files         | Current project |

### Implementation

```typescript
// src/services/society-agent/response-strategy.ts
export class ResponseStrategy {
	static determineResponseType(purpose: PurposeContext): ResponseType {
		// Conversational keywords
		const conversational = ["hi", "hello", "what", "why", "how", "explain"]
		const lowercaseDesc = purpose.description.toLowerCase()

		if (conversational.some((kw) => lowercaseDesc.startsWith(kw))) {
			return "chat"
		}

		// File/code keywords
		const fileKeywords = ["build", "create", "implement", "add", "write", "generate"]
		if (fileKeywords.some((kw) => lowercaseDesc.includes(kw))) {
			return "project"
		}

		return "chat" // Default to chat
	}
}
```

---

## Folder Evolution Patterns

### Pattern 1: Linear Growth

```
Project: "Build a web app"

Day 1:
  my-app/
    └── index.html

Day 2:
  my-app/
    ├── index.html
    └── style.css

Day 3:
  my-app/
    ├── index.html
    ├── style.css
    └── script.js
```

### Pattern 2: Feature Branches

```
Project: "E-commerce site"

Purpose v1: "Add user auth"
  my-app/
    └── auth/
        ├── login.html
        └── signup.html

Purpose v2: "Add product catalog"
  my-app/
    ├── auth/
    └── products/
        ├── catalog.html
        └── product-card.html

Purpose v3: "Add shopping cart"
  my-app/
    ├── auth/
    ├── products/
    └── cart/
        └── cart.html
```

### Pattern 3: Refactoring Evolution

```
Purpose v1: "Quick prototype"
  my-app/
    └── app.js           # Everything in one file

Purpose v2: "Organize code"
  my-app/
    ├── src/
    │   ├── models/
    │   ├── views/
    │   └── controllers/
    └── app.js           # Kept for backwards compatibility

Purpose v3: "Production ready"
  my-app/
    ├── src/
    ├── tests/
    ├── docs/
    └── config/
```

---

## Multi-User Considerations

### Single User (Current Scope)

```
~/.kilocode/workspaces/
  └── default-user/
      └── projects/
```

### Multi-User (Future)

```
~/.kilocode/workspaces/
  ├── alice-{hash}/
  │   └── projects/
  ├── bob-{hash}/
  │   └── projects/
  └── charlie-{hash}/
      └── projects/
```

**Authentication**: API key per user?

---

## File Organization Examples

### Example 1: Simple Chat Purpose

```
Purpose: "hi"
Response Type: Chat
Action: Supervisor responds in web UI chat
Result: No files created
```

### Example 2: Code Project Purpose

```
Purpose: "Build a REST API with Express"
Response Type: Project
Action:
  1. Create project: "rest-api-{timestamp}"
  2. Create folder structure:
     rest-api-1234567890/
       ├── src/
       │   ├── routes/
       │   ├── controllers/
       │   └── models/
       ├── tests/
       ├── package.json
       └── .kilocode/
           ├── purpose.json
           └── agents.json
  3. Assign backend agent
  4. Generate code files
Result: Project created, files in project folder
```

### Example 3: Evolving Purpose

```
Purpose v1: "Create a simple calculator"
  calculator/
    └── calc.js

Purpose v2: "Add a web UI"
  calculator/
    ├── calc.js
    ├── index.html
    └── style.css

Purpose v3: "Add advanced functions"
  calculator/
    ├── calc.js
    ├── advanced/
    │   ├── scientific.js
    │   └── financial.js
    ├── index.html
    └── style.css
```

---

## Configuration Files

### User Workspace Config

```json
// ~/.kilocode/workspaces/user-{hash}/config.json
{
	"userId": "user-abc123",
	"email": "user@example.com",
	"defaultProjectTemplate": "blank",
	"autoCreateProject": true,
	"workspaceRoot": "/home/user/.kilocode/workspaces/user-abc123",
	"preferences": {
		"showHiddenFiles": false,
		"autoSaveInterval": 5000
	}
}
```

### Project Config

```json
// ~/.kilocode/workspaces/user-{hash}/projects/my-app/.kilocode/project.json
{
	"id": "project-xyz789",
	"name": "My App",
	"createdAt": 1706745600000,
	"updatedAt": 1706832000000,
	"status": "active",
	"purposes": [
		{
			"id": "purpose-1",
			"description": "Build authentication system",
			"createdAt": 1706745600000,
			"status": "completed"
		}
	],
	"agents": [
		{
			"id": "agent-backend-001",
			"role": "backend",
			"assignedFolders": ["src/auth", "src/api"],
			"status": "active"
		}
	],
	"folderStructure": {
		"src": { "owner": null, "created": 1706745600000 },
		"src/auth": { "owner": "agent-backend-001", "created": 1706746000000 },
		"src/api": { "owner": "agent-backend-001", "created": 1706746500000 }
	}
}
```

---

## Implementation Checklist

### Backend (Week 1-2)

- [ ] Create `WorkspaceManager` class
- [ ] Create `ProjectManager` class
- [ ] Create `ResponseStrategy` helper
- [ ] Update `SupervisorAgent` to use workspace manager
- [ ] Add workspace API endpoints
- [ ] Update agents to work in project directories
- [ ] Add project metadata tracking

### Frontend (Week 2-3)

- [ ] Add project selector to top bar
- [ ] Create project browser component
- [ ] Update chat interface to handle both responses and files
- [ ] Add "New Project" workflow
- [ ] Add "Switch Project" workflow
- [ ] Show current project in UI
- [ ] Add file explorer for project

### Testing (Week 3)

- [ ] Test: "hi" → Chat response (not file)
- [ ] Test: "Build X" → Project created
- [ ] Test: Multiple purposes → Folder evolution
- [ ] Test: Agent file operations stay in project
- [ ] Test: Switch projects
- [ ] Test: Project persistence across sessions

---

## Migration Plan

### For Existing Installations

1. **Detect old workspace**:

    - Check if files exist in `/workspace`
    - Warn user about migration

2. **Migrate to new structure**:

    - Create user workspace
    - Move existing files to a "migrated-project"
    - Update paths

3. **Backward compatibility**:
    - Keep old behavior if `LEGACY_MODE=true`
    - Gradual rollout

---

## Future Enhancements

### Multi-Project Workflow

```
User works on multiple projects simultaneously:
  - Project A: "Build API" (backend agent)
  - Project B: "Design UI" (frontend agent)

Supervisor coordinates across projects:
  - Share types/interfaces
  - Sync API contracts
  - Cross-project testing
```

### Shared Resources

```
~/.kilocode/workspaces/user-{hash}/
  ├── projects/
  │   ├── project-a/
  │   └── project-b/
  └── shared/
      ├── components/       # Shared React components
      ├── utils/            # Shared utilities
      └── types/            # Shared TypeScript types
```

### Project Templates

```
~/.kilocode/templates/
  ├── blank/              # Empty project
  ├── react-app/          # React starter
  ├── express-api/        # Express API starter
  └── full-stack/         # Full-stack template
```

---

## Summary

### Key Decisions

1. ✅ **User workspaces** separate from system code
2. ✅ **Project-based organization** (one project = one folder)
3. ✅ **Purpose drives folder evolution**
4. ✅ **Chat responses vs file creation** (intelligent routing)
5. ✅ **Agents work inside projects** (not in system code)
6. ✅ **User persistence** (projects survive sessions)

### Next Steps

1. Review this architecture
2. Approve folder structure
3. Implement Phase 1 (workspace manager)
4. Test with real purposes
5. Iterate based on feedback

---

**Ready to transform Society Agent into a proper multi-project workspace system!** 🚀
