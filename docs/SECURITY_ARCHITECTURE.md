# Society Agent Security Architecture

## Document Purpose

This document captures security architecture thoughts for multi-tenant, production-grade deployment of Society Agent. Each section includes:
- **Principle**: The security concept
- **Current State**: How the existing code handles this
- **Gap**: What's missing
- **Implementation Options**: Possible approaches
- **Decision**: TBD - to be filled in after evaluation

---

## 1. Core Philosophy

### Principle
- The core is memoryless and deterministic in responsibility
- Persistent agents are stateful actors
- Ephemeral agents are disposable executors
- Isolation boundaries are more important than features
- Every boundary must assume compromise

### Current State
- Single monolithic `society-server.ts` handles everything
- No separation between control and execution
- Agents run in same process as orchestrator

### Gap
- Major architectural split needed
- No assumption of compromise in current design

### Implementation Options
1. **Minimal**: Add input validation at all boundaries
2. **Moderate**: Split into logical modules (same process)
3. **Full**: Separate control plane and execution plane processes

### Decision
- [ ] Evaluate: ________________
- [ ] Priority: ________________
- [ ] Timeline: ________________

---

## 2. Trust Boundaries

### Principle

**Control Plane (Trusted):**
- Core reasoning engine
- Scheduler
- Policy engine
- Secret broker
- Agent lifecycle manager
- Audit logging

This layer must NEVER execute arbitrary shell commands.

**Execution Plane (Untrusted):**
- Persistent agent runtimes
- Ephemeral agent sandboxes
- Tool runners

Assume anything here can be compromised via prompt injection or malicious input.

### Current State
- `handleSupervisorChat()` does both reasoning AND tool execution
- `executeSupervisorTool()` runs shell commands in same process
- No separation of trust levels

### Gap
- Control plane executes untrusted code
- No boundary between coordination and execution

### Implementation Options
1. **Immediate**: Add command allowlisting in `executeSupervisorTool()`
2. **Short-term**: Wrap command execution with Firejail
3. **Medium-term**: Spawn separate process for tool execution
4. **Long-term**: Container per agent session

### Decision
- [ ] Evaluate: ________________
- [ ] Priority: ________________
- [ ] Timeline: ________________

---

## 3. Agent Model

### Principle
Each persistent agent must be:
- An actor (independent execution unit)
- Namespaced (isolated identity)
- Identified (unique, traceable)
- Policy-scoped (explicit permissions)
- Quota-limited (resource bounds)

Required properties:
- `agent_id`
- `project_id`
- `capability_profile`
- `resource_limits`

Agents communicate through permissioned channels, NOT direct filesystem mutation.

### Current State
```typescript
// Current ProjectAgentConfig
interface ProjectAgentConfig {
  id: string;           // ✓ Has ID
  name: string;
  role: string;
  homeFolder: string;   // ✓ Has namespace (folder)
  model?: string;
  // Missing: capabilities, resource_limits, policy_scope
}
```

### Gap
- No capability profiles
- No resource limits per agent
- Communication via filesystem (direct mutation)

### Implementation Options
1. **Extend config**: Add `capabilities` and `resourceLimits` to `ProjectAgentConfig`
2. **Add policy file**: `AGENTS.md` could include capability declarations
3. **Runtime enforcement**: Check capabilities before tool execution

### Decision
- [ ] Evaluate: ________________
- [ ] Priority: ________________
- [ ] Timeline: ________________

---

## 4. Filesystem Model

### Principle
- Agents MAY read the entire project tree
- Agents MAY write ONLY to their dedicated folder
- NO agent writes directly into another agent's folder
- Filesystem enforcement must happen at mount layer, not application logic

**Ephemeral agents should:**
- Write only to a temporary workspace
- Return artifacts to parent agent
- Never commit state directly

### Current State
```typescript
// Current write_file implementation
case "write_file": {
  const filePath = path.resolve(agentWorkspace, input.path);
  // Only checks if path starts with agentWorkspace
  // Application-level check, not kernel-level
}
```

### Gap
- Path validation is application-level (can be bypassed via symlinks, etc.)
- No mount-level enforcement
- Agents can write anywhere if they craft path carefully

### Implementation Options
1. **Immediate**: Add symlink attack prevention
2. **Short-term**: Use `realpath()` validation
3. **Medium-term**: `chroot` or `firejail --private=`
4. **Long-term**: Container volume mounts (read-only project, read-write workspace)

### Current Code to Review
```typescript
// In executeSupervisorTool(), write_file case
// Location: society-server.ts ~line 4900
```

### Decision
- [ ] Evaluate: ________________
- [ ] Priority: ________________
- [ ] Timeline: ________________

---

## 5. Capability Model

### Principle
Agents do NOT receive raw secrets. Instead they receive:
- Short-lived scoped tokens
- Task-scoped capabilities
- Explicit tool permissions

Capabilities must expire automatically.

### Current State
- API keys passed via environment variables
- All agents have access to same keys
- No capability scoping or expiration

### Gap
- Raw secrets in execution environment
- No token broker
- No per-agent capability profiles

### Implementation Options
1. **Immediate**: Don't log or expose API keys
2. **Short-term**: Proxy API calls through control plane
3. **Medium-term**: Implement secret broker with short-lived tokens
4. **Long-term**: Integrate with Vault or similar

### Token Structure (Future)
```typescript
interface CapabilityToken {
  token_id: string;
  agent_id: string;
  capabilities: string[];  // ['llm:chat', 'fs:read', 'fs:write:own']
  resource: string;        // 'anthropic' | 'openai' | 'github'
  expires_at: number;      // Short-lived (5 min)
  rate_limit: number;      // Max calls
}
```

### Decision
- [ ] Evaluate: ________________
- [ ] Priority: ________________
- [ ] Timeline: ________________

---

## 6. Sandboxing Model

### Principle

**Ephemeral agents:**
- Run in microVM-backed containers (e.g., Kata)
- Non-root
- No privilege escalation
- Read-only root filesystem
- Deny-all network by default
- Strict CPU, memory, PID, and time limits

**Persistent agents:**
- Hardened service containers
- No unrestricted shell access
- No Docker socket

### Current State
- All agents run in main Node.js process
- Full network access
- No resource limits (except token limiter we just added)
- Root filesystem writable

### Gap
- No process isolation
- No network isolation
- No resource isolation at OS level

### Implementation Options
1. **Immediate**: Add timeout to command execution (already partially done)
2. **Short-term**: Firejail wrapper for `run_command`
3. **Medium-term**: Spawn agent runners as separate processes with limits
4. **Long-term**: K8s Jobs with security contexts

### Firejail Example (Short-term)
```typescript
// Wrap command execution
const sandboxedCmd = `firejail --private=${workdir} --net=none --caps.drop=all -- ${cmd}`;
```

### K8s SecurityContext (Long-term)
```yaml
securityContext:
  runAsNonRoot: true
  readOnlyRootFilesystem: true
  capabilities:
    drop: [ALL]
  seccompProfile:
    type: RuntimeDefault
```

### Decision
- [ ] Evaluate: ________________
- [ ] Priority: ________________
- [ ] Timeline: ________________

---

## 7. Communication Rules

### Principle
- All agent-to-agent communication goes through authenticated message fabric
- Enforce ACLs at message layer
- Rate limit communications
- Log all cross-agent requests
- Prevent lateral movement via free-form messaging

### Current State
```typescript
// Current send_message - direct filesystem write
case "send_message": {
  // Writes directly to target agent's inbox folder
  // No ACL check
  // No rate limiting
  // Basic logging only
}
```

### Gap
- No message fabric (direct filesystem)
- No ACLs
- No rate limiting on messages
- Any agent can message any other agent

### Implementation Options
1. **Immediate**: Add rate limiting to send_message
2. **Short-term**: Add ACL checks (agent can only message supervisor/subordinates)
3. **Medium-term**: Abstract message storage (Redis/DB instead of filesystem)
4. **Long-term**: Full message fabric with policy engine

### ACL Rules (Short-term)
```typescript
const DEFAULT_MESSAGE_ACLS = [
  { from: '*', to: '${supervisor}', allow: true },      // Can message supervisor
  { from: '*', to: '${subordinates}', allow: true },   // Can message subordinates
  { from: '*', to: '${peers}', allow: true, rateLimit: '10/min' },  // Limited peer messaging
  { from: '*', to: '*', allow: false },                 // Default deny
];
```

### Decision
- [ ] Evaluate: ________________
- [ ] Priority: ________________
- [ ] Timeline: ________________

---

## 8. Scheduling Discipline

### Principle
Scheduled jobs:
- Produce immutable JobSpecs
- Do NOT execute directly
- Are processed through the same orchestration pipeline as manual jobs

Avoid special-case execution paths.

### Current State
- No job scheduling system
- All execution is immediate/synchronous
- `handleSupervisorChat` executes tools inline

### Gap
- No job queue
- No deferred execution
- No immutable job specs

### Implementation Options
1. **N/A for current scope**: Focus on this when adding scheduled tasks feature
2. **Future**: Add job queue (Bull, BullMQ) for async execution
3. **Future**: All tool execution becomes job submission

### JobSpec Structure (Future)
```typescript
interface JobSpec {
  id: string;
  agent_id: string;
  project_id: string;
  type: 'shell' | 'write_file' | 'delegate' | 'llm_call';
  payload: Record<string, unknown>;
  capabilities_required: string[];
  resource_limits: ResourceLimits;
  created_at: number;
  // Immutable after creation
}
```

### Decision
- [ ] Evaluate: ________________
- [ ] Priority: ________________
- [ ] Timeline: ________________

---

## 9. Resource Governance

### Principle
Every agent must have:
- Concurrency limits
- Spawn limits
- Daily cost budget
- Kill switch

Prevent runaway spawning of ephemeral agents.

### Current State (After Recent Changes)
```typescript
// TokenLimiter - IMPLEMENTED ✓
const limits = {
  maxTokensPerAgent: 1_000_000,
  maxTokensPerProject: 5_000_000,
  maxCostPerAgent: 5.00,
  maxCostPerProject: 25.00,
  maxCostGlobal: 100.00,
};
```

### Gap
- ✅ Token/cost limits: IMPLEMENTED
- ❌ Concurrency limits: Not implemented
- ❌ Spawn limits: Not implemented
- ❌ Kill switch: Partial (stop button exists)

### Implementation Options
1. **Immediate**: Add agent spawn counter with limit
2. **Short-term**: Add concurrent agent limit
3. **Medium-term**: Per-agent resource quotas in config

### Spawn Limiter (To Add)
```typescript
interface SpawnLimits {
  maxConcurrentAgents: number;      // Default: 5
  maxSpawnsPerHour: number;         // Default: 20
  maxTotalAgentsPerProject: number; // Default: 50
}
```

### Decision
- [ ] Evaluate: ________________
- [ ] Priority: ________________
- [ ] Timeline: ________________

---

## 10. Observability and Forensics

### Principle
Log:
- Every job execution
- Every filesystem write
- Every capability issuance
- Every network egress request

Maintain an append-only audit trail. Make behavior reconstructable.

### Current State
- Basic `log.info()` calls throughout
- `UsageTracker` for token usage
- `ActivityLogger` for high-level actions
- Tool execution events emitted to UI

### Gap
- Logs not append-only (can be modified)
- No structured audit trail
- No filesystem write logging
- No network egress logging

### Implementation Options
1. **Immediate**: Add structured logging for all tool executions
2. **Short-term**: Write audit log to append-only file
3. **Medium-term**: Send audit events to external system (Loki, CloudWatch)
4. **Long-term**: Immutable audit trail with checksums

### Audit Log Structure
```typescript
interface AuditEntry {
  id: string;
  timestamp: number;
  trace_id: string;          // For distributed tracing
  
  actor: {
    type: 'user' | 'agent';
    id: string;
    project_id: string;
  };
  
  action: string;            // 'tool:run_command', 'tool:write_file', 'message:send'
  target: string;            // File path, agent ID, etc.
  
  input_hash: string;        // SHA256 of input (not the input itself)
  result: 'success' | 'denied' | 'error';
  
  policy_checks: string[];   // Which policies were evaluated
  
  // For forensics
  context_snapshot?: {
    token_usage_before: number;
    concurrent_agents: number;
  };
}
```

