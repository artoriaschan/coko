import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { LexicalTypeaheadMenuPlugin, MenuOption, type MenuTextMatch } from '@lexical/react/LexicalTypeaheadMenuPlugin'
import {
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_BEFORE_CRITICAL,
  COMMAND_PRIORITY_CRITICAL,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  mergeRegister,
  type LexicalEditor,
  type TextNode,
} from 'lexical'
import { Popper } from 'radix-ui/internal'
import * as React from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../lib/utils.ts'

export interface ComposerTypeaheadItem {
  /** 稳定身份（同一列表内唯一）。 */
  key: string
  /** 主文本（例如 /review）。 */
  label: string
  /** 次要文本，紧接主文本（例如 argument-hint）。 */
  hint?: string
  description?: string
  /** 所属分组的 id（groups 中的 id）。 */
  group: string
}

export interface ComposerTypeaheadGroup {
  id: string
  /** 已本地化的分组标题。 */
  label: string
}

export interface ComposerTypeaheadProps {
  /** 触发字符，例如 '/' 或 '@'。 */
  trigger: string
  /** start：只在草稿开头触发；word：在词首（行首或空白之后）触发。 */
  position: 'start' | 'word'
  /** 查询（触发字符之后、光标之前的文本）对应的候选；没有候选时菜单不出现，按键照常交给编辑区。 */
  getItems: (query: string) => readonly ComposerTypeaheadItem[]
  /** 分组顺序与标题；候选按此顺序分组显示，没有候选的分组不显示。 */
  groups: readonly ComposerTypeaheadGroup[]
  /** 选中后替换 token（含触发字符）的文本，例如 '/review '。 */
  onSelect: (item: ComposerTypeaheadItem) => string
  /** 已本地化的列表名称。 */
  label: string
  /** 编辑区获得焦点时调用（例如刷新候选来源）。 */
  onFocus?: () => void
  className?: string
}

class TypeaheadOption extends MenuOption {
  readonly item: ComposerTypeaheadItem
  constructor(item: ComposerTypeaheadItem) {
    super(item.key)
    this.item = item
  }
}

/**
 * 输入法组合中的按键不确认、不移动选中项。Chrome 在 compositionend 之前发出带 isComposing 的 keydown；
 * Safari 在 compositionend 之后才发出确认候选的 keydown，此时只有 keyCode 229 可以识别（与 ComposerEditor 相同）。
 */
const isImeKey = (event: KeyboardEvent | null) => event !== null && (event.isComposing || event.keyCode === 229)

const QUERY = /^[^\s]*$/u

/** 光标所在文本节点中、光标之前的文本，以及它是否位于草稿开头（根的第一个文本节点）。 */
function $textBeforeCaret(): { text: string; atStart: boolean; key: string } | null {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed() || selection.anchor.type !== 'text') return null
  const node = selection.anchor.getNode()
  if (!$isTextNode(node) || !node.isSimpleText()) return null
  const first = $getRoot().getFirstDescendant()
  return { text: node.getTextContent().slice(0, selection.anchor.offset), atStart: first !== null && first.is(node), key: node.getKey() }
}

function matchToken(editor: LexicalEditor, trigger: string, position: ComposerTypeaheadProps['position']): (MenuTextMatch & { key: string }) | null {
  return editor.getEditorState().read(() => {
    const before = $textBeforeCaret()
    if (!before) return null
    if (position === 'start') {
      if (!before.atStart || !before.text.startsWith(trigger)) return null
      const query = before.text.slice(trigger.length)
      if (!QUERY.test(query)) return null
      return { leadOffset: 0, matchingString: query, replaceableString: before.text, key: before.key }
    }
    const at = before.text.lastIndexOf(trigger)
    if (at < 0 || (at > 0 && !/\s/u.test(before.text[at - 1]!))) return null
    const query = before.text.slice(at + trigger.length)
    if (!QUERY.test(query)) return null
    return { leadOffset: at, matchingString: query, replaceableString: before.text.slice(at), key: before.key }
  })
}

/** 光标之前的文本中 token（触发字符起、无空白）的起点；没有时 -1。 */
function tokenStart(before: string, trigger: string, position: ComposerTypeaheadProps['position']): number {
  if (position === 'start') return before.startsWith(trigger) && QUERY.test(before.slice(trigger.length)) ? 0 : -1
  const at = before.lastIndexOf(trigger)
  if (at < 0 || !QUERY.test(before.slice(at + trigger.length))) return -1
  return at === 0 || /\s/u.test(before[at - 1]!) ? at : -1
}

/**
 * 用 replacement 替换光标前的整个 token。插件按上一次渲染时的匹配切分文本节点：菜单打开后连续输入再确认时，切出的节点可能只含
 * 查询的后半部分（其余仍在前一个兄弟节点中），因此这里把光标所在行内、该节点及其之前相邻的文本节点合起来重新计算 token。
 */
