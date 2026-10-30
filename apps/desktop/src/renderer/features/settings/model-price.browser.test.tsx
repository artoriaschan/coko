// 模型价格与显示货币（设置 → 模型服务）：展开的模型选项中填写每百万 token 的价格（留空为未定价，负数与只填一半报错并阻止提交），随创建或
// 保存一次提交；编辑时回显已保存的价格，清空后提交为未定价；顶部选择费用货币（usage.currency，缺省 USD），价格标题随之显示符号。
import '../../styles.css'
import { dictionaries } from '@coko/i18n'
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
})

type Backend = ReturnType<typeof fakeSettingsBackend>
const zh = dictionaries.zh

async function openModels(seed: (backend: Backend) => void = () => {}) {
  await page.viewport(1280, 800)
  const appearance = createAppearanceStore({ theme: 'light', locale: 'zh' })
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
  await expect.element(dialog.getByRole('heading', { name: zh.providers.title })).toBeVisible()
  return { dialog, backend }
}

const form = () => document.querySelector<HTMLFormElement>('[data-settings-page] [data-provider-form]')!
const modelRows = () => [...form().querySelectorAll<HTMLElement>('[data-model-row]')]
const input = (index: number, name: string) => modelRows()[index]!.querySelector<HTMLInputElement>('[name="' + name + '"]')!
const fill = (element: HTMLInputElement, value: string) => page.elementLocator(element).fill(value)
const errorOf = (element: Element) =>
  (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id))
    .find((el) => el?.hasAttribute('data-field-error'))?.textContent ?? null

async function expand(index: number) {
  const toggle = page.elementLocator(modelRows()[index]!).getByRole('button', { name: zh.providers.catalog.options, exact: true })
  await toggle.click()
  await expect.element(toggle).toHaveAttribute('aria-expanded', 'true')
}

async function addRow(id: string) {
  await page.elementLocator(form()).getByRole('button', { name: zh.providers.catalog.add, exact: true }).click()
  const last = modelRows().length - 1
  await expect.element(page.elementLocator(input(last, 'modelId'))).toHaveFocus()
  await fill(input(last, 'modelId'), id)
}

it('价格：留空为未定价；负数、非数字与只填一半报错并阻止提交，收起的出错行在提交时展开；改正后随创建一次提交', async () => {
  const { dialog, backend } = await openModels()
  await dialog.getByRole('button', { name: '添加模型供应商', exact: true }).click()
  await fill(form().querySelector<HTMLInputElement>('[name="providerId"]')!, 'custom-provider-1')
  await fill(form().querySelector<HTMLInputElement>('[name="name"]')!, '自定义供应商一')
  await fill(form().querySelector<HTMLInputElement>('[name="baseUrl"]')!, 'https://gateway.example/v1')
  await fill(form().querySelector<HTMLInputElement>('[name="credential"]')!, 'sk-price-1111')
  for (const id of ['priced', 'unpriced', 'half']) await addRow(id)

  await expand(0)
  const group = modelRows()[0]!.querySelector<HTMLElement>('[data-model-price]')!
  expect(group.textContent).toContain('价格（每百万 token，$）')
  expect(group.textContent).toContain(zh.usage.price.hint)
  expect(['priceInput', 'priceOutput', 'priceCacheRead', 'priceCacheWrite'].map((name) => input(0, name).value)).toEqual(['', '', '', ''])
  await fill(input(0, 'priceInput'), '-1')
  await fill(input(0, 'priceOutput'), 'abc')
  await fill(input(0, 'priceCacheRead'), '0.25')
  await expand(2)
  await fill(input(2, 'priceCacheWrite'), '3')
  // 收起出错的第三行：提交时重新展开。
  await page.elementLocator(modelRows()[2]!).getByRole('button', { name: zh.providers.catalog.options, exact: true }).click()

  const create = dialog.getByRole('button', { name: '创建供应商', exact: true })
  await create.click()
  await expect.poll(() => modelRows()[2]!.querySelector('[name="priceInput"]')).not.toBeNull()
  expect(errorOf(input(0, 'priceInput'))).toBe(zh.usage.price.invalid)
  expect(errorOf(input(0, 'priceOutput'))).toBe(zh.usage.price.invalid)
  expect(errorOf(input(2, 'priceInput'))).toBe(zh.usage.price.required)
  expect(errorOf(input(2, 'priceOutput'))).toBe(zh.usage.price.required)
  await expect.element(page.elementLocator(input(0, 'priceInput'))).toHaveFocus()
  expect(backend.saveProvider).not.toHaveBeenCalled()

  await fill(input(0, 'priceInput'), '2')
  await fill(input(0, 'priceOutput'), '10.5')
  await fill(input(2, 'priceInput'), '0')
  await fill(input(2, 'priceOutput'), '0')
  await create.click()
  await expect.poll(() => backend.saveProvider.mock.calls.length).toBe(1)
  expect(backend.saveProvider.mock.calls[0]![0].provider.models).toEqual([
    catalogModel('priced', { price: { input: 2, output: 10.5, cacheRead: 0.25 } }),
    catalogModel('unpriced'),
    catalogModel('half', { price: { input: 0, output: 0, cacheWrite: 3 } }),
  ])
})

