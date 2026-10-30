// isolation worktree（ADR 0014、0016，git 夹具）：default 下询问、plan 下为错误结果；子代理不改文件时 worktree 与分支被移除；有提交时保留且结果给出路径与
// 分支；父 Session 读取该 worktree 的文件须审批（它在 Workspace 的 .coko-worktrees/ 之内）。Coko 的 worktree 只在临时仓库中创建。
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { apiPaths } from '@coko/protocol'
import { createGitWorkspace } from '../fixtures/git/index.ts'
import { client, connect, exchange, fauxScript, killAndRestart } from './sidecar-harness.ts'
import { bootAgents, call, ends, of, runEnds, starts, toolResults } from './sidecar-subagents-harness.ts'

async function repo() {
  const fixture = await createGitWorkspace()
  onTestFinished(() => fixture.dispose())
  return fixture
}

describe('子代理：isolation worktree', { timeout: 120_000 }, () => {
  it('default 下询问；不改文件时 worktree 与分支被移除；plan 下为错误结果', async () => {
    const fixture = await repo()
    const env = await bootAgents(
      [
        { match: 'PARENT-I', content: [call('agent', 'a1', { description: 'look', prompt: 'CHILD-I look', subagent_type: 'general', isolation: 'worktree' })] },
        { match: 'CHILD-I', content: [call('bash', 'b1', { command: 'pwd -P' })] },
        { match: 'CHILD-I', content: 'looked' },
        { match: 'PARENT-I', content: 'ok' },
        {
          match: 'PARENT-PLAN',
          content: [call('agent', 'a2', { description: 'no', prompt: 'CHILD-PLAN no', subagent_type: 'general', isolation: 'worktree' })],
        },
        { match: 'PARENT-PLAN', content: 'ok' },
      ],
      { env: fixture.env, workspace: fixture.root },
    )
    const parent = await env.open('default')
    await env.submit(parent, 'PARENT-I go')
    // agent 带 isolation 在 default 下询问。
    await env.stream.waitFor(() => of(env.stream, parent, 'approval_request').length >= 1, 20_000)
    const request = of(env.stream, parent, 'approval_request')[0]!.payload as { requestId: string; toolName: string }
    expect(request.toolName).toBe('agent')
    expect((await env.api.post(apiPaths.sessionApproval(parent, request.requestId), { decision: 'allow' })).status).toBe(204)
    await expect.poll(() => starts(env.stream, parent).length, { timeout: 20_000 }).toBe(1)
    const child = starts(env.stream, parent)[0]!.agentId
    const pending = async () =>
      ((await env.api.get(apiPaths.session(child))).body.entries as { kind: string; payload: { requestId: string } }[]).filter(
        (e) => e.kind === 'approval_request',
      )
    await expect.poll(async () => (await pending()).length, { timeout: 20_000 }).toBe(1)
    expect((await env.api.post(apiPaths.sessionApproval(child, (await pending())[0]!.payload.requestId), { decision: 'allow' })).status).toBe(204)
    await env.stream.waitFor(() => runEnds(env.stream, parent).length >= 1, 30_000)
    const start = of(env.stream, parent, 'agent_start')[0]!.payload as { isolation: { path: string; branch: string } }
    expect(start.isolation.path).toContain(join(fixture.root, '.coko-worktrees'))
    const result = (await env.api.get(apiPaths.session(child))).body.entries.find(
      (e: { kind: string; payload: { role?: string } }) => e.payload.role === 'toolResult',
    )
    expect(JSON.stringify(result.payload.content)).toContain(start.isolation.path)
    expect(ends(env.stream, parent)[0]).toMatchObject({ status: 'completed' })
    expect((ends(env.stream, parent)[0] as { worktree?: unknown }).worktree).toBeUndefined()
    expect(existsSync(start.isolation.path)).toBe(false)
    expect((await fixture.git('branch', '--list')).trim()).toBe('* main')
    expect(await fixture.git('worktree', 'list')).not.toContain('.coko-worktrees')

    // plan：判定（agent 类带 isolation 只有 full-access 放行）先询问；允许之后工具以错误结果拒绝，不创建 worktree 与子 Session。
    const planned = await env.open('plan')
    await env.submit(planned, 'PARENT-PLAN go')
    await env.stream.waitFor(() => of(env.stream, planned, 'approval_request').length >= 1, 20_000)
    const ask = of(env.stream, planned, 'approval_request')[0]!.payload as { requestId: string }
    expect((await env.api.post(apiPaths.sessionApproval(planned, ask.requestId), { decision: 'allow' })).status).toBe(204)
    await env.stream.waitFor(() => runEnds(env.stream, planned).length >= 1, 30_000)
    expect(toolResults(env.stream, planned, 'agent')).toEqual([
      expect.objectContaining({ isError: true, text: expect.stringMatching(/not available in plan mode/) }),
    ])
    expect(starts(env.stream, planned)).toHaveLength(0)
    expect(await fixture.git('worktree', 'list')).not.toContain('.coko-worktrees')
  })

  it('有提交时保留 worktree，结果给出路径与分支；父 Session 读取其中的文件须审批', async () => {
    const fixture = await repo()
    const env = await bootAgents(
      [
        {
          match: 'PARENT-K',
          content: [call('agent', 'a1', { description: 'change', prompt: 'CHILD-K change', subagent_type: 'general', isolation: 'worktree' })],
        },
        { match: 'CHILD-K', content: [call('bash', 'b1', { command: "echo changed > made.txt && git add made.txt && git commit -qm 'child change'" })] },
        { match: 'CHILD-K', content: 'committed' },
        { match: 'PARENT-K', content: 'kept' },
      ],
      { env: fixture.env, workspace: fixture.root },
    )
    const parent = await env.open('full-access')
    await env.submit(parent, 'PARENT-K go')
    await env.stream.waitFor(() => runEnds(env.stream, parent).length >= 1, 30_000)
    const [end] = ends(env.stream, parent) as { status: string; worktree?: { kept: boolean; path: string; branch: string } }[]
    expect(end).toMatchObject({ status: 'completed', worktree: { kept: true, branch: expect.stringMatching(/^coko\//) } })
    const kept = end!.worktree!
    expect(existsSync(join(kept.path, 'made.txt'))).toBe(true)
    expect(toolResults(env.stream, parent, 'agent')[0]!.text).toContain(`worktree ${kept.path} on branch ${kept.branch}`)
    expect(await fixture.git('branch', '--list')).toContain(kept.branch)
    expect(existsSync(join(fixture.root, 'made.txt'))).toBe(false)

    // 父 Session（full-access）读取保留的 worktree 中的文件须审批；重启之后（启动恢复重新登记）同样。worktree 路径随机，第二个脚本在得知路径后写出。
    const script = await fauxScript(
      env.root,
      { responses: [{ content: [call('read', 'r1', { path: join(kept.path, 'made.txt') })] }, { content: 'read' }] },
      'read.json',
    )
    const restarted = await killAndRestart(env.sidecar, { dirs: env.dirs, env: { ...fixture.env, COKO_FAUX_SCRIPT: script } })
    const cookie = await exchange(restarted)
    const api = client(restarted, cookie)
    const stream = await connect(restarted, cookie)
    stream.send({ type: 'subscribe', sessionId: parent, afterSeq: 0 })
    expect((await api.post(apiPaths.sessionMessages(parent), { text: 'PARENT-READ go' })).status).toBe(202)
    await stream.waitFor(() => stream.entries(parent).filter((e) => e.kind === 'approval_request').length >= 1, 20_000)
    const ask = stream.entries(parent).find((e) => e.kind === 'approval_request')!.payload as { requestId: string; toolName: string; subject: string }
    expect(ask).toMatchObject({ toolName: 'read', subject: join(kept.path, 'made.txt') })
    expect((await api.post(apiPaths.sessionApproval(parent, ask.requestId), { decision: 'deny' })).status).toBe(204)
    await stream.waitFor(() => stream.entries(parent).filter((e) => e.kind === 'run_end').length >= 2, 30_000)
  })
})
