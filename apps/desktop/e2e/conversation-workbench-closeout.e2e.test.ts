import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { launchApp, stubDirectoryPicker, waitConnected } from './harness.ts'

async function fixture(script: unknown = { responses: [] }) {
  const root = await mkdtemp(join(tmpdir(), 'coko-cw-closeout-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const folder = join(root, 'example-project')
  await mkdir(folder)
  await writeFile(join(folder, 'notes.txt'), 'Example source retained.\n')
  const scriptPath = join(root, 'faux.json')
  await writeFile(scriptPath, JSON.stringify(script))
  const app = await launchApp({ COKO_FAUX_SCRIPT: scriptPath, COKO_TEST_CLOCK: '1' }, { dir: root })
  onTestFinished(() => app.dispose())
  await waitConnected(app.window)
  return { root, folder, app, page: app.window }
}

const editor = (page: Page) => page.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
const search = (page: Page) => page.getByRole('dialog', { name: /^(Search conversations|搜索对话)$/ })

it('closeout: project creation → first send → model title → persisted ownership and visible list', async () => {
  const { folder, app, page } = await fixture({
    responses: [{ match: 'COKO_SESSION_TITLE', content: 'Example calendar', delayMs: 1000 }, { content: 'Example project ready.' }],
  })
  await stubDirectoryPicker(app.app, [folder])
  await page.getByRole('button', { name: /^(Add project|创建项目)$/ }).click()
  const dialog = page.getByRole('dialog', { name: /^(Create project|创建项目)$/ })
  await dialog.getByRole('textbox', { name: /Project name|项目名称/ }).fill('Example project')
  await dialog.getByRole('button', { name: /Add folder|添加文件夹/ }).click()
  await dialog.getByRole('button', { name: /^(Create project|创建项目)$/ }).click()
  await dialog.waitFor({ state: 'detached' })
  await page.getByRole('button', { name: /Choose chat destination: Example project|选择对话归属：Example project/ }).waitFor()
  expect(await page.evaluate(async () => (await (await fetch('/api/sessions')).json()).sessions)).toHaveLength(0)
  await editor(page).fill('Plan example')
  await editor(page).press('Enter')
  await page.getByRole('article', { name: 'Coko', exact: true }).filter({ hasText: 'Example project ready.' }).waitFor()
  const placeholder = page.getByRole('button', { name: 'Plan example', exact: true })
  await placeholder.hover()
  const details = page.getByRole('region', { name: /Conversation details|对话详情/ })
  await details.getByText('Example project', { exact: true }).waitFor()
  await page.evaluate(async () => {
    const result = await fetch('/api/test/clock', { method: 'POST', body: JSON.stringify({ advanceMs: 1000 }) })
    if (!result.ok) throw new Error('clock advance failed')
  })
  await page.getByRole('button', { name: 'Example calendar', exact: true }).waitFor()
  await details.getByText('Example calendar', { exact: true }).waitFor()
  const saved = await page.evaluate(async () => ({
    projects: (await (await fetch('/api/projects')).json()).projects,
    sessions: (await (await fetch('/api/sessions')).json()).sessions,
  }))
  expect(saved.projects).toHaveLength(1)
  expect(saved.sessions).toHaveLength(1)
  expect(saved.sessions[0]).toMatchObject({ title: 'Example calendar', projectId: saved.projects[0].id, workspaceId: saved.projects[0].primaryWorkspaceId })
  expect(await page.locator(`[data-project-id="${saved.projects[0].id}"] [data-session-id="${saved.sessions[0].id}"]`).count()).toBe(1)
  expect(await readFile(join(folder, 'notes.txt'), 'utf8')).toBe('Example source retained.\n')
})

it('closeout: image-only first send contributes image estimate to the visible prompt breakdown', async () => {
  const { root, app, page } = await fixture({ input: ['text', 'image'], responses: [{ content: 'Example image received.' }] })
  const image = join(root, 'example-pixel.png')
  await writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1cAAAAASUVORK5CYII=', 'base64'))
  await stubDirectoryPicker(app.app, [image])
  await page.getByRole('button', { name: /^(Add attachment|添加附件)$/ }).click()
  await page.getByRole('img', { name: 'example-pixel.png', exact: true }).waitFor()
  expect(await editor(page).textContent()).toBe('')
  await page.getByRole('button', { name: /^(Send|发送)$/ }).click()
  await page.getByRole('article', { name: 'Coko', exact: true }).filter({ hasText: 'Example image received.' }).waitFor()
  const usage = await page.evaluate(async () => {
    const { sessions } = await (await fetch('/api/sessions')).json()
    return (await fetch(`/api/sessions/${sessions[0].id}/context`)).json()
  })
  // The only submitted user content is one raster image: chars/4 = 4800/4.
  expect(usage.breakdown.prompt).toBeGreaterThanOrEqual(1200)
  expect(Object.values(usage.breakdown).reduce<number>((total, value) => total + Number(value), 0)).toBe(usage.tokens)
  await page.locator('[data-context-ring]').click()
  const card = page.locator('[data-slot="context-card"]')
  await expect.poll(() => card.locator('[data-part-value="prompt"]').textContent()).toContain(new Intl.NumberFormat('en-US').format(usage.breakdown.prompt))
  expect(await card.locator('dt').count()).toBe(5)
  await page.screenshot({ path: '/tmp/coko-cw23-image-context.png' })
  await page.keyboard.press('Escape')
  await card.waitFor({ state: 'detached' })
  expect(await page.locator('[data-context-ring]').evaluate((element) => element === document.activeElement)).toBe(true)
})

it('closeout: archived current conversation disappears from recent and matching search, persists in archive', async () => {
  const { folder, page } = await fixture()
  const target = await page.evaluate(async (path) => {
    const workspace = await (await fetch('/api/workspaces', { method: 'POST', body: JSON.stringify({ path, name: 'Example archive project' }) })).json()
    const session = await (
      await fetch('/api/sessions', { method: 'POST', body: JSON.stringify({ workspaceId: workspace.id, title: 'Example archived target' }) })
    ).json()
    return session
  }, folder)
  await page.reload()
  await waitConnected(page)
  const row = page.locator(`[data-session-id="${target.id}"]`)
  await row.click()
  await row.click({ button: 'right' })
  await page.getByRole('menuitem', { name: /^(Archive conversation|归档)$/ }).click()
  await expect.poll(() => row.count()).toBe(0)
  await page.getByRole('button', { name: /^(Search|搜索)$/ }).click()
  await search(page).waitFor()
  expect(await search(page).getByRole('option').count()).toBe(0)
  await search(page).getByRole('combobox').fill('archived target')
  await search(page)
    .getByText(/No matching conversations|没有匹配的对话/)
    .waitFor()
  expect(await search(page).getByRole('option').count()).toBe(0)
  const saved = await page.evaluate(async (id) => (await (await fetch(`/api/sessions/${id}`)).json()).session, target.id)
  expect(saved).toMatchObject({ id: target.id, title: target.title, archivedAt: expect.any(Number) })
  await page.keyboard.press('Escape')
  await search(page).waitFor({ state: 'detached' })
  expect(await page.getByRole('button', { name: /^(Search|搜索)$/ }).evaluate((element) => element === document.activeElement)).toBe(true)
})

it('CW-23/42/43: final five actions from standalone, project, pinned and search sources; submenu and edge focus return', async () => {
  const { folder, page } = await fixture()
  const sessions = await page.evaluate(async (path) => {
    const workspace = await (await fetch('/api/workspaces', { method: 'POST', body: JSON.stringify({ path, name: 'Example menu project' }) })).json()
    const result = []
    for (const [title, project, pinned] of [
      ['Example standalone', false, false],
      ['Example project conversation', true, false],
      ['Example pinned', true, true],
    ] as const) {
      const session = await (await fetch('/api/sessions', { method: 'POST', body: JSON.stringify({ workspaceId: workspace.id, title }) })).json()
      if (!project) await fetch(`/api/sessions/${session.id}/project`, { method: 'PUT', body: JSON.stringify({ projectId: null }) })
      if (pinned) await fetch(`/api/sessions/${session.id}/pin`, { method: 'PUT', body: JSON.stringify({ pinned: true }) })
      const saved = await (await fetch(`/api/sessions/${session.id}`)).json()
      if ((saved.session.projectId !== null) !== project || (saved.session.pinnedAt !== null) !== pinned) {
        throw new Error('Menu fixture ownership or pin did not persist')
      }
      result.push({ id: session.id, title, pinned })
    }
    return result
  }, folder)
  await page.reload()
  await waitConnected(page)
  for (const session of sessions) {
    const row = page.locator(`[data-session-id="${session.id}"]`)
    await row.click({ button: 'right' })
    const menu = page.getByRole('menu', { name: /^(Conversation actions|对话操作)$/ })
    await menu.waitFor()
    expect(await menu.getByRole('menuitem').allTextContents()).toEqual([
      expect.stringMatching(/^(Rename|重命名)$/),
      expect.stringMatching(session.pinned ? /^(Unpin conversation|取消置顶)$/ : /^(Pin conversation|置顶)$/),
      expect.stringMatching(/^(Archive conversation|归档)$/),
      expect.stringMatching(/^(Move to project|移到项目)$/),
      expect.stringMatching(/^(Delete conversation|删除对话)$/),
    ])
    const move = menu.getByRole('menuitem', { name: /^(Move to project|移到项目)$/ })
    await move.click()
    const child = page.getByRole('menu', { name: /^(Move to project|移到项目)$/ })
    await expect.poll(() => child.getByRole('textbox').evaluate((element) => element === document.activeElement)).toBe(true)
    await expect.poll(() => page.getByRole('menu').count()).toBe(2)
    await page.keyboard.press('Escape')
    await child.waitFor({ state: 'detached' })
    expect(await move.evaluate((element) => element === document.activeElement)).toBe(true)
    await page.keyboard.press('Escape')
    await menu.waitFor({ state: 'detached' })
    expect(await row.evaluate((element) => element === document.activeElement)).toBe(true)
    await row
      .locator('..')
      .getByRole('button', { name: /^(More conversation actions|更多对话操作)$/ })
      .click()
    await menu.waitFor()
    expect(await menu.getByRole('menuitem').count()).toBe(5)
    await page.keyboard.press('Escape')
    await menu.waitFor({ state: 'detached' })
  }
  await page.getByRole('button', { name: /^(Search|搜索)$/ }).click()
  const result = search(page).getByRole('option').filter({ hasText: 'Example standalone' })
  await result.click({ button: 'right' })
  const menu = page.getByRole('menu', { name: /^(Conversation actions|对话操作)$/ })
  await menu.waitFor()
  expect(await menu.getByRole('menuitem').count()).toBe(5)
  await page.keyboard.press('Escape')
  await menu.waitFor({ state: 'detached' })
  expect(await search(page).isVisible()).toBe(true)
  await page.keyboard.press('Escape')
  await search(page).waitFor({ state: 'detached' })
})

it('CW-43/44: current Electron workbench geometry, long-list search, both themes and reduced motion at narrow main width', async () => {
  const { folder, app, page } = await fixture()
  await page.evaluate(async (path) => {
    const workspace = await (
      await fetch('/api/workspaces', { method: 'POST', body: JSON.stringify({ path, name: 'Example project with a deliberately long neutral display name' }) })
    ).json()
    for (let index = 0; index < 21; index++) {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({
          workspaceId: workspace.id,
          title: `Example conversation ${index}: a deliberately long neutral title for checking readable overflow and stable actions`,
        }),
      })
      if (!response.ok) throw new Error(`List fixture failed: ${response.status}`)
    }
  }, folder)
  await page.reload()
  await waitConnected(page)
  await app.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 1200))
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(1440)
  await page.getByRole('button', { name: /^(New chat|新对话)$/ }).click()
  const geometry = await page.evaluate(() => {
    const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect()
    const row = document.querySelector('[data-session-id]')!
    return {
      sidebar: rect('[data-slot="app-frame-sidebar"]').width,
      frameRadius: getComputedStyle(document.querySelector('[data-slot="app-frame"]')!).borderRadius,
      safeArea: rect('[data-workbench-window-controls]').height,
      nav: [...document.querySelectorAll('[data-workbench-nav]')].map((element) => element.getBoundingClientRect().height),
      rowHeight: row.getBoundingClientRect().height,
      rowFont: [getComputedStyle(row).fontSize, getComputedStyle(row).lineHeight],
      composer: rect('[data-slot="composer"]').height,
      composerWidth: rect('[data-slot="composer"]').width,
      toolbar: rect('[data-slot="composer-toolbar"]').height,
      destination:
        rect('[data-slot="destination-bar"]').height + parseFloat(getComputedStyle(document.querySelector('[data-slot="destination-bar"]')!).marginBottom),
    }
  })
  expect(geometry).toEqual({
    sidebar: 280,
    frameRadius: '28px',
    safeArea: 48,
    nav: [32, 32, 32],
    rowHeight: 32,
    rowFont: ['13px', '20px'],
    composer: 120,
    composerWidth: 768,
    toolbar: 40,
    destination: 36,
  })
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme === 'dark' ? 'dark' : 'light', reducedMotion: 'reduce' })
    await page.evaluate((theme) => document.documentElement.classList.toggle('dark', theme === 'dark'), theme)
    await page.screenshot({ path: `/tmp/coko-cw23-workbench-${theme}.png` })
    await page.getByRole('button', { name: /^(Search|搜索)$/ }).click()
    const dialog = search(page)
    await dialog.getByRole('combobox').fill('Example conversation')
    await expect.poll(() => dialog.getByRole('option').count()).toBe(21)
    expect(
      await dialog.evaluate((element) => ({
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
        radius: getComputedStyle(element).borderRadius,
      })),
    ).toEqual({ width: 640, height: 432, radius: '28px' })
    await dialog.getByRole('combobox').press('End')
    await page.screenshot({ path: `/tmp/coko-cw23-search-${theme}.png` })
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
  }
  await page.getByRole('button', { name: /^(Collapse sidebar|收起侧栏)$/ }).click()
  await app.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(520, 820))
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(520)
  await expect.poll(() => page.locator('[data-slot="app-frame-main"]').evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(390)
  await expect.poll(() => page.locator('[data-slot="composer"]').evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0)
  await page.screenshot({ path: '/tmp/coko-cw23-narrow-dark-reduced.png' })
})

