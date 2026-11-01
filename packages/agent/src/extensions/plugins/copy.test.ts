// 插件安装的复制（ADR 0017）：不跟随符号链接、根内链接按相对路径重建、逃出插件根的链接使复制失败、不复制 .git、文件数与体积上限、保留可执行位。
import { existsSync } from 'node:fs'
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyPluginTree } from './index.ts'

let base: string
let src: string
let dest: string
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'coko-plugin-copy-'))
  src = join(base, 'src')
  dest = join(base, 'dest')
  await mkdir(join(src, 'bin'), { recursive: true })
  await writeFile(join(src, 'a.txt'), 'a')
  await writeFile(join(src, 'bin', 'run.sh'), '#!/bin/sh\necho ok\n')
  await chmod(join(src, 'bin', 'run.sh'), 0o755)
})
afterEach(() => rm(base, { recursive: true, force: true }))

describe('copyPluginTree', () => {
  it('复制文件与目录，保留可执行位，不复制 .git', async () => {
    await mkdir(join(src, '.git'))
    await writeFile(join(src, '.git', 'HEAD'), 'ref')
    expect(await copyPluginTree(src, dest)).toEqual({ ok: true, files: 2, bytes: 1 + '#!/bin/sh\necho ok\n'.length })
    expect(await readFile(join(dest, 'a.txt'), 'utf8')).toBe('a')
    expect((await stat(join(dest, 'bin', 'run.sh'))).mode & 0o111).not.toBe(0)
    expect(existsSync(join(dest, '.git'))).toBe(false)
  })

  it('根内的符号链接（相对或绝对）在副本中以相对路径重建，不跟随', async () => {
    await symlink('a.txt', join(src, 'rel-link'))
    await symlink(join(src, 'bin'), join(src, 'abs-link'))
    expect((await copyPluginTree(src, dest)).ok).toBe(true)
    expect((await lstat(join(dest, 'abs-link'))).isSymbolicLink()).toBe(true)
    expect(await readlink(join(dest, 'abs-link'))).toBe('bin')
    expect(await readlink(join(dest, 'rel-link'))).toBe('a.txt')
    expect(await readFile(join(dest, 'abs-link', 'run.sh'), 'utf8')).toContain('echo ok')
  })

  it.each([
    ['指向插件根外的目录', async () => symlink(join(base, 'outside'), join(src, 'skills'))],
    ['相对路径逃出插件根', async () => symlink('../../outside/secret.txt', join(src, 'bin', 'leak'))],
    ['悬空且逃出插件根', async () => symlink('../../nowhere', join(src, 'dangling'))],
  ])('对手用例：%s → outside，不写任何文件', async (_label, make) => {
    await mkdir(join(base, 'outside'))
    await writeFile(join(base, 'outside', 'secret.txt'), 'secret')
    await make()
    expect(await copyPluginTree(src, dest)).toMatchObject({ ok: false, reason: 'outside' })
    expect(existsSync(dest)).toBe(false)
  })

  it('超过文件数或总字节数上限 → too-large，不写任何文件', async () => {
    expect(await copyPluginTree(src, dest, { maxFiles: 1, maxBytes: 1000 })).toMatchObject({ ok: false, reason: 'too-large' })
    expect(await copyPluginTree(src, dest, { maxFiles: 100, maxBytes: 5 })).toMatchObject({ ok: false, reason: 'too-large' })
    expect(existsSync(dest)).toBe(false)
  })
})
