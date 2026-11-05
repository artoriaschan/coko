import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { openDirectory, openFile, revealFile } from './open-directory.ts'

it('Finder 只打开已存在的绝对目录，拒绝文件、丢失和非法路径并回报 shell 失败', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-open-directory-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const folder = join(root, 'folder')
  const file = join(root, 'file')
  await mkdir(folder)
  await writeFile(file, 'user content')
  const calls: string[] = []
  const shell = {
    openPath: async (path: string) => {
      calls.push(path)
      return ''
    },
  }
  expect(await openDirectory(folder, shell)).toBe(true)
  for (const input of [file, join(root, 'missing'), 'relative', null, 42]) expect(await openDirectory(input, shell)).toBe(false)
  expect(calls).toEqual([folder])
  expect(await openDirectory(folder, { openPath: async () => 'Finder failed' })).toBe(false)
  expect(
    await openDirectory(folder, {
      openPath: async () => {
        throw new Error('unavailable')
      },
    }),
  ).toBe(false)
})

it('opens only existing absolute files with the default application', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-open-file-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'notes.txt')
  await writeFile(path, 'body')
  const calls: string[] = []
  const shell = {
    openPath: async (path: string) => {
      calls.push(path)
      return ''
    },
  }
  expect(await openFile(path, shell)).toBe(true)
  for (const input of [root, join(root, 'missing'), 'relative', null]) expect(await openFile(input, shell)).toBe(false)
  expect(calls).toEqual([path])
  expect(await openFile(path, { openPath: async () => 'failed' })).toBe(false)
})

it('reveals existing absolute files and directories and rejects unavailable paths before shell', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-reveal-file-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'report.txt')
  await writeFile(path, 'report')
  const calls: string[] = []
  const shell = {
    showItemInFolder: (value: string) => {
      calls.push(value)
    },
  }
  expect(await revealFile(path, shell)).toBe(true)
  expect(await revealFile(root, shell)).toBe(true)
  for (const input of [join(root, 'missing'), 'relative', null]) expect(await revealFile(input, shell)).toBe(false)
  expect(calls).toEqual([path, root])
  expect(
    await revealFile(path, {
      showItemInFolder: () => {
        throw new Error('unavailable')
      },
    }),
  ).toBe(false)
})
