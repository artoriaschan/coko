import '../styles/theme.css'
import { defaultTranslations } from 'streamdown'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { MarkdownRenderer } from './markdown-renderer.tsx'

const markdown = [
  '# Title',
  '',
  'Inline `code` and a [link](https://example.com).',
  '',
  '```ts',
  'const answer: number = 42',
  '```',
  '',
  '| Name | Value |',
  '| --- | --- |',
  '| alpha | 1 |',
  '',
  '$$',
  'E = mc^2',
  '$$',
  '',
  '```mermaid',
  'graph TD',
  '  A[Start] --> B[End]',
  '```',
].join('\n')

const translations = { ...defaultTranslations, copyCode: 'COPY-CODE-LABEL' }

describe('MarkdownRenderer', () => {
  it('渲染代码高亮、表格、数学公式与 mermaid 图', async () => {
    await render(
      <MarkdownRenderer mode="static" colorScheme="light" translations={translations}>
        {markdown}
      </MarkdownRenderer>,
    )

    await expect.element(page.getByRole('heading', { level: 1, name: 'Title' })).toBeVisible()
    await expect.element(page.getByRole('table')).toBeVisible()
    await expect.element(page.getByRole('cell', { name: 'alpha' })).toBeVisible()

    // shiki 异步高亮后，同一行代码的 token 呈现不同的实际颜色
    const tokenColors = () =>
      new Set([...document.querySelectorAll('[data-streamdown="code-block"] pre span[style*="--sdm-c"]')].map((el) => getComputedStyle(el).color)).size
    await expect.poll(tokenColors, { timeout: 10000 }).toBeGreaterThan(1)
    expect(document.querySelector('[data-streamdown="code-block"]')!.textContent).toContain('const answer: number = 42')

    await expect.poll(() => document.querySelector('.katex') !== null, { timeout: 5000 }).toBe(true)
    expect(document.querySelector('.katex-mathml')?.textContent).toContain('E')

    // mermaid 输出的图表 SVG 带 aria-roledescription（区别于操作按钮的图标 SVG）
    const diagram = () => document.querySelector('[data-streamdown="mermaid-block"] svg[aria-roledescription]')
    await expect.poll(() => diagram() !== null, { timeout: 15000 }).toBe(true)
    const svgText = diagram()!.textContent
    expect(svgText).toContain('Start')
    expect(svgText).toContain('End')
  })

  it('控件使用传入的本地化文案', async () => {
    await render(
      <MarkdownRenderer mode="static" colorScheme="light" translations={translations}>
        {'```ts\nlet a = 1\n```'}
      </MarkdownRenderer>,
    )
    await expect
      .element(
        page
          .getByTitle('COPY-CODE-LABEL')
          .or(page.getByRole('button', { name: 'COPY-CODE-LABEL' }))
          .first(),
      )
      .toBeInTheDocument()
  })

  it('代码块使用 R16 与 code-block token', async () => {
    await render(
      <MarkdownRenderer mode="static" colorScheme="light" translations={translations}>
        {'```ts\nlet a = 1\n```'}
      </MarkdownRenderer>,
    )
    await expect.poll(() => document.querySelector('[data-streamdown="code-block"]') !== null).toBe(true)
    const block = getComputedStyle(document.querySelector('[data-streamdown="code-block"]')!)
    expect(block.borderTopLeftRadius).toBe('16px')
    expect(block.backgroundColor).toBe('rgb(249, 250, 251)')
  })
})
