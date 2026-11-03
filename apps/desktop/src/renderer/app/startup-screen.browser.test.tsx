import '../styles.css'
import { expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { StartupScreen } from './startup-screen.tsx'

it('启动屏覆盖窗口，顶栏可拖拽，居中展示品牌角色', async () => {
  await render(
    <div style={{ width: 1000, height: 700 }}>
      <StartupScreen label="应用正在启动" />
    </div>,
  )
  const screen = document.querySelector<HTMLElement>('[data-slot="startup-screen"]')!
  expect(screen.getAttribute('role')).toBe('status')
  expect(screen.getAttribute('aria-label')).toBe('应用正在启动')
  expect(screen.getBoundingClientRect().width).toBe(1000)
  expect(screen.getBoundingClientRect().height).toBe(700)
  const drag = screen.querySelector<HTMLElement>('[data-window-drag]')!
  expect(drag.getBoundingClientRect().height).toBe(48)
  const image = screen.querySelector('img')!
  await expect
    .poll(() =>
      image
        .decode()
        .then(() => true)
        .catch(() => false),
    )
    .toBe(true)
  const rect = image.getBoundingClientRect()
  expect(Math.round(rect.width)).toBe(250)
  expect(Math.round(rect.height)).toBe(250)
  expect(getComputedStyle(image).borderRadius).not.toBe('0px')
})
