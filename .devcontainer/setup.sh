#!/bin/bash
# Post-create setup script for Society Agent
# Most dependencies are already in the Dockerfile image
# This script handles runtime setup only

set -e

echo "🔧 Installing network utilities and editors..."
apt-get update && apt-get install -y lsof iproute2 nano vim less

echo "🔧 Configuring nano key bindings for browser terminals..."
# In a browser terminal, Ctrl+W closes the tab (browser intercepts it before nano).
# Remap nano search to Ctrl+F which the browser CAN be told to suppress.
cat > /root/.nanorc << 'EOF'
# Browser-friendly nano bindings
# Ctrl+W is stolen by the browser (cannot be blocked in Chrome/Firefox).
# Use Ctrl+F instead for search - it works the same way.
bind ^F whereis all
EOF
# Also apply for any project users
mkdir -p /home/john && cp /root/.nanorc /home/john/.nanorc 2>/dev/null || true

echo "🔧 Configuring git safe directory..."
git config --global --add safe.directory /home/john/projects/society-agent

echo "📦 Installing npm dependencies..."
npm install

echo "🎭 Ensuring Playwright browsers are installed..."
npx -y playwright install chromium

echo "🔌 Installing VS Code extensions..."
code --install-extension qwtel.sqlite-viewer || true

echo "✅ Setup complete!"
