# Society Agent - System Improvement Proposals

> **Purpose**: Detailed implementation proposals for the 10 recommended improvements  
> **Status**: PROPOSAL  
> **Last Updated**: 2026-03-07

---

## Overview

This document provides concrete implementation details for strengthening the Society Agent architecture. The current system has excellent foundations—disk-based truth, git verification, and hierarchical delegation—but needs more formalism to scale reliably.

---

## Proposal 1: Stable Task IDs

### Problem
Tasks are identified by natural language descriptions only. This creates ambiguity when:
- Two similar tasks exist
- A task is rewritten slightly
- A commit hash is attached to the wrong item
- Retries cause duplicate implementation

### Solution

#### 1.1 Task ID Format
```
T-{PROJECT_PREFIX}-{SEQUENCE}-{OPTIONAL_SUFFIX}

Examples:
T-ARCH-001       # Architect project, task 1
T-ARCH-002-A     # Subtask A of task 2
T-BE-015         # Backend specialist, task 15
```

#### 1.2 TypeScript Interface Update

```typescript
// In src/types.ts - extend Task interface
export interface Task {
  /** Stable task identifier (e.g., T-ARCH-001) */
  taskId: string
  
  /** Auto-incrementing sequence within project */
  sequence: number
  
  /** Parent task ID for decomposition */
  parentTaskId?: string
  
  /** Child task IDs */
  childTaskIds?: string[]
  
  // ... existing fields
}

// Task ID generator
export function generateTaskId(projectPrefix: string, sequence: number, suffix?: string): string {
  const base = `T-${projectPrefix.toUpperCase()}-${sequence.toString().padStart(3, '0')}`
  return suffix ? `${base}-${suffix}` : base
}
```

#### 1.3 PLAN.md Format Update

**Before:**
```markdown
- [ ] Add login route
- [ ] Create auth middleware
- [x] Update session storage
```

**After:**
```markdown
## Task Registry

| Task ID | Status | Owner | Description | Commit |
|---------|--------|-------|-------------|--------|
| T-BE-001 | done | Backend | Add login route | a1b2c3d |
| T-BE-002 | in_progress | Backend | Create auth middleware | - |
| T-BE-003 | planned | - | Update session storage | - |
```

#### 1.4 Git Commit Convention
```
T-BE-002 feat: add auth middleware

- Implemented JWT validation
- Added role-based access control
- Files: src/middleware/auth.ts, src/types/auth.ts
```

#### 1.5 Implementation Changes

**File: `src/project-store.ts`**
```typescript
// Add task sequence tracking per project
interface Project {
  // ... existing fields
  taskSequence: number  // Auto-incrementing counter
  taskPrefix: string    // e.g., "ARCH", "BE", "FE"
}

// New method
async createTask(projectId: string, task: Omit<Task, 'taskId' | 'sequence'>): Promise<Task> {
  const project = await this.getProject(projectId)
  project.taskSequence++
  
  const taskId = generateTaskId(project.taskPrefix, project.taskSequence)
  
  const newTask: Task = {
    ...task,
    taskId,
    sequence: project.taskSequence,
  }
  
  project.tasks.push(newTask)
  await this.save()
  
  return newTask
}
```

---

## Proposal 2: Expanded Task States

### Problem
Binary checkboxes (`[ ]` and `[x]`) hide operational reality. Real tasks pass through multiple states that affect coordination decisions.

### Solution

#### 2.1 State Machine

```
                    ┌─────────────┐
                    │   planned   │
                    └──────┬──────┘
                           │ delegate
                    ┌──────▼──────┐
          ┌─────────│  delegated  │◄────────┐
          │ reject  └──────┬──────┘ return  │
          │                │ accept          │
          │         ┌──────▼──────┐         │
          │         │ in_progress │─────────┼─── blocked
          │         └──────┬──────┘         │
          │                │ complete       │ unblock
          │         ┌──────▼──────┐         │
          │         │   review    │─────────┘
          │         └──────┬──────┘
          │                │ approve
          │         ┌──────▼──────┐
          └────────►│    done     │
                    └──────┬──────┘
                           │ verify
                    ┌──────▼──────┐
                    │  verified   │
                    └─────────────┘
```

#### 2.2 TypeScript Type

```typescript
export type TaskStatus =
  | 'planned'       // Created but not yet assigned
  | 'delegated'     // Assigned to an agent, awaiting acceptance
  | 'in_progress'   // Agent actively working
  | 'blocked'       // Cannot proceed, waiting for something
  | 'review'        // Work complete, awaiting verification
  | 'done'          // Accepted by delegator
  | 'verified'      // Independently verified (tests pass, commit exists)
  | 'failed'        // Terminated unsuccessfully
  | 'cancelled'     // Intentionally abandoned

export interface TaskStatusTransition {
  from: TaskStatus
  to: TaskStatus
  triggeredBy: string  // Agent ID
  timestamp: string    // ISO timestamp
  reason?: string      // Why the transition happened
  metadata?: {
    commitHash?: string
    filesChanged?: string[]
    blockedBy?: string
    blockReason?: string
  }
}

export interface Task {
  taskId: string
  status: TaskStatus
  statusHistory: TaskStatusTransition[]
  // ... other fields
}
```

