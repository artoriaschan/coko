// 模型服务分区（规格 4.1–4.3，MS-02 至 MS-11）：供应商列表、列表底部新建、列表项内编辑、同一时间只展开一个表单、
// 有未保存修改时关闭或切换先确认“放弃更改？”。一次提交经 fake 的 saveProvider（ADR 0010）。
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
import { catalogModel, customProvider, type fakeSettingsBackend } from '../../testing/fake-settings.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'

afterEach(async () => {
  toast.dismiss()
  await vi.waitFor(() => {
    if (document.querySelector('[data-sonner-toast]')) throw new Error('toast still mounted')
  })
  document.documentElement.classList.remove('dark')
  await page.viewport(1280, 800)
})

type Backend = ReturnType<typeof fakeSettingsBackend>

/** 等页面上的动画（弹窗缩放、菜单淡入）结束。 */
const settled = () => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)))

/** 渲染应用并打开设置的模型服务分区；seed 在读取设置前预置 Provider。 */
async function openModels(locale: Locale, seed: (backend: Backend) => void = () => {}) {
  await page.viewport(1280, 800)
  const appearance = createAppearanceStore({ theme: 'light', locale })
  const { chat, settings, backend } = createFixtureChat({ providers: false })
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
  const dialog = page.getByRole('dialog')
  await expect.element(dialog.getByRole('heading', { name: dictionaries[locale].providers.title })).toBeVisible()
  // 几何断言前等弹窗的缩放动画结束。
  await settled()
  return { dialog, backend, settings, settingsDialog, appearance }
}

const rows = () => [...document.querySelectorAll<HTMLElement>('[role=dialog] [data-provider-id]')]
const row = (id: string) => page.elementLocator(document.querySelector<HTMLElement>(`[role=dialog] [data-provider-id="${id}"]`)!)

it('列表：每个供应商都有编辑与删除，状态点以文字区分已配置 / 未配置 Key；紧凑行 H40/R12、间距 4px，添加入口在列表下方', async () => {
  const { dialog } = await openModels('zh', (backend) => {
    backend.seedProvider(customProvider('custom-provider-1', ['custom-model-1'], { name: '自定义供应商一' }), 'sk-one-1111')
    backend.seedProvider(customProvider('custom-provider-2', ['custom-model-2'], { name: '自定义供应商二' }))
  })
  await expect.poll(() => rows().map((r) => r.dataset.providerId)).toEqual(['custom-provider-1', 'custom-provider-2'])
  for (const id of ['custom-provider-1', 'custom-provider-2']) {
    await expect.element(row(id).getByRole('button', { name: '编辑', exact: true })).toBeVisible()
    await expect.element(row(id).getByRole('button', { name: '删除', exact: true })).toBeVisible()
  }
  await expect.element(row('custom-provider-1').getByText('自定义供应商一', { exact: true })).toBeVisible()
  // 状态以文字表达，不只靠点的颜色。
  expect(row('custom-provider-1').element().querySelector('[data-credential-status]')?.textContent).toBe('已配置 Key · 末四位 1111')
  expect(row('custom-provider-2').element().querySelector('[data-credential-status]')?.textContent).toBe('未配置 Key')

  const [first, second] = rows().map((r) => r.getBoundingClientRect())
  expect(first!.height).toBe(40)
  expect(getComputedStyle(rows()[0]!).borderRadius).toBe('12px')
  expect(second!.top - first!.bottom).toBe(4)
  const add = dialog.getByRole('button', { name: '添加模型供应商', exact: true }).element().getBoundingClientRect()
  expect(add.top).toBeGreaterThan(second!.bottom)
  expect(add.height).toBe(36)
})

