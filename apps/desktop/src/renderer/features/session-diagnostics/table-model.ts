// Adapted from DeepSeek Harness (MIT), Copyright (c) 2026 DeepSeek.
/** Row identities and raw values shared by the two virtual diagnostic tables. */

/** One table position; children immediately follow their parent. */
export interface DiagnosticRow {
  readonly key: string
  readonly parent?: string
  readonly depth: number
  /** Disclosure default; a block lifecycle transition resets any earlier user override. */
  readonly disclosure?: 'open' | 'closed'
}

/** One user disclosure choice, valid only for the lifecycle state in which it was made. */
export interface DiagnosticDisclosure {
  readonly state: DiagnosticRow['disclosure']
  readonly collapsed: boolean
}

/**
 * Resolve a manual choice or the block lifecycle default.
 * @param row - Current row metadata.
 * @param choices - Table-local user choices.
 * @returns Whether the row's descendants are hidden.
 */
export function diagnosticRowCollapsed(row: DiagnosticRow, choices: ReadonlyMap<string, DiagnosticDisclosure>): boolean {
  const choice = choices.get(row.key)
  return choice !== undefined && choice.state === row.disclosure ? choice.collapsed : row.disclosure === 'closed'
}

/** Table-local hierarchy index for disclosure and virtualized sticky ancestors. */
export class DiagnosticTableHierarchy {
  /** Depth-first row order with folded descendants omitted. */
  readonly rows: readonly DiagnosticRow[]
  private readonly byKey = new Map<string, number>()
  private readonly branches = new Set<string>()

  /**
   * @param rows - Complete depth-first row order.
   * @param choices - Table-local disclosure overrides.
   */
  constructor(rows: readonly DiagnosticRow[], choices: ReadonlyMap<string, DiagnosticDisclosure>) {
    const visible: DiagnosticRow[] = []
    let hiddenDepth: number | undefined
    for (const row of rows) {
      if (row.parent !== undefined) this.branches.add(row.parent)
      if (row.disclosure !== undefined) this.branches.add(row.key)
      if (hiddenDepth !== undefined && row.depth > hiddenDepth) continue
      hiddenDepth = diagnosticRowCollapsed(row, choices) ? row.depth : undefined
      this.byKey.set(row.key, visible.length)
      visible.push(row)
    }
    this.rows = visible
  }

  /**
   * Identify rows that own descendants or an explicit disclosure state.
   * @param key - Row identity.
   * @returns Whether this row owns a disclosure.
   */
  isBranch(key: string): boolean {
    return this.branches.has(key)
  }

  /**
   * Find the current row's visible parent headers, including itself when it is a header.
   * @param index - First row at the viewport's scroll offset.
   * @returns Ordered indexes retained above the virtual viewport.
   */
  stickyIndexes(index: number): readonly number[] {
    const indexes: number[] = []
    let row = this.rows[index]
    if (row !== undefined && this.isBranch(row.key)) indexes.push(index)
    while (row?.parent !== undefined) {
      const parent = this.byKey.get(row.parent)
      if (parent === undefined) break
      indexes.push(parent)
      row = this.rows[parent]
    }
    return indexes.reverse()
  }
}

/** Raw data and compact metadata for one independently updated row. */
export interface DiagnosticRecord {
  readonly type: string
  readonly identity: string
  readonly location: string
  /** Unix epoch milliseconds. */
  readonly time?: number
  readonly value: unknown
  /** Owner-supplied preview for domain-specific field formatting. */
  readonly summary?: string
  /** Parent summary used only while its children are folded. */
  readonly collapsedSummary?: string
}

/** 两种展示形式共用的不可变表格输入；记录可独立更新，身份与父子关系来自所属投影。 */
export interface DiagnosticModel {
  readonly rows: readonly DiagnosticRow[]
  readonly records: ReadonlyMap<string, DiagnosticRecord>
}
