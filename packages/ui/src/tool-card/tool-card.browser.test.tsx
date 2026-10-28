import '../styles/theme.css'
import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { ToolCard } from './tool-card.tsx'

afterEach(() => {
  document.body.replaceChildren()
})

const card = () => document.querySelector<HTMLElement>('[data-slot="tool-card"]')!

/**
 * 元素命中的样式规则中，最后声明的 border-top-width（层叠顺序近似为样式表中的出现顺序）。
 * Chromium 的 computed style 把 0.5px 边框取整为 1px，只能从声明值区分 hairline 与 1px。
 */
function declaredBorderWidth(element: Element): string | undefined {
  let value: string | undefined
  const visit = (rules: CSSRuleList) => {
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule) {
        let matches = false
        try {
          matches = element.matches(rule.selectorText)
        } catch {
          matches = false
        }
        const width = rule.style.getPropertyValue('border-top-width') || rule.style.getPropertyValue('border-width')
        if (matches && width) value = width.trim()
        if (rule.cssRules.length > 0) visit(rule.cssRules)
      } else if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules)
    }
  }
  for (const sheet of document.styleSheets) visit(sheet.cssRules)
  return value
}

describe('ToolCard 边框', () => {
  it('错误状态使用 1px 状态色边框（设计系统：状态色边框保持 1px），不是 hairline', async () => {
    await render(<ToolCard icon={null} title="bash" status="error" statusLabel="Failed" />)
    expect(declaredBorderWidth(card())).toBe('1px')
    const probe = document.createElement('span')
    probe.style.color = 'var(--destructive)'
    document.body.append(probe)
    expect(getComputedStyle(card()).borderTopColor).toBe(getComputedStyle(probe).color)
  })

  it('其他状态保持 hairline 中性边框', async () => {
    await render(<ToolCard icon={null} title="bash" status="done" statusLabel="Done" />)
    expect(declaredBorderWidth(card())).toBe('var(--hairline)')
  })
})
