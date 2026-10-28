// 测试用 payload 注册表：不从包入口导出，供契约测试、SQLite 测试与 Electron fixture 共用（普通模块，不导入 vitest）。
import { createPayloadRegistry, type PayloadDefinition } from './payloads.ts'
import type { JsonValue } from './types.ts'

const anyJson = { check: () => undefined }

const isObject = (value: JsonValue): value is { [key: string]: JsonValue } => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * doc：v1 为 { text: string }；v2 改名为 { body: string } 且要求非空，v1 → v2 只改名，
 * 因此空文本的 v1 条目迁移后不合格。
 */
export const docPayload: PayloadDefinition = {
  kind: 'doc',
  versions: [
    {
      check: (payload) =>
        isObject(payload) && typeof payload.text === 'string' && Object.keys(payload).length === 1 ? undefined : 'expected { text: string }',
    },
    {
      check: (payload) =>
        isObject(payload) && typeof payload.body === 'string' && payload.body !== '' && Object.keys(payload).length === 1
          ? undefined
          : 'expected { body: non-empty string }',
      migrate: (previous) => ({ body: isObject(previous) ? (previous.text ?? null) : null }),
    },
  ],
}

/** 只登记 v1 的 doc：模拟升级前的程序。 */
export const docPayloadV1: PayloadDefinition = { kind: 'doc', versions: docPayload.versions.slice(0, 1) }

/** 接受任意 JSON 的通用 kind，供只关心存储语义的用例使用；assistant-message 有两个版本。 */
export const permissiveDefinitions: PayloadDefinition[] = [
  ...['user-message', 'tool-call', 'tool-result', 'note', 'k'].map((kind): PayloadDefinition => ({ kind, versions: [anyJson] })),
  { kind: 'assistant-message', versions: [anyJson, { ...anyJson, migrate: (previous) => previous }] },
]

export const TEST_PAYLOADS = createPayloadRegistry([...permissiveDefinitions, docPayload])
