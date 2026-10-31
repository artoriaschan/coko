// 切换明暗主题：按钮在切换的那一帧就是新主题的颜色，不经 transition-colors 在两套 token 之间插值（插值中途 primary 呈灰色）；
// 切换之后 transition 照常生效（hover 等状态仍有过渡）。
import './theme.css'
import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { Button } from '../components/button.tsx'
import { applyTheme } from '../lib/theme.ts'

/** token 在当前主题下的计算颜色：用无过渡的探针元素读出。 */
function tokenColor(token: string): string {
  const probe = document.createElement('span')
  probe.style.transition = 'none'
  probe.style.backgroundColor = `var(${token})`
  document.body.append(probe)
  try {
    return getComputedStyle(probe).backgroundColor
  } finally {
    probe.remove()
  }
}

afterEach(() => {
  document.documentElement.classList.remove('dark')
  document.body.replaceChildren()
})

describe('切换明暗主题', () => {
  it('切换后立即为新主题的颜色（default 与 outline 按钮），之后过渡恢复', async () => {
    applyTheme('light')
    await render(
      <div>
        <Button>Stop</Button>
        <Button variant="outline">Stop agent</Button>
      </div>,
    )
    const primary = document.querySelector<HTMLElement>('[data-variant="default"]')!
    const outline = document.querySelector<HTMLElement>('[data-variant="outline"]')!
    await expect.poll(() => getComputedStyle(primary).backgroundColor).toBe(tokenColor('--primary'))
    const lightPrimary = tokenColor('--primary')

    for (const theme of ['dark', 'light', 'dark'] as const) {
      applyTheme(theme)
      expect(document.documentElement.classList.contains('dark')).toBe(theme === 'dark')
      expect({ theme, primary: getComputedStyle(primary).backgroundColor, outline: getComputedStyle(outline).backgroundColor }).toEqual({
        theme,
        primary: tokenColor('--primary'),
        outline: tokenColor('--background'),
      })
    }
    expect(tokenColor('--primary')).not.toBe(lightPrimary)
    // 切换结束后（下一帧）不再抑制过渡。
    await expect.poll(() => getComputedStyle(primary).transitionDuration).not.toBe('0s')
  })
})
