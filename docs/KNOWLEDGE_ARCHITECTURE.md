# Mind-Tool, Skills, and MCP: Knowledge Architecture for AI Agents

**Version:** 1.1  
**Date:** February 20, 2026  
**Location:** `/docs/KNOWLEDGE_ARCHITECTURE.md`

---

## Abstract

This document describes the knowledge architecture underlying Society Agent:

- **Mind-Tool**: Persistent file-based memory for agent state and facts
- **Skills**: Reusable procedural knowledge (global and project-specific)
- **MCPs**: External integrations via Model Context Protocol servers

Together, these components enable agents to maintain evolving expertise while separating concerns between what to remember (Mind-Tool), how to think (LLM), how to do things (Skills), and how to integrate with external services (MCPs).

---

## 1. Introduction

### 1.1 The Knowledge Problem in AI Agents

Current LLM-based agents face a fundamental limitation: knowledge exists only within the context window. When a conversation ends, all learned information is lost. This creates several problems:

- **Re-learning**: Agents must rediscover the same information repeatedly
- **No expertise accumulation**: Experience doesn't build over time
- **Procedural amnesia**: Successful workflows must be re-invented each session
- **Context overflow**: Loading all past knowledge exceeds token limits

### 1.2 The Tri-Component Solution

Society Agent addresses these problems through separation of concerns:

| Component | Role | Persistence | Example |
|-----------|------|-------------|---------|
| **Mind-Tool** | Object/State | Permanent | "The API runs on port 3001" |
| **LLM** | Intelligence | Session | Reasoning, analysis, decisions |
| **Skills** | Procedures | Permanent | "How to compile LaTeX" |

This separation mirrors how human experts work:
- **Memory** (Mind-Tool): Facts, context, project state
- **Thinking** (LLM): Problem-solving, creativity, judgment
- **Procedures** (Skills): Recipes, checklists, workflows

---

## 2. Mind-Tool Architecture

### 2.1 Definition

The Mind-Tool method provides file-based persistent memory for AI agents. Each agent maintains a knowledge folder containing:

```
agent-folder/
├── AGENTS.md          # Knowledge index (read FIRST)
├── KNOWLEDGE.md       # Playbooks, tips, context
├── STATE.md           # Current/desired state
├── skills/            # Formal procedures
│   └── skill-name/
│       └── SKILL.md
└── [other files]      # Notes, artifacts, outputs
```

### 2.2 AGENTS.md: The Knowledge Index

The AGENTS.md file serves as a lazy-loading index. Rather than loading all knowledge into context, agents read AGENTS.md first to understand what exists, then load specific files only when needed.

**Structure:**
```markdown
# Agent Name - Knowledge Index

## 📋 HOW TO USE THIS INDEX
1. Read this file FIRST to understand what knowledge exists
2. Only read detailed files when you NEED them for the current task
3. Update this index whenever you create/modify knowledge files

## 🔄 Current State
- **Status**: [Active/Blocked/Waiting]
- **Last Task**: [What was completed]
- **Working On**: [Current focus]
- **Blocked By**: [Dependencies]

## 🎯 Desired State
- **Primary Goal**: [Main objective]
- **Success Criteria**: [How to measure success]

## 📚 Knowledge Files Index
| File | Contains | When to Read |
|------|----------|--------------|
| KNOWLEDGE.md | Tips, context | When needing project facts |
| STATE.md | Detailed state | When planning work |

## 🎯 Skills Index
| Skill | Folder | Trigger | Description |
|-------|--------|---------|-------------|
| compile-latex | skills/compile-latex/ | /compile-latex | LaTeX compilation |
```

### 2.3 Lazy Loading Pattern

**Problem**: Loading all agent knowledge into context wastes tokens and may exceed limits.

**Solution**: Hierarchical lazy loading:

1. **Always load**: AGENTS.md (small index file)
2. **Load on demand**: Specific knowledge files when the task requires them
3. **Never preload**: Large files, outputs, historical data

**Implementation:**
```
User asks: "Compile the paper"

Agent thinks:
1. Read AGENTS.md → See Skills Index → "compile-latex" exists
2. Read skills/compile-latex/SKILL.md → Get procedure
3. Execute procedure
4. (Never loaded KNOWLEDGE.md, STATE.md - not needed)
```

### 2.4 Knowledge Evolution

Unlike static RAG databases, Mind-Tool knowledge evolves organically:

