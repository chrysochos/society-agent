# Multi-Agent Development Policy

## Purpose

This document defines how the multi-agent system must operate when building, changing, or maintaining a software project, especially large or already-running applications. The goal is to keep the system understandable, modular, safe to change, and resistant to accidental damage from uncontrolled AI edits.

This policy assumes that many projects already exist in imperfect form. It therefore supports both:

* new projects built with structure from the start
* existing projects that must be improved gradually without risky full rewrites

---

## Core Principles

### 1. Protect the running system

The system must prioritize stability over architectural purity. In existing projects, architecture is introduced progressively, not through uncontrolled rewrites.

### 2. Use bounded modules

The codebase should be understood as a set of business modules, each with a clear responsibility, a small public surface, and limited dependencies.

Examples of modules:

* auth
* customers
* orders
* billing
* notifications
* reporting
* admin

### 3. Optimize for discoverability, not only correctness

A maintainable project is not only one that works. It is one where the owner can understand:

* what each module does
* where common changes belong
* what is safe to edit
* what is dangerous to touch

### 4. Separate governance from implementation

The agent that preserves architecture and boundaries must not behave like an uncontrolled coder. Governance and implementation are separate roles.

### 5. Changes must be narrow and explicit

Every change must be classified, routed to a module, bounded to a limited file scope, and validated against contracts and critical flows.

### 6. Every change should leave the project safer

In existing codebases, each change should improve structure a little where practical: add a map entry, improve a README, isolate config, add a test, or mark a critical area.

---

## Recommended Agent Model

## Hierarchical Agent Structure

The multi-agent system is hierarchical.

Each permanent agent may:

* own one folder or module scope
* have permanent subagents for subfolders or submodules
* spawn ephemeral agents for approved tasks inside its own scope

This means governance is distributed by folder hierarchy.

Typical pattern:

* a higher permanent agent governs a parent folder or larger module boundary
* lower permanent agents govern subfolders or narrower submodules
* ephemeral agents execute bounded work under the authority of the relevant permanent agent

### Authority Rule

Authority flows downward through the hierarchy, while responsibility remains local to each scope owner.

This means:

* a parent permanent agent defines boundaries for its folder scope
* a child permanent agent defines boundaries for its subfolder scope
* an ephemeral agent never owns architecture; it only executes within the scope delegated by its supervising permanent agent

### Scope Rule

Each permanent agent with its ephemeral agents works only inside its assigned folder scope.
A lower permanent agent governs only its own subfolder scope.
A parent permanent agent must not bypass a child permanent agent for normal subfolder work, except for explicit governance, escalation, or emergency override situations defined by policy.

---

## Permanent Agent per Folder/Module

Each module or folder should have one permanent custodian agent for that scope.

This permanent agent is the local architect, governor, and memory keeper for its folder.

It owns:

* module or folder understanding
* boundaries for its scope
* public API knowledge for its scope
* critical file awareness
* technical debt awareness
* module documentation
* change review authority within its scope
* delegation to child permanent agents where applicable
* spawning and supervision of ephemeral agents for approved work in its scope

It must not act like a free-form implementation bot.

### Permanent Agent Responsibilities

The permanent agent must:

* understand what its scope is responsible for
* decide whether a user request belongs to its scope or should be routed lower, higher, or sideways in the hierarchy
* classify risk level
* define allowed and forbidden edit areas
* preserve scope boundaries
* preserve public contracts unless explicitly approved to change them
* identify critical flows and fragile areas
* maintain module documentation
* review implementation results
* teach the user where future changes should go
* delegate to lower permanent agents when the real ownership lies in a subfolder
* escalate upward when the request exceeds local authority or affects parent-level contracts

### Parent and Child Permanent Agents

When both parent and child permanent agents exist:

* the parent governs the broader folder boundary and cross-subfolder consistency
* the child governs the local subfolder implementation boundary
* the child is the default owner for changes fully inside the child scope
* the parent remains the approver for changes that affect parent-level contracts, shared boundaries, or multiple child scopes

The system must avoid duplicate ownership.
At any given level, one permanent agent must be the clear owner of the requested change.

---

## Ephemeral Development Agent per Task

For implementation work, the supervising permanent agent should spawn an ephemeral development agent.

