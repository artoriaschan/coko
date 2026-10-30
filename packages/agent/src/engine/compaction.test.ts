// 运行时的压缩：每次请求前越过阈值时自动压缩并提交 compaction { trigger: auto }，摘要请求没有工具，下一次请求为合成摘要 +
// firstKeptSeq 及之后；溢出时压缩一次再重试一次；连续 3 次自动失败后暂停，成功的手动压缩复位；手动压缩中停止不提交条目。
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { Context, SystemMessage } from '@earendil-works/pi-ai'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EntryLike } from '../entries/index.ts'
import { createFauxModels, fauxAssistantMessage } from '../testing/faux.ts'
import { createTempWorkspace, type TempWorkspace } from '../testing/workspace.ts'
import { SESSION_ENTRY_PAYLOADS } from '../session-entries/index.ts'
import { createAgentRuntime } from './runtime.ts'
import type { ProgressEvent, RunError, RuntimeContext } from './types.ts'

let ws: TempWorkspace
beforeEach(async () => {
  ws = await createTempWorkspace('coko-compaction-')
})
afterEach(async () => {
  await ws.dispose()
})

type Step = ReturnType<typeof fauxAssistantMessage> | ((context: Context) => ReturnType<typeof fauxAssistantMessage>)

/** 40k 窗口、4k 输出：阈值 23 000。保留最近 1000 tokens，使小用例也有可摘要的内容。 */
function harness(options: { autoCompact?: boolean; context?: RuntimeContext } = {}) {
  const { faux, models, model } = createFauxModels({ models: [{ id: 'small', contextWindow: 40_000, maxTokens: 4_000 }] })
  const stored: EntryLike[] = []
  const progress: ProgressEvent[] = []
  const requests: Context[] = []
  const runtime = createAgentRuntime({
    models,
    model,
    cwd: ws.dir,
    tools: { register() {}, get: () => undefined, list: () => [], implementations: () => [], permissionClass: () => undefined } as never,
    commit: async (entry) => {
      stored.push({ seq: stored.length + 1, kind: entry.kind, runId: entry.runId ?? null, payload: entry.payload })
    },
    compaction: { entries: async () => stored, autoCompact: () => options.autoCompact ?? true, keepRecentTokens: 1_000 },
    ...(options.context ? { context: options.context } : {}),
  })
  runtime.subscribe((event) => {
    if (event.kind === 'progress') progress.push(event.event)
  })
  const reply = (...steps: Step[]) =>
    faux.setResponses(
      steps.map((step) => (context: Context) => {
        requests.push(structuredClone(context))
        return typeof step === 'function' ? step(context) : step
      }),
    )
  return { runtime, stored, progress, requests, reply }
}

const text = (message: unknown) => {
  const content = (message as { content: unknown }).content
  return typeof content === 'string' ? content : (content as { type: string; text?: string }[]).map((b) => b.text ?? '').join('')
}
const kinds = (entries: readonly EntryLike[]) => entries.map((e) => (e.kind === 'message' ? 'message:' + (e.payload as AgentMessage).role : e.kind))
const big = (n: number, c: string) => c.repeat(n)
const ok = (t = 'ok') => fauxAssistantMessage(t)

