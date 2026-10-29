// 获取可用模型弹窗的选择规则（规格 4.6）：按模型 ID 按序模糊匹配、全选只作用于当前结果中可新增的模型、已在目录不计数、按返回顺序导入。
import { MODEL_CATALOG_DEFAULTS } from '@coko/protocol'
import { describe, expect, it } from 'vitest'
import { emptyModelRow, toCatalog } from './catalog-draft.ts'
import { addSelected, importRows, matchesModelId, selectionState, toggleAll } from './fetch-models-selection.ts'

const candidates = Array.from({ length: 10 }, (_, i) => `custom-model-${i + 1}`)
const inCatalog = new Set(['custom-model-1'])

describe('matchesModelId', () => {
  it('输入的字符按顺序出现在模型 ID 中即匹配，不区分大小写', () => {
    expect(matchesModelId('gpt-4o-mini', 'gpt4o')).toBe(true)
    expect(matchesModelId('GPT-4o-Mini', 'gpt4O')).toBe(true)
    expect(matchesModelId('gpt-4o-mini', 'o4')).toBe(false)
    expect(matchesModelId('gpt-4o-mini', 'gpt4ox')).toBe(false)
    expect(matchesModelId('custom-model-10', 'cm10')).toBe(true)
  })

  it('空白或空搜索匹配全部', () => {
    expect(matchesModelId('anything', '')).toBe(true)
    expect(matchesModelId('anything', '   ')).toBe(true)
  })
})

describe('选择状态', () => {
  it('初次打开计数为 0；全选后计数为 9（已在目录的不计数）；只选两个时计数为 2', () => {
    expect(selectionState(candidates, inCatalog, new Set(), candidates)).toEqual({ count: 0, allSelected: false, selectable: 9 })
    const all = toggleAll(new Set(), candidates, inCatalog)
    expect(all.size).toBe(9)
    expect(all.has('custom-model-1')).toBe(false)
    expect(selectionState(candidates, inCatalog, all, candidates)).toEqual({ count: 9, allSelected: true, selectable: 9 })
    const two = new Set(['custom-model-2', 'custom-model-3'])
    expect(selectionState(candidates, inCatalog, two, candidates)).toEqual({ count: 2, allSelected: false, selectable: 9 })
  })

  it('全选只作用于当前搜索结果中可新增的模型；已全选时为取消全选，只取消当前结果，其他已选保持', () => {
    const visible = candidates.filter((id) => matchesModelId(id, 'model-1'))
    expect(visible).toEqual(['custom-model-1', 'custom-model-10'])
    const kept = new Set(['custom-model-5'])
    const selected = toggleAll(kept, visible, inCatalog)
    expect([...selected].sort()).toEqual(['custom-model-10', 'custom-model-5'])
    expect(selectionState(candidates, inCatalog, selected, visible)).toMatchObject({ count: 2, allSelected: true })
    const cleared = toggleAll(selected, visible, inCatalog)
    expect([...cleared]).toEqual(['custom-model-5'])
  })

  it('当前结果中没有可新增的模型时不是全选', () => {
    expect(selectionState(candidates, inCatalog, new Set(), ['custom-model-1'])).toMatchObject({ allSelected: false })
  })
})

describe('导入', () => {
  it('按返回顺序追加，不按勾选顺序；跳过已在目录的；名称为 ID，容量为默认值，输入为文本，推理关闭', () => {
    const existing = { ...emptyModelRow(), id: 'custom-model-1', name: '自定义模型一' }
    const picked = addSelected(new Set(), 'custom-model-3')
    const both = addSelected(picked, 'custom-model-2')
    const rows = importRows([existing], candidates, both)
    expect(rows.map((r) => r.id)).toEqual(['custom-model-1', 'custom-model-2', 'custom-model-3'])
    expect(rows[0]).toBe(existing)
    expect(new Set(rows.map((r) => r.key)).size).toBe(3)
    expect(toCatalog(rows.slice(1))).toEqual([
      { id: 'custom-model-2', name: 'custom-model-2', ...MODEL_CATALOG_DEFAULTS, input: ['text'], reasoning: false, thinkingLevels: [] },
      { id: 'custom-model-3', name: 'custom-model-3', ...MODEL_CATALOG_DEFAULTS, input: ['text'], reasoning: false, thinkingLevels: [] },
    ])
    expect(importRows([existing], candidates, new Set(['custom-model-1']))).toEqual([existing])
  })
})