### Decision
- [ ] Evaluate: ________________
- [ ] Priority: ________________
- [ ] Timeline: ________________

---

## 11. Design Principles Summary

| Principle | Current State | Priority |
|-----------|---------------|----------|
| Isolation > Convenience | ❌ Convenience wins | HIGH |
| Capabilities > Credentials | ❌ Raw credentials | MEDIUM |
| Ephemeral > Long-lived | ⚠️ Partial | LOW |
| Explicit > Implicit | ⚠️ Partial | MEDIUM |
| Deny-by-default > Allow-by-default | ❌ Allow-by-default | HIGH |

---

## 12. Cross-Department Supervision Model

### Principle (Key Insight)

> **"Supervisory scope determines what you can ASK FOR. Capability scope determines what actually EXECUTES."**

Current system property:
- Any human user may become the supervisor of any department
- Any user may coordinate agents across departments
- No structural restriction binding users to specific departments

This implies:
- Department boundaries are LOGICAL, not SECURITY boundaries
- User authority is dynamic and potentially global
- Security must be enforced at capability/action level, not department level

### Required Safeguards

Even if users can supervise any department:
1. All supervision actions must be authenticated and logged
2. Agent spawning must still respect per-agent and per-project quotas
3. Cross-department coordination must go through the same message fabric
4. NO implicit write permissions based on supervisory role alone

### Current State
- Users can interact with any project/agent via UI
- No authentication (single-user assumption)
- No per-user quotas

### Gap
- No user authentication
- No user-level audit trail
- Supervisory access implies execution access

### Implementation Options
1. **Immediate**: Log user actions with session ID
2. **Short-term**: Add user authentication (JWT)
3. **Medium-term**: Per-user quotas and permissions
4. **Long-term**: Full RBAC with role-capability mapping

### Key Rule
```typescript
// WRONG
if (user.canSupervise(department)) {
  agent.executeWithFullPermissions();
}

// RIGHT
if (user.canSupervise(department)) {
  // User can COORDINATE - route request through policy engine
  const request = await policyEngine.evaluate({
    user: user.id,
    action: 'spawn_agent',
    target: department.id,
    requestedCapabilities: [...],
  });
  
  if (request.allowed) {
    // Agent still executes with CONSTRAINED capabilities
    agent.executeWithCapabilities(request.grantedCapabilities);
  }
}
```

### Decision
- [ ] Evaluate: ________________
- [ ] Priority: ________________
- [ ] Timeline: ________________

---

## 13. Newly Identified Security Risks

### Core Realization

> **The system currently assumes cooperative agents. The expanded system must assume adversarial or compromised agents.**

Any agent may attempt:
- Impersonation
- Privilege escalation
- Lateral movement
- Data exfiltration

**The architecture must prevent these behaviors STRUCTURALLY, not by convention.**

---

### 13.1 Agent Impersonation Risk

#### Threat
Agents may disguise themselves as other agents if:
- Sender identity is trusted from message payload
- Agents share credentials
- Message broker lacks per-agent ACL enforcement
- No cryptographic binding exists between runtime identity and `agent_id`

#### Impact
Compromised agents can:
- Send commands as other agents
- Escalate influence
- Cause cross-agent manipulation
- Bypass ACLs by claiming false identity

#### Current State
```typescript
// Message sender is self-declared in payload
const message = {
  from: { id: agentId, name: agentName },  // Agent declares its own identity
  to: targetAgentId,
  content: "...",
};
// No verification that sender IS who they claim to be
```

