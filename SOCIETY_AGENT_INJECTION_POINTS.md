# KiloCode Injection Points - Society Agent Analysis

**Part 4 of 5**: Critical middleware injection points with code examples

---

## Overview

This document identifies **8 critical injection points** where middleware can be inserted to transform KiloCode into a Society Agent system. Each injection point includes:

- File location and line numbers (approximate)
- Current implementation
- Proposed middleware wrapper
- Society Agent capabilities enabled

---

## Injection Point 1: CLI Entry - Configuration & Identity

**Location**: `cli/src/index.ts` (lines 50-150)  
**Current Flow**: Parse arguments → Validate workspace → Create CLI instance  
**Injection Purpose**: Early input validation, multi-agent configuration loading, identity setup

### Current Implementation

```typescript
// cli/src/index.ts
program
  .command('start')
  .description('Start a new task')
  .argument('[task]', 'The task to execute')
  .option('--workspace <path>', 'Workspace directory')
  .option('--api-provider <provider>', 'API provider')
  .option('--model <model>', 'Model to use')
  .action(async (task, options) => {
    // Validate workspace
    const workspace = options.workspace || process.cwd()
    if (!fs.existsSync(workspace)) {
      console.error('Workspace not found')
      process.exit(1)
    }
    
    // Load config
    const config = await loadConfig(workspace)
    
    // Create CLI instance
    const cli = new CLI({ workspace, config, task })
    await cli.start()
  })
```

### Proposed Society Agent Middleware

```typescript
// cli/src/index.ts
import { SocietyAgentConfig } from './services/society-agent'

program
  .command('start')
  .description('Start a new task')
  .argument('[task]', 'The task to execute')
  .option('--workspace <path>', 'Workspace directory')
  .option('--api-provider <provider>', 'API provider')
  .option('--model <model>', 'Model to use')
  .option('--agent-id <id>', 'Agent identity (for multi-agent scenarios)') // kilocode_change
  .option('--supervisor-mode', 'Run as supervisor agent') // kilocode_change
  .option('--society-config <path>', 'Society agent configuration file') // kilocode_change
  .action(async (task, options) => {
    // kilocode_change start
    // Load society agent configuration
    const societyConfig = await SocietyAgentConfig.load(
      options.societyConfig || '.kilo/society.json'
    )
    
    // Determine agent identity
    const agentIdentity = options.agentId || societyConfig.defaultAgent || {
      id: 'default-agent',
      role: 'worker',
      capabilities: ['code', 'test', 'documentation']
    }
    
    // Validate agent permissions for task
    if (!societyConfig.canAgentExecuteTask(agentIdentity, task)) {
      console.error(`Agent ${agentIdentity.id} not authorized for this task`)
      process.exit(1)
    }
    
    // Setup supervisor communication if needed
    let supervisorChannel = null
    if (societyConfig.requiresSupervisor(task)) {
      supervisorChannel = await SocietyAgentConfig.connectToSupervisor(
        societyConfig.supervisorEndpoint
      )
    }
    // kilocode_change end
    
    // Validate workspace
    const workspace = options.workspace || process.cwd()
    if (!fs.existsSync(workspace)) {
      console.error('Workspace not found')
      process.exit(1)
    }
    
    // Load config
    const config = await loadConfig(workspace)
    
    // kilocode_change start
    // Inject society config into main config
    config.society = {
      agentIdentity,
      supervisorChannel,
      config: societyConfig
    }
    // kilocode_change end
    
    // Create CLI instance
    const cli = new CLI({ workspace, config, task })
    await cli.start()
  })
```

**Capabilities Enabled**:
- Multi-agent identity management
- Supervisor mode detection
- Permission validation before task start
- Supervisor channel initialization

---

## Injection Point 2: CLI Identity Service - Agent Tracking

**Location**: `cli/src/services/identity.ts` (lines 20-80)  
**Current Flow**: Track user identity for telemetry  
**Injection Purpose**: Extend to track agent identity, role, and capabilities

### Current Implementation

```typescript
// cli/src/services/identity.ts
export class IdentityService {
  private userId: string
  private userName: string
  
  constructor() {
    this.userId = this.loadOrCreateUserId()
    this.userName = os.userInfo().username
  }
  
  getUserIdentity() {
    return {
      userId: this.userId,
      userName: this.userName
    }
  }
  
  private loadOrCreateUserId(): string {
    const idFile = path.join(os.homedir(), '.kilo', 'user-id')
    if (fs.existsSync(idFile)) {
      return fs.readFileSync(idFile, 'utf-8').trim()
    }
    const newId = uuidv4()
    fs.writeFileSync(idFile, newId)
    return newId
  }
}
```