#### 2.3 State Transition Functions

```typescript
// In src/task-manager.ts (new file)

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  const allowed: Record<TaskStatus, TaskStatus[]> = {
    planned: ['delegated', 'cancelled'],
    delegated: ['in_progress', 'planned'],  // Can be rejected back
    in_progress: ['blocked', 'review', 'failed'],
    blocked: ['in_progress', 'failed', 'cancelled'],
    review: ['done', 'in_progress'],  // Can be sent back for rework
    done: ['verified'],
    verified: [],  // Terminal state
    failed: ['planned'],  // Can retry
    cancelled: [],  // Terminal state
  }
  
  return allowed[from]?.includes(to) ?? false
}

export function transitionTask(
  task: Task,
  newStatus: TaskStatus,
  agentId: string,
  metadata?: TaskStatusTransition['metadata']
): Task {
  if (!canTransition(task.status, newStatus)) {
    throw new Error(`Invalid transition: ${task.status} → ${newStatus}`)
  }
  
  const transition: TaskStatusTransition = {
    from: task.status,
    to: newStatus,
    triggeredBy: agentId,
    timestamp: new Date().toISOString(),
    metadata,
  }
  
  return {
    ...task,
    status: newStatus,
    statusHistory: [...task.statusHistory, transition],
  }
}
```

---

## Proposal 3: Separate Planning from Execution Log

### Problem
`PLAN.md` currently serves too many purposes: task queue, execution checkpoint, coordination surface, and recovery state. This creates clutter and parsing ambiguity as projects grow.

### Solution

Split into three files with distinct purposes:

#### 3.1 File Structure

```
project/
├── PLAN.md           # Current tasks only (active work)
├── TASK_LOG.md       # Historical execution evidence
└── AGENTS.md         # Operational knowledge (unchanged)
```

#### 3.2 PLAN.md (Simplified)

Only active, non-terminal tasks:

```markdown
# Project Plan

## Active Tasks

| Task ID | Status | Owner | Description | Blocked By |
|---------|--------|-------|-------------|------------|
| T-BE-015 | in_progress | Backend | Implement OAuth flow | - |
| T-FE-008 | blocked | Frontend | Login UI | T-BE-015 |
| T-BE-016 | planned | - | Add rate limiting | - |

## Blocked Items

### T-FE-008 (Frontend Login UI)
- **Blocked By**: T-BE-015 (OAuth endpoints not ready)
- **Waiting Since**: 2026-03-06
- **Unblock Condition**: Backend completes OAuth endpoints
- **Owner**: Frontend Agent
```

#### 3.3 TASK_LOG.md (New File)

Append-only execution history:

```markdown
# Task Execution Log

## 2026-03-07

### T-BE-014 | verified | Backend Agent
- **Delegated**: 2026-03-07T09:15:00Z
- **Started**: 2026-03-07T09:16:23Z
- **Completed**: 2026-03-07T10:45:12Z
- **Verified**: 2026-03-07T10:52:00Z
- **Commit**: `a1b2c3d4` - "T-BE-014 feat: add user authentication"
- **Files Changed**:
  - `src/auth/handler.ts` (created)
  - `src/middleware/auth.ts` (modified)
  - `tests/auth.test.ts` (created)
- **Verification**:
  - [x] Commit exists
  - [x] Files listed in FILES.md
  - [x] TypeScript compiles
  - [x] Tests pass (auth.test.ts: 12/12)

---

### T-BE-013 | failed | Backend Agent
- **Delegated**: 2026-03-06T14:00:00Z
- **Started**: 2026-03-06T14:05:00Z
- **Failed**: 2026-03-06T15:30:00Z
- **Error**: Database connection timeout during migration
- **Resolution**: Retry after DB fix (became T-BE-014)
```

#### 3.4 Auto-Generation

```typescript
// In src/task-logger.ts (new file)

export async function appendToTaskLog(
  projectDir: string,
  task: Task,
  verification?: VerificationResult
): Promise<void> {
  const logPath = path.join(projectDir, 'TASK_LOG.md')
  
  const entry = formatTaskLogEntry(task, verification)
  
  // Append with date header if needed
  const existingContent = await fs.readFile(logPath, 'utf-8').catch(() => '# Task Execution Log\n')
  const today = new Date().toISOString().split('T')[0]
  
  let newContent = existingContent
  if (!existingContent.includes(`## ${today}`)) {
    newContent += `\n## ${today}\n`
  }
  newContent += `\n${entry}\n---\n`
  
  await fs.writeFile(logPath, newContent)
}
```

---

## Proposal 4: Canonical File Ownership

### Problem
Multiple agents may independently create or modify the same files, leading to conflicts, duplicates, and unclear responsibility.

### Solution

#### 4.1 FILES.md Structure

```markdown
# File Ownership Registry

> **Rule**: Only the owning agent may modify a file. Request handoff for exceptions.

