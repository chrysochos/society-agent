# kilocode_change - Windows PowerShell script to start dev container
# This bypasses VS Code's WSL auto-detection issues

Write-Host "🐳 Starting Kilo Code development container..." -ForegroundColor Cyan

# Ensure we're in the workspace root (parent of .devcontainer)
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$workspaceRoot = Split-Path -Parent $scriptPath
Set-Location $workspaceRoot
Write-Host "📁 Workspace: $workspaceRoot" -ForegroundColor Gray

# Stop any existing container
Write-Host "🧹 Cleaning up existing containers..." -ForegroundColor Yellow
docker stop kilocode-dev 2>$null
docker rm kilocode-dev 2>$null

# Build the image if needed
Write-Host "📦 Building container image..." -ForegroundColor Yellow
docker build -t kilocode-dev:latest -f .devcontainer/Dockerfile .

# Start the container
Write-Host "🚀 Starting container..." -ForegroundColor Yellow
# Convert Windows path to format Docker likes
$workspaceDir = $workspaceRoot.Replace('\', '/')
if ($workspaceDir -match '^([A-Z]):') {
    $drive = $matches[1].ToLower()
    $workspaceDir = "/${drive}" + $workspaceDir.Substring(2)
}
docker run -d `
  --name kilocode-dev `
  --init `
  -v "${workspaceDir}:/workspace:cached" `
  -v kilocode-node-modules:/workspace/node_modules `
  -e DISPLAY=:99 `
  -e ELECTRON_ENABLE_LOGGING=1 `
  -e ELECTRON_DISABLE_SANDBOX=1 `
  -e WAYLAND_DISPLAY= `
  --security-opt seccomp=unconfined `
  --cap-add SYS_PTRACE `
  -p 3000:3000 `
  -p 5173:5173 `
  -p 8080:8080 `
  kilocode-dev:latest `
  sleep infinity

Write-Host ""
Write-Host "✅ Container started successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "📌 Next steps:" -ForegroundColor Cyan
Write-Host "   1. In VS Code: Press F1"
Write-Host "   2. Type: 'Dev Containers: Attach to Running Container'"
Write-Host "   3. Select: kilocode-dev"
Write-Host "   4. When prompted for folder, choose: /workspace"
Write-Host ""
Write-Host "🛠️  Or access via terminal:" -ForegroundColor Cyan
Write-Host "   docker exec -it kilocode-dev bash"
Write-Host ""
