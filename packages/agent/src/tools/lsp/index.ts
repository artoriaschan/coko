// 代码智能：lsp 工具（诊断、定义、引用、悬停）、JSON-RPC 帧、位置换算与结果格式化。语言服务器进程由宿主经 LspPort 提供。
import type { PluginLspServer } from '../../extensions/plugins/types.ts'

export { createLspTool, LSP_OPERATIONS, lspParameters, type LspOperation, type LspPort, type LspQuery, type LspToolDetails } from './tool.ts'
export {
  displayPath,
  formatLspResult,
  hoverText,
  LSP_DIAGNOSTICS_WAIT_MS,
  LSP_LINE_TEXT_MAX,
  LSP_MAX_CHARS,
  LSP_MAX_ITEMS,
  normalizeLocations,
  uriToPath,
  type LspDiagnostic,
  type LspFormatOptions,
  type LspLocation,
  type LspLocationLink,
  type LspQueryResult,
  type LspResultCounts,
} from './format.ts'
export { fromLspPosition, splitLines, toLspPosition, type LspPosition, type LspRange } from './position.ts'
export { decodeFrames, encodeFrame, LSP_MAX_FRAME_BYTES, type FrameDecoder } from './framing.ts'

export type { PluginLspServer }