const forms = () => document.querySelectorAll('[role=dialog] [data-provider-form]')
/** 目录的“添加模型”入口（新增一行并聚焦模型 ID）。 */
const addModel = () => document.querySelector<HTMLElement>('[role=dialog] [data-provider-form] [data-model-add]')!
/** 添加一个模型行，等新行的模型 ID 获得焦点后填写。 */
async function addModelRow(id: string) {
  await page.elementLocator(addModel()).click()
  const input = page.elementLocator([...document.querySelectorAll<HTMLElement>('[role=dialog] [data-model-row] [name="modelId"]')].at(-1)!)
  await expect.element(input).toHaveFocus()
  await input.fill(id)
}
const field = (name: string) => document.querySelector<HTMLInputElement>(`[role=dialog] [data-provider-form] [name="${name}"]`)!
const errorOf = (name: string) => {
  const input = field(name)
  return describedError(input)
}
const describedError = (input: Element) => {
  const ids = input.getAttribute('aria-describedby')?.split(' ') ?? []
  return ids.map((id) => document.getElementById(id)).find((el) => el?.hasAttribute('data-field-error'))?.textContent ?? null
}

it('新建：列表下方出现“自定义模型 API”表单，列表保留；协议只有三项、默认 OpenAI Chat Completions 并回显；Key 为紧凑圆点', async () => {
  const { dialog } = await openModels('zh', (backend) =>
    backend.seedProvider(customProvider('custom-provider-1', ['custom-model-1'], { name: '自定义供应商一' })),
  )
  await dialog.getByRole('button', { name: '添加模型供应商', exact: true }).click()
  const form = forms()[0] as HTMLElement
  await expect.element(page.elementLocator(form).getByRole('heading', { name: '自定义模型 API' })).toBeVisible()
  // 在列表底部、列表项之外；没有品牌标签或二级页面，已有列表项仍在。
  expect(form.closest('[data-provider-id]')).toBeNull()
  expect(form.getBoundingClientRect().top).toBeGreaterThan(rows().at(-1)!.getBoundingClientRect().bottom)
  expect(rows()).toHaveLength(1)
  expect(dialog.getByRole('button', { name: '添加模型供应商', exact: true }).query()).toBeNull()
  // 新建时聚焦 Provider ID。
  await expect.element(page.elementLocator(field('providerId'))).toHaveFocus()

  const protocol = dialog.getByRole('button', { name: 'API 协议', exact: true })
  await expect.element(protocol).toHaveTextContent('OpenAI Chat Completions')
  expect(protocol.element().getBoundingClientRect().height).toBe(36)
  await protocol.click()
  const items = page.getByRole('menuitemradio')
  await expect.element(items.first()).toBeVisible()
  await settled()
  expect(items.elements().map((el) => el.textContent)).toEqual(['OpenAI Chat Completions', 'OpenAI Responses', 'Anthropic Messages'])
  expect(items.elements()[0]!.getAttribute('aria-checked')).toBe('true')
  expect(items.elements()[0]!.getBoundingClientRect().height).toBe(32)
  await page.getByRole('menuitemradio', { name: 'OpenAI Responses' }).click()
  await expect.element(protocol).toHaveTextContent('OpenAI Responses')

  const secret = field('credential')
  expect(secret.type).toBe('password')
  expect(secret.placeholder).toBe('输入 API Key')
  expect(getComputedStyle(secret).letterSpacing).toBe('normal')
  expect(getComputedStyle(secret).fontFamily).toBe(getComputedStyle(field('name')).fontFamily)
  expect(secret.getBoundingClientRect().height).toBe(32)
})

