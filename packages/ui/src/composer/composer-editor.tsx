import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  mergeRegister,
  type LexicalEditor,
} from 'lexical'
import * as React from 'react'
import { cn } from '../lib/utils.ts'

export interface ComposerEditorHandle {
  focus(): void
  /** 与 Enter 相同的提交路径（发送按钮使用）。 */
  submit(): Promise<void>
  /** 替换编辑区内容并把光标放到末尾（例如退回未送达的追加指令）。 */
  setText(text: string): void
  /** 当前文本（未去首尾空白）。 */
  getText(): string
}

export interface ComposerEditorProps {
  /** 已本地化的无障碍名称。 */
  label: string
  /** 已本地化的占位文案。 */
  placeholder: string
  /** 收到去掉首尾空白的非空文本；返回 true 表示已被接受，编辑区随之清空，false 时保留输入。 */
  onSubmit: (text: string) => boolean | Promise<boolean>
  /** 非组合状态下按 Escape。 */
  onEscape?: () => void
  /** 内容在空与非空之间变化时调用（初始为空）。 */
  onEmptyChange?: (empty: boolean) => void
  disabled?: boolean
  className?: string
  ref?: React.Ref<ComposerEditorHandle>
}

/**
 * 输入法组合中的按键不触发提交或快捷键。Chrome 在 compositionend 之前发出带 isComposing 的 keydown；
 * Safari 在 compositionend 之后才发出确认候选的 keydown，此时只有 keyCode 229 可以识别。
 */
function isImeKey(event: KeyboardEvent | null): boolean {
  return event !== null && (event.isComposing || event.keyCode === 229)
}

const readText = (editor: LexicalEditor) => editor.getEditorState().read(() => $getRoot().getTextContent())

/**
 * 基础 composer 编辑区（Lexical 纯文本）：Enter 提交、Shift+Enter 换行，输入法组合期间不提交。
 * 草稿由编辑器自身保存；组件保持挂载即保留草稿与选区。
 */
export function ComposerEditor({ label, placeholder, onSubmit, onEscape, onEmptyChange, disabled = false, className, ref }: ComposerEditorProps) {
  const initialConfig = React.useMemo(
    () => ({
      namespace: 'coko-composer',
      onError: (error: Error) => {
        throw error
      },
    }),
    [],
  )
  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className={cn('relative min-w-0 flex-1', className)}>
        <PlainTextPlugin
          contentEditable={
            <ContentEditable
              aria-label={label}
              aria-multiline
              aria-placeholder={placeholder}
              placeholder={
                <div
                  aria-hidden
                  className="pointer-events-none absolute top-2 left-3 text-ui-body-lg text-muted-foreground select-none pointer-coarse:text-ui-title"
                >
                  {placeholder}
                </div>
              }
              className="max-h-60 min-h-10 overflow-y-auto rounded-lg px-3 py-2 text-ui-body-lg break-words whitespace-pre-wrap pointer-coarse:text-ui-title"
            />
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <ComposerBridge onSubmit={onSubmit} onEscape={onEscape} onEmptyChange={onEmptyChange} disabled={disabled} handleRef={ref} />
      </div>
    </LexicalComposer>
  )
}

function ComposerBridge({
  onSubmit,
  onEscape,
  onEmptyChange,
  disabled,
  handleRef,
}: Pick<ComposerEditorProps, 'onSubmit' | 'onEscape' | 'onEmptyChange'> & { disabled: boolean; handleRef: React.Ref<ComposerEditorHandle> | undefined }) {
  const [editor] = useLexicalComposerContext()
  // 回调经 ref 读取最新值，命令只注册一次。
  const callbacks = React.useRef({ onSubmit, onEscape, onEmptyChange })
  React.useLayoutEffect(() => {
    callbacks.current = { onSubmit, onEscape, onEmptyChange }
  })
  const pending = React.useRef(false)

  const submit = React.useCallback(async () => {
    if (pending.current) return
    const text = readText(editor).trim()
    if (text === '') return
    pending.current = true
    try {
      const accepted = await callbacks.current.onSubmit(text)
      // 等待期间用户继续输入的内容不被清掉。
      if (accepted && readText(editor).trim() === text) {
        editor.update(() => {
          const root = $getRoot()
          root.clear()
          const paragraph = $createParagraphNode()
          root.append(paragraph)
          paragraph.select()
        })
      }
    } finally {
      pending.current = false
    }
  }, [editor])

  const setText = React.useCallback(
    (text: string) => {
      editor.update(() => {
        const root = $getRoot()
        root.clear()
        const paragraph = $createParagraphNode()
        text.split('\n').forEach((line, index) => {
          if (index > 0) paragraph.append($createLineBreakNode())
          if (line !== '') paragraph.append($createTextNode(line))
        })
        root.append(paragraph)
        paragraph.selectEnd()
      })
    },
    [editor],
  )

  React.useImperativeHandle(handleRef, () => ({ focus: () => editor.focus(), submit, setText, getText: () => readText(editor) }), [editor, submit, setText])

  React.useEffect(() => {
    editor.setEditable(!disabled)
  }, [editor, disabled])

  React.useEffect(() => {
    let empty: boolean | undefined
    const report = (text: string) => {
      const next = text.trim() === ''
      if (next === empty) return
      empty = next
      callbacks.current.onEmptyChange?.(next)
    }
    report(readText(editor))
    return mergeRegister(
      editor.registerTextContentListener(report),
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          if (isImeKey(event)) {
            event?.preventDefault()
            return true
          }
          // Shift+Enter 交给纯文本插件插入换行。
          if (event?.shiftKey) return false
          event?.preventDefault()
          void submit()
          return true
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        (event) => {
          if (isImeKey(event) || !callbacks.current.onEscape) return false
          event.preventDefault()
          callbacks.current.onEscape()
          return true
        },
        COMMAND_PRIORITY_HIGH,
      ),
    )
  }, [editor, submit])

  return null
}
