---
name: workflow-policy
description: Multi-agent development policy - custodians govern folders, workers implement code
version: 1.0
triggers:
  - custodian
  - worker
  - change brief
  - workflow policy
  - governance
  - ephemeral developer
parameters: {}
---

# Multi-Agent Development Policy

This skill defines how permanent (custodian) and ephemeral (worker) agents collaborate.

## Core Principle

**Custodians govern, workers implement.**

---

## Roles

### Custodian (Permanent Agent)
- Governs one folder/module scope
- **Can ONLY write**: `.md`, `.txt` files (governance docs)
- **Cannot write**: Any code files (`.ts`, `.js`, `.py`, `.tsx`, `.jsx`, etc.)
- **Commands**: Read-only only (`ls`, `cat`, `git status`, `git log`, `git diff`, `tree`, `find`, `grep`)
- **Responsibilities**:
  - Classify incoming requests
  - Assess risk and scope
  - Create CHANGE_BRIEF for workers
  - Review CHANGE_REPORT from workers
  - Update documentation
  - Spawn ephemeral workers for implementation

### Worker (Ephemeral Agent)
- Executes bounded implementation tasks
- Receives CHANGE_BRIEF from custodian
- Can write code within approved scope
- Returns CHANGE_REPORT after completion
- Terminates after task

---

## Workflow

1. **Request Intake** - Custodian classifies the request
2. **Assessment** - Custodian determines risk, scope, allowed/forbidden files
3. **Brief Creation** - Custodian creates CHANGE_BRIEF
4. **Implementation** - Worker implements within brief constraints
5. **Report** - Worker returns CHANGE_REPORT
6. **Review** - Custodian validates against brief
7. **Acceptance** - Custodian updates docs/memory

---

## CHANGE_BRIEF Format

```yaml
change_id: CHG-YYYY-MM-DD-NNN
module: <module_name>
request: "<user request summary>"
classification: "<ui|config|logic|schema|infra>"
risk: <low|medium|high|critical>

allowed_files:
  - src/modules/X/file.ts
  - src/modules/X/README.md

forbidden_files:
  - src/modules/X/domain/critical.ts
  - db/migrations/**

contracts_to_preserve:
  - functionName(args)
  - publicApiMethod()

required_checks:
  - unit tests pass
  - lint passes

required_docs:
  - module README

notes:
  - special instructions for legacy/fragile areas
```

---

## CHANGE_REPORT Format

```yaml
change_id: CHG-YYYY-MM-DD-NNN
status: implemented|failed|partial

files_changed:
  - src/modules/X/file.ts

files_not_changed:
  - src/modules/X/domain/critical.ts

tests:
  - test name: passed|failed

deviations:
  - none OR list deviations from brief

risks:
  - none OR list identified risks

assumptions:
  - any assumptions made
```

---

## Authority Rules

- Authority flows downward through hierarchy
- Each folder has ONE custodian (no dual ownership)
- Parent custodian delegates to child custodians for subfolders
- Ephemeral workers are always supervised by their spawning custodian
- No agent edits across sibling scopes in one action

---

## Locking

Only one role holds edit authority at a time:
1. Custodian owns folder during planning/review
2. Worker owns folder during implementation
3. Custodian regains control for validation

Never concurrent edits by custodian and worker on same scope.

---

## Legacy Projects

For existing codebases:
- **Map before restructuring**
- **Stabilize before refactoring**
- **Wrap before replacing**
- **Protect critical flows first**

Classify areas as: well-structured | partially-structured | legacy-mixed | fragile-critical

---

## Forbidden Behaviors

- Uncontrolled broad refactors
- Editing outside approved scope
- Changing public contracts silently
- Two agents editing same folder concurrently
- Leaving docs outdated after behavioral changes