| Event | Evolution |
|-------|-----------|
| Task completed | Update Current State in AGENTS.md |
| Bug solved | Add solution to KNOWLEDGE.md |
| New procedure learned | Create skill or add playbook |
| Project changes | Update Knowledge Files Index |

The agent decides what to store and where, maintaining its own expertise over time.

---

## 3. Skills Architecture

### 3.1 Definition

Skills are formal, reusable procedures stored in a standardized format. Unlike playbooks (informal notes), skills are:

- **Structured**: YAML frontmatter + markdown instructions
- **Reusable**: Can apply across projects
- **Triggerable**: Can be invoked by name or keyword
- **Versioned**: Track changes over time

### 3.2 Global vs Project Skills

Society Agent implements a two-tier skill system:

```
/workspaces/society-agent/
├── skills/                        # GLOBAL (shared by all projects)
│   ├── compile-latex/
│   │   └── SKILL.md
│   └── npm-build/
│       └── SKILL.md
└── projects/
    ├── architect/
    │   └── skills/                # PROJECT-SPECIFIC
    │       └── deploy-staging/
    │           └── SKILL.md
    └── john/
        └── skills/                # PROJECT-SPECIFIC
            └── run-benchmarks/
                └── SKILL.md
```

**Permission Model:**

| Action | Global Skills | Project Skills |
|--------|---------------|----------------|
| **Read** | Any agent | Agent in that project |
| **Create** | User only | Agent (autonomous) |
| **Modify** | User only | Agent (autonomous) |
| **Delete** | User only | Agent (autonomous) |

**Why This Design:**

1. **Safety**: Agents cannot pollute the global namespace
2. **Autonomy**: Agents can still create project-specific skills freely
3. **Curation**: User decides what gets promoted to global
4. **Override**: Project skills take precedence over global skills

**Resolution Order:**

When an agent looks for a skill:
1. Check `projects/{project}/skills/{name}/` first (project override)
2. Fall back to `skills/{name}/` (global shared)

This allows a project to override a global skill with its own version.

**How Users Create/Manage Global Skills:**

Users (or external overseers like GitHub Copilot) can manage global skills via:

1. **Promote a project skill to global** (most common):
   ```bash
   # Copy a well-tested project skill to global
   cp -r projects/architect/skills/compile-latex /workspaces/society-agent/skills/
   ```

2. **Create a global skill directly**:
   ```bash
   mkdir -p /workspaces/society-agent/skills/my-skill
   # Create SKILL.md with standard format
   ```

3. **Edit/update global skills**:
   ```bash
   # User directly edits the SKILL.md files
   nano /workspaces/society-agent/skills/compile-latex/SKILL.md
   ```

4. **Remove a global skill**:
   ```bash
   rm -rf /workspaces/society-agent/skills/deprecated-skill
   ```

This "promotion" workflow ensures only proven, high-quality skills become globally available.

### 3.3 Anthropic-Compatible Format

Society Agent uses the Anthropic skill format for compatibility:

```
skills/
└── skill-name/
    ├── SKILL.md      # Main skill definition
    ├── context.md    # Optional supplementary context
    └── script.sh     # Optional executable
```

**SKILL.md Structure:**
```markdown
---
name: skill-name
description: What this skill does
version: 1.0
triggers:
  - /skill-name
  - keyword phrase
parameters:
  param_name:
    type: string
    description: What this parameter is
    required: false
    default: "value"
---

# Skill Title

Description of what this skill accomplishes.

## Prerequisites
- Required tools
- Required files

## Instructions
1. Step one
2. Step two
3. Step three

## Verification
How to verify the skill executed correctly.

## Common Errors
| Error | Cause | Solution |
|-------|-------|----------|
```

### 3.4 Skills vs Playbooks

The agent autonomously decides where to store learned procedures:

| Criteria | → Project Skill | → Playbook |
|----------|-----------------|------------|
| Steps | 3+ steps | 1-2 steps |
| Reusability | Reusable procedure | Project-specific tip |
| Formality | Formal procedure | Quick note |
| Trigger | Explicit command | Context lookup |

**Decision Algorithm:**
```
When learning something new:
  IF has 3+ ordered steps AND is reusable → Create Project Skill
  ELIF is quick tip or context → Add to KNOWLEDGE.md
  ELIF is state change → Update AGENTS.md
  
  // Note: Only USER can promote to Global Skill
```

