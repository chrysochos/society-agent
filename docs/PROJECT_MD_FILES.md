# Project Markdown Files Guide

**Version:** 1.0  
**Date:** March 26, 2026  
**Location:** `/docs/PROJECT_MD_FILES.md`

---

## Overview

Society Agent uses markdown files as the primary mechanism for:
- **Agent memory** — persistent knowledge that survives across conversations
- **Task coordination** — specifications, reports, and reviews between agents
- **State tracking** — current progress, goals, and blockers

This document explains each file type, when it's created, who writes it, and how it's used.

---

## 1. Knowledge Files (Agent Memory)

These files live in each agent's home folder and serve as their persistent memory.

### 1.1 AGENTS.md — The Knowledge Index

**Purpose:** Lazy-loading index of all agent knowledge. Read this FIRST to understand what exists without loading everything into context.

**Location:** `<agent-folder>/AGENTS.md`

**Created:** Automatically when agent is created via `propose_new_agent` or UI.

**Updated by:** The agent, whenever they create or modify knowledge files.

**Structure:**
```markdown
# Agent Name - Knowledge Index

## 📋 HOW TO USE THIS INDEX
1. Read this file FIRST to understand what knowledge exists
2. Only read detailed files when you NEED them for the current task
3. Update this index whenever you create/modify knowledge files

## 🔄 Current State
- **Status**: Active | Blocked | Waiting
- **Last Task**: What was completed
- **Working On**: Current focus
- **Blocked By**: Dependencies

## 🎯 Desired State
- **Primary Goal**: Main objective
- **Success Criteria**: How to measure success
- **Deadline**: If any

## 📚 Knowledge Files Index
| File | Contains | When to Read |
|------|----------|--------------|
| `KNOWLEDGE.md` | Tips, context, facts | When needing project info |
| `STATE.md` | Detailed state | When planning work |
| `ERRORS.md` | Past errors & solutions | When debugging |

## 👥 Team Members (for supervisors)
| Agent ID | Name | Role | Folder |
|----------|------|------|--------|
| backend | Backend Dev | API developer | `backend/` |
```

**Best Practice:** Keep this file concise — it's loaded into context frequently.

---

### 1.2 PLAN.md — Task Checklist

**Purpose:** Track deliverables and progress. Supervisors delegate by sending task lists; agents write them here.

**Location:** `<agent-folder>/PLAN.md`

**Created:** By the agent when they receive tasks or plan work.

**Updated by:** The agent as they complete items.

**Structure:**
```markdown
# Plan - Agent Name

## Current Sprint

- [ ] POST /api/login — returns signed JWT
- [ ] Auth middleware — validates JWT on protected routes
- [x] Password reset flow (commit: abc1234)

## Completed

- [x] Database schema setup (commit: def5678)
- [x] User model (commit: 789abc0)

## Blocked

- [ ] OAuth integration — waiting for API keys from supervisor
```

**Rules:**
- Supervisors CANNOT write to subordinate's PLAN.md directly
- Supervisors send task lists via `delegate_task` or `send_message`
- The subordinate writes the checklist themselves
- Mark items `[x]` with commit hash when done

---

### 1.3 STATE.md — Detailed Current/Desired State

**Purpose:** Detailed description of where we are and where we're going. More verbose than AGENTS.md summary.

**Location:** `<agent-folder>/STATE.md`

**Created:** By the agent when they need to track complex state.

**Structure:**
```markdown
# State - Backend Specialist

## Current State

### Services Running
- API server on port 6001 ✓
- Database connected ✓
- Redis cache NOT running

### Completed Features
- User authentication (JWT)
- Email CRUD operations
- Folder management

### Known Issues
- Rate limiting not implemented
- No request validation on /api/emails

## Desired State

### Immediate Goals
- Implement rate limiting (100 req/min per user)
- Add Zod validation to all endpoints

### Success Criteria
- All tests pass
- No TypeScript errors
- API responds < 200ms p95
```

---

### 1.4 KNOWLEDGE.md — Facts, Tips, Context

**Purpose:** Project-specific facts, tips, conventions, and context that the agent learns over time.

**Location:** `<agent-folder>/KNOWLEDGE.md`

**Created:** By the agent when they discover important information.

