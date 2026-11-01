// 设置 → 关于：更新状态的各分支文案（disabled 的两种原因、已下载的版本、错误说明）、按钮可用性、键盘操作，以及明暗主题下错误文字的对比度。
import '../../styles.css'
import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import type { UpdateStatus } from '../../../shared/bridge.ts'
import { I18nProvider } from '../../app/i18n.tsx'
import { createUpdateStore, type UpdateBridge } from '../../stores/update-store.ts'
import { AboutSectionView } from './about-section.tsx'

afterEach(() => document.documentElement.classList.remove('dark'))

function fakeBridge(initial: UpdateStatus) {
  const listeners = new Set<(status: UpdateStatus) => void>()
  const calls: string[] = []
  const bridge: UpdateBridge = {
    onUpdateStatus(listener) {
      listeners.add(listener)
      listener(initial)
      return () => void listeners.delete(listener)
    },
    checkForUpdates: async () => void calls.push('check'),
    installUpdate: async () => void calls.push('install'),
  }
  return { bridge, calls, push: (s: UpdateStatus) => listeners.forEach((l) => l(s)), listeners }
}

async function renderAbout(initial: UpdateStatus, locale: 'en' | 'zh' = 'en') {
  const fake = fakeBridge(initial)
  const screen = await render(
    <I18nProvider locale={locale}>
      <AboutSectionView store={createUpdateStore(fake.bridge)} />
    </I18nProvider>,
  )
  return { ...fake, screen }
}

const luminance = (value: string) => {
  const [r, g, b] = value
    .match(/[\d.]+/g)!
    .slice(0, 3)
    .map((n) => {
      const c = Number(n) / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (fg: string, bg: string) => {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x) as [number, number]
  return (a + 0.05) / (b + 0.05)
}
/** 最近的不透明背景色。 */
const backgroundOf = (el: Element): string => {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const bg = getComputedStyle(node).backgroundColor
    if (!/rgba\(.*,\s*0\)$/.test(bg) && bg !== 'transparent') return bg
  }
  return getComputedStyle(document.body).backgroundColor
}

describe('关于：更新状态', () => {
  it.each([
    [{ state: 'disabled', reason: 'not-packaged' }, 'Unavailable', 'Only the installed app can check for updates'],
    [{ state: 'disabled', reason: 'no-feed' }, 'Unavailable', 'This build has no update source'],
  ] as const)('%o：说明原因，检查更新不可用', async (status, label, detail) => {
    const { screen, calls } = await renderAbout(status)
    await expect.element(screen.getByText(label)).toBeVisible()
    await expect.element(screen.getByText(detail)).toBeVisible()
    await expect.element(screen.getByRole('button', { name: 'Check for updates' })).toBeDisabled()
    expect(calls).toEqual([])
  })

  it('已是最新时可再次检查（键盘：Tab 到按钮后 Enter）；检查中按钮不可用', async () => {
    const { screen, calls, push } = await renderAbout({ state: 'not-available' })
    await expect.element(screen.getByText('You are up to date')).toBeVisible()
    const button = screen.getByRole('button', { name: 'Check for updates' })
    await expect.element(button).toBeEnabled()
    ;(document.activeElement as HTMLElement | null)?.blur()
    await userEvent.tab()
    expect(document.activeElement).toBe(button.element())
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => calls).toEqual(['check'])
    push({ state: 'checking' })
    await expect.element(screen.getByText('Checking for updates…')).toBeVisible()
    await expect.element(button).toBeDisabled()
    await expect.element(button).toHaveAttribute('aria-busy', 'true')
  })

  it('已下载：显示版本与"重启以更新"，点击调用 installUpdate', async () => {
    const { screen, calls } = await renderAbout({ state: 'downloaded', version: '1.2.3' })
    await expect.element(screen.getByText('Version 1.2.3 is ready and installs when you restart')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Check for updates' }).query()).toBeNull()
    await screen.getByRole('button', { name: 'Restart to update' }).click()
    await expect.poll(() => calls).toEqual(['install'])
  })

  it('错误：显示状态与原因，可以重试；明暗主题下原因文字对比度 ≥ 4.5，错误图标 ≥ 3', async () => {
    const message = 'Could not get code signature for running application'
    const { screen } = await renderAbout({ state: 'error', message }, 'zh')
    await expect.element(screen.getByText('检查更新失败')).toBeVisible()
    await expect.element(screen.getByText(`原因：${message}`)).toBeVisible()
    await expect.element(screen.getByRole('button', { name: '检查更新' })).toBeEnabled()
    const detail = screen.getByText(`原因：${message}`).element()
    for (const dark of [false, true]) {
      document.documentElement.classList.toggle('dark', dark)
      await expect.poll(() => contrast(getComputedStyle(detail).color, backgroundOf(detail))).toBeGreaterThanOrEqual(4.5)
      const icon = screen.container.querySelector('[data-update-error-icon]')!
      expect(contrast(getComputedStyle(icon).color, backgroundOf(icon))).toBeGreaterThanOrEqual(3)
    }
  })

  it('卸载后退订', async () => {
    const { screen, listeners } = await renderAbout({ state: 'idle' })
    expect(listeners.size).toBe(1)
    await screen.unmount()
    expect(listeners.size).toBe(0)
  })
})
