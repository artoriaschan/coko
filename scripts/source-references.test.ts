// 源码不依赖 .scratch 中的任务材料（docs/DOCUMENTATION_SYSTEM.md 的引用方向）：apps、packages、tests 的源码（含注释）中不出现
// 设计树标签（grilling A1、grilling F6）、票号（票 03、M3 票 11）、用户故事编号（US 12、故事 26）、里程碑规格的指代（M3 规格）或
// .scratch 路径。这些只能对照任务材料才读得懂；结论应写成文字，或指向 docs/ 下的正式正文。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const SOURCE_ROOTS = ['apps', 'packages', 'tests']
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'out', '.vite', '.vitest', '.tsbuild'])
const SOURCE_FILE = /\.(ts|tsx|mts|cts|js|mjs|cjs|css)$/

/** 一行中的任务材料引用；没有时 undefined。 */
export function taskReference(line: string): string | undefined {
  const patterns = [/grilling/i, /\.scratch\//, /票 ?\d{2}(?![\d张])/, /\bM\d+ ?(?:规格|票)/, /\bUS ?-?\d+\b/, /故事 ?\d+/]
  for (const pattern of patterns) {
    const match = pattern.exec(line)
    if (match) return match[0].trim()
  }
  return undefined
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (SKIPPED_DIRS.has(name)) continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (SOURCE_FILE.test(name)) out.push(full)
  }
  return out
}

describe('源码中的任务材料引用', () => {
  it('识别设计树标签、票号、用户故事编号、里程碑规格与 .scratch 路径；普通文字不算', () => {
    for (const line of [
      '// 熔断（grilling F5）',
      '// 压缩（票 11）',
      '// M3 票 01 的 seam',
      '// 只由票 01 修改',
      '// 见 M3 规格"预算与数值"',
      '// US 12',
      '// 故事 26',
      "// '.scratch/m3/spec.md'",
    ])
      expect({ line, found: taskReference(line) !== undefined }).toEqual({ line, found: true })
    for (const line of ['// 车票12张', '// 见 docs/subsystems/context.md#压缩', '// USB 3 设备', '// status 409', 'const m3 = 1'])
      expect({ line, found: taskReference(line) !== undefined }).toEqual({ line, found: false })
  })

  it('apps、packages、tests 的源码中没有任务材料引用', () => {
    const offending: string[] = []
    for (const dir of SOURCE_ROOTS)
      for (const file of sourceFiles(path.join(root, dir))) {
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, index) => {
            const found = taskReference(line)
            if (found) offending.push(`${path.relative(root, file)}:${index + 1}: ${found}`)
          })
      }
    expect(offending).toEqual([])
  })
})