describe('自动压缩', () => {
  it('越过阈值：提交 compaction { trigger: auto }，摘要请求没有工具且含节标题，下一次请求为合成摘要 + firstKeptSeq 及之后', async () => {
    const h = harness()
    h.reply(ok(), ok('SUMMARY BODY'), ok('done'))
    await h.runtime.run(big(60_000, 'a'))
    const before = h.stored.length
    const result = await h.runtime.run(big(40_000, 'b'))
    expect(result.status).toBe('completed')
    const second = h.stored.slice(before)
    expect(kinds(second)).toEqual(['run_start', 'message:user', 'compaction', 'message:assistant', 'run_end'])
    const compaction = second[2]!.payload as { trigger: string; firstKeptSeq: number; summary: string; tokensBefore: number; tokensAfter: number }
    expect(compaction.trigger).toBe('auto')
    expect(compaction.firstKeptSeq).toBe(second[1]!.seq)
    expect(compaction.summary).toBe('SUMMARY BODY')
    expect(compaction.tokensBefore).toBeGreaterThan(23_000)
    expect(compaction.tokensAfter).toBeLessThan(compaction.tokensBefore)

    const summaryRequest = h.requests[1]!
    expect((summaryRequest.messages[0] as SystemMessage).toolsAdded).toBeUndefined()
    expect(summaryRequest.messages).toHaveLength(2)
    expect(text(summaryRequest.messages[1])).toContain('## User Messages')
    expect(text(summaryRequest.messages[1])).toContain('[User]: ' + big(60_000, 'a'))

    const next = h.requests[2]!.messages
    expect(next.map((m) => m.role)).toEqual(['system', 'user', 'user'])
    expect(text(next[1])).toContain('<summary>\nSUMMARY BODY\n</summary>')
    expect(text(next[2])).toBe(big(40_000, 'b'))
    expect(h.progress.filter((p) => p.type.startsWith('compaction_')).map((p) => p.type)).toEqual(['compaction_start', 'compaction_end'])
  })

  it('compaction 带摘要请求的 usage（计入 Goal 预算）；v1 条目读回为 v2', async () => {
    const h = harness()
    h.reply(ok(), ok('SUMMARY BODY'), ok('done'))
    await h.runtime.run(big(60_000, 'a'))
    await h.runtime.run(big(40_000, 'b'))
    const payload = h.stored.find((e) => e.kind === 'compaction')!.payload as { usage?: Record<string, unknown> }
    // faux 按字符估算摘要请求的 usage：输入为被摘要的内容（约 60 000 字符），输出为 "SUMMARY BODY"。
    expect(payload.usage).toEqual({
      input: expect.any(Number),
      output: expect.any(Number),
      cacheRead: expect.any(Number),
      cacheWrite: expect.any(Number),
      totalTokens: expect.any(Number),
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    })
    expect(payload.usage!.input as number).toBeGreaterThan(10_000)
    const versions = SESSION_ENTRY_PAYLOADS.find((d) => d.kind === 'compaction')!.versions
    expect(versions).toHaveLength(2)
    expect(versions[1]!.check(payload)).toBeUndefined()
    const v1 = { summary: 's', firstKeptSeq: 3, tokensBefore: 10, trigger: 'auto', readFiles: [], modifiedFiles: [] }
    expect(versions[0]!.check(v1)).toBeUndefined()
    expect(versions[0]!.check(payload)).toEqual(expect.any(String))
    const migrated = versions[1]!.migrate!(v1)
    expect(migrated).toEqual(v1)
    expect(versions[1]!.check(migrated)).toBeUndefined()
    expect(versions[1]!.check({ ...v1, usage: { input: -1, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { total: 0 } } })).toEqual(
      expect.any(String),
    )
  })

  it('被摘要的内容超过模型窗口时，摘要请求的输入被限制在窗口减去输出上限之内，压缩成功', async () => {
    const h = harness()
    h.reply(ok(), ok('SUMMARY'), ok('done'))
    await h.runtime.run(big(200_000, 'a'))
    expect((await h.runtime.run(big(8_000, 'b'))).status).toBe('completed')
    expect(h.stored.some((e) => e.kind === 'compaction')).toBe(true)
    const prompt = text(h.requests[1]!.messages[1])
    // 40k 窗口、4k 输出：摘要请求的输入不超过 (40 000 − 4 000) × 4 个字符。
    expect(prompt.length).toBeLessThan(36_000 * 4)
    expect(prompt).toContain('omitted to fit the summary request')
  })

  it('context.autoCompact 关闭时不压缩', async () => {
    const h = harness({ autoCompact: false })
    h.reply(ok(), ok('done'))
    await h.runtime.run(big(60_000, 'a'))
    await h.runtime.run(big(40_000, 'b'))
    expect(h.stored.some((e) => e.kind === 'compaction')).toBe(false)
    expect(h.requests).toHaveLength(2)
  })

  it('溢出：压缩一次（trigger overflow）再重试一次成功；重试的请求不含出错的回复', async () => {
    const h = harness()
    h.reply(
      ok(),
      ok(),
      fauxAssistantMessage([], { stopReason: 'error', errorMessage: 'prompt is too long: 50000 tokens > 40000 maximum' }),
      ok('S'),
      ok('recovered'),
    )
    await h.runtime.run(big(40_000, 'a'))
    await h.runtime.run(big(8_000, 'b'))
    const result = await h.runtime.run('next')
    expect(result.status).toBe('completed')
    const compaction = h.stored.find((e) => e.kind === 'compaction')!.payload as { trigger: string }
    expect(compaction.trigger).toBe('overflow')
    const retried = h.requests.at(-1)!.messages
    expect(retried.map((m) => m.role)).toEqual(['system', 'user', 'user', 'assistant', 'user'])
    expect(text(retried.at(-1))).toBe('next')
  })
})

