// 获取可用模型（MS-19、MS-20、MS-25、MS-26）：真实 Electron + 真实 Sidecar。新建表单的 Key 经 preload → main → provider.models
// 控制消息只用于这一次请求（ADR 0010）；编辑时 Key 留空用已保存的 Credential。供应商是本地的 OpenAI 兼容假服务，记录 /models 的
// Authorization；关闭后检查用户数据目录不含临时 Key。
import { createServer } from 'node:http'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, onTestFinished } from 'vitest'
import { launchApp, waitConnected, type LaunchedApp } from './harness.ts'

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** /v1/models 返回固定列表（hold 时不回答），记录 Authorization 与连接是否被关闭。 */
async function fakeProvider(models: string[]) {
  const requests: { auth: string | undefined; closed: boolean }[] = []
  let hold = false
  const server = createServer((req, res) => {
    const entry = { auth: req.headers.authorization, closed: false }
    requests.push(entry)
    req.on('close', () => (entry.closed = true))
    if (hold) return
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ object: 'list', data: models.map((id) => ({ id, object: 'model' })) }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  onTestFinished(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  )
  return { requests, baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, hold: (value: boolean) => void (hold = value) }
}

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true }).catch(() => [])
  return entries.filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name))
}

it('新建表单用填写的 Key 获取并多选回填，一次创建；编辑时 Key 留空用已保存的 Key；关闭弹窗取消请求；临时 Key 不落盘', async () => {
  const root = await tempDir('coko-fetch-models-')
  const saved = 'sk-e2e-fetch-saved-5a1c'
  const provider = await fakeProvider(['custom-model-1', 'custom-model-2', 'custom-model-3'])
  const app = await launchApp({}, { dir: root })
  apps.push(app)
  await waitConnected(app.window)
  const { window } = app
  await window.keyboard.press('Meta+Comma')
  const settings = window.getByRole('dialog').first()
  await settings.locator('[data-section="models"]').click()
  await settings.getByRole('button', { name: /^(Add model provider|添加模型供应商)$/ }).click()
  const form = window.locator('[data-provider-form]')
  await form.locator('input[name="providerId"]').fill('fetch-provider')
  await form.locator('input[name="name"]').fill('Fetch provider')
  await form.locator('input[name="baseUrl"]').fill(provider.baseUrl)
  await form.locator('input[name="credential"]').fill(saved)

  const picker = window.locator('[data-fetch-models-dialog]')
  await form.locator('[data-fetch-models]').click()
  await picker.locator('[data-candidate]').first().waitFor()
  expect(await picker.locator('[data-candidate]').allTextContents()).toEqual(['custom-model-1', 'custom-model-2', 'custom-model-3'])
  expect(provider.requests.map((r) => r.auth)).toEqual([`Bearer ${saved}`])
  await picker.locator('[data-candidate="custom-model-3"]').click()
  await picker.locator('[data-candidate="custom-model-1"]').click()
  await picker.getByRole('button', { name: /^(Add selected|添加所选)$/ }).click()
  await picker.waitFor({ state: 'detached' })
  expect(await form.locator('[data-model-row] input[name="modelId"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toEqual([
    'custom-model-1',
    'custom-model-3',
  ])
  // 添加所选不保存供应商。
  expect(await window.evaluate(() => fetch('/api/providers').then((r) => r.json()))).toEqual({ providers: [] })
  await form.locator('button[type="submit"]').click()
  await form.waitFor({ state: 'detached', timeout: 15_000 })
  const listed = (await window.evaluate(() => fetch('/api/providers').then((r) => r.json()))) as {
    providers: { id: string; models: { id: string; name: string }[] }[]
  }
  expect(listed.providers.map((p) => [p.id, p.models.map((m) => [m.id, m.name])])).toEqual([
    [
      'fetch-provider',
      [
        ['custom-model-1', 'custom-model-1'],
        ['custom-model-3', 'custom-model-3'],
      ],
    ],
  ])

  // 编辑：Key 留空获取时用已保存的 Credential；已在目录的两个模型不可再选。
  await settings.locator('[data-provider-id="fetch-provider"] [data-provider-edit]').click()
  const edit = window.locator('[data-provider-form="edit"]')
  await edit.locator('[data-fetch-models]').click()
  await picker.locator('[data-candidate]').first().waitFor()
  expect(provider.requests.map((r) => r.auth)).toEqual([`Bearer ${saved}`, `Bearer ${saved}`])
  expect(await picker.locator('[data-in-catalog]').count()).toBe(2)
  await picker.getByRole('button', { name: /^(Cancel|取消)$/ }).click()
  await picker.waitFor({ state: 'detached' })

  // 关闭弹窗取消进行中的请求：供应商一侧的连接被关闭。
  provider.hold(true)
  await edit.locator('[data-fetch-models]').click()
  await expect.poll(() => provider.requests.length, { timeout: 15_000 }).toBe(3)
  await picker.getByRole('button', { name: /^(Close|关闭)$/ }).click()
  await picker.waitFor({ state: 'detached' })
  await expect.poll(() => provider.requests[2]!.closed, { timeout: 15_000 }).toBe(true)

  // 新的临时 Key（填写在编辑表单中，不保存）。
  provider.hold(false)
  const temporary = 'sk-e2e-fetch-temp-9b2d'
  await edit.locator('input[name="credential"]').fill(temporary)
  await edit.locator('[data-fetch-models]').click()
  await picker.locator('[data-candidate]').first().waitFor()
  expect(provider.requests.at(-1)!.auth).toBe(`Bearer ${temporary}`)
  await window.keyboard.press('Escape')
  await picker.waitFor({ state: 'detached' })
  expect(await window.evaluate(() => document.body.innerText)).not.toContain(temporary)

  await app.dispose()
  const files = await filesUnder(join(root, 'user-data'))
  expect(files.some((f) => f.endsWith('coko.db'))).toBe(true)
  const leaking: string[] = []
  for (const file of files) if ((await readFile(file)).includes(temporary)) leaking.push(file)
  expect(leaking).toEqual([])
})
