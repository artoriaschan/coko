// 模型选项中的推理档位（规格 4.5，MS-15 至 MS-18、MS-36 的表单一侧）：“推理等级”开关、档位列表、添加档位与参数值；
// 档位随“创建供应商”或“保存更改”经 fake 的 saveProvider 一次提交（ADR 0010）。
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
})

type Backend = ReturnType<typeof fakeSettingsBackend>

/** 等页面上的动画（弹窗缩放、菜单淡入）结束。 */
const settled = () => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)))

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
  await settled()
  return { dialog, backend, appearance }
}

const form = () => document.querySelector<HTMLFormElement>('[role=dialog] [data-provider-form]')!
const modelRows = () => [...form().querySelectorAll<HTMLElement>('[data-model-row]')]
const levelRows = (model = 0) => [...modelRows()[model]!.querySelectorAll<HTMLElement>('[data-thinking-level]')]
const levels = (model = 0) => levelRows(model).map((row) => row.dataset.thinkingLevel)
const addLevelButton = (model = 0) => page.elementLocator(modelRows()[model]!).getByRole('button', { name: '添加档位', exact: true })
const connection = (name: string) => form().querySelector<HTMLInputElement>(`[name="${name}"]`)!

/** 展开第 index 个模型的选项。 */
async function expand(index = 0) {
  const toggle = page.elementLocator(modelRows()[index]!).getByRole('button', { name: '模型选项', exact: true })
  await toggle.click()
  await expect.element(toggle).toHaveAttribute('aria-expanded', 'true')
}

/** 新建表单：填好连接信息、Key，并添加一个模型。 */
async function startCreate(dialog: ReturnType<typeof page.getByRole>) {
  await dialog.getByRole('button', { name: '添加模型供应商', exact: true }).click()
  await page.elementLocator(connection('providerId')).fill('custom-provider-1')
  await page.elementLocator(connection('name')).fill('自定义供应商一')
  await page.elementLocator(connection('baseUrl')).fill('https://gateway.example/v1')
  await page.elementLocator(connection('credential')).fill('sk-thinking-1111')
  await page.elementLocator(form()).getByRole('button', { name: '添加模型', exact: true }).click()
  const id = modelRows()[0]!.querySelector<HTMLInputElement>('[name="modelId"]')!
  await expect.element(page.elementLocator(id)).toHaveFocus()
  await page.elementLocator(id).fill('custom-model-1')
}