### Proposed Society Agent Middleware

```typescript
// cli/src/services/identity.ts
// kilocode_change start
export interface AgentIdentity {
  id: string
  role: 'worker' | 'supervisor' | 'coordinator'
  capabilities: string[]
  parentAgentId?: string
  teamId?: string
}

export interface UserIdentity {
  userId: string
  userName: string
}
// kilocode_change end

export class IdentityService {
  private userId: string
  private userName: string
  private agentIdentity?: AgentIdentity // kilocode_change
  
  constructor(agentConfig?: AgentIdentity) { // kilocode_change
    this.userId = this.loadOrCreateUserId()
    this.userName = os.userInfo().username
    this.agentIdentity = agentConfig // kilocode_change
  }
  
  getUserIdentity(): UserIdentity { // kilocode_change
    return {
      userId: this.userId,
      userName: this.userName
    }
  }
  
  // kilocode_change start
  getAgentIdentity(): AgentIdentity | undefined {
    return this.agentIdentity
  }
  
  getFullIdentity() {
    return {
      user: this.getUserIdentity(),
      agent: this.agentIdentity
    }
  }
  
  isAgentMode(): boolean {
    return !!this.agentIdentity
  }
  
  isSupervisor(): boolean {
    return this.agentIdentity?.role === 'supervisor'
  }
  
  canExecuteCapability(capability: string): boolean {
    if (!this.agentIdentity) return true // No restrictions in user mode
    return this.agentIdentity.capabilities.includes(capability)
  }
  // kilocode_change end
  
  private loadOrCreateUserId(): string {
    const idFile = path.join(os.homedir(), '.kilo', 'user-id')
    if (fs.existsSync(idFile)) {
      return fs.readFileSync(idFile, 'utf-8').trim()
    }
    const newId = uuidv4()
    fs.writeFileSync(idFile, newId)
    return newId
  }
}
```

**Capabilities Enabled**:
- Agent identity tracking alongside user identity
- Role-based capability checking
- Supervisor detection
- Team/hierarchy tracking

---

## Injection Point 3: Extension Message Handler - Inter-Agent Communication

**Location**: `src/core/webview/ClineProvider.ts` (lines 500-700)  
**Current Flow**: Handle webview messages from user  
**Injection Purpose**: Add agent-to-agent messaging, supervisor requests

### Current Implementation

```typescript
// src/core/webview/ClineProvider.ts
private async handleWebviewMessage(message: WebviewMessage) {
  switch (message.type) {
    case 'newTask':
      await this.initClineWithTask(message.text)
      break
    case 'askResponse':
      this.currentTask?.handleAskResponse(message.response)
      break
    case 'clearHistory':
      await this.clearHistory()
      break
    // ... more cases
  }
}
```

### Proposed Society Agent Middleware

```typescript
// src/core/webview/ClineProvider.ts
// kilocode_change start
interface AgentMessage {
  type: 'agent_request' | 'agent_response' | 'supervisor_approval'
  fromAgentId: string
  toAgentId?: string
  messageId: string
  payload: any
}
// kilocode_change end

private async handleWebviewMessage(message: WebviewMessage) {
  // kilocode_change start
  // Check if this is an agent-to-agent message
  if (message.type === 'agentMessage') {
    return await this.handleAgentMessage(message as AgentMessage)
  }
  
  // Check if this is a supervisor request
  if (message.type === 'supervisorRequest') {
    return await this.forwardToSupervisor(message)
  }
  // kilocode_change end
  
  switch (message.type) {
    case 'newTask':
      await this.initClineWithTask(message.text)
      break
    case 'askResponse':
      this.currentTask?.handleAskResponse(message.response)
      break
    case 'clearHistory':
      await this.clearHistory()
      break
    // ... more cases
  }
}

// kilocode_change start
private async handleAgentMessage(message: AgentMessage) {
  const { type, fromAgentId, toAgentId, messageId, payload } = message
  
  // Log agent communication
  this.telemetry?.logAgentCommunication({
    from: fromAgentId,
    to: toAgentId || 'broadcast',
    type,
    messageId
  })
  
  switch (type) {
    case 'agent_request':
      // Another agent is requesting this agent to perform a task
      if (toAgentId === this.getAgentId()) {
        await this.initClineWithTask(payload.task, {
          requestedBy: fromAgentId,
          requestId: messageId
        })
      }
      break
      
    case 'agent_response':
      // Another agent is responding to this agent's request
      if (toAgentId === this.getAgentId()) {
        this.currentTask?.handleAgentResponse(fromAgentId, payload)
      }
      break
      
    case 'supervisor_approval':
      // Supervisor is approving/rejecting a pending action
      if (toAgentId === this.getAgentId()) {
        this.currentTask?.handleSupervisorApproval(payload.approved, payload.reason)
      }
      break
  }
}

private async forwardToSupervisor(request: any) {
  const supervisorChannel = this.societyConfig?.supervisorChannel
  if (!supervisorChannel) {
    throw new Error('No supervisor channel configured')
  }
  
  await supervisorChannel.send({
    type: 'approval_request',
    fromAgentId: this.getAgentId(),
    action: request.action,
    context: request.context
  })
  
  // Wait for supervisor response
  return await supervisorChannel.waitForResponse(request.requestId)
}

private getAgentId(): string {
  return this.identityService?.getAgentIdentity()?.id || 'default-agent'
}
// kilocode_change end
```

