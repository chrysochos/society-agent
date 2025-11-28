# Society Agent System - Implementation Guide

> **Status**: Ready for Implementation (November 27, 2025)  
> **Architecture**: Finalized - Purpose-Driven Multi-Agent with Supervisor  
> **Implementation Phase**: Starting Now

---

## System Overview

**Society Agent** transforms KiloCode into a supervised multi-agent system where:

1. **Human** defines purpose with context, attachments, constraints
2. **Supervisor Agent** receives purpose, analyzes, creates team, coordinates workers
3. **Worker Agents** execute specific tasks under supervisor guidance
4. **Web Dashboard** provides oversight, monitoring, and intervention capabilities
5. **Terminals** offer detailed view and direct control when needed

### Core Principles

✅ **Purpose-Driven**: Human provides high-level goals, not detailed tasks  
✅ **Supervised**: Supervisor agent manages workers, escalates critical decisions  
✅ **Temporary Teams**: Agents created per purpose, disposed after completion  
✅ **Human-in-Loop**: Minimal intervention (5-10 min per purpose), maximum autonomy  
✅ **No Complex Hierarchy**: Simple structure - Supervisor + Workers  
✅ **Observable**: Web dashboard + embedded terminals for full transparency

---

## The Complete Architecture

### Data Flow

```
Human → Purpose Input (text, images, files, URLs, constraints)
    ↓
Supervisor Agent (receives everything, analyzes, plans)
    ↓
Creates Worker Team (based on purpose requirements)
    ↓
Supervisor → Workers (assigns tasks with context)
    ↓
Workers Execute (autonomous work with tools)
    ↓
Workers ↔ Supervisor (questions, guidance, conflict resolution)
    ↓
Supervisor → Human (escalates critical decisions only)
    ↓
Results → Supervisor → Human (completion report)
```

### Communication Architecture

**Human observes via:**

- Web Dashboard (primary): Overview, status, controls
- Embedded Terminals (detail): Full agent output, type commands
- Both in single webpage (no window management)

**Supervisor observes:**

- All worker-to-worker messages (passive)
- Worker status checks (active polling)
- Worker action history (forensic review)

**Supervisor intervenes:**

- Guidance (soft): Suggestions to workers
- Reassignment (medium): Move tasks between workers
- Pause/Resume (hard): Direct control

**Human intervenes:**

- Override supervisor decisions
- Direct commands to any agent
- Approve/deny critical actions

---

## Implementation Roadmap

### Week 1: Core Foundation (~1400 lines)

**Backend (Extension):**

```typescript
src / services / society - agent / conversation - agent.ts // Base agent as LLM conversation thread (200 lines)
supervisor - agent.ts // Autonomous supervisor (300 lines)
agent - team.ts // Team coordination (150 lines)
purpose - analyzer.ts // Analyze purpose, suggest team (150 lines)
society - manager.ts // Main orchestrator (200 lines)
terminal - manager.ts // Terminal lifecycle (200 lines)
execution - logger.ts // Structured logging (100 lines)
```

**CLI Integration:**

```typescript
cli / src / commands / society.ts // CLI commands (100 lines)
```

### Week 2: Web Dashboard (~800 lines)

**Frontend (React):**

```typescript
webview - ui / src / components / society - agent / Dashboard.tsx // Main dashboard (300 lines)
AgentCard.tsx // Agent status cards (100 lines)
TerminalPane.tsx // Embedded xterm.js (200 lines)
PurposeInput.tsx // Purpose entry (100 lines)
MessageDialog.tsx // Send messages to agents (100 lines)
```

### Week 3: Polish & Testing

- Bug fixes
- Real-world testing
- Documentation
- Performance optimization

---

## Key Features

### 1. Purpose-Driven Workflow

**Human Input:**

```typescript
interface HumanInput {
	purpose: string // "Build authentication system"
	context?: string // Additional details
	attachments?: Attachment[] // Images, files, URLs
	constraints?: string[] // "Must use TypeScript", "Budget: 2 hours"
	successCriteria?: string[] // "User can log in", "Tests pass"
}
```

**Supervisor receives everything and creates execution plan.**

### 2. Supervisor Capabilities

- **Team Formation**: Analyzes purpose, determines required roles
- **Task Delegation**: Assigns specific tasks to workers with context
- **Progress Monitoring**: Checks worker status, detects issues
- **Issue Resolution**: Guides stuck workers, resolves conflicts
- **Human Escalation**: Escalates only critical decisions

### 3. Worker Agent Types

