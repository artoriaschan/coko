import { emptyModelRow, type ModelRowDraft } from './catalog-draft.ts'

// 获取可用模型弹窗的选择规则（规格 4.6），与界面无关。候选为供应商返回的模型 ID（保持返回顺序）；已在目录按模型 ID 判断。

/** 按模型 ID 模糊匹配：不区分大小写，输入的字符按顺序出现在 ID 中即匹配；空搜索匹配全部。 */
export function matchesModelId(id: string, query: string): boolean {
  const needle = query.trim().toLowerCase()
  const haystack = id.toLowerCase()
  let from = 0
  for (const char of needle) {
    const at = haystack.indexOf(char, from)
    if (at < 0) return false
    from = at + 1
  }
  return true
}

/**
 * 计数与批量操作的状态：count 为本次已选（不含已在目录）的数量，与搜索无关；allSelected 表示当前结果中可新增的模型全部选中
 * （批量操作文案为“取消全选”）；selectable 为全部候选中可新增的数量。
 */
export function selectionState(candidates: readonly string[], inCatalog: ReadonlySet<string>, selected: ReadonlySet<string>, visible: readonly string[]) {
  const addable = visible.filter((id) => !inCatalog.has(id))
  return {
    count: candidates.filter((id) => selected.has(id) && !inCatalog.has(id)).length,
    allSelected: addable.length > 0 && addable.every((id) => selected.has(id)),
    selectable: candidates.filter((id) => !inCatalog.has(id)).length,
  }
}

/** 全选 / 取消全选：只作用于当前结果中可新增的模型；不在当前结果中的已选项保持。 */
export function toggleAll(selected: ReadonlySet<string>, visible: readonly string[], inCatalog: ReadonlySet<string>): Set<string> {
  const addable = visible.filter((id) => !inCatalog.has(id))
  const next = new Set(selected)
  const clear = addable.length > 0 && addable.every((id) => next.has(id))
  for (const id of addable) {
    if (clear) next.delete(id)
    else next.add(id)
  }
  return next
}

export function addSelected(selected: ReadonlySet<string>, id: string): Set<string> {
  return new Set(selected).add(id)
}

/** 添加所选：保留原有行，把选中且不在目录中的模型按返回顺序追加；名称为 ID，其余为“添加模型”空行的默认值（默认容量、文本、推理关闭）。 */
export function importRows(rows: readonly ModelRowDraft[], candidates: readonly string[], selected: ReadonlySet<string>): ModelRowDraft[] {
  const present = new Set(rows.map((row) => row.id.trim()))
  const added = candidates.filter((id) => selected.has(id) && !present.has(id)).map((id) => ({ ...emptyModelRow(), id, name: id }))
  return added.length === 0 ? [...rows] : [...rows, ...added]
}