**Structure:**
```markdown
# Knowledge - Backend Specialist

## Project Facts
- API runs on port 6001
- Frontend expects JSON responses with `{ data, error }` structure
- SQLite database at `./data/email.db`

## Conventions
- Use Zod for all request validation
- Errors return HTTP 4xx with `{ error: string }`
- All timestamps are ISO 8601

## Tips & Gotchas
- The email parser fails on malformed headers — wrap in try/catch
- SQLite doesn't support concurrent writes — use transactions

## Dependencies
- express: 4.18.2
- better-sqlite3: 9.4.3
- zod: 3.22.4
```

---

### 1.5 ERRORS.md — Error Tracking & Solutions

**Purpose:** Automatically captured tool failures and their solutions. Enables learning from mistakes.

**Location:** `<agent-folder>/ERRORS.md`

**Created:** Automatically by the system when a tool fails.

**Updated by:** The agent when they solve an error.

**Structure:**
```markdown
# Errors - Backend Specialist

## Active Errors

### ERR-2026-03-26-001
- **Tool**: run_command
- **Command**: `npm run build`
- **Error**: `Cannot find module 'zod'`
- **First Seen**: 2026-03-26T10:30:00Z
- **Occurrences**: 3
- **Status**: ACTIVE

## Solved Errors

### ERR-2026-03-25-003
- **Tool**: run_command
- **Error**: `EADDRINUSE: port 6001`
- **Solution**: Kill existing process with `lsof -ti:6001 | xargs kill -9`
- **Solved**: 2026-03-25T15:45:00Z
- **Promoted to Skill**: No
```

**Workflow:**
1. System auto-captures failed tool calls
2. Agent reads ERRORS.md when debugging recurring issues
3. When solved, agent updates with solution
4. Valuable solutions can be promoted to Skills

---

### 1.6 FILES.md — File Ownership Registry

**Purpose:** Track which agent owns which files. Used for access control and coordination.

**Location:** `<project-folder>/FILES.md` (project-level, not per-agent)

**Created:** Automatically by the system.

**Structure:**
```markdown
# File Ownership Registry

## Files by Owner

### backend-specialist
| File | Type | Last Modified |
|------|------|---------------|
| `backend/src/index.ts` | source | 2026-03-26 |
| `backend/src/routes/auth.ts` | source | 2026-03-26 |

### frontend-specialist
| File | Type | Last Modified |
|------|------|---------------|
| `frontend/src/App.tsx` | source | 2026-03-25 |
```

---

## 2. Task Delegation Files

These files coordinate work between supervisors and subordinates.

### 2.1 DESIRED_STATE.md — High-Level Task Specs

**Purpose:** Specifications for persistent agents created by `delegate_task`. Describes WHAT should exist when done.

**Location:** `<subordinate-folder>/DESIRED_STATE.md`

**Created:** Automatically when supervisor calls `delegate_task(agent_id, task, desired_state, ...)`.

**Written by:** System (populated from delegate_task parameters).

**Structure:**
```markdown
# Desired State

**Task:** Implement user authentication

**Delegated by:** architect  
**Delegated at:** 2026-03-26T10:00:00Z  
**Priority:** high

## Desired State
When complete, the following should exist:
- POST /api/auth/login — accepts email/password, returns JWT
- POST /api/auth/register — creates new user
- GET /api/auth/me — returns current user from JWT
- Auth middleware that validates JWT on protected routes

## Acceptance Criteria
- [ ] All endpoints return proper error codes
- [ ] Passwords are hashed with bcrypt
- [ ] JWT expires in 7 days
- [ ] Tests cover happy path and error cases

## Constraints
- Do NOT modify the database schema without approval
- Do NOT use sessions — JWT only
- Do NOT store plain-text passwords

## Context
This is for the email client. Frontend team is waiting on these endpoints to implement login UI.
```

**Workflow:**
1. Supervisor calls `delegate_task("backend", "Implement auth", ...)`
2. System saves specs to `backend/DESIRED_STATE.md`
3. Subordinate reads it and works autonomously
4. Subordinate updates their PLAN.md with checklist
5. Subordinate reports back when done

---

### 2.2 CHANGE_BRIEF_XXX.md — Detailed Work Orders

**Purpose:** Formal specifications for ephemeral workers. More detailed than DESIRED_STATE — specifies exact files allowed/forbidden.

