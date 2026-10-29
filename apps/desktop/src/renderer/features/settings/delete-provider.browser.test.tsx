// 删除供应商（规格 4.1，MS-32、MS-33 的界面部分）：二次确认框写明引用它的 Session 数量；取消时不做任何修改；确认后列表移除、
// 会话列表重新读取，引用它的会话在下次运行前提示重新选择模型。后端为 fake（引用数量与清空模型字段按 Sidecar 规则模拟）。
import '../../styles.css'
import type { Session } from '@coko/protocol'
import { toast } from '@coko/ui'
import { afterEach, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsDialogStore } from '../../app/settings-dialog-store.ts'
import { ApiError } from '../../client/api.ts'
import { customProvider, type fakeSettingsBackend } from '../../testing/fake-settings.ts'
import { createFixtureChat, fixtureSessions } from '../../testing/fixture-chat.ts'

afterEach(async () => {
  toast.dismiss()
  await vi.waitFor(() => {
    if (document.querySelector('[data-sonner-toast]')) throw new Error('toast still mounted')
  })
})

type Backend = ReturnType<typeof fakeSettingsBackend>

const settled = () => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)))

/** 会话 s-1 与 s-3 使用 custom-provider-1，s-2 使用 custom-provider-2。 */
const sessions = (): Session[] =>
  fixtureSessions.slice(0, 3).map((s, i) => ({ ...s, model: { providerId: i === 1 ? 'custom-provider-2' : 'custom-provider-1', modelId: 'custom-model-1' } }))

async function openModels(locale: 'zh' | 'en', seed: (backend: Backend) => void) {
  await page.viewport(1280, 800)
  const appearance = createAppearanceStore({ theme: 'light', locale })
  const fixture = createFixtureChat({ providers: false, sessions: sessions() })
  seed(fixture.backend)
  const settingsDialog = createSettingsDialogStore()
  const preferences = createPreferences({ appearance, settings: fixture.settings, onConflict: () => {}, onFailure: () => {} })
  await render(
    <div style={{ width: '100vw', height: '100vh' }}>
      <App
        store={appearance}
        connection={createConnectionStore()}
        chat={fixture.chat}
        settings={fixture.settings}
        preferences={preferences}
        settingsDialog={settingsDialog}
        pickDirectory={async () => null}
      />
    </div>,
  )
  await fixture.settings.getState().load()
  settingsDialog.show('models')
  await expect.element(page.getByRole('dialog').getByRole('heading', { name: locale === 'zh' ? '模型服务' : 'Model services' })).toBeVisible()
  await settled()
  return { ...fixture, settingsDialog }
}

const seedTwo = (backend: Backend) => {
  backend.seedProvider(customProvider('custom-provider-1', ['custom-model-1'], { name: '自定义供应商一' }), 'sk-one-1111')
  backend.seedProvider(customProvider('custom-provider-2', ['custom-model-1'], { name: '自定义供应商二' }))
  backend.setReferences('custom-provider-1', 2)
  backend.setReferences('custom-provider-2', 1)
}

const row = (id: string) => page.elementLocator(document.querySelector<HTMLElement>(`[role=dialog] [data-provider-id="${id}"]`)!)
const confirmDialog = () => page.getByRole('alertdialog')

it('确认框写明引用数量；取消时不做任何修改，焦点回到“删除”', async () => {
  const { backend } = await openModels('zh', seedTwo)
  const remove = row('custom-provider-1').getByRole('button', { name: '删除', exact: true })
  await remove.click()
  await expect.element(confirmDialog().getByRole('heading', { name: '删除“自定义供应商一”？' })).toBeVisible()
  await expect.element(confirmDialog().getByText('有 2 个会话正在使用它；删除后这些会话需要重新选择模型')).toBeVisible()
  expect(backend.raw.providerReferences).toHaveBeenCalledWith('custom-provider-1')
  // 默认焦点在“取消”。
  await expect.element(confirmDialog().getByRole('button', { name: '取消', exact: true })).toHaveFocus()
  await confirmDialog().getByRole('button', { name: '取消', exact: true }).click()
  await expect.poll(() => document.querySelector('[role=alertdialog]')).toBeNull()
  expect(backend.raw.deleteProvider).not.toHaveBeenCalled()
  expect(backend.providers.map((p) => p.id)).toEqual(['custom-provider-1', 'custom-provider-2'])
  await expect.element(remove).toHaveFocus()
})

