import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { launchApp, waitConnected } from './harness.ts'

it('CW-29/30/31: select a second provider and a thinking level in a real window; Sidecar persists both', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-model-picker-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'workspace')
  await mkdir(path)
  const app = await launchApp({}, { dir: root })
  onTestFinished(() => app.dispose())
  const window = app.window
  await waitConnected(window)
  const id = await window.evaluate(async (workspacePath) => {
    const bridge = globalThis.window.coko
    if (!bridge) throw new Error('Desktop bridge unavailable')
    for (const [id, name] of [
      ['example-a', 'Provider A'],
      ['example-b', 'Provider B'],
    ]) {
      const result = await bridge.saveProvider({
        mode: 'create',
        secret: 'sk-example-model-picker-key',
        provider: {
          id: id!,
          name: name!,
          api: 'openai-completions',
          baseUrl: 'http://127.0.0.1:9/v1',
          models: [
            {
              id: 'example-model',
              name: `Model ${name}`,
              contextWindow: 128000,
              maxTokens: 16000,
              input: ['text'],
              reasoning: true,
              thinkingLevels: [{ level: 'off' }, { level: 'low', value: 'low' }, { level: 'high', value: 'high' }],
            },
          ],
        },
      })
      if (!result.ok) throw new Error(`Provider fixture: ${result.code}`)
    }
    const workspaceResponse = await fetch('/api/workspaces', { method: 'POST', body: JSON.stringify({ path: workspacePath }) })
    const workspace = (await workspaceResponse.json()) as { id: string }
    const response = await fetch('/api/sessions', { method: 'POST', body: JSON.stringify({ workspaceId: workspace.id, title: 'Example model conversation' }) })
    if (!response.ok) throw new Error(`Session fixture: ${response.status}`)
    return ((await response.json()) as { id: string }).id
  }, path)
  await window.reload()
  await waitConnected(window)
  await window.locator(`[data-session-id="${id}"]`).click()
  await window.locator('[data-model-picker]').click()
  await window.getByRole('slider').waitFor()
  await window.getByRole('menuitem', { name: /^(Choose model:|选择模型：)/ }).click()
  await window.getByRole('menuitemradio', { name: 'Model Provider B', exact: true }).click()
  await expect.poll(() => window.locator('[data-model-picker]').getAttribute('data-model')).toBe('example-b/example-model')
  const slider = window.getByRole('slider')
  await slider.focus()
  await slider.press('End')
  await expect
    .poll(async () => {
      const sessions = await window.evaluate(
        async () => (await (await fetch('/api/sessions')).json()) as { sessions: { id: string; model: unknown; thinkingLevel: string }[] },
      )
      return sessions.sessions.find((session) => session.id === id)
    })
    .toMatchObject({ model: { providerId: 'example-b', modelId: 'example-model' }, thinkingLevel: 'high' })
  await expect.poll(() => slider.getAttribute('aria-valuetext')).toMatch(/^(High|高)$/)
  expect(await window.getByRole('menu').count()).toBe(1)
  await window.keyboard.press('Escape')
  await window.getByRole('menu').waitFor({ state: 'detached' })
})
