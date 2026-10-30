// 秘密不外泄总闸的 Hook 通道（ADR 0004、0007、0013）：命令回显登记的 Secret（不是凭据形态，只能靠按值替换），并在下一次调用的参数中再次出现。
// Hook 引入的通道——Hook 的 stdin（tool_input、tool_response，夹具记录到 hooks/ 目录）、hook_run 条目（message、command）、追加到结果的
// <hook-feedback>（经 faux requestLog 发给模型）——以及 WS、HTTP、库、日志与 stderr 中都不得出现明文；Hook 的环境中没有 Secret。
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, hookPaths, permissionPaths } from '@coko/protocol'
import { connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'
import { leaksIn, persisted, recordingClient } from './secrets-gate-harness.ts'

const q = (path: string) => `'${path.replaceAll("'", "'\\''")}'`

describe('秘密不外泄总闸：Hook', () => {
  it(
    '工具输出含登记 Secret：Hook 的 stdin、hook_run、追加的 <hook-feedback>、WS、库、日志与 requestLog 中没有明文；Hook 环境中没有 Secret',
    { timeout: 90_000 },
    async () => {
      const value = 'hook-token-' + randomBytes(12).toString('hex')
      const root = await tempDir()
      const hooksDir = join(root, 'hooks')
      await mkdir(hooksDir)
      const dirs = await sidecarDirs()
      const requestLog = join(root, 'requests.jsonl')
      await writeFile(requestLog, '')
      const call = (id: string, command: string) => ({ type: 'toolCall', name: 'bash', id, arguments: { command } })
      const script = await fauxScript(root, {
        requestLog,
        responses: [
          // 第一次：命令输出 Secret（命令文本中没有明文，值来自 Workspace 中的测试文件）。第二次：模型把值写进参数（入库前已替换为占位）。
          { content: [call('b1', 'printf "token=%s\\n" "$(cat .value)"')] },
          { content: [call('b2', `printf '%s' '${value}'`)] },
          { content: 'done' },
        ],
      })
      const sidecar = await startSidecar({ dirs, ipc: false, env: { COKO_FAUX_SCRIPT: script, COKO_SECRET_DEPLOY_TOKEN: value } })
      const cookie = await exchange(sidecar)
      const bodies: string[] = []
      const api = recordingClient(sidecar, cookie, bodies)
      const stream = await connect(sidecar, cookie)
      await writeFile(join(root, '.value'), value)
      const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id as string
      const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
      expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })).status).toBe(200)
      const hooks = {
        // PreToolUse：记录 stdin 与 Hook 的完整环境。
        PreToolUse: [{ hooks: [{ type: 'command', command: `cat >> ${q(join(hooksDir, 'pre-stdin.jsonl'))}; env >> ${q(join(hooksDir, 'pre-env.txt'))}` }] }],
        // PostToolUse：记录 stdin，并把 stdin 原样作为 exit 2 的 stderr 交回（追加到结果与 hook_run.message）。
        PostToolUse: [{ hooks: [{ type: 'command', command: `tee -a ${q(join(hooksDir, 'post-stdin.jsonl'))} >&2; exit 2` }] }],
      }
      expect((await api.put(hookPaths.hooks, { hooks, expectedRevision: 0 })).status).toBe(200)
      stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
      await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
      expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'go' })).status).toBe(202)
      await stream.waitFor(() => stream.entries(sessionId).some((e) => e.kind === 'run_end'), 30_000)
      await api.get(`${hookPaths.hooks}?sessionId=${sessionId}`)
      await api.get(apiPaths.session(sessionId))

      // 前置：每个通道确实被驱动，保存的文本带占位。
      const entries = stream.entries(sessionId)
      const runs = entries.filter((e) => e.kind === 'hook_run').map((e) => e.payload as { event: string; outcome: string; message?: string })
      expect(runs.filter((r) => r.event === 'PostToolUse').map((r) => r.outcome)).toEqual(['context', 'context'])
      expect(runs.some((r) => r.message?.includes('[REDACTED:secret]'))).toBe(true)
      const first = entries.find((e) => e.kind === 'message' && (e.payload as { toolCallId?: string }).toolCallId === 'b1')!
      expect(JSON.stringify(first.payload)).toContain('<hook-feedback>')
      expect(JSON.stringify(first.payload)).toContain('token=[REDACTED:secret]')
      const postStdin = await readFile(join(hooksDir, 'post-stdin.jsonl'), 'utf8')
      expect(postStdin).toContain('"tool_response"')
      expect(postStdin).toContain('token=[REDACTED:secret]')
      const preStdin = await readFile(join(hooksDir, 'pre-stdin.jsonl'), 'utf8')
      expect(preStdin.split('\n').filter(Boolean)).toHaveLength(2)
      expect(preStdin).toContain('[REDACTED:secret]')
      const env = await readFile(join(hooksDir, 'pre-env.txt'), 'utf8')
      expect(env).toContain('COKO_HOOK_EVENT=PreToolUse')
      expect(env).not.toMatch(/COKO_SECRET_/)
      const requests = (await readFile(requestLog, 'utf8')).split('\n').filter(Boolean)
      expect(requests.some((r) => r.includes('<hook-feedback>'))).toBe(true)

      sidecar.child.kill('SIGTERM')
      expect(await sidecar.exited).toEqual({ code: 0, signal: null })
      const files = await persisted(dirs, { extraDirs: { hooks: hooksDir } })
      expect(files.filter((f) => f.name.startsWith('hooks/'))).toHaveLength(3)
      const channels: [string, string | Buffer][] = [
        ...stream.frames.map((frame, i): [string, string] => ['ws frame ' + i, frame]),
        ...bodies.map((body, i): [string, string] => ['http body ' + i, body]),
        ...requests.map((line, i): [string, string] => ['model request ' + i, line]),
        ...files.map((f): [string, Buffer] => ['stopped ' + f.name, f.bytes]),
        ['sidecar stderr', sidecar.stderr()],
      ]
      expect(leaksIn(channels, { 'registered secret': value })).toEqual([])
    },
  )

  it(
    'UserPromptSubmit 与 Stop：提示含 Secret 时 Hook 的 stdin 与 requestLog 为脱敏值；additionalContext 与 Stop 的反馈中的 Secret 在条目、WS、库、日志与 requestLog 中替换',
    { timeout: 90_000 },
    async () => {
      // typed：用户在提示中输入（用户消息按原文入库，ADR 0007）；value：Hook 从 Workspace 文件读出、经输出交回。
      const typed = 'typed-token-' + randomBytes(12).toString('hex')
      const value = 'feedback-token-' + randomBytes(12).toString('hex')
      const root = await tempDir()
      const hooksDir = join(root, 'hooks')
      await mkdir(hooksDir)
      const dirs = await sidecarDirs()
      const requestLog = join(root, 'requests.jsonl')
      await writeFile(requestLog, '')
      const script = await fauxScript(root, { requestLog, responses: [{ content: 'first' }, { content: 'second' }] })
      const sidecar = await startSidecar({
        dirs,
        ipc: false,
        env: { COKO_FAUX_SCRIPT: script, COKO_SECRET_DEPLOY_TOKEN: typed, COKO_SECRET_FEEDBACK_TOKEN: value },
      })
      const cookie = await exchange(sidecar)
      const bodies: string[] = []
      const api = recordingClient(sidecar, cookie, bodies)
      const stream = await connect(sidecar, cookie)
      await writeFile(join(root, '.value'), value)
      const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id as string
      const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
      const ups = q(join(hooksDir, 'ups-stdin.jsonl'))
      const stop = q(join(hooksDir, 'stop-stdin.jsonl'))
      const hooks = {
        // 记录 stdin，并把 Workspace 中的值作为 additionalContext 交回。
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: `cat >> ${ups}; printf '{"hookSpecificOutput":{"additionalContext":"ctx=%s"}}' "$(cat .value)"` }] },
        ],
        // 第一次 Stop：把值作为 exit 2 的 stderr 交回（Run 继续，反馈作为 user message 送达）。
        Stop: [
          {
            hooks: [
              {
                type: 'command',
                command: `cat >> ${stop}; if [ ! -f .stopped ]; then touch .stopped; printf 'feedback=%s' "$(cat .value)" >&2; exit 2; fi`,
              },
            ],
          },
        ],
      }
      expect((await api.put(hookPaths.hooks, { hooks, expectedRevision: 0 })).status).toBe(200)
      stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
      await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
      expect((await api.post(apiPaths.sessionMessages(sessionId), { text: `deploy with ${typed}` })).status).toBe(202)
      await stream.waitFor(() => stream.entries(sessionId).some((e) => e.kind === 'run_end'), 30_000)

      // 前置：每个通道确实被驱动。
      const upsStdin = await readFile(join(hooksDir, 'ups-stdin.jsonl'), 'utf8')
      expect(upsStdin).toContain('"prompt":"deploy with [REDACTED:secret]"')
      const requests = (await readFile(requestLog, 'utf8')).split('\n').filter(Boolean)
      expect(requests).toHaveLength(2)
      expect(requests[0]).toContain('ctx=[REDACTED:secret]')
      expect(requests[1]).toContain('Stop hook feedback:\\nfeedback=[REDACTED:secret]')
      const runs = stream
        .entries(sessionId)
        .filter((e) => e.kind === 'hook_run')
        .map((e) => e.payload as { event: string; outcome: string; message?: string })
      expect(runs.map((r) => [r.event, r.outcome, r.message])).toEqual([
        ['UserPromptSubmit', 'context', 'ctx=[REDACTED:secret]'],
        ['Stop', 'continued', 'feedback=[REDACTED:secret]'],
      ])

      sidecar.child.kill('SIGTERM')
      expect(await sidecar.exited).toEqual({ code: 0, signal: null })
      const files = await persisted(dirs, { extraDirs: { hooks: hooksDir } })
      expect(files.filter((f) => f.name.startsWith('hooks/'))).toHaveLength(2)
      const channels: [string, string | Buffer][] = [
        ...stream.frames.map((frame, i): [string, string] => ['ws frame ' + i, frame]),
        ...bodies.map((body, i): [string, string] => ['http body ' + i, body]),
        ...requests.map((line, i): [string, string] => ['model request ' + i, line]),
        ...files.map((f): [string, Buffer] => ['stopped ' + f.name, f.bytes]),
        ['sidecar stderr', sidecar.stderr()],
      ]
      expect(leaksIn(channels, { 'hook output secret': value })).toEqual([])
      // 用户输入的明文只在用户自己的消息中（库、推送与 HTTP 读回）；Hook 的 stdin、模型请求、日志、其余落盘文件与 stderr 中没有。
      const outbound: [string, string | Buffer][] = [
        ...requests.map((line, i): [string, string] => ['model request ' + i, line]),
        ...files.filter((f) => !f.name.startsWith('coko.db')).map((f): [string, Buffer] => ['stopped ' + f.name, f.bytes]),
        ['sidecar stderr', sidecar.stderr()],
      ]
      expect(leaksIn(outbound, { 'typed secret': typed })).toEqual([])
    },
  )
})
