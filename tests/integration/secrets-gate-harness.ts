// 秘密不外泄总闸的共享 harness（ADR 0004、0007）：唯一标记、回显凭据的模型服务替身、记录响应体的客户端、扫描与落盘位置。
// 原用例在 secrets-gate.test.ts；新的输出通道（MCP、Memory 等）新增 secrets-gate-<channel>.test.ts 复用本文件，不改本文件。
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, onTestFinished } from 'vitest'
import { request, type HttpResult, type Sidecar, type SidecarDirs } from './sidecar-harness.ts'

/** 与真实密钥同形态（sk- 前缀、足够长）的唯一标记。 */
export const marker = (label: string) => `sk-cokogate${label}${randomBytes(12).toString('hex')}`

/** 模型服务替身：把请求带来的 Authorization 原样回显在 400 错误里（真实服务的 "Incorrect API key provided: …"）。 */
export async function echoingModelServer() {
  const server = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: `Incorrect API key provided: ${String(req.headers.authorization ?? '').replace(/^Bearer /, '')}` } }))
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
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
}

/** 记录每个 HTTP 响应体原文的客户端。 */
export function recordingClient(sidecar: Pick<Sidecar, 'port'>, cookie: string, bodies: string[]) {
  const call = async (method: string, path: string, body?: unknown): Promise<HttpResult> => {
    const result = await request(sidecar.port, method, path, { headers: { cookie }, ...(body === undefined ? {} : { body }) })
    bodies.push(typeof result.body === 'string' ? result.body : JSON.stringify(result.body ?? null))
    return result
  }
  return {
    get: (path: string) => call('GET', path),
    post: (path: string, body?: unknown) => call('POST', path, body ?? {}),
    put: (path: string, body: unknown) => call('PUT', path, body),
  }
}

/** 扫描全部通道，返回含明文的位置。 */
export function leaksIn(channels: [string, string | Buffer][], secrets: Record<string, string>): string[] {
  return channels.flatMap(([where, content]) =>
    Object.entries(secrets)
      .filter(([, secret]) => content.includes(secret))
      .map(([label]) => `${where} contains ${label}`),
  )
}

/** 目录下的全部文件（递归，含 blobs/ 下的快照），name 为相对路径。 */
export async function readDir(dir: string): Promise<{ name: string; bytes: Buffer }[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => [])
  const files = entries.filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name))
  return Promise.all(files.map(async (path) => ({ name: path.slice(dir.length + 1), bytes: await readFile(path) })))
}

/**
 * 落盘位置：库文件（含 -wal、-shm）、快照目录（<dataDir>/blobs）与日志目录（含轮转文件）。includeCokoHome 时一并扫描临时 COKO_HOME
 * （Memory、指令等写入用户级目录的通道）。
 */
export async function persisted(dirs: SidecarDirs, options: { includeCokoHome?: boolean } = {}) {
  const files = [...(await readDir(dirs.dataDir)), ...(await readDir(dirs.logDir))]
  if (options.includeCokoHome) files.push(...(await readDir(dirs.cokoHome)).map((f) => ({ ...f, name: `coko-home/${f.name}` })))
  expect(files.some((f) => f.name === 'coko.db')).toBe(true)
  expect(files.some((f) => f.name === 'sidecar.jsonl')).toBe(true)
  return files
}
