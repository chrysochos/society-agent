#!/usr/bin/env node
// kilocode_change - new file

/**
 * Setup Multi-VS Code Society Agent
 *
 * This script helps configure multiple VS Code instances for Society Agent coordination.
 *
 * Usage:
 *   node scripts/setup-multi-vscode.js /path/to/project
 *
 * What it does:
 * 1. Creates shared .society-agent/ directory
 * 2. Configures workspaces for supervisor and workers
 * 3. Generates unique agent IDs
 * 4. Creates launch scripts for each VS Code instance
 */

const fs = require("fs")
const path = require("path")
const { execSync } = require("child_process")

// Configuration
const PROJECT_ROOT = process.argv[2] || process.cwd()
const SHARED_DIR = path.join(PROJECT_ROOT, ".society-agent")

const AGENT_CONFIGS = [
	{
		name: "supervisor",
		role: "supervisor",
		workspace: PROJECT_ROOT,
		capabilities: ["coordination", "planning", "synthesis"],
	},
	{
		name: "backend-worker",
		role: "backend-developer",
		workspace: path.join(PROJECT_ROOT, "backend"),
		capabilities: ["api", "database", "server"],
	},
	{
		name: "frontend-worker",
		role: "frontend-developer",
		workspace: path.join(PROJECT_ROOT, "frontend"),
		capabilities: ["ui", "react", "components"],
	},
	{
		name: "test-worker",
		role: "tester",
		workspace: path.join(PROJECT_ROOT, "tests"),
		capabilities: ["testing", "quality-assurance"],
	},
]

console.log("🚀 Setting up Multi-VS Code Society Agent\n")
console.log(`Project: ${PROJECT_ROOT}`)
console.log(`Shared Directory: ${SHARED_DIR}\n`)

// 1. Create shared directory
console.log("📁 Creating shared coordination directory...")
if (!fs.existsSync(SHARED_DIR)) {
	fs.mkdirSync(SHARED_DIR, { recursive: true })
	console.log(`   ✓ Created ${SHARED_DIR}`)
} else {
	console.log(`   ✓ Directory already exists`)
}

// Initialize empty files
const files = ["registry.jsonl", "messages.jsonl", "tasks.jsonl", "deliveries.jsonl"]
for (const file of files) {
	const filePath = path.join(SHARED_DIR, file)
	if (!fs.existsSync(filePath)) {
		fs.writeFileSync(filePath, "")
		console.log(`   ✓ Created ${file}`)
	}
}

// 2. Create workspace configurations
console.log("\n📋 Configuring workspaces...")
for (const config of AGENT_CONFIGS) {
	// Create workspace directory if it doesn't exist
	if (!fs.existsSync(config.workspace)) {
		fs.mkdirSync(config.workspace, { recursive: true })
	}

	// Create .vscode directory
	const vscodeDir = path.join(config.workspace, ".vscode")
	if (!fs.existsSync(vscodeDir)) {
		fs.mkdirSync(vscodeDir, { recursive: true })
	}

	// Generate unique agent ID
	const agentId = `${config.role}-${Math.random().toString(36).substring(2, 8)}`

	// Create settings.json
	const settings = {
		"kilo-code.societyAgent.agentId": agentId,
		"kilo-code.societyAgent.role": config.role,
		"kilo-code.societyAgent.sharedDir": SHARED_DIR,
		"kilo-code.societyAgent.capabilities": config.capabilities,
		"kilo-code.societyAgent.workingDirectory": config.workspace,
	}

	const settingsPath = path.join(vscodeDir, "settings.json")
	let existingSettings = {}
	if (fs.existsSync(settingsPath)) {
		existingSettings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"))
	}

	// Merge with existing settings
	const mergedSettings = { ...existingSettings, ...settings }
	fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2))

	console.log(`   ✓ ${config.name}: ${agentId} at ${config.workspace}`)
}

// 3. Create launch scripts
console.log("\n🚀 Creating launch scripts...")

const launchScriptsDir = path.join(PROJECT_ROOT, ".society-agent", "launch-scripts")
if (!fs.existsSync(launchScriptsDir)) {
	fs.mkdirSync(launchScriptsDir, { recursive: true })
}

// Create individual launch scripts for each agent
for (const config of AGENT_CONFIGS) {
	const scriptName = `launch-${config.name}.sh`
	const scriptPath = path.join(launchScriptsDir, scriptName)

	const scriptContent = `#!/bin/bash
# Launch ${config.name} VS Code instance
# Agent: ${config.role}
# Workspace: ${config.workspace}

echo "🚀 Launching ${config.name} (${config.role})"
echo "Workspace: ${config.workspace}"
echo "Shared Dir: ${SHARED_DIR}"
echo ""

# Open VS Code with this workspace
code "${config.workspace}"

echo "✓ ${config.name} launched"
echo "Check VS Code notifications for Society Agent status"
`

	fs.writeFileSync(scriptPath, scriptContent)
	fs.chmodSync(scriptPath, 0o755)
	console.log(`   ✓ Created ${scriptName}`)
}

// Create master launch script
const masterScript = `#!/bin/bash
# Launch all Society Agent VS Code instances

echo "🚀 Launching Multi-VS Code Society Agent Team"
echo ""

${AGENT_CONFIGS.map(
	(config) => `