**Capabilities Enabled**:
- Agent-to-agent direct messaging
- Supervisor approval requests
- Broadcast messages to all agents
- Communication logging for audit

---

## Injection Point 4: Task Creation - Context Injection

**Location**: `src/core/webview/ClineProvider.ts` (lines 800-900, `initClineWithTask()`)  
**Current Flow**: Create Task instance with user context  
**Injection Purpose**: Inject agent identity, supervisor channel, communication handlers

### Current Implementation

```typescript
// src/core/webview/ClineProvider.ts
private async initClineWithTask(task: string) {
  this.currentTask = new Task({
    taskText: task,
    workspace: this.workspace,
    apiHandler: this.api,
    tools: this.availableTools,
    say: (text) => this.postMessageToWebview({ type: 'say', text }),
    ask: (question) => this.askUser(question)
  })
  
  await this.currentTask.startTask()
}
```

### Proposed Society Agent Middleware

```typescript
// src/core/webview/ClineProvider.ts
// kilocode_change start
interface TaskCreationOptions {
  requestedBy?: string
  requestId?: string
  supervisorRequired?: boolean
}
// kilocode_change end

private async initClineWithTask(
  task: string,
  options?: TaskCreationOptions // kilocode_change
) {
  // kilocode_change start
  // Prepare agent context
  const agentContext = {
    identity: this.identityService?.getAgentIdentity(),
    requestedBy: options?.requestedBy,
    requestId: options?.requestId,
    supervisorChannel: this.societyConfig?.supervisorChannel
  }
  
  // Create communication handlers
  const agentHandlers = {
    sendToAgent: async (targetAgentId: string, payload: any) => {
      await this.sendAgentMessage({
        type: 'agent_request',
        fromAgentId: agentContext.identity?.id || 'unknown',
        toAgentId: targetAgentId,
        messageId: uuidv4(),
        payload
      })
    },
    
    requestSupervisorApproval: async (action: any, context: any) => {
      if (!agentContext.supervisorChannel) {
        // No supervisor available, use default approval mechanism
        return await this.askUser(`Approve: ${action}?`)
      }
      return await this.forwardToSupervisor({
        action,
        context,
        requestId: uuidv4()
      })
    }
  }
  // kilocode_change end
  
  this.currentTask = new Task({
    taskText: task,
    workspace: this.workspace,
    apiHandler: this.api,
    tools: this.availableTools,
    say: (text) => this.postMessageToWebview({ type: 'say', text }),
    ask: (question) => this.askUser(question),
    agentContext, // kilocode_change
    agentHandlers // kilocode_change
  })
  
  await this.currentTask.startTask()
}
```

**Capabilities Enabled**:
- Agent context passed to Task
- Agent-to-agent communication handlers
- Supervisor approval integration
- Request tracking (who requested what)

---

## Injection Point 5: Agentic Loop - Primary Middleware ⭐ **MOST CRITICAL**

**Location**: `src/core/task/Task.ts` (lines 1000-1500, `recursivelyMakeClineRequests()`)  
**Current Flow**: Loop: LLM call → Tool execution → Recurse  
**Injection Purpose**: Wrap entire loop with logging, supervisor checks, agent coordination

