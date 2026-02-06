# Society Agent - Production Architecture Decisions

**Date**: January 31, 2026  
**Status**: Design Document - Critical Decisions Required

---

## Your Questions Answered

### 1. Single Purpose vs Multiple Concurrent Purposes?

**Current Implementation**: Supports multiple concurrent purposes

```typescript
// In SocietyManager
private state: SocietyState {
    activePurposes: Map<string, ActivePurpose>  // Multiple at once!
    completedPurposes: Purpose[]
}
```

**Recommendation**: **Support both modes with configuration**

#### Mode A: Sequential (Safe, Predictable)

```typescript
maxConcurrentPurposes: 1 // Only one purpose at a time
queueMode: "sequential" // Wait for completion before next
```

**Pros**:

- ✅ Easier to monitor and debug
- ✅ Predictable resource usage
- ✅ Clear results per purpose
- ✅ Simpler user interface

**Cons**:

- ❌ Slower for independent tasks
- ❌ Can't parallelize unrelated work

**Use When**:

- Development and testing
- Complex purposes that need full resources
- Single user working on one thing

#### Mode B: Concurrent (Powerful, Complex)

```typescript
maxConcurrentPurposes: 5 // Up to 5 purposes simultaneously
queueMode: "concurrent" // Parallel execution
resourcePool: "shared" // Share agent resources
```

**Pros**:

- ✅ Fast for independent tasks
- ✅ Multiple users can work simultaneously
- ✅ Better resource utilization

**Cons**:

- ❌ Complex UI to show multiple purposes
- ❌ Resource contention possible
- ❌ Harder to debug issues

**Use When**:

- Production environment
- Multiple teams/users
- Independent purposes (e.g., "Review PR #123" + "Update docs")

---

### 2. How to See Results?

**Three-Tier Result System**:

#### Tier 1: Live Progress (During Execution)

```typescript
// Real-time updates via callbacks
onProgressUpdate: (purposeId, progress) => {
	// Update UI: "45% complete - Worker analyzing files..."
}

onStatusChange: (purposeId, agentId, status, task) => {
	// Show: "Agent worker-1: executing task 'Review auth.ts'"
}

onMessage: (purposeId, agentId, message) => {
	// Display: "Agent worker-1: Found security issue on line 45"
}
```

**UI Display**:

```
Purpose: "Review authentication code"
Progress: [████████░░] 80%

Active Agents:
┌─────────────────────────────────────────┐
│ 🤖 supervisor-1      │ Status: Monitoring │
│ 🔧 worker-backend-1  │ Reviewing auth.ts  │
│ 🛡️ worker-security-1 │ Checking vulns    │
└─────────────────────────────────────────┘

Recent Activity:
• 14:32:15 - worker-backend-1: Found 3 issues
• 14:32:10 - worker-security-1: Scanning for SQL injection
• 14:32:05 - supervisor-1: Assigned tasks to 2 workers
```

#### Tier 2: Completion Summary (When Done)

```typescript
onPurposeCompleted: (purpose, summary) => {
    // Show comprehensive results
}

// Example summary object:
{
    purposeId: "purpose-123",
    status: "completed",
    duration: "2m 34s",
    summary: "Reviewed authentication code. Found 3 issues.",
    results: {
        filesAnalyzed: ["auth.ts", "user.ts"],
        issuesFound: [
            { file: "auth.ts", line: 45, severity: "high", issue: "..." }
        ],
        recommendations: ["Use bcrypt instead of SHA256", "..."],
        filesCreated: ["analysis/auth-review.md"],
        changesProposed: 3
    },
    agentsUsed: ["supervisor-1", "worker-backend-1", "worker-security-1"],
    artifacts: [
        { type: "report", path: "/analysis/auth-review.md" },
        { type: "diff", path: "/analysis/diffs/auth-fixes.diff" }
    ]
}
```

**UI Display**:

```
✅ Purpose Completed: "Review authentication code"
   Duration: 2m 34s

📊 Summary:
   • Analyzed 2 files
   • Found 3 security issues (1 high, 2 medium)
   • Created 1 report, 1 diff

📁 Artifacts Created:
   • analysis/auth-review.md - Detailed findings
   • analysis/diffs/auth-fixes.diff - Proposed fixes

🤖 Agents Used:
   • supervisor-1 (coordinator)
   • worker-backend-1 (code review)
   • worker-security-1 (security audit)

[View Full Report] [Apply Fixes] [Close]
```

#### Tier 3: Historical Records (Persistent Storage)

```typescript
// Stored in .society-agent/
.society-agent/
  executions/
    purpose-123.jsonl          // Complete execution log
    purpose-123-summary.json   // Quick summary
  results/
    purpose-123/
      report.md                // Human-readable report
      artifacts/               // All created files
      agent-logs/              // Individual agent logs
```

**Access Methods**:

1. **UI**: "History" tab showing past purposes
2. **CLI**: `kilo society history` or `kilo society show purpose-123`
3. **File System**: Direct access to `.society-agent/` folder

---

### 3. How to Control Agents (Prevent Infinite Loops)?

**Multi-Layer Safety System**:

