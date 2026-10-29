// 模型目录行的纯函数：容量输入（纯数字或 K/M 后缀，1000 进制）、行校验与提交内容（规格 4.4、4.5）。
import { describe, expect, it } from 'vitest'
import type { CatalogModel } from '@coko/protocol'
import { emptyModelRow, formatTokens, parseTokens, rowsOf, toCatalog, validateCatalog, type ModelRowDraft } from './catalog-draft.ts'

const row = (fields: Partial<ModelRowDraft>): ModelRowDraft => ({ ...emptyModelRow(), ...fields })

describe('容量输入', () => {
  it.each([
    ['1M', 1_000_000],
    ['128K', 128_000],
    ['128k', 128_000],
    ['16000', 16_000],
    [' 1.5M ', 1_500_000],
    ['2.5k', 2_500],
    ['1.1K', 1_100],
  ])('%j 解析为 %i token', (text, tokens) => {
    expect(parseTokens(text)).toBe(tokens)
  })

  it('留空表示使用默认值', () => {
    expect(parseTokens('')).toBeUndefined()
    expect(parseTokens('   ')).toBeUndefined()
  })

  it.each([
    [1_000_000, '1M'],
    [128_000, '128K'],
    [16_000, '16K'],
    [1_500_000, '1.5M'],
    [200_000, '200K'],
    [1_100, '1.1K'],
    // 换算后超过一位小数时保留原数，不显示 131.072K。
    [131_072, '131072'],
    [999, '999'],
    [1_234_567, '1234567'],
  ])('%i 回显为 %j，再解析得到原值', (tokens, text) => {
    expect(formatTokens(tokens)).toBe(text)
    expect(parseTokens(text)).toBe(tokens)
  })

  it.each(['0', '0K', '-5', 'abc', '1G', '1.5', '0.0001K', '1MK', '1e6'])('%j 不是正整数 token 数', (text) => {
    expect(parseTokens(text)).toBeNull()
  })
})

describe('目录行校验', () => {
  it('合格的行没有错误；显示名称与容量可以留空', () => {
    expect(
      validateCatalog([row({ id: 'custom-model-1' }), row({ id: 'custom-model-2', name: '自定义模型二', contextWindow: '1M', maxTokens: '128K' })]),
    ).toEqual({})
  })

  it('模型 ID 为空或重复时标出对应的行；重复的每一行都标出', () => {
    const rows = [row({ id: 'custom-model-1' }), row({ id: '  ' }), row({ id: 'custom-model-1 ' }), row({ id: 'custom-model-3' })]
    expect(validateCatalog(rows)).toEqual({
      [rows[0]!.key]: { id: 'providers.catalog.idTaken' },
      [rows[1]!.key]: { id: 'providers.catalog.idRequired' },
      [rows[2]!.key]: { id: 'providers.catalog.idTaken' },
    })
  })

  it('容量不是正整数时报错；最大输出超过上下文窗口（含默认值）时报在最大输出上', () => {
    const zero = row({ id: 'a', contextWindow: '0' })
    const bad = row({ id: 'b', maxTokens: 'abc' })
    const over = row({ id: 'c', contextWindow: '128K', maxTokens: '200K' })
    const overDefault = row({ id: 'd', contextWindow: '8K' })
    const equal = row({ id: 'e', contextWindow: '16K', maxTokens: '16000' })
    expect(validateCatalog([zero, bad, over, overDefault, equal])).toEqual({
      [zero.key]: { contextWindow: 'providers.catalog.tokensInvalid' },
      [bad.key]: { maxTokens: 'providers.catalog.tokensInvalid' },
      [over.key]: { maxTokens: 'providers.catalog.maxTokensAboveContext' },
      [overDefault.key]: { maxTokens: 'providers.catalog.maxTokensAboveContext' },
    })
  })
})

describe('目录行与 CatalogModel', () => {
  const saved: CatalogModel[] = [
    {
      id: 'custom-model-1',
      name: '自定义模型一',
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      input: ['text', 'image'],
      reasoning: true,
      thinkingLevels: [{ level: 'off' }, { level: 'high', value: 'high' }],
    },
    { id: 'custom-model-2', name: '', contextWindow: 131_072, maxTokens: 16_000, input: ['text'], reasoning: false, thinkingLevels: [] },
  ]

  it('重新打开表单：容量带后缀回显，提交时得到同样的目录（含推理开关与档位）', () => {
    const rows = rowsOf(saved)
    expect(rows.map(({ id, name, contextWindow, maxTokens }) => ({ id, name, contextWindow, maxTokens }))).toEqual([
      { id: 'custom-model-1', name: '自定义模型一', contextWindow: '1M', maxTokens: '128K' },
      { id: 'custom-model-2', name: '', contextWindow: '131072', maxTokens: '16K' },
    ])
    expect(new Set(rows.map((r) => r.key)).size).toBe(2)
    expect(toCatalog(rows)).toEqual(saved)
  })

  it('新增行提交时：去掉首尾空白，容量留空用默认 128K / 16K，名称留空保存为空（显示为模型 ID）', () => {
    expect(toCatalog([row({ id: ' custom-model-3 ', name: '  ' }), row({ id: 'custom-model-4', contextWindow: '1M', maxTokens: '128K' })])).toEqual([
      { id: 'custom-model-3', name: '', contextWindow: 128_000, maxTokens: 16_000, input: ['text'], reasoning: false, thinkingLevels: [] },
      { id: 'custom-model-4', name: '', contextWindow: 1_000_000, maxTokens: 128_000, input: ['text'], reasoning: false, thinkingLevels: [] },
    ])
  })
})
