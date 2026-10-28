// 命令沙箱与提权卡（票 05）：真实 Electron + 真实 Sidecar（faux）+ 真实 Seatbelt。只在 darwin 运行：其他平台没有 sandbox-exec。
// Sidecar 的 TMPDIR 指向测试目录下的 tmp，使"Workspace 外"的同级目录不在可写根内。
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { launchApp, stubDirectoryPicker, waitConnected, type LaunchedApp } from './harness.ts'

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

async function setup(script: (outside: string) => unknown) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'coko-sandbox-')))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const outside = join(root, 'outside')
  const temp = join(root, 'tmp')
  await Promise.all([mkdir(workspace), mkdir(outside), mkdir(temp)])
  await writeFile(join(root, 'faux.json'), JSON.stringify(script(outside)))
  const app = await launchApp({ COKO_FAUX_SCRIPT: join(root, 'faux.json'), TMPDIR: temp }, { dir: root })
  apps.push(app)
  await waitConnected(app.window)
  await stubDirectoryPicker(app.app, [workspace])
  await app.window
    .getByRole('button', { name: /^(Add workspace|添加工作区)$/ })
    .first()
    .click()
  await app.window.getByRole('heading', { level: 1, name: /^(New session|新会话)$/ }).waitFor()
  return { app, workspace, outside }
}

const composer = (app: LaunchedApp) => app.window.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
const card = (app: LaunchedApp) => app.window.locator('[data-slot="approval-card"]')
const toolCard = (app: LaunchedApp, n: number) => app.window.locator('[data-slot="tool-card"][data-tool="bash"]').nth(n)
const allowOnce = (app: LaunchedApp) => card(app).getByRole('button', { name: /^(Allow once|允许一次)$/ })
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )

describe.skipIf(process.platform !== 'darwin')('命令沙箱与提权卡（只在 darwin 运行）', () => {
  it('批准的越界写入被沙箱拦截并在工具卡标出；提权卡显示目标档位与理由、没有"总是允许"，允许一次后写入成功', async () => {
    const { app, outside } = await setup((outside) => ({
      responses: [
        { content: [{ type: 'toolCall', name: 'bash', id: 'b1', arguments: { command: `printf hi > ${outside}/f` } }] },
        {
          content: [
            {
              type: 'toolCall',
              name: 'bash',
              id: 'b2',
              arguments: {
                command: `printf hi > ${outside}/f`,
                sandbox_permissions: 'danger-full-access',
                justification: 'The target is outside the workspace.',
              },
            },
          ],
        },
        { content: 'Wrote it with wider access.' },
      ],
    }))
    await composer(app).click()
    await composer(app).fill('write outside')
    await composer(app).press('Enter')

    await card(app).waitFor({ timeout: 30_000 })
    await allowOnce(app).click()
    await expect.poll(() => toolCard(app, 0).getAttribute('data-status'), { timeout: 30_000 }).toBe('error')
    expect(await toolCard(app, 0).locator('[data-sandbox-denied]').textContent()).toMatch(
      /^(Blocked by the sandbox \(Workspace write\)|被沙箱拦截（可写工作区）)$/,
    )
    expect(await exists(join(outside, 'f'))).toBe(false)

    // 提权卡：同一位置接管输入区。
    await expect.poll(() => card(app).locator('[data-escalation-target]').count(), { timeout: 30_000 }).toBe(1)
    expect(await card(app).locator('[data-escalation-target]').textContent()).toMatch(/^(Full access \(no sandbox\)|完全访问（不受沙箱限制）)$/)
    expect(await card(app).locator('[data-escalation-justification]').textContent()).toBe('The target is outside the workspace.')
    expect(await card(app).locator('[data-action="allow-always"]').count()).toBe(0)
    expect(await composer(app).isVisible()).toBe(false)
    await allowOnce(app).click()
    await expect.poll(() => toolCard(app, 1).getAttribute('data-status'), { timeout: 30_000 }).toBe('done')
    expect(await toolCard(app, 1).locator('[data-approval-outcome]').textContent()).toMatch(/^(Allowed once with Full access|已以完全访问允许一次)$/)
    expect(await readFile(join(outside, 'f'), 'utf8')).toBe('hi')
    await app.window.locator('[data-action="send"]').waitFor({ timeout: 30_000 })
  })
})
