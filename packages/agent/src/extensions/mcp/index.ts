// MCP（pi-mcp McpClient）：配置校验与摘要、工具命名、结果转换、连接状态机与工具适配（票 07）；资源与提示模板（票 08）。
export {
  DEFAULT_MCP_TIMEOUT_SECONDS,
  digestMcpServer,
  expandSecretRefs,
  hasPlaceholder,
  MCP_SERVER_NAME,
  parseMcpServers,
  parseProjectMcpFile,
  SECRET_NAME,
  secretRefsOf,
  transportOf,
  validateMcpServerConfig,
} from './config.ts'
export type { McpHttpServerConfig, McpServerConfig, McpServerEntry, McpServerScope, McpStdioServerConfig, McpTransportKind } from './config.ts'
export { MCP_CONNECT_TIMEOUT_MS, MCP_RECONNECT_DELAYS_MS, MCP_STDERR_TAIL_LINES, McpConnection } from './connection.ts'
export type { McpConnectionOptions, McpConnectionStatus, McpTransportHandle } from './connection.ts'
export { createMcpToolName, MAX_MCP_SERVER_NAME_LENGTH, MAX_MCP_TOOL_NAME_LENGTH, mcpNamespace, serverNamesConflict } from './naming.ts'
export { convertMcpResult } from './results.ts'
export type { McpToolDetails } from './results.ts'
export { createMcpTools, toParameters } from './tool.ts'
