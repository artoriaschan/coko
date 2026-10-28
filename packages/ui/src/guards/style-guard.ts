/**
 * 设计系统的静态样式守卫，规则见 docs/tech-stack/ui-design-system.md#样式守卫。
 * 只能拒绝档位外数值与未知 token；合法 token 是否适合组件、轮廓是否对齐需在真实渲染中检查。
 */
import ts from 'typescript'

export type StyleRule = 'color' | 'radius' | 'round-curve' | 'material' | 'menu' | 'hover' | 'scrollbar' | 'drag-region' | 'copy'

export interface StyleViolation {
  rule: StyleRule
  line: number
  match: string
}

export interface StyleSource {
  /** 相对仓库根的路径；用于识别主题样式表与共享菜单组件。 */
  path: string
  content: string
}

const THEME_STYLESHEET = /(^|\/)packages\/ui\/src\/styles\/theme\.css$/
const MENU_COMPONENTS = /(^|\/)packages\/ui\/src\/components\/dropdown-menu\.tsx$/

const COLOR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/
const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/
const NAMED_COLOR = /(?:^|[\s,(])(?:white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|silver)(?=$|[\s,)])/
const DEFAULT_PALETTE =
  /^-?(?:bg|text|border(?:-[xytrblse])?|ring|ring-offset|fill|stroke|outline|decoration|divide|from|via|to|shadow|accent|caret|placeholder|inset-shadow|drop-shadow)-(?:(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}|white|black)(?:\/\d+)?$/
const RADIUS_TOKEN = /^rounded(?:-(?:ss|se|es|ee|tl|tr|br|bl|s|e|t|r|b|l))?(?:-(.+))?$/
const RADIUS_SIZES = new Set(['xs', 'sm', 'md', 'lg', 'xl', 'panel', 'none', 'round', '[inherit]'])
const FULL_ROUND_VALUE = /^\[(?:50%|9{3,}px|calc\(infinity\*1px\))\]$/
const REGISTERED_RADIUS = new Set(['xs', 'sm', 'md', 'lg', 'xl', 'panel', '*'])
const NEUTRAL_WIDTH_TOKEN = /^border(?:-[xytrblse])?(?:-[1-9]\d*)?$/
const ANY_WIDTH_TOKEN = /^border(?:-[xytrblse])?(?:-(?:\d+|hairline))?$/
const ELEVATION_TOKEN = /^shadow-(?:panel|prominent|soft)$/
const BORDER_EXEMPT = /^border(?:-[xytrblse])?-(?:dashed|dotted|destructive|warning|success)$/
const MENU_ROLES = new Set(['menu', 'menubar', 'listbox'])
const COPY_ATTRIBUTES = new Set([
  'aria-label',
  'aria-description',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'title',
  'placeholder',
  'alt',
  'label',
])
const HAS_LETTER = /\p{L}/u

export function checkStyleSource(source: StyleSource): StyleViolation[] {
  if (source.path.endsWith('.css')) return checkCss(source)
  if (source.path.endsWith('.tsx') || source.path.endsWith('.ts')) return checkTsx(source)
  return []
}

/* ---------------- TSX ---------------- */

/** 去掉变体前缀（hover:、data-[state=open]:）与 important 标记，返回工具类本体与变体列表。 */
function splitVariants(token: string): { base: string; variants: string[] } {
  const variants: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < token.length; i++) {
    const ch = token[i]
    if (ch === '[' || ch === '(') depth++
    else if (ch === ']' || ch === ')') depth--
    else if (ch === ':' && depth === 0) {
      variants.push(token.slice(start, i))
      start = i + 1
    }
  }
  const base = token.slice(start).replace(/^!|!$/g, '')
  return { base, variants }
}

