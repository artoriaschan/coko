import { isConfigSettingKey, isHooksSettingKey, isMcpSettingKey, isPermissionSettingKey, SETTING_KEY_PATTERN, type Setting } from '@coko/protocol'
import type { JsonValue, SessionStore } from '@coko/session'
import { AppError } from './errors.ts'

const KEY = new RegExp(SETTING_KEY_PATTERN)

/** 键值 JSON 设置，每个键独立 revision，乐观并发。 */
export class SettingsService {
  readonly #store: SessionStore

  constructor(store: SessionStore) {
    this.#store = store
  }

  list(): Promise<Setting[]> {
    return this.#store.settings.list()
  }

  async put(key: string, value: unknown, expectedRevision: number): Promise<Setting> {
    if (!KEY.test(key)) throw new AppError('bad-request', `Invalid setting key: ${key}`)
    if (value === undefined) throw new AppError('bad-request', 'value is required')
    // 权限设置有 schema 与重新判定，只能经 /api/permissions 修改。
    if (isPermissionSettingKey(key)) throw new AppError('bad-request', `Setting ${key} can only be changed through /api/permissions`)
    // 能力配置有 schema 与合并，只能经 /api/config 修改。
    if (isConfigSettingKey(key)) throw new AppError('bad-request', `Setting ${key} can only be changed through /api/config`)
    // MCP 配置与批准有校验、批准摘要与连接管理，只能经 /api/mcp 修改（ADR 0008）。
    if (isMcpSettingKey(key)) throw new AppError('bad-request', `Setting ${key} can only be changed through /api/mcp`)
    // Hook 的配置与项目 Hook 的批准有校验与批准摘要，只能经 /api/hooks 修改（ADR 0013）。
    if (isHooksSettingKey(key)) throw new AppError('bad-request', `Setting ${key} can only be changed through /api/hooks`)
    return this.#store.settings.set(key, value as JsonValue, expectedRevision)
  }
}
