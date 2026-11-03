import './theme.css'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let fixture: HTMLDivElement
let wasDark: boolean

beforeEach(() => {
  wasDark = document.documentElement.classList.contains('dark')
  fixture = document.createElement('div')
  document.body.append(fixture)
})

afterEach(() => {
  fixture.remove()
  document.documentElement.classList.toggle('dark', wasDark)
})

function gutter(element: HTMLElement, axis: 'vertical' | 'horizontal'): number {
  const style = getComputedStyle(element)
  return axis === 'vertical'
    ? element.offsetWidth - element.clientWidth - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth)
    : element.offsetHeight - element.clientHeight - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth)
}

describe('shared scrollbars', () => {
  it('renders 4px rounded scrollbars in both axes and preserves scrolling in light and dark containers', () => {
    const pane = document.createElement('div')
    pane.style.cssText = 'width:140px;height:96px;overflow:scroll'
    const content = document.createElement('div')
    content.style.cssText = 'width:300px;height:300px'
    pane.append(content)
    fixture.append(pane)
    const thumbBackgrounds: string[] = []
    for (const dark of [false, true]) {
      document.documentElement.classList.toggle('dark', dark)
      const scrollbar = getComputedStyle(pane, '::-webkit-scrollbar')
      expect(scrollbar.width).toBe('4px')
      expect(scrollbar.height).toBe('4px')
      // macOS overlay scrollbars reserve 0px; classic scrollbars reserve the painted 4px.
      // Standard `thin` would take over the native rendering instead of these precise dimensions.
      expect(getComputedStyle(pane).scrollbarWidth).toBe('auto')
      for (const axis of ['vertical', 'horizontal'] as const) {
        expect([0, 4]).toContain(gutter(pane, axis))
      }
      const thumb = getComputedStyle(pane, '::-webkit-scrollbar-thumb')
      expect(thumb.borderTopRightRadius).toBe('2px')
      expect(thumb.borderBottomLeftRadius).toBe('2px')
      expect(getComputedStyle(pane, '::-webkit-scrollbar-track').backgroundColor).toBe('rgba(0, 0, 0, 0)')
      thumbBackgrounds.push(thumb.backgroundColor)
      pane.scrollTop = 24
      pane.scrollLeft = 24
      expect(pane.scrollTop).toBe(24)
      expect(pane.scrollLeft).toBe(24)
    }
    expect(thumbBackgrounds[1]).not.toBe(thumbBackgrounds[0])
  })

  it('keeps intentionally hidden title scrollbars hidden while allowing title scrolling', () => {
    const title = document.createElement('div')
    title.className = 'fading-title'
    title.style.cssText = 'width:140px;height:32px;overflow:auto'
    const content = document.createElement('div')
    content.style.cssText = 'width:300px;height:20px'
    title.append(content)
    fixture.append(title)
    expect(title.scrollWidth).toBeGreaterThan(title.clientWidth)
    expect(gutter(title, 'horizontal')).toBe(0)
    title.scrollLeft = 24
    expect(title.scrollLeft).toBe(24)
  })
})
