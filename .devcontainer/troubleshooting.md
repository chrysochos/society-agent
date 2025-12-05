# Dev Container Troubleshooting Guide

## Issue: Exit code 1 when connecting to Dev Container

### Already Applied Fixes

1. ✅ Removed `--env WAYLAND_DISPLAY=` from runArgs (conflicted with WSL Wayland mount)
2. ✅ Cleaned Docker containers and cache (reclaimed 5.65GB)

### If Issue Persists

#### Option 1: Disable WSL Integration

Add this to your settings.json (User or Workspace):

```json
{
	"dev.containers.executeInWSL": false
}
```

#### Option 2: Simplify runArgs

If still failing, try removing all special capabilities:

```json
"runArgs": [
  "--init"
],
```

#### Option 3: Check Docker Desktop

- Ensure Docker Desktop is running
- WSL 2 backend is enabled
- Resources are sufficient (RAM: 4GB+, Disk: 10GB+)

#### Option 4: Rebuild Container from Scratch

```bash
# PowerShell
docker image rm $(docker images -q --filter reference='*kilocode*')
# Then reopen in container - will rebuild from Dockerfile
```

#### Option 5: Check Logs

View detailed logs:

```bash
# PowerShell
docker logs $(docker ps -a --filter "label=devcontainer.local_folder=c:\Dev\kilocode" --format "{{.ID}}" | Select-Object -First 1)
```

### Common Causes

- WSL/Wayland socket conflicts (✅ fixed)
- Insufficient Docker resources
- Corrupted Docker cache (✅ cleaned)
- Port conflicts (3000, 5173, 8080)
- Volume mount permissions

### Debug Mode

To see detailed output, use:

- VS Code Command Palette → "Dev Containers: Show Container Log"
- Or check: `%APPDATA%\Code\logs\` for extension logs
