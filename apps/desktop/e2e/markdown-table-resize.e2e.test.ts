import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { createProjectDraft, launchApp, waitConnected } from './harness.ts'

it('native App: offscreen Markdown tables keep natural row and scroll-container heights after window resizes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-table-resize-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const artifacts = await mkdtemp(join(tmpdir(), 'coko-table-resize-artifacts-'))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  const script = join(root, 'faux.json')
  const markdown = await readFile(new URL('../tests/fixtures/markdown-table.txt', import.meta.url), 'utf8')
  await writeFile(script, JSON.stringify({ tokensPerSecond: 1000, responses: [{ content: markdown }] }))
  const app = await launchApp({ COKO_FAUX_SCRIPT: script }, { dir: root })
  onTestFinished(() => app.dispose())
  await waitConnected(app.window)
  await createProjectDraft(app, workspace)
  const composer = app.window.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
  await composer.fill('show a tool table')
  await composer.press('Enter')
  await app.window.locator('.conversation-assistant-actions').waitFor()
  await app.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setMinimumSize(390, 400))
  for (const width of [600, 1600, 900, 1400]) {
    await app.window.locator('.conversation-message-scroll').evaluate((outer) => {
      outer.scrollTop = outer.scrollHeight
    })
    await expect
      .poll(() =>
        app.window.locator('[data-streamdown="table"]').evaluate((table) => {
          const outer = document.querySelector('.conversation-message-scroll')!
          return table.getBoundingClientRect().bottom < outer.getBoundingClientRect().top
        }),
      )
      .toBe(true)
    await app.app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]!.setSize(width, 1000), width)
    await expect.poll(() => app.window.evaluate(() => innerWidth)).toBe(width)
    await app.window.locator('.conversation-message-scroll').evaluate((outer) => {
      outer.scrollTop = 0
    })
    await app.window.locator('[data-streamdown="table-wrapper"]').screenshot({ path: join(artifacts, `table-${width}.png`) })
    const metrics = await app.window.locator('[data-streamdown="table"]').evaluate((table) => {
      const rows = [...table.querySelectorAll('tr')]
      return rows.map((row) => {
        const ink = Math.max(
          ...[...row.cells].map((cell) => {
            const range = document.createRange()
            range.selectNodeContents(cell)
            return range.getBoundingClientRect().height
          }),
        )
        return { height: row.getBoundingClientRect().height, ink }
      })
    })
    expect(metrics.every((row) => row.height <= row.ink + 28)).toBe(true)
    expect(
      await app.window.locator('[data-streamdown="table"]').evaluate((table) => table.parentElement!.scrollHeight - table.parentElement!.clientHeight),
    ).toBeLessThanOrEqual(1)
  }
  console.info(`Table resize captures: ${artifacts}`)
})