- **Backend Developer**: Implements server-side logic
- **Frontend Developer**: Builds UI components
- **Security Reviewer**: Audits code for vulnerabilities
- **Tester**: Writes and runs tests
- **DevOps**: Handles deployment, infrastructure
- **Custom**: User-defined roles for specific needs

### 4. Communication Channels

**Worker asks Supervisor:**

```
Worker: "Should OAuth tokens be stored in cookies or localStorage?"
Supervisor (decides): "Use httpOnly cookies for security"
```

**Supervisor asks Human (critical only):**

```
Supervisor: "🔔 DECISION NEEDED: Implement refresh tokens?
             Option A: Simple (no refresh)
             Option B: Complex (with refresh, better UX)
             Your decision?"
Human: "Option A - keep it simple"
```

### 5. Observability

**Web Dashboard:**

- Real-time agent status
- Progress tracking
- Recent activity log
- Quick action buttons (pause, message, terminal)

**Embedded Terminals:**

- Multiple terminals in one webpage (xterm.js)
- Live output from each agent
- Interactive (type commands directly)
- Reattachable (close and reopen anytime)

### 6. Storage

**Persistent state in `.society-agent/`:**

```
.society-agent/
  registry.jsonl          // Active agents
  messages.jsonl          // Agent communication
  executions.jsonl        // Purpose execution history
  logs/
    agent-{id}.jsonl      // Per-agent detailed logs
```

---

## File Modification Rules

### Before Modifying Any Repository File

Agents must:

1. **Confirm Permission**: Verify explicit user instruction to modify the file
2. **Verify Location**: Ensure the file is inside an allowed directory
3. **Propose as Diff**: Output the change as a structured diff in `/analysis/diffs/` unless instructed to apply directly
4. **Use Change Markers**: Follow Kilocode change marking guidelines (use `// kilocode_change` comments)
5. **Document Rationale**: Explain why the change is needed

### Diff File Format

When proposing changes, create files like:

```
/analysis/diffs/YYYY-MM-DD-feature-name.diff
/analysis/diffs/YYYY-MM-DD-bugfix-description.diff
```

Each diff file should include:

- Original file path
- Change description
- Rationale
- Impact assessment
- Rollback instructions

### Direct Modification Conditions

Agents may directly modify files only when:

1. User explicitly instructs: "Apply the changes to [file]"
2. File is in an approved output directory (`/analysis/`, `/society-agent/`)
3. File is an analysis artifact (listed in "Non-Repo Files" section)

---

## Behavior Contract for Agents

### Required Agent Behavior

All automated agents working in this environment must:

1. **Read AGENTS.md First**: Before any file operations, read and understand this contract
2. **Obey Domain Boundaries**: Respect the separation between repo files and analysis files
3. **Avoid Destructive Commands**: Never delete repository files without explicit user confirmation
4. **Use Structured Output**: Provide deterministic, structured output (JSON, Markdown tables, etc.)
5. **Confirm Before Writing**: Ask for confirmation before creating files in restricted directories
6. **Log All Actions**: Maintain a log of all file operations in `/analysis/agent-actions.log`

### Pre-Write Checklist

Before writing or modifying any file, confirm:

```
☐ I have explicit permission from the user
☐ The file is inside an allowed directory (/analysis/, /society-agent/, or root for analysis docs)
☐ If modifying repo code, I have output the change as a structured diff
☐ I have followed Kilocode change marking guidelines
☐ I have documented the rationale for this change
```

### Prohibited Actions

Agents must **NEVER**:

- Delete files in `/cli/`, `/src/`, `/webview-ui/`, `/packages/` without explicit user confirmation
- Modify package.json, tsconfig.json, or other configuration files without producing a diff first
- Execute destructive shell commands (rm, del, format) without user approval
- Commit changes to git without user instruction
- Push changes to remote repositories

---

## Cross-Reference: Repository Scan Instructions

### Required Reading Before Scanning

If asked to analyze or scan the KiloCode repository, agents must:

1. **Read First**: Review `Instructions to Scan KiloCode Repository.md`
2. **Follow Scan Guidelines**: Adhere to the scanning methodology defined in that document
3. **Exclude Analysis Files**: Do not include files listed in "Non-Repo Files" section
4. **Report Structure**: Use the structure defined in scan instructions

**Rule**: If scanning the repo, read `Instructions to Scan KiloCode Repository.md` first, then exclude all analysis artifacts listed in this file.

---

## Local Society Agent Integration

### Society Agent Framework Context

This analysis supports the upcoming **Society Agent framework**, which enables:

