// Real Electron + real Sidecar with controlled model responses; native clipboard is restored after verification.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, onTestFinished } from 'vitest'
import { createProjectDraft, launchApp, type LaunchedApp } from './harness.ts'

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

it('completed assistant footers copy raw Markdown through the host clipboard and keep usage accessible after reload and without hover', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-footers-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  const raw = '**First answer** with `literal code`.'
  const script = join(root, 'faux.json')
  await writeFile(
    script,
    JSON.stringify({
      responses: [
        { match: 'COKO_SESSION_TITLE', content: 'Footer check' },
        { content: raw, usage: { input: 70, output: 20, cacheRead: 30, cacheWrite: 5 } },
        { content: 'Second answer.', usage: { input: 100, output: 30 } },
      ],
    }),
  )
  const app = await launchApp({ COKO_FAUX_SCRIPT: script }, { dir: root })
  apps.push(app)
  const page = app.window
  await page.getByRole('heading', { level: 1 }).waitFor()
  await createProjectDraft(app, workspace)
  const composer = page.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
  for (const [index, text] of ['first prompt', 'second prompt'].entries()) {
    await composer.fill(text)
    await composer.press('Enter')
    await expect.poll(() => page.locator('[data-slot="assistant-footer"]').count()).toBe(index + 1)
    await page.locator('[data-action="send"]').waitFor()
  }
  const footer = page.locator('[data-slot="assistant-footer"]').first()
  const controls = footer.locator('[data-slot="assistant-message-actions"]')
  await page.mouse.move(0, 0)
  await expect.poll(() => controls.evaluate((el) => getComputedStyle(el).opacity)).toBe('0')
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true })
    await expect.poll(() => page.evaluate(() => matchMedia('(hover: hover)').matches)).toBe(false)
    await expect.poll(() => controls.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
  } finally {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false })
    await cdp.detach()
  }
  await footer.hover()
  const clipboard = await app.app.evaluate(({ clipboard }) => clipboard.readText())
  try {
    await controls.locator('[data-action="copy-message"]').click()
    await expect.poll(() => app.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(raw)
  } finally {
    await app.app.evaluate(({ clipboard }, text) => clipboard.writeText(text), clipboard)
  }
  expect(await page.locator('[data-slot="run-usage"]').count()).toBe(0)
  expect(await footer.textContent()).not.toMatch(/\$|Unpriced|未定价/)
  const timestamp = await footer.locator('time').getAttribute('datetime')
  expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  const trigger = controls.locator('[data-action="run-usage"]')
  await trigger.click()
  const card = page.locator('[data-slot="run-usage-details"]')
  await card.waitFor()
  await card.hover()
  expect(await controls.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
  expect(await card.textContent()).not.toMatch(/\$|Unpriced|未定价/)
  await page.keyboard.press('Escape')
  await card.waitFor({ state: 'detached' })
  expect(await trigger.evaluate((el) => el === document.activeElement)).toBe(true)
  await page.reload()
  await page.locator('[data-slot="assistant-footer"]').first().waitFor()
  expect(await page.locator('[data-slot="assistant-footer"]').count()).toBe(2)
  expect(await page.locator('[data-slot="assistant-footer"]').first().locator('time').getAttribute('datetime')).toBe(timestamp)
})

it('failed and stopped Runs without assistant text keep one no-cost footer each across reload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-ended-footers-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  const script = join(root, 'faux.json')
  await writeFile(
    script,
    JSON.stringify({
      responses: [
        { match: 'COKO_SESSION_TITLE', content: 'Ending check' },
        { content: '', stopReason: 'error', errorMessage: 'faux model exploded', usage: { input: 11, output: 3 } },
        { content: [{ type: 'toolCall', name: 'bash', id: 'wait', arguments: { command: 'sleep 30' } }], usage: { input: 3, output: 1 } },
        { content: 'Must not be called' },
      ],
    }),
  )
  const app = await launchApp({ COKO_FAUX_SCRIPT: script }, { dir: root })
  apps.push(app)
  const page = app.window
  await page.getByRole('heading', { level: 1 }).waitFor()
  await createProjectDraft(app, workspace)
  await page.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ }).fill('test the ending')
  await page.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ }).press('Enter')
  const error = page.locator('[data-run-status="error"]')
  await error.waitFor()
  const footers = page.locator('[data-slot="assistant-footer"]')
  await expect.poll(() => footers.count()).toBe(1)
  expect(await footers.first().locator('[data-action="copy-message"]').count()).toBe(0)
  // Faux counters do not carry provider-report presence. Preserve unknown rather than presenting the compatibility value as measured usage.
  expect(await footers.first().textContent()).toMatch(/Usage unavailable|未取得/)
  expect(await footers.first().textContent()).not.toContain('0 tokens')
  await error.getByRole('button', { name: /^(Retry|重试)$/ }).click()
  await page
    .locator('[data-slot="approval-card"]')
    .getByRole('button', { name: /^(Allow once|允许一次)$/ })
    .click()
  await expect.poll(() => page.locator('[data-slot="tool-card"][data-tool="bash"]').getAttribute('data-status')).toBe('running')
  // Approval is an in-flight state, so the second ending footer must not exist yet.
  expect(await footers.count()).toBe(1)
  await page.locator('[data-action="stop"]').click()
  await page.locator('[data-run-status="aborted"]').waitFor()
  await expect.poll(() => footers.count()).toBe(2)
  expect(await footers.last().locator('[data-action="copy-message"], [data-action="branch"]').count()).toBe(0)
  expect(await page.locator('[data-slot="run-usage"]').count()).toBe(0)
  const historicalControls = footers.first().locator('[data-slot="assistant-message-actions"]')
  await page.mouse.move(0, 0)
  await expect.poll(() => historicalControls.evaluate((el) => getComputedStyle(el).opacity)).toBe('0')
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true })
    await expect.poll(() => page.evaluate(() => matchMedia('(hover: hover)').matches)).toBe(false)
    await expect.poll(() => historicalControls.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
  } finally {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false })
    await cdp.detach()
  }
  const dates = await footers.locator('time').evaluateAll((els) => els.map((el) => el.getAttribute('datetime')))
  expect(dates).toHaveLength(2)
  await footers.last().locator('[data-action="run-usage"]').focus()
  await page.keyboard.press('Enter')
  const details = page.locator('[data-slot="run-usage-details"]')
  await details.waitFor()
  expect(await details.textContent()).not.toMatch(/\$|Unpriced|未定价/)
  await page.keyboard.press('Escape')
  await details.waitFor({ state: 'detached' })
  await page.reload()
  await footers.first().waitFor()
  expect(await footers.count()).toBe(2)
  expect(await footers.locator('time').evaluateAll((els) => els.map((el) => el.getAttribute('datetime')))).toEqual(dates)
  expect(await page.locator('[data-run-status="error"]').count()).toBe(1)
  expect(await page.locator('[data-run-status="aborted"]').count()).toBe(1)
})
