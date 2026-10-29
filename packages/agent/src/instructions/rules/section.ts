// <instructions> system section 与 <instruction_file> 块的文本格式（M3 规格 A3）。
import type { InstructionFile } from './loader.ts'

/** 前导语（claude-code）：这些指令覆盖默认行为，越靠后（越近）越优先。 */
export const INSTRUCTIONS_PREAMBLE =
  'Codebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written. When instructions conflict, files that appear later (closer to the working directory) take precedence.'

/** system section 名（SystemSection.name）。 */
export const INSTRUCTIONS_SECTION = 'instructions'

// 与 @coko/protocol files.ts 的转义相同（嵌套块由 renderer 经 nestedInstructionPath 识别）。
const escapeAttribute = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const unescapeAttribute = (value: string) => value.replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')

/** 一个文件的块：`<instruction_file path="…" scope="…">`、正文、`</instruction_file>`。 */
export function formatInstructionFile(file: Pick<InstructionFile, 'path' | 'scope' | 'content'>): string {
  return '<instruction_file path="' + escapeAttribute(file.path) + '" scope="' + file.scope + '">\n' + file.content.trimEnd() + '\n</instruction_file>'
}

/** 系统提示中的指令段；没有文件时为空字符串（运行时跳过空段）。 */
export function formatInstructionsSection(files: readonly InstructionFile[]): string {
  if (files.length === 0) return ''
  return ['<instructions>', INSTRUCTIONS_PREAMBLE, '', files.map(formatInstructionFile).join('\n\n'), '</instructions>'].join('\n')
}

const NESTED_OPEN = /^<instruction_file path="([^"]*)" scope="nested">/

/** 文本块以嵌套指令开标签开头时返回其 path（与 @coko/protocol 的 nestedInstructionPath 相同）。 */
export function nestedInstructionBlockPath(text: string): string | undefined {
  const match = NESTED_OPEN.exec(text)
  return match ? unescapeAttribute(match[1]!) : undefined
}
