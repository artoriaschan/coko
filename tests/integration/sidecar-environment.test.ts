// 环境 section：经真实 Sidecar 的 requestLog 与上下文用量接口验证。
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { platform, release } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { charsToTokens, DEFAULT_SYSTEM_PROMPT } from '@coko/agent'
import { API_ROUTES, apiPaths, contextPaths, worktreePaths } from '@coko/protocol'
import { createGitWorkspace } from '../fixtures/git/index.ts'
import { answerDecrypts, client, connect, customProvider, exchange, fauxScript, saveProvider, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

it('环境在基础提示后，含当前目录、附加文件夹与宿主环境；跨 Run 稳定，普通仓库、worktree 与非 git 目录正确', async () => {
  const fixture = await createGitWorkspace()
  onTestFinished(() => fixture.dispose())
  const root = await tempDir()
  const extra = join(root, 'additional')
  const plain = join(root, 'plain')
  await mkdir(extra)
  await mkdir(plain)
  const requestLog = join(root, 'requests.jsonl')
  await writeFile(requestLog, '')
  const script = await fauxScript(root, { requestLog, responses: Array.from({ length: 4 }, () => ({ content: 'done' })) })
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { ...fixture.env, COKO_FAUX_SCRIPT: script, TZ: 'Asia/Shanghai' } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspace = (await api.post(API_ROUTES.workspaces, { path: fixture.root })).body
  const projects = (await api.get(API_ROUTES.projects)).body.projects
  const project = projects.find((p: { primaryWorkspaceId: string }) => p.primaryWorkspaceId === workspace.id)
  expect(
    (
      await api.put(`${API_ROUTES.projects}/${project.id}`, {
        name: 'Environment project',
        folders: [
          { path: fixture.root, primary: true },
          { path: extra, primary: false },
        ],
      })
    ).status,
  ).toBe(200)
  const open = async (workspaceId: string, worktreeId?: string) => {
    const session = (await api.post(API_ROUTES.sessions, { workspaceId, ...(worktreeId ? { worktreeId } : {}) })).body
    stream.send({ type: 'subscribe', sessionId: session.id, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === session.id)
    return session.id as string
  }
  const send = async (id: string) => {
    const before = stream.entries(id).filter((e) => e.kind === 'run_end').length
    expect((await api.post(apiPaths.sessionMessages(id), { text: 'hello' })).status).toBe(202)
    await stream.waitFor(() => stream.entries(id).filter((e) => e.kind === 'run_end').length > before)
  }
  const id = await open(workspace.id)
  const draftUsage = await api.get(contextPaths.workspace(workspace.id))
  expect(draftUsage.status).toBe(200)
  await send(id)
  await writeFile(join(fixture.root, 'dirty.txt'), 'git status must not appear')
  await send(id)
  const tree = (await api.post(worktreePaths.workspaceWorktrees(workspace.id), { name: 'environment' })).body
  await send(await open(workspace.id, tree.id))
  const nonGit = (await api.post(API_ROUTES.workspaces, { path: plain })).body
  await send(await open(nonGit.id))
  const requests = (await readFile(requestLog, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { sections: Record<string, string> }[])
  const sections = requests.map((messages) => messages[0]!.sections)
  expect(Object.keys(sections[0]!).slice(0, 2)).toEqual(['coko.base', 'environment'])
  const env = sections[0]!.environment!
  for (const text of [
    fixture.root,
    extra,
    'Git repository: true',
    'Worktree: false',
    `Platform: ${platform()}`,
    `OS version: ${release()}`,
    'Shell: /bin/bash',
    'Model: faux/faux-1',
    'Timezone: Asia/Shanghai',
  ])
    expect(env).toContain(text)
  expect(env).not.toContain('dirty.txt')
  expect(env).not.toContain('Date:')
  expect(sections[1]!.environment).toBe(env)
  // Draft scopes have no Session yet, but report the same default-model environment in system usage.
  expect(draftUsage.body.breakdown.system).toBe(charsToTokens(DEFAULT_SYSTEM_PROMPT.length + env.length))
  expect(sections[2]!.environment).toContain(`Workspace: ${tree.path}`)
  expect(sections[2]!.environment).toContain('Worktree: true')
  expect(sections[3]!.environment).toContain('Git repository: false')
  expect(sections[3]!.environment).toContain('Worktree: false')
  expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
})

it('更换模型后下一次请求的环境只改变 Model；草稿按缺省模型计算', async () => {
  const bodies: { messages: { role: string; content: string | { type: string; text?: string }[] }[] }[] = []
  const contentText = (content: string | { type: string; text?: string }[]) =>
    typeof content === 'string' ? content : content.map((block) => block.text ?? '').join('')
  const server = createServer((request, response) => {
    let text = ''
    request.setEncoding('utf8').on('data', (chunk: string) => {
      text += chunk
    })
    request.on('end', () => {
      bodies.push(JSON.parse(text))
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end('{"error":{"message":"recorded","type":"invalid_request_error"}}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  onTestFinished(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  )
  const sidecar = await startSidecar({ dirs: await sidecarDirs() })
  answerDecrypts(sidecar)
  const port = (server.address() as { port: number }).port
  expect(
    (
      await saveProvider(sidecar, customProvider('environment-models', `http://127.0.0.1:${port}/v1`, ['first-model', 'second-model-long']), {
        secret: 'environment-fixture-key',
      })
    ).ok,
  ).toBe(true)
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspace = (await api.post(API_ROUTES.workspaces, { path: await tempDir() })).body
  const session = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.id })).body
  stream.send({ type: 'subscribe', sessionId: session.id, afterSeq: 0 })
  await stream.waitFor((message) => message.type === 'subscribed' && message.sessionId === session.id)
  for (const [index, modelId] of ['first-model', 'second-model-long'].entries()) {
    expect((await api.put(apiPaths.sessionModel(session.id), { model: { providerId: 'environment-models', modelId } })).status).toBe(200)
    expect((await api.post(apiPaths.sessionMessages(session.id), { text: 'hello' })).status).toBe(202)
    await stream.waitFor(() => stream.entries(session.id).filter((entry) => entry.kind === 'run_end').length > index)
  }
  const environments = bodies.map(
    (body) => contentText(body.messages.find((message) => message.role === 'system')!.content).match(/<environment>[\s\S]*?<\/environment>/)![0],
  )
  expect(environments).toHaveLength(2)
  expect(environments[0]).toContain('Model: environment-models/first-model')
  expect(environments[1]).toBe(environments[0]!.replace('first-model', 'second-model-long'))
  const draft = (await api.get(contextPaths.workspace(workspace.id))).body
  expect(draft.breakdown.system).toBe(charsToTokens(DEFAULT_SYSTEM_PROMPT.length + environments[0]!.length))
  const usage = (await api.get(contextPaths.session(session.id))).body
  // 已送达的宿主状态块也属于 system；直接从实际模型请求观察它们。
  const stateBlocks = bodies[1]!.messages.flatMap((message) =>
    message.role === 'user' ? [...contentText(message.content).matchAll(/<state_update name="[^"]+">[\s\S]*?<\/state_update>/g)].map((match) => match[0]) : [],
  )
  expect(stateBlocks).toHaveLength(1)
  expect(usage.breakdown.system).toBe(charsToTokens(DEFAULT_SYSTEM_PROMPT.length + environments[1]!.length + stateBlocks[0]!.length))
  expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
})
