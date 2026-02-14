// kilocode_change - new file
/**
 * Society Agent Framework
 *
 * Core module for multi-agent collaboration and coordination.
 */

// Core types, configuration, and logging
export * from "./types"
export * from "./config"
export * from "./logger"

// kilocode_change start - Export key public APIs
export { AgentIdentityManager, type SignedMessage, type AttachmentRef } from "./agent-identity"
export { UnifiedMessageHandler, type MessageHandlerOptions } from "./message-handler"
export { AgentRegistry, type AgentMessage } from "./agent-registry"
export { SocietyManager, type SocietyManagerConfig } from "./society-manager"
export { SupervisorAgent, type SupervisorConfig, type Purpose } from "./supervisor-agent"
export { PurposeAnalyzer, type PurposeContext } from "./purpose-analyzer"
export { AgentTeam } from "./agent-team"
export { MessageSender } from "./message-sender"
export { InboxPoller } from "./inbox-poller"
export { PortManager } from "./port-manager"
export { commandExecutor } from "./command-executor"
// kilocode_change end
