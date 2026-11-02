import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { launchApp, stubDirectoryPicker, waitConnected } from './harness.ts'

it('CW-63: native picker reads a chosen image, drafts survive Electron restart and image-only messages render in new and existing sessions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-images-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'pixel.png')
  await writeFile(path, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1cAAAAASUVORK5CYII=', 'base64'))
  const largePath = join(root, 'large.png')
  await writeFile(largePath, Buffer.alloc(4.5 * 1024 * 1024 + 1))
  const script = join(root, 'faux.json')
  await writeFile(
    script,
    JSON.stringify({ input: ['text', 'image'], responses: [{ content: 'First image received.' }, { content: 'Second image received.' }] }),
  )
  const env = { COKO_FAUX_SCRIPT: script }
  let app = await launchApp(env, { dir: root })
  onTestFinished(() => app.dispose())
  let page = app.window
  await waitConnected(page)
  expect(
    await page.evaluate(async (path) => {
      try {
        await window.coko!.readPickedImage(path)
        return false
      } catch {
        return true
      }
    }, path),
  ).toBe(true)
  await stubDirectoryPicker(app.app, [largePath, path])
  await page.getByRole('button', { name: /Add attachment|添加附件/ }).click()
  await page
    .getByRole('alert')
    .filter({ hasText: /4.5 MB/ })
    .waitFor()
  await page.getByRole('button', { name: /Add attachment|添加附件/ }).click()
  await page.getByRole('img', { name: 'pixel.png', exact: true }).waitFor()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('coko.new-chat.v1')!).imageRefs)).toHaveLength(1)
  await page.setViewportSize({ width: 1100, height: 780 })
  await page.screenshot({ path: '/tmp/coko-image-draft-light.png' })
  await page.setViewportSize({ width: 390, height: 780 })
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await page.screenshot({ path: '/tmp/coko-image-draft-narrow-dark.png' })
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
  await app.dispose()
  app = await launchApp(env, { dir: root })
  page = app.window
  await waitConnected(page)
  await page.getByRole('img', { name: 'pixel.png', exact: true }).waitFor()
  await page.getByRole('button', { name: /^(Send|发送)$/ }).click()
  await page.getByRole('article', { name: 'Coko', exact: true }).filter({ hasText: 'First image received.' }).waitFor()
  await page.getByRole('img', { name: /^(Image attachment|图片附件)$/ }).waitFor()
  expect(await page.getByRole('img', { name: /^(Image attachment|图片附件)$/ }).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1)
  expect(await page.evaluate(async () => (await (await fetch('/api/sessions')).json()).sessions[0].title)).toBe('附件：pixel.png')
  await stubDirectoryPicker(app.app, [path])
  await page.getByRole('button', { name: /Add attachment|添加附件/ }).click()
  await page.getByRole('img', { name: 'pixel.png', exact: true }).waitFor()
  await app.dispose()
  app = await launchApp(env, { dir: root })
  page = app.window
  await waitConnected(page)
  await page.getByRole('img', { name: 'pixel.png', exact: true }).waitFor()
  await page.getByRole('button', { name: /^(Send|发送)$/ }).click()
  // The faux script restarts with Electron; either reply proves the actual image submission completed.
  await expect.poll(() => page.getByRole('img', { name: /^(Image attachment|图片附件)$/ }).count()).toBe(2)
  await expect.poll(() => page.locator('[data-slot="image-drafts"] img').count()).toBe(0)
  await page.getByRole('button', { name: /^(New chat|新对话)$/ }).click()
  expect(await page.locator('[data-slot="image-drafts"] img').count()).toBe(0)
})