**Promotion to Global:**
When an agent creates a useful skill, the user can promote it:
```bash
# User action (not agent):
cp projects/architect/skills/my-skill /skills/my-skill
```

### 3.5 Skill Execution Pattern

```
User: "Compile the LaTeX document"

Agent:
1. Parse request → Matches "compile latex" trigger
2. Load skill: read_file("skills/compile-latex/SKILL.md")
3. Extract parameters: file = "main.tex"
4. Execute instructions step by step
5. Verify success (check output, errors)
6. Report result
```

---

## 4. The LLM Component

### 4.1 Role in the Tri-Component Architecture

The LLM provides intelligence but not persistence:

| LLM Provides | LLM Does NOT Provide |
|--------------|---------------------|
| Reasoning | Long-term memory |
| Analysis | Persistent state |
| Decision-making | Reusable procedures |
| Creativity | Project context |
| Language understanding | Historical knowledge |

### 4.2 Interaction with Mind-Tool

The LLM reads and writes to Mind-Tool:

```
┌─────────────────────────────────────────────┐
│                    LLM                       │
│         (Intelligence, Reasoning)            │
└──────────────────┬──────────────────────────┘
                   │
        ┌──────────┴──────────┐
        │ read    │  write    │
        ▼         │           ▼
┌───────────────────────────────────────────┐
│              Mind-Tool                     │
│  (AGENTS.md, KNOWLEDGE.md, skills/, ...)  │
└───────────────────────────────────────────┘
```

### 4.3 Interaction with Skills

Skills guide the LLM's execution:

1. **Skill Loading**: LLM reads SKILL.md into context
2. **Parameter Extraction**: LLM identifies required inputs
3. **Instruction Following**: LLM executes steps
4. **Verification**: LLM checks for success/failure
5. **Adaptation**: LLM handles edge cases not in skill

The LLM can also **create skills** when it learns new procedures, enabling autonomous expertise development.

---

## 5. Integration: The Complete Picture

### 5.1 Information Flow

```
┌─────────────────────────────────────────────────────────────┐
│                         USER REQUEST                         │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                           LLM                                │
│  1. Read AGENTS.md (always)                                  │
│  2. Identify relevant knowledge → Load if needed             │
│  3. Check Skills Index → Load matching skill if exists       │
│  4. Reason about approach                                    │
│  5. Execute (use skill procedure or ad-hoc)                  │
│  6. Update Mind-Tool with learnings                          │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       MIND-TOOL                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  AGENTS.md   │  │ KNOWLEDGE.md │  │   skills/    │      │
│  │   (Index)    │  │  (Playbooks) │  │ (Procedures) │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Example Workflow: LaTeX Compilation

**User**: "Compile the paper and fix any errors"

**Agent Process**:

1. **Index Lookup** (AGENTS.md):
   - See Skills Index → "compile-latex" skill exists
   
2. **Skill Loading** (skills/compile-latex/SKILL.md):
   - Load full procedure with parameters
   
3. **Execution** (LLM + Skill):
   - Follow skill instructions
   - Run `pdflatex -interaction=nonstopmode`
   - Run `bibtex`
   - Run `pdflatex` twice more
   
4. **Verification** (LLM reasoning):
   - Examine output for "!" error markers
   - If errors found, read .log file
   - Apply fixes (LLM reasoning, not in skill)
   
5. **Knowledge Update** (Mind-Tool):
   - If new error type encountered → Add to KNOWLEDGE.md
   - If procedure changed → Update skill version
   - Update Current State in AGENTS.md

### 5.3 Autonomous Learning Example

**Scenario**: Agent encounters new build system

1. **Discovery**: Agent runs `npm run build`, fails
2. **Problem-solving** (LLM): Reads error, tries `npm install` first
3. **Success**: Build works with install → build sequence
4. **Decision** (LLM): "This is a 3-step procedure, reusable"
5. **Skill Creation**: Creates `skills/npm-build/SKILL.md`
6. **Index Update**: Adds to Skills Index in AGENTS.md

**Result**: Next time, agent has the skill ready.

---

## 6. Implementation Details

### 6.1 System Prompt Guidance

Agents receive decision criteria in their system prompt:

```
**When you learn something, decide WHERE to store it:**

