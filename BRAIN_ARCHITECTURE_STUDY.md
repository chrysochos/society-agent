# Brain Architecture - Fast Study Guide

> **Goal**: Quickly understand and validate the single-agent folder-based architecture that works in Mind Tool

## What We Know Works (From Mind Tool)

Your Mind Tool has proven this architecture:

- **Single Agent**: One LLM managing everything
- **Flat Folders**: Manual folder creation, simple structure
- **Manual Control**: You decide when to create folders
- **Knowledge in Files**: Information stored as markdown files

## What We're Building (Brain System)

Evolution of Mind Tool:

- **Single Agent**: Still one LLM (keep simplicity)
- **Hierarchical Folders**: Auto-organizing tree structure
- **Automatic Management**: LLM decides folder structure
- **Knowledge in Files**: Same markdown approach
- **Self-Organizing**: Splits and reorganizes as knowledge grows

## Fast Validation Plan

### Step 1: Test Current Kilo (5 minutes)

```bash
# Open VS Code with Kilo
# Create a test workspace: /test-brain/
# Start Kilo agent with this prompt:

"You are a brain simulator. Create a folder /memory/ and inside it create:
1. authentication/context.md - Store info about building auth system
2. authentication/decisions.md - Log that we chose JWT tokens

Then show me what you created."
```

**Expected Result**: Agent creates folders and files

### Step 2: Test Reorganization (5 minutes)

```bash
# Continue with the same agent:

"Now I want to add:
- Database schema for users
- Password hashing with bcrypt
- Session management
- OAuth integration with Google

Update the folder structure to organize this growing knowledge."
```

**Expected Result**: Agent should create subfolders like:

```
memory/
  authentication/
    context.md
    decisions.md
    storage/
      database.md
      sessions.md
    security/
      password-hashing.md
      oauth.md
```

### Step 3: Test Category Emergence (5 minutes)

```bash
# Start talking about a NEW topic:

"I also need to build a payment system with Stripe integration"
```

**Expected Result**: Agent creates parallel structure:

```
memory/
  authentication/
    ...
  payments/
    context.md
    stripe-integration.md
```

### Step 4: Test Context Retrieval (5 minutes)

```bash
# Close and reopen Kilo agent
# Use Brain System Prompt

"What do I know about authentication?"
```

**Expected Result**: Agent reads `/memory/authentication/` and summarizes

## Key Insights from Kilo Codebase

From our research, Kilo already has:

1. **Summarization** (`src/core/condense/`):

    - 6-part structured summary
    - Keeps last 3 messages
    - Auto-condenses old messages

2. **Persistence** (`src/core/task-persistence/`):

    - `api_conversation_history.json`
    - `ui_messages.json`
    - Stored in `~/.kilocode/tasks/{taskId}/`

3. **File Operations** (Built-in Tools):
    - `list_files` - Browse folders
    - `read_file` - Read content
    - `write_to_file` - Create/update files
    - `list_code_definition_names` - Understand structure

## Architecture Comparison

### Mind Tool (Manual)

```
/knowledge/
  project-a/
    notes.md
  project-b/
    notes.md
```

- You create folders manually
- Flat structure
- Simple, proven to work

### Brain System (Automatic)

```
/memory/
  projects/
    authentication/
      context.md
      decisions.md
      components/
        jwt-tokens.md
        password-hashing.md
    payments/
      context.md
      stripe-integration.md
  concepts/
    security/
      best-practices.md
```

- LLM creates folders automatically
- Hierarchical structure
- Self-organizing, scales to large knowledge

## Critical Question: What Makes It Fast?

**Hypothesis**: Good folder structure = Fast retrieval

### Bad Structure (Slow):

```
/memory/
  everything.md  (10,000 lines)
```

- Agent must read entire file
- High token cost
- Slow retrieval

### Good Structure (Fast):

```
/memory/
  authentication/
    context.md (200 lines)
    components/
      jwt.md (100 lines)
      oauth.md (150 lines)
```

- Agent reads only relevant folder
- Low token cost
- Fast retrieval

**Key Principle**: "Minimize what you need to read to answer a question"

## Implementation Strategy

### Phase 1: Validate with Existing Kilo (TODAY)

1. Test Brain System Prompt with standard Kilo agent
2. Manually verify folder creation
3. Check if LLM naturally organizes knowledge
4. Measure: Does it create good structure?

### Phase 2: Refine System Prompt (1-2 days)

