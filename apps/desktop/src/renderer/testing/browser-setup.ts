// Browser Mode 的共用 setup（vitest.browser.config.ts 的 setupFiles）。各文件共用同一个页面源，测试必须恢复它改动的全局状态：
// - localStorage：每个用例开始前快照，结束后恢复原值（包括原先不存在的键），写入方不必各自清理，读取方也不必先清空；
// - 渲染的组件：结束时卸载（vitest-browser-react 的 cleanup），effect、订阅与 portal 一并清理；
// - Radix 模态菜单与对话框打开时给 body 的其余子节点设 aria-hidden / data-aria-hidden，并把 body 的 pointer-events 设为 none；关闭中被卸载时
//   这些设置不会撤销，之后的 getByRole 看不到这些节点。卸载之后断言没有残留，报出泄漏的用例（等菜单关闭后再结束用例）。
import { afterEach, beforeEach } from 'vitest'
import { cleanup } from 'vitest-browser-react'
import { rightPanelLayoutStore } from '../features/right-panel/layout-store.ts'
import { conversationViewStore } from '../features/conversation/view-store.ts'

let stored: [string, string][] = []

beforeEach(() => {
  stored = Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)!])
})

afterEach(async () => {
  await cleanup()
  rightPanelLayoutStore.setState({ sessions: {}, attention: null })
  conversationViewStore.setState({ sessions: {} })
  localStorage.clear()
  for (const [key, value] of stored) localStorage.setItem(key, value)
  const hidden = [...document.body.children].filter((node) => node.hasAttribute('data-aria-hidden') || node.getAttribute('aria-hidden') === 'true')
  const pointer = document.body.style.pointerEvents
  if (hidden.length === 0 && pointer === '') return
  // 先复原，使失败不连累同一文件中之后的用例；再报出本用例的泄漏。
  for (const node of hidden) {
    node.removeAttribute('data-aria-hidden')
    node.removeAttribute('aria-hidden')
  }
  document.body.style.pointerEvents = ''
  throw new Error(
    `A modal layer was left behind: ${hidden.length} body children still aria-hidden, body pointer-events "${pointer}". Wait for menus and dialogs to close before the test ends.`,
  )
})