### Current Implementation

```typescript
// src/core/task/Task.ts
private async recursivelyMakeClineRequests() {
  while (true) {
    // Call LLM
    const response = await this.api.createMessage({
      systemPrompt: this.systemPrompt,
      messages: this.conversationHistory,
      tools: this.tools
    })
    
    // Handle response
    if (response.text) {
      await this.say(response.text)
    }
    
    // Execute tools
    if (response.toolCalls) {
      for (const toolCall of response.toolCalls) {
        const result = await this.executeTool(toolCall.name, toolCall.input)
        this.toolResults.push(result)
      }
    }
    
    // Check if done
    if (response.stopReason === 'end_turn') {
      break
    }
  }
}
```

### Proposed Society Agent Middleware

```typescript
// src/core/task/Task.ts
// kilocode_change start
interface AgentLoopContext {
  agentId: string
  loopIteration: number
  taskId: string
  supervisorChannel?: any
}

private loopContext: AgentLoopContext
// kilocode_change end

private async recursivelyMakeClineRequests() {
  // kilocode_change start
  // Initialize loop context
  this.loopContext = {
    agentId: this.agentContext?.identity?.id || 'default',
    loopIteration: 0,
    taskId: this.taskId,
    supervisorChannel: this.agentContext?.supervisorChannel
  }
  // kilocode_change end
  
  while (true) {
    // kilocode_change start
    this.loopContext.loopIteration++
    
    // Log loop start
    await this.logAgentAction({
      type: 'loop_iteration_start',
      agentId: this.loopContext.agentId,
      iteration: this.loopContext.loopIteration,
      conversationLength: this.conversationHistory.length
    })
    
    // Check supervisor interrupts
    if (this.loopContext.supervisorChannel) {
      const interrupt = await this.loopContext.supervisorChannel.checkInterrupt()
      if (interrupt) {
        await this.handleSupervisorInterrupt(interrupt)
        if (interrupt.action === 'abort') break
        if (interrupt.action === 'pause') {
          await this.waitForSupervisorResume()
        }
      }
    }
    // kilocode_change end
    
    // kilocode_change start
    // Wrap LLM call with logging
    const requestStart = Date.now()
    // kilocode_change end
    
    // Call LLM
    const response = await this.api.createMessage({
      systemPrompt: this.systemPrompt,
      messages: this.conversationHistory,
      tools: this.tools
    })
    
    // kilocode_change start
    // Log LLM response
    await this.logAgentAction({
      type: 'llm_response',
      agentId: this.loopContext.agentId,
      duration: Date.now() - requestStart,
      hasText: !!response.text,
      toolCallCount: response.toolCalls?.length || 0,
      stopReason: response.stopReason,
      tokenUsage: response.usage
    })
    // kilocode_change end
    
    // Handle response
    if (response.text) {
      await this.say(response.text)
    }
    
    // Execute tools
    if (response.toolCalls) {
      for (const toolCall of response.toolCalls) {
        // kilocode_change start
        // Check if tool requires supervisor approval
        const requiresApproval = this.toolRequiresSupervisorApproval(toolCall.name)
        
        if (requiresApproval && this.loopContext.supervisorChannel) {
          const approved = await this.requestSupervisorApproval({
            tool: toolCall.name,
            parameters: toolCall.input,
            context: {
              iteration: this.loopContext.loopIteration,
              previousActions: this.toolResults.slice(-3)
            }
          })
          
          if (!approved) {
            this.toolResults.push({
              tool: toolCall.name,
              success: false,
              error: 'Supervisor denied action'
            })
            continue
          }
        }
        // kilocode_change end
        
        const result = await this.executeTool(toolCall.name, toolCall.input)
        this.toolResults.push(result)
        
        // kilocode_change start
        // Log tool execution
        await this.logAgentAction({
          type: 'tool_execution',
          agentId: this.loopContext.agentId,
          tool: toolCall.name,
          success: result.success,
          duration: result.duration
        })
        // kilocode_change end
      }
    }
    
    // kilocode_change start
    // Log loop end
    await this.logAgentAction({
      type: 'loop_iteration_end',
      agentId: this.loopContext.agentId,
      iteration: this.loopContext.loopIteration,
      toolsExecuted: response.toolCalls?.length || 0
    })
    // kilocode_change end
    
    // Check if done
    if (response.stopReason === 'end_turn') {
      break
    }
  }
  
  // kilocode_change start
  // Log task completion
  await this.logAgentAction({
    type: 'task_complete',
    agentId: this.loopContext.agentId,
    totalIterations: this.loopContext.loopIteration,
    totalTools: this.toolResults.length
  })
  // kilocode_change end
}

// kilocode_change start
private async logAgentAction(action: any) {
  // Send to telemetry
  this.telemetry?.logAgentAction(action)
  
  // Send to supervisor if connected
  if (this.loopContext.supervisorChannel) {
    await this.loopContext.supervisorChannel.sendLog(action)
  }
  
  // Save to local log file
  const logFile = path.join(this.workspace, '.kilo', 'agent-logs.jsonl')
  await fs.appendFile(logFile, JSON.stringify(action) + '\n')
}

private toolRequiresSupervisorApproval(toolName: string): boolean {
  const highRiskTools = [
    'executeCommandTool',
    'writeToFileTool',
    'useMcpToolTool'
  ]
  return highRiskTools.includes(toolName)
}

private async requestSupervisorApproval(request: any): Promise<boolean> {
  if (!this.agentHandlers?.requestSupervisorApproval) {
    // Fallback to user approval
    return await this.ask(`Approve ${request.tool}?`)
  }
  
  return await this.agentHandlers.requestSupervisorApproval(
    request.tool,
    request
  )
}
// kilocode_change end
```

