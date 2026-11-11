// 供应商表单中的模型目录（规格 4.4、4.5，MS-12 至 MS-14）：添加模型行并聚焦模型 ID、填写 ID 与显示名称、展开模型选项
// 配置容量与输入类型、删除行；目录随“创建供应商”或“保存更改”经 fake 的 saveProvider 一次提交（ADR 0010）。
import '../../styles.css'
import { dictionaries, type Locale } from '@coko/i18n'
import { toast } from '@coko/ui'
import { afterEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { catalogModel, customProvider, type fakeSettingsBackend } from '../../testing/fake-settings.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'
import { settingsRegion } from '../../testing/settings-page.ts'

afterEach(async () => {
  toast.dismiss()
  await vi.waitFor(() => {
    if (document.querySelector('[data-sonner-toast]')) throw new Error('toast still mounted')
  })
  document.documentElement.classList.remove('dark')
})

type Backend = ReturnType<typeof fakeSettingsBackend>

/** 等页面上的动画（弹窗缩放、Tooltip 淡入）结束。 */
const settled = () => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)))

/** 渲染应用并打开设置的模型服务分区；seed 在读取设置前预置 Provider。 */
async function openModels(locale: Locale, seed: (backend: Backend) => void = () => {}) {
  await page.viewport(1280, 800)
  const appearance = createAppearanceStore({ theme: 'light', locale })
  const { chat, settings, backend } = createFixtureChat({ providers: false })
  seed(backend)
  const settingsPage = createSettingsPageStore()
  const preferences = createPreferences({ appearance, settings, onConflict: () => {}, onFailure: () => {} })
  await render(
    <div style={{ width: '100vw', height: '100vh' }}>
      <App
        store={appearance}
        connection={createConnectionStore()}
        chat={chat}
        settings={settings}
        preferences={preferences}
        settingsPage={settingsPage}
        pickDirectory={async () => null}
      />
    </div>,
  )
  await settings.getState().load()
  settingsPage.open('models')
  const dialog = settingsRegion()
  await expect.element(dialog.getByRole('heading', { name: dictionaries[locale].providers.title })).toBeVisible()
  await settled()
  return { dialog, backend, appearance }
}

const form = () => document.querySelector<HTMLFormElement>('[data-settings-page] [data-provider-form]')!
const modelRows = () => [...form().querySelectorAll<HTMLElement>('[data-model-row]')]
const modelRow = (index: number) => page.elementLocator(modelRows()[index]!)
const input = (index: number, name: string) => modelRows()[index]!.querySelector<HTMLInputElement>(`[name="${name}"]`)!
const fill = (element: HTMLInputElement, value: string) => page.elementLocator(element).fill(value)
const connection = (name: string) => form().querySelector<HTMLInputElement>(`[name="${name}"]`)!

/** 点击“添加模型”，等新行的模型 ID 获得焦点后填写。 */
async function addRow(id: string) {
  await page.elementLocator(form()).getByRole('button', { name: dictionaries.zh.providers.catalog.add, exact: true }).click()
  const last = modelRows().length - 1
  await expect.element(page.elementLocator(input(last, 'modelId'))).toHaveFocus()
  if (id !== '') await fill(input(last, 'modelId'), id)
}

/** 新建表单中填好连接信息与 Key。 */
async function fillConnection(id = 'custom-provider-1') {
  await fill(connection('providerId'), id)
  await fill(connection('name'), '自定义供应商一')
  await fill(connection('baseUrl'), 'https://gateway.example/v1')
  await fill(connection('credential'), 'sk-catalog-1111')
}