describe('压缩前的请求前检查（Goal 预算）', () => {
  const budget: RunError = { code: 'budget_exhausted', message: 'Goal budget exhausted: tokens (10 / 10)', dimension: 'tokens' }

  it('越过阈值但 beforeRequest 返回 stop：不发出摘要请求、不提交 compaction，Run 以 paused 加该 error 结束', async () => {
    let stop = false
    const h = harness({ context: { beforeRequest: async () => (stop ? { stop: budget } : undefined) } })
    h.reply(ok(), ok('SUMMARY'), ok('done'))
    await h.runtime.run(big(60_000, 'a'))
    stop = true
    const result = await h.runtime.run(big(40_000, 'b'))
    expect(result).toMatchObject({ status: 'paused', error: budget })
    expect(h.stored.some((e) => e.kind === 'compaction')).toBe(false)
    expect(h.requests).toHaveLength(1)
  })

  it('压缩之后再检查一次（计入压缩的用量）：压缩后返回 stop 时不发出对话请求', async () => {
    let checks = 0
    const h = harness({ context: { beforeRequest: async () => (++checks === 3 ? { stop: budget } : undefined) } })
    h.reply(ok(), ok('SUMMARY'), ok('never'))
    await h.runtime.run(big(60_000, 'a'))
    const result = await h.runtime.run(big(40_000, 'b'))
    expect(result).toMatchObject({ status: 'paused', error: budget })
    expect(h.stored.filter((e) => e.kind === 'compaction')).toHaveLength(1)
    // 第一个 Run 一次对话请求，第二个 Run 只有摘要请求。
    expect(h.requests).toHaveLength(2)
  })

  it('手动压缩（/compact）同样先过 beforeRequest：返回 stop 时不发出摘要请求、不提交 compaction，Run 以 paused 加该 error 结束', async () => {
    let stop = false
    const seen: string[] = []
    const h = harness({
      context: {
        beforeRequest: async ({ runId }) => {
          seen.push(runId)
          return stop ? { stop: budget } : undefined
        },
      },
    })
    h.reply(ok(), ok(), ok('NEVER'))
    await h.runtime.run(big(40_000, 'a'))
    await h.runtime.run(big(8_000, 'b'))
    stop = true
    const before = h.stored.length
    const result = await h.runtime.compact()
    expect(result).toMatchObject({ status: 'paused', error: budget })
    expect(kinds(h.stored.slice(before))).toEqual(['run_start', 'run_end'])
    expect(h.requests).toHaveLength(2)
    expect(seen.at(-1)).toBe(result.runId)
  })

  it('溢出恢复前 beforeRequest 返回 stop：不压缩、不重试，Run 以 paused 加该 error 结束', async () => {
    let stop = false
    const h = harness({ context: { beforeRequest: async () => (stop ? { stop: budget } : undefined) } })
    h.reply(
      ok(),
      ok(),
      () => {
        stop = true
        return fauxAssistantMessage([], { stopReason: 'error', errorMessage: 'prompt is too long: 50000 tokens > 40000 maximum' })
      },
      ok('S'),
      ok('recovered'),
    )
    await h.runtime.run(big(40_000, 'a'))
    await h.runtime.run(big(8_000, 'b'))
    const result = await h.runtime.run('next')
    expect(result).toMatchObject({ status: 'paused', error: budget })
    expect(h.stored.some((e) => e.kind === 'compaction')).toBe(false)
    expect(h.requests).toHaveLength(3)
  })
})

