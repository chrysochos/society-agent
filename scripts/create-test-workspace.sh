#!/bin/bash
# kilocode_change - new file
# Create a test workspace for Society Agent development

set -e

# Default location
DEFAULT_DIR="$HOME/kilocode-test-workspace"
TEST_DIR="${1:-$DEFAULT_DIR}"

echo "🚀 Creating test workspace at: $TEST_DIR"

# Create directory structure
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"

# Initialize package.json
cat > package.json <<EOF
{
  "name": "kilocode-test-workspace",
  "version": "1.0.0",
  "description": "Test workspace for KiloCode Society Agent development",
  "scripts": {
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "keywords": ["test", "kilocode", "society-agent"],
  "author": "",
  "license": "MIT"
}
EOF

# Create sample project structure
mkdir -p src/{components,services,utils}
mkdir -p tests
mkdir -p docs

# Create sample files
cat > src/index.ts <<EOF
// Sample TypeScript entry point
console.log("Hello from test workspace!")

export function add(a: number, b: number): number {
  return a + b
}
EOF

cat > src/utils/helpers.ts <<EOF
// Sample utility functions
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}
EOF

cat > tests/example.test.ts <<EOF
// Sample test file
import { add } from '../src/index'

describe('add', () => {
  it('should add two numbers', () => {
    expect(add(2, 3)).toBe(5)
  })
})
EOF

cat > README.md <<EOF
# KiloCode Test Workspace

This is a test workspace for developing and testing KiloCode Society Agent features.

## Purpose

Use this workspace to:
- Test Society Agent multi-agent features
- Verify extension behavior in a clean environment
- Debug integration issues

## Usage

1. Open this folder in VS Code
2. Open KiloCode extension
3. Test with prompts like:
   - "Use multiple agents to add authentication"
   - "Create a calculator with tests using sub-agents"

## Structure

\`\`\`
src/
  components/    # React/UI components
  services/      # Business logic
  utils/         # Helper functions
tests/           # Test files
docs/            # Documentation
\`\`\`

## Society Agent Testing

Try these commands in KiloCode chat:
- \`Use multiple agents to refactor this code\`
- \`Create a REST API with tests using sub-agents\`
- \`Build a form component with validation using multiple workers\`

The Society Agent dashboard will open showing agent coordination.
EOF

cat > .gitignore <<EOF
node_modules/
dist/
.DS_Store
*.log
.env
.vscode/
.society-agent/
EOF

# Create tsconfig.json
cat > tsconfig.json <<EOF
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
EOF

echo ""
echo "✅ Test workspace created successfully!"
echo ""
echo "📁 Location: $TEST_DIR"
echo ""
echo "Next steps:"
echo "  1. Open in VS Code:"
echo "     code \"$TEST_DIR\""
echo ""
echo "  2. Or update launch.json input to:"
echo "     \"default\": \"$TEST_DIR\""
echo ""
echo "  3. Press F5 to debug extension with this workspace"
echo ""