it('连续添加模型：每次在末尾新增一个空行并聚焦模型 ID；可填写 ID 与名称、展开选项与删除（不额外确认）；目录随创建一次提交', async () => {
  const { dialog, backend } = await openModels('zh')
  await dialog.getByRole('button', { name: '添加模型供应商', exact: true }).click()
  await fillConnection()
  // 空目录：显示无模型状态与“添加模型”。
  await expect.element(page.elementLocator(form()).getByText('还没有模型', { exact: true })).toBeVisible()
  expect(modelRows()).toHaveLength(0)
  // 目录不提供“恢复默认模型”。
  expect(form().textContent).not.toContain('恢复默认模型')

  const add = page.elementLocator(form()).getByRole('button', { name: '添加模型', exact: true })
  for (const [index, id] of ['custom-model-1', 'custom-model-2', 'custom-model-3'].entries()) {
    await add.click()
    expect(modelRows()).toHaveLength(index + 1)
    expect(input(index, 'modelId').value).toBe('')
    expect(input(index, 'modelName').value).toBe('')
    await expect.element(page.elementLocator(input(index, 'modelId'))).toHaveFocus()
    await fill(input(index, 'modelId'), id)
  }
  expect(modelRows().map((_, i) => input(i, 'modelId').value)).toEqual(['custom-model-1', 'custom-model-2', 'custom-model-3'])
  await fill(input(1, 'modelName'), '自定义模型二')

  // 右箭头展开该行的模型选项，箭头改为向下；收起后恢复紧凑行。
  const toggle = modelRow(0).getByRole('button', { name: '模型选项', exact: true })
  await expect.element(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(modelRows()[0]!.querySelector('[name="contextWindow"]')).toBeNull()
  await toggle.click()
  await expect.element(toggle).toHaveAttribute('aria-expanded', 'true')
  expect(toggle.element().querySelector('.tabler-icon-chevron-down')).not.toBeNull()
  const options = document.getElementById(toggle.element().getAttribute('aria-controls')!)!
  expect(modelRows()[0]!.contains(options)).toBe(true)
  expect(options.querySelector('[name="contextWindow"]')).not.toBeNull()
  await toggle.click()
  await expect.element(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(toggle.element().querySelector('.tabler-icon-chevron-right')).not.toBeNull()

  // 删除行不额外确认，焦点不落到 body。
  await modelRow(2).getByRole('button', { name: '删除模型', exact: true }).click()
  expect(modelRows()).toHaveLength(2)
  expect(document.querySelector('[role=alertdialog]')).toBeNull()
  expect(document.activeElement).not.toBe(document.body)
  expect(backend.saveProvider).not.toHaveBeenCalled()

  await dialog.getByRole('button', { name: '创建供应商', exact: true }).click()
  await expect.poll(() => backend.saveProvider.mock.calls.length).toBe(1)
  expect(backend.saveProvider.mock.calls[0]![0].provider.models).toEqual([
    catalogModel('custom-model-1'),
    catalogModel('custom-model-2', { name: '自定义模型二' }),
  ])
})

/** 某个输入框关联的字段错误文字。 */
const errorOf = (element: Element) =>
  (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id))
    .find((el) => el?.hasAttribute('data-field-error'))?.textContent ?? null

it('空目录、空模型 ID 或重复 ID 阻止提交并标出出错的行；改正后一次提交，显示名称留空的模型重新打开时以模型 ID 显示', async () => {
  const { dialog, backend } = await openModels('zh')
  await dialog.getByRole('button', { name: '添加模型供应商', exact: true }).click()
  await fillConnection()
  const create = dialog.getByRole('button', { name: '创建供应商', exact: true })
  const add = page.elementLocator(form()).getByRole('button', { name: '添加模型', exact: true })

  // 空目录：错误关联在“添加模型”上，并聚焦它。
  await create.click()
  await expect.poll(() => errorOf(add.element())).toBe('至少添加一个模型')
  await expect.element(add).toHaveFocus()

  await addRow('custom-model-1')
  expect(errorOf(add.element())).toBeNull()
  await addRow('')
  await addRow('custom-model-1')
  await addRow('custom-model-2')
  await create.click()
  // 第二行空 ID，第一、三行重复；第四行没有错误。
  await expect.poll(() => errorOf(input(1, 'modelId'))).toBe('请填写模型 ID')
  expect(errorOf(input(0, 'modelId'))).toBe('模型 ID 重复')
  expect(errorOf(input(2, 'modelId'))).toBe('模型 ID 重复')
  expect(input(3, 'modelId').getAttribute('aria-invalid')).toBeNull()
  expect(modelRows().map((r) => r.hasAttribute('data-invalid'))).toEqual([true, true, true, false])
  await expect.element(page.elementLocator(input(0, 'modelId'))).toHaveFocus()
  expect(backend.saveProvider).not.toHaveBeenCalled()

  // 修改该行后该行错误消失；删除重复行后提交。
  await fill(input(1, 'modelId'), 'custom-model-3')
  expect(errorOf(input(1, 'modelId'))).toBeNull()
  await modelRow(2).getByRole('button', { name: '删除模型', exact: true }).click()
  await create.click()
  await expect.poll(() => backend.saveProvider.mock.calls.length).toBe(1)
  expect(backend.saveProvider.mock.calls[0]![0].provider.models.map((m) => [m.id, m.name])).toEqual([
    ['custom-model-1', ''],
    ['custom-model-3', ''],
    ['custom-model-2', ''],
  ])

  // 重新打开：名称为空，以模型 ID 作为显示。
  const row = page.elementLocator(document.querySelector<HTMLElement>('[data-settings-page] [data-provider-id="custom-provider-1"]')!)
  await row.getByRole('button', { name: '编辑', exact: true }).click()
  await expect.poll(() => modelRows().length).toBe(3)
  expect(input(0, 'modelName').value).toBe('')
  expect(input(0, 'modelName').placeholder).toBe('custom-model-1')
})

/** 展开第 index 行的模型选项。 */
async function expand(index: number) {
  const toggle = modelRow(index).getByRole('button', { name: dictionaries.zh.providers.catalog.options, exact: true })
  await toggle.click()
  await expect.element(toggle).toHaveAttribute('aria-expanded', 'true')
}

it('容量：1M 与 128K 按 1000 进制存为 token 整数；0 与最大输出超过上下文窗口时报错并阻止提交，收起的出错行在提交时展开', async () => {
  const { dialog, backend } = await openModels('zh')
  await dialog.getByRole('button', { name: '添加模型供应商', exact: true }).click()
  await fillConnection()
  for (const id of ['custom-model-1', 'custom-model-2', 'custom-model-3']) await addRow(id)
  await expand(0)
  // 未填时提示默认值 128K / 16K；标准输入 H32。
  expect(input(0, 'contextWindow').placeholder).toBe('128K')
  expect(input(0, 'maxTokens').placeholder).toBe('16K')
  expect(input(0, 'contextWindow').getBoundingClientRect().height).toBe(32)
  await fill(input(0, 'contextWindow'), '1M')
  await fill(input(0, 'maxTokens'), '128K')
  await page.elementLocator(modelRows()[0]!).getByRole('checkbox', { name: '图片' }).click()
  // 文本是唯一剩下的输入类型时不能取消。
  await expand(1)
  await expect.element(modelRow(1).getByRole('checkbox', { name: '文本' })).toBeDisabled()
  await fill(input(1, 'contextWindow'), '0')
  await expand(2)
  await fill(input(2, 'contextWindow'), '64K')
  await fill(input(2, 'maxTokens'), '100K')
  // 收起第二、三行：错误仍阻止提交，提交时重新展开并聚焦第一个出错的容量。
  for (const index of [1, 2]) await modelRow(index).getByRole('button', { name: '模型选项', exact: true }).click()
  expect(modelRows()[1]!.querySelector('[name="contextWindow"]')).toBeNull()

  const create = dialog.getByRole('button', { name: '创建供应商', exact: true })
  await create.click()
  await expect.poll(() => modelRows()[1]!.querySelector('[name="contextWindow"]')).not.toBeNull()
  expect(errorOf(input(1, 'contextWindow'))).toBe(dictionaries.zh.providers.catalog.tokensInvalid)
  expect(errorOf(input(2, 'maxTokens'))).toBe('不能超过上下文窗口')
  // 收起不改变草稿：重新展开后仍是填写的原文。
  expect(input(2, 'contextWindow').value).toBe('64K')
  await expect.element(page.elementLocator(input(1, 'contextWindow'))).toHaveFocus()
  expect(backend.saveProvider).not.toHaveBeenCalled()

  await fill(input(1, 'contextWindow'), '')
  await fill(input(2, 'maxTokens'), '64000')
  await create.click()
  await expect.poll(() => backend.saveProvider.mock.calls.length).toBe(1)
  expect(backend.saveProvider.mock.calls[0]![0].provider.models).toEqual([
    catalogModel('custom-model-1', { contextWindow: 1_000_000, maxTokens: 128_000, input: ['text', 'image'] }),
    catalogModel('custom-model-2', { contextWindow: 128_000, maxTokens: 16_000 }),
    catalogModel('custom-model-3', { contextWindow: 64_000, maxTokens: 64_000 }),
  ])
})

it('编辑：已保存的容量带后缀回显，输入类型、推理开关与档位原样保留；只展开与收起不算修改，保存后再次打开与库中一致', async () => {
  const rich = catalogModel('custom-model-1', {
    name: '自定义模型一',
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    input: ['text', 'image'],
    reasoning: true,
    thinkingLevels: [{ level: 'off' }, { level: 'high', value: 'high' }],
  })
  const { dialog, backend } = await openModels('zh', (b) =>
    b.seedProvider({ ...customProvider('custom-provider-2', []), name: '自定义供应商二', models: [rich, catalogModel('custom-model-2')] }, 'sk-2222'),
  )
  const edit = page
    .elementLocator(document.querySelector<HTMLElement>('[data-settings-page] [data-provider-id="custom-provider-2"]')!)
    .getByRole('button', { name: '编辑', exact: true })
  await edit.click()
  await expect.poll(() => modelRows().length).toBe(2)
  expect(input(0, 'modelName').value).toBe('自定义模型一')
  await expand(0)
  expect([input(0, 'contextWindow').value, input(0, 'maxTokens').value]).toEqual(['1M', '128K'])
  await expect.element(modelRow(0).getByRole('checkbox', { name: '图片' })).toBeChecked()
  await modelRow(0).getByRole('button', { name: '模型选项', exact: true }).click()
  // 只改变展开状态：再次点击“编辑”直接收起，不提示放弃更改。
  await edit.click()
  await expect.poll(() => document.querySelector('[data-settings-page] [data-provider-form]')).toBeNull()
  expect(document.querySelector('[role=alertdialog]')).toBeNull()

  await edit.click()
  await expect.poll(() => modelRows().length).toBe(2)
  await expand(1)
  await fill(input(1, 'maxTokens'), '32K')
  await dialog.getByRole('button', { name: '保存更改', exact: true }).click()
  await expect.poll(() => document.querySelector('[data-settings-page] [data-provider-form]')).toBeNull()
  const saved = [rich, catalogModel('custom-model-2', { maxTokens: 32_000 })]
  expect(backend.providers[0]!.models).toEqual(saved)

  await edit.click()
  await expect.poll(() => modelRows().length).toBe(2)
  await expand(1)
  expect([input(1, 'contextWindow').value, input(1, 'maxTokens').value]).toEqual(['128K', '32K'])
})

it('几何与深色主题：行内输入 H32/R12，图标按钮 H28/R8 且有可访问名称；展开行使用语义色并随主题变化', async () => {
  const { dialog, appearance } = await openModels('en')
  await dialog.getByRole('button', { name: 'Add model provider', exact: true }).click()
  await page.elementLocator(form()).getByRole('button', { name: 'Add model', exact: true }).click()
  const id = input(0, 'modelId')
  expect(id.getBoundingClientRect().height).toBe(32)
  expect(getComputedStyle(id).borderRadius).toBe('12px')
  const toggle = modelRow(0).getByRole('button', { name: 'Model options', exact: true }).element()
  const remove = modelRow(0).getByRole('button', { name: 'Delete model', exact: true }).element()
  for (const button of [toggle, remove]) {
    expect(button.getBoundingClientRect().height).toBe(28)
    expect(getComputedStyle(button).borderRadius).toBe('8px')
  }
  expect(getComputedStyle(modelRows()[0]!).borderRadius).toBe('16px')
  ;(toggle as HTMLElement).click()
  await expect.poll(() => modelRows()[0]!.hasAttribute('data-expanded')).toBe(true)
  const light = getComputedStyle(modelRows()[0]!).backgroundColor
  appearance.setTheme('dark')
  await expect.poll(() => document.documentElement.classList.contains('dark')).toBe(true)
  expect(getComputedStyle(modelRows()[0]!).backgroundColor).not.toBe(light)
})