it('编辑：回显已保存的价格；只展开不算修改；清空四项后保存为未定价', async () => {
  const price = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
  const { dialog, backend } = await openModels((b) =>
    b.seedProvider({ ...customProvider('custom-provider-2', []), models: [catalogModel('m1', { price }), catalogModel('m2')] }, 'sk-2222'),
  )
  const edit = page.elementLocator(document.querySelector<HTMLElement>('[data-settings-page] [data-provider-id="custom-provider-2"]')!).getByRole('button', {
    name: '编辑',
    exact: true,
  })
  await edit.click()
  await expect.poll(() => modelRows().length).toBe(2)
  await expand(0)
  expect(['priceInput', 'priceOutput', 'priceCacheRead', 'priceCacheWrite'].map((name) => input(0, name).value)).toEqual(['3', '15', '0.3', '3.75'])
  await expand(1)
  expect(input(1, 'priceInput').value).toBe('')
  // 只展开：再次点击“编辑”直接收起，不提示放弃更改。
  await edit.click()
  await expect.poll(() => document.querySelector('[data-settings-page] [data-provider-form]')).toBeNull()
  expect(document.querySelector('[role=alertdialog]')).toBeNull()

  await edit.click()
  await expect.poll(() => modelRows().length).toBe(2)
  await expand(0)
  for (const name of ['priceInput', 'priceOutput', 'priceCacheRead', 'priceCacheWrite']) await fill(input(0, name), '')
  await dialog.getByRole('button', { name: '保存更改', exact: true }).click()
  await expect.poll(() => document.querySelector('[data-settings-page] [data-provider-form]')).toBeNull()
  expect(backend.providers[0]!.models).toEqual([catalogModel('m1'), catalogModel('m2')])
})

it('费用货币：缺省 USD；选择人民币保存 usage.currency 为 CNY，价格标题显示 ¥', async () => {
  const { dialog, backend } = await openModels((b) => b.seedProvider({ ...customProvider('custom-provider-3', ['m1']) }, 'sk-3333'))
  const group = dialog.getByRole('radiogroup', { name: zh.usage.currency.label })
  await expect.element(group.getByRole('radio', { name: zh.usage.currency.USD })).toHaveAttribute('aria-checked', 'true')
  await group.getByRole('radio', { name: zh.usage.currency.CNY }).click()
  await expect.poll(() => backend.settings.get('usage.currency')?.value).toBe('CNY')
  await expect.element(group.getByRole('radio', { name: zh.usage.currency.CNY })).toHaveAttribute('aria-checked', 'true')

  await page
    .elementLocator(document.querySelector<HTMLElement>('[data-settings-page] [data-provider-id="custom-provider-3"]')!)
    .getByRole('button', { name: '编辑', exact: true })
    .click()
  await expect.poll(() => modelRows().length).toBe(1)
  await expand(0)
  expect(modelRows()[0]!.querySelector('[data-model-price]')!.textContent).toContain('价格（每百万 token，¥）')
})
