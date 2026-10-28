import { SETTING_KEY_PATTERN, type Setting } from '@coko/protocol'
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
    return this.#store.settings.set(key, value as JsonValue, expectedRevision)
  }
}
