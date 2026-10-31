// 插件（ADR 0017；docs/subsystems/hooks.md 与 mcp.md 的插件来源）的应用服务：安装、批准、启停、更新、卸载与贡献快照。
// 当前只有空实现：没有已安装的插件，贡献为空（测试构建可由 COKO_TEST_PLUGINS 提供一个已批准的插件，见 adapters/plugin-test-port.ts）。
import { emptyPluginContributions, type PluginContributionsPort, type PluginContributionsSnapshot } from '@coko/agent'
import type { PluginInfo } from '@coko/protocol'
import { AppError } from './errors.ts'

export interface PluginServiceOptions {
  /** 贡献的来源；缺省为空（没有插件）。 */
  contributions?: PluginContributionsPort
}

export class PluginService implements PluginContributionsPort {
  readonly #contributions: PluginContributionsPort | undefined
  readonly #listeners = new Set<() => void>()

  constructor(options: PluginServiceOptions = {}) {
    this.#contributions = options.contributions
  }

  /** GET /api/plugins。 */
  async list(): Promise<PluginInfo[]> {
    return []
  }

  /** 安装、批准、启停、更新与卸载尚未接入：501 not-implemented。 */
  notImplemented(): never {
    throw new AppError('not-implemented', 'Plugin management is not available yet')
  }

  snapshot(): Promise<PluginContributionsSnapshot> {
    return this.#contributions ? this.#contributions.snapshot() : Promise.resolve(emptyPluginContributions())
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener)
    const inner = this.#contributions?.onChange(listener)
    return () => {
      this.#listeners.delete(listener)
      inner?.()
    }
  }
}
