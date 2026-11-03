import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { createProjectDraft, launchApp } from './harness.ts'

it('real Electron and Sidecar: grep/find show recorded original results, empty and error outputs remain inspectable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-search-detail-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  await writeFile(join(workspace, 'original.ts'), Array.from({ length: 12 }, (_, index) => `const original${index + 1} = ${index + 1}`).join('\n'))
  const script = join(root, 'faux.json')
  await writeFile(
    script,
    JSON.stringify({
      responses: [
        {
          content: [
            { type: 'toolCall', id: 'g', name: 'grep', arguments: { pattern: 'const original', path: '.' } },
            { type: 'toolCall', id: 'f', name: 'find', arguments: { pattern: '*.ts' } },
            { type: 'toolCall', id: 'empty', name: 'grep', arguments: { pattern: 'no-such-value' } },
            { type: 'toolCall', id: 'error', name: 'grep', arguments: { pattern: '[' } },
          ],
        },
        { content: 'Search complete.' },
      ],
    }),
  )
  const app = await launchApp({ COKO_FAUX_SCRIPT: script }, { dir: root })
  onTestFinished(() => app.dispose())
  await app.window.getByRole('heading', { level: 1, name: /^(New chat|新对话)$/ }).waitFor()
  await createProjectDraft(app, workspace)
  const composer = app.window.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
  await composer.fill('inspect search details')
  await composer.press('Enter')
  await app.window.getByText('Search complete.', { exact: true }).waitFor({ timeout: 30_000 })
  for (const control of await app.window.locator('[data-slot="run-process-control"][aria-expanded="false"]:not(:disabled)').all()) await control.click()
  for (const header of await app.window.locator('[data-slot="process-group-header"][aria-expanded="false"]').all()) await header.click()
  const rows = app.window.locator('[data-tool="grep"], [data-tool="find"]')
  expect(await rows.count()).toBe(4)
  for (const row of await rows.all()) await row.locator('button').first().click()
  const grep = rows.nth(0)
  expect(await grep.locator('[data-search-detail]').textContent()).toContain('original.ts:1: const original1 = 1')
  expect(await grep.locator('.search-detail-body').textContent()).not.toContain('const original5 = 5')
  await grep.getByRole('button', { name: /Expand 4 more result lines|展开其余 4 行结果/ }).focus()
  await app.window.keyboard.press('Enter')
  expect(await grep.locator('.search-detail-body').textContent()).toContain('const original5 = 5')
  const clipboardBefore = await app.app.evaluate(({ clipboard }) => clipboard.readText())
  try {
    await grep.getByRole('button', { name: /^(Copy|复制)$/ }).click()
    await expect
      .poll(() => app.app.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe(
        'original.ts:1: const original1 = 1\noriginal.ts:2: const original2 = 2\noriginal.ts:3: const original3 = 3\noriginal.ts:4: const original4 = 4\noriginal.ts:5: const original5 = 5\noriginal.ts:6: const original6 = 6\noriginal.ts:7: const original7 = 7\noriginal.ts:8: const original8 = 8\noriginal.ts:9: const original9 = 9\noriginal.ts:10: const original10 = 10\noriginal.ts:11: const original11 = 11\noriginal.ts:12: const original12 = 12',
      )
  } finally {
    await app.app.evaluate(({ clipboard }, text) => clipboard.writeText(text), clipboardBefore)
  }
  await grep.locator('.structured-original summary').click()
  expect(await grep.locator('.tool-io-card').textContent()).toContain('"pattern": "const original"')
  expect(await rows.nth(1).locator('[data-search-detail]').textContent()).toContain('original.ts')
  expect(await rows.nth(2).textContent()).toContain('No matches found')
  expect(await rows.nth(3).locator('[data-search-detail]').count()).toBe(0)
  expect(await rows.nth(3).textContent()).toContain('rg: regex parse error:')
})