function $replaceToken(node: TextNode | null, trigger: string, position: ComposerTypeaheadProps['position'], replacement: string) {
  let end: TextNode | null = node
  if (!end) {
    const selection = $getSelection()
    if (!$isRangeSelection(selection) || selection.anchor.type !== 'text') return
    const anchor = selection.anchor.getNode()
    const offset = selection.anchor.offset
    if (!$isTextNode(anchor)) return
    end = anchor.getTextContent().length === offset ? anchor : anchor.splitText(offset)[0]!
  }
  const parts: TextNode[] = [end]
  for (let previous = end.getPreviousSibling(); $isTextNode(previous) && previous.isSimpleText(); previous = previous.getPreviousSibling())
    parts.unshift(previous)
  const before = parts.map((part) => part.getTextContent()).join('')
  const start = tokenStart(before, trigger, position)
  if (start < 0) return
  const inserted = $createTextNode(before.slice(0, start) + replacement)
  end.replace(inserted)
  for (const part of parts.slice(0, -1)) part.remove()
  inserted.select()
}

// 菜单材质与项几何同 dropdown-menu（components/dropdown-menu.tsx）：外框 R16、内边距 4px、项 R12，背景 --menu-fill，模糊在 ::before 层。
const menuSurface =
  'relative isolate z-50 rounded-lg border-0 p-1 text-popover-foreground shadow-panel before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:bg-menu-fill before:menu-backdrop before:content-[""]'
const menuItem = 'flex min-h-8 cursor-default items-center gap-2 rounded-md px-2 py-1 text-ui-body outline-hidden select-none'

/**
 * composer 的 typeahead（基于 LexicalTypeaheadMenuPlugin）：放在 ComposerEditor 的 children 中。焦点始终留在编辑区，
 * 选中项经 aria-activedescendant 指出；↑↓ 移动、Enter / Tab 确认、Esc 关闭且不改草稿、关闭后同一 token 不再弹出，
 * 输入法组合期间不触发、不确认。菜单经 Popper 定位在编辑区上方（放不下时翻到下方），不越出窗口，可用指针选择。
 */
export function ComposerTypeahead({ trigger, position, getItems, groups, onSelect, label, onFocus, className }: ComposerTypeaheadProps) {
  const [editor] = useLexicalComposerContext()
  const [query, setQuery] = React.useState<string | null>(null)
  // Esc 关闭的 token（文本节点与起点）：同一 token 不再弹出，token 消失后复位。
  const dismissed = React.useRef<{ key: string; leadOffset: number } | null>(null)
  const current = React.useRef<{ key: string; leadOffset: number } | null>(null)
  const open = React.useRef(false)
  const blurred = React.useRef(false)
  const latest = React.useRef({ getItems, trigger, position, onFocus })
  React.useLayoutEffect(() => {
    latest.current = { getItems, trigger, position, onFocus }
  })

  const options = React.useMemo(() => (query === null ? [] : getItems(query).map((item) => new TypeaheadOption(item))), [getItems, query])

  const triggerFn = React.useCallback((_text: string, editor: LexicalEditor): MenuTextMatch | null => {
    const { trigger, position, getItems } = latest.current
    const match = editor.isComposing() || blurred.current ? null : matchToken(editor, trigger, position)
    if (!match) {
      dismissed.current = null
      current.current = null
      return null
    }
    current.current = { key: match.key, leadOffset: match.leadOffset }
    const d = dismissed.current
    if (d && (d.key !== match.key || d.leadOffset !== match.leadOffset)) dismissed.current = null
    if (dismissed.current) return null
    // 没有候选时不打开：按键照常交给编辑区（例如 /xyz 后按 Enter 直接发送）。
    if (getItems(match.matchingString).length === 0) return null
    return { leadOffset: match.leadOffset, matchingString: match.matchingString, replaceableString: match.replaceableString }
  }, [])

  React.useEffect(() => {
    const consumeIme = (event: KeyboardEvent | null) => {
      if (!open.current || !isImeKey(event)) return false
      // 不交给菜单与提交：输入法确认候选的 Enter 不应选择命令或发送。
      if (event?.key === 'Enter') event.preventDefault()
      return true
    }
    const rerun = () => editor.update(() => $getRoot().markDirty())
    const unregister = mergeRegister(
      editor.registerCommand(KEY_ENTER_COMMAND, consumeIme, COMMAND_PRIORITY_BEFORE_CRITICAL),
      editor.registerCommand(KEY_TAB_COMMAND, consumeIme, COMMAND_PRIORITY_BEFORE_CRITICAL),
      editor.registerCommand(KEY_ARROW_DOWN_COMMAND, consumeIme, COMMAND_PRIORITY_BEFORE_CRITICAL),
      editor.registerCommand(KEY_ARROW_UP_COMMAND, consumeIme, COMMAND_PRIORITY_BEFORE_CRITICAL),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        (event) => {
          if (consumeIme(event)) return true
          // 菜单打开时记下被关闭的 token，菜单自身（同一优先级、之后）随后关闭并消费 Esc。
          if (open.current) dismissed.current = current.current
          return false
        },
        COMMAND_PRIORITY_BEFORE_CRITICAL,
      ),
      editor.registerRootListener((root, previous) => {
        const onBlur = (event: FocusEvent) => {
          // 焦点移到菜单内（指针选择前的 mousedown 已阻止）之外的地方时关闭菜单。
          if (event.relatedTarget instanceof Node && document.getElementById('typeahead-menu')?.contains(event.relatedTarget)) return
          blurred.current = true
          if (open.current) rerun()
        }
        const onFocus = () => {
          blurred.current = false
          latest.current.onFocus?.()
        }
        previous?.removeEventListener('blur', onBlur)
        previous?.removeEventListener('focus', onFocus)
        root?.addEventListener('blur', onBlur)
        root?.addEventListener('focus', onFocus)
      }),
    )
    return unregister
  }, [editor])

  const onSelectOption = React.useCallback(
    (option: TypeaheadOption, node: TextNode | null, closeMenu: () => void) => {
      $replaceToken(node, latest.current.trigger, latest.current.position, onSelect(option.item))
      closeMenu()
    },
    [onSelect],
  )

  return (
    <LexicalTypeaheadMenuPlugin<TypeaheadOption>
      options={options}
      triggerFn={triggerFn}
      onQueryChange={setQuery}
      onSelectOption={onSelectOption}
      onOpen={() => {
        open.current = true
      }}
      onClose={() => {
        open.current = false
      }}
      // 高于 ComposerEditor 的 Enter 提交与 Esc（HIGH）。
      commandPriority={COMMAND_PRIORITY_CRITICAL}
      menuRenderFn={(anchor, { options, selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) =>
        anchor.current && options.length > 0
          ? createPortal(
              <TypeaheadMenu
                container={anchor.current}
                editor={editor}
                label={label}
                className={className}
                groups={groups}
                options={options}
                selectedIndex={selectedIndex}
                onHighlight={setHighlightedIndex}
                onChoose={selectOptionAndCleanUp}
              />,
              anchor.current,
            )
          : null
      }
    />
  )
}

