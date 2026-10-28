// 内容寻址快照存储（ADR 0006）：<dir>/<前 2 位>/<sha256>，目录 0700、文件 0600；先写同目录临时文件、fsync，再改名。
// 只依赖 node:fs 与 node:crypto，不导入 node:sqlite。
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** 单个快照的默认上限：10 MiB。超过时不备份，调用方记为未追踪。 */
export const MAX_BLOB_BYTES = 10 * 1024 * 1024

const SHA256 = /^[0-9a-f]{64}$/

/** 内容超过存储的上限；没有留下任何文件。 */
export class BlobTooLargeError extends Error {
  override readonly name = 'BlobTooLargeError'
  readonly maxBytes: number
  constructor(maxBytes: number) {
    super(`content exceeds the snapshot limit of ${maxBytes} bytes`)
    this.maxBytes = maxBytes
  }
}

export type BlobSource = Uint8Array | AsyncIterable<Uint8Array>

export interface BlobStore {
  /** 快照目录（绝对路径）。 */
  readonly dir: string
  readonly maxBytes: number
  /**
   * 存入内容并返回其 SHA-256（小写十六进制）。同一内容只存一份。Promise 兑现时文件已 fsync 并改名到位；
   * 超过上限时以 BlobTooLargeError 拒绝，来源出错时原样拒绝，两种情况都不留下目标文件或临时文件。
   */
  put(source: BlobSource): Promise<string>
  /** 存入某个文件的当前内容；文件不存在时以 ENOENT 拒绝。 */
  putFile(path: string): Promise<string>
  /** 读回内容；hash 不是 SHA-256 时抛错，不存在时 ENOENT。 */
  read(hash: string): Promise<Buffer>
  has(hash: string): Promise<boolean>
}

export interface BlobStoreOptions {
  /** 默认 MAX_BLOB_BYTES。 */
  maxBytes?: number
}

function checkHash(hash: string): string {
  if (!SHA256.test(hash)) throw new Error('blob reference must be a lowercase SHA-256 hex digest')
  return hash
}

async function* fromSource(source: BlobSource): AsyncIterable<Uint8Array> {
  if (source instanceof Uint8Array) yield source
  else yield* source
}

/** 文件内容的 SHA-256（流式读取，不限大小）。 */
export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false
      throw error
    },
  )

/** 打开（不立即创建）快照目录；第一次写入时创建目录并把权限收紧到 0700。 */
export function openBlobStore(dir: string, options: BlobStoreOptions = {}): BlobStore {
  const maxBytes = options.maxBytes ?? MAX_BLOB_BYTES
  const prepared = new Set<string>()
  /** 目录已存在时 mkdir 不改权限，因此每个目录第一次使用时显式 chmod。 */
  const ensureDir = async (path: string) => {
    if (prepared.has(path)) return
    await mkdir(path, { recursive: true, mode: 0o700 })
    await chmod(path, 0o700)
    prepared.add(path)
  }
  const pathOf = (hash: string) => join(dir, hash.slice(0, 2), hash)

  const put = async (source: BlobSource): Promise<string> => {
    await ensureDir(dir)
    const temp = join(dir, `.tmp-${process.pid}-${randomBytes(8).toString('hex')}`)
    const handle = await open(temp, 'wx', 0o600)
    let closed = false
    try {
      const hash = createHash('sha256')
      let size = 0
      for await (const chunk of fromSource(source)) {
        size += chunk.byteLength
        if (size > maxBytes) throw new BlobTooLargeError(maxBytes)
        hash.update(chunk)
        await handle.write(chunk)
      }
      await handle.sync()
      await handle.close()
      closed = true
      const digest = hash.digest('hex')
      const target = pathOf(digest)
      if (await exists(target)) {
        await rm(temp, { force: true })
        return digest
      }
      await ensureDir(join(dir, digest.slice(0, 2)))
      await rename(temp, target)
      await syncDir(join(dir, digest.slice(0, 2)))
      return digest
    } catch (error) {
      if (!closed) await handle.close().catch(() => undefined)
      await rm(temp, { force: true }).catch(() => undefined)
      throw error
    }
  }

  return {
    dir,
    maxBytes,
    put,
    async putFile(path) {
      // 先打开，使不存在的文件在创建临时文件之前以 ENOENT 失败。
      const handle = await open(path, 'r')
      try {
        return await put(handle.createReadStream({ autoClose: false }))
      } finally {
        await handle.close().catch(() => undefined)
      }
    },
    read: async (hash) => readFile(pathOf(checkHash(hash))),
    has: async (hash) => exists(pathOf(checkHash(hash))),
  }
}

/** 改名之后 fsync 所在目录，使目录项也落盘；不支持目录 fsync 的平台忽略。 */
async function syncDir(path: string): Promise<void> {
  const handle = await open(path, 'r').catch(() => undefined)
  if (!handle) return
  try {
    await handle.sync()
  } catch {
    // 部分文件系统不支持目录 fsync。
  } finally {
    await handle.close()
  }
}