This agent exists only for one task or one approved subtask.

It must:

* receive a structured change brief
* edit only within approved scope
* preserve the required contracts
* update tests and documentation as required
* return a structured implementation report
* terminate after task completion

### Ephemeral Agents in the Hierarchy

Ephemeral agents are always attached to a supervising permanent agent.
They do not exist as free-floating actors.

Each ephemeral agent:

* inherits scope only from its supervising permanent agent
* may work only in the folder scope delegated to it
* may not directly command sibling or parent scopes
* may not bypass lower permanent agents that own deeper subfolders
* must return results to the supervising permanent agent

### Why Ephemeral Developers Are Preferred

Ephemeral developers are preferred over second permanent same-folder developers because they:

* reduce long-term drift
* are easier to constrain
* are easier to audit
* avoid memory divergence
* reduce authority overlap
* behave more predictably from the current brief and current code state

### When to Execute Directly vs Spawn Ephemeral Agents

The permanent agent should decide whether to execute simple work directly or spawn an ephemeral agent based on task characteristics.

**Execute directly when:**

* the operation is simple and well-understood (build, restart, lint, format)
* within the agent's domain ownership
* no cross-cutting concerns or contract changes
* low risk and easily reversible
* no task list or multi-step planning required
* the work is operational rather than implementation

Examples of direct execution:

* `npm run build` after code changes
* restarting a service the agent owns
* running tests
* applying a config change
* fixing a typo

**Spawn an ephemeral agent when:**

* speed through parallelization is valuable
* multiple non-conflicting tasks can run simultaneously
* specialized expertise outside the permanent agent's core domain is needed
* complex multi-step implementation work is required
* fresh context or isolated reasoning would be beneficial
* the task requires focused implementation without distracting the permanent agent

**Key principle: ephemeral agents are primarily for speed and parallel non-conflicting work.**

The permanent agent should not escalate, delegate, or claim permission issues for simple operational tasks within its own scope. Direct execution keeps work efficient and avoids unnecessary overhead.

**Hard rule:** verification-only tasks (build/test/typecheck/lint/status checks) must be executed directly by the permanent agent and must not spawn an ephemeral agent.

### Operational Sequences Must Be Executed as a Unit

When an operational task involves a natural sequence of steps (such as build → restart → verify), the entire sequence should be executed directly by the permanent agent as one cohesive unit.

**Do not split simple operational sequences across ephemeral agents.**

Bad pattern:
* Agent runs `npm run build` directly
* Agent spawns worker to restart server
* Agent spawns another worker to verify

Good pattern:
* Agent runs `npm run build`
* Agent restarts server
* Agent verifies with curl
* Agent reports completion

The overhead of spawning an ephemeral agent (context transfer, task handoff, worker lifecycle) exceeds the cost of simply executing the next command in a routine sequence. One simple task means one execution context.

### Status Integrity and Completion Claims

Permanent agents must keep status messages consistent with actual verification results.

Required behavior:

* do not report "idle", "all tasks complete", or equivalent completion language while any required check is failing
* if a check fails, report blocked/failed status and include the failing command plus short error summary
* only announce completion after required checks pass in the same execution flow

### Idle Mode Behavior (No Pending Work)

When inbox and task pool are empty, the permanent agent should enter idle mode.

Required behavior in idle mode:

* do not initiate ad-hoc implementation verification or codebase-wide checks
* do not spawn workers for speculative checks
* run checks only when explicitly requested by supervisor/architect, required by startup policy, or required by scheduled health-check policy
* report "idle and waiting for new tasks" and stop further execution

---

## Strong Recommendation on Same-Folder Roles

Do not use two equal permanent agents on the same folder.

Default model:

* one permanent folder custodian/architect for each scope
* lower permanent custodians for owned subfolders where needed
* one ephemeral implementation agent per task under the relevant scope owner

Only use a second permanent same-folder agent if there is a truly distinct long-lived responsibility that requires durable separate memory, such as security compliance or QA governance. Even then, roles must be hierarchical and clearly separated.

---

## Routing and Delegation in the Hierarchy

When a request arrives, the system must route it to the correct permanent owner.

### Routing Rules

