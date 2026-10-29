// 获取可用模型（规格 4.6，MS-19 至 MS-28）：在新建或编辑表单点击“获取可用模型”，按表单中的协议、地址与 Key 经 fake 的
// fetchProviderModels 获取候选，在“选择要添加的模型”弹窗中搜索、多选并追加到目录草稿；添加所选不保存供应商（ADR 0010）。
import '../../styles.css'
import { dictionaries, type Locale } from '@coko/i18n'
import { toast } from '@coko/ui'
import { afterEach, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsDialogStore } from '../../app/settings-dialog-store.ts'
import { customProvider, type fakeSettingsBackend } from '../../testing/fake-settings.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'

afterEach(async () => {
  toast.dismiss()
  await vi.waitFor(() => {
    if (document.querySelector('[data-sonner-toast]')) throw new Error('toast still mounted')
  })
  document.documentElement.classList.remove('dark')
})

type Backend = ReturnType<typeof fakeSettingsBackend>
const CANDIDATES = Array.from({ length: 10 }, (_, i) => `custom-model-${i + 1}`)

const settled = () => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)))

async function openModels(locale: Locale = 'zh', seed: (backend: Backend) => void = () => {}, theme: 'light' | 'dark' = 'light') {
  await page.viewport(1280, 800)
  const appearance = createAppearanceStore({ theme, locale })
  const { chat, settings, backend } = createFixtureChat({ providers: false })
  backend.setCandidates(CANDIDATES)
  seed(backend)
  const settingsDialog = createSettingsDialogStore()
  const preferences = createPreferences({ appearance, settings, onConflict: () => {}, onFailure: () => {} })
  await render(
    <div style={{ width: '100vw', height: '100vh' }}>
      <App
        store={appearance}
        connection={createConnectionStore()}
        chat={chat}
        settings={settings}
        preferences={preferences}
        settingsDialog={settingsDialog}
        pickDirectory={async () => null}
      />
    </div>,
  )
  await settings.getState().load()
  settingsDialog.show('models')
  const dialog = page.getByRole('dialog').first()
  await expect.element(dialog.getByRole('heading', { name: dictionaries[locale].providers.title })).toBeVisible()
  await settled()
  return { dialog, backend }
}

const form = () => document.querySelector<HTMLFormElement>('[data-provider-form]')!
const connection = (name: string) => form().querySelector<HTMLInputElement>(`[name="${name}"]`)!
const fill = (element: HTMLInputElement, value: string) => page.elementLocator(element).fill(value)
const trigger = () => page.elementLocator(form().querySelector<HTMLElement>('[data-fetch-models]')!)
const picker = () => page.elementLocator(document.querySelector<HTMLElement>('[data-fetch-models-dialog]')!)
const pickerOpen = () => document.querySelector('[data-fetch-models-dialog]') !== null
const candidateRows = () => [...document.querySelectorAll<HTMLElement>('[data-fetch-models-dialog] [data-candidate]')]
const visibleIds = () => candidateRows().map((row) => row.getAttribute('data-candidate'))
const checkbox = (id: string) => page.elementLocator(document.querySelector<HTMLElement>(`[data-candidate="${id}"] [role=checkbox]`)!)
const catalogIds = () => [...form().querySelectorAll<HTMLInputElement>('[data-model-row] [name="modelId"]')].map((input) => input.value)

async function openCreate(dialog: ReturnType<typeof page.getByRole>) {
  await dialog.getByRole('button', { name: '添加模型供应商', exact: true }).click()
  await fill(connection('providerId'), 'custom-provider-1')
  await fill(connection('name'), '自定义供应商一')
}

/** 打开选择弹窗并等候选出现。 */
async function openPicker() {
  await trigger().click()
  await expect.poll(pickerOpen).toBe(true)
  await settled()
  await expect.poll(() => candidateRows().length).toBeGreaterThan(0)
}

it('新建：地址或 Key 未填时“获取可用模型”不可点；填好后用表单中的协议、地址与 Key 获取，不保存', async () => {
  const { dialog, backend } = await openModels()
  await openCreate(dialog)
  await expect.element(trigger()).toHaveTextContent('获取可用模型')
  await expect.element(trigger()).toBeDisabled()
  await fill(connection('baseUrl'), 'https://gateway.example/v1')
  await expect.element(trigger()).toBeDisabled()
  await fill(connection('credential'), 'sk-form-key-0001')
  await expect.element(trigger()).toBeEnabled()
  await openPicker()
  expect(backend.fetchProviderModels).toHaveBeenCalledTimes(1)
  expect(backend.fetchProviderModels).toHaveBeenCalledWith({
    requestKey: expect.any(String),
    api: 'openai-completions',
    baseUrl: 'https://gateway.example/v1',
    secret: 'sk-form-key-0001',
  })
  expect(backend.saveProvider).not.toHaveBeenCalled()
})

