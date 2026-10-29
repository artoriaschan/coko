import type { MessageKey } from '@coko/i18n'
import { MODEL_CATALOG_DEFAULTS, type CatalogModel } from '@coko/protocol'
import { normalizeLevels } from './thinking-levels.ts'

/**
 * 模型目录中的一行草稿：模型 ID、显示名称与容量为输入框原文，提交时才整理为 CatalogModel。key 只用于界面上的行身份，
 * 不参与比较和提交；推理开关与档位原样保留。
 */
export interface ModelRowDraft {
  key: string
  id: string
  name: string
  contextWindow: string
  maxTokens: string
  input: CatalogModel['input']
  reasoning: boolean
  thinkingLevels: CatalogModel['thinkingLevels']
}

/** 有校验错误的行字段；值为字典键。 */
export type ModelRowField = 'id' | 'contextWindow' | 'maxTokens'
export type CatalogErrors = Record<string, Partial<Record<ModelRowField, MessageKey>>>

let rowSeq = 0
const nextKey = () => `model-${++rowSeq}`

/** “添加模型”新增的空行：容量留空（使用默认值）、文本输入、推理关闭。 */
export const emptyModelRow = (): ModelRowDraft => ({
  key: nextKey(),
  id: '',
  name: '',
  contextWindow: '',
  maxTokens: '',
  input: ['text'],
  reasoning: false,
  thinkingLevels: [],
})

/** 编辑表单的初始行：已保存的容量带后缀回显。 */
export const rowsOf = (models: readonly CatalogModel[]): ModelRowDraft[] =>
  models.map((m) => ({
    key: nextKey(),
    id: m.id,
    name: m.name,
    contextWindow: formatTokens(m.contextWindow),
    maxTokens: formatTokens(m.maxTokens),
    input: [...m.input],
    reasoning: m.reasoning,
    thinkingLevels: structuredClone(m.thinkingLevels),
  }))

/** 校验通过后的提交内容：去掉首尾空白，留空的容量使用默认值，名称留空保存为空字符串（显示为模型 ID）。 */
export const toCatalog = (rows: readonly ModelRowDraft[]): CatalogModel[] =>
  rows.map((row) => ({
    id: row.id.trim(),
    name: row.name.trim(),
    contextWindow: parseTokens(row.contextWindow) ?? MODEL_CATALOG_DEFAULTS.contextWindow,
    maxTokens: parseTokens(row.maxTokens) ?? MODEL_CATALOG_DEFAULTS.maxTokens,
    input: [...row.input],
    reasoning: row.reasoning,
    thinkingLevels: normalizeLevels(row.thinkingLevels),
  }))

/** 容量后缀的十进制位数：K = 10^3，M = 10^6。 */
const SUFFIX_DIGITS = { '': 0, k: 3, m: 6 } as const

const TOKENS = /^(\d+)(?:\.(\d+))?([km]?)$/i

/**
 * 容量输入：纯数字或带 K/M 后缀（1000 进制），按小数位逐位换算，不经浮点乘法。留空返回 undefined（使用默认值），
 * 不是正整数 token 数时返回 null。
 */
export function parseTokens(text: string): number | null | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  const match = TOKENS.exec(trimmed)
  if (!match) return null
  const [, whole = '', fraction = '', suffix = ''] = match
  const digits = SUFFIX_DIGITS[suffix.toLowerCase() as keyof typeof SUFFIX_DIGITS]
  if (fraction.length > digits) return null
  const tokens = Number(whole + fraction.padEnd(digits, '0'))
  return tokens > 0 ? tokens : null
}

/** 回显容量：用能整除到一位小数的最大后缀（1000000 → 1M，1500000 → 1.5M）；否则显示原数。 */
export function formatTokens(tokens: number): string {
  for (const [suffix, unit] of [
    ['M', 1_000_000],
    ['K', 1_000],
  ] as const) {
    if (tokens >= unit && (tokens * 10) % unit === 0) return `${tokens / unit}${suffix}`
  }
  return String(tokens)
}
/**
 * 目录行校验（规格 4.4、4.5）：模型 ID 必填且不重复（重复的每一行都标出）；容量须为正整数；最大输出不超过上下文窗口，
 * 留空的容量按默认值比较。返回出错的行及其字段。
 */
export function validateCatalog(rows: readonly ModelRowDraft[]): CatalogErrors {
  const errors: CatalogErrors = {}
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.id.trim(), (counts.get(row.id.trim()) ?? 0) + 1)
  for (const row of rows) {
    const found: CatalogErrors[string] = {}
    const id = row.id.trim()
    if (id === '') found.id = 'providers.catalog.idRequired'
    else if (counts.get(id)! > 1) found.id = 'providers.catalog.idTaken'
    const context = parseTokens(row.contextWindow)
    const max = parseTokens(row.maxTokens)
    if (context === null) found.contextWindow = 'providers.catalog.tokensInvalid'
    if (max === null) found.maxTokens = 'providers.catalog.tokensInvalid'
    else if (context !== null && (max ?? MODEL_CATALOG_DEFAULTS.maxTokens) > (context ?? MODEL_CATALOG_DEFAULTS.contextWindow))
      found.maxTokens = 'providers.catalog.maxTokensAboveContext'
    if (Object.keys(found).length > 0) errors[row.key] = found
  }
  return errors
}
/** 修改目录后去掉已失效的行错误：行被删除或该字段的内容变了。 */
export function pruneCatalogErrors(errors: CatalogErrors, rows: readonly ModelRowDraft[], before: readonly ModelRowDraft[]): CatalogErrors {
  const next: CatalogErrors = {}
  for (const [key, fields] of Object.entries(errors)) {
    const row = rows.find((r) => r.key === key)
    const old = before.find((r) => r.key === key)
    if (!row || !old) continue
    const kept = Object.fromEntries(Object.entries(fields).filter(([field]) => row[field as ModelRowField] === old[field as ModelRowField]))
    if (Object.keys(kept).length > 0) next[key] = kept
  }
  return next
}