#### Layer 1: Time Limits (Hard Cutoff)

```typescript
interface PurposeConfig {
	// Maximum duration before force-stop
	maxDurationMinutes: number // Default: 30 minutes

	// Warning before timeout
	warningAtPercent: number // Default: 80% (24 min warning)
}

// Implementation
class SocietyManager {
	async startPurpose(context: PurposeContext): Promise<string> {
		const timeoutMs = config.maxDurationMinutes * 60 * 1000

		const timeoutId = setTimeout(() => {
			this.stopPurpose(purposeId, "Timeout: Exceeded maximum duration")
		}, timeoutMs)

		// Warning at 80%
		const warningMs = timeoutMs * 0.8
		setTimeout(() => {
			this.warn(purposeId, `Approaching timeout (${0.2 * config.maxDurationMinutes} min remaining)`)
		}, warningMs)
	}
}
```

#### Layer 2: Action Limits (Prevent Runaway)

```typescript
interface AgentLimits {
	maxActionsPerAgent: number // Default: 100 actions
	maxFileWrites: number // Default: 50 files
	maxShellCommands: number // Default: 20 commands
	maxApiCalls: number // Default: 500 calls
	maxTokensPerAgent: number // Default: 500k tokens
}

// Track per agent
class ConversationAgent {
	private actionCount = 0
	private fileWriteCount = 0
	private shellCommandCount = 0

	async executeAction(action: Action): Promise<void> {
		this.actionCount++

		if (this.actionCount > limits.maxActionsPerAgent) {
			throw new Error("Agent exceeded action limit - possible infinite loop")
		}

		// Execute with limit checks
		if (action.type === "file-write") {
			this.fileWriteCount++
			if (this.fileWriteCount > limits.maxFileWrites) {
				throw new Error("Too many file writes - stopping agent")
			}
		}
	}
}
```

#### Layer 3: Progress Monitoring (Detect Stuck Agents)

```typescript
interface ProgressMonitoring {
	// If no progress for X minutes, flag as stuck
	stallDetectionMinutes: number // Default: 5 minutes

	// If same action repeats N times, flag as loop
	maxIdenticalActions: number // Default: 3 times
}

class SupervisorAgent {
	private monitorWorkers() {
		setInterval(() => {
			for (const worker of this.workers) {
				// Check last progress update
				const timeSinceProgress = Date.now() - worker.lastProgressAt

				if (timeSinceProgress > 5 * 60 * 1000) {
					// 5 minutes
					console.warn(`Worker ${worker.id} appears stuck`)
					this.interventions.push({
						type: "guidance",
						workerId: worker.id,
						message: "No progress in 5 minutes. Try a different approach.",
					})
				}

				// Check for repeated actions
				const recentActions = worker.history.slice(-5)
				const uniqueActions = new Set(recentActions.map((a) => a.action))

				if (uniqueActions.size === 1 && recentActions.length >= 3) {
					console.warn(`Worker ${worker.id} repeating same action`)
					this.stopWorker(worker.id, "Detected infinite loop")
				}
			}
		}, 30000) // Check every 30 seconds
	}
}
```

#### Layer 4: Cost Limits (Protect Budget)

```typescript
interface CostLimits {
	maxCostPerPurpose: number // Default: $5.00
	maxCostPerAgent: number // Default: $2.00
	warningAtPercent: number // Default: 75%
}

class CostTracker {
	private estimatedCost = 0

	beforeApiCall(tokens: number) {
		const estimatedCallCost = this.estimateCost(tokens)

		if (this.estimatedCost + estimatedCallCost > limits.maxCostPerPurpose) {
			throw new Error("Purpose would exceed cost limit - aborting")
		}

		if (this.estimatedCost > limits.maxCostPerPurpose * 0.75) {
			this.warn("Approaching cost limit (75% used)")
		}
	}
}
```

#### Layer 5: Human Oversight (Manual Controls)

```typescript
// Always available controls
interface PurposeControls {
    pause(): void          // Pause all agents immediately
    resume(): void         // Resume paused purpose
    stop(): void           // Stop and cleanup
    pauseAgent(id): void   // Pause single agent
    setLimit(type, value): void  // Adjust limits on-the-fly
}

// UI buttons always visible
[Pause All] [Stop Purpose] [View Logs] [Adjust Limits]
```

---

## Recommended Production Configuration

### Starter Configuration (Safe & Simple)

```typescript
const productionConfig = {
	// One purpose at a time
	maxConcurrentPurposes: 1,
	queueMode: "sequential",

	// Safety limits
	maxDurationMinutes: 30,
	maxActionsPerAgent: 100,
	maxFileWrites: 50,
	maxShellCommands: 20,
	maxApiCalls: 500,
	maxCostPerPurpose: 5.0,

	// Monitoring
	stallDetectionMinutes: 5,
	maxIdenticalActions: 3,
	progressUpdateInterval: 30, // seconds

	// Results
	saveResults: true,
	resultPath: ".society-agent/results",
	keepHistoryDays: 30,
}
```

### Advanced Configuration (Multi-Purpose)

