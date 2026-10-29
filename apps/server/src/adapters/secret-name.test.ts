// Secret 名的形状只有一个来源（ADR 0007）：@coko/protocol 的 SECRET_NAME_PATTERN。agent 不依赖 protocol，保留自己的常量，这里比对两者一致；
// 其余处（控制消息 schema、Sidecar 的来源、desktop main）从 protocol 导入，源码中不再出现同一正则的字面副本。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SECRET_NAME } from '@coko/agent'
import { SECRET_NAME_PATTERN } from '@coko/protocol'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

describe('Secret 名的形状', () => {
  it('agent 的 SECRET_NAME 与 protocol 的 SECRET_NAME_PATTERN 相同', () => {
    expect(SECRET_NAME.source).toBe(SECRET_NAME_PATTERN)
  })

  it('其余处不再复制正则字面量', () => {
    for (const file of ['../../../../packages/protocol/src/control.ts', './credentials.ts', '../../../desktop/src/main/secrets.ts'])
      expect({ file, copies: read(file).includes('[A-Z][A-Z0-9_]{0,63}') }).toEqual({ file, copies: false })
  })
})
