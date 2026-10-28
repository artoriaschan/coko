// 内容寻址快照存储（ADR 0006）：只经公开接口 openBlobStore 观察目录内容、文件权限与读回字节。
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BlobTooLargeError, hashFile, MAX_BLOB_BYTES, openBlobStore } from './index.ts'

let root: string
let dir: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'coko-blobs-'))
  dir = join(root, 'data', 'blobs')
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')

/** 目录下全部文件（相对路径），含临时文件。 */
async function files(at: string): Promise<string[]> {
  const entries = await readdir(at, { recursive: true, withFileTypes: true }).catch(() => [])
  return entries
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name).slice(at.length + 1))
    .sort()
}

async function* chunks(...parts: (string | Error)[]) {
  for (const part of parts) {
    if (part instanceof Error) throw part
    yield Buffer.from(part)
  }
}

describe('openBlobStore', () => {
  it('按 SHA-256 存放在 <前 2 位>/<sha256>，读回逐字节相同；同一内容只存一份', async () => {
    const store = openBlobStore(dir)
    const content = Buffer.from('hello\u0000world\n')
    const first = await store.put(content)
    const second = await store.put(chunks('hello\u0000', 'world\n'))

    expect(first).toBe(sha256(content))
    expect(second).toBe(first)
    expect(await files(dir)).toEqual([`${first.slice(0, 2)}/${first}`])
    expect(Buffer.compare(await store.read(first), content)).toBe(0)
    expect(await store.has(first)).toBe(true)
    expect(await store.has(sha256('other'))).toBe(false)
  })

  it('目录 0700、文件 0600', async () => {
    const store = openBlobStore(dir)
    const hash = await store.put(Buffer.from('secret-free content'))
    expect((await stat(dir)).mode & 0o777).toBe(0o700)
    expect((await stat(join(dir, hash.slice(0, 2)))).mode & 0o777).toBe(0o700)
    expect((await stat(join(dir, hash.slice(0, 2), hash))).mode & 0o777).toBe(0o600)
  })

  it('写入中途失败：不留下目标文件与临时文件，错误原样抛出', async () => {
    const store = openBlobStore(dir)
    const failure = new Error('source broke')
    await expect(store.put(chunks('partial ', failure))).rejects.toBe(failure)
    expect(await files(dir)).toEqual([])
    expect(await store.has(sha256('partial '))).toBe(false)
  })

  it('超过上限：BlobTooLargeError，不留下任何文件；恰好等于上限可以存', async () => {
    const store = openBlobStore(dir, { maxBytes: 8 })
    await expect(store.put(chunks('12345', '6789'))).rejects.toBeInstanceOf(BlobTooLargeError)
    expect(await files(dir)).toEqual([])
    expect(await store.put(Buffer.from('12345678'))).toBe(sha256('12345678'))
  })

  it('putFile 存入文件内容、hashFile 只计算摘要；默认上限 10 MiB', async () => {
    expect(MAX_BLOB_BYTES).toBe(10 * 1024 * 1024)
    const store = openBlobStore(dir)
    const source = join(root, 'source.bin')
    await writeFile(source, 'file body')
    const hash = await store.putFile(source)
    expect(hash).toBe(sha256('file body'))
    expect(await readFile(join(dir, hash.slice(0, 2), hash), 'utf8')).toBe('file body')
    expect(await hashFile(source)).toBe(hash)
    // 不存在的文件：ENOENT 原样抛出，不留下文件。
    await expect(store.putFile(join(root, 'missing'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await files(dir)).toEqual([`${hash.slice(0, 2)}/${hash}`])
  })

  it('read / has 拒绝不是 SHA-256 的引用（不会越出目录）', async () => {
    const store = openBlobStore(dir)
    await expect(store.read('../../etc/passwd')).rejects.toThrow(/sha-256/i)
    await expect(store.has('ABC')).rejects.toThrow(/sha-256/i)
  })
})
