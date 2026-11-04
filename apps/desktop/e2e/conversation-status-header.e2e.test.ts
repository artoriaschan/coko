// Final composition: persisted statistics + reported tokens, final header, keyboard and narrow themed layouts.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { createProjectDraft, launchApp, waitConnected } from './harness.ts'

it('composes Session statistics, Token usage and header through replay in zh/en, light/dark and 390px', { timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-status-header-e2e-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  await writeFile(join(workspace, 'note.txt'), 'A readable fixture.\n')
  const usage = { input: 70, output: 20, cacheRead: 30, cacheWrite: 5, report: { complete: true, known: ['input', 'output', 'cacheRead', 'cacheWrite'] } }
  const script = join(root, 'faux.json')
  await writeFile(
    script,
    JSON.stringify({
      responses: [
        {
          match: 'STATUS-INTEGRATED',
          content: [
            { type: 'toolCall', name: 'read', id: 'read-note', arguments: { path: 'note.txt' } },
            { type: 'toolCall', name: 'bash', id: 'status-job', arguments: { command: 'echo status-job', run_in_background: true } },
            {
              type: 'toolCall',
              name: 'agent',
              id: 'status-agent',
              arguments: {
                name: 'status-helper',
                description: 'status helper',
                subagent_type: 'general',
                prompt: 'HEADER-CHILD inspect',
                run_in_background: true,
              },
            },
          ],
          usage,
          delayMs: 100,
        },
        { match: 'HEADER-CHILD', content: 'Header child complete.' },
        { content: 'Combined status accepted.', usage, delayMs: 100 },
        { content: 'Combined status accepted.', usage: { ...usage, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      ],
    }),
  )
  const app = await launchApp({ COKO_FAUX_SCRIPT: script }, { dir: root })
  onTestFinished(() => app.dispose())
  const win = app.window
  await createProjectDraft(app, workspace)
  expect(await win.locator('[data-slot="session-status-bar"]').count()).toBe(0)
  await win.locator('[data-permission-mode]').click()
  await win.locator('[role="menuitemradio"][data-mode="full-access"]').click()
  await win.getByRole('button', { name: /^(Turn on anyway|仍要开启)$/ }).click()
  await expect.poll(() => win.locator('[data-permission-mode]').getAttribute('data-permission-mode')).toBe('full-access')
  const composer = win.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
  await composer.fill('STATUS-INTEGRATED read note.txt')
  await composer.press('Enter')
  await waitConnected(win)
  await expect.poll(() => win.locator('[data-slot="assistant-message-body"]').last().textContent(), { timeout: 30_000 }).toBe('Combined status accepted.')
  const tokens = win.locator('[data-action="session-token-usage"]')
  const stats = win.locator('[data-action="session-statistics"]')
  await expect.poll(() => tokens.getAttribute('data-tokens')).toBe('250')
  const sessionId = await win.locator('[data-session-id][aria-current="page"]').getAttribute('data-session-id')
  await expect.poll(() => win.evaluate(async (id) => (await (await fetch(`/api/sessions/${id}`)).json()).session.running, sessionId)).toBe(false)
  const mainRequests = await win.evaluate(async (id) => {
    const trace = await (await fetch(`/api/sessions/${id}/trace`)).json()
    return trace.runs[0].requests.length as number
  }, sessionId)
  expect(mainRequests).toBeGreaterThanOrEqual(2)
  await expect.poll(() => stats.textContent()).toMatch(new RegExp(`1 rounds ${mainRequests} steps|1 轮 ${mainRequests} 步`))
  const initialStats = await stats.textContent()
  await win.evaluate(async (id) => {
    const response = await fetch(`/api/sessions/${id}/schedules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Later', prompt: 'later', rule: { kind: 'after', seconds: 3600 } }),
    })
    if (response.status !== 201) throw new Error(await response.text())
  }, sessionId)
  await win.reload()
  await waitConnected(win)
  await expect.poll(() => tokens.getAttribute('data-tokens')).toBe('250')
  await expect.poll(() => stats.textContent()).toBe(initialStats)
  const closePanel = win.getByRole('button', { name: /^(Close right sidebar|收起右侧边栏)$/ })
  if (await closePanel.count()) await closePanel.click()
  const header = win.locator('[data-slot="app-frame-main"] header[data-window-drag]')
  await expect
    .poll(() => header.locator('[data-action]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-action'))))
    .toEqual(['open-jobs', 'open-agents', 'open-schedules', 'open-team', 'session-menu'])
  expect(await header.locator('[data-action="handoff"], [data-action="session-cost"], [data-connection]').count()).toBe(0)
  expect(await header.evaluate((element) => element.getBoundingClientRect().height)).toBe(48)
  expect(await win.getByRole('tab', { name: /^(Conversation|对话)$/, exact: true }).getAttribute('aria-selected')).toBe('true')
  await app.app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!
    window.setMinimumSize(390, 400)
    window.setContentSize(390, 820)
  })
  await expect.poll(() => win.evaluate(() => innerWidth)).toBe(390)
  for (const locale of ['en', 'zh'] as const) {
    for (const theme of ['light', 'dark'] as const) {
      await win.keyboard.press('Meta+,')
      await win.locator(`[data-settings-page] [data-theme-option="${theme}"]`).click()
      await win.locator(`[data-settings-page] button[lang="${locale === 'zh' ? 'zh-CN' : 'en'}"]`).click()
      await expect.poll(() => win.locator('[data-slot="tooltip-content"][data-state="closed"]').count()).toBe(0)
      await win.keyboard.press('Escape')
      await win.locator('[data-settings-page]').waitFor({ state: 'detached' })
      await stats.focus()
      await win.keyboard.press('Enter')
      const statistics = win.locator('[data-slot="session-statistics-details"]')
      await statistics.waitFor()
      expect(await statistics.textContent()).toContain(locale === 'zh' ? `1 轮 ${mainRequests} 步` : `1 rounds ${mainRequests} steps`)
      const statsBox = (await statistics.boundingBox())!
      expect(statsBox.x).toBeGreaterThanOrEqual(0)
      expect(statsBox.x + statsBox.width).toBeLessThanOrEqual(390)
      await tokens.click()
      const tokenCard = win.locator('[data-slot="session-token-details"]')
      await tokenCard.waitFor()
      await statistics.waitFor({ state: 'detached' })
      expect(await tokenCard.locator('[data-usage-part="total"]').textContent()).toBe('250')
      expect(await tokenCard.textContent()).not.toMatch(/Unpriced|未定价|\$/)
      await win.keyboard.press('Escape')
      await expect.poll(() => tokens.evaluate((element) => element === document.activeElement)).toBe(true)
      await win.locator('[data-action="session-menu"]').click()
      expect(await win.getByRole('menuitem', { name: /^(Download session|Session 下载)$/ }).isVisible()).toBe(true)
      await win.keyboard.press('Escape')
      await win.getByRole('button', { name: /^(Open right sidebar|打开右侧边栏)$/ }).click()
      await win.getByRole('button', { name: /^(Close right sidebar|收起右侧边栏)$/ }).click()
      await expect
        .poll(() => win.getByRole('button', { name: /^(Open right sidebar|打开右侧边栏)$/ }).evaluate((element) => element === document.activeElement))
        .toBe(true)
      await expect.poll(() => header.getByRole('button').count()).toBe(10)
      const buttons = await header.getByRole('button').evaluateAll((elements) =>
        elements
          .filter((element) => element.checkVisibility())
          .map((element) => {
            const box = element.getBoundingClientRect()
            return { name: element.getAttribute('aria-label'), left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width }
          }),
      )
      expect(await win.evaluate(() => innerWidth)).toBe(390)
      expect(buttons).toHaveLength(10)
      if (process.env.COKO_E2E_SCREENSHOT_DIR) {
        await writeFile(
          join(process.env.COKO_E2E_SCREENSHOT_DIR, `${locale}-${theme}-geometry.json`),
          JSON.stringify(
            {
              buttons,
              frame: await win.evaluate(() => ({
                platform: document.documentElement.dataset.platform,
                leading: getComputedStyle(document.documentElement).getPropertyValue('--frame-leading-clearance'),
              })),
            },
            null,
            2,
          ),
        )
        await win.screenshot({ path: join(process.env.COKO_E2E_SCREENSHOT_DIR, `${locale}-${theme}-390-electron.png`) })
      }
      for (const button of buttons) {
        expect(button.left).toBeGreaterThanOrEqual(0)
        expect(button.right).toBeLessThanOrEqual(390)
        expect(button.width).toBeGreaterThanOrEqual(24)
      }
      for (let index = 1; index < buttons.length; index++) {
        const previous = buttons[index - 1]!
        const current = buttons[index]!
        const verticallySeparated = Math.min(previous.bottom, current.bottom) <= Math.max(previous.top, current.top)
        expect(verticallySeparated || current.left >= previous.right).toBe(true)
      }
      expect(await win.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
      expect(await win.locator('[data-slot="app-frame-main"]').evaluate((element) => element.scrollLeft)).toBe(0)
      expect(await win.locator('[data-slot="session-status-bar"]').evaluate((element) => element.getBoundingClientRect().height)).toBe(22)
    }
  }
})
