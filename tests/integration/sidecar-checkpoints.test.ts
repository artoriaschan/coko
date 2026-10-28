// 文件 Checkpoint（票 07，ADR 0006）：真实 Sidecar（faux 模型）经协议驱动 write / edit，读回 file_backup / file_change 条目，
// 并直接检查 <dataDir>/blobs 下的快照文件（内容逐字节、权限）。
import { createHash } from 'node:crypto'
import { readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, permissionPaths, type SessionEntryRecord } from '@coko/protocol'
import { client, connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir, waitApproval, type Stream } from './sidecar-harness.ts'

async function boot(mode: string, responses: unknown[]) {
  const root = await realpath(await tempDir())
  const dirs = await sidecarDirs()
  const script = await fauxScript(root, { responses }, '.faux.json')
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const workspace = await api.post(API_ROUTES.workspaces, { path: root })
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.body.id })).body.id as string
  expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode })).status).toBe(200)
  const stream = await connect(sidecar, cookie)
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed')
  return { root, dirs, sidecar, api, sessionId, stream }
}

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const runEnds = (stream: Stream, sessionId: string, n: number) =>
  stream.waitFor(() => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length >= n)
const ofKind = (entries: SessionEntryRecord[], kind: string) => entries.filter((e) => e.kind === kind)
const userSeqs = (entries: SessionEntryRecord[]) =>
  entries.filter((e) => e.kind === 'message' && (e.payload as { role: string }).role === 'user').map((e) => e.seq)
const call = (name: string, id: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, id, arguments: args })
const edit = (id: string, path: string, oldText: string, newText: string) => call('edit', id, { path, edits: [{ oldText, newText }] })

/** 快照目录下的全部文件（相对路径）；目录不存在时为空。 */
async function blobFiles(dataDir: string): Promise<string[]> {
  const dir = join(dataDir, 'blobs')
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => [])
  return entries
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name).slice(dir.length + 1))
    .sort()
}
const blobPath = (dataDir: string, hash: string) => join(dataDir, 'blobs', hash.slice(0, 2), hash)