## Ownership Map

| Path | Owner | Created | Last Modified | Task |
|------|-------|---------|---------------|------|
| src/api/auth.ts | backend-specialist | 2026-03-05 | 2026-03-07 | T-BE-014 |
| src/ui/login.tsx | frontend-specialist | 2026-03-06 | 2026-03-06 | T-FE-005 |
| src/shared/types.ts | architect | 2026-03-04 | 2026-03-07 | T-ARCH-001 |
| tests/ | backend-specialist | 2026-03-05 | 2026-03-07 | - |

## Shared Files (Multi-Owner)

| Path | Owners | Coordination Rule |
|------|--------|-------------------|
| package.json | ALL | Notify others after change |
| tsconfig.json | architect | Request via supervisor |
| README.md | architect | Append-only sections per agent |

## Pending Handoffs

| Path | From | To | Reason | Status |
|------|------|-----|--------|--------|
| src/api/auth.ts | backend | frontend | Frontend needs auth types | pending |
```

#### 4.2 Ownership Check Before Write

```typescript
// In src/file-ownership.ts (new file)

export interface FileOwnership {
  path: string
  owner: string
  createdAt: string
  lastModifiedAt: string
  createdByTask?: string
}

export interface OwnershipRegistry {
  files: FileOwnership[]
  shared: { path: string; owners: string[]; rule: string }[]
  handoffs: { path: string; from: string; to: string; status: string }[]
}

export async function canModifyFile(
  agentId: string,
  filePath: string,
  registry: OwnershipRegistry
): Promise<{ allowed: boolean; reason?: string; owner?: string }> {
  const ownership = registry.files.find(f => f.path === filePath)
  
  if (!ownership) {
    // New file - agent becomes owner
    return { allowed: true }
  }
  
  if (ownership.owner === agentId) {
    return { allowed: true }
  }
  
  // Check shared files
  const shared = registry.shared.find(s => filePath.startsWith(s.path))
  if (shared && shared.owners.includes(agentId)) {
    return { allowed: true }
  }
  
  // Check pending handoffs
  const handoff = registry.handoffs.find(
    h => h.path === filePath && h.to === agentId && h.status === 'approved'
  )
  if (handoff) {
    return { allowed: true }
  }
  
  return {
    allowed: false,
    reason: `File owned by ${ownership.owner}. Request handoff or ask supervisor.`,
    owner: ownership.owner,
  }
}
```

#### 4.3 Agent Prompt Addition

Add to agent system prompts:

```markdown
## File Ownership Rules

Before modifying any file, check FILES.md:
1. If you own the file → proceed
2. If the file is new → you become owner, update FILES.md
3. If someone else owns it → request handoff via supervisor
4. Shared files → notify other owners after changes
```

---

## Proposal 5: Supervisor Override Protocol

### Problem
The read-only rule for supervisors is clean but can block recovery when a subagent is dead, wedged, or has corrupted its own state.

### Solution

#### 5.1 Override Levels

```typescript
export type OverrideLevel = 
  | 'none'           // Normal operation, read-only
  | 'repair'         // Can modify recovery files (PLAN.md, AGENTS.md)
  | 'emergency'      // Can modify any file, with audit log
  | 'takeover'       // Full control, subagent effectively disabled

export interface OverrideRequest {
  id: string
  requestedBy: string      // Supervisor ID
  targetAgent: string      // Subagent being overridden
  level: OverrideLevel
  reason: string
  justification: string    // Detailed explanation
  timestamp: string
  expiresAt?: string       // Auto-revoke time
  approvedBy?: string      // Human or higher supervisor
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'revoked'
}
```

#### 5.2 Override Protocol

```markdown
## Supervisor Override Protocol

### When Override is Permitted

1. **Agent Unresponsive** (> 10 minutes without heartbeat)
   - Level: `repair`
   - Auto-approved after timeout

2. **State Corruption Detected**
   - Level: `repair`
   - Requires human approval

3. **Critical Deadline**
   - Level: `emergency`
   - Requires human approval + justification

4. **Security Incident**
   - Level: `takeover`
   - Requires human approval + incident ID

### Override Procedure

1. Supervisor creates OverrideRequest with justification
2. Request routed to human (or auto-approved for level 1)
3. If approved:
   - Override logged in OVERRIDE_LOG.md
   - Supervisor gains temporary write access
   - All actions logged with `[OVERRIDE]` prefix
4. When complete:
   - Supervisor explicitly revokes override
   - Or auto-revoke after `expiresAt`
5. Subagent notified of override and actions taken
```

#### 5.3 Override Log

```markdown
# Override Log

## 2026-03-07T14:30:00Z | REPAIR | architect → backend-specialist

- **Reason**: Backend agent unresponsive for 15 minutes
- **Justification**: Need to unblock frontend work on T-FE-008
- **Approved By**: Auto-approved (agent timeout)
- **Actions Taken**:
  - Modified backend/PLAN.md: Marked T-BE-015 as blocked
  - Modified backend/AGENTS.md: Added recovery note
