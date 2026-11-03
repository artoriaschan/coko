import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { createProjectDraft, launchApp, waitConnected } from './harness.ts'

it('native App: a real reading gesture holds streamed output through settlement and completion; persisted history reopens at its real tail', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-reading-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  await writeFile(join(workspace, 'reading.txt'), 'Recorded file contents\n'.repeat(60))
  const script = join(root, 'faux.json')
  const answer = Array.from({ length: 60 }, (_, i) => `Native reading marker ${i}. ${'Original answer paragraph. '.repeat(4)}`).join('\n\n')
  await writeFile(
    script,
    JSON.stringify({
      tokensPerSecond: 200,
      responses: [
        {
          content: [
            { type: 'text', text: answer },
            ...Array.from({ length: 24 }, (_, i) => ({ type: 'toolCall', id: `read-native-${i}`, name: 'read', arguments: { path: 'reading.txt' } })),
          ],
        },
        { content: 'Native final answer.' },
      ],
    }),
  )
  const first = await launchApp({ COKO_FAUX_SCRIPT: script }, { dir: root })
  onTestFinished(() => first.dispose())
  await first.window.getByRole('heading', { level: 1 }).waitFor()
  await createProjectDraft(first, workspace)
  const composer = first.window.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
  await composer.fill('native reading position')
  await composer.press('Enter')
  await waitConnected(first.window)
  await first.window.waitForFunction(() => {
    const el = document.querySelector<HTMLElement>('.conversation-message-scroll')
    return el && el.scrollHeight - el.clientHeight > 1000
  })
  await first.window.locator('.conversation-message-scroll').hover()
  await first.window.mouse.wheel(0, -500)
  await first.window.waitForFunction(() => {
    const el = document.querySelector<HTMLElement>('.conversation-message-scroll')!
    return el.scrollHeight - el.clientHeight - el.scrollTop > 100
  })
  const position = await first.window
    .locator('.conversation-assistant-message')
    .first()
    .evaluate((element) => element.getBoundingClientRect().top)
  await first.window.locator('[data-slot="run-process-control"][aria-expanded="false"]').waitFor({ timeout: 30_000 })
  const completed = await first.window
    .locator('.conversation-assistant-message')
    .first()
    .evaluate((element) => element.getBoundingClientRect().top)
  expect(Math.abs(completed - position)).toBeLessThanOrEqual(1)
  await first.window.getByRole('button', { name: /Return to bottom|返回底部/ }).click()
  await expect
    .poll(() => first.window.locator('.conversation-message-scroll').evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop))
    .toBeLessThanOrEqual(1)
  const whole = first.window.locator('[data-slot="run-process-control"]')
  await whole.click()
  await first.window.locator('[data-slot="process-group-header"]').click()
  const group = first.window.locator('[data-slot="process-group-body"]')
  await first.window.waitForFunction(() => {
    const body = document.querySelector<HTMLElement>('[data-slot="process-group-body"]')!
    return body.clientHeight === 400 && getComputedStyle(body).overflowY === 'auto'
  })
  expect(await group.evaluate((el) => el.scrollTop)).toBe(0)
  const outerBefore = await first.window.locator('.conversation-message-scroll').evaluate((el) => el.scrollTop)
  await group.hover()
  await first.window.mouse.wheel(0, 180)
  await expect.poll(() => group.evaluate((el) => el.scrollTop)).toBeGreaterThan(100)
  expect(await first.window.locator('.conversation-message-scroll').evaluate((el) => el.scrollTop)).toBe(outerBefore)
  await first.window.mouse.wheel(0, -1000)
  await expect.poll(() => group.evaluate((el) => el.scrollTop)).toBe(0)
  await group.hover()
  const edgeBefore = await first.window.locator('.conversation-message-scroll').evaluate((el) => el.scrollTop)
  await first.window.mouse.wheel(0, -120)
  await expect.poll(() => first.window.locator('.conversation-message-scroll').evaluate((el) => el.scrollTop)).toBeLessThan(edgeBefore - 20)
  expect(await group.evaluate((el) => el.scrollTop)).toBe(0)
  await whole.click()
  await first.window.locator('[data-slot="process-seat"][hidden]').waitFor({ state: 'attached' })
  const returnButton = first.window.getByRole('button', { name: /Return to bottom|返回底部/ })
  if (await returnButton.count()) await returnButton.click()
  const title = await first.window.getByRole('heading', { level: 1 }).innerText()
  await first.dispose()
  const second = await launchApp({}, { dir: root })
  onTestFinished(() => second.dispose())
  await second.window.getByRole('heading', { level: 1, name: title }).waitFor()
  await second.window.getByText('Native final answer.', { exact: true }).waitFor()
  await expect
    .poll(() => second.window.locator('.conversation-message-scroll').evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop))
    .toBeLessThanOrEqual(1)
})