it('新建校验：空表单、ID 格式与重复、非 http(s) 地址都阻止提交，错误以文字显示在字段旁并聚焦第一个出错字段', async () => {
  const { dialog, backend } = await openModels('zh', (b) => b.seedProvider(customProvider('custom-provider-1', ['custom-model-1'], { name: '自定义供应商一' })))
  await dialog.getByRole('button', { name: '添加模型供应商', exact: true }).click()
  const create = dialog.getByRole('button', { name: '创建供应商', exact: true })
  await create.click()
  await expect.poll(() => errorOf('providerId')).toBe(dictionaries.zh.providers.idInvalid)
  expect(errorOf('name')).toBe('请填写显示名称')
  expect(errorOf('baseUrl')).toBe(dictionaries.zh.providers.baseUrlInvalid)
  expect(errorOf('credential')).toBe('请输入 API Key')
  expect(describedError(addModel())).toBe(dictionaries.zh.providers.modelsRequired)
  expect(field('providerId').getAttribute('aria-invalid')).toBe('true')
  await expect.element(page.elementLocator(field('providerId'))).toHaveFocus()

  await page.elementLocator(field('providerId')).fill('custom-provider-1')
  // 修改字段后该字段的错误消失。
  expect(errorOf('providerId')).toBeNull()
  await page.elementLocator(field('name')).fill('自定义供应商二')
  await page.elementLocator(field('baseUrl')).fill('ftp://gateway.example')
  await page.elementLocator(field('credential')).fill('sk-new-provider-2222')
  await addModelRow('custom-model-2')
  await create.click()
  await expect.poll(() => errorOf('providerId')).toBe('ID 已被使用')
  expect(errorOf('baseUrl')).toBe(dictionaries.zh.providers.baseUrlInvalid)
  expect(errorOf('name')).toBeNull()
  expect(backend.saveProvider).not.toHaveBeenCalled()

  await page.elementLocator(field('providerId')).fill('custom-provider-2')
  await page.elementLocator(field('baseUrl')).fill('https://gateway.example/v1')
  await create.click()
  await expect.poll(() => rows().map((r) => r.dataset.providerId)).toEqual(['custom-provider-1', 'custom-provider-2'])
  expect(forms()).toHaveLength(0)
  expect(backend.saveProvider).toHaveBeenCalledTimes(1)
  expect(backend.saveProvider).toHaveBeenCalledWith({
    mode: 'create',
    provider: expect.objectContaining({ id: 'custom-provider-2', name: '自定义供应商二', api: 'openai-completions', baseUrl: 'https://gateway.example/v1' }),
    secret: 'sk-new-provider-2222',
  })
  // 新供应商具备同样的编辑与删除入口，状态为已配置 Key。
  await expect.element(row('custom-provider-2').getByRole('button', { name: '编辑', exact: true })).toBeVisible()
  await expect.element(row('custom-provider-2').getByRole('button', { name: '删除', exact: true })).toBeVisible()
  expect(row('custom-provider-2').element().querySelector('[data-credential-status]')?.textContent).toBe('已配置 Key · 末四位 2222')
  // 关闭后焦点不丢到 body。
  expect(document.activeElement).not.toBe(document.body)
})

it('编辑：在列表项内展开；名称与 Provider ID 静态并排，ID 没有控件；Key 为空并提示“留空则保留现有 Key”，保存不覆盖原 Credential', async () => {
  const { dialog, backend } = await openModels('zh', (b) => {
    b.seedProvider(customProvider('custom-provider-1', ['custom-model-1'], { name: '自定义供应商一' }), 'sk-one-1111')
    b.seedProvider(customProvider('custom-provider-2', ['custom-model-2'], { name: '自定义供应商二', baseUrl: 'https://gateway.example/v1' }), 'sk-two-2222')
  })
  const edit = row('custom-provider-2').getByRole('button', { name: '编辑', exact: true })
  await edit.click()
  const form = row('custom-provider-2').element().querySelector<HTMLElement>('[data-provider-form]')!
  expect(form).not.toBeNull()
  expect(forms()).toHaveLength(1)
  // 按钮文案始终为“编辑”，展开状态由 aria-expanded 表达。
  await expect.element(edit).toHaveAttribute('aria-expanded', 'true')
  expect(edit.element().getAttribute('aria-controls')).toBe(form.id)
  const header = form.querySelector('[data-provider-static-id]')!
  expect(header.textContent).toBe('custom-provider-2')
  expect(header.parentElement!.textContent).toBe('自定义供应商二custom-provider-2')
  expect(form.querySelector('[name="providerId"]')).toBeNull()
  expect(form.querySelectorAll('input, button, select, textarea').length).toBeGreaterThan(0)
  expect([...form.querySelectorAll('input')].some((input) => input.value === 'custom-provider-2')).toBe(false)
  expect(field('name').value).toBe('自定义供应商二')
  expect(field('credential').value).toBe('')
  expect(field('credential').placeholder).toBe('留空则保留现有 Key')
  await expect.element(dialog.getByRole('button', { name: '保存更改', exact: true })).toBeVisible()

  await page.elementLocator(field('name')).fill('自定义供应商二（改）')
  await dialog.getByRole('button', { name: '保存更改', exact: true }).click()
  await expect.poll(() => forms().length).toBe(0)
  expect(backend.saveProvider).toHaveBeenCalledWith({
    mode: 'update',
    provider: expect.objectContaining({ id: 'custom-provider-2', name: '自定义供应商二（改）' }),
  })
  expect(backend.saveProvider.mock.calls[0]![0]).not.toHaveProperty('secret')
  expect(backend.providers.find((p) => p.id === 'custom-provider-2')?.credential).toEqual({ hint: '2222' })
  // 名称已变，按 ID 重新定位列表项。
  const editAgain = row('custom-provider-2').getByRole('button', { name: '编辑', exact: true })
  await expect.element(editAgain).toHaveAttribute('aria-expanded', 'false')
  await expect.element(editAgain).toHaveFocus()
})

