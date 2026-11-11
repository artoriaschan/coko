const ATTRIBUTE = 'data-focus-modality'

const documents = new WeakMap<Document, { users: number; dispose: () => void }>()

/** 同一文档共享输入方式：只有 Tab 导航开启焦点框，指针操作在控件聚焦前关闭。 */
export function trackKeyboardFocus(document: Document): () => void {
  let state = documents.get(document)
  if (!state) {
    const root = document.documentElement
    const previous = root.getAttribute(ATTRIBUTE)
    const pointer = () => root.setAttribute(ATTRIBUTE, 'pointer')
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Tab' && !event.isComposing && !event.altKey && !event.ctrlKey && !event.metaKey) root.setAttribute(ATTRIBUTE, 'keyboard')
    }
    pointer()
    document.addEventListener('pointerdown', pointer, true)
    document.addEventListener('keydown', keyboard, true)
    state = {
      users: 0,
      dispose: () => {
        document.removeEventListener('pointerdown', pointer, true)
        document.removeEventListener('keydown', keyboard, true)
        if (previous === null) root.removeAttribute(ATTRIBUTE)
        else root.setAttribute(ATTRIBUTE, previous)
        documents.delete(document)
      },
    }
    documents.set(document, state)
  }
  const current = state
  current.users++
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    if (--current.users === 0) current.dispose()
  }
}
