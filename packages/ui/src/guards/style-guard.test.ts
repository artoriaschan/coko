import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { styleGuardExceptions } from './style-guard-exceptions.ts'
import { checkStyleSource, type StyleRule } from './style-guard.ts'

const rulesOf = (path: string, content: string): StyleRule[] => checkStyleSource({ path, content }).map((v) => v.rule)

describe('样式守卫规则', () => {
  describe('颜色', () => {
    it.each([
      ['TSX 中的任意颜色值', 'x.tsx', `<div className="bg-[#fff]" />`],
      ['TSX 中的 rgb 字面量', 'x.tsx', `const s = { color: 'rgb(1 2 3)' }`],
      ['业务组件中的 dark: 变体', 'x.tsx', `<div className="dark:bg-muted" />`],
      ['Tailwind 默认色板类', 'x.tsx', `<div className="text-red-500" />`],
      ['bg-white / text-black', 'x.tsx', `<div className="bg-white text-black" />`],
      ['引用 --palette-*', 'x.tsx', `<div className="bg-(--palette-ink)" />`],
      ['组件 CSS 中的 hex 颜色', 'x.css', `.a { color: #123456; }`],
      ['主题样式表色板外的字面量颜色', 'packages/ui/src/styles/theme.css', `:root { --background: #fff; }`],
    ])('%s', (_name, path, content) => {
      expect(rulesOf(path, content)).toContain('color')
    })

    it('主题样式表的 --palette-* 定义允许字面量颜色', () => {
      expect(rulesOf('packages/ui/src/styles/theme.css', `:root { --palette-ink: rgb(15 17 21); --background: var(--palette-ink); }`)).toEqual([])
    })

    it('选择器中的 #id 不是颜色', () => {
      expect(rulesOf('x.css', `#root { height: 100%; }`)).toEqual([])
    })
  })

  describe('圆角', () => {
    it.each([
      ['档位外的 rounded-*', `<div className="rounded-2xl" />`],
      ['不带档位的 rounded', `<div className="rounded" />`],
      ['任意圆角值', `<div className="rounded-[6px]" />`],
      ['单边档位外', `<div className="rounded-t-3xl" />`],
    ])('%s', (_name, content) => {
      expect(rulesOf('x.tsx', content)).toContain('radius')
    })

    it('六档与单边写法通过', () => {
      expect(
        rulesOf(
          'x.tsx',
          `<div className="rounded-xs rounded-sm rounded-md rounded-lg rounded-xl rounded-panel rounded-t-lg rounded-none rounded-[inherit]" />`,
        ),
      ).toEqual([])
    })

    it('组件 CSS 中的字面圆角与未登记的 --radius-*', () => {
      expect(rulesOf('x.css', `.a { border-radius: 6px; }`)).toContain('radius')
      expect(rulesOf('x.css', `.a { --radius-huge: 40px; }`)).toContain('radius')
    })
  })

  describe('圆角曲线', () => {
    it.each([`<div className="rounded-full" />`, `<div className="rounded-[50%]" />`, `<div className="rounded-[999px]" />`])('%s', (content) => {
      expect(rulesOf('x.tsx', content)).toContain('round-curve')
    })

    it('CSS 中的 50% 圆角', () => {
      expect(rulesOf('x.css', `.a { border-radius: 50%; }`)).toContain('round-curve')
    })

    it('rounded-round 通过', () => {
      expect(rulesOf('x.tsx', `<div className="rounded-round" />`)).toEqual([])
    })
  })

  describe('材质与边框', () => {
    it('中性 1px 边框被拒绝，发丝线通过', () => {
      expect(rulesOf('x.tsx', `<div className="border" />`)).toContain('material')
      expect(rulesOf('x.tsx', `<div className="border-b-2" />`)).toContain('material')
      expect(rulesOf('x.tsx', `<div className="border-hairline border-b-hairline" />`)).toEqual([])
    })

    it('虚线与状态色边框保持 1px', () => {
      expect(rulesOf('x.tsx', `<div className="border border-dashed" />`)).toEqual([])
      expect(rulesOf('x.tsx', `<div className="border border-destructive" />`)).toEqual([])
    })

    it('边框与 elevation 阴影叠加', () => {
      expect(rulesOf('x.tsx', `<div className="border-hairline shadow-panel" />`)).toContain('material')
      expect(rulesOf('x.tsx', `<div className="border-0 shadow-panel" />`)).toEqual([])
    })
  })

  describe('菜单', () => {
    it('共享 Menu 组件以外的 menu / listbox 角色', () => {
      expect(rulesOf('apps/desktop/src/renderer/x.tsx', `<div role="menu" />`)).toContain('menu')
      expect(rulesOf('packages/ui/src/components/dropdown-menu.tsx', `<div role="menu" />`)).toEqual([])
    })

    it('在菜单组件以外使用菜单材质或模糊', () => {
      expect(rulesOf('x.tsx', `<div className="bg-menu-fill" />`)).toContain('menu')
      expect(rulesOf('x.tsx', `<div className="backdrop-blur-md" />`)).toContain('menu')
      expect(rulesOf('x.css', `.a { --menu-fill: red; }`)).toContain('menu')
    })
  })

  describe('状态', () => {
    it('不在 (hover: hover) 内的手写 :hover', () => {
      expect(rulesOf('x.css', `.a:hover { opacity: 1; }`)).toContain('hover')
      expect(rulesOf('x.css', `@media (min-width: 1px) { .a:hover { opacity: 1; } }`)).toContain('hover')
    })

    it('(hover: hover) 内的 :hover 通过', () => {
      expect(rulesOf('x.css', `@media (hover: hover) { .a:hover { opacity: 1; } }`)).toEqual([])
    })
  })

  describe('滚动条与拖拽区', () => {
    it('组件自定义滚动条', () => {
      expect(rulesOf('x.css', `.a::-webkit-scrollbar { width: 4px; }`)).toContain('scrollbar')
      expect(rulesOf('x.css', `.a { scrollbar-width: none; }`)).toContain('scrollbar')
    })

    it('组件直接设置 app-region', () => {
      expect(rulesOf('x.tsx', `<div style={{ WebkitAppRegion: 'drag' }} />`)).toContain('drag-region')
      expect(rulesOf('x.css', `.a { -webkit-app-region: drag; }`)).toContain('drag-region')
    })
  })

  describe('文案', () => {
    it.each([
      ['JSX 文本', `<button>Send</button>`],
      ['JSX 中文文本', `<span>新会话</span>`],
      ['aria-label 字面量', `<button aria-label="Close" />`],
      ['placeholder 字面量', `<input placeholder="Search" />`],
      ['title 字面量', `<div title="提示" />`],
    ])('%s', (_name, content) => {
      expect(rulesOf('x.tsx', content)).toContain('copy')
    })

    it('经字典与表达式传入的文案通过', () => {
      expect(rulesOf('x.tsx', `<button aria-label={t('sidebar.newSession')}>{t('conversation.send')}</button>`)).toEqual([])
    })

    it('泛型与比较运算不算 JSX 文本', () => {
      expect(rulesOf('x.tsx', `const a: Array<string> = []\nconst b = x > 1 && y < 2\nconst c = useState<number>(0)`)).toEqual([])
    })
  })

  it('注释中的写法不算违规', () => {
    expect(rulesOf('x.tsx', `// className="rounded-full bg-[#fff]"\n/* <span>Hi</span> */`)).toEqual([])
    expect(rulesOf('x.css', `/* .a:hover { color: #fff } */`)).toEqual([])
  })
})

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const scanRoots = ['packages/ui/src', 'apps/desktop/src/renderer']

function listSources(dir: string): string[] {
  const out: string[] = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listSources(full))
    else if (/\.(tsx|css)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

describe('仓库样式守卫', () => {
  it('packages/ui 与 renderer 的 CSS / TSX 没有违规（例外按文件与匹配登记）', () => {
    const files = scanRoots.flatMap((root) => listSources(join(repoRoot, root)))
    expect(files.length).toBeGreaterThan(0)
    const violations = files.flatMap((file) => {
      const path = relative(repoRoot, file)
      return checkStyleSource({ path, content: readFileSync(file, 'utf8') })
        .filter((v) => !styleGuardExceptions.some((e) => e.file === path && e.rule === v.rule && e.match === v.match))
        .map((v) => `${path}:${v.line} [${v.rule}] ${v.match}`)
    })
    expect(violations).toEqual([])
  })

  it('每条例外都仍然命中，没有失效的例外', () => {
    const stale = styleGuardExceptions.filter((e) => {
      const content = readFileSync(join(repoRoot, e.file), 'utf8')
      return !checkStyleSource({ path: e.file, content }).some((v) => v.rule === e.rule && v.match === e.match)
    })
    expect(stale).toEqual([])
  })
})
