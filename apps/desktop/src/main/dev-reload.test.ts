import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { watchSidecarReload, type ReloadWatcher } from './dev-reload.ts'

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function setup(initial?: string) {
  const dir = await mkdtemp(join(tmpdir(), 'coko-dev-reload-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'sidecar-build')
  if (initial !== undefined) await writeFile(file, initial)
  let count = 0
  let notify: (() => void) | undefined
  const watcher: ReloadWatcher = watchSidecarReload(
    file,
    () => {
      count++
      notify?.()
    },
    { debounceMs: 20 },
  )
  cleanups.push(() => watcher.close())
  // 与 build.ts 相同：先写临时文件再 rename 替换。
  const replace = async (content: string) => {
    const temporary = file + '.tmp'
    await writeFile(temporary, content)
    await rename(temporary, file)
  }
  const next = () => new Promise<void>((resolve) => (notify = resolve))
  return { dir, file, replace, next, count: () => count, watcher }
}

/** 等待一段明确的静默期，确认没有额外的回调（只用于断言"不发生"）。 */
const quiet = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('watchSidecarReload', () => {
  it('通知文件被原子替换时触发一次；之后的每次替换各触发一次', async () => {
    const env = await setup('1')
    await env.watcher.ready
    const first = env.next()
    await env.replace('2')
    await first
    const second = env.next()
    await env.replace('3')
    await second
    await quiet(150)
    expect(env.count()).toBe(2)
  })

  it('内容未变或同目录的其他文件变化时不触发', async () => {
    const env = await setup('1')
    await env.watcher.ready
    await env.replace('1')
    await writeFile(join(env.dir, 'other'), 'x')
    await quiet(200)
    expect(env.count()).toBe(0)
  })

  it('close 之后不再触发', async () => {
    const env = await setup('1')
    await env.watcher.ready
    env.watcher.close()
    await env.replace('2')
    await quiet(200)
    expect(env.count()).toBe(0)
  })
})
