import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { withoutGitWrappers } from './test-path.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** 临时目录：wrapper/git 是指向 wrapper/git-ai 的符号链接，real/git 是普通文件，plain 中没有 git。 */
function fixture(): { wrapper: string; real: string; plain: string } {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'coko-test-path-')))
  dirs.push(base)
  const wrapper = path.join(base, 'wrapper')
  const real = path.join(base, 'real')
  const plain = path.join(base, 'plain')
  for (const dir of [wrapper, real, plain]) mkdirSync(dir)
  writeFileSync(path.join(wrapper, 'git-ai'), '#!/bin/sh\n', { mode: 0o755 })
  symlinkSync(path.join(wrapper, 'git-ai'), path.join(wrapper, 'git'))
  writeFileSync(path.join(real, 'git'), '#!/bin/sh\n', { mode: 0o755 })
  return { wrapper, real, plain }
}

describe('withoutGitWrappers', () => {
  it('去掉 git 解析到其他程序的目录，其余目录与顺序不变', () => {
    const { wrapper, real, plain } = fixture()
    expect(withoutGitWrappers([plain, wrapper, real].join(path.delimiter))).toBe([plain, real].join(path.delimiter))
  })

  it('指向名为 git 的文件的符号链接保留（例如 Homebrew 的 bin/git）', () => {
    const { real, plain } = fixture()
    symlinkSync(path.join(real, 'git'), path.join(plain, 'git'))
    expect(withoutGitWrappers([plain, real].join(path.delimiter))).toBe([plain, real].join(path.delimiter))
  })

  it('空值与不存在的目录原样保留', () => {
    expect(withoutGitWrappers(undefined)).toBeUndefined()
    expect(withoutGitWrappers('')).toBe('')
    expect(withoutGitWrappers('/no/such/dir')).toBe('/no/such/dir')
  })
})

describe.skipIf(process.platform === 'win32')('测试进程的 PATH', () => {
  // 根 vitest.config.ts 在 worker 启动前清理 PATH：git 包装（如 git-ai）会为每个临时 HOME 留下一个后台进程，累积后耗尽进程表。
  it('PATH 上的 git 解析到名为 git 的程序', () => {
    const found = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()
    expect(path.basename(realpathSync(found))).toBe('git')
  })
})
