import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { createProjectDraft, launchApp, waitConnected } from './harness.ts'

it('native App: reloaded history and session switching start with fully styled Markdown', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-markdown-startup-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  const script = join(root, 'faux.json')
  const reply = '## Ready on first display\n\nA **formatted** reply.\n\n- First item\n- Second item'
  await writeFile(
    script,
    JSON.stringify({
      responses: [
        { content: reply, match: 'first markdown' },
        { content: reply, match: 'second markdown' },
      ],
    }),
  )
  const app = await launchApp({ COKO_FAUX_SCRIPT: script }, { dir: root })
  onTestFinished(() => app.dispose())
  const { window } = app
  await waitConnected(window)
  await createProjectDraft(app, workspace)
  const composer = window.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
  await composer.fill('first markdown')
  await composer.press('Enter')
  await window.locator('.conversation-markdown h2').waitFor()
  await window.locator('.conversation-assistant-actions').waitFor()
  const firstSession = await window.locator('[data-session-id][aria-current="page"]').getAttribute('data-session-id')
  expect(firstSession).toBeTruthy()
  await window
    .getByRole('button', { name: /^(New chat|新对话)$/ })
    .first()
    .click()
  await composer.fill('second markdown')
  await composer.press('Enter')
  await expect.poll(() => window.locator('[data-session-id][aria-current="page"]').getAttribute('data-session-id')).not.toBe(firstSession)
  await window.locator('.conversation-markdown h2').waitFor()
  await window.locator('.conversation-assistant-actions').waitFor()
  await window.addInitScript(() => {
    const observations: { formatted: boolean; styled: boolean }[] = []
    Reflect.set(window, '__firstMarkdownBodies', observations)
    const seen = new WeakSet<Element>()
    new MutationObserver(() => {
      for (const body of document.querySelectorAll('[data-slot="assistant-message-body"]')) {
        if (seen.has(body) || !body.textContent) continue
        seen.add(body)
        const heading = body.querySelector('h2')
        const paragraph = body.querySelector('p')
        observations.push({
          formatted: body.querySelector('.coko-markdown h2') !== null,
          styled: heading !== null && paragraph !== null && parseFloat(getComputedStyle(heading).fontSize) > parseFloat(getComputedStyle(paragraph).fontSize),
        })
      }
    }).observe(document, { childList: true, subtree: true })
  })
  await window.reload()
  await window.locator('.conversation-markdown h2').waitFor()
  await expect.poll(() => window.evaluate(() => Reflect.get(window, '__firstMarkdownBodies'))).toEqual([{ formatted: true, styled: true }])
  await window.locator(`[data-session-id="${firstSession}"]`).first().click()
  await expect
    .poll(() => window.evaluate(() => Reflect.get(window, '__firstMarkdownBodies')))
    .toEqual([
      { formatted: true, styled: true },
      { formatted: true, styled: true },
    ])
})
