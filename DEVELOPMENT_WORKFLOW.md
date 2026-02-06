# Society Agent Development Workflow

**Quick Reference**: Simplify your Docker + Debug workflow

---

## Current Status ✅

**Implementation**: 92% Complete (Weeks 1-2 done, Week 3 in progress)

- ✅ Backend services (all implemented)
- ✅ CLI commands (implemented)
- ✅ Extension integration (complete)
- ✅ Build system (working)
- ⏳ Webview UI (needs wiring)
- ⏳ End-to-end testing

**Build Status**: ✅ Passing (33.73 MB VSIX created)

---

## Simple Development Workflow

### Option 1: Direct Debug (Recommended - No Docker Hassle)

**Prerequisites**:

- VS Code installed
- Dev container already built and running

**Steps**:

1. **You're already connected** to the dev container `kilocode-dev` ✅

2. **Start Watch Mode** (rebuilds on code changes):

    **Method 1 (Recommended)**: Use VS Code task

    - Press `Ctrl+Shift+B` → Select "watch"
    - Or: `Ctrl+Shift+P` → "Tasks: Run Task" → "watch"

    **Method 2**: Manual terminal command

    ```bash
    npx turbo watch:bundle watch:tsc --log-order grouped
    ```

    Note: There is no `pnpm run watch` script - use the VS Code task instead!

3. **Launch Extension** in debug mode:

    - Press `F5` (or menu: Run > Start Debugging)
    - A new "[Extension Development Host]" window opens
    - This window runs YOUR code with Society Agent features

4. **Test Society Agent**:

    - In the Extension Development Host window
    - Open Command Palette: `Ctrl+Shift+P`
    - Type: "Society Agent" to see available commands
    - Or check the sidebar for "Society Agent" view

5. **Make Changes**:
    - Edit code in your main VS Code window
    - Watch mode rebuilds automatically
    - Reload Extension Dev Host: `Ctrl+R` in that window
    - Or restart debug session: `Ctrl+Shift+F5`

**That's it!** No Docker restart needed between changes.

---

### Option 2: CLI Testing (Direct Container Access)

**Test CLI commands without VS Code extension**:

```bash
# Build the CLI
cd /workspace/cli
pnpm run build

# Test society commands
node dist/index.js society --help
node dist/index.js society list
```

---

## Quick Commands Reference

### Build & Watch

```bash
# Full build (takes 1-2 minutes)
pnpm run build

# Watch mode (auto-rebuild on changes) - USE VS CODE TASK!
# Press Ctrl+Shift+B → Select "watch"
# Or manually: npx turbo watch:bundle watch:tsc --log-order grouped

# Build just the CLI
cd cli && pnpm run build

# Build just the extension
pnpm run bundle
```

### Debug

```bash
# Start debug session
F5 (in VS Code)

# Restart debug session
Ctrl+Shift+F5

# Reload extension in debug window
Ctrl+R (in Extension Development Host window)
```

### Testing

```bash
# Check for errors
pnpm run lint

# Run tests (when implemented)
pnpm run test

# Check build output
ls -lh bin/kilo-code-*.vsix
```

---

## What You Can Test Right Now

### 1. Extension Activation

**Test**: Does the extension load with Society Agent services?

```
1. Press F5 to start debug
2. Check Debug Console for: "[Extension Host] Extension activated"
3. Look for: "Society Agent services initialized"
```

**Expected**: Extension loads without errors

---

### 2. Command Registration

**Test**: Are Society Agent commands available?

```
1. In Extension Development Host window
2. Ctrl+Shift+P (Command Palette)
3. Type: "Society Agent"
```

**Expected**: See "Society Agent: Show Dashboard" command

---

### 3. Sidebar View

**Test**: Does Society Agent view appear?

```
1. In Extension Development Host window
2. Look at left sidebar (Activity Bar)
3. Find icon with organization symbol
4. Click it
```

**Expected**: Society Agent panel appears (may show placeholder if UI not wired yet)

---

### 4. CLI Commands

**Test**: Do society commands work?

```bash
cd /workspace/cli
node dist/index.js society --help
node dist/index.js society list
```

