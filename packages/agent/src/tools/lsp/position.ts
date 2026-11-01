// 位置换算：lsp 工具的行列为 1 基、按码点计数（中文与表情各算一列）；LSP 的 Position 为 0 基、character 按 UTF-16 代码单元计数。

/** LSP 的位置（0 基；character 为 UTF-16 代码单元）。 */
export interface LspPosition {
  line: number
  character: number
}

export interface LspRange {
  start: LspPosition
  end: LspPosition
}

/** 按 LSP 的换行（\r\n、\n、\r）分行。 */
export const splitLines = (text: string): string[] => text.split(/\r\n|\r|\n/)

/** 1 基码点 → 0 基 UTF-16。列超出行尾时收紧到行尾；行号越出文件或行列小于 1 时抛出（参数错误）。 */
export function toLspPosition(text: string, line: number, character: number): LspPosition {
  if (!Number.isInteger(line) || !Number.isInteger(character) || line < 1 || character < 1)
    throw new Error(`line and character are 1-based positive integers (got line ${line}, character ${character})`)
  const lines = splitLines(text)
  if (line > lines.length) throw new Error(`line ${line} is beyond the end of the file (${lines.length} lines)`)
  const points = Array.from(lines[line - 1]!)
  const units = points.slice(0, character - 1).reduce((sum, point) => sum + point.length, 0)
  return { line: line - 1, character: units }
}

/**
 * 0 基 UTF-16 → 1 基码点：列为位置之前完整的码点数加一（落在代理对中间时为该字符）。没有文本（文件不可读）时按 UTF-16 加一。
 */
export function fromLspPosition(text: string | undefined, position: LspPosition): { line: number; character: number } {
  if (text === undefined) return { line: position.line + 1, character: position.character + 1 }
  const lineText = splitLines(text)[position.line] ?? ''
  let units = 0
  let points = 0
  for (const point of lineText) {
    if (units + point.length > position.character) break
    units += point.length
    points++
  }
  return { line: position.line + 1, character: points + 1 }
}
