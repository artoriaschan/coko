// Payload 注册（ADR 0003）：kind → 各版本的校验函数与逐版迁移。业务含义由 agent 定义，server 装配；session 只调用注册表。
import { StoreError } from './errors.ts'
import type { JsonValue } from './types.ts'

/** 一个 payload 版本。版本号为它在 versions 中的位置 + 1。 */
export interface PayloadVersion {
  /** 合格时返回 undefined，否则返回原因。原因只描述 schema，不得包含 payload 中的值（可能含用户内容或凭据）。 */
  check(payload: JsonValue): string | undefined
  /** 从上一版本迁移到本版本；第 1 版没有。 */
  migrate?(previous: JsonValue): JsonValue
}

export interface PayloadDefinition {
  kind: string
  /** 按版本顺序排列，至少一个；最后一个是当前版本。 */
  versions: readonly PayloadVersion[]
}

export type PayloadUpgrade = { ok: true; payloadVersion: number; payload: JsonValue } | { ok: false; reason: string }

export interface PayloadRegistry {
  /** 已注册 kind 的当前版本；未注册时为 undefined。 */
  currentVersion(kind: string): number | undefined
  /** 写入前校验：kind 已注册、版本已登记、payload 合该版本的 schema。 */
  validate(kind: string, payloadVersion: number, payload: JsonValue): string | undefined
  /** 读取时逐版迁移到当前版本，并按当前版本校验。 */
  upgrade(kind: string, payloadVersion: number, payload: JsonValue): PayloadUpgrade
}

export function createPayloadRegistry(definitions: readonly PayloadDefinition[]): PayloadRegistry {
  const byKind = new Map<string, readonly PayloadVersion[]>()
  for (const definition of definitions) {
    if (byKind.has(definition.kind)) throw new Error(`payload kind "${definition.kind}" is registered twice`)
    if (definition.versions.length === 0) throw new Error(`payload kind "${definition.kind}" has no versions`)
    definition.versions.forEach((version, index) => {
      if (index > 0 && !version.migrate) throw new Error(`payload kind "${definition.kind}" version ${index + 1} has no migration`)
    })
    byKind.set(definition.kind, definition.versions)
  }

  const versionOf = (kind: string, payloadVersion: number): PayloadVersion | string => {
    const versions = byKind.get(kind)
    if (!versions) return `kind "${kind}" is not registered`
    if (!Number.isInteger(payloadVersion) || payloadVersion < 1 || payloadVersion > versions.length)
      return `kind "${kind}" has no payload version ${payloadVersion} (current ${versions.length})`
    return versions[payloadVersion - 1]!
  }

  return {
    currentVersion: (kind) => byKind.get(kind)?.length,
    validate(kind, payloadVersion, payload) {
      const version = versionOf(kind, payloadVersion)
      if (typeof version === 'string') return version
      return version.check(payload)
    },
    upgrade(kind, payloadVersion, payload) {
      const version = versionOf(kind, payloadVersion)
      if (typeof version === 'string') return { ok: false, reason: version }
      const versions = byKind.get(kind)!
      let value = payload
      try {
        for (let next = payloadVersion; next < versions.length; next++) value = versions[next]!.migrate!(value)
      } catch {
        return { ok: false, reason: `migration of kind "${kind}" from version ${payloadVersion} failed` }
      }
      const reason = versions[versions.length - 1]!.check(value)
      return reason === undefined ? { ok: true, payloadVersion: versions.length, payload: value } : { ok: false, reason }
    },
  }
}

/** appendEntries 的写入校验：整批先校验，任一不合格则以 invalid-payload 拒绝，不提交任何条目。 */
export function checkNewEntries(registry: PayloadRegistry, entries: readonly { kind: string; payloadVersion?: number; payload: JsonValue }[]): number[] {
  return entries.map((entry, index) => {
    const payloadVersion = entry.payloadVersion ?? registry.currentVersion(entry.kind) ?? 1
    const reason = registry.validate(entry.kind, payloadVersion, entry.payload)
    if (reason !== undefined)
      throw new StoreError('invalid-payload', `entry ${index} (${entry.kind} v${payloadVersion}) is invalid: ${reason}`, {
        index,
        kind: entry.kind,
        payloadVersion,
        reason,
      })
    return payloadVersion
  })
}
