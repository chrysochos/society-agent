#!/bin/bash
# kilocode_change - Workaround script to start container manually
# This bypasses VS Code's WSL auto-detection issues

set -e

echo "🐳 Starting Kilo Code development container..."

# Stop any existing container
docker stop kilocode-dev 2>/dev/null || true
docker rm kilocode-dev 2>/dev/null || true

# Build the image if needed
echo "📦 Building container image..."
docker build -t kilocode-dev:latest -f .devcontainer/Dockerfile .

# Start the container
echo "🚀 Starting container..."
docker run -d \
  --name kilocode-dev \
  --init \
  -v "$(pwd):/workspace:cached" \
  -v kilocode-node-modules:/workspace/node_modules \
  -e DISPLAY=:99 \
  -e ELECTRON_ENABLE_LOGGING=1 \
  -e ELECTRON_DISABLE_SANDBOX=1 \
  -e WAYLAND_DISPLAY= \
  --security-opt seccomp=unconfined \
  --cap-add SYS_PTRACE \
  -p 3000:3000 \
  -p 5173:5173 \
  -p 8080:8080 \
  kilocode-dev:latest \
  sleep infinity

echo "✅ Container started!"
echo ""
echo "📌 Next steps:"
echo "   1. In VS Code: F1 → 'Dev Containers: Attach to Running Container'"
echo "   2. Select: kilocode-dev"
echo "   3. Open folder: /workspace"
echo ""
echo "🛠️  To run setup:"
echo "   docker exec -it kilocode-dev bash"
echo "   cd /workspace && pnpm install"
