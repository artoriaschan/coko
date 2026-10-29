import { defaultCapabilityConfig, type CapabilityConfig } from '@coko/agent'

/**
 * 有效能力配置（默认 ← 全局设置键 config ← 项目 .coko/settings.json，ADR 0008）。票 01 的桩只返回默认值；票 02 实现加载、合并、
 * 诊断与 GET / PUT /api/config。
 */
export class ConfigService {
  /** workspacePath：项目设置所在的 Workspace；省略时只有全局。 */
  async effective(_workspacePath?: string): Promise<CapabilityConfig> {
    return defaultCapabilityConfig()
  }
}
