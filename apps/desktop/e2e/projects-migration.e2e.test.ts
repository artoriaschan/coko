import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { execFileSync } from 'node:child_process'
import { launchApp, waitConnected } from './harness.ts'

it('v9 Workspace 与会话升级后在项目下显示，并可继续对话', { timeout: 120000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-project-migration-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const folder = join(root, 'workspace')
  const data = join(root, 'coko-home', 'data')
  await mkdir(folder)
  await mkdir(data, { recursive: true })
  // 用独立 Node 进程构造旧版库；不把存储私有源码纳入 desktop 的编译边界。
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    const { openDatabase } = await import(process.argv[1]);
    const { MIGRATIONS } = await import(process.argv[2]);
    const old = await openDatabase({path:process.argv[3], migrations:MIGRATIONS.slice(0,9), now:Date.now, leaseTtlMs:30000,heartbeatMs:60000,busyTimeoutMs:1000});
    try {
      old.connection.db.prepare('INSERT INTO workspaces VALUES (?, ?, ?, ?)').run('existing-ws', process.argv[4], 'Migrated project', 10);
      old.connection.db.prepare('INSERT INTO sessions (id, workspace_id, title, model_provider_id, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('existing-session','existing-ws','Migrated conversation','faux','faux-1',11,12);
    } finally { old.close(); }
  `,
      new URL('../../../packages/session/src/sqlite/open.ts', import.meta.url).href,
      new URL('../../../packages/session/src/sqlite/schema.ts', import.meta.url).href,
      join(data, 'coko.db'),
      folder,
    ],
    { stdio: 'pipe' },
  )
  const script = join(root, 'faux.json')
  await writeFile(script, JSON.stringify({ responses: [{ content: 'Migration continued.', match: 'continue migrated' }] }))
  const launched = await launchApp({ COKO_FAUX_SCRIPT: script }, { dir: root })
  try {
    const win = launched.window
    await waitConnected(win)
    await win.getByRole('button', { name: 'Migrated project', exact: true }).waitFor()
    const row = win.locator('[data-session-id="existing-session"]')
    await row.waitFor()
    await row.click()
    await expect.poll(() => row.getAttribute('aria-current')).toBe('page')
    const composer = win.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
    await composer.fill('continue migrated')
    await composer.press('Enter')
    await expect.poll(() => win.getByRole('article', { name: 'Coko' }).last().textContent(), { timeout: 30000 }).toBe('Migration continued.')
    expect((await readdir(data)).some((name) => name.startsWith('coko.db.backup-v9-'))).toBe(true)
    expect(await win.locator('[data-session-id] [data-activity]').count()).toBe(0)
    expect(await win.locator('[data-session-id] [data-worktree-branch]').count()).toBe(0)
  } finally {
    await launched.dispose()
  }
})
