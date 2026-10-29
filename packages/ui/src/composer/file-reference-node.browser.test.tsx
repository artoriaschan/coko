// File Reference 节点（票 06）：经 @ typeahead 插入的原子节点，作为整体删除；getText() 序列化为 @path / @"a b"；EditorState JSON 往返后
// 节点仍在；目录用 Tab 进入（替换为 @dir/ 文本并继续查询），Enter 插入目录引用。
import '../styles/theme.css'
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { ComposerEditor, type ComposerEditorHandle } from './composer-editor.tsx'
import { ComposerTypeahead, type ComposerTypeaheadItem, type ComposerTypeaheadSelection } from './composer-typeahead.tsx'

const FILES = ['src/', 'src/a.ts', 'docs/my notes.md', 'README.md']
const item = (path: string): ComposerTypeaheadItem => ({ key: path, label: path, group: 'files' })
const getItems = (query: string) => FILES.filter((p) => p.toLowerCase().includes(query.toLowerCase())).map(item)
const onSelect = (selected: ComposerTypeaheadItem, how: ComposerTypeaheadSelection) =>
  selected.key.endsWith('/') && how === 'tab' ? `@${selected.key}` : { fileReference: selected.key }

async function setup(onDraftChange = vi.fn<() => void>()) {
  const handle = React.createRef<ComposerEditorHandle>()
  const onSubmit = vi.fn<(text: string) => boolean>(() => true)
  const queries: string[] = []
  await render(
    <div style={{ width: 480, padding: '320px 16px 16px' }}>
      <ComposerEditor ref={handle} label="Task" placeholder="Give Coko a task" onSubmit={onSubmit} onDraftChange={onDraftChange}>
        <ComposerTypeahead
          trigger="@"
          position="word"
          getItems={getItems}
          groups={[{ id: 'files', label: 'Files' }]}
          onSelect={onSelect}
          onQuery={(q) => queries.push(q)}
          label="Files"
        />
      </ComposerEditor>
    </div>,
  )
  return { handle, onSubmit, queries, onDraftChange }
}

const editor = () => page.getByRole('textbox', { name: 'Task' })
const root = () => editor().element() as HTMLElement
const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')]
const chips = () => [...root().querySelectorAll<HTMLElement>('[data-file-reference]')]

afterEach(() => {
  document.body.innerHTML = ''
})

describe('File Reference 节点', () => {
  it('@ 词首触发菜单，Enter 插入原子节点并跟一个空格；getText() 为 @path；Backspace 先删空格再整体删除节点', async () => {
    const { handle, queries } = await setup()
    await editor().click()
    await userEvent.keyboard('look at @a.t')
    await expect.poll(() => options().map((o) => o.textContent)).toEqual(['src/a.ts'])
    expect(queries.at(-1)).toBe('a.t')
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => chips().map((c) => c.dataset.fileReference)).toEqual(['src/a.ts'])
    expect(handle.current!.getText()).toBe('look at @src/a.ts ')
    expect(chips()[0]!.getAttribute('contenteditable')).not.toBe('true')

    await userEvent.keyboard('{Backspace}')
    expect(handle.current!.getText()).toBe('look at @src/a.ts')
    await userEvent.keyboard('{Backspace}')
    expect(chips()).toHaveLength(0)
    expect(handle.current!.getText()).toBe('look at ')
  })

  it('含空格的路径序列化为 @"a b"；节点之后继续输入不进入节点', async () => {
    const { handle } = await setup()
    await editor().click()
    await userEvent.keyboard('@notes')
    await expect.poll(() => options().length).toBe(1)
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard('please')
    expect(handle.current!.getText()).toBe('@"docs/my notes.md" please')
    expect(chips().map((c) => c.textContent)).toEqual(['@"docs/my notes.md"'])
  })

  it('EditorState JSON 往返后节点仍在；不合法的 JSON 与未知节点被拒绝且编辑区不变', async () => {
    const { handle } = await setup()
    await editor().click()
    await userEvent.keyboard('see @READ')
    await expect.poll(() => options().length).toBe(1)
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard('now')
    const json = handle.current!.getEditorState()
    expect(JSON.stringify(json)).toContain('"type":"file-reference"')
    expect(JSON.stringify(json)).toContain('"path":"README.md"')

    handle.current!.clear()
    expect(handle.current!.getText()).toBe('')
    expect(handle.current!.setEditorState(json)).toBe(true)
    await expect.poll(() => chips().map((c) => c.dataset.fileReference)).toEqual(['README.md'])
    expect(handle.current!.getText()).toBe('see @README.md now')

    const before = handle.current!.getText()
    expect(handle.current!.setEditorState({ root: { type: 'nope' } })).toBe(false)
    const unknownNode = JSON.parse(JSON.stringify(json).replace('"file-reference"', '"mystery-node"'))
    expect(handle.current!.setEditorState(unknownNode)).toBe(false)
    const missingPath = JSON.parse(JSON.stringify(json).replace('"path":"README.md"', '"path":3'))
    expect(handle.current!.setEditorState(missingPath)).toBe(false)
    expect(handle.current!.getText()).toBe(before)
  })

  it('目录：Tab 替换为 @dir/ 并继续查询（菜单仍开），Enter 插入目录引用', async () => {
    const { handle, queries } = await setup()
    await editor().click()
    await userEvent.keyboard('@sr')
    await expect.poll(() => options().map((o) => o.textContent)).toEqual(['src/', 'src/a.ts'])
    await userEvent.keyboard('{Tab}')
    expect(chips()).toHaveLength(0)
    expect(handle.current!.getText()).toBe('@src/')
    await expect.poll(() => queries.at(-1)).toBe('src/')
    await expect.poll(() => options().length).toBeGreaterThan(0)
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => chips().map((c) => c.dataset.fileReference)).toEqual(['src/'])
    expect(handle.current!.getText()).toBe('@src/ ')
  })

  it('onDraftChange 只随用户编辑调用，setEditorState 与 clear 不调用', async () => {
    const onDraftChange = vi.fn<() => void>()
    const { handle } = await setup(onDraftChange)
    await editor().click()
    await userEvent.keyboard('hi')
    await expect.poll(() => onDraftChange.mock.calls.length).toBeGreaterThan(0)
    const json = handle.current!.getEditorState()
    onDraftChange.mockClear()
    handle.current!.clear()
    handle.current!.setEditorState(json)
    await new Promise((r) => setTimeout(r, 50))
    expect(onDraftChange).not.toHaveBeenCalled()
    expect(handle.current!.getText()).toBe('hi')
  })
})
