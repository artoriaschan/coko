import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const SOURCE_ROOTS = ['packages/ui/src', 'apps/desktop/src/renderer']
const BROWSER_CONFIGS = ['packages/ui/vitest.browser.config.ts', 'apps/desktop/vitest.browser.config.ts']
// 已知会在 Browser Mode 运行中途触发预构建的深层导入：@lexical/react 与 radix-ui 的子路径。
const DEEP_IMPORT = /from '((?:@lexical\/react|radix-ui)\/[A-Za-z]+)'/g

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

function deepImports(): string[] {
  const found = new Set<string>()
  for (const dir of SOURCE_ROOTS) {
    for (const file of sourceFiles(path.join(root, dir))) {
      for (const match of readFileSync(file, 'utf8').matchAll(DEEP_IMPORT)) found.add(match[1]!)
    }
  }
  return [...found].sort()
}

describe('Browser Mode 预构建清单', () => {
  it.each(BROWSER_CONFIGS)('%s 的 optimizeDeps.include 包含 browser 源码中的全部深层导入', (config) => {
    const imports = deepImports()
    expect(imports.length).toBeGreaterThan(0)
    const text = readFileSync(path.join(root, config), 'utf8')
    expect(imports.filter((specifier) => !text.includes(`'${specifier}'`))).toEqual([])
  })
})