#### Mitigations
| Option | Description | Effort |
|--------|-------------|--------|
| **Immediate** | Server-side injection of sender identity (don't trust payload) | LOW |
| **Short-term** | Message signing with per-agent keys | MEDIUM |
| **Long-term** | Cryptographic identity binding at spawn time | HIGH |

#### Implementation (Immediate)
```typescript
// DON'T trust agent-provided identity
// case "send_message":
//   const from = input.from;  // ❌ Agent-provided

// DO inject identity server-side
case "send_message": {
  const verifiedFrom = {
    id: currentAgent.id,           // From authenticated context
    name: currentAgent.name,
    project_id: currentAgent.projectId,
  };
  // Use verifiedFrom, ignore any from in input
}
```

### Decision
- [ ] Evaluate: ________________
- [ ] Priority: ________________
- [ ] Timeline: ________________

---

### 13.2 Global Read Access as Secret Exfiltration Vector

#### Threat
All persistent agents can read the entire project tree.

If secrets, tokens, credentials, or broker keys exist anywhere in that tree, any agent can:
- Steal them
- Replay them
- Use them to impersonate others

#### Rule
> **Filesystem read access must be treated as NON-SECRET.**
> **No authentication material may reside in shared readable storage.**

#### Current State
```typescript
// Agents can read any file in project
case "read_file": {
  const content = fs.readFileSync(path.join(projectRoot, input.path));
  // No filtering of sensitive content
}
```

#### Sensitive Data at Risk
| Data Type | Current Location | Risk |
|-----------|------------------|------|
| API keys | `.env`, environment | HIGH - if readable |
| Agent private keys | (not implemented) | N/A |
| Message signing keys | (not implemented) | N/A |
| User tokens | (not implemented) | N/A |

#### Mitigations
| Option | Description | Effort |
|--------|-------------|--------|
| **Immediate** | Never write secrets to project tree | LOW |
| **Short-term** | Exclude sensitive paths from read (`.env`, `.secrets/`) | LOW |
| **Medium-term** | Secret broker - agents never see raw secrets | HIGH |
| **Long-term** | All secrets in Vault/KMS, accessed via capability tokens | HIGH |

#### Implementation (Immediate)
```typescript
// Block reading sensitive files
const BLOCKED_PATTERNS = [
  /\.env$/,
  /\.env\..*/,
  /secrets?\//i,
  /\.pem$/,
  /\.key$/,
  /credentials/i,
  /\.npmrc$/,
  /\.netrc$/,
];

case "read_file": {
  if (BLOCKED_PATTERNS.some(p => p.test(input.path))) {
    return { result: "❌ Access denied: sensitive file", filesCreated: 0 };
  }
  // ... proceed with read
}
```

### Decision
- [ ] Evaluate: ________________
- [ ] Priority: ________________
- [ ] Timeline: ________________

---

### 13.3 Discovery via Mutable Text File

#### Threat
Persistent agents are dynamically created. Discovery is performed through shared configuration files (`AGENTS.md`, project store JSON).

Risks:
- Agent registration spoofing
- Overwriting legitimate entries
- Race conditions (TOCTOU - Time of Check to Time of Use)
- Injection of fake endpoints or topics
- Lateral redirection of messages

#### Rule
> **Agents must NOT be able to introduce or alter identities via writable shared files.**

#### Current State
```typescript
// Agents can write to their own folder, which may include config
case "write_file": {
  // If agent writes to AGENTS.md or modifies discovery file...
  // They could inject fake agent definitions
}

// Project store is written by server, but...
// No integrity verification on read
```

#### Attack Scenario
1. Agent A writes fake agent definition to discovery file
2. Agent A sends message "to" fake agent
3. Message is intercepted or redirected
4. Agent A gains access to messages meant for others

#### Mitigations
| Option | Description | Effort |
|--------|-------------|--------|
| **Immediate** | Block agent writes to discovery files (AGENTS.md, *.json in project root) | LOW |
| **Short-term** | Server-only writes to registry, agents have read-only access | MEDIUM |
| **Medium-term** | Signed registry entries, verified on read | HIGH |
| **Long-term** | Centralized registry service, no filesystem-based discovery | HIGH |

#### Implementation (Immediate)
```typescript
// Block writes to sensitive config files
const PROTECTED_FILES = [
  /^AGENTS\.md$/i,
  /^agents\.json$/i,
  /^project\.json$/i,
  /^\.society-agent\//,
];

case "write_file": {
  const relativePath = path.relative(projectRoot, fullPath);
  if (PROTECTED_FILES.some(p => p.test(relativePath))) {
    return { result: "❌ Access denied: protected configuration file", filesCreated: 0 };
  }
  // ... proceed with write
}
```

### Decision
- [ ] Evaluate: ________________
- [ ] Priority: ________________
- [ ] Timeline: ________________

---

### 13.4 Supervisor Amplification Risk

#### Threat
Supervisors can:
- Spawn ephemeral agents
- Use subordinate persistent agents
- Coordinate across departments

If supervisor identity or delegation is not capability-scoped and time-bound, compromise of one supervisor can cascade across many agents.

#### Rule
> **Supervisory authority must NOT equal unlimited execution authority.**

#### Current State
- Supervisors can spawn unlimited agents (now limited by token budget)
- Supervisors can delegate to any subordinate without scope limits
- No time-bound delegation tokens
- No capability narrowing on delegation

#### Attack Scenario
1. Attacker compromises supervisor agent (via prompt injection)
2. Supervisor spawns 10 ephemeral agents
3. Each ephemeral agent spawns 10 more
4. Exponential resource consumption / attack surface

#### Mitigations
| Option | Description | Effort |
|--------|-------------|--------|
| **Immediate** | ✅ Token/cost limits (IMPLEMENTED) | DONE |
| **Short-term** | Spawn limits per supervisor | LOW |
| **Short-term** | Delegation depth limit (max 3 levels) | LOW |
| **Medium-term** | Time-bound delegation tokens | MEDIUM |
| **Long-term** | Capability narrowing on each delegation | HIGH |

#### Spawn Limits (To Add)
```typescript
interface SupervisorLimits {
  maxDirectSpawns: number;           // Max ephemeral agents this supervisor can spawn
  maxDelegationDepth: number;        // Max levels of delegation (default: 3)
  maxConcurrentSubordinates: number; // Max active subordinates at once
  delegationExpiresAfter: number;    // Delegation tokens expire (ms)
}

// Check before spawning
if (supervisor.activeSpawns >= limits.maxDirectSpawns) {
  throw new Error("Spawn limit reached for this supervisor");
}
```

### Decision
- [ ] Evaluate: ________________
- [ ] Priority: ________________
- [ ] Timeline: ________________

---

### 13.5 Cross-Agent Message Fabric Weakness

#### Threat
If the message bus does not enforce:
- Per-agent publish ACLs
- Per-agent subscribe ACLs
- Authenticated transport identity
- Message expiration and replay protection

Then lateral movement and worm-like propagation becomes possible.

#### Attack Scenario: Agent Worm
1. Agent A is compromised
2. Agent A sends malicious prompt to Agent B via message
3. Agent B executes prompt, becomes compromised
4. Agent B sends to Agents C, D, E...
5. Entire agent network is compromised

#### Current State
```typescript
// No ACLs - any agent can message any agent
case "send_message": {
  sendToInbox(projectId, fromAgent, targetAgentId, message);
  // No check: can fromAgent message targetAgent?
}

// No replay protection
// Same message can be re-sent infinitely

// No expiration
// Old messages in inbox are processed regardless of age
```

#### Mitigations
| Option | Description | Effort |
|--------|-------------|--------|
| **Immediate** | Rate limiting per sender-receiver pair | LOW |
| **Immediate** | Message deduplication (by hash) | LOW |
| **Short-term** | ACLs: supervisor ↔ subordinate only | MEDIUM |
| **Short-term** | Message expiration (TTL) | LOW |
| **Medium-term** | Signed messages with nonce (replay protection) | MEDIUM |
| **Long-term** | Full policy engine for message routing | HIGH |

#### Implementation (Immediate)
```typescript
// Rate limiting
const MESSAGE_RATE_LIMITS = new Map<string, { count: number; resetAt: number }>();
const MAX_MESSAGES_PER_MINUTE = 10;

function checkMessageRateLimit(fromId: string, toId: string): boolean {
  const key = `${fromId}:${toId}`;
  const now = Date.now();
  const limit = MESSAGE_RATE_LIMITS.get(key);
  
  if (!limit || now > limit.resetAt) {
    MESSAGE_RATE_LIMITS.set(key, { count: 1, resetAt: now + 60000 });
    return true;
  }
  
  if (limit.count >= MAX_MESSAGES_PER_MINUTE) {
    return false;  // Rate limited
  }
  
  limit.count++;
  return true;
}

// Message expiration  
interface InboxMessage {
  // ... existing fields
  expiresAt: number;  // Default: timestamp + 1 hour
}

// Skip expired messages when processing inbox
const validMessages = inbox.filter(m => m.expiresAt > Date.now());
```

### Decision
- [ ] Evaluate: ________________
- [ ] Priority: ________________
- [ ] Timeline: ________________

---

### 13.6 Overreliance on Organizational Boundaries

#### Threat
Departments, sections, and supervision hierarchy are LOGICAL constructs. They are NOT security boundaries.

If security relies on:
- "Agent A is in Department X, so it can't access Department Y" ❌
- "User supervises Department X, so they're trusted" ❌
- "Agents in same department can share secrets" ❌

Then organizational structure changes break security assumptions.

#### Rule
> **Security must be enforced through:**
> - Infrastructure isolation (containers, namespaces)
> - Cryptographic identity (signed tokens, keys)
> - Capability tokens (explicit, scoped, time-bound)
> - Runtime sandboxing (process isolation, seccomp)
>
> **NOT through:**
> - Department labels
> - Organizational hierarchy
> - Naming conventions
> - Trust assumptions

#### Current State
- Departments are folder names
- No infrastructure isolation per department
- No cryptographic boundaries
- Security = application-level path checks

#### Correct Model
```
ORGANIZATIONAL LAYER (Flexible, No Security Guarantees)
┌─────────────────────────────────────────────────────┐
│  Departments, Teams, Supervision Hierarchy          │
│  - For coordination and workflow                    │
│  - Can change without security review               │
│  - No isolation guarantees                          │
└─────────────────────────────────────────────────────┘
                      │
                      │ All requests go through
                      ▼
SECURITY LAYER (Rigid, Enforced)
┌─────────────────────────────────────────────────────┐
│  Policy Engine → Capability Check → Sandbox        │
│  - Infrastructure isolation                         │
│  - Cryptographic identity                           │
│  - Explicit capabilities                            │
│  - Runtime constraints                              │
└─────────────────────────────────────────────────────┘
```

### Decision
- [ ] Evaluate: ________________
- [ ] Priority: ________________
- [ ] Timeline: ________________

---

## 13.7 Threat Model Summary

| Threat | Vector | Current Exposure | Mitigation Priority |
|--------|--------|------------------|---------------------|
| Agent Impersonation | Self-declared identity in messages | HIGH | **CRITICAL** |
| Secret Exfiltration | Global read access | MEDIUM | HIGH |
| Registry Poisoning | Writable discovery files | MEDIUM | HIGH |
| Supervisor Amplification | Unlimited delegation | MEDIUM (token limits help) | MEDIUM |
| Message Worm | Unrestricted agent-to-agent messaging | HIGH | **CRITICAL** |
| Org Boundary Bypass | No infrastructure isolation | HIGH | MEDIUM |

### Attack Surface Reduction Priorities

1. **CRITICAL - Do First**
   - Server-side sender identity injection (don't trust payload)
   - Message rate limiting between agents
   - Block writes to discovery/config files

2. **HIGH - Do Soon**
   - Block reads of sensitive files (.env, credentials)
   - Message ACLs (supervisor ↔ subordinate only)
   - Spawn limits per supervisor

3. **MEDIUM - Planned**
   - Message signing and expiration
   - Delegation depth limits
   - Capability narrowing on delegation

4. **LOW - Future**
   - Full cryptographic identity
   - Container isolation
   - Centralized registry service

---

## Implementation Roadmap

### Phase 2a: Soft Isolation (Immediate - 2-3 weeks)
- [ ] **CRITICAL**: Server-side sender identity injection (13.1)
- [ ] **CRITICAL**: Message rate limiting between agents (13.5)
- [ ] Block writes to discovery/config files (13.3)
- [ ] Block reads of sensitive files (.env, credentials) (13.2)
- [ ] Command allowlisting in `executeSupervisorTool()`
- [ ] Path validation hardening (symlink prevention)
- [ ] Basic ACLs for agent messaging (supervisor ↔ subordinate)
- [ ] Structured audit logging
- [ ] Spawn limits per supervisor (13.4)

### Phase 2b: Process Isolation (Short-term - 2-3 weeks)
- [ ] Firejail wrapper for command execution
- [ ] Split control/execution in code (logical separation)
- [ ] Agent capability profiles in config
- [ ] Per-agent resource quotas
- [ ] Message expiration (TTL) and deduplication (13.5)
- [ ] Delegation depth limits (13.4)
- [ ] Message signing with per-agent keys (13.1)

### Phase 2c: Container Isolation (Medium-term - 3-4 weeks)
- [ ] K8s Job per agent session
- [ ] Volume mount-level filesystem isolation
- [ ] Network policies (deny egress by default)
- [ ] Secret broker for API key proxying
- [ ] Cryptographic identity binding at spawn time (13.1)
- [ ] Centralized registry service (13.3)
- [ ] Full policy engine for message routing (13.5)

### Phase 2d: Production Hardening (Long-term - 2-3 weeks)
- [ ] User authentication and authorization
- [ ] Full message fabric with policy engine
- [ ] Immutable audit trail
- [ ] Forensic dashboard
- [ ] Time-bound delegation tokens with capability narrowing (13.4)
- [ ] Replay protection (signed nonces) (13.5)

---

## Evaluation Checklist

For each principle, evaluate:

1. **Risk**: What's the blast radius if this is exploited?
2. **Likelihood**: How likely is exploitation in target deployment?
3. **Effort**: How much work to implement?
4. **Dependencies**: What else needs to be in place first?
5. **User Impact**: Does this affect usability?

| Principle | Risk | Likelihood | Effort | Dependencies | User Impact |
|-----------|------|------------|--------|--------------|-------------|
| Trust boundaries | HIGH | MEDIUM | HIGH | None | Low |
| Filesystem isolation | HIGH | MEDIUM | MEDIUM | Trust boundaries | Low |
| Capability model | MEDIUM | LOW | HIGH | Trust boundaries | Low |
| Message ACLs | MEDIUM | LOW | MEDIUM | None | Medium |
| Resource governance | MEDIUM | MEDIUM | LOW | None | Low |
| Audit logging | LOW | N/A | LOW | None | None |
| **13.1 Agent Impersonation** | **CRITICAL** | HIGH | LOW | None | None |
| **13.2 Secret Exfiltration** | HIGH | MEDIUM | LOW | None | Low |
| **13.3 Registry Poisoning** | HIGH | MEDIUM | LOW | None | None |
| **13.4 Supervisor Amplification** | MEDIUM | MEDIUM | LOW | Token limits ✓ | Low |
| **13.5 Message Worm** | **CRITICAL** | MEDIUM | MEDIUM | None | Low |
| **13.6 Org Boundary Reliance** | HIGH | LOW | HIGH | Container infra | None |

---

## 14. Commercial Deployment Model

### Strategic Decision

To protect intellectual property while enabling broad adoption:

> **Open-source the client/executor. Keep orchestration proprietary.**

This model:
- Enables community adoption and trust
- Protects the "secret sauce" (orchestration logic, prompts, coordination)
- Creates sustainable revenue through API access
- Solves the "customer can read source via shell" problem

---

### Architecture: Client ↔ Server Split

```
OPEN SOURCE - Society Agent Client
┌─────────────────────────────────────────────────────────────────┐
│  github.com/yourorg/society-agent-client                        │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  UI Layer (Web/Desktop)                                  │   │
│  │  • Project management                                    │   │
│  │  • Agent chat interface                                  │   │
│  │  • File explorer                                         │   │
│  │  • Activity/usage display                                │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Local Workspace                                         │   │
│  │  • /projects/{project}/                                  │   │
│  │  • AGENTS.md (agent definitions)                         │   │
│  │  • Local files, code, docs                               │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Sandboxed Executor                                      │   │
│  │  • run_command() → Firejail/container                    │   │
│  │  • read_file() → Local FS                                │   │
│  │  • write_file() → Local FS (scoped)                      │   │
│  │  • Results returned to orchestrator                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                    WebSocket/HTTPS                              │
└──────────────────────────────┼──────────────────────────────────┘
                               │
                               ▼
PROPRIETARY - Society Orchestration Service
┌─────────────────────────────────────────────────────────────────┐
│  api.society-agent.com (your infrastructure)                    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Auth & Billing                                          │   │
│  │  • Customer API keys                                     │   │
│  │  • Usage metering                                        │   │
│  │  • Token/cost tracking                                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Orchestration Engine (SECRET SAUCE)                     │   │
│  │  • Agent coordination logic                              │   │
│  │  • Task decomposition                                    │   │
│  │  • Delegation strategies                                 │   │
│  │  • System prompts                                        │   │
│  │  • handleSupervisorChat() equivalent                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Model Access                                            │   │
│  │  • Your Anthropic/OpenAI keys                            │   │
│  │  • Model routing (cheap vs powerful)                     │   │
│  │  • Caching layer                                         │   │
│  │  • Rate limiting                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Policy Engine                                           │   │
│  │  • Per-customer limits                                   │   │
│  │  • Agent capability profiles                             │   │
│  │  • Message ACLs                                          │   │
│  │  • Security rules                                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Optional: Cloud Compute Mode                            │   │
│  │  • For customers without local infra                     │   │
│  │  • Sandboxed VMs on your servers                         │   │
│  │  • Higher price tier                                     │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

### Client ↔ Server Protocol

```typescript
// Client → Server: Start task
POST /api/v1/orchestrate
{
  "project_id": "architect",
  "agent_id": "john",
  "task": "Create a REST API for user management",
  "context": {
    "files": ["src/index.ts", "package.json"],  // Relevant file contents
    "agents": ["john", "coder", "documentation-specialist"],
    "recent_messages": [...]
  }
}

// Server → Client: Stream of actions
{
  "type": "action",
  "action_id": "abc123",
  "action": {
    "tool": "write_file",
    "args": { "path": "src/routes/users.ts", "content": "..." }
  }
}

// Client executes locally, reports result
POST /api/v1/result
{
  "action_id": "abc123",
  "result": { "success": true, "output": "File written" }
}

// Server continues orchestration based on result
{
  "type": "action",
  "action_id": "def456",
  "action": {
    "tool": "run_command",
    "args": { "command": "npm test" }
  }
}

// ... continues until task complete

{
  "type": "complete",
  "summary": "Created user management API with 3 endpoints..."
}
```

---

### Code Split: What Goes Where

| Component | Open Source (Client) | Proprietary (Server) |
|-----------|---------------------|----------------------|
| **UI** | ✅ Web interface, project.html, index.html | |
| **File operations** | ✅ read_file, write_file, list_files | |
| **Sandbox executor** | ✅ run_command with Firejail | |
| **Protocol/API spec** | ✅ TypeScript interfaces | |
| **Example agent configs** | ✅ Sample AGENTS.md | |
| **Orchestration logic** | | ✅ handleSupervisorChat() |
| **System prompts** | | ✅ Agent instructions |
| **Tool selection** | | ✅ Which tool to use when |
| **Coordination algorithms** | | ✅ Multi-agent strategies |
| **Policy engine** | | ✅ Security rules |
| **Model access** | | ✅ API key management |
| **Usage metering** | | ✅ Billing integration |

**From current `society-server.ts`:**

Move to **open source client**:
- Express routes for UI (`/`, `/project.html`, `/agent.html`)
- Static file serving (`/src/public/`)
- File CRUD operations (read, write, list, delete)
- Command execution (with sandboxing)
- Socket.io event transport
- Local project/agent storage

Keep **proprietary** (your server):
- `handleSupervisorChat()` - the LLM reasoning loop
- `executeSupervisorTool()` - tool dispatch logic
- `AGENT_TOOLS` with descriptions - defines agent capabilities
- System prompt generation - `buildSystemPrompt()`
- Token tracking and limits - `TokenLimiter`, `UsageTracker`
- All orchestration state machines

---

### Revenue Model

| Tier | Features | Price |
|------|----------|-------|
| **Free / OSS** | Open source client, BYO model API keys, no orchestration service | $0 |
| **Developer** | Orchestration API, shared model access, 100K tokens/month | $20/mo |
| **Team** | Higher limits, team workspace sync, priority support | $50/user/mo |
| **Enterprise** | Cloud compute mode, SSO, dedicated instance, SLA | Custom |

**Revenue streams:**
1. Token markup (your cost + margin)
2. Subscription for orchestration API
3. Cloud compute for enterprises
4. Support/consulting

---

### Deployment Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| **Local + API** | Client on user machine, orchestration via API | Developers, small teams |
| **Hybrid** | Client on-prem, orchestration via API | Security-conscious orgs |
| **Cloud Compute** | Everything on your servers | Enterprise, no local infra |
| **Air-gapped** | Full on-prem (enterprise license) | Government, regulated |

---

### Development Path

**Phase 1 (Current):** Monolithic `society-server.ts`
- Keep for rapid development
- Single-user, trusted environment
- All code in one place

**Phase 2:** Logical split in code
- Separate modules: `client/` and `orchestration/`
- Still runs as one process
- Preparation for split

**Phase 3:** Physical split
- Client: standalone npm package
- Server: deployed API service
- Protocol: HTTPS + WebSocket

**Phase 4:** Commercial launch
- Open source client repo
- Hosted orchestration service
- Billing integration

---

### Why This Works

| Concern | How Addressed |
|---------|---------------|
| **IP Protection** | Orchestration logic never leaves your servers |
| **Shell access risk** | Client code is open source - nothing to steal |
| **Community trust** | Open source client, auditable |
| **Offline capability** | Local executor works, orchestration needs network |
| **Enterprise needs** | Cloud compute mode for full managed |
| **Revenue** | Per-token + subscription model |
| **Development speed** | Keep current monolith for now, split later |

---

## 15. SSL and Domain Management (Multi-Tenant)

### Problem
Each team/customer VM needs:
- Unique addressable endpoint
- Valid TLS certificate
- Potential for custom domains

### Domain Strategy Options

| Option | Pattern | Pros | Cons |
|--------|---------|------|------|
| **Subdomains** | `{team}.society.example.com` | Simple, one wildcard cert | Tied to your domain |
| **Custom domains** | `agents.customer.com` | Professional, white-label | DNS/cert complexity |
| **Hybrid** | Subdomain default, custom optional | Best of both | More infrastructure |

**Recommendation:** Start with subdomains (simpler), add custom domain support as enterprise feature.

### SSL Architecture Options

#### Option A: Edge Termination (Recommended for Start)

```
┌─────────────────────────────────────────────────────────────┐
│                    Load Balancer / Edge                      │
│            (ALB, Cloudflare, or Nginx + Wildcard)           │
│                                                              │
│  *.society.example.com → Single wildcard cert               │
│  Routes by Host header to correct backend                    │
└────────────────┬────────────────────────────────────────────┘
                 │ Internal (HTTP or mTLS)
        ┌────────┼────────┬────────┐
        ▼        ▼        ▼        ▼
   ┌────────┐ ┌────────┐ ┌────────┐
   │ Team A │ │ Team B │ │ Team C │
   │  VM    │ │  VM    │ │  VM    │
   └────────┘ └────────┘ └────────┘
```

**Pros:**
- Single cert to manage
- VMs don't need cert logic
- Easy to add/remove teams
- Works with any cloud LB

**Implementation:**
```yaml
# AWS ALB + ACM
- Request wildcard cert: *.society.example.com
- Create target group per team VM
- ALB listener rules route by Host header
- Internal traffic on private subnet (HTTP ok)

# Cloudflare (simpler)
- Wildcard cert automatic
- DNS entries: teamname.society.example.com → origin
- Cloudflare handles TLS termination
- Origin can be HTTP (encrypted tunnel)
```

#### Option B: Per-VM Certificates (Caddy/Traefik)

```
┌─────────────────────────────────────────────────────────────┐
│                    DNS / Routing                             │
│         team-a.society.example.com → VM-A IP                │
│         team-b.society.example.com → VM-B IP                │
└─────────────────────────────────────────────────────────────┘
        │               │               │
        ▼               ▼               ▼
   ┌────────┐      ┌────────┐      ┌────────┐
   │ Team A │      │ Team B │      │ Team C │
   │ Caddy  │      │ Caddy  │      │ Caddy  │
   │ (auto) │      │ (auto) │      │ (auto) │
   └────────┘      └────────┘      └────────┘
```

**Pros:**
- Each VM fully independent
- Works for custom domains
- No single point of failure

**Cons:**
- Each VM needs public IP or port
- Let's Encrypt rate limits
- More DNS entries to manage

**Implementation:**
```
# Caddy (auto-HTTPS)
# Caddyfile on each VM:
team-a.society.example.com {
    reverse_proxy localhost:3141
}

# Caddy automatically:
# - Gets Let's Encrypt cert
# - Renews before expiry
# - Redirects HTTP → HTTPS
```

#### Option C: Hybrid (Edge + Custom Domain Support)

```
┌─────────────────────────────────────────────────────────────┐
│                    Edge (Wildcard)                           │
│            *.society.example.com                            │
└────────────────┬────────────────────────────────────────────┘
                 │
        ┌────────┼────────┬────────┐
        ▼        ▼        ▼        ▼
   ┌────────┐ ┌────────┐ ┌────────────────────┐
   │ Team A │ │ Team B │ │ Enterprise Team C   │
   │(subdmn)│ │(subdmn)│ │                     │
   └────────┘ └────────┘ │  Custom domain:     │
                         │  agents.bigcorp.com │
                         │  (customer DNS +    │
                         │   their cert)       │
                         └────────────────────┘
```

### DNS Automation

```typescript
// Provisioning flow when team signs up
async function provisionTeamDomain(teamSlug: string): Promise<void> {
  // 1. Create DNS record
  await cloudflare.createDNSRecord({
    zone: 'society.example.com',
    type: 'A',  // or CNAME to LB
    name: teamSlug,
    content: loadBalancerIP,
    proxied: true,  // Cloudflare proxy = free SSL
  });
  
  // 2. Add routing rule (if using ALB)
  await alb.addListenerRule({
    priority: nextPriority(),
    conditions: [{ hostHeader: [`${teamSlug}.society.example.com`] }],
    actions: [{ targetGroup: teamTargetGroupArn }],
  });
  
  // 3. Store mapping
  await db.teams.update(teamId, { 
    domain: `${teamSlug}.society.example.com`,
    status: 'active',
  });
}
```

### Custom Domain Flow (Enterprise)

```
Customer wants: agents.bigcorp.com

1. Customer creates CNAME:
   agents.bigcorp.com → custom.society.example.com

2. Customer provides:
   - SSL cert + key (uploaded to your system)
   - OR: DNS challenge for Let's Encrypt

3. Your system:
   - Adds cert to load balancer
   - Creates routing rule for custom domain
   - Verifies CNAME before activating
```

### Certificate Storage

```typescript
interface TenantSSLConfig {
  teamId: string;
  
  // Default subdomain (always present)
  subdomain: string;  // 'acme' → acme.society.example.com
  
  // Custom domain (enterprise)
  customDomain?: string;
  customCertArn?: string;  // AWS ACM ARN or path to cert
  customCertExpiry?: Date;
  
  // Status
  sslStatus: 'pending' | 'active' | 'expiring' | 'expired';
}
```

### Security Considerations

| Concern | Mitigation |
|---------|------------|
| **Subdomain takeover** | Delete DNS when team deleted, verify ownership |
| **Cert expiry** | Automated renewal, expiry alerts |
| **Private key storage** | AWS Secrets Manager, HashiCorp Vault |
| **Man-in-middle** | HSTS headers, certificate pinning for client |
| **Internal traffic** | mTLS between LB and VMs, or private subnet |

### HSTS and Security Headers

```typescript
// Add to all responses
const securityHeaders = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'",
};
```

### Cost Comparison

| Approach | Monthly Cost (100 teams) |
|----------|-------------------------|
| **Cloudflare Free** | $0 (subdomain, their proxy) |
| **AWS ALB + ACM** | ~$20 (LB) + $0 (ACM wildcard) |
| **Per-VM Let's Encrypt** | $0 (certs) + compute overhead |
| **Custom domains** | +$0.75/cert/month (ACM) or free (Let's Encrypt) |

### Recommendation for Phases

**Phase 1 (MVP):**
- Single wildcard cert on Cloudflare or ALB
- Subdomains only: `{team}.society.example.com`
- No custom domains
- ~$20/month base cost

**Phase 2 (Growth):**
- Add Let's Encrypt automation for custom domains
- CNAME verification flow
- Cert expiry monitoring

**Phase 3 (Enterprise):**
- Customer-provided certificates
- Dedicated IPs option
- SLA for cert management

### DNS Provider Options

| Provider | Pros | Cons |
|----------|------|------|
| **Cloudflare** | Free SSL, DDoS protection, API | Lock-in |
| **AWS Route 53** | Native ALB integration | $0.50/zone/month |
| **Google Cloud DNS** | Good if on GCP | $0.20/zone/month |
| **Self-hosted** | Full control | Operational burden |

**Recommendation:** Cloudflare for start (free tier sufficient), migrate to Route 53 if AWS-heavy.

---

## 16. Reverse Proxies, Load Balancers, and Sessions

### Challenge
Society Agent uses WebSockets for real-time agent communication. This creates complexity:
- WebSocket connections are long-lived (not stateless)
- Traditional round-robin load balancing breaks WebSocket state
- Sessions must be maintained across connection drops
- Multiple clients may connect to same team's agents

### Architecture Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                        Internet                                  │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                    CDN / DDoS Protection                        │
│                    (Cloudflare, AWS Shield)                     │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                    Load Balancer (L7)                           │
│              (ALB, Nginx, HAProxy, Traefik)                     │
│                                                                  │
│  - SSL termination                                               │
│  - Host-based routing                                            │
│  - WebSocket upgrade handling                                    │
│  - Sticky sessions (for WebSocket)                               │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                    Reverse Proxy (per-VM)                       │
│                    (Nginx, Caddy, Traefik)                      │
│                                                                  │
│  - Local SSL (if not terminated at LB)                          │
│  - Request buffering                                             │
│  - Rate limiting                                                 │
│  - Health checks                                                 │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                    Society Agent Server                         │
│                    (Node.js + Socket.io)                        │
└─────────────────────────────────────────────────────────────────┘
```

### Load Balancer Configuration

#### Option A: AWS ALB (Application Load Balancer)

```yaml
# Terraform/CloudFormation concept
Resources:
  SocietyALB:
    Type: AWS::ElasticLoadBalancingV2::LoadBalancer
    Properties:
      Type: application
      Scheme: internet-facing
      
  HTTPSListener:
    Type: AWS::ElasticLoadBalancingV2::Listener
    Properties:
      Port: 443
      Protocol: HTTPS
      Certificates:
        - CertificateArn: !Ref WildcardCert
      DefaultActions:
        - Type: fixed-response
          FixedResponseConfig:
            StatusCode: 404
            
  # Per-team routing rule
  TeamARule:
    Type: AWS::ElasticLoadBalancingV2::ListenerRule
    Properties:
      Conditions:
        - Field: host-header
          Values: ["team-a.society.example.com"]
      Actions:
        - Type: forward
          TargetGroupArn: !Ref TeamATargetGroup
          
  TeamATargetGroup:
    Type: AWS::ElasticLoadBalancingV2::TargetGroup
    Properties:
      Protocol: HTTP
      Port: 3141
      TargetType: instance
      # CRITICAL for WebSocket
      TargetGroupAttributes:
        - Key: stickiness.enabled
          Value: "true"
        - Key: stickiness.type
          Value: lb_cookie
        - Key: stickiness.lb_cookie.duration_seconds
          Value: "86400"  # 24 hours
      HealthCheckPath: /health
      HealthCheckIntervalSeconds: 30
```

**Key Settings:**
- `stickiness.enabled: true` - Required for WebSocket
- Cookie-based affinity ensures same client → same backend
- Health check on `/health` endpoint

#### Option B: Nginx Load Balancer

```nginx
# /etc/nginx/nginx.conf

upstream society_team_a {
    # IP hash for sticky sessions (alternative to cookies)
    ip_hash;
    
    server 10.0.1.10:3141 weight=1;
    server 10.0.1.11:3141 weight=1 backup;  # Failover
    
    keepalive 32;  # Connection pooling
}

upstream society_team_b {
    ip_hash;
    server 10.0.2.10:3141;
    keepalive 32;
}

# Map for dynamic upstream selection
map $host $backend {
    team-a.society.example.com  society_team_a;
    team-b.society.example.com  society_team_b;
    default                     return_404;
}

server {
    listen 443 ssl http2;
    server_name *.society.example.com;
    
    ssl_certificate     /etc/ssl/wildcard.crt;
    ssl_certificate_key /etc/ssl/wildcard.key;
    
    # WebSocket support
    location /socket.io/ {
        proxy_pass http://$backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket timeouts (long-lived)
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
    
    # Regular HTTP
    location / {
        proxy_pass http://$backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

#### Option C: HAProxy

```haproxy
# /etc/haproxy/haproxy.cfg

global
    maxconn 50000
    
defaults
    mode http
    timeout connect 10s
    timeout client 86400s   # Long for WebSocket
    timeout server 86400s
    
frontend https_in
    bind *:443 ssl crt /etc/ssl/wildcard.pem
    
    # Route by hostname
    acl host_team_a hdr(host) -i team-a.society.example.com
    acl host_team_b hdr(host) -i team-b.society.example.com
    
    use_backend team_a if host_team_a
    use_backend team_b if host_team_b
    
backend team_a
    balance source          # IP-based sticky sessions
    cookie SERVERID insert indirect nocache
    
    server vm1 10.0.1.10:3141 check cookie s1
    server vm2 10.0.1.11:3141 check cookie s2 backup
    
backend team_b
    balance source
    server vm1 10.0.2.10:3141 check
```

#### Option D: Traefik (Container-Native)

```yaml
# docker-compose.yml with Traefik
version: '3.8'

services:
  traefik:
    image: traefik:v2.10
    command:
      - "--providers.docker=true"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.letsencrypt.acme.tlschallenge=true"
    ports:
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      
  society-team-a:
    image: society-agent:latest
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.team-a.rule=Host(`team-a.society.example.com`)"
      - "traefik.http.routers.team-a.tls=true"
      - "traefik.http.routers.team-a.tls.certresolver=letsencrypt"
      # Sticky sessions
      - "traefik.http.services.team-a.loadbalancer.sticky.cookie=true"
      - "traefik.http.services.team-a.loadbalancer.sticky.cookie.name=team_a_session"
```

### Session Management Strategies

#### Strategy 1: Sticky Sessions (Simplest)

```
Client A ──────────────────────────────────────► VM-1 (always)
Client B ──────────────────────────────────────► VM-2 (always)

Pros: Simple, no shared state needed
Cons: Uneven load, failover loses session
```

**Implementation:**
```typescript
// No code changes needed - LB handles affinity
// Just ensure health endpoint exists
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', uptime: process.uptime() });
});
```

#### Strategy 2: Shared Session Store (Redis)

```
Client A ───► LB ───► VM-1 ───┐
Client B ───► LB ───► VM-2 ───┼───► Redis (shared state)
Client C ───► LB ───► VM-1 ───┘