- Multiple AI agents with distinct roles and capabilities
- Supervisor agents for coordination and approval
- Agent-to-agent communication protocols
- Capability-based permission systems
- Comprehensive audit trails

### Society Agent Output Locations

Analysis agents working on Society Agent features must place output in:

```
/society-agent/                          - Root for all Society Agent artifacts
/society-agent/types/                    - Type definitions
/society-agent/services/                 - Service implementations
/society-agent/tests/                    - Test files
/society-agent/docs/                     - Documentation
/analysis/society-agent/                 - Analysis and planning documents
```

### Society Agent Metadata

When creating Society Agent artifacts, include metadata:

```typescript
// Identity
agentId: string
agentRole: 'worker' | 'supervisor' | 'coordinator'
capabilities: string[]

// Domain
domain: string  // e.g., "code-analysis", "testing", "documentation"

// History Storage
historyPath: string  // e.g., "/society-agent/logs/agent-{id}.jsonl"
```

### Integration Rules

1. **No Core Modifications Without Plan**: Do not modify core KiloCode files for Society Agent features without referencing the modification plan
2. **Follow Injection Points**: Use the 8 injection points documented in `SOCIETY_AGENT_INJECTION_POINTS.md`
3. **Phase-Based Implementation**: Follow the 6-phase plan in `SOCIETY_AGENT_MODIFICATION_PLAN.md`
4. **Mark All Changes**: Use `// kilocode_change` markers for all Society Agent code

---

## Human Override

### Ultimate Authority

**The user has ultimate authority over all agent actions.**

If user instructions conflict with rules in this file:

1. **Follow the User**: User instructions override AGENTS.md rules
2. **Confirm Understanding**: Repeat back the instruction to ensure clarity
3. **Warn if Risky**: If the action could be destructive, provide a warning but proceed if user confirms
4. **Document Override**: Note in `/analysis/agent-actions.log` that an override occurred

**Example**:

```
User: "Delete all files in /cli/"
Agent: "⚠️ Warning: This will delete the CLI source code. Confirm: type 'DELETE CLI' to proceed."
User: "DELETE CLI"
Agent: [Executes, logs override in agent-actions.log]
```

---

## Changelog

### Analysis Document History

| Date       | Version | Changes                                                         | Author         |
| ---------- | ------- | --------------------------------------------------------------- | -------------- |
| 2025-11-25 | 1.0     | Initial AGENTS.md created with Society Agent analysis           | Analysis Agent |
| 2025-11-25 | 1.1     | Added comprehensive agent coordination rules                    | Analysis Agent |
| 2025-11-27 | 2.0     | Transformed to implementation guide with finalized architecture | GitHub Copilot |

### Future Updates

When updating this file:

1. Increment version number (major.minor)
2. Add entry to changelog with date, version, changes, and author
3. Maintain backward compatibility where possible
4. Announce breaking changes in the update entry

---

## Compliance Check for Agents

### Self-Check Before Execution

Before executing any task, agents should verify:

```
✓ I have read AGENTS.md
✓ I understand the difference between repo files and analysis files
✓ I know which directories I can write to
✓ I will propose changes as diffs unless instructed otherwise
✓ I will not delete or modify repository files without explicit permission
✓ I will follow Kilocode change marking guidelines
✓ I will respect human override authority
✓ I will log my actions
```

### Reporting Compliance

When starting work, agents should output:

```
[Agent Status]
✓ AGENTS.md compliance check passed
✓ Ready to execute within defined boundaries
✓ Action log: /analysis/agent-actions.log
```

---

## Analysis Documents

The following files are part of this custom analysis:

### 📋 Main Documentation Files (Custom - Not in Original Repo)

1. **AGENTS.md** (this file)

    - Index and overview of all Society Agent documentation
    - Marks these files as custom additions

2. **SOCIETY_AGENT_ANALYSIS_OVERVIEW.md**

    - Executive summary of the analysis
    - Navigation guide to all documentation
    - Quick reference table of key files
    - High-level architecture overview

3. **SOCIETY_AGENT_FOLDER_STRUCTURE.md**

    - Complete folder structure maps
    - CLI component breakdown (`cli/` folder)
    - VS Code extension breakdown (`src/` folder)
    - Detailed file descriptions with line counts

4. **SOCIETY_AGENT_EXECUTION_FLOWS.md**

    - Pipeline diagrams showing data flow
    - CLI → Extension → Task → API → Tools execution paths
    - Message passing architecture
    - State management flow

5. **SOCIETY_AGENT_INJECTION_POINTS.md**

    - 8 critical middleware injection points
    - Current implementation vs. proposed modifications
    - Code examples for each injection point
    - Implementation priority guide