- **Revoked At**: 2026-03-07T14:45:00Z
- **Agent Notified**: Yes
```

---

## Proposal 6: Verification Checklist

### Problem
Tasks are marked "done" based on agent self-report, which can be optimistic or incomplete.

### Solution

#### 6.0 Language-Agnostic Project Configuration

Verification commands must adapt to the project's language. See `src/project-config.ts` for implementation.

**Auto-Detection**: The system detects project language from indicator files:

| Language | Indicators | Type Check | Test | Lint |
|----------|------------|------------|------|------|
| Python | `pyproject.toml`, `requirements.txt` | `mypy .` | `pytest` | `ruff check .` |
| TypeScript | `tsconfig.json` | `npx tsc --noEmit` | `npm test` | `npx eslint .` |
| Go | `go.mod` | `go vet ./...` | `go test ./...` | `golangci-lint run` |
| Rust | `Cargo.toml` | `cargo check` | `cargo test` | `cargo clippy` |
| Java | `pom.xml`, `build.gradle` | `mvn compile` | `mvn test` | `mvn checkstyle:check` |

**Explicit Configuration** (`.society.json`):

```json
{
  "language": "python",
  "validation": {
    "typeCheck": "mypy src/ --strict",
    "test": "pytest tests/ -v --cov=src",
    "lint": "ruff check src/ tests/",
    "formatCheck": "black --check ."
  },
  "paths": {
    "source": ["src/"],
    "tests": ["tests/"]
  },
  "settings": {
    "requireTests": true,
    "requireLint": true,
    "autoVerify": true
  }
}
```

**Usage in Verification**:

```typescript
import { loadProjectConfig, getValidationCommand } from './project-config'

async function runVerification(task: Task, projectDir: string) {
  const config = await loadProjectConfig(projectDir)
  
  // Type check using detected/configured command
  const typeCheckCmd = getValidationCommand(config, 'typeCheck')
  if (typeCheckCmd) {
    const result = await runCommand(typeCheckCmd, projectDir)
    // ...
  }
}
```

#### 6.1 Verification Requirements by Task Type

```typescript
export interface VerificationChecklist {
  taskId: string
  checks: VerificationCheck[]
  overallResult: 'pass' | 'fail' | 'partial'
  verifiedAt?: string
  verifiedBy?: string
}

export interface VerificationCheck {
  name: string
  required: boolean
  status: 'pass' | 'fail' | 'skip' | 'pending'
  details?: string
}

// Standard checklist factory
export function createVerificationChecklist(task: Task): VerificationChecklist {
  const checks: VerificationCheck[] = [
    // Always required
    { name: 'commit_exists', required: true, status: 'pending' },
    { name: 'files_in_registry', required: true, status: 'pending' },
    { name: 'no_compile_errors', required: true, status: 'pending' },
    
    // Conditional
    { name: 'tests_pass', required: task.context.requiresTests ?? false, status: 'pending' },
    { name: 'lint_clean', required: task.context.requiresLint ?? false, status: 'pending' },
    { name: 'api_docs_updated', required: task.context.isApiChange ?? false, status: 'pending' },
  ]
  
  return { taskId: task.taskId, checks, overallResult: 'partial' }
}
```

#### 6.2 Verification Execution

```typescript
import { loadProjectConfig, getValidationCommand } from './project-config'