Pros: True load balancing, seamless failover
Cons: Redis dependency, latency overhead
```

**Implementation:**
```typescript
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

const pubClient = createClient({ url: process.env.REDIS_URL });
const subClient = pubClient.duplicate();

await Promise.all([pubClient.connect(), subClient.connect()]);

// Socket.io with Redis adapter
io.adapter(createAdapter(pubClient, subClient));

// Now WebSocket events are broadcast across all instances
// Client can connect to any instance and receive updates
```

**Session Data in Redis:**
```typescript
interface DistributedSession {
  sessionId: string;
  teamId: string;
  userId: string;
  
  // Which agents this session is watching
  subscribedAgents: string[];
  
  // Conversation context
  conversationId: string;
  
  // Last activity (for cleanup)
  lastPing: number;
}

// Store session
await redis.hset(`session:${sessionId}`, session);
await redis.expire(`session:${sessionId}`, 86400);  // 24h TTL
```

#### Strategy 3: Socket.io Rooms (Logical Grouping)

```typescript
// Client joins room for their team/project
socket.on('join-project', async (projectId: string) => {
  // Verify access
  if (!await canAccessProject(socket.userId, projectId)) {
    socket.emit('error', 'Access denied');
    return;
  }
  
  socket.join(`project:${projectId}`);
  
  // Notify others
  socket.to(`project:${projectId}`).emit('user-joined', {
    userId: socket.userId,
    timestamp: Date.now(),
  });
});

