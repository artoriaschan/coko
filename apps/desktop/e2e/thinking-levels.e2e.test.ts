// 推理档位配置：真实 Electron + 真实 Sidecar。在供应商表单的模型选项中打开“推理等级”并添加档位，随“创建供应商”一次提交
// （ADR 0010）；重新读取 /api/models 与表单确认档位已保存；关闭开关后会话只能选 off，档位仍在表单中。
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, onTestFinished } from 'vitest'
import { launchApp, waitConnected, type LaunchedApp } from './harness.ts'

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

type Models = { models: { providerId: string; modelId: string; thinkingLevels: string[] }[] }

it('创建时配置档位后 /api/models 列出 off 与已配置档位；关闭推理等级保存后只剩 off，重新打开表单档位仍在', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-thinking-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const app = await launchApp({}, { dir: root })
  apps.push(app)
  await waitConnected(app.window)
  const { window } = app
  const dialog = window.locator('[data-settings-page]')
  await window.getByRole('button', { name: /^(Settings|设置)$/ }).click()
  await dialog.locator('[data-section="models"]').click()

  await dialog.getByRole('button', { name: /^(Add model provider|添加模型供应商)$/ }).click()
  const form = window.locator('[data-provider-form]')
  await form.locator('input[name="providerId"]').fill('local-thinking')
  await form.locator('input[name="name"]').fill('Local thinking')
  await form.locator('input[name="baseUrl"]').fill('http://127.0.0.1:9/v1')
  await form.locator('input[name="credential"]').fill('sk-e2e-thinking-4242')
  await form.locator('[data-model-add]').click()
  const row = form.locator('[data-model-row]')
  await row.locator('input[name="modelId"]').fill('m1')
  await row.getByRole('button', { name: /^(Model options|模型选项)$/ }).click()
  await row.getByRole('switch').click()
  const add = row.locator('[data-thinking-add]')
  for (let i = 0; i < 3; i++) await add.click()
  await row.locator('[data-thinking-level="low"] input[name="thinkingValue"]').fill('effort-low')
  await form.locator('button[type="submit"]').click()
  await form.waitFor({ state: 'detached', timeout: 15_000 })

  const levels = async () =>
    (await window.evaluate(() => fetch('/api/models').then((r) => r.json()) as Promise<Models>)).models.find((m) => m.providerId === 'local-thinking')
      ?.thinkingLevels
  await expect.poll(levels).toEqual(['off', 'minimal', 'low'])
  const saved = await window.evaluate(() => fetch('/api/providers').then((r) => r.json()))
  expect(saved.providers[0].models[0]).toMatchObject({
    reasoning: true,
    thinkingLevels: [{ level: 'off' }, { level: 'minimal', value: 'minimal' }, { level: 'low', value: 'effort-low' }],
  })

  // 关闭推理等级并保存：会话只能选 off，已填档位留在目录中。
  const card = dialog.locator('[data-provider-id="local-thinking"]')
  await card.getByRole('button', { name: /^(Edit|编辑)$/ }).click()
  const editRow = card.locator('[data-provider-form="edit"] [data-model-row]')
  await editRow.getByRole('button', { name: /^(Model options|模型选项)$/ }).click()
  expect(await editRow.getByRole('switch').getAttribute('aria-checked')).toBe('true')
  await editRow.getByRole('switch').click()
  await card.locator('button[type="submit"]').click()
  await card.locator('[data-provider-form]').waitFor({ state: 'detached', timeout: 15_000 })
  await expect.poll(levels).toEqual(['off'])

  await card.getByRole('button', { name: /^(Edit|编辑)$/ }).click()
  await editRow.getByRole('button', { name: /^(Model options|模型选项)$/ }).click()
  expect(await editRow.getByRole('switch').getAttribute('aria-checked')).toBe('false')
  expect(await editRow.locator('[data-thinking-level]').evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.thinkingLevel))).toEqual([
    'off',
    'minimal',
    'low',
  ])
  expect(await editRow.locator('[data-thinking-level="low"] input[name="thinkingValue"]').inputValue()).toBe('effort-low')
})