**Expected**: Command help displays, empty list for active purposes

---

## Troubleshooting

### Issue: Build fails with TypeScript errors

**Solution**:

```bash
# Clear node_modules and rebuild
pnpm clean
pnpm install
pnpm run build
```

---

### Issue: Extension doesn't load in debug mode

**Solution**:

1. Check Output panel: "Extension Host" for errors
2. Verify `src/extension.ts` has no syntax errors
3. Try: Stop debug (Shift+F5) → Rebuild (Ctrl+Shift+B) → Debug (F5)

---

### Issue: Changes not reflected in debug session

**Solution**:

- Reload extension window: `Ctrl+R` in Extension Development Host
- Or restart debug: `Ctrl+Shift+F5`
- Check watch mode is running (should see "Watching for file changes...")

---

### Issue: Docker container issues

**Solution**:

- You're already connected ✅
- If needed to reconnect: `Ctrl+Shift+P` → "Dev Containers: Reopen in Container"
- To rebuild container: `Ctrl+Shift+P` → "Dev Containers: Rebuild Container"

---

## Next Steps for Week 3 Completion

### What's Left to Implement

**1. Webview UI Components** (3-4 hours):

- Wire up the React components to receive messages from extension
- Implement state management for agent cards
- Add loading states and error handling

**2. Message Passing** (2-3 hours):

- Test extension → webview communication
- Test webview → extension commands
- Verify all event handlers work

**3. End-to-End Testing** (2-3 hours):

- Create test purpose: "Analyze this file"
- Verify supervisor creates workers
- Check agent status updates in UI
- Test pause/resume/stop controls

**4. Bug Fixes & Polish** (2-3 hours):

- Handle edge cases
- Improve error messages
- Add progress indicators
- Performance optimization

**Total Time Remaining**: ~10-12 hours

---

## Recommended Workflow for You

**Daily Development**:

1. **Morning**:

    - Already in dev container ✅
    - Start watch: Press `Ctrl+Shift+B` → Select "watch"
    - Press F5 to start debug session

2. **During Development**:

    - Make code changes in main window
    - Watch mode rebuilds automatically
    - Reload extension: `Ctrl+R` in debug window
    - Test immediately

3. **Testing**:

    - Manual testing in Extension Development Host
    - CLI testing: `node dist/index.js society <command>`
    - Check debug console for logs

4. **End of Day**:
    - Commit changes: `git commit -m "..."`
    - No need to stop container (stays running)

**No Docker restart needed between sessions!**

---

## Quick Verification Checklist

Before pushing changes:

- [ ] Code builds without errors: `pnpm run build`
- [ ] No TypeScript errors: `pnpm run check-types`
- [ ] Extension activates in debug mode (F5)
- [ ] Society Agent commands appear in Command Palette
- [ ] CLI commands work: `node cli/dist/index.js society --help`
- [ ] All `// kilocode_change` markers present

---

## Key Files to Know

**Backend (Extension)**:

- `src/extension.ts` - Main entry point
- `src/core/webview/SocietyAgentProvider.ts` - Webview controller (300 lines)
- `src/services/society-agent/` - All agent services

**Frontend (Webview)**:

- `webview-ui/src/components/society-agent/` - React components (future)

**CLI**:

- `cli/src/commands/society.ts` - CLI commands
- `cli/src/index.ts` - CLI entry point

**Documentation**:

- `AGENTS.md` - This file (architecture overview)
- `SOCIETY_AGENT_README.md` - User guide
- `SOCIETY_AGENT_IMPLEMENTATION.md` - Progress tracking

---

## Summary

**Your Workflow Now**:

1. **Already in container** ✅
2. **Start watch mode**: `Ctrl+Shift+B` → "watch" (or: `npx turbo watch:bundle watch:tsc`)
3. **Press F5**: Debug extension
4. **Make changes**: Auto-rebuild
5. **Reload**: `Ctrl+R` in debug window

**No Docker hassle, fast iteration, immediate testing!** 🚀

---

**Questions?**

- Check: `SOCIETY_AGENT_QUICKSTART.md` for detailed tutorials
- Check: `AGENTS.md` for architecture details
- Check: Debug Console for error messages
