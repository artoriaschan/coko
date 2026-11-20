// Session Reference 节点：经 @ typeahead 插入的原子节点，chip 显示 @标题，读出、提交与复制的文本为 @session:<id>；
// 作为整体删除，不能在其中输入；EditorState JSON 往返后节点与标题快照仍在，缺少 id 或标题的 JSON 被拒绝。
import '../styles/theme.css'
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { ComposerEditor, type ComposerEditorHandle } from './composer-editor.tsx'
import { ComposerTypeahead, type ComposerTypeaheadItem } from './composer-typeahead.tsx'

const FILES = ['src/plan.ts']
const SESSIONS = [
  { id: 's-plan', title: 'Plan the migration' },
  { id: 's-fix', title: '修复 登录' },
]
const getItems = (query: string): ComposerTypeaheadItem[] => {
  const q = query.toLowerCase()
  return [
    ...FILES.filter((p) => p.includes(q)).map((p) => ({ key: p, label: p, group: 'files' })),
    ...SESSIONS.filter((s) => s.title.toLowerCase().includes(q)).map((s) => ({ key: `session:${s.id}`, label: s.title, trailing: '2h', group: 'sessions' })),
  ]
}
const onSelect = (selected: ComposerTypeaheadItem) =>
  selected.group === 'sessions' ? { sessionReference: { id: selected.key.slice('session:'.length), title: selected.label } } : { fileReference: selected.key }

async function setup() {
  const handle = React.createRef<ComposerEditorHandle>()
  const onSubmit = vi.fn<(text: string) => boolean>(() => true)
  await render(
    <div style={{ width: 480, padding: '320px 16px 16px' }}>
      <ComposerEditor ref={handle} label="Task" placeholder="Give Coko a task" onSubmit={onSubmit}>
        <ComposerTypeahead
          trigger="@"
          position="word"
          getItems={getItems}
          groups={[
            { id: 'files', label: 'Files' },
            { id: 'sessions', label: 'Sessions' },
          ]}
          onSelect={onSelect}
          label="References"
        />
      </ComposerEditor>
    </div>,
  )
  return { handle, onSubmit }
}

const editor = () => page.getByRole('textbox', { name: 'Task' })
const root = () => editor().element() as HTMLElement
const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')]
const sessionChips = () => [...root().querySelectorAll<HTMLElement>('[data-session-reference]')]
const fileChips = () => [...root().querySelectorAll<HTMLElement>('[data-file-reference]')]

