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
  CLEAR_HISTORY_COMMAND,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  mergeRegister,
  type LexicalEditor,
  type SerializedEditorState,
} from 'lexical'
import * as React from 'react'
import { cn } from '../lib/utils.ts'
import { FileReferenceNode } from './file-reference-node.ts'

export interface ComposerEditorHandle {
  focus(): void
  /** 与 Enter 相同的提交路径（发送按钮使用）。 */
  submit(): Promise<void>
  /** 替换编辑区内容并把光标放到末尾（例如退回未送达的追加指令）。 */
  setText(text: string): void
  /** 当前文本（未去首尾空白）；File Reference 节点为 @path。 */
  getText(): string
  /** 当前内容的 EditorState JSON（草稿持久化）。 */
  getEditorState(): SerializedEditorState
  /** 以 EditorState JSON 替换内容并清空撤销历史（不调用 onDraftChange）；JSON 不合法或含未知节点时返回 false，内容不变。 */
  setEditorState(json: unknown): boolean
  /** 清空内容与撤销历史（不调用 onDraftChange）。 */
  clear(): void
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
  /** 用户编辑了内容（输入、删除、选择候选、提交后清空）；setEditorState 与 clear 不调用。 */
  onDraftChange?: () => void
  disabled?: boolean
  className?: string
  ref?: React.Ref<ComposerEditorHandle>
  /** 编辑器插件（例如 ComposerTypeahead），渲染在同一个 Lexical 上下文中。 */
  children?: React.ReactNode
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
/** 程序替换内容（加载草稿、clear）的更新标记：不视为用户编辑。 */
const PROGRAMMATIC = 'coko-composer-programmatic'

export function ComposerEditor({
  label,
  placeholder,
  onSubmit,
  onEscape,
  onEmptyChange,
  onDraftChange,
  disabled = false,
  className,
  ref,
  children,
}: ComposerEditorProps) {
  const initialConfig = React.useMemo(
    () => ({
      namespace: 'coko-composer',
      nodes: [FileReferenceNode],
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
                // 单行：编辑区很窄（390 px 窗口中与模型、模式选择并排）时以省略号截断，不逐词换行；全文在 aria-placeholder 中。
                <div
                  aria-hidden
                  data-slot="composer-placeholder"
                  className="pointer-events-none absolute top-2 right-3 left-3 truncate text-ui-body-lg text-muted-foreground select-none pointer-coarse:text-ui-title"
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
        <ComposerBridge
          onSubmit={onSubmit}
          onEscape={onEscape}
          onEmptyChange={onEmptyChange}
          onDraftChange={onDraftChange}
          disabled={disabled}
          handleRef={ref}
        />
        {children}
      </div>
    </LexicalComposer>
  )
}

function ComposerBridge({
  onSubmit,
  onEscape,
  onEmptyChange,
  onDraftChange,
  disabled,
  handleRef,
}: Pick<ComposerEditorProps, 'onSubmit' | 'onEscape' | 'onEmptyChange' | 'onDraftChange'> & {
  disabled: boolean
  handleRef: React.Ref<ComposerEditorHandle> | undefined
}) {
  const [editor] = useLexicalComposerContext()
  // 回调经 ref 读取最新值，命令只注册一次。
  const callbacks = React.useRef({ onSubmit, onEscape, onEmptyChange, onDraftChange })
  React.useLayoutEffect(() => {
    callbacks.current = { onSubmit, onEscape, onEmptyChange, onDraftChange }
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

  const clear = React.useCallback(() => {
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        root.append($createParagraphNode())
      },
      { tag: PROGRAMMATIC, discrete: true },
    )
    editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined)
  }, [editor])

  const setEditorState = React.useCallback(
    (json: unknown) => {
      let state
      try {
        // parseEditorState 对未知节点类型与 importJSON 的错误抛出。
        state = editor.parseEditorState(json as SerializedEditorState)
      } catch {
        return false
      }
      if (state.isEmpty()) return false
      editor.setEditorState(state, { tag: PROGRAMMATIC })
      editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined)
      return true
    },
    [editor],
  )

  React.useImperativeHandle(
    handleRef,
    () => ({
      focus: () => editor.focus(),
      submit,
      setText,
      getText: () => readText(editor),
      getEditorState: () => editor.getEditorState().toJSON(),
      setEditorState,
      clear,
    }),
    [editor, submit, setText, setEditorState, clear],
  )

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
      editor.registerUpdateListener(({ dirtyElements, dirtyLeaves, tags }) => {
        if (tags.has(PROGRAMMATIC) || (dirtyElements.size === 0 && dirtyLeaves.size === 0)) return
        callbacks.current.onDraftChange?.()
      }),
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
