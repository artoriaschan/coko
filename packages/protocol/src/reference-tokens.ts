// @path / @"path with space" 与 @session:<id> 的 token 解析（Sidecar 的展开与 renderer 的显示共用这一份）。@ 须在词首（开头或空白之后），因此 user@example.com、(@a) 不是引用；
// 未加引号的路径去掉结尾的标点（句号、逗号、括号与中文标点），加引号的原样保留。与 composer 的 File Reference 节点序列化互逆。

export interface FileReferenceToken {
  /** 引用的路径（不含 @ 与引号）。 */
  path: string
  /** token 在原文中的起止（含 @，不含被去掉的结尾标点）。 */
  start: number
  end: number
  quoted: boolean
}

/** 中文全角标点：未加引号的路径在此结束（"@a.ts，" 后紧接的文字不属于路径）。 */
const CJK_PUNCTUATION = '，。；：！？、）】」』》'
const TOKEN = new RegExp(`(?<!\\S)@(?:"([^"\\n]+)"|([^\\s${CJK_PUNCTUATION}]+))`, 'gu')
const TRAILING = /[.,;:!?'")\]}>]+$/u
const NEEDS_QUOTES = new RegExp(`[\\s${CJK_PUNCTUATION}]`, 'u')

/** `@session:<id>`：未加引号、以此为前缀的 token 是 Session Reference，不作为文件路径（加引号的 `@"session:x"` 仍是路径）。 */
const SESSION_PREFIX = 'session:'

export interface SessionReferenceToken {
  /** 被引用 Session 的 id。 */
  id: string
  /** token 在原文中的起止（含 @，不含被去掉的结尾标点）。 */
  start: number
  end: number
}

export function parseFileReferences(text: string): FileReferenceToken[] {
  const tokens: FileReferenceToken[] = []
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index
    if (match[1] !== undefined) {
      tokens.push({ path: match[1], start, end: start + match[0].length, quoted: true })
      continue
    }
    const path = match[2]!.replace(TRAILING, '')
    if (path === '' || match[2]!.startsWith(SESSION_PREFIX)) continue
    tokens.push({ path, start, end: start + 1 + path.length, quoted: false })
  }
  return tokens
}

/** 词首与结尾标点规则与 File Reference 相同；没有 id 的 `@session:` 不是引用。 */
export function parseSessionReferences(text: string): SessionReferenceToken[] {
  const tokens: SessionReferenceToken[] = []
  for (const match of text.matchAll(TOKEN)) {
    if (!match[2]?.startsWith(SESSION_PREFIX)) continue
    const id = match[2].slice(SESSION_PREFIX.length).replace(TRAILING, '')
    if (id !== '') tokens.push({ id, start: match.index, end: match.index + 1 + SESSION_PREFIX.length + id.length })
  }
  return tokens
}

/** 显示用的文本：`@session:<id>` 换成 `@标题`（结尾标点保留）；titleOf 返回 undefined 的引用保持原样。提交、复制与回退仍用原文。 */
export function withSessionReferenceTitles(text: string, titleOf: (id: string) => string | undefined): string {
  let shown = text
  for (const reference of parseSessionReferences(text).toReversed()) {
    const title = titleOf(reference.id)
    if (title !== undefined) shown = `${shown.slice(0, reference.start)}@${title}${shown.slice(reference.end)}`
  }
  return shown
}

/** 路径 → token：含空白或全角标点、以引号开头、以会被当作结尾标点的字符结尾，或以 `session:` 开头（否则是会话引用）时加引号。 */
export function formatFileReferenceToken(path: string): string {
  return NEEDS_QUOTES.test(path) || path.startsWith('"') || path.startsWith(SESSION_PREFIX) || TRAILING.test(path) ? `@"${path}"` : `@${path}`
}
