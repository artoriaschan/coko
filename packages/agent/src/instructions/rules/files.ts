// 指令加载器的只读文件端口：在共用端口之上加 realpath（按真实路径防环、去重与检查 @import 边界）。
import { realpath } from 'node:fs/promises'
import { createNodeFiles, type ReadOnlyFiles } from '../shared/index.ts'

export interface InstructionFiles extends ReadOnlyFiles {
  /** 真实路径；不存在或无法解析时返回原路径。 */
  realpath(path: string): Promise<string>
}

export function createNodeInstructionFiles(): InstructionFiles {
  return {
    ...createNodeFiles(),
    realpath: (path) => realpath(path).catch(() => path),
  }
}
