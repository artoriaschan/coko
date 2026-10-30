// Goal 的重启恢复（ADR 0011）：Goal Round 进行中 SIGKILL Sidecar，重启后 Goal 为 paused（restarted），30 秒内不出现新的 run_start（以事件等待
// 超时断言）；用户恢复后继续下一轮。不读取文件，不涉及符号链接越界。
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, goalPaths } from '@coko/protocol'
import {
  client,
  connect,
  exchange,
  fauxScript,
  killAndRestart,
  sidecarDirs,
  startSidecar,
  tempDir,
  waitApproval,
  type Sidecar,
  type Stream,
} from './sidecar-harness.ts'

const call = (name: string, id: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, id, arguments: args })

async function open(sidecar: Sidecar, sessionId?: string) {
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  if (sessionId) await subscribe(stream, sessionId)
  return { api, stream }
}

async function subscribe(stream: Stream, sessionId: string) {
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
}

describe('Goal 的重启恢复', { timeout: 120_000 }, () => {
  it('Goal Round 进行中 SIGKILL → 重启后 paused（restarted）且 30 秒内不开始 Run；恢复后继续', async () => {
    const root = await tempDir()
    const workspaceDir = join(root, 'ws')
    await mkdir(workspaceDir)
    await writeFile(join(root, 'requests-1.jsonl'), '')
    const dirs = await sidecarDirs()
    const first = await fauxScript(
      root,
      {
        responses: [
          { content: [call('create_goal', 'cg', { objective: 'write the file', criteria: ['file written'], budget: { max_rounds: 2 } })] },
          { content: 'set' },
          // Goal Round 1：write 等待审批时被强杀。
          { content: [call('write', 'w1', { path: 'a.txt', content: 'A' })] },
        ],
      },
      'faux-1.json',
    )
    const second = await fauxScript(root, { responses: [{ content: 'round 2 after restart' }] }, 'faux-2.json')
    const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: first } })
    const { api, stream } = await open(sidecar)
    const workspaceId = (await api.post(API_ROUTES.workspaces, { path: workspaceDir })).body.id as string
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    await subscribe(stream, sessionId)
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'go' })).status).toBe(202)
    await waitApproval(stream, sessionId, 1)
    expect((await api.get(goalPaths.sessionGoal(sessionId))).body).toMatchObject({ goal: { phase: 'running', revision: 1 }, usage: { rounds: 1 } })

    const restarted = await killAndRestart(sidecar, { dirs, env: { COKO_FAUX_SCRIPT: second } })
    const after = await open(restarted, sessionId)
    const goal = (await after.api.get(goalPaths.sessionGoal(sessionId))).body
    expect(goal).toMatchObject({
      goal: { phase: 'paused', revision: 2, source: 'system', reason: { code: 'restarted' } },
      usage: { rounds: 1 },
    })
    const entries = () => after.stream.entries(sessionId)
    // 被中断的 Run 已补齐（run_end interrupted），之后才是暂停的 goal 条目。
    const kinds = entries().map((e) => e.kind)
    expect(kinds.lastIndexOf('run_end')).toBeLessThan(kinds.lastIndexOf('goal'))
    const startsBefore = entries().filter((e) => e.kind === 'run_start').length
    expect(startsBefore).toBe(2)
    // 不自动推进：30 秒内没有新的 run_start。
    await expect(after.stream.waitFor(() => entries().filter((e) => e.kind === 'run_start').length > startsBefore, 30_000)).rejects.toThrow(/Timed out/)

    const resumed = await after.api.post(goalPaths.sessionGoal(sessionId), { action: 'resume', revision: 2 })
    expect(resumed.status).toBe(200)
    expect(resumed.body.goal).toMatchObject({ phase: 'running', revision: 3, resumedAtRound: 1 })
    await after.stream.waitFor(() => entries().some((e) => e.kind === 'goal' && (e.payload as { phase: string }).phase === 'budget-exhausted'), 30_000)
    const runStarts = entries()
      .filter((e) => e.kind === 'run_start')
      .map((e) => e.payload)
    expect(runStarts.at(-1)).toEqual({ trigger: 'goal', goal: { goalId: 'goal-1', round: 2 } })
    expect(runStarts).toHaveLength(3)
    expect(await restarted.stop()).toEqual({ code: 0, signal: null })
  })
})