// Broadcast agent updates to all clients in project
function broadcastAgentUpdate(projectId: string, agentId: string, update: any) {
  io.to(`project:${projectId}`).emit('agent-update', {
    agentId,
    ...update,
  });
}
```

### WebSocket-Specific Considerations

#### Connection Lifecycle

```
1. Client connects via HTTPS
2. Socket.io negotiates upgrade to WebSocket
3. LB maintains sticky session cookie
4. Long-lived connection (hours/days)
5. Heartbeat keeps connection alive
6. Reconnection on disconnect (client-side)
```

**Socket.io Server Config:**
```typescript
const io = new Server(server, {
  // Upgrade settings
  transports: ['websocket', 'polling'],  // Prefer WebSocket
  
  // Heartbeat
  pingTimeout: 60000,    // 60s before considering disconnected
  pingInterval: 25000,   // Ping every 25s
  
  // Connection
  connectTimeout: 45000,
  
  // CORS (if needed)
  cors: {
    origin: ['https://*.society.example.com'],
    credentials: true,
  },
});
```

**Client Reconnection:**
```typescript
const socket = io('https://team-a.society.example.com', {
  // Auto-reconnect
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  
  // Resume session
  auth: {
    sessionId: localStorage.getItem('sessionId'),
    token: getAuthToken(),
  },
});

socket.on('connect', () => {
  console.log('Connected, rejoining rooms...');
  socket.emit('rejoin-session');
});
```

#### Handling LB Health Checks

```typescript
// Health check that doesn't interfere with WebSocket
app.get('/health', (req, res) => {
  const health = {
    status: 'healthy',
    uptime: process.uptime(),
    websockets: io.engine.clientsCount,
    memory: process.memoryUsage(),
    timestamp: Date.now(),
  };
  res.json(health);
});

// Readiness check (for k8s)
app.get('/ready', (req, res) => {
  // Check dependencies
  const ready = redisConnected && databaseConnected;
  res.status(ready ? 200 : 503).json({ ready });
});
```

### Multi-Instance Architecture

#### Single Team, Multiple Users

```
                    ┌─────────────────────┐
                    │   Load Balancer     │
                    │   (sticky sessions) │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
        ┌──────────┐    ┌──────────┐    ┌──────────┐
        │  User A  │    │  User B  │    │  User C  │
        │ (Dev 1)  │    │ (Dev 2)  │    │ (PM)     │
        └────┬─────┘    └────┬─────┘    └────┬─────┘
             │               │               │
             └───────────────┼───────────────┘
                             │
                    ┌────────▼────────┐
                    │   Team A VM     │
                    │                 │
                    │  ┌───────────┐  │
                    │  │ Socket.io │  │
                    │  │  Server   │  │
                    │  └─────┬─────┘  │
                    │        │        │
                    │  ┌─────▼─────┐  │
                    │  │  Agents   │  │
                    │  │ (shared)  │  │
                    │  └───────────┘  │
                    └─────────────────┘

All users see same agents, same state
Updates broadcast to all connected users
```

**Broadcast Pattern:**
```typescript
// When agent produces output
function onAgentOutput(projectId: string, agentId: string, output: string) {
  // Broadcast to all users watching this project
  io.to(`project:${projectId}`).emit('agent-output', {
    agentId,
    output,
    timestamp: Date.now(),
  });
}
```

#### High Availability (Single Team)

```
                    ┌─────────────────────┐
                    │   Load Balancer     │
                    └──────────┬──────────┘
                               │
              ┌────────────────┴────────────────┐
              ▼                                 ▼
        ┌──────────┐                     ┌──────────┐
        │  VM-1    │◄────── Redis ──────►│  VM-2    │
        │ (active) │      (pub/sub)      │ (active) │
        └──────────┘                     └──────────┘
              │                                 │
              └──────────┬──────────────────────┘
                         │
                    ┌────▼────┐
                    │ Shared  │
                    │ Storage │
                    │ (EFS)   │
                    └─────────┘
