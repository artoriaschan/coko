// 插件消费 seam（ADR 0017）：已启用插件的贡献快照。提供方（插件的安装与批准）在 server；加载器（Skills、命令、子代理定义、Hook、MCP、
// 语言服务器）只读取快照。每个 Run 开始时读一次。

/** 插件中的一个资源目录（skills、commands 或 agents），资源以 <plugin>:<name> 登记。 */
export interface PluginRoot {
  plugin: string
  path: string
}

/** 插件的 Hook 配置（形状与设置中的 Hook 相同，${COKO_PLUGIN_ROOT} 已替换）；与全局同级参与聚合。 */
export interface PluginHookConfig {
  plugin: string
  /** 插件安装目录（hookId 与诊断用）。 */
  root: string
  hooks: Record<string, unknown>
}

/** 插件的 MCP Server：名字为 plugin-<plugin>-<server>，不经项目批准；config 为 .mcp.json 中一项的原值（已替换插件根）。 */
export interface PluginMcpServer {
  plugin: string
  name: string
  config: Record<string, unknown>
}

/** 插件的语言服务器：名字为 <plugin>:<server>。 */
export interface PluginLspServer {
  plugin: string
  name: string
  config: Record<string, unknown>
}

export interface PluginContributionsSnapshot {
  skillRoots: PluginRoot[]
  commandRoots: PluginRoot[]
  agentRoots: PluginRoot[]
  hooks: PluginHookConfig[]
  mcpServers: PluginMcpServer[]
  lspServers: PluginLspServer[]
}

export interface PluginContributionsPort {
  /** 当前已启用插件的贡献（plugins.enabled 为 false 时为空）。 */
  snapshot(): Promise<PluginContributionsSnapshot>
  /** 启用、禁用、批准、更新或卸载之后调用（MCP / LSP 据此 reconcile）；返回取消订阅。 */
  onChange(listener: () => void): () => void
}

/** 没有插件时的快照（每次返回新对象）。 */
export const emptyPluginContributions = (): PluginContributionsSnapshot => ({
  skillRoots: [],
  commandRoots: [],
  agentRoots: [],
  hooks: [],
  mcpServers: [],
  lspServers: [],
})

/** 插件资源的登记名。 */
export const pluginResourceName = (plugin: string, name: string) => `${plugin}:${name}`

/** 插件 MCP Server 的登记名。 */
export const pluginMcpServerName = (plugin: string, server: string) => `plugin-${plugin}-${server}`