/** 编辑区收到 copy 事件后放进剪贴板的数据。 */
function copy(): DataTransfer {
  const clipboardData = new DataTransfer()
  root().dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData }))
  return clipboardData
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Session Reference 节点', () => {
  it('选中会话后插入 chip 并跟一个空格：显示 @标题，读出的文本为 @session:<id>；Backspace 先删空格再整体删除', async () => {
    const { handle } = await setup()
    await editor().click()
    await userEvent.keyboard('continue @migra')
    await expect.poll(() => options().map((o) => o.textContent)).toEqual(['Plan the migration2h'])
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => sessionChips().map((c) => c.textContent)).toEqual(['@Plan the migration'])
    expect(sessionChips()[0]!.dataset.sessionReference).toBe('s-plan')
    expect(handle.current!.getText()).toBe('continue @session:s-plan ')
    expect(sessionChips()[0]!.getAttribute('contenteditable')).toBe('false')
    expect(sessionChips()[0]!.closest('a, button, [role="button"], [role="link"]')).toBeNull()

    await userEvent.keyboard('{Backspace}')
    expect(handle.current!.getText()).toBe('continue @session:s-plan')
    await userEvent.keyboard('{Backspace}')
    expect(sessionChips()).toHaveLength(0)
    expect(handle.current!.getText()).toBe('continue ')
  })

  it('一条消息里文件节点与多个会话节点并存；提交与复制出的文本都是 @session:<id>', async () => {
    const { handle, onSubmit } = await setup()
    await editor().click()
    await userEvent.keyboard('@migra')
    await expect.poll(() => options().length).toBe(1)
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard('and @plan.ts')
    await expect.poll(() => options().map((o) => o.textContent)).toEqual(['src/plan.ts'])
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard('@登录')
    await expect.poll(() => options().length).toBe(1)
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => sessionChips().map((c) => c.textContent)).toEqual(['@Plan the migration', '@修复 登录'])
    expect(fileChips().map((c) => c.textContent)).toEqual(['@src/plan.ts'])
    // 外观与 File Reference chip 相同：按实际计算样式比较，行高一致（chip 不撑高所在行）。
    const look = (chip: HTMLElement) => {
      const style = getComputedStyle(chip)
      return [
        style.color,
        style.backgroundColor,
        style.borderRadius,
        style.fontWeight,
        style.paddingInline,
        style.fontSize,
        chip.getBoundingClientRect().height,
      ]
    }
    expect(look(sessionChips()[0]!)).toEqual(look(fileChips()[0]!))
    const text = '@session:s-plan and @src/plan.ts @session:s-fix '
    expect(handle.current!.getText()).toBe(text)

    await userEvent.keyboard('{ControlOrMeta>}a{/ControlOrMeta}')
    const copied = copy()
    expect(copied.getData('text/plain')).toBe(text)

    // 粘贴回来的是同一段文本（不恢复成 chip），再次提交仍是 @session:<id>。
    root().dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: copied }))
    await expect.poll(() => handle.current!.getText()).toBe(text)
    expect(sessionChips()).toHaveLength(0)
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => onSubmit.mock.calls).toEqual([[text.trim()]])
  })

  it('不能在 chip 中输入：行首的 chip 之前与之后输入的文字都落在节点之外；选区盖住 chip 时整体删除', async () => {
    const { handle } = await setup()
    await editor().click()
    await userEvent.keyboard('@migra')
    await expect.poll(() => options().length).toBe(1)
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard('after')
    await userEvent.keyboard('{Home}before ')
    expect(handle.current!.getText()).toBe('before @session:s-plan after')
    expect(sessionChips().map((c) => c.textContent)).toEqual(['@Plan the migration'])

    // 光标在 chip 之前（"before " 之后）：向右越过 chip 与其后的空格，再向左扩选盖住空格与 chip。
    // 逐键发送：编辑器的选区随 selectionchange 异步更新，一次调用里连按时后一键读到的还是旧选区。
    for (const key of ['{ArrowRight}', '{ArrowRight}', '{Shift>}{ArrowLeft}{/Shift}', '{Shift>}{ArrowLeft}{/Shift}', 'x']) await userEvent.keyboard(key)
    expect(sessionChips()).toHaveLength(0)
    expect(handle.current!.getText()).toBe('before xafter')
  })

  it('EditorState JSON 往返后 chip 与标题快照仍在；缺少 id 或标题的节点被拒绝且编辑区不变', async () => {
    const { handle } = await setup()
    await editor().click()
    await userEvent.keyboard('see @migra')
    await expect.poll(() => options().length).toBe(1)
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard('now')
    const json = handle.current!.getEditorState()
    const raw = JSON.stringify(json)
    expect(raw).toContain('"type":"session-reference"')
    expect(raw).toContain('"id":"s-plan"')
    expect(raw).toContain('"title":"Plan the migration"')

    handle.current!.clear()
    expect(handle.current!.getText()).toBe('')
    expect(handle.current!.setEditorState(JSON.parse(raw))).toBe(true)
    await expect.poll(() => sessionChips().map((c) => c.textContent)).toEqual(['@Plan the migration'])
    expect(handle.current!.getText()).toBe('see @session:s-plan now')

    const before = handle.current!.getText()
    for (const broken of [
      raw.replace('"id":"s-plan"', '"id":3'),
      raw.replace('"id":"s-plan"', '"id":""'),
      raw.replace('"title":"Plan the migration"', '"title":""'),
      raw.replace(',"title":"Plan the migration"', ''),
    ]) {
      expect(broken).not.toBe(raw)
      expect(handle.current!.setEditorState(JSON.parse(broken))).toBe(false)
    }
    expect(handle.current!.getText()).toBe(before)
    expect(sessionChips()).toHaveLength(1)
  })
})
