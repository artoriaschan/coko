// @import 的识别（claude-code claudemd.ts 的规则）：只在 Markdown 叶子文本中展开，代码块、行内代码与 HTML 注释中的不算。
import { basename, extname, isAbsolute, join, resolve } from 'node:path'

/** @import 只接受这些扩展名（文本文件）。环境文件（.env、.env.*、*.env）通常放本地凭据，不是文本扩展名。 */
export const TEXT_EXTENSIONS: ReadonlySet<string> = new Set(
  (
    'md markdown mdx txt text rst adoc json jsonc json5 yaml yml toml ini cfg conf xml csv tsv html htm css scss sass less ' +
    'js jsx mjs cjs ts tsx mts cts py pyi rb go rs java kt kts scala c cc cpp cxx h hpp hxx cs swift php lua sh bash zsh fish ps1 ' +
    'sql graphql gql proto vue svelte'
  )
    .split(' ')
    .map((ext) => '.' + ext),
)

const ENV_FILE = /^\.env(\.|$)/i

export const isTextPath = (path: string) => !ENV_FILE.test(basename(path)) && TEXT_EXTENSIONS.has(extname(path).toLowerCase())

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/

/** 去掉围栏代码块（``` 或 ~~~，未闭合时到文末）。 */
function stripFences(text: string): string {
  const out: string[] = []
  let fence: string | undefined
  for (const line of text.split('\n')) {
    if (fence) {
      const close = new RegExp('^ {0,3}' + (fence[0] === '~' ? '~' : '`') + '{' + fence.length + ',}\\s*$')
      if (close.test(line)) fence = undefined
      continue
    }
    const open = FENCE_OPEN.exec(line)
    if (open) {
      fence = open[1]
      continue
    }
    out.push(line)
  }
  return out.join('\n')
}

const INLINE_CODE = /(`+)[\s\S]*?\1/g
const HTML_COMMENT = /<!--[\s\S]*?-->/g
const MENTION = /(?:^|\s)@((?:[^\s\\]|\\ )+)/g
const TRAILING_PUNCTUATION = /[.,;:!?)\]}>'"]+$/

const looksLikePath = (path: string) =>
  path.startsWith('./') ||
  path.startsWith('../') ||
  path.startsWith('~/') ||
  (path.startsWith('/') && path.length > 1) ||
  (/^[A-Za-z0-9._-]/.test(path) && (path.includes('/') || /\.[A-Za-z0-9]+$/.test(path)))

/** 指令文本中的 @import 记号（原样，按出现顺序去重）：@./rel、@../rel、@~/x、@/abs、@rel/path 或 @name.ext。 */
export function extractImports(text: string): string[] {
  const leaf = stripFences(text).replace(HTML_COMMENT, ' ').replace(INLINE_CODE, ' ')
  const found: string[] = []
  for (const match of leaf.matchAll(MENTION)) {
    let path = match[1]!.replace(/\\ /g, ' ')
    const hash = path.indexOf('#')
    if (hash >= 0) path = path.slice(0, hash)
    path = path.replace(TRAILING_PUNCTUATION, '')
    if (path && looksLikePath(path) && !found.includes(path)) found.push(path)
  }
  return found
}

/** 把 @import 记号解析为绝对路径：~/ 相对家目录，绝对路径原样，其余相对引入它的文件所在目录。 */
export function resolveImport(token: string, baseDir: string, homeDir: string): string {
  if (token.startsWith('~/')) return join(homeDir, token.slice(2))
  return isAbsolute(token) ? resolve(token) : resolve(baseDir, token)
}