```

**With Redis Adapter:**
```typescript
// VM-1 receives message from User A
socket.on('chat-message', (msg) => {
  // Process locally
  processMessage(msg);
  
  // Redis adapter automatically broadcasts to VM-2
  // User B on VM-2 sees the message
  io.to(`project:${projectId}`).emit('chat-message', msg);
});
```

### Graceful Shutdown

```typescript
// Handle SIGTERM from load balancer
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, draining connections...');
  
  // 1. Stop accepting new connections
  server.close();
  
  // 2. Tell LB we're unhealthy
  isHealthy = false;
  
  // 3. Notify connected clients
  io.emit('server-shutdown', { 
    reconnectIn: 5000,
    message: 'Server restarting, please wait...' 
  });
  
  // 4. Wait for clients to reconnect elsewhere
  await sleep(10000);
  
  // 5. Force close remaining
  io.close();
  
  // 6. Cleanup
  await redis.quit();
  process.exit(0);
});
```

### Summary Table

| Component | Recommended | Alternative |
|-----------|-------------|-------------|
| **Edge/CDN** | Cloudflare | AWS CloudFront |
| **Load Balancer** | AWS ALB | Nginx, HAProxy, Traefik |
| **Session Affinity** | LB cookies | IP hash, Redis |
| **Shared State** | Redis (Socket.io adapter) | None (sticky only) |
| **Reverse Proxy** | Caddy (simple) | Nginx (performance) |
| **Health Checks** | `/health` + `/ready` | Custom probe |

### Decision Matrix

| Scenario | Recommended Setup |
|----------|-------------------|
| **Single user, single VM** | No LB needed, Caddy for SSL |
| **Multi-user, single VM** | Caddy, no sticky needed |
| **Multi-user, HA** | ALB + sticky + Redis adapter |
| **Enterprise, multi-region** | CloudFront + ALB + Redis Cluster |

---

## 17. Command Filtering and Prompt Injection Defense

### Problem
Even with client/server split, the client executor runs shell commands. A prompt like:
- "Kill the process on port 3141"
- "Stop the nginx service"
- "Delete all files in /var/log"
- "Add this SSH key to authorized_keys"

...could come from:
1. **Direct user input** (intentional or social-engineered)
2. **Prompt injection** via file content, web scrape, or API response
3. **Agent reasoning** misinterpreting goals as requiring destructive actions
4. **Malicious orchestration** (if server compromised)

### Defense Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                     Layer 1: Orchestration Server               │
│                                                                  │
│  - Intent classification (is this a dangerous request?)         │
│  - Policy enforcement (user can't request infra commands)       │
│  - Audit logging (all commands logged before execution)         │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Layer 2: Client Executor                    │
│                                                                  │
│  - Command allowlist/blocklist                                   │
│  - Pattern matching for dangerous commands                       │
│  - Confirmation prompts for sensitive operations                 │
│  - Sandboxed execution environment                               │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Layer 3: OS/Container                       │
│                                                                  │
│  - seccomp profiles                                              │
│  - Capability dropping                                           │
│  - Read-only root filesystem                                     │
│  - Network namespace isolation                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Dangerous Command Patterns

#### Infrastructure Commands (ALWAYS BLOCK)

```typescript
const INFRASTRUCTURE_BLOCKLIST = [
  // Process management
  /\bkill\s+(-\d+\s+)?(\$\(|`|<|>|\d+)/i,      // kill PID, kill $(pgrep...)
  /\bpkill\b/i,
  /\bkillall\b/i,
  /\bxkill\b/i,
  
  // Service management
  /\bsystemctl\s+(stop|restart|disable|mask)/i,
  /\bservice\s+\w+\s+(stop|restart)/i,
  /\b(nginx|apache|mysql|postgres|redis|docker)\s+(stop|restart)/i,
  /\binit\s+[0-6]/i,                            // Runlevel changes
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bpoweroff\b/i,
  
  // Network interference
  /\biptables\b/i,
  /\bufw\b/i,
  /\bfirewall-cmd\b/i,
  /\bnetstat.*kill/i,
  /\blsof.*kill/i,
  /\bfuser\s+-k/i,                              // Kill by port
  
  // Port manipulation
  /\bkill.*port\s*\d+/i,
  /\bfuser\s+\d+\/tcp/i,
  /\blsof\s+-i\s*:\d+.*\|\s*.*kill/i,
  
  // Cron/scheduled tasks
  /\bcrontab\s+-[re]/i,                         // Edit/remove cron
  /\bat\b.*\brm\b/i,
  
  // User/permission manipulation
  /\buseradd\b/i,
  /\buserdel\b/i,
  /\bpasswd\b/i,
  /\bchown\s+-R\s+.*\//i,                       // Recursive chown on root paths
  /\bchmod\s+(777|666|.*-R.*\/)/i,
  
  // SSH manipulation
  /authorized_keys/i,
  /\.ssh\//i,
  /\bssh-keygen\b/i,
  
  // Disk/mount operations
  /\bmount\b/i,
  /\bumount\b/i,
  /\bmkfs\b/i,
  /\bfdisk\b/i,
  /\bdd\s+if=/i,
];
```

#### Destructive File Operations (REQUIRE CONFIRMATION)

```typescript
const DESTRUCTIVE_PATTERNS = [
  // Recursive deletion
  /\brm\s+(-[rf]+\s+)*\//i,                     // rm -rf /anything
  /\brm\s+-[rf]*\s+\.\./i,                      // rm -rf ../
  /\brm\s+-[rf]*\s+\*/i,                        // rm -rf *
  
  // System directories
  /\/(etc|var|usr|bin|sbin|lib|boot|root)\b/i,
  /\/proc\b/i,
  /\/sys\b/i,
  /\/dev\b/i,
  
  // Config files
  /\.(bashrc|profile|bash_profile|zshrc)/i,
  /\/etc\/(passwd|shadow|sudoers|hosts)/i,
  
  // Environment manipulation
  /\bexport\s+(PATH|LD_LIBRARY_PATH|HOME)=/i,
  /\bunset\s+(PATH|HOME)/i,
  
  // History manipulation (hiding tracks)
  /\bhistory\s+-c/i,
  /\bunset\s+HISTFILE/i,
  /\bexport\s+HISTSIZE=0/i,
];
```

#### Network Exfiltration (AUDIT + RATE LIMIT)

```typescript
const EXFILTRATION_PATTERNS = [
  // Data upload
  /\bcurl\s+.*(-d|--data|-F|--form|--upload)/i,
  /\bwget\s+.*--post/i,
  /\bnc\s+(-e|exec)/i,                          // Netcat reverse shell
  /\bscp\s+.*@/i,
  /\brsync\s+.*@/i,
  
  // Base64 encoding (often used to hide payloads)
  /\bbase64\b.*\|.*(curl|wget|nc)/i,
  
  // DNS exfiltration
  /\bdig\s+.*\$\(/i,
  /\bnslookup\s+.*\$\(/i,
];
```

### Client-Side Command Filter

```typescript
interface CommandValidation {
  allowed: boolean;
  reason?: string;
  requiresConfirmation?: boolean;
  category?: 'infrastructure' | 'destructive' | 'exfiltration' | 'safe';
}

class CommandFilter {
  private blocklist: RegExp[];
  private confirmList: RegExp[];
  private auditList: RegExp[];
  
  constructor(private config: FilterConfig) {
    this.blocklist = INFRASTRUCTURE_BLOCKLIST;
    this.confirmList = DESTRUCTIVE_PATTERNS;
    this.auditList = EXFILTRATION_PATTERNS;
  }
  
  validate(command: string): CommandValidation {
    // Normalize command (handle multi-line, escapes)
    const normalized = this.normalize(command);
    
    // Layer 1: Hard blocklist (infrastructure commands)
    for (const pattern of this.blocklist) {
      if (pattern.test(normalized)) {
        return {
          allowed: false,
          reason: `Blocked: matches infrastructure pattern ${pattern}`,
          category: 'infrastructure',
        };
      }
    }
    
    // Layer 2: Requires human confirmation
    for (const pattern of this.confirmList) {
      if (pattern.test(normalized)) {
        return {
          allowed: true,  // Allowed only with confirmation
          requiresConfirmation: true,
          reason: `Destructive operation detected`,
          category: 'destructive',
        };
      }
    }
    
    // Layer 3: Audit/rate limit but allow
    for (const pattern of this.auditList) {
      if (pattern.test(normalized)) {
        this.logAudit(command, 'exfiltration_pattern');
        return {
          allowed: true,
          category: 'exfiltration',
        };
      }
    }
    
    return { allowed: true, category: 'safe' };
  }
  
  private normalize(command: string): string {
    // Expand variables that might hide intent
    // Handle: $(cmd), `cmd`, $VAR, etc.
    // This is complex - may need shell parsing library
    return command
      .replace(/\\\n/g, ' ')           // Line continuations
      .replace(/\s+/g, ' ')            // Normalize whitespace
      .trim();
  }
  
  private logAudit(command: string, reason: string): void {
    console.log(`[AUDIT] Command flagged: ${reason}`, {
      command: command.slice(0, 200),
      timestamp: Date.now(),
    });
  }
}
```

### Confirmation Flow for Destructive Commands

```typescript
// When agent wants to run a destructive command
async function executeWithConfirmation(
  command: string,
  agentId: string,
  socket: Socket
): Promise<ExecutionResult> {
  const validation = commandFilter.validate(command);
  
  if (!validation.allowed) {
    return {
      success: false,
      error: `Command blocked: ${validation.reason}`,
      blocked: true,
    };
  }
  
  if (validation.requiresConfirmation) {
    // Pause agent, ask human
    const approved = await requestHumanApproval(socket, {
      type: 'dangerous_command',
      agentId,
      command,
      reason: validation.reason,
      category: validation.category,
    });
    
    if (!approved) {
      return {
        success: false,
        error: 'Command rejected by user',
        rejected: true,
      };
    }
  }
  
  // Execute the command
  return runCommand(command);
}

// UI prompt for dangerous commands
function requestHumanApproval(socket: Socket, request: ApprovalRequest): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve(false);  // Auto-reject after timeout
    }, 60000);  // 1 minute
    
    socket.emit('approval-required', {
      id: generateId(),
      ...request,
      message: `⚠️ Agent wants to run a potentially dangerous command:\n\n\`${request.command}\`\n\nCategory: ${request.category}\nReason: ${request.reason}`,
    });
    
    socket.once('approval-response', (response) => {
      clearTimeout(timeout);
      resolve(response.approved);
    });
  });
}
```

### Prompt Injection Detection

```typescript
interface InjectionDetection {
  isInjection: boolean;
  confidence: number;
  indicators: string[];
}

function detectPromptInjection(input: string): InjectionDetection {
  const indicators: string[] = [];
  
  // Pattern 1: Instruction override attempts
  const overridePatterns = [
    /ignore\s+(previous|above|all)\s+(instructions?|rules?)/i,
    /disregard\s+(your|the)\s+(instructions?|rules?)/i,
    /forget\s+(everything|what)\s+(you|I)\s+(told|said)/i,
    /new\s+instructions?:/i,
    /system\s*:\s*/i,
    /\[SYSTEM\]/i,
  ];
  
  for (const pattern of overridePatterns) {
    if (pattern.test(input)) {
      indicators.push(`Override attempt: ${pattern}`);
    }
  }
  
  // Pattern 2: Role hijacking
  const rolePatterns = [
    /you\s+are\s+(now|actually)\s+a/i,
    /pretend\s+(to\s+be|you're)/i,
    /act\s+as\s+(if|though)/i,
    /roleplay\s+as/i,
  ];
  
  for (const pattern of rolePatterns) {
    if (pattern.test(input)) {
      indicators.push(`Role hijack: ${pattern}`);
    }
  }
  
  // Pattern 3: Hidden instructions in file content
  const hiddenPatterns = [
    /<!--.*?(rm|kill|curl|wget).*?-->/is,   // HTML comments
    /\/\*.*?(rm|kill|curl|wget).*?\*\//is,  // C-style comments
    /#.*?(rm|kill|curl|wget)/i,              // Shell comments
  ];
  
  for (const pattern of hiddenPatterns) {
    if (pattern.test(input)) {
      indicators.push(`Hidden instruction: ${pattern}`);
    }
  }
  
  // Pattern 4: Unusual control characters
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(input)) {
    indicators.push('Control characters detected');
  }
  
  const confidence = Math.min(indicators.length * 0.3, 1.0);
  
  return {
    isInjection: confidence > 0.5,
    confidence,
    indicators,
  };
}
```

### Server-Side Policy Enforcement

```typescript
// On orchestration server - before sending command to client
interface PolicyCheck {
  allowed: boolean;
  reason?: string;
  transformedCommand?: string;
}

class OrchestrationPolicy {
  checkCommand(
    command: string,
    context: {
      userId: string;
      projectId: string;
      agentId: string;
      userRole: 'admin' | 'developer' | 'viewer';
    }
  ): PolicyCheck {
    // 1. Role-based restrictions
    if (context.userRole === 'viewer') {
      return { allowed: false, reason: 'Viewers cannot execute commands' };
    }
    
    // 2. Project-level restrictions
    const projectConfig = getProjectConfig(context.projectId);
    if (projectConfig.readOnly) {
      if (/\b(rm|mv|cp|mkdir|touch|echo\s*>)\b/.test(command)) {
        return { allowed: false, reason: 'Project is read-only' };
      }
    }
    
    // 3. Never allow certain operations regardless of role
    if (INFRASTRUCTURE_BLOCKLIST.some(p => p.test(command))) {
      // Log security event
      logSecurityEvent({
        type: 'infrastructure_command_blocked',
        userId: context.userId,
        command: command.slice(0, 500),
      });
      return { allowed: false, reason: 'Infrastructure commands not allowed' };
    }
    
    // 4. Add safety wrappers
    const safeCommand = this.addSafetyWrapper(command);
    
    return { allowed: true, transformedCommand: safeCommand };
  }
  
