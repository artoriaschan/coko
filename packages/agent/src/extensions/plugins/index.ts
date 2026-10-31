// 插件（ADR 0017）：清单解析、诊断与 digest 由插件核心补全；这里先导出消费 seam 的类型。
export {
  emptyPluginContributions,
  pluginMcpServerName,
  pluginResourceName,
  type PluginContributionsPort,
  type PluginContributionsSnapshot,
  type PluginHookConfig,
  type PluginLspServer,
  type PluginMcpServer,
  type PluginRoot,
} from './types.ts'
