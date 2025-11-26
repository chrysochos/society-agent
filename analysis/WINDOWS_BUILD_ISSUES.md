# KiloCode Windows Build Issues - Analysis

## Date: 2025-11-26

## Problem Summary
KiloCode cannot build on native Windows due to pnpm not creating `.bin` directory symlinks on Windows. Commands like `tsc`, `tsup`, `vite`, and `turbo` are not found when running build scripts.

## Root Cause
1. **pnpm on Windows**: Does not create `.bin` directory with executable symlinks like npm does
2. **Monorepo Structure**: Uses turborepo to orchestrate builds across multiple packages
3. **Package Scripts**: Individual packages call executables directly (e.g., `tsc`, `tsup`) which aren't in PATH
4. **Environment**: Node v22.14.0 (should be v20.19.2 per .nvmrc)

## Current Status

### ✅ Successfully Installed
- pnpm 10.8.1
- 3676/3677 packages (99.97% success rate)
- turbo 2.6.0
- All TypeScript, build tools, and dependencies

### ❌ Failing
- **@vscode/sqlite3**: Needs Visual Studio C++ build tools (non-critical - used for code indexing)
- **Build Process**: turbo can run, but sub-packages can't find their tool binaries

### Attempted Solutions
1. ✅ Installed pnpm globally
2. ✅ Ran `pnpm install --force --no-optional`
3. ❌ Added `.npmrc` with `shamefully-hoist=true` (didn't create .bin)
4. ❌ Tried adding binaries to PATH manually (not inherited by subprocesses)
5. ❌ Tried using `pnpm exec turbo` (still can't find tsc/tsup in sub-packages)

## Recommended Solutions (In Order of Preference)

### 1. Use DevContainer (Recommended by KiloCode team)
From DEVELOPMENT.md:
> **Note for Windows Contributors**: If you're having issues with WSL or want a standardized development environment, we recommend using the devcontainer option.

**Pros**: Official Windows development path, consistent environment
**Cons**: Requires Docker Desktop

**Steps**:
- Install Docker Desktop
- Reopen workspace in VS Code devcontainer
- Let container auto-setup handle everything

### 2. Use WSL2 (Windows Subsystem for Linux)
**Pros**: Native Linux tooling, proper symlinks, matches production environment
**Cons**: Requires WSL2 setup, file system performance considerations

**Steps**:
- Install WSL2 with Ubuntu
- Clone repo in WSL filesystem (`~/kilocode`)
- Install Node 20.19.2 via nvm
- Run `pnpm install` and `pnpm build` in WSL

### 3. Patch Package Scripts (Not Recommended - Violates AGENTS.md)
Modify all package.json files to use `pnpm exec` prefix:
```json
"build": "pnpm exec tsup"
```

**Pros**: Would work on Windows
**Cons**: Requires modifying ~20 package.json files, creates merge conflicts with upstream Roo

### 4. Create Windows Build Wrapper Script
Create a PowerShell script that sets up the full PATH with all pnpm binaries before calling turbo.

**Pros**: No repo modifications
**Cons**: Complex, fragile, requires maintaining binary paths

## Verification Commands

```powershell
# Check installations
pnpm --version          # Should show 10.8.1
node --version          # Currently v22.14.0 (should be v20.19.2)

# Check turbo direct invocation
node node_modules\turbo\bin\turbo --version  # Works: 2.6.0

# Check if .bin directory exists
Test-Path node_modules\.bin  # Currently: False

# Check package installation
dir node_modules\.pnpm | findstr turbo  # Shows turbo-windows-64@2.6.0 and turbo@2.6.0
```

## Decision Point
**Should we proceed with DevContainer setup, or continue troubleshooting native Windows build?**

Native Windows development is not officially supported by the KiloCode team for this exact reason - pnpm binary linking issues. The DevContainer approach is their recommended solution.

## Next Steps (User Decision Required)
1. **Option A**: Set up DevContainer (recommended, requires Docker)
2. **Option B**: Set up WSL2 (good alternative)
3. **Option C**: Document "Windows builds unsupported natively" and proceed with code analysis only
4. **Option D**: Create a workaround wrapper script (technical debt, not recommended)