  private addSafetyWrapper(command: string): string {
    // Add timeout to prevent hanging
    // Add error capture
    // Could wrap in firejail/sandbox
    return `timeout 300 bash -c ${JSON.stringify(command)} 2>&1`;
  }
}
```

### Port-Specific Protection

Since you specifically mentioned "kill the process on port XXX":

```typescript
const PORT_PROTECTION_PATTERNS = [
  // Direct port killing
  /kill.*\$\(.*lsof.*-i\s*:\d+/i,
  /lsof\s+-i\s*:\d+.*\|\s*(awk|xargs).*kill/i,
  /fuser\s+-k\s+\d+\/tcp/i,
  /kill.*\$\(.*fuser.*\d+\/tcp/i,
  /netstat.*\|\s*.*kill/i,
  /ss\s+-.*\|\s*.*kill/i,
  
  // Service-specific ports (protect infrastructure)
  /port\s*(22|80|443|3141|4000|5432|3306|6379|27017)\b/i,
];

// List of protected ports (infrastructure)
const PROTECTED_PORTS = [
  22,    // SSH
  80,    // HTTP
  443,   // HTTPS
  3141,  // Society Agent
  4000,  // Society Agent (alt)
  5432,  // PostgreSQL
  3306,  // MySQL
  6379,  // Redis
  27017, // MongoDB
  8080,  // Common web server
  9000,  // PHP-FPM
  9090,  // Prometheus
];

function isPortManipulation(command: string): { isManipulation: boolean; ports: number[] } {
  const portMentions = command.match(/:\d+|port\s*\d+|\d+\/tcp/gi) || [];
  const ports = portMentions
    .map(m => parseInt(m.replace(/\D/g, ''), 10))
    .filter(p => p > 0 && p < 65536);
  
  const affectsProtectedPort = ports.some(p => PROTECTED_PORTS.includes(p));
  const hasKillIntent = /kill|stop|terminate|fuser\s+-k/i.test(command);
  
  return {
    isManipulation: affectsProtectedPort && hasKillIntent,
    ports,
  };
}
```

### Implementation Phases

| Phase | Actions |
|-------|---------|
| **Phase 1 (Now)** | Add `CommandFilter` class, log violations |
| **Phase 2** | Enable blocking for infrastructure commands |
| **Phase 3** | Add confirmation prompts for destructive operations |
| **Phase 4** | Prompt injection detection in orchestration |
| **Phase 5** | Full seccomp/container sandboxing |

### Client Config File

```json
{
  "security": {
    "commandFilter": {
      "enabled": true,
      "mode": "audit",  // "audit" | "warn" | "block"
      
      "blocklist": {
        "infrastructure": true,
        "customPatterns": [
          "docker\\s+rm",
          "kubectl\\s+delete"
        ]
      },
      
      "confirmList": {
        "destructive": true,
        "timeout": 60000
      },
      
      "allowlist": {
        "enabled": false,
        "commands": [
          "npm",
          "node",
          "git",
          "ls",
          "cat",
          "grep"
        ]
      },
      
      "protectedPorts": [22, 80, 443, 3141, 4000],
      "protectedPaths": ["/etc", "/var", "/usr"]
    }
  }
}
```

---

## 18. Local vs Remote Execution Architecture (JobSpec Model)

### Problem Statement

Even with a clean client/server split, two critical risks remain:

| Risk | Description |
|------|-------------|
| **Local harm** | Local execution can still harm the customer (destructive commands, credential theft, network pivoting) |
| **Execution ambiguity** | If the LLM decides where to execute, accidents happen |

Current approach is dangerous:
```
User prompt → LLM decides → Tool executes
                  ↑
            Uncontrolled decision point
```

### Core Principle

> **Prompts must never directly execute tools.**

Instead:
```
User prompt → Intent Classification → Policy Router → Signed JobSpec → Executor
                                           ↑
                                    Policy decision
                                    (not LLM decision)
```

- A **trusted router** converts intent into a constrained **JobSpec**
- **Executors** only run signed JobSpecs
- **Execution location** (LOCAL vs REMOTE) is a **policy decision**, not an LLM decision

### JobSpec: Signed Execution Contract

```typescript
interface JobSpec {
  // Identity
  job_id: string;           // Unique, used for deduplication
  tenant_id: string;        // Customer/team
  agent_id: string;         // Which agent requested this
  project_id: string;       // Scope context
  
  // Execution location (POLICY DECIDES THIS)
  execution_location: 'LOCAL' | 'REMOTE';
  
  // What's allowed
  allowed_tools: string[];  // ['read_file', 'write_file', 'run_command']
  command_allowlist: RegExp[] | string[];  // ['npm *', 'git *', 'node *']
  
  // Filesystem scope
  filesystem: {
    read_paths: string[];   // ['/workspace/project-a/**']
    write_paths: string[];  // ['/workspace/project-a/src/**']
    denied_paths: string[]; // ['/workspace/.env', '**/.git/**']
  };
  
  // Network scope (deny-by-default)
  network: {
    allowed_hosts: string[];     // ['registry.npmjs.org', 'api.github.com']
    allowed_ports: number[];     // [443, 80]
    deny_all_except_allowlist: true;
  };
  
  // Resource limits
  limits: {
    cpu_seconds: number;         // Max CPU time
    memory_mb: number;           // Max memory
    max_pids: number;            // Fork bomb protection
    timeout_seconds: number;     // Wall clock timeout
    max_output_bytes: number;    // Prevent log flooding
  };
  
  // Audit requirements
  audit: {
    log_all_commands: boolean;
    log_file_writes: boolean;
    log_network_requests: boolean;
    retention_days: number;
  };
  
  // Security
  signature: string;             // HMAC or RSA signature
  issued_at: number;             // Timestamp
  expires_at: number;            // Short-lived (e.g., 5 minutes)
  nonce: string;                 // Anti-replay
}
```

### Executor Validation

Executors **MUST** reject:

```typescript
class JobSpecValidator {
  validate(spec: JobSpec): ValidationResult {
    const errors: string[] = [];
    
    // 1. Signature verification
    if (!this.verifySignature(spec)) {
      errors.push('Invalid or missing signature');
    }
    
    // 2. Expiry check
    if (Date.now() > spec.expires_at) {
      errors.push('JobSpec expired');
    }
    
    // 3. Replay protection
    if (this.nonceUsed(spec.nonce)) {
      errors.push('Nonce already used (replay attack)');
    }
    
    // 4. Location match
    if (spec.execution_location !== this.executorLocation) {
      errors.push(`Wrong executor: expected ${spec.execution_location}, got ${this.executorLocation}`);
    }
    
    // 5. Scope validation
    if (this.exceedsAllowedScopes(spec)) {
      errors.push('JobSpec requests scopes beyond policy limits');
    }
    
    return {
      valid: errors.length === 0,
      errors,
    };
  }
  
  private verifySignature(spec: JobSpec): boolean {
    const payload = JSON.stringify({
      ...spec,
      signature: undefined,  // Exclude signature from payload
    });
    const expected = hmac(payload, this.sharedSecret);
    return timingSafeEqual(expected, spec.signature);
  }
}
```

### Routing Policy (Who Runs What)

#### Always LOCAL (sandboxed on customer machine)

| Task | Reason |
|------|--------|
| Access customer local files | Data stays with customer |
| SSH to customer infrastructure | Credentials never leave |
| Builds/tests/linting on workspace | Customer toolchain |
| Git operations on local repos | Authentication is local |

#### Always REMOTE (sandboxed on our infrastructure)

| Task | Reason |
|------|--------|
| Operations involving our services | Never expose internals |
| Heavy compute (customer opts in) | Offload to cloud |
| Managed credential access | Secrets stay server-side |
| Cross-tenant operations | Isolation required |

#### User Choice

```typescript
interface ExecutionPreference {
  default: 'LOCAL';  // Safe default
  
  // User can opt into remote for specific tasks
  allow_remote_for: [
    'heavy_compute',      // "Run this build in cloud"
    'managed_credentials' // "Use team API keys"
  ];
  
  // Explicit disclosure when remote chosen
  remote_disclosure: {
    required: true,
    message: 'Files will be uploaded to secure cloud environment',
    files_to_upload: string[],
  };
}
```

### Local Protection Baseline

Even LOCAL execution must be hardened:

```yaml
# Local Executor Security Profile
local_executor:
  # No raw host shell
  sandboxed: true
  sandbox_type: firejail | bubblewrap | docker
  
  # Network restrictions
  network:
    mode: deny_by_default
    allowlist:
      - registry.npmjs.org:443
      - api.github.com:443
      # Customer can extend
  
  # Filesystem restrictions  
  filesystem:
    workspace: read_write
    home: read_only
    system: denied
    temp: read_write (isolated)
  
  # Privilege restrictions
  user: non_root
  capabilities: none
  seccomp: strict_mode
  no_new_privileges: true
  
  # Resource limits
  limits:
    cpu: 10s
    memory: 512MB
    pids: 50
    timeout: 300s
  
  # Human confirmation for destructive ops
  require_confirmation:
    - rm -rf
    - write to non-workspace paths
    - network to non-allowlisted hosts
```

### Remote Protection Baseline

Remote execution must be isolated from our core:

```yaml
# Remote Executor Security Profile
remote_executor:
  # Core/orchestrator NEVER runs customer code
  separation:
    orchestrator: management_only
    executors: disposable_sandboxes
  
  # Isolation technology
  sandbox_type: microvm  # Firecracker, gVisor
  
  # Each job gets fresh environment
  lifecycle:
    per_job: fresh_vm
    no_persistence: true
    auto_destroy: after_completion
  
  # Network segmentation
  network:
    no_access_to:
      - internal_services
      - other_tenant_vms
      - orchestrator_network
    egress: customer_defined_allowlist
  
  # Data handling
  data:
    input: encrypted_at_rest
    output: encrypted_in_transit
    workspace: ephemeral
    cleanup: secure_delete
```

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           USER / AGENT                                   │
│                                                                          │
│  "Build the project and run tests"                                       │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │ Intent (not command)
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        INTENT CLASSIFIER                                 │
│                                                                          │
│  Extracts: task_type, required_tools, data_dependencies                 │
│  Output: StructuredIntent                                                │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         POLICY ROUTER                                    │
│                                                                          │
│  Input: StructuredIntent + TenantPolicy + SecurityRules                 │
│                                                                          │
│  Decisions:                                                              │
│    - execution_location: LOCAL (files needed, no upload wanted)         │
│    - allowed_tools: [run_command, read_file, write_file]                │
│    - command_allowlist: [npm, node, jest]                               │
│    - filesystem_scope: /workspace/project/**                            │
│    - network_scope: [npmjs.org]                                         │
│                                                                          │
│  Output: Signed JobSpec                                                  │
└─────────────────┬──────────────────────────────────────┬────────────────┘
                  │                                      │
                  │ LOCAL JobSpec                        │ REMOTE JobSpec
                  ▼                                      ▼
┌─────────────────────────────┐        ┌─────────────────────────────────┐
│      LOCAL EXECUTOR         │        │        REMOTE EXECUTOR          │
│    (Customer Machine)       │        │       (Our Infrastructure)      │
│                             │        │                                  │
│  1. Validate signature      │        │  1. Validate signature           │
│  2. Check expiry            │        │  2. Check expiry                 │
│  3. Verify nonce            │        │  3. Verify nonce                 │
│  4. Apply sandbox           │        │  4. Spin up microVM              │
│  5. Execute within limits   │        │  5. Execute within limits        │
│  6. Log everything          │        │  6. Log everything               │
│  7. Return result           │        │  7. Return result, destroy VM    │
└─────────────────────────────┘        └─────────────────────────────────┘
```

### JobSpec Signing Flow

```typescript
// On Orchestration Server (trusted)
class JobSpecSigner {
  private secretKey: Buffer;
  
  sign(spec: Omit<JobSpec, 'signature' | 'nonce' | 'issued_at' | 'expires_at'>): JobSpec {
    const fullSpec: JobSpec = {
      ...spec,
      issued_at: Date.now(),
      expires_at: Date.now() + (5 * 60 * 1000),  // 5 minutes
      nonce: crypto.randomBytes(16).toString('hex'),
      signature: '',  // Placeholder
    };
    
    // Sign everything except signature field
    const payload = JSON.stringify({ ...fullSpec, signature: undefined });
    fullSpec.signature = crypto
      .createHmac('sha256', this.secretKey)
      .update(payload)
      .digest('hex');
    
    return fullSpec;
  }
}

// On Executor (local or remote)
class JobSpecExecutor {
  private secretKey: Buffer;
  private usedNonces = new Set<string>();
  
  async execute(spec: JobSpec): Promise<ExecutionResult> {
    // Validate
    if (!this.verify(spec)) {
      throw new SecurityError('Invalid JobSpec');
    }
    
    // Mark nonce as used
    this.usedNonces.add(spec.nonce);
    
    // Apply sandbox based on spec
    const sandbox = this.createSandbox(spec);
    
    // Execute
    return sandbox.run(spec);
  }
  
  private verify(spec: JobSpec): boolean {
    // Check signature
    const payload = JSON.stringify({ ...spec, signature: undefined });
    const expected = crypto
      .createHmac('sha256', this.secretKey)
      .update(payload)
      .digest('hex');
    
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(spec.signature))) {
      return false;
    }
    
    // Check expiry
    if (Date.now() > spec.expires_at) {
      return false;
    }
    
    // Check replay
    if (this.usedNonces.has(spec.nonce)) {
      return false;
    }
    
    return true;
  }
}
```

### Why This Model Works

| Concern | How JobSpec Addresses It |
|---------|--------------------------|
| **"Kill port 3141"** | Command not in allowlist → JobSpec rejected |
| **LLM decides to run remotely** | LLM can't decide - policy router decides |
| **Replay attack** | Nonce + expiry prevent replay |
| **Forged JobSpec** | Signature verification fails |
| **Scope creep** | JobSpec has explicit boundaries |
| **Credential theft** | Network allowlist prevents exfiltration |
| **Fork bomb** | PID limits enforced |
| **Infinite loop** | Timeout enforced |

### Migration Path from Current System

| Phase | State |
|-------|-------|
| **Current** | Prompt → LLM → Direct tool execution |
| **Phase 1** | Add audit logging of all tool calls |
| **Phase 2** | Add soft enforcement (warn on violations) |
| **Phase 3** | Add JobSpec generation (unsigned) |
| **Phase 4** | Add signature requirement |
| **Phase 5** | Full enforcement (reject unsigned) |

### Key Insight

The fundamental shift is:

| Old Model | New Model |
|-----------|-----------|
| Prompt expresses **commands** | Prompt expresses **intent** |
| LLM decides execution | Policy decides execution |
| Tools trusted implicitly | Tools require signed authorization |
| Errors are runtime accidents | Errors are policy violations |

---

## 19. Definitive Architecture Split (Summary)

> **Core Principle:** Split by trust + data ownership. Make shell/tool execution incapable of harming either side.

### The Two Servers

#### Your Shared Server Cluster (Multi-Tenant "Platform")

**Holds only what must be centralized:**

| Component | Purpose |
|-----------|---------|
| Account/tenant management | User auth, team membership |
| Billing | Usage tracking, subscription management |
| Agent orchestration | Coordination, not execution |
| Policy engine | Security rules, limits |
| Job router | Intent → signed JobSpec |
| Model gateway (optional) | If offering managed LLMs |
| Audit/event pipeline | Tenant-partitioned logs |
| Agent/job registry | Tenant-scoped metadata |

**Must NOT:**
- ❌ Hold customer repos/files by default
- ❌ Execute arbitrary shell **ever**
- ❌ Store customer LLM API keys
- ❌ Have access to customer infrastructure

#### Customer Local Server (Single-Tenant "Workspace")

**Holds customer-owned things:**

| Component | Purpose |
|-----------|---------|
| Project files/folders | Their code, their data |
| Agent state/memory | Persistent context for their agents |
| Local executor | Sandboxed tool/shell/SSH execution |
| LLM API keys | Their keys, their billing |
| SSH credentials | Access to their infrastructure |

**Benefits:**
- ✅ Files stay local (privacy, compliance)
- ✅ SSH originates from their network (no exposure)
- ✅ LLM usage billed to them, not you
- ✅ They control their security posture

### Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        YOUR PLATFORM (Multi-Tenant)                          │
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   Auth &     │  │   Policy     │  │    Job       │  │   Audit      │    │
│  │   Billing    │  │   Engine     │  │   Router     │  │   Pipeline   │    │
│  └──────────────┘  └──────────────┘  └──────┬───────┘  └──────────────┘    │
│                                              │                               │
│                                              │ Signed JobSpecs               │
│                                              │ (never raw commands)          │
└──────────────────────────────────────────────┼──────────────────────────────┘
                                               │
                    ┌──────────────────────────┼──────────────────────────┐
                    │                          │                          │
                    ▼                          ▼                          ▼
┌─────────────────────────────┐  ┌─────────────────────────────┐  ┌─────────────────────────────┐
│   CUSTOMER A (Local)        │  │   CUSTOMER B (Local)        │  │   CUSTOMER C (Local)        │
│                             │  │                             │  │                             │
│  ┌─────────────────────┐   │  │  ┌─────────────────────┐   │  │  ┌─────────────────────┐   │
│  │  Files & Projects   │   │  │  │  Files & Projects   │   │  │  │  Files & Projects   │   │
│  └─────────────────────┘   │  │  └─────────────────────┘   │  │  └─────────────────────┘   │
│                             │  │                             │  │                             │
│  ┌─────────────────────┐   │  │  ┌─────────────────────┐   │  │  ┌─────────────────────┐   │
│  │  Sandboxed Executor │   │  │  │  Sandboxed Executor │   │  │  │  Sandboxed Executor │   │
│  │  (runs JobSpecs)    │   │  │  │  (runs JobSpecs)    │   │  │  │  (runs JobSpecs)    │   │
│  └─────────────────────┘   │  │  └─────────────────────┘   │  │  └─────────────────────┘   │
│                             │  │                             │  │                             │
│  ┌─────────────────────┐   │  │  ┌─────────────────────┐   │  │  ┌─────────────────────┐   │
│  │  Their LLM Keys     │   │  │  │  Their LLM Keys     │   │  │  │  Their LLM Keys     │   │
│  │  Their SSH Keys     │   │  │  │  Their SSH Keys     │   │  │  │  Their SSH Keys     │   │
│  └─────────────────────┘   │  │  └─────────────────────┘   │  │  └─────────────────────┘   │
└─────────────────────────────┘  └─────────────────────────────┘  └─────────────────────────────┘
```

### The Four Rules

#### Rule 1: Your Shared Cluster Does NOT Run Customer Shell

```
❌ NEVER: platform.execute("rm -rf /workspace/*")
❌ NEVER: platform.execute(userInput)
❌ NEVER: "helpful admin commands" via shell

✅ INSTEAD: Expose explicit admin APIs
   - cancel_job(job_id)
   - rotate_token(tenant_id)
   - get_usage(tenant_id)
   - No general shell, ever.
```

#### Rule 2: Shell Runs ONLY Inside Disposable Sandboxes

On customer local server (and optional cloud compute mode):

```yaml
sandbox_requirements:
  # Isolation technology
  type: microvm | hardened_container  # microVM preferred
  
  # Identity
  user: non_root
  privilege_escalation: disabled
  capabilities: none  # Drop all
  
  # Filesystem
  root_fs: read_only
  workspace: read_write  # Only writable mount
  temp: isolated_tmpfs
  
  # Resources
  limits:
    cpu_seconds: 60
    memory_mb: 512
    max_pids: 50
    timeout: 300
    max_output: 10MB
  
  # Network
  network:
    default: deny_all
    allowlist:
      - registry.npmjs.org:443
      - api.github.com:443
      # Customer extends as needed
```

#### Rule 3: No Raw "Shell Tool" for the LLM

Instead of giving the model "run any command":

```typescript
// ❌ BAD: Raw shell access
tools: [{
  name: "run_command",
  execute: (cmd) => exec(cmd)  // Dangerous!
}]

// ✅ GOOD: Constrained command runner
tools: [{
  name: "run_command",
  execute: (cmd) => {
    // 1. Allowlisted commands only
    if (!isAllowedCommand(cmd)) {
      throw new Error("Command not in allowlist");
    }
    
    // 2. Path validation
    if (!pathWithinWorkspace(extractPaths(cmd))) {
      throw new Error("Path outside workspace");
    }
    
    // 3. Block dangerous patterns
    if (isDangerousPattern(cmd)) {
      throw new Error("Blocked: infrastructure command");
    }
    
    // 4. Resource limits
    return execWithLimits(cmd, {
      timeout: 60000,
      maxOutput: 1024 * 1024,
    });
  }
}]
```

**Constrained command runner enforces:**

| Check | Implementation |
|-------|----------------|
| Allowlisted commands | `npm`, `node`, `git`, `ls`, `cat`, etc. |
| Path validation | `realpath` must stay under workspace |
| Block process management | `kill`, `systemctl`, `service` blocked |
| Block network scanning | `nmap`, `nc -l`, `tcpdump` blocked |
| Output size caps | Max 10MB output |
| Per-command timeouts | Max 60s per command |

#### Rule 4: Secrets and Identities

```typescript
// Customer LLM keys: LOCAL ONLY
// Never sent to platform, never stored in shared folders
interface CustomerSecrets {
  llm_api_key: string;      // Lives only on customer server
  ssh_keys: string[];       // Lives only on customer server
  db_credentials: string;   // Lives only on customer server
}

// Per-agent identity
interface AgentIdentity {
  agent_id: string;
  tenant_id: string;
  
  // Cryptographic identity
  public_key: string;
  
  // Messages must be signed
  sign(message: Message): SignedMessage;
  verify(signed: SignedMessage): boolean;
}

// Cross-agent delegation
interface DelegationToken {
  from_agent: string;
  to_agent: string;
  
  // What's delegated
  capabilities: string[];  // ['read_file:/workspace/src/**']
  
  // Short-lived
  expires_at: number;     // 5 minutes max
  single_use: boolean;    // Prevent reuse
}
```

### Optional: "Run in Cloud" Mode

For customers who want remote execution:

```typescript
interface CloudExecutionConfig {
  // Must be explicit opt-in
  opt_in: {
    required: true;
    confirmation: "I understand files will be uploaded";
  };
  
  // Selective file sync
  file_sync: {
    method: 'hash_diff';  // Only changed files
    exclude: ['.env', '.git', 'node_modules', '*.key'];
    max_size: '100MB';
  };
  
  // Execution environment
  execution: {
    sandbox: 'microvm';
    isolation: 'per_job';
    lifetime: 'ephemeral';  // Destroyed after job
  };
  
  // Network controls
  network: {
    egress: 'customer_allowlist_only';
    no_access_to: ['platform_internal', 'other_tenants'];
  };
}
```

### Minimal Implementation Checklist

**Priority 1: Critical Path (Do First)**

| Item | Status | Notes |
|------|--------|-------|
| Signed JobSpec generation | ⬜ | Policy router creates specs |
| Executor rejects unsigned jobs | ⬜ | No JobSpec = no execution |
| Local sandboxed tool runner | ⬜ | Firejail/bubblewrap for MVP |
| No raw host shell | ⬜ | All commands go through sandbox |

**Priority 2: Network Security**

| Item | Status | Notes |
|------|--------|-------|
| Deny-by-default egress | ⬜ | Sandbox network namespace |
| Network allowlists | ⬜ | Per-tenant configuration |
| Audit network requests | ⬜ | Log all outbound connections |

**Priority 3: Filesystem Security**

| Item | Status | Notes |
|------|--------|-------|
| Workspace-only write mounts | ⬜ | Sandbox mount options |
| Read-only root FS | ⬜ | Prevent system modification |
| Path validation in command runner | ⬜ | realpath checks |

**Priority 4: Identity & Authorization**

| Item | Status | Notes |
|------|--------|-------|
| Per-agent identity (keypair) | ⬜ | Sign all messages |
| Message broker ACLs | ⬜ | Verify sender identity |
| No agent spoofing | ⬜ | Cryptographic verification |
| Delegation tokens | ⬜ | Short-lived, scoped |

### Summary: Trust Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│                    TRUST BOUNDARY 1                          │
│                    (Your Platform)                           │
│                                                              │
│  - Orchestration only, no execution                          │
│  - No customer files, no customer secrets                    │
│  - Policy enforcement, not policy execution                  │
│  - Audit everything, store nothing sensitive                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Signed JobSpecs only
                              │ Never raw commands
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    TRUST BOUNDARY 2                          │
│                    (Customer Local)                          │
│                                                              │
│  - Execution happens here, in sandbox                        │
│  - Customer owns files, secrets, LLM keys                    │
│  - Sandbox limits blast radius                               │
│  - Even compromised agent can't escape sandbox               │
└─────────────────────────────────────────────────────────────┘
```

This architecture ensures:
- **Your platform can't harm customers** (no shell, no files)
- **Customers can't harm your platform** (no execution on your side)
- **Compromised agents can't escape** (sandbox limits everything)
- **LLM prompt injection fails** (policy decides, not LLM)

---

## Notes/Decisions Log

_Use this section to record decisions made during evaluation._

| Date | Decision | Rationale |
|------|----------|-----------|
| | | |
| | | |
| | | |