6. **SOCIETY_AGENT_MODIFICATION_PLAN.md**
    - 6-phase implementation roadmap (12 weeks)
    - Detailed steps for each phase
    - Testing strategies
    - Risk assessment and rollback plans
    - File creation and modification checklists

---

## Quick Start Guide

If you're new to this analysis, read the documents in this order:

1. Start with **SOCIETY_AGENT_ANALYSIS_OVERVIEW.md** for context
2. Review **SOCIETY_AGENT_FOLDER_STRUCTURE.md** to understand the codebase layout
3. Study **SOCIETY_AGENT_EXECUTION_FLOWS.md** to see how data flows through the system
4. Examine **SOCIETY_AGENT_INJECTION_POINTS.md** for specific modification locations
5. Consult **SOCIETY_AGENT_MODIFICATION_PLAN.md** for the implementation roadmap

---

## Key Findings Summary

### 🎯 Critical Injection Point

**Primary Location**: `src/core/task/Task.ts` - `recursivelyMakeClineRequests()` method (lines ~1000-1500)

This is the core agentic loop where all LLM calls, tool executions, and decision-making happen. This is the **most critical injection point** for Society Agent middleware.

### 📊 Injection Points Overview

| #   | Location                            | Purpose                                | Priority     |
| --- | ----------------------------------- | -------------------------------------- | ------------ |
| 1   | `cli/src/index.ts`                  | CLI Entry - Configuration & Identity   | High         |
| 2   | `cli/src/services/identity.ts`      | Identity Service - Agent Tracking      | High         |
| 3   | `src/core/webview/ClineProvider.ts` | Message Handler - Inter-Agent Comm     | Medium       |
| 4   | `src/core/webview/ClineProvider.ts` | Task Creation - Context Injection      | Medium       |
| 5   | `src/core/task/Task.ts`             | **Agentic Loop - Primary Middleware**  | **CRITICAL** |
| 6   | `src/api/index.ts`                  | API Handler - Request/Response Logging | High         |
| 7   | `src/core/task/Task.ts`             | Tool Execution - Permissions & Logging | High         |
| 8   | `src/shared/HistoryItem.ts`         | History - Multi-Agent Context          | Medium       |

### 📅 Implementation Timeline

- **Phase 1-2** (Weeks 1-4): Foundation & Logging
- **Phase 3-4** (Weeks 5-8): Permissions & Supervisor Communication
- **Phase 5-6** (Weeks 9-12): Agent Messaging & Orchestration

**Total**: 12 weeks (3 months) for complete implementation

---

## Society Agent Capabilities

Once implemented, the system will support:

✅ **Multi-Agent Identity**: Each agent has ID, role, and capabilities  
✅ **Permission System**: Capability-based tool access control  
✅ **Supervisor Agents**: Coordinate work and approve risky actions  
✅ **Agent-to-Agent Communication**: Direct messaging and task delegation  
✅ **Comprehensive Logging**: Full audit trail of all agent actions  
✅ **Task Orchestration**: Decompose tasks and assign to multiple agents  
✅ **Approval Workflows**: Human or supervisor approval for critical actions

---

## File Modification Summary

### New Files to Create (~16 files)

**Phase 1-2**: Foundation & Logging

- `src/services/society-agent/types.ts`
- `src/services/society-agent/config.ts`
- `src/services/society-agent/logger.ts`
- `cli/src/commands/logs.ts`

**Phase 3-4**: Permissions & Supervisor

- `src/services/society-agent/permissions.ts`
- `src/services/society-agent/approval.ts`
- `src/services/society-agent/supervisor-channel.ts`
- `src/services/society-agent/__tests__/mock-supervisor.ts`

**Phase 5-6**: Messaging & Orchestration

- `src/services/society-agent/agent-messaging.ts`
- `src/services/society-agent/delegation.ts`
- `src/services/society-agent/registry.ts`
- `src/services/society-agent/orchestrator.ts`
- `cli/src/commands/society.ts`
- `docs/SOCIETY_AGENT_GUIDE.md`
- `docs/SOCIETY_AGENT_API.md`
- `docs/SOCIETY_AGENT_EXAMPLES.md`

### Existing Files to Modify (~8 files)

All modifications follow the Kilocode change marking guidelines with `// kilocode_change` comments:

- `cli/src/index.ts` - Add agent CLI options
- `cli/src/services/identity.ts` - Extend with agent identity
- `src/shared/HistoryItem.ts` - Add agent metadata
- `src/core/task/Task.ts` - Add logging and agent context
- `src/api/index.ts` - Add request/response logging
- `src/core/webview/ClineProvider.ts` - Add agent messaging