export async function runVerification(
  task: Task,
  projectDir: string
): Promise<VerificationChecklist> {
  const checklist = createVerificationChecklist(task)
  const config = await loadProjectConfig(projectDir)
  
  // Check 1: Commit exists
  const commitCheck = checklist.checks.find(c => c.name === 'commit_exists')!
  if (task.result?.commitHash) {
    const commitExists = await gitCommitExists(projectDir, task.result.commitHash)
    commitCheck.status = commitExists ? 'pass' : 'fail'
    commitCheck.details = commitExists 
      ? `Commit ${task.result.commitHash} found`
      : `Commit ${task.result.commitHash} not found in git history`
  } else {
    commitCheck.status = 'fail'
    commitCheck.details = 'No commit hash reported'
  }
  
  // Check 2: Files in registry
  const filesCheck = checklist.checks.find(c => c.name === 'files_in_registry')!
  const registry = await loadFilesRegistry(projectDir)
  const missingFiles = task.result?.filesModified?.filter(
    f => !registry.files.some(r => r.path === f)
  ) ?? []
  filesCheck.status = missingFiles.length === 0 ? 'pass' : 'fail'
  filesCheck.details = missingFiles.length > 0 
    ? `Missing from FILES.md: ${missingFiles.join(', ')}`
    : 'All files registered'
  
  // Check 3: No compile/type errors (language-agnostic)
  const compileCheck = checklist.checks.find(c => c.name === 'no_compile_errors')!
  const typeCheckCmd = getValidationCommand(config, 'typeCheck')
  if (typeCheckCmd) {
    const compileResult = await runCommand(typeCheckCmd, projectDir)
    compileCheck.status = compileResult.exitCode === 0 ? 'pass' : 'fail'
    compileCheck.details = compileResult.exitCode === 0 
      ? `${config.language} type check passed`
      : `Type errors:\n${compileResult.stderr.slice(0, 500)}`
  } else {
    compileCheck.status = 'skip'
    compileCheck.details = `No type checker configured for ${config.language}`
  }
  
  // Check 4: Tests pass (if required)
  const testsCheck = checklist.checks.find(c => c.name === 'tests_pass')!
  if (testsCheck.required) {
    const testCmd = getValidationCommand(config, 'test')
    if (testCmd) {
      const testResult = await runCommand(testCmd, projectDir)
      testsCheck.status = testResult.exitCode === 0 ? 'pass' : 'fail'
      testsCheck.details = testResult.stdout.slice(-500)
    } else {
      testsCheck.status = 'skip'
      testsCheck.details = 'No test command configured'
    }
  } else {
    testsCheck.status = 'skip'
  }
  
  // Check 5: Lint passes (if required)
  const lintCheck = checklist.checks.find(c => c.name === 'lint_clean')!
  if (lintCheck.required) {
    const lintCmd = getValidationCommand(config, 'lint')
    if (lintCmd) {
      const lintResult = await runCommand(lintCmd, projectDir)
      lintCheck.status = lintResult.exitCode === 0 ? 'pass' : 'fail'
      lintCheck.details = lintResult.exitCode === 0 
        ? 'Lint passed'
        : `Lint issues:\n${lintResult.stdout.slice(0, 500)}`
    }
  }
  
  // Calculate overall result
  const required = checklist.checks.filter(c => c.required)
  const passed = required.filter(c => c.status === 'pass')
  checklist.overallResult = passed.length === required.length ? 'pass' : 'fail'
  
  return checklist
}
```

#### 6.3 Verification Gate

```typescript
// In task state machine
export function canMarkVerified(task: Task, checklist: VerificationChecklist): boolean {
  return (
    task.status === 'done' &&
    checklist.overallResult === 'pass'
  )
}
```

---

## Proposal 7: Blocking Reasons as First-Class Data

### Problem
When tasks are blocked, the reason and unblock conditions are often buried in prose, making it hard to track and resolve systematically.

### Solution

#### 7.1 Block Data Structure

```typescript
export interface BlockInfo {
  /** Unique block ID */
  blockId: string
  
  /** Task that is blocked */
  blockedTaskId: string
  
  /** Agent that owns the blocked task */
  owner: string
  
  /** When the block was created */
  blockedAt: string
  
  /** Category of blockage */
  blockType: 'dependency' | 'resource' | 'information' | 'approval' | 'external' | 'error'
  
  /** What is causing the block */
  blockedBy: {
    taskId?: string          // Waiting for another task
    agentId?: string         // Waiting for another agent
    resourceType?: string    // Waiting for a resource
    description: string      // Human-readable explanation
  }
  
  /** What must happen to unblock */
  unblockCondition: string
  
  /** Who is responsible for unblocking */
  unblockOwner: string
  
  /** Last time this block was reviewed */
  lastReviewedAt?: string
  
  /** Current status */
  status: 'active' | 'resolved' | 'escalated'
  
  /** Resolution details */
  resolution?: {
    resolvedAt: string
    resolvedBy: string
    how: string
  }
}
```

#### 7.2 BLOCKED.md Registry

```markdown
# Blocked Tasks Registry

## Active Blocks

### B-001 | T-FE-008 | dependency
- **Blocked Task**: T-FE-008 (Frontend Login UI)
- **Owner**: frontend-specialist
- **Blocked Since**: 2026-03-07T10:00:00Z
- **Block Type**: dependency
- **Blocked By**: T-BE-015 (OAuth endpoints not ready)
- **Unblock Condition**: Backend completes OAuth endpoints
- **Unblock Owner**: backend-specialist
- **Last Reviewed**: 2026-03-07T14:00:00Z
- **Status**: active

### B-002 | T-BE-017 | information
- **Blocked Task**: T-BE-017 (Configure database)
- **Owner**: backend-specialist
- **Blocked Since**: 2026-03-07T11:30:00Z
- **Block Type**: information
- **Blocked By**: Missing database credentials
- **Unblock Condition**: Receive DB credentials from ops team
- **Unblock Owner**: architect (to escalate to human)
- **Last Reviewed**: 2026-03-07T14:00:00Z
- **Status**: escalated

## Resolved Blocks (Last 7 Days)

### B-000 | T-BE-014 | dependency | RESOLVED
- **Resolved At**: 2026-03-06T16:00:00Z
- **Resolved By**: backend-specialist
- **Resolution**: Dependency T-BE-013 completed after DB fix
```

#### 7.3 Block Helper Functions

```typescript
export function createBlock(
  task: Task,
  blockType: BlockInfo['blockType'],
  blockedBy: BlockInfo['blockedBy'],
  unblockCondition: string,
  unblockOwner: string
): BlockInfo {
  return {
    blockId: `B-${Date.now()}`,
    blockedTaskId: task.taskId,
    owner: task.assignedTo ?? task.createdBy,
    blockedAt: new Date().toISOString(),
    blockType,
    blockedBy,
    unblockCondition,
    unblockOwner,
    status: 'active',
  }
}

