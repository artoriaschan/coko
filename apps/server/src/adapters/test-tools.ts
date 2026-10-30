// 测试用宿主工具，只在 COKO_TEST_TOOLS=1 时注册（集成测试驱动 Secrets 注入）。产品装配不注册。
import { execFile } from 'node:child_process'
import { Type } from 'typebox'
import type { CokoTool } from '@coko/agent'
import type { ContextContribution } from '../application/context/types.ts'

/** secret_probe 声明的密钥名。 */
export const TEST_SECRET = 'COKO_TEST_SECRET'

/** 子进程报告它看到的密钥的 SHA-256 与长度；明文不进入结果。 */
const PROBE_SCRIPT = `
const value = process.env.${TEST_SECRET}
const hash = value === undefined ? null : require('node:crypto').createHash('sha256').update(value).digest('hex')
process.stdout.write(JSON.stringify({ sha256: hash, length: value === undefined ? 0 : value.length }))
`

/**
 * test_queue_input：把文本排进"下一个 Run 的待送达内容"（ContextContribution.pendingInput），集成测试据此观察合并到 user message
 * 开头的内容。Run 开始后确认送达才清空。
 */
export function createTestSeamContribution(): ContextContribution {
  let queued: string[] = []
  const tool: CokoTool = {
    name: 'test_queue_input',
    label: 'test_queue_input',
    description: 'Test tool: queues text that is merged into the next Run.',
    parameters: Type.Object({ text: Type.String() }),
    effect: 'read',
    async execute(_toolCallId, params) {
      queued.push((params as { text: string }).text)
      return { content: [{ type: 'text', text: 'queued' }], details: undefined }
    },
  }
  return {
    name: 'test-seam',
    tools: async () => [{ tool, permissionClass: 'session-state' }],
    async pendingInput() {
      if (queued.length === 0) return undefined
      const taken = queued
      return {
        content: taken.map((text) => ({ type: 'text' as const, text })),
        delivered: () => {
          queued = queued.filter((text) => !taken.includes(text))
        },
      }
    },
  }
}

/** secret_probe：在子进程中读取声明的密钥并回报其散列，证明注入只作用于该次调用的子进程（子进程环境只有 PATH 与该密钥）。 */
export function createSecretProbeTool(): CokoTool {
  return {
    name: 'secret_probe',
    label: 'secret_probe',
    description: 'Test tool: reports the SHA-256 of the declared secret as seen by a child process.',
    parameters: Type.Object({}),
    effect: 'read',
    secrets: [TEST_SECRET],
    async execute(_toolCallId, _params, signal, _onUpdate, context) {
      const secret = context?.secrets?.[TEST_SECRET]
      const env: Record<string, string> = {
        PATH: process.env.PATH ?? '',
        ELECTRON_RUN_AS_NODE: '1',
        ...(secret === undefined ? {} : { [TEST_SECRET]: secret }),
      }
      const stdout = await new Promise<string>((resolve, reject) => {
        execFile(process.execPath, ['-e', PROBE_SCRIPT], { env, ...(signal ? { signal } : {}) }, (error, out) => (error ? reject(error) : resolve(out)))
      })
      return { content: [{ type: 'text', text: stdout }], details: undefined }
    },
  }
}