| Store In | When | Example |
|----------|------|---------|
| Project Skill (skills/name/SKILL.md) | Formal procedure, reusable, 3+ steps | Compilation, deployment |
| Playbook (KNOWLEDGE.md) | Quick tips, project context | "API on port 3001" |
| AGENTS.md | State updates, skill registry | Current State, Skills Index |

**Skills: Global vs Project (IMPORTANT!)**

| Location | Access | Who Creates |
|----------|--------|-------------|
| Global (/skills/) | All projects (read-only) | User only |
| Project (skills/ in your folder) | This project only | You (agent) |

**Skill Commands:**
- `list_global_skills()` - Returns **informative list** with name + description for each skill (parsed from SKILL.md frontmatter). Agent can assess relevance before loading full instructions.
- `read_global_skill(skill_name)` - Read the full skill instructions (only when needed)
- `read_file("skills/name/SKILL.md")` - Read your project's skills
- `write_file("skills/name/SKILL.md", ...)` - Create project skill (you can do this!)

**Example `list_global_skills()` output:**
```
🌐 **Global Skills** (READ ONLY - shared across all projects):

- **compile-latex**: Compile LaTeX document with BibTeX bibliography to PDF
- **npm-build**: Build and test Node.js projects

Use `read_global_skill(skill_name)` to read the full skill.
```

This lazy-loading pattern means agents only load full instructions when they actually need them.

⚠️ You can CREATE project skills but NOT global skills.
```

### 6.2 Skill Format Compatibility

The skill format is designed for compatibility with:

- **Anthropic Skills**: Standard folder + SKILL.md structure
- **OpenAI Assistants**: Can be converted to instruction sets
- **LangChain Tools**: Skills can wrap as tool definitions

### 6.3 Token Efficiency

The architecture optimizes token usage:

| Without Mind-Tool | With Mind-Tool |
|-------------------|----------------|
| Load all history | Load index only |
| Re-explain procedures | Load skill on demand |
| Repeat context | Read from files |
| ~50K tokens/session | ~5K tokens/session |

---

## 7. Comparison with Existing Approaches

### 7.1 vs RAG (Retrieval-Augmented Generation)

| Aspect | RAG | Mind-Tool |
|--------|-----|-----------|
| Knowledge source | Static embeddings | Evolving files |
| Update frequency | Batch reindex | Real-time |
| Structure | Flat chunks | Hierarchical index |
| Agent control | Passive retrieval | Active curation |

### 7.2 vs MemGPT

| Aspect | MemGPT | Mind-Tool |
|--------|--------|-----------|
| Memory model | Hierarchical layers | File-based |
| Transparency | Opaque | Inspectable files |
| Portability | System-specific | Standard folders |
| Editability | API only | Human-readable |

### 7.3 vs Fine-tuning

| Aspect | Fine-tuning | Mind-Tool |
|--------|-------------|-----------|
| Knowledge update | Retraining | File write |
| Iteration speed | Hours/days | Instant |
| Rollback | Difficult | Git-versioned |
| Inspection | Opaque | Readable files |

---

## 8. Advantages and Limitations

### 8.1 Advantages

1. **Separation of Concerns**: State, intelligence, and procedures are cleanly separated
2. **Inspectable**: All knowledge is in human-readable files
3. **Evolvable**: Agents grow expertise over time
4. **Efficient**: Lazy loading minimizes token usage
5. **Portable**: Standard file formats, no vendor lock-in
6. **Collaborative**: Humans can edit agent knowledge directly

### 8.2 Limitations

1. **File I/O Overhead**: Reading files uses tool calls
2. **Index Maintenance**: Agents must maintain AGENTS.md manually
3. **Skill Quality**: Depends on agent's ability to write good procedures
4. **No Semantic Search**: Index is keyword-based, not embedding-based

### 8.3 Future Directions

1. **Embedding-enhanced indexing**: Add semantic search to lazy loading
2. **Skill sharing**: Cross-agent skill repositories
3. **Automatic skill extraction**: Detect reusable patterns in agent behavior
4. **Verification layers**: Validate skills before storage

---

## 9. Conclusion

The tri-component architecture—Mind-Tool for state, LLM for intelligence, Skills for procedures—provides a robust foundation for persistent, evolving AI agents. By separating concerns, Society Agent achieves:

- **Persistence without bloat**: Lazy loading keeps context manageable
- **Learning without forgetting**: Knowledge accumulates in files
- **Procedures without rigidity**: Skills guide but don't constrain
- **Intelligence without amnesia**: LLM reads from persistent memory

This architecture enables agents that genuinely improve over time, building expertise through accumulated experience rather than starting fresh each session.

---

## References

- Chrysochos, I. (2024). Mind-Tool: File-Based Persistent Memory for LLM Agents.
- Chrysochos, I. (2026). Mind-Tool v2: Lazy Loading and Indexing for Efficient Agent Memory. TechRxiv.
- Anthropic (2025). Claude Skills Format Specification.
- OpenAI (2024). Assistants API Documentation.

---

## Appendix A: Skill Template

```markdown
---
name: skill-name
description: Brief description
version: 1.0
triggers:
  - /skill-name
  - alternative trigger