it('无修改时再次点击同项“编辑”直接收起，不提示放弃更改；按钮始终为“编辑”', async () => {
  const { dialog } = await openModels('en', (b) => b.seedProvider(customProvider('custom-provider-1', ['custom-model-1'], { name: 'Custom one' }), 'sk-1111'))
  const edit = row('custom-provider-1').getByRole('button', { name: 'Edit', exact: true })
  await edit.click()
  await expect.poll(() => forms().length).toBe(1)
  await expect.element(edit).toHaveTextContent('Edit')
  await edit.click()
  await expect.poll(() => forms().length).toBe(0)
  expect(document.querySelector('[role=alertdialog]')).toBeNull()
  await expect.element(dialog.getByRole('button', { name: 'Add model provider', exact: true })).toBeVisible()
})

const discardDialog = () => page.getByRole('alertdialog', { name: '放弃更改？' })

/** 回答“放弃更改？”：确认框默认焦点在“继续编辑”。 */
async function answerDiscard(answer: 'keep' | 'discard' | 'escape') {
  await expect.element(discardDialog()).toBeVisible()
  await expect.element(discardDialog().getByRole('button', { name: '继续编辑' })).toHaveFocus()
  if (answer === 'escape') await userEvent.keyboard('{Escape}')
  else
    await discardDialog()
      .getByRole('button', { name: answer === 'keep' ? '继续编辑' : '放弃更改', exact: true })
      .click()
  await expect.element(discardDialog()).not.toBeInTheDocument()
}