export async function checkBlockResolution(
  block: BlockInfo,
  projectStore: ProjectStore
): Promise<boolean> {
  if (block.blockedBy.taskId) {
    const task = await projectStore.getTask(block.blockedBy.taskId)
    return task?.status === 'done' || task?.status === 'verified'
  }
  // Other resolution checks...
  return false
}
```

---

## Proposal 8: Durable Worker Output

### Problem
Ephemeral workers may complete useful work but lose it if they fail before committing or reporting upward.

### Solution

#### 8.1 Work-in-Progress Commits

```typescript
export interface WorkCheckpoint {
  taskId: string
  workerId: string
  checkpointId: string
  branchName: string       // e.g., "wip/T-BE-015-worker-abc123"
  commitHash: string
  filesChanged: string[]
  timestamp: string
  status: 'wip' | 'complete' | 'abandoned'
}

// Worker should checkpoint periodically
export async function createCheckpoint(
  workerId: string,
  taskId: string,
  projectDir: string,
  message: string
): Promise<WorkCheckpoint> {
  const branchName = `wip/${taskId}-${workerId.slice(-6)}`
  
  // Create or switch to WIP branch
  await runGit(['checkout', '-B', branchName], projectDir)
  
  // Stage and commit
  await runGit(['add', '-A'], projectDir)
  const commitResult = await runGit(['commit', '-m', `[WIP] ${taskId}: ${message}`], projectDir)
  
  const commitHash = await getHeadCommit(projectDir)
  const filesChanged = await getChangedFiles(projectDir)
  
  return {
    taskId,
    workerId,
    checkpointId: `CP-${Date.now()}`,
    branchName,
    commitHash,
    filesChanged,
    timestamp: new Date().toISOString(),
    status: 'wip',
  }
}
```

#### 8.2 Checkpoint Recovery

```typescript
export async function recoverWorkerCheckpoint(
  taskId: string,
  projectDir: string
): Promise<WorkCheckpoint | null> {
  // List WIP branches for this task
  const branches = await listBranches(projectDir)
  const wipBranches = branches.filter(b => b.startsWith(`wip/${taskId}-`))
  
  if (wipBranches.length === 0) {
    return null
  }
  
  // Find most recent checkpoint
  let latest: { branch: string; timestamp: number } | null = null
  for (const branch of wipBranches) {
    const lastCommit = await getLastCommitTime(projectDir, branch)
    if (!latest || lastCommit > latest.timestamp) {
      latest = { branch, timestamp: lastCommit }
    }
  }
  
  if (latest) {
    // Recover the checkpoint
    await runGit(['checkout', latest.branch], projectDir)
    return {
      taskId,
      workerId: 'recovered',
      checkpointId: `CP-recovered-${Date.now()}`,
      branchName: latest.branch,
      commitHash: await getHeadCommit(projectDir),
      filesChanged: await getChangedFiles(projectDir),
      timestamp: new Date(latest.timestamp).toISOString(),
      status: 'wip',
    }
  }
  
  return null
}
```

#### 8.3 Agent Prompt Addition

```markdown
## Checkpoint Protocol

As a worker agent, checkpoint your progress regularly:

1. **Before complex operations**: Commit current state
2. **Every 10 minutes of active work**: Create a WIP commit
3. **Before any risky change**: Commit known-good state

Checkpoint format:
```bash
git add -A
git commit -m "[WIP] T-XXX-NNN: Description of current progress"
```

The supervisor can recover your work from WIP commits if you crash.
```

---

## Proposal 9: Message Contracts

### Problem
Messages like `delegate_task` and `report_to_supervisor` have implicit structure, leading to ambiguity and hallucinated interpretations.

### Solution

#### 9.1 Message Schema Definitions

```typescript
// In src/message-contracts.ts (new file)

export interface DelegateTaskMessage {
  type: 'delegate_task'
  
  /** Stable task ID */
  taskId: string
  
  /** One-line objective */
  objective: string
  
  /** Detailed description */
  description: string
  
  /** Files/folders agent may modify */
  allowedPaths: string[]
  
  /** Files agent may read (in addition to allowed) */
  readablePaths?: string[]
  
  /** Validation steps to run before reporting completion */
  validationSteps: string[]
  
  /** Expected format of completion report */
  reportFormat: {
    requiredFields: string[]
    optionalFields?: string[]
  }
  
  /** Priority level */
  priority: 'low' | 'normal' | 'high' | 'critical'
  
  /** Deadline (ISO timestamp) */
  deadline?: string
  
  /** Context from parent tasks */
  context?: string
  
  /** Dependencies that must be complete */
  dependsOn?: string[]
}

export interface TaskReportMessage {
  type: 'task_report'
  
  /** Task ID being reported on */
  taskId: string
  
  /** New status */
  status: 'in_progress' | 'blocked' | 'completed' | 'failed'
  
  /** Progress percentage (0-100) */
  progress?: number
  
