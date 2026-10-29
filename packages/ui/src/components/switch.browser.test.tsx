import '../styles/theme.css'
import * as React from 'react'
import { expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { Switch } from './switch.tsx'

function Fixture() {
  const [on, setOn] = React.useState(false)
  return (
    <>
      <button type="button">Before</button>
      <label>
        Reasoning
        <Switch checked={on} onCheckedChange={setOn} />
      </label>
    </>
  )
}

it('开关：role=switch，H20 轨道与 16px 圆形滑块；点击与空格切换，焦点环可见；明暗主题下选中态使用语义色', async () => {
  await render(<Fixture />)
  const toggle = page.getByRole('switch', { name: 'Reasoning' })
  await expect.element(toggle).toHaveAttribute('aria-checked', 'false')
  const track = toggle.element() as HTMLElement
  const box = track.getBoundingClientRect()
  expect([box.width, box.height]).toEqual([32, 20])
  const thumb = track.querySelector<HTMLElement>('[data-slot="switch-thumb"]')!
  expect(thumb.getBoundingClientRect().width).toBe(16)
  expect(getComputedStyle(thumb).borderRadius).not.toBe('0px')
  const off = getComputedStyle(track).backgroundColor
  const thumbLeftOff = thumb.getBoundingClientRect().left

  await toggle.click()
  await expect.element(toggle).toHaveAttribute('aria-checked', 'true')
  // 颜色有过渡：等计算值稳定。
  await expect.poll(() => getComputedStyle(track).backgroundColor).not.toBe(off)
  await Promise.all(track.getAnimations().map((a) => a.finished))
  await expect.poll(() => thumb.getBoundingClientRect().left - thumbLeftOff).toBe(12)

  page.getByRole('button', { name: 'Before' }).element().focus()
  await userEvent.keyboard('{Tab}')
  expect(document.activeElement).toBe(track)
  expect(track.matches(':focus-visible')).toBe(true)
  expect(getComputedStyle(track).outlineStyle).toBe('solid')
  await userEvent.keyboard(' ')
  await expect.element(toggle).toHaveAttribute('aria-checked', 'false')

  await toggle.click()
  await expect.element(toggle).toHaveAttribute('aria-checked', 'true')
  await Promise.all(track.getAnimations().map((a) => a.finished))
  const lightOn = getComputedStyle(track).backgroundColor
  document.documentElement.classList.add('dark')
  try {
    await expect.poll(() => getComputedStyle(track).backgroundColor).not.toBe(lightOn)
  } finally {
    document.documentElement.classList.remove('dark')
  }
})
