import { expect, it } from 'vitest'

it('在真实浏览器中运行并可操作 DOM', () => {
  const button = document.createElement('button')
  button.textContent = 'Coko'
  document.body.append(button)
  try {
    expect(navigator.userAgent).toContain('Chrome')
    expect(document.querySelector('button')?.textContent).toBe('Coko')
  } finally {
    button.remove()
  }
})