**Capabilities Enabled**:
- Complete loop iteration logging
- Supervisor interrupts (pause/abort)
- Per-tool supervisor approval
- Agent action audit trail
- Performance metrics collection
- Multi-agent coordination points

---

## Injection Point 6: API Handler - Request/Response Middleware

**Location**: `src/api/index.ts` (lines 200-400, `buildApiHandler()`)  
**Current Flow**: Route to provider → Make request → Return response  
**Injection Purpose**: Log all LLM interactions, add agent identity to requests, rate limiting

### Current Implementation

```typescript
// src/api/index.ts
export function buildApiHandler(config: ApiConfiguration): ApiHandler {
  const handler = getProviderHandler(config.provider)
  
  return {
    async createMessage(request: ApiRequest): Promise<ApiResponse> {
      const response = await handler.createMessage(request, config)
      return response
    }
  }
}
```

### Proposed Society Agent Middleware

```typescript
// src/api/index.ts
// kilocode_change start
interface ApiRequestMetadata {
  agentId?: string
  taskId?: string
  requestId: string
  timestamp: number
}
// kilocode_change end

export function buildApiHandler(
  config: ApiConfiguration,
  agentContext?: any // kilocode_change
): ApiHandler {
  const handler = getProviderHandler(config.provider)
  
  // kilocode_change start
  const rateLimiter = new AgentRateLimiter(agentContext?.identity?.id)
  // kilocode_change end
  
  return {
    async createMessage(request: ApiRequest): Promise<ApiResponse> {
      // kilocode_change start
      // Add metadata
      const metadata: ApiRequestMetadata = {
        agentId: agentContext?.identity?.id,
        taskId: agentContext?.taskId,
        requestId: uuidv4(),
        timestamp: Date.now()
      }
      
      // Rate limiting per agent
      await rateLimiter.checkAndWait()
      
      // Log request
      await logApiRequest({
        ...metadata,
        provider: config.provider,
        model: config.model,
        messageCount: request.messages.length,
        toolCount: request.tools?.length || 0
      })
      
      const startTime = Date.now()
      // kilocode_change end
      
      try {
        const response = await handler.createMessage(request, config)
        
        // kilocode_change start
        // Log response
        await logApiResponse({
          ...metadata,
          duration: Date.now() - startTime,
          success: true,
          tokenUsage: response.usage,
          stopReason: response.stopReason
        })
        // kilocode_change end
        
        return response
      } catch (error) {
        // kilocode_change start
        // Log error
        await logApiResponse({
          ...metadata,
          duration: Date.now() - startTime,
          success: false,
          error: error.message
        })
        // kilocode_change end
        
        throw error
      }
    }
  }
}

// kilocode_change start
class AgentRateLimiter {
  private requestTimestamps: number[] = []
  private maxRequestsPerMinute = 60
  
  constructor(private agentId?: string) {}
  
  async checkAndWait() {
    const now = Date.now()
    const oneMinuteAgo = now - 60000
    
    // Remove old timestamps
    this.requestTimestamps = this.requestTimestamps.filter(
      ts => ts > oneMinuteAgo
    )
    
    // Check if over limit
    if (this.requestTimestamps.length >= this.maxRequestsPerMinute) {
      const oldestTimestamp = this.requestTimestamps[0]
      const waitTime = oldestTimestamp + 60000 - now
      await new Promise(resolve => setTimeout(resolve, waitTime))
    }
    
    this.requestTimestamps.push(now)
  }
}

async function logApiRequest(data: any) {
  // Log to file
  const logFile = path.join('.kilo', 'api-requests.jsonl')
  await fs.appendFile(logFile, JSON.stringify(data) + '\n')
  
  // Send to telemetry if available
  // ...
}

async function logApiResponse(data: any) {
  // Log to file
  const logFile = path.join('.kilo', 'api-responses.jsonl')
  await fs.appendFile(logFile, JSON.stringify(data) + '\n')
  
  // Send to telemetry if available
  // ...
}
// kilocode_change end
```

