// 联合接缝：一次真实 Sidecar 会话串联上传、work/outputs、工具落盘、Artifact、归档与删除。
import { existsSync } from 'node:fs'
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { API_ROUTES, apiPaths, artifactPaths, attachmentReferenceFromText } from '@coko/protocol'
import { client, exchange, fauxScript, pollUntil, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

it('独立会话的上传、交付、完整工具结果和删除在同一数据根下闭环；旧会话仍回退 Workspace', async () => {
  const root = await tempDir()
  const dirs = await sidecarDirs()
  const chatsRoot = join(root, 'chats')
  const source = join(root, 'source.txt')
  await writeFile(source, 'uploaded source')
  const report = Array.from({ length: 2300 }, (_, index) => `report line ${index + 1}`).join('\n')
  const script = await fauxScript(root, {
    responses: [
      { content: [{ type: 'toolCall', name: 'write', id: 'deliver', arguments: { path: '../outputs/report.txt', content: report } }] },
      { content: [{ type: 'toolCall', name: 'read', id: 'inspect', arguments: { path: '../outputs/report.txt' } }] },
      { content: 'Report delivered.' },
    ],
  })
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script, COKO_CHATS_ROOT: chatsRoot } })
  const api = client(sidecar, await exchange(sidecar))
  expect((await api.get('/api/storage')).body).toEqual({ home: dirs.cokoHome, chatsRoot })
  const sent = await api.post(API_ROUTES.firstSend, {
    draftId: 'joint-data-root',
    text: 'Compose a report using the upload',
    permissionMode: 'accept-edits',
    files: [{ name: 'source.txt', path: source }],
  })
  expect(sent.status).toBe(201)
  const session = sent.body.session
  expect(session.cwd).toBe(join(session.directory, 'work'))
  const detail = await pollUntil(
    async () => {
      const detail = (await api.get(apiPaths.session(session.id))).body
      return detail.entries.some((entry: { kind: string }) => entry.kind === 'run_end') ? detail : undefined
    },
    { timeoutMs: 10000, what: 'joint report run end' },
  )
  const user = detail.entries.find((entry: { kind: string; payload: { role?: string } }) => entry.kind === 'message' && entry.payload.role === 'user')
  const attachment = user.payload.content.flatMap((block: { type: string; text?: string }) => {
    const reference = block.type === 'text' && block.text ? attachmentReferenceFromText(block.text) : undefined
    return reference ? [reference] : []
  })[0]
  expect(attachment.path.startsWith(join(dirs.dataDir, 'attachments', session.id))).toBe(true)
  await rm(source)
  expect(await readFile(attachment.path, 'utf8')).toBe('uploaded source')
  expect(await readFile(join(session.directory, 'outputs', 'report.txt'), 'utf8')).toBe(report)
  expect((await api.get(artifactPaths.list(session.id))).body.artifacts).toEqual([
    expect.objectContaining({ path: 'report.txt', name: 'report.txt', kind: 'file', size: Buffer.byteLength(report) }),
  ])
  const spill = join(dirs.dataDir, 'tool-results', session.id, 'inspect.txt')
  expect(await readFile(spill, 'utf8')).toBe(report)
  const tool = detail.entries.find(
    (entry: { kind: string; payload: { toolCallId?: string } }) => entry.kind === 'message' && entry.payload.toolCallId === 'inspect',
  )
  expect(tool.payload.content.map((block: { text?: string }) => block.text ?? '').join('\n')).toContain(spill)
  const mcp = join(dirs.dataDir, 'mcp', 'keep')
  await mkdir(mcp, { recursive: true })
  await writeFile(join(mcp, 'state.txt'), 'server state')
  expect((await api.post(apiPaths.sessionArchive(session.id), {})).status).toBe(200)
  expect(await readFile(attachment.path, 'utf8')).toBe('uploaded source')
  expect(await readFile(spill, 'utf8')).toBe(report)
  expect((await api.post(apiPaths.sessionRestore(session.id), {})).status).toBe(200)
  expect((await api.get(apiPaths.sessionDeletePreview(session.id))).body).toEqual({ retainedDirectories: [session.directory] })
  expect((await api.delete(apiPaths.session(session.id))).body.retainedDirectories).toEqual([session.directory])
  expect(existsSync(join(dirs.dataDir, 'attachments', session.id))).toBe(false)
  expect(existsSync(join(dirs.dataDir, 'tool-results', session.id))).toBe(false)
  expect(await readFile(join(session.directory, 'outputs', 'report.txt'), 'utf8')).toBe(report)
  expect(await readFile(join(mcp, 'state.txt'), 'utf8')).toBe('server state')
  const legacyRoot = join(root, 'legacy')
  await mkdir(legacyRoot)
  const workspace = (await api.post(API_ROUTES.workspaces, { path: legacyRoot })).body
  const created = await api.post(API_ROUTES.sessions, { workspaceId: workspace.id })
  expect(created.status).toBe(201)
  const legacy = created.body
  const reopened = (await api.get(apiPaths.session(legacy.id))).body.session
  expect(reopened).toMatchObject({ directory: null, cwd: await realpath(legacyRoot) })
  expect((await api.get(artifactPaths.list(legacy.id))).status).toBe(404)
})
