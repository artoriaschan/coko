// File Reference 与嵌套指令：不是独立的条目 kind，而是同一条 user message / toolResult 中以固定开标签开头的文本块
// （M3 规格"Session Entry 与事件"）。Sidecar 用 format* 生成开标签，renderer 用 *Path 识别并显示为 chip。
// path 按 XML 属性转义（& " < >）。

const escapeAttribute = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const unescapeAttribute = (value: string) => value.replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')

/** File Reference 文本块的开标签。 */
export function formatFileReferenceOpen(path: string): string {
  return `<file_reference path="${escapeAttribute(path)}">`
}

/** 嵌套指令（Agent 触及子目录时加载）文本块的开标签。 */
export function formatNestedInstructionOpen(path: string): string {
  return `<instruction_file path="${escapeAttribute(path)}" scope="nested">`
}

const FILE_REFERENCE = /^<file_reference path="([^"]*)">/
const NESTED_INSTRUCTION = /^<instruction_file path="([^"]*)" scope="nested">/

/** 文本块以 File Reference 开标签开头时返回其 path，否则 undefined。 */
export function fileReferencePath(text: string): string | undefined {
  const match = FILE_REFERENCE.exec(text)
  return match ? unescapeAttribute(match[1]!) : undefined
}

/** 文本块以嵌套指令开标签开头时返回其 path，否则 undefined。 */
export function nestedInstructionPath(text: string): string | undefined {
  const match = NESTED_INSTRUCTION.exec(text)
  return match ? unescapeAttribute(match[1]!) : undefined
}