* if the request belongs fully to the current permanent agent's scope, that agent handles planning and may spawn an ephemeral developer
* if the request belongs fully to a child permanent agent's scope, the current agent delegates the request downward
* if the request affects multiple child scopes, the parent permanent agent coordinates and may split the work into child-owned subchanges
* if the request affects a parent-level contract or shared boundary, the parent permanent agent must remain involved in approval
* if the request exceeds local authority, it must be escalated upward

### Cross-Scope Rule

No agent should edit across sibling scopes in one uncontrolled action.
Cross-scope work must be coordinated explicitly by the nearest permanent parent with authority over the affected scopes.

---

## Workflow for a Change Request

### Phase 1: Request Intake

When a user asks for a change, the permanent agent must first classify the request.

It must determine:

* what kind of change it is
* which module owns it
* whether it is local or cross-module
* whether it is safe, medium risk, or critical
* whether it affects text, style, config, rules, workflow, contract, schema, or infrastructure

### Phase 2: Architectural Assessment

The permanent agent must assess:

* whether the target folder/module is well-structured, partially structured, legacy mixed, or fragile critical
* whether a safe edit point already exists
* what files must remain untouched
* what contracts must remain stable
* what docs must be updated
* what checks/tests must protect the change

### Phase 3: Change Brief Creation

The permanent agent must create a structured handoff for the ephemeral developer.

### Phase 4: Implementation

The ephemeral developer implements only what is authorized in the change brief.

### Phase 5: Reporting

The ephemeral developer returns a structured implementation report.

### Phase 6: Review

The permanent agent compares the implementation report and code changes against the change brief.

It must check:

* boundaries respected
* contracts preserved
* docs updated
* tests updated or preserved
* no forbidden areas touched
* no uncontrolled side effects introduced

### Phase 7: Acceptance and Memory Update

If accepted, the permanent agent updates persistent module knowledge and project navigation artifacts as needed.

---

## Required Communication Between Architect and Developer

Communication must be structured. It must not depend only on raw code diffs or informal reasoning.

The two agents must communicate through explicit artifacts.

## Required Artifacts

### 1. MODULE.md

Each module should maintain a static module context file.

It should contain:

* module name
* purpose
* responsibilities
* public API
* allowed dependencies
* forbidden dependencies
* critical files
* safe edit points
* known fragile areas
* common user changes
* known legacy issues

### 2. CHANGE_BRIEF

Created by the permanent architect/custodian before implementation.

It must contain:

* change id
* module
* request summary
* change classification
* risk level
* whether the request belongs to the module
* allowed files
* forbidden files
* contracts to preserve
* required checks/tests
* required documentation updates
* special notes for legacy or fragile areas

### 3. CHANGE_REPORT

Created by the ephemeral developer after implementation.

It must contain:

* change id
* completion status
* files changed
* files intentionally not changed
* tests updated or run
* deviations from the brief
* known risks
* assumptions or unresolved issues

### 4. REVIEW_RESULT

Created by the permanent architect/custodian.

It must contain:

* accepted / rejected / needs revision
* whether boundaries were respected
* whether contracts were preserved
* whether docs were updated
* whether further work is needed
* whether the module memory must be updated

---

## Example CHANGE_BRIEF Structure

```yaml
change_id: CHG-YYYY-MM-DD-001
module: orders
request: "Change checkout button text"
classification: "ui text change"
risk: low
owned_by_module: true

allowed_files:
  - src/modules/orders/ui/CheckoutPage.tsx
  - src/modules/orders/config/text.ts
  - src/modules/orders/README.md
  - docs/COMMON_CHANGES.md

forbidden_files:
  - src/modules/orders/domain/priceCalculation.ts
  - src/modules/billing/**
  - db/migrations/**

public_contracts_to_preserve:
  - submitOrder(cartId)
  - calculateCheckoutSummary(cartId)

required_checks:
  - checkout page renders correctly
  - order submit flow remains unchanged

required_docs:
  - module README
  - COMMON_CHANGES

notes:
  - prefer config/text edit over workflow logic change
  - do not alter price calculation
```

## Example CHANGE_REPORT Structure