describe('熔断与手动压缩', () => {
  it('摘要连续失败 3 次后不再自动压缩，compaction_failed 带 consecutiveFailures；成功的手动压缩复位', async () => {
    const h = harness()
    const fail = () => fauxAssistantMessage('partial', { stopReason: 'length' })
    h.reply(ok(), fail(), ok('r2'), fail(), ok('r3'), fail(), ok('r4'), ok('r5'), ok('MANUAL SUMMARY'))
    await h.runtime.run(big(60_000, 'a'))
    for (const input of [big(40_000, 'b'), 'c', 'd']) expect((await h.runtime.run(input)).status).toBe('completed')
    const failed = h.progress.filter((p): p is Extract<ProgressEvent, { type: 'compaction_failed' }> => p.type === 'compaction_failed')
    expect(failed.map((p) => [p.trigger, p.consecutiveFailures])).toEqual([
      ['auto', 1],
      ['auto', 2],
      ['auto', 3],
    ])
    expect(h.runtime.compaction).toEqual({ consecutiveFailures: 3, paused: true })
    const requestsBefore = h.requests.length
    await h.runtime.run('e')
    // 暂停后只有对话请求，没有摘要请求。
    expect(h.requests.length).toBe(requestsBefore + 1)

    const before = h.stored.length
    const manual = await h.runtime.compact('只保留接口设计')
    expect(manual.status).toBe('completed')
    const run = h.stored.slice(before)
    expect(kinds(run)).toEqual(['run_start', 'compaction', 'run_end'])
    expect(run[0]!.payload).toEqual({ trigger: 'compact' })
    expect((run[1]!.payload as { trigger: string }).trigger).toBe('manual')
    expect(text(h.requests.at(-1)!.messages[1])).toContain('Additional requirements from the user: 只保留接口设计')
    expect(h.runtime.compaction).toEqual({ consecutiveFailures: 0, paused: false })
  })

  it('手动压缩中停止：不提交 compaction 条目，Run 以 aborted 结束', async () => {
    const h = harness()
    h.reply(ok(), ok(), (() => {
      h.runtime.abort()
      return ok('too late')
    }) as Step)
    await h.runtime.run(big(40_000, 'a'))
    await h.runtime.run(big(8_000, 'b'))
    const result = await h.runtime.compact()
    expect(result.status).toBe('aborted')
    expect(h.stored.some((e) => e.kind === 'compaction')).toBe(false)
    expect(h.progress.some((p) => p.type === 'compaction_failed')).toBe(false)
  })

  it('没有可摘要的内容：compact Run 以 error 结束，不提交条目', async () => {
    const h = harness()
    h.reply(ok())
    await h.runtime.run('hi')
    const result = await h.runtime.compact()
    // 可预期的情形（宿主通常先以 400 拒绝），不当作程序错误记录。
    expect(result).toMatchObject({ status: 'error', error: { code: 'model_error', message: expect.stringContaining('Nothing to compact') } })
    expect(h.stored.some((e) => e.kind === 'compaction')).toBe(false)
  })
})
