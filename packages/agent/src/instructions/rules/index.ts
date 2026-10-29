// 指令文件（AGENTS.md / CLAUDE.md）的发现、@import、预算与嵌套按需加载（票 03）。
export { createNodeInstructionFiles } from './files.ts'
export type { InstructionFiles } from './files.ts'
export { createInstructionLoader, INSTRUCTION_FILE_MAX_CHARS, INSTRUCTIONS_TOTAL_MAX_CHARS, MAX_IMPORT_DEPTH } from './loader.ts'
export type { InstructionFile, InstructionLoader, InstructionScope, LoadedInstructions } from './loader.ts'
export { formatInstructionFile, formatInstructionsSection, INSTRUCTIONS_PREAMBLE, INSTRUCTIONS_SECTION } from './section.ts'
export { NESTED_TRIGGER_TOOLS, nestedInstructionsHook } from './nested.ts'
export type { NestedInstructionsOptions } from './nested.ts'