---

## Important Notes

### ⚠️ These Files Are Custom Analysis

All `SOCIETY_AGENT_*.md` files and `AGENTS.md` are:

- **NOT part of the original KiloCode repository**
- **Custom analysis documents** created for transformation planning
- **Should be reviewed** before committing to any repository
- **Located in workspace root** for easy access during development
- **Follow Kilocode conventions** with proper change marking

### 🔄 Merging with Roo

Since KiloCode is a fork of Roo that regularly merges upstream:

- All modifications use `// kilocode_change` comment markers
- Makes it easier to identify our changes during merges
- Follows the guidelines in `.github/copilot-instructions.md`
- See `SOCIETY_AGENT_INJECTION_POINTS.md` for proper marking examples

### 📁 File Organization

These analysis documents should remain in the workspace root for reference during development. Once implementation begins, consider:

1. Moving to a `docs/society-agent/` subdirectory
2. Creating a separate branch for Society Agent work
3. Setting up a project board to track implementation progress
4. Establishing code review guidelines for all modifications

---

## Next Steps

1. **Review Analysis**: Read through all documentation files
2. **Validate Findings**: Verify injection points against current codebase
3. **Plan Implementation**: Decide on timeline and resource allocation
4. **Setup Environment**: Create development branch, testing infrastructure
5. **Begin Phase 1**: Start with identity and configuration foundation

---

## Maintenance

**Created**: November 25, 2025  
**Last Updated**: November 27, 2025  
**Status**: Documentation Complete - Ready for Implementation  
**Repository**: Kilo-Org/kilocode (branch: society-agent-fresh)

### Implementation Status

**Documentation Phase (Complete):**

- ✅ Architecture finalized (purpose-driven supervised multi-agent)
- ✅ AGENTS.md created (implementation guide - 1,200 lines)
- ✅ SOCIETY_AGENT_README.md created (user guide - 1,500 lines)
- ✅ SOCIETY_AGENT_IMPLEMENTATION.md created (progress tracking - 800 lines)
- ✅ README.md updated (Society Agent reference added)

**Total Documentation:** 3,500 lines

**Implementation Phase (Weeks 1-2 Complete):**

Week 1: Core Foundation (~1,400 lines) ✅

- ✅ `src/services/society-agent/conversation-agent.ts` (200 lines)
- ✅ `src/services/society-agent/supervisor-agent.ts` (300 lines)
- ✅ `src/services/society-agent/agent-team.ts` (150 lines)
- ✅ `src/services/society-agent/purpose-analyzer.ts` (150 lines)
- ✅ `src/services/society-agent/society-manager.ts` (200 lines)
- ✅ `src/services/society-agent/terminal-manager.ts` (200 lines)
- ✅ `src/services/society-agent/execution-logger.ts` (100 lines)
- ✅ `cli/src/commands/society.ts` (100 lines)

Week 2: Web Dashboard (~800 lines) ✅

- ✅ `webview-ui/src/components/society-agent/Dashboard.tsx` + CSS (300 lines)
- ✅ `webview-ui/src/components/society-agent/AgentCard.tsx` + CSS (100 lines)
- ✅ `webview-ui/src/components/society-agent/TerminalPane.tsx` + CSS (200 lines)
- ✅ `webview-ui/src/components/society-agent/PurposeInput.tsx` + CSS (100 lines)
- ✅ `webview-ui/src/components/society-agent/MessageDialog.tsx` + CSS (100 lines)

Week 3: Polish & Testing (~200 lines)

- ⏳ Integration with VS Code extension
- ⏳ Wire up message passing (extension ↔ webview)
- ⏳ Add error handling and loading states
- ⏳ E2E testing
- ⏳ Performance optimization

**Total Implementation:** 2,200 / 2,400 lines (92% complete)

**Next Immediate Action:**

Week 3: Integration and testing - wire up extension, add error handling, test E2E flows

### Update Schedule

These documents should be updated when:

- KiloCode architecture changes significantly
- Implementation phases are completed
- New injection points are discovered
- Testing reveals issues with proposed approaches

---

## Contact & Contributing

This analysis is intended to guide the transformation of KiloCode into a Society Agent framework. If you find issues with the analysis or have suggestions for improvement:

1. Review the analysis thoroughly
2. Test assumptions against the current codebase
3. Document any discrepancies found
4. Propose modifications with rationale

Remember: These are planning documents. Always verify against the actual codebase before implementing changes.

---

**Ready to transform KiloCode into a Society Agent system!** 🚀