```typescript
const advancedConfig = {
	// Multiple purposes
	maxConcurrentPurposes: 5,
	queueMode: "concurrent",
	purposePriority: "fifo", // or "priority-based"

	// Higher limits
	maxDurationMinutes: 60,
	maxActionsPerAgent: 500,
	maxFileWrites: 200,
	maxCostPerPurpose: 20.0,

	// Resource pooling
	sharedAgentPool: true,
	maxTotalAgents: 20, // Across all purposes

	// Advanced monitoring
	anomalyDetection: true,
	autoRecovery: true,
	escalateOnStall: true,
}
```

---

## UI Design Recommendations

### Single Purpose Mode UI (Recommended First)

```
┌─────────────────────────────────────────────────────────────┐
│ Society Agent                                    [⚙️ Settings]│
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Current Purpose: "Review authentication code"               │
│  Status: Executing  |  Duration: 2m 15s  |  Progress: 45%    │
│  [████████░░░░░░░░░░]                                        │
│                                                               │
│  ⏸️ Pause   ⏹️ Stop   📊 View Logs   ⚙️ Adjust Limits       │
│                                                               │
├─────────────────────────────────────────────────────────────┤
│ Active Agents (3)                                             │
│                                                               │
│  🤖 supervisor-1          [Monitoring]                        │
│     Coordinating 2 workers                                    │
│                                                               │
│  🔧 worker-backend-1      [Working]                           │
│     Task: Reviewing auth.ts                                   │
│     Progress: 60% (45/100 actions)                            │
│                                                               │
│  🛡️ worker-security-1     [Working]                           │
│     Task: Security audit                                      │
│     Progress: 30% (20/100 actions)                            │
│                                                               │
├─────────────────────────────────────────────────────────────┤
│ Recent Activity                                               │
│                                                               │
│  • 14:32:45 - worker-backend-1: Found potential issue        │
│  • 14:32:40 - supervisor-1: Assigned task to worker-2        │
│  • 14:32:35 - worker-security-1: Scanning for SQL injection  │
│  • 14:32:30 - supervisor-1: Created team of 2 workers        │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Multi-Purpose Mode UI (Future)

```
┌─────────────────────────────────────────────────────────────┐
│ Society Agent - Active Purposes (3)              [+ New]      │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│ ┌─────────────────────────────────┐                          │
│ │ 📝 Review PR #123         [⏸️⏹️] │  70% │ 5m 20s  │  3🤖  │
│ └─────────────────────────────────┘                          │
│                                                               │
│ ┌─────────────────────────────────┐                          │
│ │ 📚 Update documentation   [⏸️⏹️] │  45% │ 3m 10s  │  2🤖  │
│ └─────────────────────────────────┘                          │
│                                                               │
│ ┌─────────────────────────────────┐                          │
│ │ 🧪 Run test suite         [⏸️⏹️] │  10% │ 1m 05s  │  1🤖  │
│ └─────────────────────────────────┘                          │
│                                                               │
├─────────────────────────────────────────────────────────────┤
│ System Resources                                              │
│  Agents: 6/20  |  Cost: $2.45/$20.00  |  CPU: 45%            │
└─────────────────────────────────────────────────────────────┘

[Click any purpose to see details]
```

---

## Implementation Priority

### Phase 1: Single Purpose + Controls (MVP)

**Time**: 4-6 hours

1. **Implement time limits** (2 hours)

    - Add timeout to startPurpose()
    - Add warning at 80%
    - Force-stop on timeout

2. **Implement action limits** (1 hour)

    - Track action counts per agent
    - Throw error on limit exceeded

3. **Add manual controls** (2 hours)

    - Pause button → agent.pause()
    - Stop button → team.stopAll()
    - View logs button

4. **Result display** (1 hour)
    - Show completion summary
    - List artifacts created
    - Display agent stats

### Phase 2: Multi-Purpose Support (Future)

**Time**: 6-8 hours

1. Concurrent purpose execution
2. Resource pooling
3. Priority queue
4. Multi-purpose UI

---

## Decision Required: Which Path?

### Option A: Simple & Safe (Recommended)

- ✅ Single purpose at a time
- ✅ 30-minute timeout
- ✅ Action limits
- ✅ Manual pause/stop controls
- ✅ Clear results display
- **Time to implement**: 4-6 hours
- **Works for**: 90% of use cases

### Option B: Full Featured

- All of Option A, plus:
- ✅ Multiple concurrent purposes
- ✅ Resource pooling
- ✅ Priority queues
- ✅ Advanced monitoring
- **Time to implement**: 10-14 hours
- **Works for**: Large teams, production

---

## What Do You Want to Build?

**My Recommendation**: **Start with Option A (Simple & Safe)**

Reasons:

1. ✅ Works immediately for testing
2. ✅ Easier to debug
3. ✅ Clear user experience
4. ✅ Can upgrade to Option B later
5. ✅ 90% of users only need one purpose at a time

**Next Action**: Shall I implement Option A (Single purpose + controls + results)?

This would give you a **fully functional, production-ready system** in 4-6 hours that:

- Runs one purpose safely
- Has timeout protection
- Shows clear results
- Can't run forever
- Has manual controls

**What do you think?** 🚀
