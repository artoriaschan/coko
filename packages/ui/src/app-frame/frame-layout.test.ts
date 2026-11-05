import { describe, expect, it } from 'vitest'
import { computeFrameLayout } from './frame-layout.ts'

describe('right panel column allocation', () => {
  it('keeps a 420px sidebar and closes the right panel when 300px no longer fits', () => {
    const input = { sidebarWidth: 420, sidebarCollapsed: false, rightOpen: true }
    expect(computeFrameLayout({ ...input, frameWidth: 1120 })).toMatchObject({ sidebarColumn: 420, right: 'column', rightColumn: 300 })
    expect(computeFrameLayout({ ...input, frameWidth: 1119 })).toMatchObject({ sidebar: 'expanded', sidebarColumn: 420, right: 'closed', rightColumn: 0 })
  })

  it('automatically fills frames below 768 without allocating a column and preserves columns for explicit fullscreen', () => {
    const input = { sidebarWidth: 280, sidebarCollapsed: false, rightOpen: true }
    expect(computeFrameLayout({ ...input, frameWidth: 767 })).toMatchObject({ right: 'fullscreen', rightColumn: 0 })
    expect(computeFrameLayout({ ...input, frameWidth: 768 })).toMatchObject({ right: 'column', rightColumn: 346 })
    expect(computeFrameLayout({ ...input, frameWidth: 1440, rightFullscreen: true })).toMatchObject({
      right: 'fullscreen',
      sidebarColumn: 280,
      rightColumn: 648,
    })
  })

  it('clamps a large width preference to 70% while keeping the center readable', () => {
    expect(computeFrameLayout({ frameWidth: 2400, sidebarWidth: 280, sidebarCollapsed: true, rightOpen: true, rightWidth: 2200 })).toMatchObject({
      right: 'column',
      rightColumn: 1680,
    })
  })
})