it('Escape 等于取消；每次打开重新读取引用数量，没有会话引用时如实说明', async () => {
  const { backend } = await openModels('zh', seedTwo)
  await row('custom-provider-2').getByRole('button', { name: '删除', exact: true }).click()
  await expect.element(confirmDialog().getByText('有 1 个会话正在使用它；删除后这些会话需要重新选择模型')).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => document.querySelector('[role=alertdialog]')).toBeNull()
  backend.setReferences('custom-provider-2', 0)
  await row('custom-provider-2').getByRole('button', { name: '删除', exact: true }).click()
  await expect.element(confirmDialog().getByText('没有会话正在使用它')).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => document.querySelector('[role=alertdialog]')).toBeNull()
  expect(backend.raw.deleteProvider).not.toHaveBeenCalled()
  expect(backend.providers).toHaveLength(2)
})

it('确认删除：列表移除、提示已删除、焦点移到下一个供应商；引用它的会话模型为空，输入区提示重新选择模型', async () => {
  const { backend, settingsDialog } = await openModels('zh', seedTwo)
  await row('custom-provider-1').getByRole('button', { name: '删除', exact: true }).click()
  const confirm = confirmDialog().getByRole('button', { name: '删除', exact: true })
  await expect.element(confirm).toBeEnabled()
  await confirm.click()
  await expect
    .poll(() => [...document.querySelectorAll<HTMLElement>('[role=dialog] [data-provider-id]')].map((r) => r.dataset.providerId))
    .toEqual(['custom-provider-2'])
  expect(backend.raw.deleteProvider).toHaveBeenCalledExactlyOnceWith('custom-provider-1')
  await expect.element(page.getByText('供应商已删除')).toBeVisible()
  await expect.element(row('custom-provider-2').getByRole('button', { name: '编辑', exact: true })).toHaveFocus()

  // 当前会话 s-1 引用了被删除的供应商：模型选择器显示“选择模型”，输入区上方提示重新选择。
  settingsDialog.close()
  await expect.poll(() => document.querySelector('[role=dialog]')).toBeNull()
  const picker = page.elementLocator(document.querySelector<HTMLElement>('[data-model-picker]')!)
  await expect.element(picker).toHaveAccessibleName('选择模型：选择模型')
  expect(picker.element().hasAttribute('data-model')).toBe(false)
  await expect.element(page.getByRole('status').filter({ hasText: '这个会话的模型已不可用，请先选择模型' })).toBeVisible()
  // 选择模型后提示消失。
  await picker.click()
  await page.getByRole('menuitemradio', { name: 'custom-model-1' }).click()
  await expect.poll(() => document.querySelector('[data-slot="model-required"]')).toBeNull()
})

it('引用数量读取失败时不能确认删除，可重试；删除失败时保留确认框与列表并提示', async () => {
  const { backend } = await openModels('en', seedTwo)
  backend.raw.providerReferences.mockRejectedValueOnce(new ApiError('network', 'offline', 0))
  await row('custom-provider-1').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect.element(confirmDialog().getByText("Couldn't count the sessions that use it")).toBeVisible()
  await expect.element(confirmDialog().getByRole('button', { name: 'Delete', exact: true })).toBeDisabled()
  await confirmDialog().getByRole('button', { name: 'Retry', exact: true }).click()
  await expect.element(confirmDialog().getByText('2 session(s) use it. They will need a new model before their next run.')).toBeVisible()

  backend.raw.deleteProvider.mockRejectedValueOnce(new ApiError('network', 'offline', 0))
  await confirmDialog().getByRole('button', { name: 'Delete', exact: true }).click()
  await expect.element(page.getByText('Could not delete the provider')).toBeVisible()
  await expect.element(confirmDialog().getByRole('button', { name: 'Delete', exact: true })).toBeEnabled()
  expect(backend.providers.map((p) => p.id)).toEqual(['custom-provider-1', 'custom-provider-2'])
})

it('从未设置过模型的会话不提示重新选择：模型选择器显示默认模型，运行时由 Sidecar 取默认模型', async () => {
  await page.viewport(1280, 800)
  const never = sessions().map((s, i) => (i === 0 ? { ...s, model: null, modelCleared: false } : s))
  const fixture = createFixtureChat({ providers: false, sessions: never })
  seedTwo(fixture.backend)
  const appearance = createAppearanceStore({ theme: 'light', locale: 'zh' })
  await render(
    <div style={{ width: '100vw', height: '100vh' }}>
      <App
        store={appearance}
        connection={createConnectionStore()}
        chat={fixture.chat}
        settings={fixture.settings}
        preferences={createPreferences({ appearance, settings: fixture.settings, onConflict: () => {}, onFailure: () => {} })}
        settingsDialog={createSettingsDialogStore()}
        pickDirectory={async () => null}
      />
    </div>,
  )
  await fixture.settings.getState().load()
  await expect.poll(() => document.querySelector('[data-model-picker]')?.getAttribute('data-model')).toBe('custom-provider-1/custom-model-1')
  expect(document.querySelector('[data-slot="model-required"]')).toBeNull()
})
