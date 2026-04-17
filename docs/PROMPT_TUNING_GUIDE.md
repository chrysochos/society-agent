# Prompt Tuning Guide

This guide explains the prompt layers in Society Agent and how to tune them safely.

## Mental model: 5 prompt layers

When an agent responds, its behavior is shaped by these layers (top to bottom):

1. Base global rules (applies to all agents)
2. Agent system prompt (role + responsibilities)
3. Project prompt section (stack, validation commands, conventions)
4. Runtime orchestration packet (task mode, scope, output contract)
5. Your current chat message (the immediate instruction)

If behavior feels wrong, identify which layer is causing it before editing.

## Where to edit each layer

### 1) Base global rules

- File: src/society-server.ts
- Builder: BASE_AGENT_RULES and buildFullSystemPrompt()
- Effect: hard behavior defaults for all agents (format, verification, coordination)

Edit this only for true global policy changes.

### 2) Agent system prompt

- File: src/society-server.ts
- Endpoint flow: POST /api/projects/:id/agents and PUT /api/projects/:projectId/agents/:agentId
- UI field: Add/Edit Agent modal customInstructions

Best place for role-level behavior changes. Avoid putting project-specific commands here.

### 3) Project prompt section

- File: src/project-config.ts
- Function: generateProjectPromptSection(config)
- Config source: auto-detection + .society.json in project root

Best place for validation commands and stack constraints.

### 4) Runtime orchestration packet

- Files:
  - src/prompt-orchestration.ts
  - src/society-server.ts
- Core functions:
  - inferRequestIntent()
  - composePromptPackage()
  - toPromptString()

This layer decides mode (plan/patch/debug/review/generate), scope hints, and output shape.

### 5) User steering instruction

- Sent in chat per task
- Strongest practical control for day-to-day behavior

Use short operational commands instead of long prose.

## Prompt anatomy for better results

Use this structure when instructing a lead agent:

1. Goal: one sentence
2. Scope: folders/files allowed
3. Constraints: what not to touch
4. Quality bar: tests, lint, typecheck
5. Output contract: exact response shape

Template:

Goal: Build X.
Scope: Only edit Y and Z.
Constraints: Do not change A, B, C.
Quality: Run typecheck and tests before done.
Output: Summary, files changed, risks, verification results.

## High-leverage tuning knobs

### A) Reduce chaos

- Force smaller change size:
  - "Make one minimal patch only."
- Force no broad discovery:
  - "Do not scan unrelated folders."
- Force explicit stop condition:
  - "Stop after phase 1 and wait."

### B) Improve correctness

- Require evidence:
  - "For each claim, cite file + line."
- Require verification:
  - "Run typecheck and include result."
- Require rollback safety:
  - "No destructive operations."

### C) Improve delegation quality

- Ask supervisor to decompose before coding:
  - "Plan first, then assign tasks with checklists."
- Require ownership boundaries:
  - "Backend owns API, frontend owns UI; coordinate via messages."

## What to edit for common problems

### Problem: Agent is too verbose and slow

- Edit user instruction first (Layer 5):
  - "Use max 5 bullets and no repeated context."
- If still noisy, tighten BASE_AGENT_RULES output section (Layer 1).

### Problem: Agent edits too many files

- Add explicit scope in user task (Layer 5).
- Tighten orchestration constraints in composePromptPackage() (Layer 4).

### Problem: Agent skips tests

- Ensure project validation commands are correct in .society.json and generateProjectPromptSection() (Layer 3).
- Reinforce mandatory verify wording in BASE_AGENT_RULES (Layer 1).

### Problem: Agent picks wrong mode

- Tune inferRequestIntent() keyword mapping (Layer 4).
- Tune DEFAULT_MODE_ROUTER override rules (Layer 4).

## Safe editing strategy

1. Change one layer at a time.
2. Test with the same benchmark task after each change.
3. Keep a changelog of prompt edits and outcomes.
4. Revert quickly if behavior regresses.

Suggested benchmark tasks:

- "Fix one TypeScript error in file X."
- "Add one API endpoint with tests."
- "Refactor one function without behavior change."

## Suggested starter presets

### Controlled mode (recommended default)

Use when reliability matters.

Goal: <task>
Scope: <exact folders>
Constraints: minimal diff, no unrelated files.
Quality: run typecheck + tests.
Output: summary + files + risks + verification.
Stop: wait after first complete patch.

### Fast mode

Use when exploring quickly.

Goal: <task>
Scope: feature folder.
Constraints: can create new files if needed.
Quality: run at least one validation command.
Output: short status and next 3 actions.

## Operator checklist before each task

1. Is the goal one sentence?
2. Is scope explicit?
3. Are constraints explicit?
4. Is verification explicit?
5. Is output format explicit?

If all five are present, prompt quality is usually high.