import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { createFixtureDir } from '../tests/sidecar-fixture.ts'
import { cokoHomeOf, launchApp, waitConnected } from './harness.ts'

it('业务库与两份日志在 COKO_HOME/data，旧 userData/data 原样保留', async () => {
  const fixture = await createFixtureDir()
  onTestFinished(fixture.dispose)
  const oldData = join(fixture.dir, 'user-data', 'data')
  await mkdir(oldData, { recursive: true })
  const oldDb = join(oldData, 'coko.db')
  await writeFile(oldDb, 'old database remains here')
  const launched = await launchApp({}, { dir: fixture.dir })
  onTestFinished(() => launched.dispose())
  await waitConnected(launched.window)
  expect(await launched.window.evaluate(async () => (await (await fetch('/api/sessions')).json()).sessions)).toEqual([])
  const data = join(cokoHomeOf(fixture.dir), 'data')
  await expect(access(join(data, 'coko.db'))).resolves.toBeUndefined()
  expect(await readFile(oldDb, 'utf8')).toBe('old database remains here')
  expect(await launched.app.evaluate(({ app }) => app.getPath('userData'))).toBe(join(fixture.dir, 'user-data'))
  await launched.dispose()
  expect(await readFile(join(data, 'logs', 'desktop.jsonl'), 'utf8')).toContain('app starting')
  expect(await readFile(join(data, 'logs', 'sidecar.jsonl'), 'utf8')).toContain('sidecar')
  await expect(access(join(fixture.dir, 'user-data', 'logs', 'desktop.jsonl'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('main 用 Electron Documents 派生会话根，并尊重显式 COKO_CHATS_ROOT', async () => {
  const defaultApp = await launchApp({ COKO_CHATS_ROOT: '' }, { sidecar: 'placeholder' })
  onTestFinished(() => defaultApp.dispose())
  await waitConnected(defaultApp.window)
  const documents = await defaultApp.app.evaluate(({ app }) => app.getPath('documents'))
  expect((await defaultApp.events()).find((event) => event.event === 'spawned')?.chatsRoot).toBe(join(documents, 'Coko'))
  await defaultApp.dispose()
  const overridden = await launchApp({}, { sidecar: 'placeholder' })
  onTestFinished(() => overridden.dispose())
  await waitConnected(overridden.window)
  expect((await overridden.events()).find((event) => event.event === 'spawned')?.chatsRoot).toBe(overridden.env.COKO_CHATS_ROOT)
})
