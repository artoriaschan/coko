#!/usr/bin/env node
// Coko 文档结构检查：链接与锚点、frontmatter 与状态值、模板占位、ADR 编号、
// .scratch 引用方向、active 文档可达性和 CLAUDE.md 链接。
// 规则来源：docs/DOCUMENTATION_SYSTEM.md 与 docs/DOCUMENT_LIFECYCLE.md；语义一致性由人工读回负责。
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, statSync, type Stats } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { fromMarkdown } from 'mdast-util-from-markdown'

export type RuleId =
  | 'link-target'
  | 'link-anchor'
  | 'scratch-reference'
  | 'frontmatter'
  | 'frontmatter-value'
  | 'lifecycle-notice'
  | 'template-placeholder'
  | 'adr-id'
  | 'unreachable'
  | 'claude-link'

export interface Finding {
  file: string
  line: number
  rule: RuleId
  message: string
}

export interface CheckResult {
  files: string[]
  findings: Finding[]
}

interface MdNode {
  type: string
  url?: string
  value?: string
  children?: MdNode[]
  position?: { start: { line: number } }
}

interface Frontmatter {
  values: Map<string, string>
  lines: Map<string, number>
}

interface ParsedDoc {
  frontmatter: Frontmatter | null
  bodyLines: string[]
  anchors: Set<string>
  links: { url: string; line: number }[]
  literals: { value: string; line: number }[]
}

type Report = (file: string, line: number, rule: RuleId, message: string) => void

const KINDS = new Set(['index', 'workflow', 'reference', 'technical-spec', 'spec', 'design', 'decision', 'guide', 'evidence', 'upgrade-guide', 'postmortem'])
const LIFECYCLES = new Set(['active', 'deprecated', 'archived'])
const DESIGN_STATUS = new Set(['draft', 'approved', 'delivered', 'withdrawn', 'superseded'])
const DECISION_STATUS = new Set(['proposed', 'accepted', 'rejected', 'superseded'])
const IMPLEMENTATION = new Set(['not-started', 'partial', 'implemented'])
const CATEGORIES = new Set(['architecture', 'feature', 'testing', 'process', 'simplification', 'bug-fix'])
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist'])
const DATE = /^\d{4}-\d{2}-\d{2}$/
const ADR_NAME = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/
// 具体的 .scratch 路径；<feature>、{slug}、* 等占位模式属于操作协议，不计入。
const SCRATCH_PATH = /\.scratch\/(?![<{*])[^\s\x60'"<>()[\]|，。；、]+/g
const SCHEME = /^[a-z][a-z0-9+.-]*:/i

function toPosix(p: string): string {
  return p.split(path.sep).join('/')
}

function walk(root: string, relDir: string, out: string[]): void {
  const abs = path.join(root, relDir)
  if (!existsSync(abs)) return
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const rel = relDir + '/' + entry.name
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(root, rel, out)
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(rel)
    }
  }
}

/** 检查范围：根目录 Markdown、docs、.scratch、项目自有 coko-* skills、apps/packages 的 README。 */
export function collectFiles(root: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) out.push(entry.name)
  }
  walk(root, 'docs', out)
  walk(root, '.scratch', out)
  const skills = path.join(root, '.agents', 'skills')
  if (existsSync(skills)) {
    for (const entry of readdirSync(skills, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith('coko-')) walk(root, '.agents/skills/' + entry.name, out)
    }
  }
  for (const group of ['apps', 'packages']) {
    const dir = path.join(root, group)
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const readme = group + '/' + entry.name + '/README.md'
      if (entry.isDirectory() && existsSync(path.join(root, readme))) out.push(readme)
    }
  }
  return [...new Set(out)].sort()
}

