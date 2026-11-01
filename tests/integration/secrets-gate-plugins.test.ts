// 秘密不外泄总闸的插件通道（ADR 0004、0007、0017）：插件 Skill 正文含登记的 Secret（skill 工具结果与 /<plugin>:<skill> 展开）、插件命令与子代理定义
// 的正文含登记的 Secret（/<plugin>:<command> 展开、子代理的 system prompt），插件 Hook 的输出含登记的 Secret（exit 2 的 stderr 追加到结果）。faux
// requestLog、条目、WS、HTTP、库、日志与插件 Hook 的 stdin 中没有明文；插件目录本身（用户安装的文件，在 COKO_HOME 下）不在扫描范围内。
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, permissionPaths, pluginPaths, type PluginInfo } from '@coko/protocol'
import { writePlugin } from '../fixtures/plugins/index.ts'
import { connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'
import { leaksIn, persisted, recordingClient } from './secrets-gate-harness.ts'

const q = (path: string) => "'" + path.replaceAll("'", "'\\''") + "'"

describe('秘密不外泄总闸：插件', () => {
  it('插件 Skill 正文与插件 Hook 输出含登记 Secret：requestLog、条目、WS、HTTP、库、日志与 Hook 的 stdin 中没有明文', { timeout: 90_000 }, async () => {
    const skillValue = 'plugin-skill-token-' + randomBytes(12).toString('hex')
    const hookValue = 'plugin-hook-token-' + randomBytes(12).toString('hex')
    const root = await tempDir()
    const hooksDir = join(root, 'hooks')
    await mkdir(hooksDir)
    await writeFile(join(root, '.value'), hookValue)
    const dirs = await sidecarDirs()
    const requestLog = join(root, 'requests.jsonl')
    await writeFile(requestLog, '')
    const call = (id: string, name: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, id, arguments: args })
    const script = await fauxScript(root, {
      requestLog,
      responses: [
        { content: [call('s1', 'skill', { name: 'leak:vault' })] },
        { content: [call('b1', 'bash', { command: 'printf "token=%s\\n" "$(cat .value)"' })] },
        { content: 'done' },
        { content: 'expanded' },
        { content: 'command expanded' },
        { content: [call('a1', 'agent', { description: 'keep', prompt: 'CHILD-K go', subagent_type: 'leak:keeper' })] },
        { match: 'CHILD-K', content: 'kept' },
        { content: 'dispatched' },
      ],
    })
    const sidecar = await startSidecar({
      dirs,
      ipc: false,
      env: { COKO_FAUX_SCRIPT: script, COKO_SECRET_SKILL_TOKEN: skillValue, COKO_SECRET_HOOK_TOKEN: hookValue },
    })
    const cookie = await exchange(sidecar)
    const bodies: string[] = []
    const api = recordingClient(sidecar, cookie, bodies)
    const stream = await connect(sidecar, cookie)

    const plugin = await writePlugin(join(await tempDir('coko-plugin-'), 'leak'), {
      name: 'leak',
      files: {
        'skills/vault/SKILL.md': '---\nname: vault\ndescription: Vault notes\n---\nThe deploy key is ' + skillValue + '\n',
        'commands/deploy.md': '---\ndescription: Deploy\n---\nDeploy with key ' + skillValue + ' to $ARGUMENTS\n',
        'agents/keeper.md': '---\nname: keeper\ndescription: Keeps keys\n---\nThe keeper knows ' + skillValue + '\n',
        'hooks/hooks.json': {
          hooks: {
            // 记录 stdin；把 Workspace 中的值作为 exit 2 的 stderr 交回（追加到结果与 hook_run.message）。
            PostToolUse: [
              {
                matcher: 'Bash',
                hooks: [{ type: 'command', command: 'cat >> ' + q(join(hooksDir, 'post-stdin.jsonl')) + '; printf "hook=%s" "$(cat .value)" >&2; exit 2' }],
              },
            ],
          },
        },
      },
    })
    const installed = await api.post(pluginPaths.plugins, { source: { kind: 'dir', path: plugin } })
    expect(installed.status).toBe(201)
    expect((await api.post(pluginPaths.approve('leak'), { digest: (installed.body as PluginInfo).digest })).status).toBe(200)
    await api.get(pluginPaths.plugins)

    const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id as string
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })).status).toBe(200)
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'go' })).status).toBe(202)
    await stream.waitFor(() => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length >= 1, 30_000)
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: '/leak:vault' })).status).toBe(202)
    await stream.waitFor(() => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length >= 2, 30_000)
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: '/leak:deploy prod' })).status).toBe(202)
    await stream.waitFor(() => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length >= 3, 30_000)
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'DISPATCH' })).status).toBe(202)
    await stream.waitFor(() => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length >= 4, 30_000)
    await api.get(apiPaths.session(sessionId))

    // 前置：每个通道确实被驱动，文本带占位。
    const entries = stream.entries(sessionId)
    const skillResult = entries.find((e) => e.kind === 'message' && (e.payload as { toolCallId?: string }).toolCallId === 's1')!
    expect(JSON.stringify(skillResult.payload)).toContain('The deploy key is [REDACTED:secret]')
    const runs = entries.filter((e) => e.kind === 'hook_run').map((e) => e.payload as { source: string; message?: string })
    expect(runs).toEqual([expect.objectContaining({ source: 'plugin', message: 'hook=[REDACTED:secret]' })])
    const postStdin = await readFile(join(hooksDir, 'post-stdin.jsonl'), 'utf8')
    expect(postStdin).toContain('token=[REDACTED:secret]')
    const requests = (await readFile(requestLog, 'utf8')).split('\n').filter(Boolean)
    expect(requests).toHaveLength(8)
    expect(requests[3]).toContain('The deploy key is')
    expect(requests[4]).toContain('Deploy with key')
    expect(requests.find((line) => line.includes('CHILD-K'))).toContain('The keeper knows')

    sidecar.child.kill('SIGTERM')
    expect(await sidecar.exited).toEqual({ code: 0, signal: null })
    // 库、日志与 Hook 的 stdin 记录；COKO_HOME（含插件目录本身）不扫描。
    const files = await persisted(dirs, { extraDirs: { hooks: hooksDir } })
    const channels: [string, string | Buffer][] = [
      ...stream.frames.map((frame, i): [string, string] => ['ws frame ' + i, frame]),
      ...bodies.map((body, i): [string, string] => ['http body ' + i, body]),
      ...requests.map((line, i): [string, string] => ['model request ' + i, line]),
      ...files.map((f): [string, Buffer] => ['stopped ' + f.name, f.bytes]),
      ['sidecar stderr', sidecar.stderr()],
    ]
    expect(leaksIn(channels, { 'plugin skill secret': skillValue, 'plugin hook secret': hookValue })).toEqual([])
  })
})