describe('文件 Checkpoint', () => {
  it('一次 Run 中两次 edit 同一文件只备份一次（Run 前的字节）、新建文件为 absent；第二条消息后再 edit 是新锚点下的新备份', { timeout: 60_000 }, async () => {
    const original = Buffer.from('alpha\nbeta\n\u00e9\n')
    const responses = [
      { content: [edit('e1', 'notes.txt', 'alpha', 'ALPHA')] },
      { content: [edit('e2', 'notes.txt', 'beta', 'BETA'), call('write', 'w1', { path: 'src/new.txt', content: 'fresh' })] },
      { content: 'first done' },
      { content: [edit('e3', 'notes.txt', 'ALPHA', 'Alpha')] },
      { content: 'second done' },
    ]
    const { root, dirs, api, sessionId, stream } = await boot('accept-edits', responses)
    const notes = join(root, 'notes.txt')
    await writeFile(notes, original)

    await api.post(apiPaths.sessionMessages(sessionId), { text: 'edit twice' })
    await runEnds(stream, sessionId, 1)
    const afterFirst = await readFile(notes)
    expect(afterFirst.toString()).toBe('ALPHA\nBETA\n\u00e9\n')

    await api.post(apiPaths.sessionMessages(sessionId), { text: 'edit again' })
    await runEnds(stream, sessionId, 2)
    expect(await readFile(notes, 'utf8')).toBe('Alpha\nBETA\n\u00e9\n')

    // 读回持久化的条目（不是推送）。
    const entries = (await api.get(apiPaths.session(sessionId))).body.entries as SessionEntryRecord[]
    const [first, second] = userSeqs(entries)
    expect(ofKind(entries, 'file_backup').map((e) => e.payload)).toEqual([
      { anchorSeq: first, path: notes, blob: sha256(original) },
      { anchorSeq: first, path: join(root, 'src/new.txt'), absent: true },
      { anchorSeq: second, path: notes, blob: sha256(afterFirst) },
    ])
    expect(ofKind(entries, 'file_change').map((e) => e.payload)).toEqual([
      { anchorSeq: first, path: notes, afterHash: sha256('ALPHA\nbeta\n\u00e9\n') },
      { anchorSeq: first, path: notes, afterHash: sha256(afterFirst) },
      { anchorSeq: first, path: join(root, 'src/new.txt'), afterHash: sha256('fresh') },
      { anchorSeq: second, path: notes, afterHash: sha256('Alpha\nBETA\n\u00e9\n') },
    ])
    // 每条 file_backup 都在对应调用的 tool_exec 之前；pi 先逐个准备整批调用（beforeToolCall）再执行，所以 w1 的备份在 e2 执行之前。
    const order = entries
      .filter((e) => ['file_backup', 'tool_exec'].includes(e.kind))
      .map((e) => (e.kind === 'tool_exec' ? (e.payload as { toolCallId: string }).toolCallId : 'backup'))
    expect(order).toEqual(['backup', 'e1', 'backup', 'e2', 'w1', 'backup', 'e3'])
    expect(stream.invalidEntries).toEqual([])

    // 快照文件：Run 前的内容逐字节相同；目录 0700、文件 0600；只有两份。
    expect(Buffer.compare(await readFile(blobPath(dirs.dataDir, sha256(original))), original)).toBe(0)
    expect(Buffer.compare(await readFile(blobPath(dirs.dataDir, sha256(afterFirst))), afterFirst)).toBe(0)
    expect(await blobFiles(dirs.dataDir)).toEqual([sha256(original), sha256(afterFirst)].map((h) => `${h.slice(0, 2)}/${h}`).sort())
    expect((await stat(join(dirs.dataDir, 'blobs'))).mode & 0o777).toBe(0o700)
    expect((await stat(blobPath(dirs.dataDir, sha256(original)))).mode & 0o777).toBe(0o600)
  })

  it('bash 修改的文件没有 file_backup；超过 10 MiB 的文件记 untracked、不写 blob', { timeout: 60_000 }, async () => {
    const responses = [
      { content: [call('bash', 'b1', { command: 'printf after > script.txt' }), call('write', 'w1', { path: 'big.bin', content: 'small' })] },
      { content: 'done' },
    ]
    // full-access：bash 不经审批、不包裹沙箱（各平台一致）；write 同样不询问。
    const { root, dirs, api, sessionId, stream } = await boot('full-access', responses)
    await writeFile(join(root, 'script.txt'), 'before')
    await writeFile(join(root, 'big.bin'), Buffer.alloc(10 * 1024 * 1024 + 1, 0x61))

    await api.post(apiPaths.sessionMessages(sessionId), { text: 'go' })
    await runEnds(stream, sessionId, 1)

    expect(await readFile(join(root, 'script.txt'), 'utf8')).toBe('after')
    expect(await readFile(join(root, 'big.bin'), 'utf8')).toBe('small')
    const entries = (await api.get(apiPaths.session(sessionId))).body.entries as SessionEntryRecord[]
    expect(ofKind(entries, 'tool_exec').map((e) => (e.payload as { toolCallId: string }).toolCallId)).toEqual(['b1', 'w1'])
    expect(ofKind(entries, 'file_backup').map((e) => e.payload)).toEqual([{ anchorSeq: userSeqs(entries)[0], path: join(root, 'big.bin'), untracked: true }])
    expect(await blobFiles(dirs.dataDir)).toEqual([])
  })

  it('被拒绝审批的 write 不产生 file_backup，文件不存在', { timeout: 60_000 }, async () => {
    const { root, dirs, api, sessionId, stream } = await boot('default', [
      { content: [call('write', 'w1', { path: 'denied.txt', content: 'nope' })] },
      { content: 'never' },
    ])
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'write' })
    const request = await waitApproval(stream, sessionId)
    expect(request).toMatchObject({ toolCallId: 'w1', toolName: 'write' })
    // 等待审批时还没有备份。
    expect(ofKind(stream.entries(sessionId), 'file_backup')).toEqual([])
    expect((await api.post(apiPaths.sessionApproval(sessionId, request.requestId), { decision: 'deny' })).status).toBe(204)
    await runEnds(stream, sessionId, 1)

    const entries = (await api.get(apiPaths.session(sessionId))).body.entries as SessionEntryRecord[]
    expect(entries.at(-1)?.payload).toEqual({ status: 'aborted' })
    expect(ofKind(entries, 'file_backup')).toEqual([])
    expect(ofKind(entries, 'file_change')).toEqual([])
    await expect(stat(join(root, 'denied.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await blobFiles(dirs.dataDir)).toEqual([])
  })
})