parameters:
  param1:
    type: string
    description: What this is
    required: false
    default: "default_value"
---

# Skill Title

## Prerequisites
- Tool/dependency 1
- Tool/dependency 2

## Instructions
1. First step
2. Second step
3. Third step

## Verification
How to verify success.

## Common Errors
| Error | Cause | Solution |
|-------|-------|----------|
| ErrorType | Why it happens | How to fix |
```

## Appendix B: AGENTS.md Template

```markdown
# Agent Name - Knowledge Index

> **Agent ID**: agent-id
> **Role**: Role description
> **Created**: ISO timestamp

---

## 📋 HOW TO USE THIS INDEX
1. Read this file FIRST
2. Only read files when needed
3. Update after changes

---

## 🔄 Current State
- **Status**: Active
- **Last Task**: Description
- **Working On**: Current focus
- **Blocked By**: Nothing

---

## 🎯 Desired State
- **Primary Goal**: Main objective
- **Success Criteria**: How to measure

---

## 📚 Knowledge Files Index
| File | Contains | When to Read |
|------|----------|--------------|
| KNOWLEDGE.md | Tips, context | For project facts |

---

## 🎯 Skills Index
| Skill | Folder | Trigger | Description |
|-------|--------|---------|-------------|
| example | skills/example/ | /example | What it does |
```

---

## 8. MCP Server Integration

### 8.1 What Are MCP Servers?

MCP (Model Context Protocol) servers provide external integrations that extend agent capabilities beyond file operations and terminal commands. Examples include:

- **Playwright**: Browser automation (navigate, click, screenshot, fill forms)
- **GitHub**: Repository management (create issues, pull requests, review code)
- **Google Workspace**: Docs, Sheets, Gmail, Calendar integration

### 8.2 Permission Model (Same as Skills)

| Location | Who Registers | Who Uses | Scope |
|----------|---------------|----------|-------|
| `/mcp-config.json` | User only | All agents (read-only) | Global |
| `projects/{project}/mcp.json` | User only | Project agents | Project |

**Key Design Decisions:**

1. **Agents cannot register MCPs** - Security/token safety (user controls what external services are available)
2. **Lazy loading** - MCP servers only start when first used (saves resources)
3. **Project can override global** - Same resolution order as skills
4. **Informative listing** - `list_mcps()` shows name + description, `list_mcp_tools(server)` shows detailed tool list

### 8.3 Configuration Format

**Global (/mcp-config.json):**
```json
{
  "servers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-playwright"],
      "description": "Browser automation - navigate, click, screenshot, fill forms",
      "enabled": true
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-github"],
      "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" },
      "description": "GitHub API - issues, PRs, repos",
      "enabled": true
    }
  }
}
```

**Project-specific (projects/{project}/mcp.json):**
```json
{
  "servers": {
    "custom-api": {
      "command": "node",
      "args": ["./mcp-servers/custom-api.js"],
      "description": "Project-specific API integration",
      "enabled": true
    }
  }
}
```

### 8.4 Enable/Disable MCPs

MCPs can be enabled or disabled without removing them from configuration:

**Via Web UI:**
- **Dashboard** (http://localhost:4000): See "Global MCPs" sidebar, click Enable/Disable button
- **Project Page** (http://localhost:4000/project/{id}): See "MCP Servers" section with toggle buttons

**Via API:**
```bash
# Toggle global MCP
curl -X POST http://localhost:4000/api/mcps/playwright/toggle

# Toggle project MCP
curl -X POST http://localhost:4000/api/project/{projectId}/mcps/{name}/toggle
```

**Behavior:**
- `enabled: true` (default) - MCP is available to agents
- `enabled: false` - MCP exists in config but agents cannot use it
- Toggle persists to config file automatically

### 8.5 Agent Usage Flow

```
# 1. Discover available MCPs (informative list)
list_mcps()
→ 🔌 Available MCP Servers:
  - playwright 🌐: Browser automation
  - github 🌐: GitHub API

