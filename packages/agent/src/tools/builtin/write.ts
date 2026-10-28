// Adapted from pi coding-agent 1.4.0 (MIT, Copyright (c) 2025 Mario Zechner). See THIRD_PARTY_NOTICES.md.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Type } from 'typebox'
import { resolveToCwd, throwIfAborted } from '../paths.ts'
import type { CokoTool } from '../types.ts'
import { withFileMutationQueue } from './file-mutation-queue.ts'

export const writeParameters = Type.Object({
  path: Type.String({ description: 'Path to the file to write (relative or absolute)' }),
  content: Type.String({ description: 'Content to write to the file' }),
})

export function createWriteTool({ cwd }: { cwd: string }): CokoTool<typeof writeParameters, undefined> {
  return {
    name: 'write',
    label: 'write',
    description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
    parameters: writeParameters,
    effect: 'side-effect',
    permissionSubject: (args) => args.path,
    // 恢复：内容已一致即已生效；文件不存在说明写入没有发生（write 总会创建文件）；其余（例如只写了一部分）无法判定。
    async probeOutcome({ path, content }, workspace) {
      let current: Buffer
      try {
        current = await readFile(resolveToCwd(path, workspace))
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'not-applied' : 'unknown'
      }
      return current.equals(Buffer.from(content, 'utf-8')) ? 'applied' : 'unknown'
    },
    async execute(_toolCallId, { path, content }, signal) {
      const absolutePath = resolveToCwd(path, cwd)
      // Check the signal between steps instead of rejecting from a listener, so the queue stays
      // locked until an in-flight filesystem operation has settled.
      return withFileMutationQueue(absolutePath, async () => {
        throwIfAborted(signal)
        await mkdir(dirname(absolutePath), { recursive: true })
        throwIfAborted(signal)
        await writeFile(absolutePath, content, 'utf-8')
        throwIfAborted(signal)
        return { content: [{ type: 'text', text: `Successfully wrote to ${path}` }], details: undefined }
      })
    },
  }
}
