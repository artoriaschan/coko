import { describe, expect, it } from 'vitest'
import { dictionaries } from './dictionaries.ts'
import { en as baseEn } from './dictionaries/en.ts'
import { zh as baseZh } from './dictionaries/zh.ts'
import { domainDictionary } from './dictionaries/domains/index.ts'

function keys(value: unknown, prefix = ''): string[] {
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    typeof child === 'string' ? [prefix + key] : keys(child, `${prefix}${key}.`),
  )
}

describe('分域字典', () => {
  it('每个领域的 zh 与 en 键集合相同', () => {
    const zh = domainDictionary('zh')
    const en = domainDictionary('en')
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    for (const domain of Object.keys(zh) as (keyof typeof zh)[]) expect(keys(en[domain]).sort()).toEqual(keys(zh[domain]).sort())
  })

  it('M6 的五个分域已登记', () => {
    expect(Object.keys(domainDictionary('zh'))).toEqual(expect.arrayContaining(['plugins', 'lsp', 'teams', 'trace', 'update']))
  })

  it('领域的顶层键不与基础字典重名（组合时不覆盖已有文案）', () => {
    const domainKeys = Object.keys(domainDictionary('zh'))
    expect(domainKeys.filter((key) => key in baseZh || key in baseEn)).toEqual([])
  })

  it('组合后的字典含基础与领域文案', () => {
    expect(dictionaries.zh.settings.title).toBe(baseZh.settings.title)
    expect(dictionaries.en.skills.title).toBe('Skills & Commands')
    expect(keys(dictionaries.zh).length).toBe(keys(baseZh).length + keys(domainDictionary('zh')).length)
  })
})