```yaml
change_id: CHG-YYYY-MM-DD-001
status: implemented

files_changed:
  - src/modules/orders/config/text.ts
  - src/modules/orders/ui/CheckoutPage.tsx
  - src/modules/orders/README.md

files_not_changed:
  - src/modules/orders/domain/priceCalculation.ts
  - src/modules/billing/**

tests:
  - checkout page render test passed
  - submit order integration test unchanged and passed

deviations:
  - none

risks:
  - none identified
```

---

## Locking and Edit Ownership

Only one role may hold edit authority for a given scope at a time.

### Required Lock Model

* the supervising permanent agent owns the folder during planning and review
* its ephemeral developer owns the delegated folder scope during implementation
* the supervising permanent agent regains control for validation and acceptance
* if the work belongs to a child permanent agent, the parent delegates authority before implementation begins
* parent and child permanent agents must not both run concurrent uncontrolled edits in overlapping scope

The architect and developer must not edit the same folder concurrently.
Parent and child permanent agents must not issue conflicting edits into overlapping paths at the same time.

This avoids:

* conflicting edits
* inconsistent docs
* authority confusion
* overwritten decisions
* parent-child scope collisions

---

## Rules for Existing or Legacy Projects

This policy applies to existing running projects even when they were not built with these rules.

The multi-agent system must not assume a clean greenfield project.

### Legacy Project Principle

In an existing project, the goal is not to force a full rewrite. The goal is to introduce structure progressively while preserving system stability.

### Required Legacy Strategy

For existing projects, the permanent agent must prefer:

* mapping before restructuring
* stabilizing before refactoring
* wrapping before replacing
* modularizing when touched
* protecting critical flows before architectural cleanup

### Legacy Classification

The permanent agent must classify target areas as:

* well-structured module
* partially structured area
* legacy mixed area
* fragile critical area

### Legacy Behavior Rules

#### For well-structured modules

Proceed with normal scoped change.

#### For partially structured areas

Make the requested change and improve boundaries modestly if safe.

#### For legacy mixed areas

Prefer minimal safe edits, document the area, avoid broad refactors, and add protective tests if possible.

#### For fragile critical areas

Prefer protection first: mark risks, preserve behavior, add checks, and minimize surface of change.

### Progressive Improvement Rule

Every accepted change in a legacy area should leave behind at least one improvement where practical, such as:

* clearer documentation
* extracted text/config/theme/template location
* improved module boundary note
* added test around touched behavior
* warning note on risky files
* app map update

---

## Module Design Requirements

Each module should aim to contain:

* clear business responsibility
* one public entry point
* internal implementation hidden behind public exports
* its own tests
* its own README
* limited dependencies
* clear safe edit points

### Recommended Module Shape

```text
src/
  modules/
    orders/
      MODULE.md
      README.md
      index.ts
      ui/
      api/
      domain/
      infra/
      config/
      tests/
```

### Public vs Internal Rule

Other modules may import only the module public surface, not internal implementation files.

Allowed:

```ts
import { createOrder } from "@/modules/orders";
```

Forbidden:

```ts
import { internalMapper } from "@/modules/orders/infra/internalMapper";
```

---

## Discoverability Requirements for the User

The multi-agent system must help users understand the project, not only edit it.

### Project-Level Navigation Files

The project should maintain:

* APP_MAP.md
* COMMON_CHANGES.md
* ARCHITECTURE_RULES.md
* AI_CHANGE_POLICY.md

### APP_MAP.md Should Explain

* main modules
* what each module does
* critical areas
* global configuration locations
* safe edit zones
* danger zones

### COMMON_CHANGES.md Should Explain

Where common changes go, such as:

* logo
* home page title
* button labels
* email templates
* feature flags
* theme/colors
* limits and thresholds

### Module README or MODULE.md Should Explain

* what the module does
* public API
* safe edit points
* dangerous files
* common user changes
* known invariants

---

## Owner-Editable Zones

The system should prefer dedicated safe locations for common minor changes.

These may include:

* text labels
* feature flags
* theme/branding
* email templates
* display settings
* business thresholds when appropriate

### Preferred Locations

```text
src/
  config/
    text/
    settings/
    features/
  theme/
  templates/
```

Or module-local equivalents:

```text
src/modules/orders/config/
src/modules/orders/templates/
```

The permanent agent should route minor user changes to these safe edit zones whenever possible.

