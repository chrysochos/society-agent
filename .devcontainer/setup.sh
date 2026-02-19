#!/bin/bash
# Post-create setup script for Society Agent devcontainer
# This runs after the container is created, ensuring all dependencies persist

set -e

echo "🔧 Installing system dependencies..."

# Update package lists
sudo apt-get update

# Build tools for native npm modules (node-pty, etc.)
sudo apt-get install -y build-essential python3 make g++

# Git and common utilities (usually present, but ensure)
sudo apt-get install -y git curl wget jq

# Network utilities
sudo apt-get install -y iputils-ping net-tools dnsutils

# Python pip for installing Python packages
sudo apt-get install -y python3-pip python3-venv

# LaTeX for document generation
sudo apt-get install -y texlive-latex-base texlive-latex-extra texlive-pictures texlive-fonts-extra texlive-fonts-recommended latexmk

# Clean up apt cache to reduce container size
sudo apt-get clean
sudo rm -rf /var/lib/apt/lists/*

echo "📦 Installing npm dependencies..."
npm install

echo "✅ Setup complete!"
