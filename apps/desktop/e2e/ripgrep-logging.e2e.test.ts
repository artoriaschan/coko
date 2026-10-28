// 随包 ripgrep 与日志落盘：真实 Electron + 真实 Sidecar（faux provider），断言窗口状态、工具结果与日志文件。
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { launchApp, stubDirectoryPicker, waitConnected, waitFor, processExists, type LaunchedApp } from './harness.ts'
import { readLogRecords, TOKEN_SHAPED } from './logs.ts'

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  return dir
}

const status = (app: LaunchedApp) => app.window.locator('[role="status"]')

describe('随包 ripgrep', () => {
  it('rg 路径不可执行时 Sidecar fatal，窗口显示失败状态与错误码', async () => {
    const root = await tempDir('coko-rg-')
    const rg = join(root, 'rg')
    await writeFile(rg, '#!/bin/sh\n')
    await chmod(rg, 0o644)
    const app = await launchApp({ COKO_RIPGREP_PATH: rg }, { dir: root })
    apps.push(app)
    await expect.poll(() => status(app).getAttribute('data-connection'), { timeout: 30_000 }).toBe('failed')
    expect(await app.window.locator('[data-error-code]').getAttribute('data-error-code')).toBe('ripgrep-unavailable')
    const pids = await app.sidecarPids()
    await waitFor(() => pids.every((pid) => !processExists(pid)), 10_000, 'sidecar exit')
  })

  it('grep 经随包 ripgrep 执行；desktop.jsonl 与 sidecar.jsonl 落盘且已脱敏', async () => {
    const root = await tempDir('coko-rg-')
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    await writeFile(join(workspace, 'notes.txt'), 'alpha\nneedle in the haystack\n')
    const script = join(root, 'faux.json')
    await writeFile(
      script,
      JSON.stringify({
        responses: [{ content: [{ type: 'toolCall', name: 'grep', id: 'g1', arguments: { pattern: 'needle' } }] }, { content: 'Found the needle.' }],
      }),
    )
    const app = await launchApp({ COKO_FAUX_SCRIPT: script }, { dir: root })
    apps.push(app)
    await waitConnected(app.window)

    await stubDirectoryPicker(app.app, [workspace])
    await app.window
      .getByRole('button', { name: /^(Add workspace|添加工作区)$/ })
      .first()
      .click()
    const composer = app.window.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
    await composer.click()
    await composer.fill('find the needle')
    await composer.press('Enter')
    const card = app.window.locator('[data-slot="tool-card"][data-tool="grep"]')
    await expect.poll(() => card.getAttribute('data-status'), { timeout: 30_000 }).toBe('done')
    await card.locator('[aria-expanded]').first().click()
    await expect.poll(() => card.textContent()).toContain('notes.txt:2: needle in the haystack')
    await app.window.locator('[data-action="send"]').waitFor({ timeout: 30_000 })

    // renderer 经 preload 转发的日志；密钥形态的值必须在落盘前脱敏。
    await app.window.evaluate(() =>
      window.coko!.log({
        level: 'warning',
        category: ['e2e'],
        message: 'e2e marker sk-e2eSecretValue123',
        properties: { apiKey: 'plain-secret-value', source: 'main' },
      }),
    )
    await app.dispose()

    const logs = join(root, 'user-data', 'logs')
    const desktop = await readLogRecords(join(logs, 'desktop.jsonl'))
    const sidecar = await readLogRecords(join(logs, 'sidecar.jsonl'))
    expect(desktop.map((r) => r.message)).toEqual(expect.arrayContaining(['app starting', 'sidecar ready', 'app quitting']))
    expect(desktop.every((r) => r.properties.process === 'desktop')).toBe(true)
    const marker = desktop.find((r) => r.logger === 'coko.renderer.e2e')
    expect(marker).toMatchObject({ level: 'WARN', message: 'e2e marker [REDACTED]', properties: { source: 'renderer', apiKey: '[REDACTED]' } })

    const desktopRoot = new URL('..', import.meta.url).pathname
    const selected = sidecar.find((r) => r.message === 'grep implementation selected')
    expect(selected?.properties).toMatchObject({ implementation: 'ripgrep', path: join(desktopRoot, 'dist', 'ripgrep', 'rg') })
    expect(sidecar.some((r) => r.message === 'run ended' && r.properties.status === 'completed')).toBe(true)

    for (const file of ['desktop.jsonl', 'sidecar.jsonl']) {
      const text = await readFile(join(logs, file), 'utf8')
      expect(text).not.toContain('plain-secret-value')
      expect(text).not.toContain('sk-e2eSecretValue123')
      expect(text).not.toMatch(TOKEN_SHAPED)
      expect(text).not.toMatch(/coko-session=(?!\[REDACTED\])/)
    }
  })
})
