# Society Agent Development Workflow

## Setup (One-time)

### 1. Create Test Workspace

```bash
# Create test workspace with sample files
pnpm test:workspace

# Created at: ~/kilocode-test-workspace
```

### 2. Configure VS Code Settings

Open VS Code settings (Cmd/Ctrl + ,) and add:

**JSON settings:**

```json
{
	"kilo-code.societyAgent.workingDirectory": "/root/kilocode-test-workspace"
}
```

**Or via UI:**

1. Open Settings (⚙️ icon)
2. Search: `society agent working`
3. Set **Kilo Code: Society Agent Working Directory** to: `/root/kilocode-test-workspace`

### 3. Install Extension (First time)

```bash
pnpm install:vsix
```

## Development Loop (Repeat)

### 1. Make Code Changes

Edit files in `/workspace/src/` or `/workspace/webview-ui/`

### 2. Rebuild

```bash
pnpm build
```

### 3. Reload VS Code

- **Mac**: Cmd + R
- **Linux/Windows**: Ctrl + R
- **Or**: Command Palette → "Developer: Reload Window"

### 4. Test

Open KiloCode chat and type:

```
Use multiple agents to create a calculator with tests
```

### 5. Verify

- Check Society Agent dashboard opens
- Messages appear in message stream
- Files created in `/root/kilocode-test-workspace/` (not in your extension dev folder!)
- Logs in `/root/kilocode-test-workspace/.society-agent/logs/`

## Key Benefits

✅ **No F5 needed** - Just reload window (faster)
✅ **Clean separation** - Extension code vs. test project
✅ **Persistent test data** - `.society-agent/` logs persist between reloads
✅ **Real workspace** - Test in a realistic project environment

## Troubleshooting

### "Working directory not set"

1. Check settings: `kilo-code.societyAgent.workingDirectory`
2. Must be absolute path (e.g., `/root/kilocode-test-workspace`)
3. Reload window after changing settings

### "Files created in wrong location"

- Society Agent should use configured directory
- KiloCode regular tasks still use VS Code workspace
- Check logs: Extension Host → Developer: Show Logs → Extension Host

### "Extension not loading"

```bash
# Reinstall
pnpm install:vsix

# Or manually
code --install-extension /workspace/bin/kilo-code-*.vsix
```

## Advanced: Multiple Test Workspaces

```bash
# Create different scenarios
node scripts/create-test-workspace.js ~/test-react-app
node scripts/create-test-workspace.js ~/test-node-api
node scripts/create-test-workspace.js ~/test-fullstack
```

Then switch between them in settings:

```json
{
	"kilo-code.societyAgent.workingDirectory": "/root/test-react-app"
}
```

Reload window → Test with different workspace!

## Quick Reference

| Action             | Command                     |
| ------------------ | --------------------------- |
| Create workspace   | `pnpm test:workspace`       |
| Build extension    | `pnpm build`                |
| Install extension  | `pnpm install:vsix`         |
| Reload window      | Cmd/Ctrl + R                |
| View logs          | Extension Host logs         |
| Test Society Agent | "Use multiple agents to..." |

## Next Steps

Once you're happy with changes:

1. Run tests: `pnpm test`
2. Check types: `pnpm check-types`
3. Commit changes
4. Create PR

---

**Tip:** Keep the test workspace open in a second VS Code window for easy file browsing while developing!