it('弹窗：每行只显示模型 ID，保持返回顺序；初次打开计数为 0，“添加所选”禁用；已在目录的禁用且不计数；全选 9 个', async () => {
  const { dialog } = await openModels()
  await openCreate(dialog)
  await fill(connection('baseUrl'), 'https://gateway.example/v1')
  await fill(connection('credential'), 'sk-form-key-0001')
  await form().querySelector<HTMLElement>('[data-model-add]')!.click()
  await fill(form().querySelector<HTMLInputElement>('[data-model-row] [name="modelId"]')!, 'custom-model-1')
  await openPicker()
  const p = picker()
  await expect.element(p.getByRole('heading', { name: '选择要添加的模型' })).toBeVisible()
  expect(visibleIds()).toEqual(CANDIDATES)
  expect(candidateRows()[1]!.textContent).toBe('custom-model-2')
  expect(candidateRows()[0]!.textContent).toBe('custom-model-1已在目录')
  await expect.element(checkbox('custom-model-1')).toBeDisabled()
  await expect.element(checkbox('custom-model-1')).toHaveAttribute('data-state', 'checked')
  await expect.element(p.getByText('共 10 个模型 · 1 个已在目录')).toBeVisible()
  await expect.element(p.getByText('已选择 0 个模型')).toBeVisible()
  await expect.element(p.getByRole('button', { name: '添加所选', exact: true })).toBeDisabled()
  // 初次打开焦点在搜索框。
  await expect.element(p.getByRole('searchbox', { name: '搜索模型' })).toHaveFocus()

  await p.getByRole('button', { name: '全选', exact: true }).click()
  await expect.element(p.getByText('已选择 9 个模型')).toBeVisible()
  await expect.element(p.getByRole('button', { name: '取消全选', exact: true })).toBeVisible()
  await p.getByRole('button', { name: '取消全选', exact: true }).click()
  await expect.element(p.getByText('已选择 0 个模型')).toBeVisible()
  await checkbox('custom-model-2').click()
  await checkbox('custom-model-3').click()
  await expect.element(p.getByText('已选择 2 个模型')).toBeVisible()
  await expect.element(p.getByRole('button', { name: '全选', exact: true })).toBeVisible()
})

it('搜索：按模型 ID 按序模糊匹配、不区分大小写、保持返回顺序；全选只作用于当前结果；修改搜索后已选保持', async () => {
  const { dialog, backend } = await openModels()
  backend.setCandidates(['gpt-4o-mini', 'custom-model-1', 'GPT-4O', 'o4-gpt', 'custom-model-2'])
  await openCreate(dialog)
  await fill(connection('baseUrl'), 'https://gateway.example/v1')
  await fill(connection('credential'), 'sk-form-key-0001')
  await openPicker()
  const search = picker().getByRole('searchbox', { name: '搜索模型' })
  await search.fill('gpt4o')
  await expect.poll(visibleIds).toEqual(['gpt-4o-mini', 'GPT-4O'])
  await picker().getByRole('button', { name: '全选', exact: true }).click()
  await expect.element(picker().getByText('已选择 2 个模型')).toBeVisible()
  await search.fill('custom')
  await expect.poll(visibleIds).toEqual(['custom-model-1', 'custom-model-2'])
  await expect.element(picker().getByRole('button', { name: '全选', exact: true })).toBeVisible()
  await checkbox('custom-model-2').click()
  await expect.element(picker().getByText('已选择 3 个模型')).toBeVisible()
  await search.fill('')
  await expect.poll(visibleIds).toEqual(['gpt-4o-mini', 'custom-model-1', 'GPT-4O', 'o4-gpt', 'custom-model-2'])
  await expect.element(checkbox('gpt-4o-mini')).toHaveAttribute('data-state', 'checked')
  await expect.element(checkbox('o4-gpt')).toHaveAttribute('data-state', 'unchecked')
  // 没有匹配时说明。
  await search.fill('zzz')
  await expect.element(picker().getByText('没有匹配的模型')).toBeVisible()
})