function checkClassLiteral(text: string, line: number, path: string, report: (rule: StyleRule, line: number, match: string) => void) {
  if (COLOR_FUNCTION.test(text) || text.includes('--palette-')) report('color', line, text.trim())
  if (text.includes('-webkit-scrollbar')) report('scrollbar', line, text.trim())
  if (text.includes('app-region')) report('drag-region', line, text.trim())

  const tokens = text.split(/\s+/).filter(Boolean)
  const bases = tokens.map((t) => splitVariants(t).base)
  const exemptBorder = bases.some((b) => BORDER_EXEMPT.test(b))
  const hasElevation = bases.some((b) => ELEVATION_TOKEN.test(b))
  const isMenuFile = MENU_COMPONENTS.test(path)

  for (const token of tokens) {
    const { base, variants } = splitVariants(token)
    if (variants.includes('dark')) report('color', line, token)
    if (DEFAULT_PALETTE.test(base) || /\[#[0-9a-fA-F]{3,8}\]/.test(base) || (HEX_COLOR.test(base) && base.startsWith('#'))) report('color', line, token)

    const radius = RADIUS_TOKEN.exec(base)
    if (radius) {
      const size = radius[1]
      if (size === 'full' || (size !== undefined && FULL_ROUND_VALUE.test(size.replace(/\s/g, '')))) report('round-curve', line, token)
      else if (size === undefined || !RADIUS_SIZES.has(size)) report('radius', line, token)
    }

    if (NEUTRAL_WIDTH_TOKEN.test(base) && !exemptBorder) report('material', line, token)
    if (hasElevation && ANY_WIDTH_TOKEN.test(base) && !base.endsWith('-0')) report('material', line, token)

    if (!isMenuFile && (base === 'bg-menu-fill' || base === 'menu-backdrop' || base.startsWith('backdrop-'))) report('menu', line, token)
  }
}

function checkTsx(source: StyleSource): StyleViolation[] {
  const violations: StyleViolation[] = []
  const report = (rule: StyleRule, line: number, match: string) => violations.push({ rule, line, match })
  const file = ts.createSourceFile(source.path, source.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const lineOf = (node: ts.Node) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1

  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      checkClassLiteral(node.text, lineOf(node), source.path, report)
    } else if (ts.isJsxText(node)) {
      const text = node.text.trim()
      if (HAS_LETTER.test(text)) report('copy', lineOf(node), text)
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(file)
      const init = node.initializer
      const literal =
        init && ts.isStringLiteral(init)
          ? init.text
          : init && ts.isJsxExpression(init) && init.expression && ts.isStringLiteralLike(init.expression)
            ? init.expression.text
            : undefined
      if (literal !== undefined) {
        if (COPY_ATTRIBUTES.has(name) && HAS_LETTER.test(literal)) report('copy', lineOf(node), literal)
        if (name === 'role' && MENU_ROLES.has(literal) && !MENU_COMPONENTS.test(source.path)) report('menu', lineOf(node), `role="${literal}"`)
      }
    } else if (ts.isIdentifier(node) && node.text === 'WebkitAppRegion') {
      report('drag-region', lineOf(node), node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return violations
}

/* ---------------- CSS ---------------- */

/** 把注释替换为空白（保留换行以维持行号），跳过字符串字面量。 */
function blankCssComments(css: string): string {
  let out = ''
  let i = 0
  while (i < css.length) {
    const ch = css[i]
    if (ch === '"' || ch === "'") {
      const end = css.indexOf(ch, i + 1)
      const stop = end === -1 ? css.length : end + 1
      out += css.slice(i, stop)
      i = stop
    } else if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      const stop = end === -1 ? css.length : end + 2
      out += css.slice(i, stop).replace(/[^\n]/g, ' ')
      i = stop
    } else {
      out += ch
      i++
    }
  }
  return out
}

function checkCss(source: StyleSource): StyleViolation[] {
  const violations: StyleViolation[] = []
  const report = (rule: StyleRule, line: number, match: string) => violations.push({ rule, line, match })
  const isTheme = THEME_STYLESHEET.test(source.path)
  const css = blankCssComments(source.content)
  const preludes: string[] = []
  let buf = ''
  let bufStart = 0
  let quote: string | null = null
  const lineAt = (index: number) => css.slice(0, index).split('\n').length

  const flushDeclaration = (end: number) => {
    const text = buf.trim()
    const offset = bufStart + buf.length - buf.trimStart().length
    buf = ''
    bufStart = end + 1
    if (!text || text.startsWith('@')) return
    const colon = text.indexOf(':')
    if (colon === -1) return
    checkDeclaration(text.slice(0, colon).trim(), text.slice(colon + 1).trim(), lineAt(offset))
  }

  const inThemeBlock = () => preludes.some((p) => p.startsWith('@theme'))

  const checkDeclaration = (prop: string, value: string, line: number) => {
    const match = `${prop}: ${value}`
    const literalColor = HEX_COLOR.test(value) || COLOR_FUNCTION.test(value) || NAMED_COLOR.test(value)
    if (literalColor && !(isTheme && prop.startsWith('--palette-'))) report('color', line, match)
    if (!isTheme && value.includes('--palette-')) report('color', line, match)

    if (prop.startsWith('--radius-') && !(isTheme && inThemeBlock() && REGISTERED_RADIUS.has(prop.slice('--radius-'.length)))) report('radius', line, match)
    if (/^border(?:-[a-z]+)*-radius$/.test(prop)) {
      if (/(?:^|\s)(?:50%|9{3,}px)(?:$|\s)/.test(value)) report('round-curve', line, match)
      else if (!isTheme && /(?:^|[\s(])(?:[4-9]|[1-9]\d)(?:\.\d+)?px/.test(value)) report('radius', line, match)
    }

    if (!isTheme && /^border(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?(?:-width)?$/.test(prop)) {
      const wide = /(?:^|\s)(?:[1-9]\d*(?:\.\d+)?|0\.[6-9]\d*)px/.test(value) || /\b(?:thin|medium|thick)\b/.test(value)
      const exempt = /\b(?:dashed|dotted)\b/.test(value) || /--(?:destructive|warning|success)\b/.test(value)
      if (wide && !exempt) report('material', line, match)
    }

    if (!isTheme && (prop === '--menu-fill' || prop === '--menu-backdrop-filter' || prop === 'backdrop-filter' || prop === '-webkit-backdrop-filter'))
      report('menu', line, match)
    if (!isTheme && prop.startsWith('scrollbar-')) report('scrollbar', line, match)
    if (!isTheme && /^(?:-webkit-)?app-region$/.test(prop)) report('drag-region', line, match)
  }

  const checkSelector = (selector: string, line: number) => {
    if (selector.startsWith('@')) return
    if (selector.includes(':hover') && !preludes.some((p) => /^@media\b[^{]*\(\s*hover\s*:\s*hover\s*\)/.test(p))) report('hover', line, selector)
    if (!isTheme && selector.includes('::-webkit-scrollbar')) report('scrollbar', line, selector)
  }

  for (let i = 0; i < css.length; i++) {
    const ch = css[i] as string
    if (quote) {
      if (ch === quote) quote = null
      buf += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      buf += ch
    } else if (ch === '{') {
      const prelude = buf.trim()
      checkSelector(prelude, lineAt(bufStart + buf.length - buf.trimStart().length))
      preludes.push(prelude)
      buf = ''
      bufStart = i + 1
    } else if (ch === ';') {
      flushDeclaration(i)
    } else if (ch === '}') {
      flushDeclaration(i)
      preludes.pop()
    } else {
      buf += ch
    }
  }
  return violations
}
