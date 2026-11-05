import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { createFixtureDir } from '../tests/sidecar-fixture.ts'
import { cokoHomeOf, launchApp, waitConnected } from './harness.ts'

it('设置显示运行中的覆盖路径；不存在的目录经原生 bridge 打开失败时有明确提示', async () => {
  const fixture = await createFixtureDir()
  onTestFinished(fixture.dispose)
  const chatsRoot = join(fixture.dir, 'DocumentsOverride', 'Coko')
  const launched = await launchApp({ COKO_CHATS_ROOT: chatsRoot }, { dir: fixture.dir })
  onTestFinished(() => launched.dispose())
  await waitConnected(launched.window)
  await launched.window.getByRole('button', { name: /^(Settings|设置)$/ }).click()
  const settings = launched.window.locator('[data-settings-page]')
  const paths = settings.locator('[data-storage-path]')
  await expect.poll(() => paths.count()).toBe(2)
  expect(await settings.locator('[data-storage-path="home"]').textContent()).toBe(cokoHomeOf(fixture.dir))
  expect(await settings.locator('[data-storage-path="chatsRoot"]').textContent()).toBe(chatsRoot)
  const card = settings.getByRole('group', { name: /^(Storage|存储)$/ })
  expect(await card.locator('input').count()).toBe(0)
  await settings.getByRole('button', { name: /^(Open chats and projects folder|打开对话与项目目录)$/ }).click()
  await settings.getByRole('alert').waitFor()
  expect(await settings.getByRole('alert').textContent()).toMatch(/(目录不存在或无法打开|The folder does not exist or could not be opened)/)
  expect(await settings.getByRole('alert').textContent()).toContain(chatsRoot)
  expect(await settings.textContent()).toContain('COKO_HOME')
})