it('添加所选：弹窗关闭，保留原模型并按返回顺序追加；名称为 ID、默认容量、文本输入、推理关闭；供应商未保存；创建时一次提交', async () => {
  const { dialog, backend } = await openModels('zh', (b) =>
    b.seedProvider(customProvider('custom-provider-1', ['custom-model-1'], { name: '自定义供应商一' }), 'sk-1111'),
  )
  await page.elementLocator(document.querySelector<HTMLElement>('[data-provider-id="custom-provider-1"] [data-provider-edit]')!).click()
  await expect.poll(() => form() !== null).toBe(true)
  // 编辑：Key 留空也可获取，只带 Provider ID（用已保存的 Credential）。
  await expect.element(trigger()).toBeEnabled()
  await openPicker()
  expect(backend.fetchProviderModels.mock.calls[0]![0]).toEqual({
    requestKey: expect.any(String),
    api: 'openai-completions',
    baseUrl: 'http://127.0.0.1:9/v1',
    providerId: 'custom-provider-1',
  })
  await checkbox('custom-model-3').click()
  await checkbox('custom-model-2').click()
  await picker().getByRole('button', { name: '添加所选', exact: true }).click()
  await expect.poll(pickerOpen).toBe(false)
  expect(catalogIds()).toEqual(['custom-model-1', 'custom-model-2', 'custom-model-3'])
  const names = [...form().querySelectorAll<HTMLInputElement>('[data-model-row] [name="modelName"]')].map((i) => i.value)
  expect(names.slice(1)).toEqual(['custom-model-2', 'custom-model-3'])
  expect(backend.saveProvider).not.toHaveBeenCalled()
  // 关闭后焦点回到“获取可用模型”。
  await expect.element(trigger()).toHaveFocus()

  await dialog.getByRole('button', { name: '保存更改', exact: true }).click()
  await expect.poll(() => backend.saveProvider.mock.calls.length).toBe(1)
  const saved = backend.saveProvider.mock.calls[0]![0].provider.models
  expect(saved.map((m) => [m.id, m.name])).toEqual([
    ['custom-model-1', ''],
    ['custom-model-2', 'custom-model-2'],
    ['custom-model-3', 'custom-model-3'],
  ])
  expect(saved[1]).toEqual({
    id: 'custom-model-2',
    name: 'custom-model-2',
    contextWindow: 128_000,
    maxTokens: 16_000,
    input: ['text'],
    reasoning: false,
    thinkingLevels: [],
  })
})

it('编辑时填写了新 Key：获取用新 Key；取消或关闭弹窗不修改目录，并取消进行中的请求', async () => {
  const { backend } = await openModels('zh', (b) => b.seedProvider(customProvider('custom-provider-1', ['custom-model-1']), 'sk-1111'))
  await page.elementLocator(document.querySelector<HTMLElement>('[data-provider-id="custom-provider-1"] [data-provider-edit]')!).click()
  await expect.poll(() => form() !== null).toBe(true)
  await fill(connection('credential'), 'sk-new-key-2222')
  await openPicker()
  expect(backend.fetchProviderModels.mock.calls[0]![0]).toMatchObject({ providerId: 'custom-provider-1', secret: 'sk-new-key-2222' })
  await checkbox('custom-model-2').click()
  await picker().getByRole('button', { name: '取消', exact: true }).click()
  await expect.poll(pickerOpen).toBe(false)
  expect(catalogIds()).toEqual(['custom-model-1'])

  // 加载中：弹窗显示加载状态，“获取可用模型”不可再点；关闭按钮关闭弹窗并取消请求。
  backend.holdFetch()
  await trigger().click()
  await expect.poll(pickerOpen).toBe(true)
  await expect.element(picker().getByText('正在获取模型…')).toBeVisible()
  await expect.element(trigger()).toBeDisabled()
  const { requestKey } = backend.fetchProviderModels.mock.calls[1]![0]
  await picker().getByRole('button', { name: '关闭', exact: true }).click()
  await expect.poll(pickerOpen).toBe(false)
  expect(backend.cancelProviderModels).toHaveBeenCalledWith(requestKey)
  await expect.element(trigger()).toBeEnabled()

  // Escape 关闭：只关闭选择弹窗，不关闭设置。
  await openPicker()
  await userEvent.keyboard('{Escape}')
  await expect.poll(pickerOpen).toBe(false)
  expect(form()).not.toBeNull()
  expect(catalogIds()).toEqual(['custom-model-1'])
})