---

## What the Permanent Agent Must Tell the User

The permanent agent should not behave like a black box. It should help the user understand the system.

For each meaningful request, it should be able to explain:

* which module owns the change
* what the safest edit point is
* what was intentionally not touched
* whether the change affects behavior or only presentation/config
* where similar future changes should go

This explanation should be simple and owner-friendly.

---

## Forbidden Behaviors

The multi-agent system must avoid the following:

* uncontrolled broad refactors during small requests
* editing outside approved scope without explicit authorization
* changing public contracts silently
* modifying critical areas when a safe edit point exists elsewhere
* allowing two equal agents to edit the same folder concurrently
* leaving documentation outdated after a behavioral change
* using raw shared utility folders as dumping grounds
* mixing UI text, rules, data access, and workflow in a single file unnecessarily

---

## Shared Code Rules

Shared code must remain minimal and truly generic.

The system must be suspicious of large or vague shared areas such as:

* utils/
* helpers/
* shared/
* common/

Rule:
If code is specific to a feature, it should remain in that feature module instead of being extracted prematurely to shared code.

---

## Critical Areas

Some areas must receive extra protection.

Typical critical areas include:

* authentication
* billing and payments
* permissions and authorization
* database migrations
* shared contracts
* audit trails
* security logic

For critical areas, the permanent agent must:

* classify higher risk
* narrow scope aggressively
* require stronger validation
* avoid unrelated cleanup
* mark dangerous files clearly

---

## Validation Requirements

Every significant change must be validated at the right level.

Possible validation types:

* unit tests for domain logic
* integration tests for module public API
* scenario tests for critical flows
* end-to-end tests for user-critical paths

### Critical Scenario Examples

The system should protect flows such as:

* sign in
* sign out
* checkout
* payment confirmation
* permission enforcement
* notification sending
* export generation
* admin approvals

---

## Default Decision Rule for the System

When deciding between speed and control, prefer control.

When deciding between broad cleanup and narrow safe change, prefer narrow safe change.

When deciding between rewriting and wrapping legacy code, prefer wrapping first.

When deciding between using a second permanent same-folder agent or an ephemeral task agent, prefer the ephemeral task agent.

---

## Standard Operating Procedure

### SOP 1: For Every Request

1. classify the request
2. determine the correct permanent owner in the hierarchy
3. map it to a module or folder scope
4. assess risk
5. determine allowed scope
6. delegate downward if a lower permanent agent is the true owner
7. create change brief at the owning level
8. spawn ephemeral developer
9. receive change report
10. review against brief
11. update docs and memory
12. explain result to user

### SOP 2: For Legacy Areas

1. identify whether area is legacy mixed or fragile
2. minimize implementation scope
3. add protection before refactor where needed
4. improve documentation and mapping
5. leave at least one structural improvement if safe

### SOP 3: For Cross-Module or Cross-Scope Requests

1. identify the nearest permanent parent with authority across all affected scopes
2. split request into scope-owned subchanges
3. produce one brief per affected owned scope where possible
4. preserve shared contracts explicitly
5. do not allow one uncontrolled edit to spread across multiple modules or sibling scopes
6. require parent-level review when shared boundaries are affected

### SOP 4: For Parent-Child Delegation

1. parent permanent agent determines whether ownership is local or belongs to a child scope
2. if child-owned, parent delegates request context, constraints, and parent-level boundaries
3. child permanent agent performs local planning and spawns its own ephemeral developer if needed
4. child permanent agent reviews and returns result upward when parent-level awareness is required
5. parent permanent agent validates any cross-scope or parent-level contract impact

## Final Policy Statement

The multi-agent system must behave as a governed engineering process, not as an uncontrolled collection of coders.

Its default structure must be:

* one permanent custodian/architect per owned folder or module scope
* optional lower permanent custodians for owned subfolders in the hierarchy
* one ephemeral developer per approved task under the relevant permanent owner
* explicit handoff artifacts
* strict scope control
* clear parent-child delegation rules
* progressive improvement for existing systems
* clear communication to the owner
* protection of critical functionality and stable contracts

The system succeeds not only when it changes code, but when it keeps the project understandable, navigable, and safe to evolve over time.