# 2. See tools for a specific server (connects on first use)
list_mcp_tools("playwright")
→ 🔧 Tools from "playwright":
  - browser_navigate(url): Navigate to URL
  - browser_click(selector): Click element
  - browser_screenshot(): Take screenshot
  ...

# 3. Use a tool
use_mcp("playwright", "browser_navigate", { url: "https://example.com" })
→ ✅ playwright.browser_navigate result: Navigated to https://example.com
```

### 8.6 How Users Manage MCPs

**Add a global MCP:**
```bash
# Edit /mcp-config.json to add new server
nano /workspaces/society-agent/mcp-config.json
```

**Add a project-specific MCP:**
```bash
# Create project MCP config
mkdir -p projects/architect/
cat > projects/architect/mcp.json << 'EOF'
{
  "servers": {
    "my-custom-server": {
      "command": "python",
      "args": ["./mcp-server.py"],
      "description": "Custom integration for this project"
    }
  }
}
EOF
```

### 8.7 Security Considerations

| Risk | Mitigation |
|------|------------|
| Malicious MCP | User-only registration (agents can't add) |
| Token costs | Lazy loading (connect on demand) |
| Data leakage | User controls which MCPs are available |
| Resource usage | Idle timeout (servers disconnect after 5min) |
| Unwanted access | Enable/disable toggle (no config delete needed) |

---

## 9. Git Management for Projects

### 9.1 Overview

Projects are excluded from the main society-agent repository (`projects/` in `.gitignore`). Each project can have its own git repository, managed by agents with user approval for critical operations.

### 9.2 Permission Model

| Operation | Approval Needed | Notes |
|-----------|-----------------|-------|
| `git init`, `git remote add` | ❌ No | Setup operations |
| `git status`, `git diff`, `git log` | ❌ No | Read-only |
| `git add`, `git commit` | ❌ No | Local only |
| `git branch`, `git checkout -b` | ❌ No | Local branching |
| `git fetch`, `git pull` | ❌ No | Receiving changes |
| `git push` | ✅ Yes | Sends to remote |
| `git push --force` | ✅ Yes | Destructive |
| `git reset --hard` | ✅ Yes | Destructive |
| `git rebase` (on shared branches) | ✅ Yes | Rewrites history |

### 9.3 Default Pattern: One Repo Per Project

```
projects/
├── architect/
│   ├── .git/                    ← Project repo
│   ├── KNOWLEDGE.md
│   ├── agent2/                  ← Agent folder (in same repo)
│   ├── documentation-specialist/
│   └── testing-specialist/
├── john/
│   ├── .git/                    ← Project repo
│   ├── papers/
│   └── research/
└── coder/
    └── .git/                    ← Project repo
```

All agents/folders in a project share one repository.

### 9.4 Agent Setup Flow

When an agent needs to initialize git for a project:

```
Agent: I'll set up git for this project.

# 1. Initialize repo
git init

# 2. Create .gitignore for common exclusions
echo "node_modules/
*.log
.env
" > .gitignore

# 3. Initial commit
git add .
git commit -m "Initial project setup"

# 4. Add remote (if provided)
git remote add origin git@gitlab.com:user/project.git

# 5. Push requires approval
Agent: "Ready to push to origin/main. Approve?"
       [Request Approval: git push -u origin main]

User: [Approve] ✓

Agent: Pushed successfully.
```

### 9.5 Subtrees (Optional)

If a sub-agent needs to split out a folder to its own repo:

```bash
# Agent creates subtree for agent2 to have independent repo
git subtree split --prefix=agent2 -b agent2-branch
git push git@gitlab.com:user/agent2-api.git agent2-branch:main

# Later sync changes
git subtree push --prefix=agent2 git@gitlab.com:user/agent2-api.git main
```

This is not the default - only used when an agent explicitly needs an independent deployment or separate versioning.

### 9.6 Workflow Example

```
User: "Commit and push the API changes"

Agent:
1. git status → shows modified files
2. git diff → reviews changes
3. git add . && git commit -m "Add user authentication API"
4. [Request Approval: git push origin main]

User: [Approve]

Agent: ✅ Pushed 1 commit to origin/main
```