it('失败显示脱敏后的错误与重试；重试成功后显示候选；空结果显示空状态', async () => {
  const { dialog, backend } = await openModels()
  await openCreate(dialog)
  await fill(connection('baseUrl'), 'https://gateway.example/v1')
  await fill(connection('credential'), 'sk-form-key-0001')
  backend.fetchProviderModels.mockResolvedValueOnce({
    ok: false,
    code: 'upstream-error',
    message: 'HTTP 401: Incorrect API key provided: [REDACTED]',
    status: 401,
  })
  await trigger().click()
  await expect.poll(pickerOpen).toBe(true)
  await expect.element(picker().getByRole('alert')).toHaveTextContent('供应商拒绝了请求（HTTP 401）')
  // 技术原文在可展开的详情中。
  expect(document.querySelector('[data-fetch-models-dialog] [data-error-detail]')?.textContent).toContain('Incorrect API key provided: [REDACTED]')
  await expect.element(picker().getByRole('button', { name: '添加所选', exact: true })).toBeDisabled()
  await picker().getByRole('button', { name: '重试', exact: true }).click()
  await expect.poll(visibleIds).toEqual(CANDIDATES)

  await picker().getByRole('button', { name: '取消', exact: true }).click()
  await expect.poll(pickerOpen).toBe(false)
  backend.fetchProviderModels.mockResolvedValueOnce({ ok: false, code: 'timeout', message: 'The provider did not respond within 15000 ms' })
  await trigger().click()
  await expect.element(picker().getByRole('alert')).toHaveTextContent('供应商在 15 秒内没有返回')
  await picker().getByRole('button', { name: '取消', exact: true }).click()
  await expect.poll(pickerOpen).toBe(false)

  backend.setCandidates([])
  await trigger().click()
  await expect.element(picker().getByText('供应商没有返回可用模型')).toBeVisible()
  await expect.element(picker().getByRole('button', { name: '添加所选', exact: true })).toBeDisabled()
})

it('切换协议或修改地址后再次打开：模型目录不变，之前的候选不再显示，重新获取', async () => {
  const { dialog, backend } = await openModels()
  await openCreate(dialog)
  await fill(connection('baseUrl'), 'https://gateway.example/v1')
  await fill(connection('credential'), 'sk-form-key-0001')
  await openPicker()
  await checkbox('custom-model-2').click()
  await picker().getByRole('button', { name: '添加所选', exact: true }).click()
  await expect.poll(pickerOpen).toBe(false)
  expect(catalogIds()).toEqual(['custom-model-2'])

  await fill(connection('baseUrl'), 'https://other.example/v1')
  backend.setCandidates(['other-model-1'])
  await openPicker()
  expect(visibleIds()).toEqual(['other-model-1'])
  expect(backend.fetchProviderModels).toHaveBeenCalledTimes(2)
  expect(backend.fetchProviderModels.mock.calls[1]![0]).toMatchObject({ baseUrl: 'https://other.example/v1' })
  expect(catalogIds()).toEqual(['custom-model-2'])
})

it('键盘：Tab 到候选，Space 勾选；“添加所选”用 Enter 触发；焦点不离开弹窗', async () => {
  const { dialog } = await openModels()
  await openCreate(dialog)
  await fill(connection('baseUrl'), 'https://gateway.example/v1')
  await fill(connection('credential'), 'sk-form-key-0001')
  trigger().element().focus()
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => candidateRows().length).toBe(10)
  await settled()
  await expect.element(picker().getByRole('searchbox', { name: '搜索模型' })).toHaveFocus()
  await userEvent.keyboard('{Tab}')
  expect(document.activeElement?.textContent).toBe('全选')
  await userEvent.keyboard('{Tab}')
  expect(document.activeElement?.closest('[data-candidate]')?.getAttribute('data-candidate')).toBe('custom-model-1')
  await userEvent.keyboard(' ')
  await expect.element(picker().getByText('已选择 1 个模型')).toBeVisible()
  const add = picker().getByRole('button', { name: '添加所选', exact: true })
  add.element().focus()
  await userEvent.keyboard('{Enter}')
  await expect.poll(pickerOpen).toBe(false)
  expect(catalogIds()).toEqual(['custom-model-1'])
})

it('en：文案来自字典', async () => {
  const { dialog } = await openModels('en')
  await dialog.getByRole('button', { name: 'Add model provider', exact: true }).click()
  await fill(connection('providerId'), 'custom-provider-1')
  await fill(connection('baseUrl'), 'https://gateway.example/v1')
  await fill(connection('credential'), 'sk-form-key-0001')
  await expect.element(trigger()).toHaveTextContent('Fetch available models')
  await openPicker()
  const en = dictionaries.en.providers.fetchModels
  await expect.element(picker().getByRole('heading', { name: en.title })).toBeVisible()
  await expect.element(picker().getByText('10 models', { exact: true })).toBeVisible()
  await expect.element(picker().getByText('0 models selected')).toBeVisible()
  await expect.element(picker().getByRole('button', { name: en.selectAll, exact: true })).toBeVisible()
})
