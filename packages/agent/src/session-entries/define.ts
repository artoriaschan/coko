// 把 TypeBox schema 转成 session 的 payload 注册定义（结构上与 @coko/session 的 PayloadDefinition 相同，agent 不导入 session）。
import type { TSchema } from 'typebox'
import { Value } from 'typebox/value'

export type EntryJson = null | boolean | number | string | EntryJson[] | { [key: string]: EntryJson }

export interface EntryPayloadVersion {
  /** 合格时返回 undefined；原因只含路径与期望的类型，不含 payload 的值。 */
  check(payload: unknown): string | undefined
  migrate?(previous: EntryJson): EntryJson
}

export interface EntryPayloadDefinition {
  kind: string
  versions: readonly EntryPayloadVersion[]
}

/** 一个 payload 版本：schema 与（第 2 版起）从上一版的迁移。 */
export interface EntryVersionSpec {
  schema: TSchema
  migrate?: (previous: EntryJson) => EntryJson
}

export function definePayloads(kinds: Record<string, readonly EntryVersionSpec[]>): EntryPayloadDefinition[] {
  return Object.entries(kinds).map(([kind, versions]) => ({
    kind,
    versions: versions.map(({ schema, migrate }) => ({
      check(payload: unknown) {
        if (Value.Check(schema, payload)) return undefined
        const first = Value.Errors(schema, payload)[0]
        return first ? `${first.instancePath || '/'} ${first.message}` : 'payload does not match its schema'
      },
      ...(migrate ? { migrate } : {}),
    })),
  }))
}
