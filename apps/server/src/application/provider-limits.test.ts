// 模型服务的共享限制各只有一个来源：http(s) 地址判定 isHttpUrl、Key 长度上限 MAX_CREDENTIAL_LENGTH 与获取模型时限
// PROVIDER_MODELS_TIMEOUT_MS 在 @coko/protocol。agent 不依赖 protocol，保留自己的 isHttpUrl（模型配置与模型列表共用），这里比对两者一致；
// 其余处从 protocol 导入，源码中不再出现同一判定或常量的字面副本。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isHttpUrl as agentIsHttpUrl } from '@coko/agent'
import { isHttpUrl, MAX_CREDENTIAL_LENGTH, PROVIDER_MODELS_TIMEOUT_MS } from '@coko/protocol'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

describe('模型服务的共享限制', () => {
  it('agent 与 protocol 的 http(s) 地址判定一致', () => {
    const cases = [
      'https://gateway.example/v1',
      'http://127.0.0.1:9/v1',
      'HTTPS://GATEWAY.EXAMPLE',
      'ftp://gateway.example',
      'gateway.example/v1',
      'not a url',
      '',
      'file:///etc',
    ]
    expect(cases.map(agentIsHttpUrl)).toEqual(cases.map(isHttpUrl))
    expect(cases.map(isHttpUrl)).toEqual([true, true, true, false, false, false, false, false])
  })

  it('规格中的数值：Key 至多 4096 个字符，获取模型 15 秒时限', () => {
    expect(MAX_CREDENTIAL_LENGTH).toBe(4096)
    expect(PROVIDER_MODELS_TIMEOUT_MS).toBe(15_000)
  })

  it('其余处不再复制判定或常量', () => {
    const files = [
      '../../../desktop/src/main/credentials.ts',
      '../../../desktop/src/main/provider-models.ts',
      '../../../desktop/src/renderer/features/settings/provider-draft.ts',
      './provider-models.ts',
      '../../../../packages/agent/src/models/registry.ts',
      '../../../../packages/agent/src/models/list-models.ts',
    ]
    for (const file of files) {
      const text = read(file)
      expect({ file, copies: ["'http:'", '4096', '15_000'].filter((literal) => text.includes(literal)) }).toEqual({ file, copies: [] })
    }
  })
})