it('有未保存修改时取消、再次点击编辑、展开其他项或点击添加都先提示“放弃更改？”；继续编辑保留草稿，确认后丢弃；同一时间只展开一个表单', async () => {
  const { dialog, backend } = await openModels('zh', (b) => {
    b.seedProvider(customProvider('custom-provider-1', ['custom-model-1'], { name: '自定义供应商一' }), 'sk-1111')
    b.seedProvider(customProvider('custom-provider-2', ['custom-model-2'], { name: '自定义供应商二' }), 'sk-2222')
  })
  const edit1 = row('custom-provider-1').getByRole('button', { name: '编辑', exact: true })
  const edit2 = row('custom-provider-2').getByRole('button', { name: '编辑', exact: true })
  await edit1.click()
  await page.elementLocator(field('baseUrl')).fill('https://changed.example/v1')

  // 取消：继续编辑（以及 Escape）保留表单与草稿，设置弹窗不关闭。
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await answerDiscard('keep')
  expect(field('baseUrl').value).toBe('https://changed.example/v1')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await answerDiscard('escape')
  await expect.element(page.getByRole('dialog', { name: '设置' })).toBeVisible()
  expect(field('baseUrl').value).toBe('https://changed.example/v1')

  // 再次点击同项“编辑”。
  await edit1.click()
  await answerDiscard('keep')
  expect(forms()).toHaveLength(1)
  expect(row('custom-provider-1').element().querySelector('[data-provider-form]')).not.toBeNull()

  // 展开其他项：确认后当前草稿丢弃，只展开另一项。
  await edit2.click()
  await answerDiscard('keep')
  expect(row('custom-provider-2').element().querySelector('[data-provider-form]')).toBeNull()
  await edit2.click()
  await answerDiscard('discard')
  await expect.poll(() => row('custom-provider-2').element().querySelector('[data-provider-form]')).not.toBeNull()
  expect(forms()).toHaveLength(1)
  await expect.element(edit1).toHaveAttribute('aria-expanded', 'false')
  await expect.element(edit2).toHaveAttribute('aria-expanded', 'true')

  // 无修改时直接切换到新建，不提示；新建与编辑互斥。
  await dialog.getByRole('button', { name: '添加模型供应商', exact: true }).click()
  expect(document.querySelector('[role=alertdialog]')).toBeNull()
  await expect.poll(() => document.querySelector('[role=dialog] [data-provider-form="create"]')).not.toBeNull()
  expect(forms()).toHaveLength(1)
  await expect.element(edit2).toHaveAttribute('aria-expanded', 'false')

  // 新建表单有修改时展开某项：先确认。
  await page.elementLocator(field('providerId')).fill('custom-provider-3')
  await edit1.click()
  await answerDiscard('keep')
  expect(field('providerId').value).toBe('custom-provider-3')
  await edit1.click()
  await answerDiscard('discard')
  await expect.poll(() => row('custom-provider-1').element().querySelector('[data-provider-form]')).not.toBeNull()
  expect(forms()).toHaveLength(1)
  // 丢弃的草稿不回来。
  expect(field('baseUrl').value).toBe('http://127.0.0.1:9/v1')
  expect(backend.saveProvider).not.toHaveBeenCalled()
})

it('有未保存修改时切换设置分区或关闭设置先提示“放弃更改？”；继续编辑留在模型服务，确认后离开并丢弃草稿', async () => {
  const { dialog, settingsDialog } = await openModels('zh', (b) =>
    b.seedProvider(customProvider('custom-provider-1', ['custom-model-1'], { name: '自定义供应商一' }), 'sk-1111'),
  )
  await row('custom-provider-1').getByRole('button', { name: '编辑', exact: true }).click()
  await page.elementLocator(field('name')).fill('改过的名称')

  const general = dialog.getByRole('button', { name: dictionaries.zh.settings.nav.general, exact: true })
  await general.click()
  await answerDiscard('keep')
  expect(settingsDialog.getSnapshot().section).toBe('models')
  expect(field('name').value).toBe('改过的名称')

  // 关闭设置（Escape 与关闭按钮）：继续编辑时弹窗保持打开。
  field('name').focus()
  await userEvent.keyboard('{Escape}')
  await answerDiscard('keep')
  await dialog.getByRole('button', { name: dictionaries.zh.settings.close, exact: true }).click()
  await answerDiscard('keep')
  expect(settingsDialog.getSnapshot().open).toBe(true)
  expect(field('name').value).toBe('改过的名称')

  await general.click()
  await answerDiscard('discard')
  await expect.poll(() => settingsDialog.getSnapshot().section).toBe('general')
  // 回到模型服务：草稿已丢弃，没有展开的表单；再次离开不再提示。
  settingsDialog.setSection('models')
  await expect.poll(() => rows().length).toBe(1)
  expect(forms()).toHaveLength(0)
  settingsDialog.close()
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  expect(document.querySelector('[role=alertdialog]')).toBeNull()

  // 无修改的表单离开时不提示。
  settingsDialog.show('models')
  await expect.element(page.getByRole('heading', { name: '模型服务', level: 2 })).toBeVisible()
  await row('custom-provider-1').getByRole('button', { name: '编辑', exact: true }).click()
  await expect.poll(() => forms().length).toBe(1)
  settingsDialog.close()
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
})