**Capabilities Enabled**:
- All API calls logged with agent identity
- Per-agent rate limiting
- Request/response correlation
- Performance monitoring
- Cost tracking per agent
- Audit trail for all LLM interactions

---

## Injection Point 7: Tool Execution - Permission & Logging

**Location**: `src/core/task/Task.ts` (lines 2000-2500, `executeTool()`)  
**Current Flow**: Route tool → Execute → Return result  
**Injection Purpose**: Permission checks, logging, result validation

### Current Implementation

```typescript
// src/core/task/Task.ts
private async executeTool(toolName: string, parameters: any): Promise<ToolResult> {
  switch (toolName) {
    case 'readFile':
      return await readFileTool.execute(parameters, this.context)
    case 'writeToFile':
      return await writeToFileTool.execute(parameters, this.context)
    case 'executeCommand':
      return await executeCommandTool.execute(parameters, this.context)
    // ... more tools
    default:
      throw new Error(`Unknown tool: ${toolName}`)
  }
}
```

### Proposed Society Agent Middleware

```typescript
// src/core/task/Task.ts
// kilocode_change start
interface ToolExecutionMetadata {
  agentId: string
  toolName: string
  executionId: string
  startTime: number
  approved: boolean
}
// kilocode_change end

private async executeTool(
  toolName: string,
  parameters: any
): Promise<ToolResult> {
  // kilocode_change start
  const metadata: ToolExecutionMetadata = {
    agentId: this.agentContext?.identity?.id || 'default',
    toolName,
    executionId: uuidv4(),
    startTime: Date.now(),
    approved: false
  }
  
  // Check agent capability
  if (this.agentContext?.identity) {
    const hasCapability = this.checkAgentCapability(toolName)
    if (!hasCapability) {
      return {
        success: false,
        error: `Agent ${metadata.agentId} lacks capability for ${toolName}`
      }
    }
  }
  
  // Log tool invocation
  await this.logToolExecution({
    ...metadata,
    phase: 'start',
    parameters: this.sanitizeParameters(parameters)
  })
  // kilocode_change end
  
  let result: ToolResult
  
  try {
    switch (toolName) {
      case 'readFile':
        result = await readFileTool.execute(parameters, this.context)
        break
      case 'writeToFile':
        result = await writeToFileTool.execute(parameters, this.context)
        break
      case 'executeCommand':
        result = await executeCommandTool.execute(parameters, this.context)
        break
      // ... more tools
      default:
        throw new Error(`Unknown tool: ${toolName}`)
    }
    
    // kilocode_change start
    // Log success
    await this.logToolExecution({
      ...metadata,
      phase: 'complete',
      duration: Date.now() - metadata.startTime,
      success: result.success,
      resultSize: JSON.stringify(result).length
    })
    // kilocode_change end
    
  } catch (error) {
    // kilocode_change start
    // Log error
    await this.logToolExecution({
      ...metadata,
      phase: 'error',
      duration: Date.now() - metadata.startTime,
      success: false,
      error: error.message
    })
    // kilocode_change end
    
    result = {
      success: false,
      error: error.message
    }
  }
  
  return result
}

// kilocode_change start
private checkAgentCapability(toolName: string): boolean {
  const identity = this.agentContext?.identity
  if (!identity) return true // No restrictions for non-agent mode
  
  const toolCapabilityMap: Record<string, string> = {
    'readFile': 'read',
    'writeToFile': 'write',
    'executeCommand': 'execute',
    'searchFiles': 'search',
    'listFiles': 'read',
    'useMcpTool': 'mcp',
    'browserAction': 'browser'
  }
  
  const requiredCapability = toolCapabilityMap[toolName]
  return identity.capabilities.includes(requiredCapability)
}

private sanitizeParameters(params: any): any {
  // Remove sensitive data from logs
  const sanitized = { ...params }
  if (sanitized.apiKey) sanitized.apiKey = '***'
  if (sanitized.password) sanitized.password = '***'
  return sanitized
}

private async logToolExecution(data: any) {
  // Log to file
  const logFile = path.join(this.workspace, '.kilo', 'tool-executions.jsonl')
  await fs.appendFile(logFile, JSON.stringify(data) + '\n')
  
  // Send to supervisor if connected
  if (this.loopContext?.supervisorChannel) {
    await this.loopContext.supervisorChannel.sendToolLog(data)
  }
  
  // Send to telemetry
  this.telemetry?.logToolExecution(data)
}
// kilocode_change end
```