function parseFrontmatter(lines: string[]): { frontmatter: Frontmatter | null; end: number } {
  if (lines[0]?.trim() !== '---') return { frontmatter: null, end: 0 }
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() !== '---') continue
    const values = new Map<string, string>()
    const lineOf = new Map<string, number>()
    for (let j = 1; j < i; j++) {
      const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[j] ?? '')
      if (!match || !match[1]) continue
      values.set(match[1], (match[2] ?? '').trim().replace(/^(["'])(.*)\1$/, '$2'))
      lineOf.set(match[1], j + 1)
    }
    return { frontmatter: { values, lines: lineOf }, end: i + 1 }
  }
  return { frontmatter: null, end: 0 }
}

/** 近似 GitHub 标题锚点：转小写，删除字母、数字、连接符、连字符和空格以外的字符，空格变连字符。 */
export function slugify(heading: string): string {
  return heading.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-')
}

function textOf(node: MdNode): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? ''
  return (node.children ?? []).map(textOf).join('')
}

function parseDoc(text: string): ParsedDoc {
  const lines = text.split(/\r?\n/)
  const { frontmatter, end } = parseFrontmatter(lines)
  // 保留空行以维持行号，并避免 frontmatter 被解析成分隔线或标题。
  const bodyLines = lines.map((line, i) => (i < end ? '' : line))
  const tree = fromMarkdown(bodyLines.join('\n')) as unknown as MdNode
  const anchors = new Set<string>()
  const seen = new Map<string, number>()
  const links: ParsedDoc['links'] = []
  const literals: ParsedDoc['literals'] = []
  const visit = (node: MdNode): void => {
    const line = node.position?.start.line ?? 1
    if (node.type === 'heading') {
      const base = slugify(textOf(node))
      const count = seen.get(base) ?? 0
      seen.set(base, count + 1)
      anchors.add(count === 0 ? base : base + '-' + count)
    }
    if ((node.type === 'link' || node.type === 'image' || node.type === 'definition') && node.url) {
      links.push({ url: node.url, line })
    }
    if ((node.type === 'text' || node.type === 'inlineCode' || node.type === 'code') && node.value) {
      // 代码块内容从围栏的下一行开始。
      literals.push({ value: node.value, line: node.type === 'code' ? line + 1 : line })
    }
    for (const child of node.children ?? []) visit(child)
  }
  visit(tree)
  return { frontmatter, bodyLines, anchors, links, literals }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function splitUrl(url: string): { target: string; hash: string } | null {
  if (SCHEME.test(url) || url.startsWith('//')) return null
  const hashAt = url.indexOf('#')
  const pathPart = (hashAt >= 0 ? url.slice(0, hashAt) : url).split('?')[0] ?? ''
  return { target: safeDecode(pathPart), hash: hashAt >= 0 ? safeDecode(url.slice(hashAt + 1)) : '' }
}

function checkFrontmatter(rel: string, doc: ParsedDoc, report: Report): void {
  const fm = doc.frontmatter
  if (!fm) {
    report(rel, 1, 'frontmatter', '缺少 frontmatter：需要 kind、description、lifecycle')
    return
  }
  const get = (key: string): string | undefined => fm.values.get(key) || undefined
  const at = (key: string): number => fm.lines.get(key) ?? 1
  for (const key of ['kind', 'description', 'lifecycle']) {
    if (!get(key)) report(rel, at(key), 'frontmatter', 'frontmatter 缺少 ' + key)
  }
  const kind = get('kind')
  const lifecycle = get('lifecycle')
  const status = get('status')
  const implementation = get('implementation')
  const category = get('category')
  if (kind && !KINDS.has(kind)) report(rel, at('kind'), 'frontmatter-value', 'kind 不在文档体系登记的类型中：' + kind)
  if (lifecycle && !LIFECYCLES.has(lifecycle)) report(rel, at('lifecycle'), 'frontmatter-value', 'lifecycle 只能是 active、deprecated 或 archived：' + lifecycle)
  if (kind === 'design' || kind === 'spec') {
    if (!status) report(rel, 1, 'frontmatter', kind + ' 缺少 status')
    else if (!DESIGN_STATUS.has(status)) report(rel, at('status'), 'frontmatter-value', kind + ' 的 status 无效：' + status)
  }
  if (kind === 'decision') {
    if (!status) report(rel, 1, 'frontmatter', 'decision 缺少 status')
    else if (!DECISION_STATUS.has(status)) report(rel, at('status'), 'frontmatter-value', 'decision 的 status 无效：' + status)
    const needsImplementation = status === 'accepted' || status === 'superseded'
    if (needsImplementation && !implementation) report(rel, at('status'), 'frontmatter', status + ' 的决定缺少 implementation')
    if (implementation && !needsImplementation) report(rel, at('implementation'), 'frontmatter-value', '只有 accepted 或 superseded 的决定记录 implementation')
    if (implementation && !IMPLEMENTATION.has(implementation)) report(rel, at('implementation'), 'frontmatter-value', 'implementation 无效：' + implementation)
    if (category && !CATEGORIES.has(category)) report(rel, at('category'), 'frontmatter-value', 'category 无效：' + category)
  }
  if (lifecycle === 'deprecated' || lifecycle === 'archived') {
    const dateKey = lifecycle + '-at'
    const date = get(dateKey)
    if (!date || !DATE.test(date)) report(rel, at('lifecycle'), 'lifecycle-notice', lifecycle + ' 文档需要 ' + dateKey + ': YYYY-MM-DD')
    if (!doc.bodyLines.join('\n').includes('文档状态')) {
      report(rel, at('lifecycle'), 'lifecycle-notice', lifecycle + ' 文档需要在标题后写“文档状态”说明及后继或退出依据')
    }
  }
}

function checkPlaceholders(rel: string, doc: ParsedDoc, report: Report): void {
  const description = doc.frontmatter?.values.get('description')
  if (description?.startsWith('填写')) {
    report(rel, doc.frontmatter?.lines.get('description') ?? 1, 'template-placeholder', 'description 仍是模板占位')
  }
  doc.bodyLines.forEach((line, i) => {
    if (/^#{1,6}\s+填写/.test(line) || /\|\s*填写\s*(?=\|)/.test(line)) {
      report(rel, i + 1, 'template-placeholder', '残留模板占位：' + line.trim().slice(0, 60))
    }
  })
}

export function checkDocs(root: string): CheckResult {
  const absRoot = path.resolve(root)
  const files = collectFiles(absRoot)
  const findings: Finding[] = []
  const report: Report = (file, line, rule, message) => {
    findings.push({ file, line, rule, message })
  }
  const cache = new Map<string, ParsedDoc>()
  const load = (abs: string): ParsedDoc => {
    let doc = cache.get(abs)
    if (!doc) {
      doc = parseDoc(readFileSync(abs, 'utf8'))
      cache.set(abs, doc)
    }
    return doc
  }
  const scratchRoot = path.join(absRoot, '.scratch')
  const inScratch = (abs: string): boolean => abs === scratchRoot || abs.startsWith(scratchRoot + path.sep)
  const graph = new Map<string, Set<string>>()

  for (const rel of files) {
    const abs = path.join(absRoot, rel)
    const doc = load(abs)
    const formal = !rel.startsWith('.scratch/')
    const edges = new Set<string>()
    graph.set(rel, edges)

    for (const link of doc.links) {
      const parts = splitUrl(link.url)
      if (!parts) continue
      const targetAbs =
        parts.target === '' ? abs : parts.target.startsWith('/') ? path.join(absRoot, parts.target) : path.resolve(path.dirname(abs), parts.target)
      if (formal && parts.target !== '' && inScratch(targetAbs)) {
        report(rel, link.line, 'scratch-reference', '正式文档链接了 .scratch 中的具体材料：' + link.url)
        continue
      }
      if (!existsSync(targetAbs)) {
        report(rel, link.line, 'link-target', '链接目标不存在：' + link.url)
        continue
      }
      if (!targetAbs.endsWith('.md') || !statSync(targetAbs).isFile()) continue
      if (targetAbs !== abs) edges.add(toPosix(path.relative(absRoot, targetAbs)))
      if (parts.hash && !load(targetAbs).anchors.has(parts.hash)) report(rel, link.line, 'link-anchor', '锚点不存在：' + link.url)
    }

    if (formal) {
      for (const literal of doc.literals) {
        for (const match of literal.value.matchAll(SCRATCH_PATH)) {
          const offset = literal.value.slice(0, match.index ?? 0).split('\n').length - 1
          report(rel, literal.line + offset, 'scratch-reference', '正式文档写入了 .scratch 中的具体路径：' + match[0])
        }
      }
      if (!rel.startsWith('docs/templates/')) checkPlaceholders(rel, doc, report)
    }
    if (rel.startsWith('docs/')) checkFrontmatter(rel, doc, report)
  }

  const adrIds = new Map<string, string>()
  for (const rel of files) {
    const parts = rel.split('/')
    if (parts.length !== 3 || parts[0] !== 'docs' || parts[1] !== 'adr' || parts[2] === 'README.md') continue
    const match = ADR_NAME.exec(parts[2] ?? '')
    if (!match || !match[1]) {
      report(rel, 1, 'adr-id', 'ADR 文件名应为 NNNN-slug.md')
      continue
    }
    const previous = adrIds.get(match[1])
    if (previous) report(rel, 1, 'adr-id', 'ADR 编号 ' + match[1] + ' 与 ' + previous + ' 重复')
    else adrIds.set(match[1], rel)
    const kind = cache.get(path.join(absRoot, rel))?.frontmatter?.values.get('kind')
    if (kind && kind !== 'decision') report(rel, 1, 'frontmatter-value', 'docs/adr 下的记录 kind 应为 decision')
  }

  const start = files.includes('AGENTS.md') ? 'AGENTS.md' : files.includes('docs/README.md') ? 'docs/README.md' : null
  if (start) {
    const reached = new Set([start])
    const queue = [start]
    for (let i = 0; i < queue.length; i++) {
      for (const next of graph.get(queue[i] ?? '') ?? []) {
        if (reached.has(next) || !graph.has(next) || next.startsWith('.scratch/')) continue
        reached.add(next)
        queue.push(next)
      }
    }
    for (const rel of files) {
      if (!rel.startsWith('docs/') || reached.has(rel)) continue
      const lifecycle = cache.get(path.join(absRoot, rel))?.frontmatter?.values.get('lifecycle') || 'active'
      if (lifecycle === 'active') report(rel, 1, 'unreachable', 'active 文档无法从 ' + start + ' 经链接到达')
    }
  }

  const claude = path.join(absRoot, 'CLAUDE.md')
  let claudeStat: Stats | undefined
  try {
    claudeStat = lstatSync(claude)
  } catch {
    claudeStat = undefined
  }
  if (claudeStat && (!claudeStat.isSymbolicLink() || path.resolve(absRoot, readlinkSync(claude)) !== path.join(absRoot, 'AGENTS.md'))) {
    report('CLAUDE.md', 1, 'claude-link', 'CLAUDE.md 应是指向 AGENTS.md 的符号链接')
  }

  const unique = new Map<string, Finding>()
  for (const finding of findings) {
    const key = finding.file + ':' + finding.line + ':' + finding.rule
    if (!unique.has(key)) unique.set(key, finding)
  }
  const sorted = [...unique.values()].sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1))
  return { files, findings: sorted }
}

export function main(argv: string[]): number {
  let root = process.cwd()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--root') {
      const value = argv[i + 1]
      if (!value) {
        console.error('--root 需要目录参数')
        return 2
      }
      root = value
      i++
    } else if (arg === '--help' || arg === '-h') {
      console.log('用法：node scripts/check-docs.ts [--root <仓库根目录>]')
      return 0
    } else {
      console.error('未知参数：' + arg)
      return 2
    }
  }
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error('根目录不存在：' + root)
    return 2
  }
  const { files, findings } = checkDocs(root)
  for (const finding of findings) console.log(finding.file + ':' + finding.line + '  ' + finding.rule + '  ' + finding.message)
  if (files.length === 0) {
    console.error('未找到可检查的 Markdown 文件：' + path.resolve(root))
    return 1
  }
  console.log('检查 ' + files.length + ' 个 Markdown 文件，发现 ' + findings.length + ' 个问题。')
  return findings.length > 0 ? 1 : 0
}

const invoked = process.argv[1]
if (invoked && import.meta.url === pathToFileURL(path.resolve(invoked)).href) {
  process.exitCode = main(process.argv.slice(2))
}
