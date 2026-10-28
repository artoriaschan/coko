import { dictionaries, type Dictionary } from './dictionaries.ts'

export type Locale = keyof typeof dictionaries

export const locales = Object.keys(dictionaries) as readonly Locale[]

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>
}[keyof T & string]

/** 字典中每条文案的点分路径，例如 `sidebar.newSession`。 */
export type MessageKey = Leaves<Dictionary>

export type MessageParams = Record<string, string | number>

export type Translator = (key: MessageKey, params?: MessageParams) => string

function lookup(dictionary: Dictionary, key: MessageKey): string {
  let node: unknown = dictionary
  for (const part of key.split('.')) node = (node as Record<string, unknown>)[part]
  return node as string
}

/** 返回绑定到指定语言的翻译函数；`{name}` 占位符按 params 替换，缺失的参数保留原样。 */
export function createTranslator(locale: Locale): Translator {
  const dictionary = dictionaries[locale]
  return (key, params) => {
    const text = lookup(dictionary, key)
    if (!params) return text
    return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
  }
}

/** 把 BCP 47 语言标签（如 preload 提供的系统 locale）映射到支持的界面语言，未知语言回退到 en。 */
export function resolveLocale(tag: string | undefined): Locale {
  const language = tag?.toLowerCase().split('-')[0]
  return language === 'zh' ? 'zh' : 'en'
}