1. Test edge cases (what breaks the organization?)
2. Refine prompts for better folder decisions
3. Add examples of good vs bad structure
4. Document patterns that work

### Phase 3: Add Automation (Optional - Later)

1. Auto-analyze folder structure
2. Suggest reorganization when needed
3. Detect when folders get too large
4. Merge related folders

## What We're Testing

| Test                | Purpose                                | Success Metric                              |
| ------------------- | -------------------------------------- | ------------------------------------------- |
| Folder Creation     | Can LLM create hierarchical structure? | Creates folders matching semantic clusters  |
| Auto-Reorganization | Can LLM split when >10 items?          | Automatically creates subcategories         |
| Category Emergence  | Can LLM group related folders?         | Creates parent folder for related topics    |
| Context Inheritance | Do child folders know parent context?  | Doesn't duplicate info in children          |
| Fast Retrieval      | Can LLM find info quickly?             | Reads only relevant folders, not everything |

## Expected Problems & Solutions

### Problem 1: LLM Creates Flat Structure

**Symptom**: All files in `/memory/`, no subfolders  
**Solution**: Emphasize in prompt: "When you have >5 files, create subcategories"

### Problem 2: Too Many Nested Levels

**Symptom**: `/memory/a/b/c/d/e/f/file.md`  
**Solution**: Limit to 3-4 levels deep in prompt

### Problem 3: Duplicate Information

**Symptom**: Same info in multiple files  
**Solution**: Emphasize: "Each fact lives in ONE place only"

### Problem 4: Bad Category Names

**Symptom**: `/memory/stuff/things/misc/notes.md`  
**Solution**: Require semantic names: "Use domain terms, not generic words"

## Fast Validation Script

Create `/test-brain/validate.sh`:

```bash
#!/bin/bash

echo "=== Brain Architecture Validation ==="
echo ""
echo "Step 1: Creating test workspace..."
mkdir -p /test-brain/memory

echo "Step 2: Starting Kilo agent..."
echo "Paste Brain System Prompt and run these tests:"
echo ""
echo "Test 1: 'Build authentication system with JWT'"
echo "Expected: Creates /memory/authentication/ folder"
echo ""
echo "Test 2: 'Add database schema, sessions, OAuth'"
echo "Expected: Creates subfolders under authentication/"
echo ""
echo "Test 3: 'Build payment system with Stripe'"
echo "Expected: Creates /memory/payments/ folder"
echo ""
echo "Test 4: 'What do I know about auth?'"
echo "Expected: Reads only authentication/ folder"
echo ""
echo "=== Validation Complete ==="
```

## Next Steps (In Order)

1. ✅ **RIGHT NOW**: Run validation tests with existing Kilo
2. ⏳ **If successful**: Document what works
3. ⏳ **If issues**: Refine Brain System Prompt
4. ⏳ **After validation**: Consider automation helpers
5. ⏳ **Much later**: Multi-agent (only if needed)

## Key Insight from Mind Tool

You said: "I did a similar smaller system called Mind tool... I use a single agent to handle a folder/subfolders to keep the knowledge"

**This proves the concept works!** We just need to:

1. Make it hierarchical (not flat)
2. Make it automatic (not manual)
3. Make it self-organizing (split when needed)

The rest is the same: Files + Folders + Single Agent + LLM Intelligence

## Architecture Decision

**START SIMPLE**:

- Single agent (proven in Mind Tool)
- Hierarchical folders (better than flat)
- LLM decides structure (no algorithms)
- Files are memory (markdown)
- VS Code is environment (visual + terminal)

**ADD COMPLEXITY LATER** (only if needed):

- Multi-agent coordination
- Agent-to-agent communication
- Complex orchestration
- Approval workflows

## Success Criteria

You'll know this architecture works when:

1. ✅ Agent creates logical folder structure automatically
2. ✅ Knowledge grows hierarchically (splits when needed)
3. ✅ Retrieval is fast (reads only relevant folders)
4. ✅ Context persists across sessions (uses Kilo's persistence)
5. ✅ Structure emerges naturally from conversations

## References

- **Brain System Prompt**: `/workspace/BRAIN_SYSTEM_PROMPT.md` (comprehensive spec)
- **Kilo Summarization**: `src/core/condense/` (already built)
- **Kilo Persistence**: `src/core/task-persistence/` (already built)
- **Kilo Tools**: Built-in file operations (list, read, write)
- **Mind Tool**: Your existing system (proof of concept)

---

**Ready to validate?** Start with Step 1 of the Fast Validation Plan above! 🚀
