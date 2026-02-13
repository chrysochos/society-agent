#!/usr/bin/env node
// kilocode_change - new file
/**
 * Create a test workspace for Society Agent development
 * Cross-platform Node.js version
 */

const fs = require("fs")
const path = require("path")
const os = require("os")

const DEFAULT_DIR = path.join(os.homedir(), "kilocode-test-workspace")
const testDir = process.argv[2] || DEFAULT_DIR

console.log("🚀 Creating test workspace at:", testDir)

// Create directory structure
const dirs = [
	testDir,
	path.join(testDir, "src", "components"),
	path.join(testDir, "src", "services"),
	path.join(testDir, "src", "utils"),
	path.join(testDir, "tests"),
	path.join(testDir, "docs"),
]

dirs.forEach((dir) => {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true })
	}
})

// Create files
const files = {
	"package.json": JSON.stringify(
		{
			name: "kilocode-test-workspace",
			version: "1.0.0",
			description: "Test workspace for KiloCode Society Agent development",
			scripts: {
				test: 'echo "Error: no test specified" && exit 1',
			},
			keywords: ["test", "kilocode", "society-agent"],
			author: "",
			license: "MIT",
		},
		null,
		2,
	),

	"src/index.ts": `// Sample TypeScript entry point
console.log("Hello from test workspace!")

export function add(a: number, b: number): number {
  return a + b
}
`,

	"src/utils/helpers.ts": `// Sample utility functions
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}
`,

	"tests/example.test.ts": `// Sample test file
import { add } from '../src/index'

describe('add', () => {
  it('should add two numbers', () => {
    expect(add(2, 3)).toBe(5)
  })
})
`,

	"README.md": `# KiloCode Test Workspace

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
`,

	".gitignore": `node_modules/
dist/
.DS_Store
*.log
.env
.vscode/
.society-agent/
`,

	"tsconfig.json": JSON.stringify(
		{
			compilerOptions: {
				target: "ES2020",
				module: "commonjs",
				lib: ["ES2020"],
				outDir: "./dist",
				rootDir: "./src",
				strict: true,
				esModuleInterop: true,
				skipLibCheck: true,
				forceConsistentCasingInFileNames: true,
				resolveJsonModule: true,
				declaration: true,
				declarationMap: true,
				sourceMap: true,
			},
			include: ["src/**/*"],
			exclude: ["node_modules", "dist", "tests"],
		},
		null,
		2,
	),
}

// Write all files
Object.entries(files).forEach(([filename, content]) => {
	const filepath = path.join(testDir, filename)
	fs.writeFileSync(filepath, content, "utf8")
})

console.log("")
console.log("✅ Test workspace created successfully!")
console.log("")
console.log("📁 Location:", testDir)
console.log("")
console.log("Next steps:")
console.log("  1. Open in VS Code:")
console.log(`     code "${testDir}"`)
console.log("")
console.log("  2. Or update launch.json input to:")
console.log(`     "default": "${testDir}"`)
console.log("")
console.log("  3. Press F5 to debug extension with this workspace")
console.log("")
