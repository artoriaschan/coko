// Markdown 的 YAML frontmatter（Skills 与命令）。做法参照 pi coding-agent 的 utils/frontmatter.ts
// （Copyright (c) 2025 Mario Zechner，MIT License）；这里把 YAML 错误作为结果返回而不抛出。
import { parse } from 'yaml'

export type FrontmatterResult =
  | { ok: true; frontmatter: Record<string, unknown>; body: string }
  /** frontmatter 不是合法的 YAML 映射；body 为去掉 frontmatter 块后的正文。 */
  | { ok: false; error: string; body: string }

const normalize = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replace(/\r\n?/g, '\n')

/** 解析开头的 --- 块；没有 frontmatter（或没有闭合的 ---）时 frontmatter 为空、body 为全文。 */
export function parseFrontmatter(content: string): FrontmatterResult {
  const text = normalize(content)
  if (!text.startsWith('---\n')) return { ok: true, frontmatter: {}, body: text }
  const end = text.indexOf('\n---', 3)
  if (end === -1) return { ok: true, frontmatter: {}, body: text }
  const yamlText = text.slice(4, end)
  const body = text.slice(end + 4).trim()
  let parsed: unknown
  try {
    parsed = parse(yamlText)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), body }
  }
  if (parsed === null || parsed === undefined) return { ok: true, frontmatter: {}, body }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'frontmatter must be a YAML mapping', body }
  return { ok: true, frontmatter: parsed as Record<string, unknown>, body }
}
