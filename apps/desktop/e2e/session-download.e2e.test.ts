// Real Electron + Sidecar: header JSONL uses the same redacted children export as Trace.
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { createProjectDraft, launchApp, waitConnected } from './harness.ts'

it('More downloads a redacted Session and its child as JSONL; Trace retains NDJSON', { timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-download-e2e-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const downloads = join(root, 'downloads')
  await mkdir(workspace)
  await mkdir(downloads)
  const secret = `download-${randomBytes(12).toString('hex')}`
  const script = join(root, 'faux.json')
  await writeFile(
    script,
    JSON.stringify({
      responses: [
        {
          match: 'DOWNLOAD-PARENT',
          content: [
            { type: 'toolCall', id: 'agent-one', name: 'agent', arguments: { description: 'inspect', prompt: 'DOWNLOAD-CHILD', subagent_type: 'explore' } },
          ],
        },
        { match: 'DOWNLOAD-CHILD', content: 'Downloaded child result.' },
        { match: 'DOWNLOAD-PARENT', content: 'Downloaded parent result.' },
      ],
    }),
  )
  const app = await launchApp({ COKO_FAUX_SCRIPT: script }, { dir: root })
  onTestFinished(() => app.dispose())
  const win = app.window
  await createProjectDraft(app, workspace)
  const registered = await win.evaluate((value) => window.coko!.setSecret('DOWNLOAD_TEST', value), secret)
  expect(registered).toEqual({ ok: true, hint: secret.slice(-4) })
  const composer = win.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
  await composer.fill(`DOWNLOAD-PARENT keep ${secret}`)
  await composer.press('Enter')
  await waitConnected(win)
  await expect.poll(() => win.locator('[data-slot="assistant-message-body"]').last().textContent(), { timeout: 30_000 }).toBe('Downloaded parent result.')
  const sessionId = await win.locator('[data-session-id][aria-current="page"]').getAttribute('data-session-id')
  expect(sessionId).toBeTruthy()
  await app.app.evaluate(({ session }, dir) => {
    const state = globalThis as { __sessionDownloads?: string[] }
    state.__sessionDownloads = []
    session.defaultSession.on('will-download', (_event, item) => {
      const path = `${dir}/${item.getFilename()}`
      item.setSavePath(path)
      item.once('done', (_event, status) => state.__sessionDownloads!.push(`${status}:${path}`))
    })
  }, downloads)
  await win.locator('[data-action="session-menu"]').click()
  await win.getByRole('menuitem', { name: /^(Download session|Session 下载)$/ }).click()
  const saved = () => app.app.evaluate(() => (globalThis as { __sessionDownloads?: string[] }).__sessionDownloads ?? [])
  await expect.poll(saved, { timeout: 15_000 }).toEqual([`completed:${join(downloads, `coko-session-${sessionId}.jsonl`)}`])
  const text = await readFile(join(downloads, `coko-session-${sessionId}.jsonl`), 'utf8')
  expect(text).not.toContain(secret)
  expect(text).toContain('[REDACTED:secret]')
  const lines = text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { type?: string; format?: string; sessionId: string; kind?: string })
  expect(lines[0]).toMatchObject({ type: 'header', format: 'coko-session-export', version: 1, sessionId })
  expect(lines.slice(1).some((line) => line.kind === 'agent_start')).toBe(true)
  expect(new Set(lines.slice(1).map((line) => line.sessionId)).size).toBe(2)
  expect(text).toContain('Downloaded child result.')
  await win.getByRole('button', { name: /^(Open sidebar|打开侧边栏)$/ }).click()
  await win
    .getByRole('region', { name: /^(Sidebar|侧边栏)$/ })
    .getByRole('button', { name: /^(Trace|追踪)$/ })
    .click()
  await win.locator('[data-action="export-session"]').click()
  await expect.poll(saved, { timeout: 15_000 }).toHaveLength(2)
  expect((await saved())[1]).toBe(`completed:${join(downloads, `coko-session-${sessionId}.ndjson`)}`)
  const traceText = await readFile(join(downloads, `coko-session-${sessionId}.ndjson`), 'utf8')
  expect(traceText.trim().split('\n').slice(1)).toEqual(text.trim().split('\n').slice(1))
})