it('提交中“创建供应商”不可点、只提交一次；失败时表单底部显示错误并保留草稿，库中没有该供应商', async () => {
  const { dialog, backend } = await openModels('en')
  let resolve!: (result: Awaited<ReturnType<Backend['saveProvider']>>) => void
  backend.saveProvider.mockImplementationOnce(() => new Promise((r) => (resolve = r)))
  await dialog.getByRole('button', { name: 'Add model provider', exact: true }).click()
  await page.elementLocator(field('providerId')).fill('custom-provider-1')
  await page.elementLocator(field('name')).fill('Custom one')
  await page.elementLocator(field('baseUrl')).fill('http://127.0.0.1:9/v1')
  await page.elementLocator(field('credential')).fill('sk-browser-test-9876')
  await addModelRow('custom-model-1')
  const create = dialog.getByRole('button', { name: 'Create provider', exact: true })
  await create.click()
  await expect.element(create).toBeDisabled()
  await expect.element(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
  // 禁用态与普通态几何一致：标准按钮 H36。
  expect(create.element().getBoundingClientRect().height).toBe(36)
  field('credential').form!.requestSubmit()
  expect(backend.saveProvider).toHaveBeenCalledTimes(1)

  resolve({ ok: false, code: 'encryption-unavailable', message: 'no keychain' })
  const alert = dialog.getByRole('alert')
  await expect.element(alert).toHaveTextContent(dictionaries.en.providers.credentialErrors['encryption-unavailable'])
  // 错误在表单底部（操作按钮之前），技术原文只在详情中。
  const form = forms()[0]!
  expect(form.contains(alert.element())).toBe(true)
  expect(alert.element().compareDocumentPosition(create.element()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(alert.element().textContent).not.toContain('no keychain')
  expect(form.querySelector('[data-error-detail]')?.textContent).toContain('no keychain')
  await expect.element(create).toBeEnabled()
  expect(field('providerId').value).toBe('custom-provider-1')
  expect(field('credential').value).toBe('sk-browser-test-9876')
  expect(backend.providers).toEqual([])
  expect(rows()).toHaveLength(0)

  // 重试仍是新建，一次提交配置、目录与 Key。
  await create.click()
  await expect.poll(() => rows().length).toBe(1)
  expect(backend.saveProvider).toHaveBeenLastCalledWith({
    mode: 'create',
    provider: expect.objectContaining({ id: 'custom-provider-1', models: [expect.objectContaining({ id: 'custom-model-1' })] }),
    secret: 'sk-browser-test-9876',
  })
  expect(dialog.element().textContent).not.toContain('sk-browser-test')
})

it('服务端返回 ID 重复时字段旁提示“ID 已被使用”并保留草稿', async () => {
  const { dialog, backend } = await openModels('zh')
  backend.saveProvider.mockResolvedValueOnce({ ok: false, code: 'already-exists', message: 'taken', details: { field: 'id', id: 'custom-provider-1' } })
  await dialog.getByRole('button', { name: '添加模型供应商', exact: true }).click()
  await page.elementLocator(field('providerId')).fill('custom-provider-1')
  await page.elementLocator(field('name')).fill('自定义供应商一')
  await page.elementLocator(field('baseUrl')).fill('https://gateway.example/v1')
  await page.elementLocator(field('credential')).fill('sk-1111')
  await addModelRow('custom-model-1')
  await dialog.getByRole('button', { name: '创建供应商', exact: true }).click()
  await expect.poll(() => errorOf('providerId')).toBe('ID 已被使用')
  await expect.element(page.elementLocator(field('providerId'))).toHaveFocus()
  expect(field('name').value).toBe('自定义供应商一')
})

it('键盘：Tab 到“添加模型供应商”并用键盘完成新建，焦点环可见；深色主题下列表行与表单使用深色语义色', async () => {
  const { dialog, backend, appearance } = await openModels('en', (b) =>
    b.seedProvider(customProvider('custom-provider-1', ['custom-model-1'], { name: 'Custom one' }), 'sk-1111'),
  )
  const lightRow = getComputedStyle(rows()[0]!).backgroundColor
  appearance.setTheme('dark')
  await expect.poll(() => document.documentElement.classList.contains('dark')).toBe(true)
  expect(getComputedStyle(rows()[0]!).backgroundColor).not.toBe(lightRow)

  const add = dialog.getByRole('button', { name: 'Add model provider', exact: true }).element() as HTMLElement
  ;(row('custom-provider-1').getByRole('button', { name: 'Delete', exact: true }).element() as HTMLElement).focus()
  await userEvent.keyboard('{Tab}')
  expect(document.activeElement).toBe(add)
  expect(add.matches(':focus-visible')).toBe(true)
  expect(getComputedStyle(add).outlineStyle).toBe('solid')
  await userEvent.keyboard('{Enter}')
  await expect.element(page.elementLocator(field('providerId'))).toHaveFocus()
  await userEvent.keyboard('custom-provider-2{Tab}Custom two{Tab}https://gateway.example/v1{Tab}')
  // 协议选择器：Enter 打开菜单，方向键选择。
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('menuitemradio').first()).toHaveFocus()
  // 共享菜单在打开动画结束前不响应方向键与选择；等动画结束再操作。
  await settled()
  for (const key of ['{ArrowDown}', '{ArrowDown}']) await userEvent.keyboard(key)
  await expect.element(page.getByRole('menuitemradio', { name: 'Anthropic Messages' })).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  const protocol = dialog.getByRole('button', { name: 'API protocol', exact: true })
  await expect.element(protocol).toHaveTextContent('Anthropic Messages')
  await expect.element(protocol).toHaveFocus()
  // 空目录：目录标题行的“获取可用模型”之后是“添加模型”，Enter 新增一行并聚焦模型 ID。
  await userEvent.keyboard('{Tab}sk-two-2222{Tab}')
  expect(document.activeElement?.hasAttribute('data-fetch-models')).toBe(true)
  await userEvent.keyboard('{Tab}')
  expect(document.activeElement).toBe(addModel())
  await userEvent.keyboard('{Enter}')
  await expect.element(page.elementLocator(document.querySelector<HTMLElement>('[role=dialog] [name="modelId"]')!)).toHaveFocus()
  await userEvent.keyboard('custom-model-2{Enter}')
  await expect.poll(() => rows().length).toBe(2)
  expect(backend.providers.find((p) => p.id === 'custom-provider-2')).toMatchObject({
    name: 'Custom two',
    api: 'anthropic-messages',
    credential: { hint: '2222' },
  })
  // 焦点回到新供应商的“编辑”。
  await expect.element(row('custom-provider-2').getByRole('button', { name: 'Edit', exact: true })).toHaveFocus()
})

it('编辑目录：修改协议并添加模型后保存，已有模型的能力配置保留；删除后从列表移除', async () => {
  const rich = catalogModel('custom-model-1', {
    contextWindow: 1_000_000,
    input: ['text', 'image'],
    reasoning: true,
    thinkingLevels: [{ level: 'high', value: 'high' }],
  })
  const { dialog, backend } = await openModels('en', (b) =>
    b.seedProvider({ ...customProvider('custom-provider-2', []), name: 'Custom two', models: [rich] }, 'sk-existing-key-5555'),
  )
  await row('custom-provider-2').getByRole('button', { name: 'Edit', exact: true }).click()
  await dialog.getByRole('button', { name: 'API protocol', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'OpenAI Responses' }).click()
  // 菜单关闭动画结束后焦点回到协议按钮；之后再添加模型。
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  await settled()
  await addModelRow('custom-model-3')
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect.poll(() => forms().length).toBe(0)
  expect(backend.providers).toMatchObject([
    { id: 'custom-provider-2', api: 'openai-responses', models: [rich, catalogModel('custom-model-3')], credential: { hint: '5555' } },
  ])

  await row('custom-provider-2').getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect.element(dialog.getByText('No providers yet. Add one to start a conversation.')).toBeVisible()
  expect(backend.providers).toEqual([])
})