it('从无档位开始连续添加七次：顺序为 off 至 max，第七次后按钮禁用且仍为“添加档位”；off 参数禁用并显示“关闭思考”，其余默认等于档位名；连接字段仍在，随“创建供应商”一次提交', async () => {
  const { dialog, backend } = await openModels('zh')
  await startCreate(dialog)
  await expand()
  const model = page.elementLocator(modelRows()[0]!)
  const toggle = model.getByRole('switch', { name: '推理等级' })
  await expect.element(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()
  await expect.element(toggle).toHaveAttribute('aria-checked', 'true')
  expect(levels()).toEqual([])

  const add = addLevelButton()
  for (let i = 0; i < 7; i++) {
    await expect.element(add).toBeEnabled()
    await add.click()
  }
  expect(levels()).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  await expect.element(add).toBeDisabled()
  expect(add.element().textContent).toBe('添加档位')
  // 按钮旁没有顺序、下一档或“已添加全部档位”提示；禁用态几何不变（小按钮 H28）。
  expect(add.element().parentElement!.textContent).toBe('添加档位')
  expect(form().textContent).not.toContain('已添加全部档位')
  expect(add.element().getBoundingClientRect().height).toBe(28)
  // 焦点不因按钮禁用落到 body。
  expect(document.activeElement).not.toBe(document.body)

  const value = (level: string) => form().querySelector<HTMLInputElement>(`[data-thinking-level="${level}"] [name="thinkingValue"]`)!
  expect(value('off').disabled).toBe(true)
  expect(value('off').value).toBe('')
  expect(value('off').placeholder).toBe('关闭思考')
  for (const level of ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
    expect(value(level).disabled).toBe(false)
    expect(value(level).value).toBe(level)
  }
  await page.elementLocator(value('high')).fill('effort-high')
  // 档位选择器 H36，参数输入 H32。
  const select = page.elementLocator(levelRows()[1]!).getByRole('button', { name: '档位', exact: true })
  expect(select.element().getBoundingClientRect().height).toBe(36)
  await expect.element(select).toHaveTextContent('minimal')
  expect(value('minimal').getBoundingClientRect().height).toBe(32)

  // 连接字段与 Key 仍完整展开，与目录共用“创建供应商”。
  for (const name of ['providerId', 'name', 'baseUrl', 'credential']) expect(connection(name).checkVisibility()).toBe(true)
  await dialog.getByRole('button', { name: '创建供应商', exact: true }).click()
  await expect.poll(() => backend.saveProvider.mock.calls.length).toBe(1)
  expect(backend.saveProvider.mock.calls[0]![0].provider.models).toEqual([
    catalogModel('custom-model-1', {
      reasoning: true,
      thinkingLevels: [
        { level: 'off' },
        { level: 'minimal', value: 'minimal' },
        { level: 'low', value: 'low' },
        { level: 'medium', value: 'medium' },
        { level: 'high', value: 'effort-high' },
        { level: 'xhigh', value: 'xhigh' },
        { level: 'max', value: 'max' },
      ],
    }),
  ])
})

/** 编辑已有 Provider 并展开第一个模型。 */
async function openEdit(dialog: ReturnType<typeof page.getByRole>, id = 'custom-provider-2') {
  const edit = page
    .elementLocator(document.querySelector<HTMLElement>(`[role=dialog] [data-provider-id="${id}"]`)!)
    .getByRole('button', { name: '编辑', exact: true })
  await edit.click()
  await expect.poll(() => modelRows().length).toBeGreaterThan(0)
  await expand()
  return edit
}

it('删除一个档位后再次添加补齐最早缺失档位；修改某行档位只能选尚未配置的档位，键盘可操作档位菜单', async () => {
  const { dialog, backend } = await openModels('zh', (b) =>
    b.seedProvider(
      {
        ...customProvider('custom-provider-2', []),
        name: '自定义供应商二',
        models: [
          catalogModel('custom-model-1', {
            reasoning: true,
            thinkingLevels: [{ level: 'off' }, { level: 'minimal', value: 'minimal' }, { level: 'high', value: 'effort-high' }],
          }),
        ],
      },
      'sk-2222',
    ),
  )
  await openEdit(dialog)
  expect(levels()).toEqual(['off', 'minimal', 'high'])
  await page.elementLocator(levelRows()[1]!).getByRole('button', { name: '删除档位', exact: true }).click()
  expect(levels()).toEqual(['off', 'high'])
  // 删除不额外确认，焦点到“添加档位”。
  expect(document.querySelector('[role=alertdialog]')).toBeNull()
  await expect.element(addLevelButton()).toHaveFocus()
  await addLevelButton().click()
  expect(levels()).toEqual(['off', 'high', 'minimal'])
  await addLevelButton().click()
  expect(levels()).toEqual(['off', 'high', 'minimal', 'low'])

  // 修改 high 行：只列出 high 与尚未配置的档位。
  const select = page.elementLocator(levelRows()[1]!.querySelector<HTMLElement>('[data-thinking-select]')!)
  select.element().focus()
  await userEvent.keyboard('{Enter}')
  const choices = page.getByRole('menuitemradio')
  await expect.element(choices.first()).toHaveFocus()
  await settled()
  expect(choices.elements().map((el) => el.textContent)).toEqual(['medium', 'high', 'xhigh', 'max'])
  expect(choices.elements()[1]!.getAttribute('aria-checked')).toBe('true')
  // 第一项为 medium：方向键到 xhigh 后选择，参数值取 xhigh 的默认值。
  for (const key of ['{ArrowDown}', '{ArrowDown}']) await userEvent.keyboard(key)
  await expect.element(page.getByRole('menuitemradio', { name: 'xhigh' })).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  expect(levels()).toEqual(['off', 'xhigh', 'minimal', 'low'])
  expect(levelRows()[1]!.querySelector<HTMLInputElement>('[name="thinkingValue"]')!.value).toBe('xhigh')
  await expect.element(select).toHaveFocus()

  await dialog.getByRole('button', { name: '保存更改', exact: true }).click()
  await expect.poll(() => document.querySelector('[role=dialog] [data-provider-form]')).toBeNull()
  expect(backend.providers[0]!.models[0]!.thinkingLevels).toEqual([
    { level: 'off' },
    { level: 'xhigh', value: 'xhigh' },
    { level: 'minimal', value: 'minimal' },
    { level: 'low', value: 'low' },
  ])
})

it('推理等级开关关闭时已填档位仍随草稿保存；重新打开表单时仍在，开关仍为关闭；会话中该模型只有“关闭”', async () => {
  const { dialog, backend } = await openModels('zh', (b) =>
    b.seedProvider(
      {
        ...customProvider('custom-provider-2', []),
        name: '自定义供应商二',
        models: [catalogModel('custom-model-1', { reasoning: true, thinkingLevels: [{ level: 'off' }, { level: 'high', value: 'effort-high' }] })],
      },
      'sk-2222',
    ),
  )
  const edit = await openEdit(dialog)
  const toggle = () => page.elementLocator(modelRows()[0]!).getByRole('switch', { name: '推理等级' })
  await expect.element(toggle()).toHaveAttribute('aria-checked', 'true')
  await toggle().click()
  await expect.element(toggle()).toHaveAttribute('aria-checked', 'false')
  // 开关关闭后档位仍显示且可编辑。
  expect(levels()).toEqual(['off', 'high'])
  await expect.element(addLevelButton()).toBeEnabled()
  await dialog.getByRole('button', { name: '保存更改', exact: true }).click()
  await expect.poll(() => document.querySelector('[role=dialog] [data-provider-form]')).toBeNull()
  expect(backend.saveProvider.mock.calls[0]![0].provider.models[0]).toMatchObject({
    reasoning: false,
    thinkingLevels: [{ level: 'off' }, { level: 'high', value: 'effort-high' }],
  })
  // 按 Sidecar 规则：开关关闭的模型在会话中只能选 off。
  const { models } = await backend.api.listModels()
  expect(models.find((m) => m.modelId === 'custom-model-1')?.thinkingLevels).toEqual(['off'])

  await edit.click()
  await expect.poll(() => modelRows().length).toBe(1)
  await expand()
  await expect.element(toggle()).toHaveAttribute('aria-checked', 'false')
  expect(levels()).toEqual(['off', 'high'])
  expect(levelRows()[1]!.querySelector<HTMLInputElement>('[name="thinkingValue"]')!.value).toBe('effort-high')
})

it('只打开开关或改档位算作未保存修改；深色主题下开关与 off 参数使用语义色', async () => {
  const { dialog, appearance } = await openModels('zh', (b) =>
    b.seedProvider({ ...customProvider('custom-provider-2', []), name: '自定义供应商二', models: [catalogModel('custom-model-1')] }, 'sk-2222'),
  )
  await openEdit(dialog)
  await page.elementLocator(modelRows()[0]!).getByRole('switch', { name: '推理等级' }).click()
  await addLevelButton().click()
  const off = levelRows()[0]!.querySelector<HTMLInputElement>('[name="thinkingValue"]')!
  const light = getComputedStyle(off).backgroundColor
  appearance.setTheme('dark')
  await expect.poll(() => document.documentElement.classList.contains('dark')).toBe(true)
  await expect.poll(() => getComputedStyle(off).backgroundColor).not.toBe(light)
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect.element(page.getByRole('alertdialog', { name: '放弃更改？' })).toBeVisible()
})
