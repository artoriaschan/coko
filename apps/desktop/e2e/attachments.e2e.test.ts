import { mkdtemp, readFile, readdir, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { cokoHomeOf, launchApp, stubDirectoryPicker, waitConnected } from './harness.ts'

it('copied file attachments survive deleting the source and restarting Electron; native picker enforces the file cap', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-attachments-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'notes.txt')
  const large = join(root, 'large.txt')
  await writeFile(path, 'retained upload')
  await writeFile(large, '')
  await truncate(large, 32 * 1024 * 1024 + 1)
  const script = join(root, 'faux.json')
  await writeFile(script, JSON.stringify({ responses: [{ content: 'Attachment received.' }] }))
  const env = { COKO_FAUX_SCRIPT: script }
  let app = await launchApp(env, { dir: root })
  onTestFinished(() => app.dispose())
  let page = app.window
  await page.getByRole('heading', { level: 1, name: /^(New chat|新对话)$/ }).waitFor()
  await stubDirectoryPicker(app.app, [large, path])
  await page.getByRole('button', { name: /Add attachment|添加附件/ }).click()
  await page.getByRole('alert').filter({ hasText: /32 MB/ }).waitFor()
  expect(await page.locator('[data-slot="file-drafts"]').count()).toBe(0)
  await page.getByRole('button', { name: /Add attachment|添加附件/ }).click()
  await page.getByRole('button', { name: /^(Remove|移除) notes.txt$/ }).waitFor()
  expect(await readdir(join(cokoHomeOf(root), 'data', 'attachments')).catch(() => [])).toEqual([])
  await app.dispose()
  app = await launchApp(env, { dir: root })
  page = app.window
  await page.getByRole('button', { name: /^(Remove|移除) notes.txt$/ }).waitFor()
  await page.getByRole('button', { name: /^(Send|发送)$/ }).click()
  await page.getByRole('article', { name: 'Coko', exact: true }).filter({ hasText: 'Attachment received.' }).waitFor()
  await waitConnected(page)
  const sessionId = await page.evaluate(async () => (await (await fetch('/api/sessions')).json()).sessions[0].id as string)
  const copyRoot = join(cokoHomeOf(root), 'data', 'attachments', sessionId)
  const names = await readdir(copyRoot)
  expect(names).toHaveLength(1)
  const copy = join(copyRoot, names[0]!)
  expect(await readFile(copy, 'utf8')).toBe('retained upload')
  await rm(path)
  await app.dispose()
  app = await launchApp(env, { dir: root })
  page = app.window
  await waitConnected(page)
  await page.locator('[data-slot="copied-attachments"]').getByRole('button', { name: 'notes.txt', exact: true }).waitFor()
  expect(await page.locator('[data-slot="file-drafts"]').count()).toBe(0)
  expect(await page.locator('[data-slot="copied-attachments"] button').getAttribute('title')).toBe(copy)
  expect(await readFile(copy, 'utf8')).toBe('retained upload')
  expect(await page.evaluate(async () => window.coko!.openFile('/missing-coko-attachment'))).toBe(false)
})
