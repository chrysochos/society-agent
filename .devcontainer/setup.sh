#!/bin/bash
# Post-create setup script for Society Agent
# Most dependencies are already in the Dockerfile image
# This script handles runtime setup only

set -e

echo "🔧 Installing network utilities and editors..."
apt-get update && apt-get install -y lsof iproute2 nano vim less

echo "🔧 Configuring git safe directory..."
git config --global --add safe.directory /home/john/projects/society-agent

echo "📦 Installing npm dependencies..."
npm install

echo "🎭 Ensuring Playwright browsers are installed..."
npx -y playwright install chromium

echo "🔌 Installing VS Code extensions..."
code --install-extension qwtel.sqlite-viewer || true

echo "✅ Setup complete!"
