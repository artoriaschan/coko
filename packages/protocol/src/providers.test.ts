import { Value } from 'typebox/value'
import { describe, expect, it } from 'vitest'
import { CatalogModel, MODEL_CATALOG_DEFAULTS, PROVIDER_ID_PATTERN, ProviderFields } from './http.ts'

const model = (extra: Record<string, unknown> = {}) => ({
  id: 'custom-model-1',
  name: '自定义模型一',
  contextWindow: 1_000_000,
  maxTokens: 128_000,
  input: ['text', 'image'],
  reasoning: true,
  thinkingLevels: [{ level: 'off' }, { level: 'high', value: 'high' }],
  ...extra,
})

const create = (extra: Record<string, unknown> = {}) => ({
  id: 'custom-provider-1',
  name: '自定义供应商一',
  api: 'openai-completions',
  baseUrl: 'https://gateway.example/v1',
  models: [model()],
  ...extra,
})

describe('Provider 协议：用户输入的 ID、协议字段与 Model Catalog', () => {
  it('Provider ID 为小写字母开头、后接小写字母数字或连字符，总长 1–64', () => {
    const id = new RegExp(PROVIDER_ID_PATTERN)
    expect(['a', 'custom-provider-2', 'a1-b2', `a${'b'.repeat(63)}`].filter((ok) => !id.test(ok))).toEqual([])
    expect(['', '1abc', '-a', 'Abc', 'a_b', 'a b', 'a.b', `a${'b'.repeat(64)}`, 'ä'].filter((bad) => id.test(bad))).toEqual([])
    expect(Value.Check(ProviderFields, create())).toBe(true)
    expect(Value.Check(ProviderFields, create({ id: 'Custom' }))).toBe(false)
  })

  it('协议只能是三种之一；没有 kind 字段', () => {
    for (const api of ['openai-completions', 'openai-responses', 'anthropic-messages']) expect(Value.Check(ProviderFields, create({ api }))).toBe(true)
    expect(Value.Check(ProviderFields, create({ api: 'deepseek' }))).toBe(false)
    expect(Value.Check(ProviderFields, { ...create(), kind: 'openai-compatible' })).toBe(false)
  })

  it('目录至少一个模型；模型带显示名称、正整数容量、至少一种输入类型、推理开关与档位', () => {
    expect(Value.Check(ProviderFields, create({ models: [] }))).toBe(false)
    expect(Value.Check(CatalogModel, model())).toBe(true)
    expect(Value.Check(CatalogModel, model({ name: '' }))).toBe(true)
    const accepted = [
      { id: '' },
      { contextWindow: 0 },
      { maxTokens: 1.5 },
      { input: [] },
      { input: ['audio'] },
      { input: ['text', 'text'] },
      { thinkingLevels: [{ level: 'huge', value: 'x' }] },
      // off 的参数不可自定义；其他档位必须有参数值。
      { thinkingLevels: [{ level: 'off', value: 'none' }] },
      { thinkingLevels: [{ level: 'high' }] },
      { thinkingLevels: [{ level: 'high', value: '' }] },
    ].filter((bad) => Value.Check(CatalogModel, model(bad)))
    expect(accepted).toEqual([])
  })

  it('一次提交带完整配置：名称、地址必填，不带密钥字段；未填写的容量使用 128K / 16K 默认值', () => {
    const { name: _name, ...withoutName } = create()
    expect(Value.Check(ProviderFields, withoutName)).toBe(false)
    expect(Value.Check(ProviderFields, create({ name: '' }))).toBe(false)
    expect(Value.Check(ProviderFields, create({ baseUrl: '' }))).toBe(false)
    expect(Value.Check(ProviderFields, { ...create(), secret: 'sk-x' })).toBe(false)
    expect(MODEL_CATALOG_DEFAULTS).toEqual({ contextWindow: 128_000, maxTokens: 16_000 })
  })
})