**Capabilities Enabled**:
- Agent capability enforcement
- Complete tool execution audit trail
- Performance monitoring per tool
- Sensitive parameter sanitization
- Error tracking
- Supervisor real-time monitoring

---

## Injection Point 8: History & State - Multi-Agent Context

**Location**: `src/shared/HistoryItem.ts` (lines 1-100)  
**Current Flow**: Store conversation history per user  
**Injection Purpose**: Add agent metadata, enable agent collaboration history

### Current Implementation

```typescript
// src/shared/HistoryItem.ts
export interface HistoryItem {
  id: string
  ts: number
  task: string
  conversationHistory: Message[]
  tokenUsage: TokenUsage
  cost: number
}
```

### Proposed Society Agent Middleware

```typescript
// src/shared/HistoryItem.ts
// kilocode_change start
export interface AgentMetadata {
  agentId: string
  agentRole: 'worker' | 'supervisor' | 'coordinator'
  agentCapabilities: string[]
  parentAgentId?: string
  teamId?: string
  collaboratingAgents?: string[]
}
// kilocode_change end

export interface HistoryItem {
  id: string
  ts: number
  task: string
  conversationHistory: Message[]
  tokenUsage: TokenUsage
  cost: number
  agentMetadata?: AgentMetadata // kilocode_change
}

// kilocode_change start
export interface CollaborativeHistoryItem extends HistoryItem {
  initiatingAgentId: string
  contributingAgents: Array<{
    agentId: string
    contributionType: 'execution' | 'review' | 'approval'
    toolsUsed: string[]
    duration: number
  }>
  supervisorApprovals: Array<{
    action: string
    approved: boolean
    supervisorId: string
    timestamp: number
    reason?: string
  }>
  agentMessages: Array<{
    fromAgentId: string
    toAgentId: string
    messageType: string
    timestamp: number
  }>
}
// kilocode_change end
```

**Capabilities Enabled**:
- Track which agent performed which task
- Multi-agent collaboration history
- Supervisor approval audit trail
- Agent-to-agent communication logs
- Team performance analytics
- Capability usage tracking

---

## Summary: Injection Point Priority

### Phase 1: Foundation (Start here)
1. **Injection Point 2**: Identity Service - Agent tracking basics
2. **Injection Point 1**: CLI Entry - Configuration loading
3. **Injection Point 8**: History - Agent metadata storage

### Phase 2: Core Execution (Critical path)
4. **Injection Point 5**: Agentic Loop - PRIMARY MIDDLEWARE ⭐
5. **Injection Point 7**: Tool Execution - Permission & logging
6. **Injection Point 6**: API Handler - Request logging

### Phase 3: Communication (Multi-agent)
7. **Injection Point 3**: Message Handler - Inter-agent communication
8. **Injection Point 4**: Task Creation - Context injection

---

## Implementation Checklist

- [ ] Create `src/services/society-agent/` folder for middleware
- [ ] Implement `AgentIdentity` type system
- [ ] Create `SocietyAgentConfig` loader
- [ ] Implement `SupervisorChannel` communication protocol
- [ ] Add agent logging utilities
- [ ] Create rate limiter per agent
- [ ] Implement capability checking system
- [ ] Add agent-to-agent messaging protocol
- [ ] Update telemetry to track agent actions
- [ ] Create audit trail storage system

---

**Next**: See `SOCIETY_AGENT_MODIFICATION_PLAN.md` for implementation roadmap