  /** Files created */
  filesCreated?: string[]
  
  /** Files modified */
  filesModified?: string[]
  
  /** Commit hash (required for completed status) */
  commitHash?: string
  
  /** Summary of work done */
  summary: string
  
  /** Validation results */
  validationResults?: {
    step: string
    passed: boolean
    output?: string
  }[]
  
  /** Block info (required for blocked status) */
  blockInfo?: {
    blockType: BlockInfo['blockType']
    blockedBy: string
    unblockCondition: string
  }
  
  /** Error details (required for failed status) */
  error?: {
    type: string
    message: string
    recoverable: boolean
    suggestedAction?: string
  }
}

export interface StatusUpdateMessage {
  type: 'status_update'
  
  /** Agent sending the update */
  agentId: string
  
  /** Current task (if any) */
  currentTaskId?: string
  
  /** Agent status */
  status: 'idle' | 'working' | 'blocked' | 'waiting'
  
  /** Brief status message */
  message?: string
}
```

#### 9.2 Message Validation

```typescript
import Ajv from 'ajv'

const ajv = new Ajv()

const delegateTaskSchema = {
  type: 'object',
  required: ['type', 'taskId', 'objective', 'description', 'allowedPaths', 'validationSteps', 'reportFormat', 'priority'],
  properties: {
    type: { const: 'delegate_task' },
    taskId: { type: 'string', pattern: '^T-[A-Z]+-\\d{3}' },
    objective: { type: 'string', maxLength: 200 },
    description: { type: 'string' },
    allowedPaths: { type: 'array', items: { type: 'string' }, minItems: 1 },
    validationSteps: { type: 'array', items: { type: 'string' } },
    priority: { enum: ['low', 'normal', 'high', 'critical'] },
    // ... other fields
  },
}

const validateDelegateTask = ajv.compile(delegateTaskSchema)

export function validateMessage<T>(
  message: unknown,
  schema: object
): { valid: true; data: T } | { valid: false; errors: string[] } {
  const validate = ajv.compile(schema)
  if (validate(message)) {
    return { valid: true, data: message as T }
  }
  return {
    valid: false,
    errors: validate.errors?.map(e => `${e.instancePath}: ${e.message}`) ?? ['Unknown validation error'],
  }
}
```

#### 9.3 Example Message Templates

```markdown
## Delegate Task Template

```json
{
  "type": "delegate_task",
  "taskId": "T-BE-015",
  "objective": "Implement OAuth 2.0 authentication flow",
  "description": "Create OAuth handlers for Google and GitHub providers. Include token refresh logic and secure token storage.",
  "allowedPaths": [
    "src/auth/",
    "src/middleware/auth.ts",
    "tests/auth/"
  ],
  "readablePaths": [
    "src/config/",
    "src/types/"
  ],
  "validationSteps": [
    "npx tsc --noEmit",
    "npm test -- --grep auth",
    "Verify OAuth callback URL is configurable"
  ],
  "reportFormat": {
    "requiredFields": ["commitHash", "filesCreated", "filesModified", "summary"],
    "optionalFields": ["notes", "followUpTasks"]
  },
  "priority": "high",
  "deadline": "2026-03-08T17:00:00Z",
  "context": "Part of user authentication epic. Frontend is waiting for these endpoints."
}
```

## Task Report Template (Completed)

```json
{
  "type": "task_report",
  "taskId": "T-BE-015",
  "status": "completed",
  "progress": 100,
  "filesCreated": [
    "src/auth/oauth.ts",
    "src/auth/providers/google.ts",
    "src/auth/providers/github.ts",
    "tests/auth/oauth.test.ts"
  ],
  "filesModified": [
    "src/middleware/auth.ts",
    "src/config/index.ts"
  ],
  "commitHash": "a1b2c3d4e5f6",
  "summary": "Implemented OAuth 2.0 flow for Google and GitHub. Added token refresh logic with 1-hour expiry. Tokens stored in encrypted session storage.",
  "validationResults": [
    { "step": "npx tsc --noEmit", "passed": true },
    { "step": "npm test -- --grep auth", "passed": true, "output": "12 tests passed" },
    { "step": "Verify OAuth callback URL is configurable", "passed": true }
  ]
}
```
```

---

## Proposal 10: Separate Verification from Implementation

### Problem
A task marked "done" by the implementing agent may not actually be complete. The supervisor currently trusts the report without independent verification.

### Solution

#### 10.1 Two-Phase Completion

```
Implementer: in_progress → review
Verifier:    review → done → verified
```

- **in_progress → review**: Agent claims completion
- **review → done**: Supervisor accepts the work
- **done → verified**: Automated or independent verification passes

#### 10.2 Verification Agent Role

```typescript
export interface VerificationConfig {
  /** Run automated checks for these task types */
  autoVerify: {
    compile: boolean         // Always run tsc
    test: boolean            // Run relevant tests
    lint: boolean            // Run linter
    ownership: boolean       // Check FILES.md
    commit: boolean          // Verify commit exists
  }
  