function TypeaheadMenu({
  container,
  editor,
  label,
  className,
  groups,
  options,
  selectedIndex,
  onHighlight,
  onChoose,
}: {
  container: HTMLElement
  editor: LexicalEditor
  label: string
  className: string | undefined
  groups: readonly ComposerTypeaheadGroup[]
  options: TypeaheadOption[]
  selectedIndex: number | null
  onHighlight: (index: number) => void
  onChoose: (option: TypeaheadOption) => void
}) {
  // 插件建立的容器是 listbox（aria-controls 指向它），每次重新挂上时把名称写回英文默认值；保持为已本地化的文案。
  React.useLayoutEffect(() => {
    const apply = () => {
      if (container.getAttribute('aria-label') !== label) container.setAttribute('aria-label', label)
    }
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(container, { attributes: true, attributeFilter: ['aria-label'] })
    return () => observer.disconnect()
  }, [container, label])
  const anchor = React.useRef<{ getBoundingClientRect(): DOMRect }>({
    getBoundingClientRect: () => editor.getRootElement()?.getBoundingClientRect() ?? new DOMRect(),
  })
  const indexed = options.map((option, index) => ({ option, index }))
  return (
    <Popper.Root>
      <Popper.Anchor virtualRef={anchor} />
      <Popper.Content
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={8}
        data-slot="composer-typeahead"
        className={cn(
          menuSurface,
          'max-h-[min(20rem,var(--radix-popper-available-height))] w-[min(28rem,var(--radix-popper-available-width))] overflow-x-hidden overflow-y-auto',
          className,
        )}
      >
        {groups.map((group) => {
          const items = indexed.filter(({ option }) => option.item.group === group.id)
          if (items.length === 0) return null
          const headingId = `typeahead-group-${group.id}`
          return (
            <div key={group.id} role="group" aria-labelledby={headingId} data-group={group.id}>
              <div id={headingId} className="px-2 pt-1.5 pb-1 text-ui-small text-muted-foreground">
                {group.label}
              </div>
              {items.map(({ option, index }) => {
                const selected = index === selectedIndex
                return (
                  <div
                    key={option.key}
                    id={`typeahead-item-${index}`}
                    ref={(element) => option.setRefElement(element)}
                    role="option"
                    aria-selected={selected}
                    data-selected={selected || undefined}
                    className={cn(menuItem, selected && 'bg-accent text-accent-foreground')}
                    // 不让编辑区失焦：焦点始终留在编辑区。
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => onHighlight(index)}
                    onClick={() => {
                      onHighlight(index)
                      onChoose(option)
                    }}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="shrink-0 font-medium">{option.item.label}</span>
                        {option.item.hint && <span className="truncate text-ui-small text-muted-foreground">{option.item.hint}</span>}
                      </span>
                      {option.item.description && <span className="truncate text-ui-small text-muted-foreground">{option.item.description}</span>}
                    </span>
                  </div>
                )
              })}
            </div>
          )
        })}
      </Popper.Content>
    </Popper.Root>
  )
}
