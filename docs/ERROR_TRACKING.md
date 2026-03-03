# Error Tracking & Learning System

**Version:** 1.0  
**Date:** March 2, 2026  
**Location:** `/docs/ERROR_TRACKING.md`

---

## Overview

The Error Tracking system automatically captures tool failures, enables agents to record solutions, and promotes recurring solutions to reusable Skills.

```
Tool Fails → ERRORS.md → Agent Solves → Promote to Skill
     ↓            ↓             ↓              ↓
  Automatic   Organized    Manual by      Reusable
   capture    by tool       agent        procedure
```

---

## 1. ERRORS.md - Automatic Error Capture

### What Gets Logged

When any tool returns an error (result starts with ❌), the system automatically:

1. Creates/updates `ERRORS.md` in the agent's home folder
2. Organizes errors by tool name
3. Deduplicates similar errors using pattern signatures
4. Limits entries to prevent unbounded growth

### File Location

```
projects/
└── my-project/
    ├── ERRORS.md              # Root agent errors
    └── backend-specialist/
        └── ERRORS.md          # Sub-agent errors
```

### File Format

```markdown
# Errors Log

Tool errors for learning. Update **Solution** when you solve an error.
When a solution works well, consider creating a Skill in `skills/` folder.

## run_command

**Solution:** Use subshell for background processes: (cd /path && npm start) &

### Occurrences
- **2026-03-02 10:15:30** | **Count:** 3 | **Last seen:** 2026-03-02 14:22:10
  Pattern: `bash: cd: /PATH: No such file or directory`
  Error: ❌ Command failed: cd backend-specialist && npm run dev...

## read_file

**Solution:** (not yet solved)

### Occurrences
- **2026-03-02 11:00:00** | **Count:** 1 | **Last seen:** 2026-03-02 11:00:00
  Pattern: `ENOENT: no such file or directory`
  Error: ❌ File not found: /projects/my-project/config.json
```

---

## 2. Deduplication & Limits

### Error Signature Extraction

To avoid duplicate entries, errors are normalized to a "signature":

| Original Error | Signature |
|----------------|-----------|
| `/home/john/projects/foo.ts:42:10` | `/PATH:LINE:COL` |
| `2026-03-02T14:30:00 ERROR` | `ERROR` |
| `0x7fff5fbff8c0` | `0xADDR` |

Same signature → increment count instead of new entry.

### Limits

| Limit | Value | Purpose |
|-------|-------|---------|
| Max occurrences per tool | 5 | Prevent unbounded growth |
| Error preview length | 200 chars | Keep entries compact |
| Pattern length | 80 chars | Sufficient for matching |

When limit reached → oldest entry dropped, newest added.

---

## 3. Agent Workflow

### Reading Errors

Agents are instructed (via BASE_AGENT_RULES) to:

1. Check ERRORS.md when hitting recurring errors
2. Look for existing solutions before debugging
3. Update the **Solution** field when they solve an error

### Writing Solutions

When an agent solves an error, they should update ERRORS.md:

```markdown
## run_command

**Solution:** Use subshell for background processes: (cd /path && npm start) &
```

This solution then helps the agent (and other agents) in future sessions.

---

## 4. Promote to Skill

### When to Promote

Promote an error solution to a Skill when:

- The solution is well-tested and reliable
- The error pattern is likely to recur
- The solution involves multiple steps
- Other agents could benefit

### Promotion Process

The `AgentActivityLogger.promoteErrorToSkill()` method:

1. Reads the solution from ERRORS.md
2. Creates a SKILL.md file with proper frontmatter
3. Marks the error as promoted in ERRORS.md

### Generated Skill Structure

```
skills/
└── fix-background-process/
    └── SKILL.md
```

```markdown
---
name: fix-background-process
description: Correct syntax for shell background processes
version: 1.0
triggers:
  - background process
  - command not found after &&
origin: Promoted from ERRORS.md (run_command)
---

# fix-background-process

Correct syntax for shell background processes

## Solution

Use subshell for background processes: (cd /path && npm start) &

## Instructions

When you encounter this error pattern:

1. Recognize the error matches: `bash: cd: /PATH: No such file or directory...`
2. Apply the solution above
3. Verify the fix worked
```

---

## 5. Implementation Details

### Files Modified

| File | Changes |
|------|---------|
| `src/agent-activity-logger.ts` | Added ERRORS.md management methods |
| `src/society-server.ts` | Wired error recording after tool execution |

### Key Methods

```typescript
// Record error (called automatically on tool failure)
agentActivityLogger.recordToolError(
  projectFolder,
  agentHomeFolder, 
  toolName,
  toolArgs,
  errorOutput
)

// Get errors for a tool (for injection into context)
agentActivityLogger.getToolErrors(projectFolder, agentHomeFolder, toolName)

// Check if tool has unsolved errors
agentActivityLogger.hasUnsolvedErrors(projectFolder, agentHomeFolder, toolName)

// Promote solved error to skill
agentActivityLogger.promoteErrorToSkill(
  projectFolder,
  agentHomeFolder,
  toolName,
  skillName,
  description,
  triggers
)

// Get all solved errors eligible for promotion
agentActivityLogger.getSolvedErrors(projectFolder, agentHomeFolder)
```

### Error Recording Flow

```
society-server.ts
     │
     ├── executeSupervisorTool() / executeAgentTool()
     │         │
     │         ▼
     │    result.startsWith("❌")?
     │         │ yes
     │         ▼
     └── agentActivityLogger.recordToolError()
                   │
                   ▼
              ERRORS.md
                   │
                   ├── New tool? Create section
                   ├── Same signature? Increment count
                   └── At limit? Drop oldest
```

---

## 6. Relationship to Other Systems

### Mind-Tool Files

| File | Purpose | Error Tracking Role |
|------|---------|---------------------|
| AGENTS.md | Knowledge index | Links to ERRORS.md |
| KNOWLEDGE.md | Facts, tips | General knowledge |
| ERRORS.md | Tool failures | Automatic capture |
| STATE.md | Current state | - |

### Skills

| Aspect | ERRORS.md | Skills |
|--------|-----------|--------|
| Creation | Automatic on failure | Manual or promoted |
| Format | Simple markdown | SKILL.md frontmatter |
| Purpose | Reactive fixes | Proactive procedures |
| Scope | Single error type | Complete workflow |

### Promotion Path

```
ERRORS.md (reactive)
    │
    │ Agent writes solution
    │
    ▼
Solved Error
    │
    │ promoteErrorToSkill()
    │
    ▼
SKILL.md (proactive)
```

---

## 7. Token Efficiency

### Before (Unbounded)

- Every error logged separately
- No deduplication
- No limits
- Could grow to thousands of lines

### After (Bounded)

| Component | Max Size |
|-----------|----------|
| Occurrences per tool | 5 entries |
| Entry size | ~100 chars |
| Per tool section | ~600 chars |
| 10 tools with errors | ~6KB |

Typical ERRORS.md: **< 2KB** (fits easily in context)

---

## 8. Future Enhancements

Potential improvements:

1. **Error injection before tool call** - Show relevant errors when about to use a tool
2. **Auto-promote detection** - Suggest promotion when same error solved 3+ times
3. **Cross-project learning** - Share common errors across projects
4. **Error categories** - Group by error type (file not found, permission, syntax, etc.)
