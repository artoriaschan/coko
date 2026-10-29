// Textarea：与 Input 同一几何与 token（R12、0.5px 中性线、背景与字号），多行可纵向拉伸；mono 变体用等宽小字号（配置类文本）。
import '../styles/theme.css'
import { expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { Input } from './input.tsx'
import { Textarea } from './textarea.tsx'

it('与 Input 同一圆角、边框、背景与字号；mono 变体为等宽小字号；aria-invalid 时边框为状态色', async () => {
  const screen = await render(
    <div style={{ width: 320 }}>
      <Input aria-label="one" />
      <Textarea aria-label="many" />
      <Textarea aria-label="mono" variant="mono" />
      <Textarea aria-label="bad" aria-invalid />
    </div>,
  )
  const style = (label: string) => getComputedStyle(screen.getByLabelText(label).element())
  const input = style('one')
  const many = style('many')
  for (const key of ['borderTopLeftRadius', 'borderTopWidth', 'borderTopColor', 'backgroundColor', 'fontSize', 'color'] as const)
    expect(many[key]).toBe(input[key])
  expect(many.resize).toBe('vertical')
  expect(screen.getByLabelText('many').element().getAttribute('data-slot')).toBe('textarea')
  const mono = style('mono')
  expect(mono.fontFamily).not.toBe(many.fontFamily)
  expect(Number.parseFloat(mono.fontSize)).toBeLessThan(Number.parseFloat(many.fontSize))
  expect(style('bad').borderTopColor).not.toBe(many.borderTopColor)
})
