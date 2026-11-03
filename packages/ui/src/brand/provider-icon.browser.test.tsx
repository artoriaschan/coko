import { expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { ProviderIcon } from './provider-icon.tsx'

const titleOf = (container: Element) => container.querySelector('svg title')?.textContent

it('按模型 ID 渲染品牌图标：彩色版本、装饰性、按像素定尺寸', async () => {
  const { container } = await render(<ProviderIcon modelId="claude-sonnet-4-5" size={20} />)
  const svg = container.querySelector('svg')
  expect(svg).not.toBeNull()
  expect(titleOf(container)).toBe('Claude')
  expect(svg!.getAttribute('aria-hidden')).toBe('true')
  expect([svg!.getAttribute('width'), svg!.getAttribute('height')]).toEqual(['20', '20'])
})

it('供应商没有模型 ID 时按接口地址与名称识别', async () => {
  const fromUrl = await render(<ProviderIcon baseUrl="https://api.deepseek.com" />)
  expect(titleOf(fromUrl.container)).toBe('DeepSeek')
  const fromName = await render(<ProviderIcon name="智谱 GLM" />)
  expect(titleOf(fromName.container)).toBe('Zhipu')
})

it('未收录的品牌回退通用图标且不显示品牌标题', async () => {
  const { container } = await render(<ProviderIcon id="custom-provider-1" name="自定义供应商" baseUrl="http://localhost:1234/v1" />)
  expect(container.querySelector('svg')).not.toBeNull()
  expect(titleOf(container)).toBeUndefined()
})

it('mono 变体使用单色图标并跟随前景色', async () => {
  const { container } = await render(<ProviderIcon modelId="deepseek-chat" variant="mono" />)
  const svg = container.querySelector('svg')!
  expect(titleOf(container)).toBe('DeepSeek')
  expect(svg.getAttribute('fill')).toBe('currentColor')
  expect(svg.getAttribute('class')).toContain('text-foreground')
})