  /** Require human review for these conditions */
  requireHumanReview: {
    securityRelated: boolean
    publicApiChanges: boolean
    databaseMigrations: boolean
  }
  
  /** Sampling rate for independent review */
  spotCheckRate: number      // 0.0 to 1.0
}

export async function verifyTask(
  task: Task,
  config: VerificationConfig,
  projectDir: string
): Promise<{
  automated: VerificationChecklist
  humanReviewRequired: boolean
  spotChecked: boolean
}> {
  // Run automated verification
  const automated = await runVerification(task, projectDir)
  
  // Determine if human review needed
  const humanReviewRequired = 
    (config.requireHumanReview.securityRelated && task.context.securityRelated) ||
    (config.requireHumanReview.publicApiChanges && task.context.isApiChange) ||
    (config.requireHumanReview.databaseMigrations && task.context.hasMigration)
  
  // Spot check random sample
  const spotChecked = Math.random() < config.spotCheckRate
  
  return { automated, humanReviewRequired, spotChecked }
}
```

#### 10.3 Verification Report in TASK_LOG.md

```markdown
### T-BE-015 | done → verified | Backend Agent

**Implementation Report** (from agent):
- Commit: a1b2c3d4
- Files: src/auth/oauth.ts, tests/auth/oauth.test.ts
- Summary: Implemented OAuth flow

**Automated Verification**:
| Check | Status | Details |
|-------|--------|---------|
| commit_exists | ✅ pass | a1b2c3d4 found in git history |
| files_in_registry | ✅ pass | All files listed in FILES.md |
| no_compile_errors | ✅ pass | tsc completed successfully |
| tests_pass | ✅ pass | 12/12 tests passed |
| lint_clean | ⚠️ skip | Not required for this task |

**Verification Result**: PASS  
**Verified At**: 2026-03-07T11:30:00Z  
**Verified By**: automated
```

#### 10.4 Supervisor Prompt Addition

```markdown
## Verification Protocol

When a worker reports task completion:

1. **Receive report** (status: review)
2. **Run automated verification**:
   - Check commit exists in git history
   - Verify files listed in FILES.md
   - Run `npx tsc --noEmit`
   - Run relevant tests if applicable
3. **Review verification results**:
   - All checks pass → Mark as `done`
   - Any required check fails → Request rework
4. **Automated verification**:
   - `done` + all automated checks pass → Mark as `verified`
   - Otherwise → Keep as `done`, flag for spot check

**Never mark a task as verified based solely on agent self-report.**
```

---

## Implementation Priority

### Phase 1: Foundation (Week 1)
1. **Task IDs** - Core to all other improvements
2. **Expanded Task States** - Required for proper workflow
3. **Message Contracts** - Reduces ambiguity immediately

### Phase 2: Tracking (Week 2)
4. **Separate PLAN.md and TASK_LOG.md** - Cleaner state management
5. **File Ownership (FILES.md)** - Prevents conflicts
6. **Blocking Reasons (BLOCKED.md)** - Visible coordination state

### Phase 3: Verification (Week 3)
7. **Verification Checklist** - Automated quality gates
8. **Separate Verification from Implementation** - Trust but verify
9. **Durable Worker Output** - WIP commit strategy

### Phase 4: Recovery (Week 4)
10. **Supervisor Override Protocol** - Emergency recovery paths

---

## Files to Create/Modify

### New Files
- `src/task-manager.ts` - Task ID generation, state machine
- `src/file-ownership.ts` - Ownership registry management
- `src/message-contracts.ts` - Message schemas and validation
- `src/verification.ts` - Verification checklist runner
- `src/checkpoint.ts` - WIP commit management
- `src/project-config.ts` - Language detection, validation commands ✅ CREATED

### Modified Files
- `src/types.ts` - Extended Task, new types
- `src/project-store.ts` - Task sequence tracking
- `src/supervisor-agent.ts` - Verification integration
- `src/message-handler.ts` - Contract validation
- `src/agent-prompts.ts` - Updated agent instructions
- `src/project-analyzer.ts` - Integrate with project-config.ts

### New Project Files (Template)
- `PLAN.md` - Simplified, active tasks only
- `TASK_LOG.md` - Execution history
- `FILES.md` - Ownership registry
- `BLOCKED.md` - Block tracking
- `OVERRIDE_LOG.md` - Supervisor overrides

---

## Summary

These proposals transform the existing good design into a more formal, verifiable system:

| Area | Current | Proposed |
|------|---------|----------|
| Task Identity | Natural language | Stable IDs (T-XXX-NNN) |
| Task States | Checkbox | 9-state machine |
| Planning | Mixed in PLAN.md | Separate PLAN.md / TASK_LOG.md |
| File Ownership | Implicit | Explicit registry |
| Supervisor Access | Read-only | Override protocol |
| Completion | Self-report | Verification checklist |
| Blocks | Prose | Structured BLOCKED.md |
| Worker Durability | On completion | WIP commits |
| Messages | Informal | Contract schemas |
| Verification | Commit exists | Multi-check pipeline |

The system's core strength—disk as source of truth—is preserved and enhanced with stronger structure.
