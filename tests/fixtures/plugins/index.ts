// 插件测试夹具的构建：在给定目录写一个插件（清单与任意文件，对象按 JSON 写出）。sample/ 是固定的完整插件（见 README.md）。
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface PluginSpec {
  name: string
  version?: string
  /** 清单的其他字段（engines、skills 等）。 */
  manifest?: Record<string, unknown>
  /** 相对插件根的文件：字符串原样写出，其他按 JSON。 */
  files?: Record<string, unknown>
}

export async function writePlugin(root: string, spec: PluginSpec): Promise<string> {
  const files: Record<string, unknown> = {
    '.coko-plugin/plugin.json': { name: spec.name, version: spec.version ?? '1.0.0', ...spec.manifest },
    ...spec.files,
  }
  for (const [relative, content] of Object.entries(files)) {
    const path = join(root, relative)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content, null, 2))
  }
  return root
}

/** 一个 PreToolUse Hook 的 hooks.json（matcher 可选）。 */
export const preToolUseHooks = (command: string, matcher?: string) => ({
  hooks: { PreToolUse: [{ ...(matcher === undefined ? {} : { matcher }), hooks: [{ type: 'command', command }] }] },
})
