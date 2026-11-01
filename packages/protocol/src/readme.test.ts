// 协议文档的机械检查：README 中出现每个 API_ROUTES 键、每种 ProgressEvent 的 type（DETACHED_PROGRESS 按类型穷尽登记）与每个错误码。
// 新增路由、进度或错误码而 README 没有跟上时失败。
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, DETACHED_PROGRESS, ErrorCode } from './index.ts'

const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')
/** 以代码片段出现：`name`。 */
const missing = (names: readonly string[]) => names.filter((name) => !readme.includes(`\`${name}\``))

describe('packages/protocol/README.md', () => {
  it('列出每个 API_ROUTES 键及其路径', () => {
    expect(missing(Object.keys(API_ROUTES))).toEqual([])
    expect(missing(Object.values(API_ROUTES))).toEqual([])
  })

  it('列出每种 ProgressEvent 的 type', () => {
    expect(missing(Object.keys(DETACHED_PROGRESS))).toEqual([])
  })

  it('列出每个错误码', () => {
    const codes = (ErrorCode as unknown as { anyOf: { const: string }[] }).anyOf.map((member) => member.const)
    expect(codes.length).toBeGreaterThan(40)
    expect(missing(codes)).toEqual([])
  })
})
