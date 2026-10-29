// @path / @"path with space" 的 token 解析。@ 须在词首（开头或空白之后），因此 user@example.com、(@a) 不是引用；
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

export function parseFileReferences(text: string): FileReferenceToken[] {
  const tokens: FileReferenceToken[] = []
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index
    if (match[1] !== undefined) {
      tokens.push({ path: match[1], start, end: start + match[0].length, quoted: true })
      continue
    }
    const path = match[2]!.replace(TRAILING, '')
    if (path === '') continue
    tokens.push({ path, start, end: start + 1 + path.length, quoted: false })
  }
  return tokens
}

/** 路径 → token：含空白或全角标点、以引号开头或以会被当作结尾标点的字符结尾时加引号。 */
export function formatFileReferenceToken(path: string): string {
  return NEEDS_QUOTES.test(path) || path.startsWith('"') || TRAILING.test(path) ? `@"${path}"` : `@${path}`
}
