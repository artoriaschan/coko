import { en as baseEn } from './dictionaries/en.ts'
import { zh as baseZh } from './dictionaries/zh.ts'
import { domainDictionary, type DomainDictionary } from './dictionaries/domains/index.ts'

// M2 及之前的文案在 dictionaries/{zh,en}.ts；M3 起按领域分文件（dictionaries/domains/），在此组合。领域的顶层键不得与基础字典重名。
export type Dictionary = typeof baseZh & DomainDictionary

const zh: Dictionary = { ...baseZh, ...domainDictionary('zh') }
const en: Dictionary = { ...baseEn, ...domainDictionary('en') }

export const dictionaries = { zh, en } satisfies Record<string, Dictionary>
