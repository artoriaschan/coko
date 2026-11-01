// 插件（ADR 0017）：清单解析、诊断与 digest（manifest.ts）、贡献名字（contributions.ts）、安装复制（copy.ts）与消费 seam 的类型（types.ts）。
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
export {
  canonicalJson,
  engineSatisfied,
  loadPlugin,
  PLUGIN_MANIFEST_PATHS,
  type LoadedPlugin,
  type LoadPluginOptions,
  type PluginExecutableSummary,
} from './manifest.ts'
export { listPluginContributions, type PluginContributionList } from './contributions.ts'
export { copyPluginTree, PLUGIN_LIMITS, type PluginCopyResult } from './copy.ts'