it('CW-66/88: an existing Session combines shared composer, plan prior, context warning and automatic compaction', { timeout: 120_000 }, async () => {
  const { folder, page } = await fixture({
    contextWindow: 65_000,
    maxTokens: 4_000,
    responses: Array.from({ length: 10 }, () => ({ content: '## Goal\nExample retained context\n\n## Next Step\nContinue the example.' })),
  })
  const session = await page.evaluate(async (path) => {
    const workspace = await (await fetch('/api/workspaces', { method: 'POST', body: JSON.stringify({ path, name: 'Example context project' }) })).json()
    return (await fetch('/api/sessions', { method: 'POST', body: JSON.stringify({ workspaceId: workspace.id, title: 'Example context conversation' }) })).json()
  }, folder)
  await page.reload()
  await waitConnected(page)
  await page.locator(`[data-session-id="${session.id}"]`).click()
  expect(await page.locator('[data-slot="destination-bar"]').count()).toBe(0)
  expect(await page.locator('[data-slot="composer"]').evaluate((element) => element.getBoundingClientRect().height)).toBe(120)
  const mode = page.locator('[data-permission-mode]')
  const pill = page.locator('[data-slot="plan-chip"]')
  await editor(page).fill('/plan ')
  await editor(page).press('Enter')
  await pill.waitFor()
  for (const text of ['a'.repeat(40_000), 'b'.repeat(40_000), 'c'.repeat(40_000)]) {
    await editor(page).fill(text)
    await editor(page).press('Enter')
    await expect.poll(() => page.locator('[data-action="send"]').isVisible()).toBe(true)
  }
  await expect.poll(() => page.locator('[data-context-ring]').getAttribute('data-level')).toMatch(/warning|critical/)
  expect(await mode.getAttribute('data-permission-mode')).toBe('plan')
  await page.locator('[data-context-ring]').click()
  const card = page.locator('[data-slot="context-card"]')
  await expect.poll(() => card.locator('dt').count()).toBe(5)
  await page.screenshot({ path: '/tmp/coko-cw23-plan-context.png' })
  await page.keyboard.press('Escape')
  await card.waitFor({ state: 'detached' })
  await editor(page).fill('d'.repeat(60_000))
  await editor(page).press('Enter')
  await expect
    .poll(
      async () =>
        page.evaluate(async (id) => {
          const { entries } = await (await fetch(`/api/sessions/${id}`)).json()
          return entries.some((entry: { kind: string; payload: { trigger?: string } }) => entry.kind === 'compaction' && entry.payload.trigger === 'auto')
        }, session.id),
      { timeout: 30_000 },
    )
    .toBe(true)
  await page.locator('[data-action="send"]').waitFor()
  await pill.click()
  await expect.poll(() => mode.getAttribute('data-permission-mode')).toBe('default')
  await editor(page).fill('/plan ')
  await editor(page).press('Enter')
  await pill.waitFor()
  await editor(page).fill('/plan off')
  await editor(page).press('Enter')
  await expect.poll(() => mode.getAttribute('data-permission-mode')).toBe('default')
  expect(await page.locator('[data-session-id] [role="img"], [data-session-id] [data-slot="worktree-chip"]').count()).toBe(0)
})
