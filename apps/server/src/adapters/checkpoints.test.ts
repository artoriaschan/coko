// 回退代码的文件端口：原子替换（临时文件 + rename，不留临时文件、保留权限）、替换路径末尾的链接本身而不跟随，删除幂等。
import { lstat, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRewindFiles } from './checkpoints.ts'

let dir: string
let dataDir: string
beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'coko-rewind-files-')))
  dataDir = await realpath(await mkdtemp(join(tmpdir(), 'coko-rewind-data-')))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  await rm(dataDir, { recursive: true, force: true })
})

describe('回退代码的文件端口', () => {
  it('写入是原子替换：内容完整、目录中不留临时文件、保留原文件权限；父目录不在时创建', async () => {
    const files = createRewindFiles(dataDir)
    const path = join(dir, 'run.sh')
    await writeFile(path, 'old', { mode: 0o755 })
    await files.writeFile(path, Buffer.from('new'))
    expect(await readFile(path, 'utf8')).toBe('new')
    expect((await stat(path)).mode & 0o777).toBe(0o755)
    expect(await readdir(dir)).toEqual(['run.sh'])
    await files.writeFile(join(dir, 'a', 'b.txt'), Buffer.from('x'))
    expect(await readFile(join(dir, 'a', 'b.txt'), 'utf8')).toBe('x')
  })

  it('路径末尾是符号链接时替换链接本身，链接指向的文件不变', async () => {
    const files = createRewindFiles(dataDir)
    await writeFile(join(dir, 'target'), 'keep')
    await symlink(join(dir, 'target'), join(dir, 'link'))
    await files.writeFile(join(dir, 'link'), Buffer.from('restored'))
    expect((await lstat(join(dir, 'link'))).isSymbolicLink()).toBe(false)
    expect(await readFile(join(dir, 'target'), 'utf8')).toBe('keep')
  })

  it('删除不存在的文件不报错', async () => {
    await expect(createRewindFiles(dataDir).remove(join(dir, 'missing'))).resolves.toBeUndefined()
  })
})
