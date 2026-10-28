import { describe, expect, it } from 'vitest'
import { createTranslator, dictionaries, locales, resolveLocale } from '@coko/i18n'

function flatten(value: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof child === 'string') out.set(path, child)
    else for (const [k, v] of flatten(child, path)) out.set(k, v)
  }
  return out
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('zh / en 字典', () => {
  it('两种语言的键集合一致，且每条文案非空', () => {
    const zh = flatten(dictionaries.zh)
    const en = flatten(dictionaries.en)
    expect([...en.keys()].sort()).toEqual([...zh.keys()].sort())
    const empty = [...zh, ...en].filter(([, text]) => text.trim() === '').map(([key]) => key)
    expect(empty).toEqual([])
  })

  it('同一条文案在两种语言中使用相同的插值参数', () => {
    const zh = flatten(dictionaries.zh)
    const en = flatten(dictionaries.en)
    const mismatched = [...zh].filter(([key, text]) => placeholders(en.get(key) ?? '').join() !== placeholders(text).join()).map(([key]) => key)
    expect(mismatched).toEqual([])
  })
})

describe('createTranslator', () => {
  it('按键返回当前语言的文案', () => {
    expect(createTranslator('zh')('sidebar.newSession')).toBe('新会话')
    expect(createTranslator('en')('sidebar.newSession')).toBe('New session')
  })

  it('替换插值参数，数字按原值输出', () => {
    expect(createTranslator('en')('sidebar.showMore', { count: 5 })).toBe('Show 5 more')
    expect(createTranslator('zh')('sidebar.showMore', { count: 5 })).toBe('再显示 5 个')
  })
})

describe('resolveLocale', () => {
  it.each([
    ['zh-CN', 'zh'],
    ['zh-Hant-TW', 'zh'],
    ['en-US', 'en'],
    ['fr-FR', 'en'],
    [undefined, 'en'],
  ] as const)('%s → %s', (input, expected) => {
    expect(resolveLocale(input)).toBe(expected)
  })

  it('locales 列出全部支持的语言', () => {
    expect([...locales].sort()).toEqual(['en', 'zh'])
  })
})
