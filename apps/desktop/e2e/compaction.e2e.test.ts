// 压缩：真实 Electron + 真实 Sidecar（faux 模型，60k 窗口）。自动压缩的摘要连续失败：每次一个 Toast，第 3 次后上下文环旁出现暂停
// 标记；/compact 进行中输入区上方显示"正在压缩上下文…"；完成后时间线出现分隔条（约节省 N tokens），可展开摘要，之前的消息仍可查看，
// 暂停标记消失。
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { launchApp, stubDirectoryPicker, waitConnected, type LaunchedApp } from './harness.ts'

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

const composerOf = (page: Page) => page.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })

/** 经协议代理提交（长消息不经编辑区输入），等到该会话的 run_end 条目数达到 n。 */
async function submit(page: Page, sessionId: string, text: string, runEnds: number) {
  const status = await page.evaluate(
    async ({ id, body }) =>
      (await fetch('/api/sessions/' + id + '/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status,
    { id: sessionId, body: JSON.stringify({ text }) },
  )
  expect(status).toBe(202)
  await expect
    .poll(
      () =>
        page.evaluate(async (id) => {
          const detail = (await (await fetch('/api/sessions/' + id)).json()) as { entries: { kind: string }[] }
          return detail.entries.filter((e) => e.kind === 'run_end').length
        }, sessionId),
      { timeout: 30_000 },
    )
    .toBe(runEnds)
}

describe('压缩', () => {
  it('自动压缩失败 Toast 与熔断暂停标记；/compact 状态行、分隔条与摘要展开', { timeout: 150_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'coko-compaction-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    const fail = { content: 'partial', stopReason: 'length' }
    const summary = '## Goal\nKeep the API design.\n\n' + 'Details of the interface design. '.repeat(120)
    await writeFile(
      join(root, 'faux.json'),
      JSON.stringify({
        contextWindow: 60_000,
        maxTokens: 4_000,
        tokensPerSecond: 400,
        responses: [
          { content: 'first reply' },
          { content: 'ok1' },
          fail,
          { content: 'ok2' },
          fail,
          { content: 'ok3' },
          fail,
          { content: 'ok4' },
          { content: summary },
        ],
      }),
    )
    const app = await launchApp({ COKO_FAUX_SCRIPT: join(root, 'faux.json') }, { dir: root })
    apps.push(app)
    const page = app.window
    await waitConnected(page)
    await stubDirectoryPicker(app.app, [workspace])
    await page
      .getByRole('button', { name: /^(Add workspace|添加工作区)$/ })
      .first()
      .click()
    await page.getByRole('heading', { level: 1, name: /^(New session|新会话)$/ }).waitFor()
    await composerOf(page).click()
    await page.keyboard.type('start')
    await page.keyboard.press('Enter')
    await expect.poll(() => page.getByRole('article', { name: 'Coko' }).count(), { timeout: 20_000 }).toBe(1)
    const sessionId = await page.evaluate(async () => ((await (await fetch('/api/sessions')).json()) as { sessions: { id: string }[] }).sessions[0]!.id)

    // 越过阈值的历史：之后三次请求前的自动压缩都失败（摘要被截断）。每次一个 Toast；第 3 次后自动压缩暂停。
    await submit(page, sessionId, 'p'.repeat(100_000), 2)
    await submit(page, sessionId, 'q'.repeat(80_000), 3)
    await expect.poll(() => page.locator('[data-sonner-toast]').count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(1)
    expect(await page.locator('[data-sonner-toast]').first().textContent()).toMatch(/Could not compact the context|压缩上下文失败/)
    await submit(page, sessionId, 'r', 4)
    await submit(page, sessionId, 's', 5)
    const paused = page.locator('[data-slot="auto-compact-paused"]')
    await paused.waitFor({ timeout: 15_000 })
    expect(await paused.getAttribute('aria-label')).toMatch(/\/compact/)
    expect(await page.locator('[data-slot="compaction-divider"]').count()).toBe(0)

    // /compact：进行中显示状态行，完成后出现分隔条，暂停标记消失。
    await composerOf(page).click()
    await page.keyboard.type('/compact keep the API design')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Enter')
    const status = page.locator('[data-slot="compaction-status"]')
    await status.waitFor({ timeout: 15_000 })
    expect(await status.textContent()).toMatch(/Compacting context…|正在压缩上下文…/)
    const divider = page.locator('[data-slot="compaction-divider"]')
    await divider.waitFor({ timeout: 30_000 })
    await status.waitFor({ state: 'detached', timeout: 15_000 })
    expect(await divider.getAttribute('data-trigger')).toBe('manual')
    expect(await divider.locator('summary').textContent()).toMatch(/(Context compacted|已压缩上下文) · (saved about|约节省) [\d,]+ tokens/)
    await paused.waitFor({ state: 'detached', timeout: 15_000 })

    // 展开摘要；之前的消息仍在时间线中。
    await divider.locator('summary').click()
    await expect.poll(() => divider.locator('[data-slot="compaction-summary"]').textContent()).toContain('Keep the API design.')
    expect(await page.getByRole('article', { name: 'Coko' }).first().textContent()).toBe('first reply')
    expect(await page.locator('[data-run-status="error"]').count()).toBe(0)
  })
})
