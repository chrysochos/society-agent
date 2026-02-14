# Society Agent – Desired State (High-Level Architecture)

This document captures the **full desired state** of the Society Agent ecosystem, independent of MVP and current implementation constraints.

---

# 1. Vision

A globally distributed ecosystem of **Society Agents** capable of:

- collaborating,
- negotiating roles,
- routing tasks,
- managing resources,
- and evolving through upgrades,
  while maintaining predictable, policy‑driven behavior.

Society Agents form a **cooperative software society**, where each agent represents:

- a domain boundary,
- a capability bundle,
- and a policy‑enforced function.

---

# 2. Society Agent Identity

Each agent maintains a **dynamic, runtime-mutable identity** composed of:

- **Agent ID** (stable identifier, e.g., `agent-001`, `agent-042`)
- **Natural Language Instructions** (the agent's mission, described conversationally)
- **Dynamic Role** (can change at runtime: analyzer → coordinator → tester)
- **Dynamic Capabilities** (added/removed as needed during execution)
- **Team Relationships** (knows its teammates, coordinator, subordinates)
- **Constraints** (what the agent must not perform)

**Key Property: Runtime Mutability**

- Agents can **change roles** mid-execution ("You're now the coordinator")
- Agents can **gain/lose capabilities** ("You can now approve deletions")
- Agents can **join/leave teams** ("Join the security team", "You're independent now")
- Agents can **change supervisors** ("Report to Agent 5 instead")
- Agent **count is unlimited** (create 1, 10, 100, 1000 agents as needed)

Identity must be:

- **flexible** (changes with natural language instructions),
- **discoverable** (agents know about each other),
- **publishable** to the society (via registry).

---

# 3. Communication Model

Agents communicate via **natural language and structured channels**:

**Natural Language Communication:**

- **Agent-to-Agent**: Direct peer communication ("Agent 2, I found a bug in login.ts")
- **Agent-to-Coordinator**: Status updates, approval requests ("Agent 4, should I proceed?")
- **Human-to-Agent**: Instructions, refinements ("Agent 1, focus on security issues")
- **Agent-to-Human**: Results, questions, alerts ("Found 5 critical vulnerabilities")

**Structured Channels:**

- **Task** (requests)
- **Result** (completed outputs)
- **Control** (pause, resume, reconfigure, change role, reassign)
- **Capability** (publish and request capabilities)
- **Alert** (faults, risks, constraints violated)

**Supported Topologies:**

- 1 ↔ 1 (peer-to-peer)
- 1 ↔ many (broadcast, delegation)
- many ↔ many (team collaboration)
- Hierarchical (multi-level coordination)
- Flat (autonomous peer agents)

**Communication Transport:**

- WebSocket
- local IPC
- message bus
- shared storage (`.society-agent/*.jsonl`)
- supervisor‑mediated routing

---

# 4. Supervisor Ecosystem (Optional and Dynamic)

**Supervisors are optional agents created on-demand via natural language.**

**Key Principles:**

- **Flat by default**: Agents start autonomous (no supervisor)
- **Supervision on-demand**: Create supervisor when coordination needed
- **Dynamic grouping**: "Agent 4, you coordinate Agent 1, 2, 3"
- **Multiple independent supervisors**: Different teams, different coordinators
- **Dissolve groups**: Return agents to autonomous mode anytime

**Supervisor Capabilities:**

Supervisors coordinate Society Agents by:

- assigning roles dynamically,
- routing tasks to appropriate agents,
- resolving conflicts between agents,
- approving risky actions,
- providing human‑aligned oversight,
- aggregating results from team members.

Supervisors may:

- pause/resume agents,
- change agent roles mid-execution,
- inspect logs,
- adjust team membership,
- propagate high‑level goals,
- create sub-teams with sub-coordinators.

---

# 5. Society Protocol (PECP+)

Extended PECP structure guides all agent communication:

- **Purpose** – why
- **Intent** – what
- **Context** – with what information
- **Plan** – how
- **+Metadata** – identity, domain, role, capability map
- **+History** – previous injections

This forms a lingua franca among all agents.

---

# 6. Distributed Task Routing

Society Agents can:

- evaluate which agent is best suited for a task,
- request peer assistance,
- delegate subtasks,
- coordinate through a router/coordinator,
- negotiate capabilities.

Advanced modes (future):

- load balancing,
- redundancy,
- fault tolerance,
- capability auctions.

---

# 7. Learning and Memory

Agents maintain:

- injection history,
- domain memory,
- best practices,
- user preferences,
- architecture patterns.

Memory is:

- persistent,
- upgradable,
- transferable.

---

# 8. Evolution and Runtime Dynamics

The system must support **unlimited runtime flexibility**:

**Agent Lifecycle (Dynamic):**

- **Create agents** at any time ("Create 50 agents")
- **Destroy agents** when done ("Agent 5, you're finished")
- **Clone agents** for parallel work ("Create 3 more like Agent 1")
- **Merge agent results** ("Agent 10, combine results from Agent 1-9")

**Role Evolution (Mid-Execution):**

- **Change roles** at runtime ("Agent 2, you're now the coordinator")
- **Swap responsibilities** ("Agent 1 and 3, switch tasks")
- **Promote agents** ("Agent 5, take over as team lead")
- **Specialize agents** ("Agent 7, focus only on security now")

**Team Dynamics:**

- **Form teams** on-demand ("Agent 1-10, work together")
- **Dissolve teams** ("Return to autonomous mode")
- **Reorganize hierarchies** ("Agent 4 now reports to Agent 8")
- **Scale teams** ("Add 20 more agents to testing team")

**Capability Evolution:**

- **Grant capabilities** ("Agent 3, you can now approve deletions")
- **Revoke capabilities** ("Agent 2, no more file writes")
- **Transfer capabilities** ("Agent 5 gives test-execution to Agent 6")

**No Predefined Limits:**

- Agent count: **unlimited** (1 to 1000+)
- Role types: **unlimited** (any natural language description)
- Hierarchy depth: **unlimited** (flat, 2-level, 10-level)
- Team size: **unlimited** (scale as needed)

---

# 9. Success Criteria

A full Society Agent ecosystem should:

- **Enable natural language orchestration**: Create, configure, and coordinate agents conversationally
- **Support unlimited scale**: Handle 1 to 1000+ agents seamlessly
- **Allow runtime dynamics**: Change roles, teams, and capabilities mid-execution
- **Maintain autonomy by default**: Agents work independently unless supervision needed
- **Enable multi‑agent collaboration**: Agents communicate and coordinate without human intervention
- **Provide flexible coordination**: Optional supervisors, flat teams, hierarchies - all configurable
- **Adapt to changes**: Agents can change roles, join/leave teams, gain/lose capabilities
- **Follow human instructions**: Natural language instructions guide agent behavior
- **Maintain stability and safety**: Permission systems, approval workflows, audit trails
- **Produce high‑quality software**: Collaborative agent work delivers better results

**Ultimate Vision:**

"Describe your team in natural language, and the system creates it. Describe changes, and agents adapt in real-time. Scale from 1 agent to 1000 agents without architectural changes."

---

## 10. Natural Language Agent Configuration (NL-SAC)

**Core Innovation: Zero configuration files, pure conversation.**

**Agent Creation:**

```text
Human: "Create 5 agents"
System: "5 agents created (Agent 1-5)"
```

**Agent Instructions:**

```text
Human: "Agent 1: Analyze security in src/auth/. Work with Agent 2, 3, 4. Agent 4 coordinates.
        Agent 2: Create tests. Work with Agent 1, 3, 4. Agent 4 coordinates.
        Agent 3: Write docs. Work with Agent 1, 2, 4. Agent 4 coordinates.
        Agent 4: You coordinate Agent 1, 2, and 3."

System: "All agents configured. Ready to launch."
```

**Runtime Modifications:**

```text
Human: "Agent 1, focus only on critical issues"
Agent 1: "Understood. Filtering for critical severity only."
```

**Key Properties:**

- **No JSON**: All configuration via natural language
- **No predefined roles**: Roles are natural language descriptions
- **No hardcoded limits**: Agent count, team size, hierarchy depth all unlimited
- **Runtime mutable**: Everything can change during execution
- **Conversational**: Talk to agents like team members

---

This document describes the target state to guide MVP development and future architecture.