**Location:** `<custodian-folder>/CHANGE_BRIEF_<id>.md`

**Created:** By the custodian (permanent agent) before spawning workers.

> **Custodian vs Worker Model**
> 
> **Custodians** are permanent agents (like "backend" or "architect") that:
> - **Cannot write code** (only `.md`, `.txt` files)
> - Create CHANGE_BRIEF files specifying what to build
> - Create tasks with `create_task("Title", "CHANGE_BRIEF_XXX.md")`
> - Spawn workers with `spawn_worker(count)`
> - Review CHANGE_REPORT files when workers finish
> 
> **Workers** are ephemeral agents (Worker #1, Worker #2...) that:
> - Claim tasks with `claim_task()`
> - Read the CHANGE_BRIEF to understand boundaries
> - **Can write code** within allowed files
> - Submit CHANGE_REPORT when done
> - **Self-destruct** after completing (or failing) the task
> 
> This separation ensures permanent agents maintain oversight while ephemeral workers do the risky code changes.

**Structure:**
```yaml
---
change_id: CHG-2026-03-26-001
module: backend/auth
request: "Add rate limiting to login endpoint"
classification: security enhancement
risk: medium
owned_by_module: true
---

# Change Brief: Add Rate Limiting

## Request
Implement rate limiting on POST /api/auth/login to prevent brute force attacks.

## Allowed Files
- `backend/src/routes/auth.ts`
- `backend/src/middleware/rateLimit.ts` (create)
- `backend/src/config.ts`

## Forbidden Files
- `backend/src/db/*` — no database changes
- `backend/src/routes/email.ts` — out of scope
- `shared/*` — requires coordination

## Contracts to Preserve
- Login endpoint signature: `POST /api/auth/login { email, password } → { token }`
- Error response format: `{ error: string }`

## Required Checks
- [ ] Rate limit triggers after 5 failed attempts
- [ ] Returns 429 Too Many Requests
- [ ] Existing tests still pass

## Required Documentation
- Update `backend/README.md` with rate limit info

## Notes
- Use in-memory store for MVP (Redis later)
- 15-minute lockout window
```

---

### 2.3 CHANGE_REPORT_XXX.md — Implementation Report

**Purpose:** Worker's report after completing work. Documents what was actually done.

**Location:** `<custodian-folder>/CHANGE_REPORT_<id>.md`

**Created:** By the ephemeral worker after implementation.

**Structure:**
```yaml
---
change_id: CHG-2026-03-26-001
status: implemented
---

# Change Report: Add Rate Limiting

## Files Changed
- `backend/src/routes/auth.ts` — added rate limit middleware
- `backend/src/middleware/rateLimit.ts` — new file
- `backend/src/config.ts` — added RATE_LIMIT_* constants
- `backend/README.md` — documented rate limiting

## Files NOT Changed
- Database files (as instructed)
- Other routes (out of scope)

## Tests
- Added `backend/__tests__/rateLimit.test.ts`
- All existing tests pass ✓

## Deviations from Brief
- None

## Known Risks
- In-memory store resets on server restart
- No distributed support (single server only)

## Assumptions
- 5 attempts per 15 minutes is acceptable
- Client will handle 429 responses gracefully
```

---

### 2.4 REVIEW_RESULT_XXX.md — Supervisor Review

**Purpose:** Custodian's review of completed work. Accept, reject, or request revisions.

**Location:** `<custodian-folder>/REVIEW_RESULT_<id>.md`

**Created:** By the custodian after reviewing CHANGE_REPORT.

**Structure:**
```yaml
---
change_id: CHG-2026-03-26-001
result: accepted
---

# Review Result: Add Rate Limiting

## Decision: ✅ ACCEPTED

## Checklist
- [x] Boundaries respected — only touched allowed files
- [x] Contracts preserved — API signature unchanged
- [x] Tests added/updated
- [x] Documentation updated

## Notes
- Clean implementation
- Good error handling

## Follow-up Work
- [ ] Add Redis support for distributed deployments (future sprint)

## Module Memory Update
- Added to KNOWLEDGE.md: "Rate limiting: 5 attempts per 15 min, in-memory store"
```

---

## 3. Workflow Examples

### 3.1 Supervisor Delegating to Persistent Agent

```
1. User → Architect: "Implement user auth"

2. Architect calls:
   delegate_task("backend", "Implement auth", 
     desired_state="POST /api/login returns JWT...",
     acceptance_criteria=["Passwords hashed", "JWT expires in 7d"],
     constraints=["No plain-text passwords"])

3. System creates: backend/DESIRED_STATE.md

4. Backend reads DESIRED_STATE.md, creates PLAN.md:
   - [ ] POST /api/login
   - [ ] Auth middleware
   - [ ] Tests

5. Backend implements, checks off PLAN.md

6. Backend → Architect: "Auth complete, commits: abc123, def456"

7. Architect verifies: git log, http_request to test endpoints

8. Architect updates own PLAN.md: [x] Auth system (abc123, def456)
```

### 3.2 Custodian Using Ephemeral Workers

```
1. Custodian creates CHANGE_BRIEF_001.md with detailed specs

2. Custodian creates task:
   create_task("Add rate limiting", "CHANGE_BRIEF_001.md")

3. Custodian spawns worker:
   spawn_worker(1)

4. Worker reads CHANGE_BRIEF_001.md

5. Worker implements within boundaries

6. Worker creates CHANGE_REPORT_001.md

7. Worker completes task

8. Custodian reviews CHANGE_REPORT_001.md

9. Custodian creates REVIEW_RESULT_001.md

10. If accepted: custodian updates KNOWLEDGE.md
    If rejected: custodian creates new CHANGE_BRIEF with fixes
```

---

## 4. File Hierarchy Summary

```
project-folder/
├── FILES.md                    # Project-wide file ownership
│
├── architect/                  # Top supervisor
│   ├── AGENTS.md              # Knowledge index
│   ├── PLAN.md                # High-level deliverables
│   ├── KNOWLEDGE.md           # Project facts
│   ├── CHANGE_BRIEF_001.md    # Work order for workers
│   ├── CHANGE_REPORT_001.md   # Worker's report
│   └── REVIEW_RESULT_001.md   # Review decision
│
├── backend/                    # Subordinate agent
│   ├── AGENTS.md              # Knowledge index
│   ├── PLAN.md                # Task checklist
│   ├── DESIRED_STATE.md       # Specs from supervisor
│   ├── STATE.md               # Detailed state
│   ├── KNOWLEDGE.md           # Backend-specific facts
│   └── ERRORS.md              # Error tracking
│
└── frontend/                   # Another subordinate
    ├── AGENTS.md
    ├── PLAN.md
    └── ...
```

---

## 5. Best Practices

### For Agents
1. **Read AGENTS.md first** — understand what knowledge exists before loading files
2. **Keep AGENTS.md concise** — it's loaded frequently
3. **Update PLAN.md immediately** — mark items done with commit hashes
4. **Document solutions in ERRORS.md** — help future self
5. **Save facts to KNOWLEDGE.md** — don't rely on memory

### For Supervisors
1. **Never write to subordinate's PLAN.md** — send tasks via delegate_task or send_message
2. **Always verify with commit hashes** — don't trust "done" without proof
3. **Use CHANGE_BRIEF for risky changes** — explicit boundaries prevent accidents
4. **Update KNOWLEDGE.md after reviews** — capture learnings

### For the System
1. **Auto-create AGENTS.md** — every new agent gets a knowledge index
2. **Auto-capture errors to ERRORS.md** — learning from failures
3. **Generate FILES.md** — track ownership automatically
4. **Populate DESIRED_STATE.md** — from delegate_task parameters

---

## 6. Quick Reference

| File | Who Creates | Who Updates | Purpose |
|------|-------------|-------------|---------|
| AGENTS.md | System | Agent | Knowledge index |
| PLAN.md | Agent | Agent | Task tracking |
| STATE.md | Agent | Agent | Detailed state |
| KNOWLEDGE.md | Agent | Agent | Facts & tips |
| ERRORS.md | System | Agent | Error tracking |
| FILES.md | System | System | File ownership |
| DESIRED_STATE.md | System (delegate_task) | — | Task specs |
| CHANGE_BRIEF_XXX.md | Custodian | — | Work order |
| CHANGE_REPORT_XXX.md | Worker | — | Implementation report |
| REVIEW_RESULT_XXX.md | Custodian | — | Review decision |