echo "Starting ${config.name}..."
code "${config.workspace}" &
sleep 2
`,
).join("")}

echo ""
echo "✓ All agents launched!"
echo ""
echo "VS Code instances opened:"
${AGENT_CONFIGS.map((config) => `echo "  - ${config.name}: ${config.workspace}"`).join("\n")}
echo ""
echo "Shared coordination: ${SHARED_DIR}"
echo ""
echo "To verify agents are connected, check:"
echo "  cat ${SHARED_DIR}/registry.jsonl"
echo ""
`

const masterScriptPath = path.join(launchScriptsDir, "launch-all.sh")
fs.writeFileSync(masterScriptPath, masterScript)
fs.chmodSync(masterScriptPath, 0o755)
console.log(`   ✓ Created launch-all.sh (master script)`)

// 4. Create README
const readme = `# Multi-VS Code Society Agent Setup

## Configuration Complete! ✓

Your project is now configured for multi-VS Code Society Agent coordination.

## Agent Configuration

${AGENT_CONFIGS.map(
	(config, idx) => `
### ${idx + 1}. ${config.name}
- **Role**: ${config.role}
- **Workspace**: ${config.workspace}
- **Capabilities**: ${config.capabilities.join(", ")}
`,
).join("")}

## Shared Coordination

All agents communicate through: **${SHARED_DIR}**

Files:
- \`registry.jsonl\` - Agent registration and heartbeats
- \`messages.jsonl\` - Inter-agent messages
- \`tasks.jsonl\` - Shared task list
- \`deliveries.jsonl\` - Message delivery tracking

## How to Launch

### Option 1: Launch All Agents
\`\`\`bash
${launchScriptsDir}/launch-all.sh
\`\`\`

### Option 2: Launch Individual Agents
\`\`\`bash
${launchScriptsDir}/launch-supervisor.sh
${launchScriptsDir}/launch-backend-worker.sh
${launchScriptsDir}/launch-frontend-worker.sh
${launchScriptsDir}/launch-test-worker.sh
\`\`\`

### Option 3: Manual Launch
1. Open VS Code
2. File → Open Folder → Select agent's workspace
3. Extension will auto-detect configuration from .vscode/settings.json
4. Check notifications for "Society Agent active: [role]"

## Verify Setup

### Check registered agents:
\`\`\`bash
cat ${SHARED_DIR}/registry.jsonl | jq -s 'group_by(.agentId) | map(.[0])'
\`\`\`

### Monitor messages:
\`\`\`bash
tail -f ${SHARED_DIR}/messages.jsonl
\`\`\`

### Watch task list:
\`\`\`bash
tail -f ${SHARED_DIR}/tasks.jsonl
\`\`\`

## Agent Lifecycle

### When Agent Starts:
1. Reads configuration from .vscode/settings.json
2. Registers in registry.jsonl with heartbeat
3. Catches up on missed messages (while offline)
4. Starts watching for new messages

### Heartbeat:
- Every 30 seconds, agent updates registry.jsonl
- Other agents consider you online if heartbeat < 2 minutes old

### When Agent Stops:
- Marks status as "offline" in registry.jsonl
- Messages sent while offline are queued
- On next start, processes all undelivered messages

## Offline/Sleeping Agents

**Agents can be offline!** This is a feature, not a bug.

- Messages sent to offline agents are queued
- When agent wakes up, it calls \`catchUp()\` to process missed messages
- Supervisor can route work to online agents only
- No loss of coordination

## Testing the Setup

### 1. Launch Supervisor
\`\`\`bash
${launchScriptsDir}/launch-supervisor.sh
\`\`\`

Wait for notification: "Society Agent active: supervisor"

### 2. Launch a Worker
\`\`\`bash
${launchScriptsDir}/launch-backend-worker.sh
\`\`\`

### 3. Check Registry
\`\`\`bash
cat ${SHARED_DIR}/registry.jsonl
\`\`\`

Should show 2 agents with recent heartbeats.

### 4. Send a Test Message
From supervisor VS Code, open command palette:
- "Society Agent: Send Message"
- Select recipient
- Send test message

Check worker VS Code for notification.

## Troubleshooting

### Agent Not Appearing in Registry
- Check .vscode/settings.json has correct sharedDir
- Ensure sharedDir path is accessible
- Check VS Code Output panel → "Kilo-Code" for errors

### Messages Not Being Received
- Verify both agents have same sharedDir
- Check file permissions on .society-agent/
- Monitor messages.jsonl to see if messages are being written

### Heartbeat Not Updating
- Agent may be hung or crashed
- Check VS Code Developer Tools → Console for errors
- Restart VS Code instance

## Next Steps

1. Start all agents: \`${launchScriptsDir}/launch-all.sh\`
2. Open Society Agent dashboard in supervisor
3. Assign a purpose
4. Watch agents coordinate!

---

**Setup Date**: ${new Date().toISOString()}
**Project**: ${PROJECT_ROOT}
**Shared Dir**: ${SHARED_DIR}
`

const readmePath = path.join(SHARED_DIR, "README.md")
fs.writeFileSync(readmePath, readme)
console.log(`   ✓ Created README.md`)

// 5. Summary
console.log("\n✅ Setup Complete!\n")
console.log("Next steps:")
console.log(`  1. Review configuration: ${SHARED_DIR}/README.md`)
console.log(`  2. Launch all agents: ${launchScriptsDir}/launch-all.sh`)
console.log(`  3. Open supervisor VS Code and start a purpose\n`)
console.log("Happy coding with your agent team! 🤖🤖🤖\n")
