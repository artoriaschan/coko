// Checkpoint 快照的宿主适配（ADR 0006）：把 @coko/agent 的 SnapshotPort 接到 <dataDir>/blobs（@coko/session/blobs），
// 回退代码的文件写入以临时文件 + rename 原子替换。
import { randomBytes } from 'node:crypto'
import { chmod, lstat, mkdir, open, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { RewindFiles, SnapshotPort } from '@coko/agent'
import { BlobTooLargeError, hashFile, openBlobStore, type BlobStore } from '@coko/session/blobs'

/** 快照目录：与 coko.db 同在数据目录下（0700，文件 0600）。 */
export const blobsDir = (dataDir: string) => join(dataDir, 'blobs')

/**
 * 文件不存在（或父路径不是目录）记 absent；超过 10 MiB 记 too-large（未追踪，不写 blob）；目标是目录时 write / edit
 * 本身会失败，也记 too-large 而不拦下调用（没有可恢复的文件内容）。其他失败抛出，由 tracker 拦下该调用。
 */
export function createBlobSnapshots(store: BlobStore): SnapshotPort {
  return {
    async saveFile(path) {
      try {
        return { kind: 'stored', hash: await store.putFile(path) }
      } catch (error) {
        if (error instanceof BlobTooLargeError) return { kind: 'too-large' }
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'ENOENT' || code === 'ENOTDIR') return { kind: 'absent' }
        if (code === 'EISDIR') return { kind: 'too-large' }
        throw error
      }
    },
    hashFile,
  }
}

/**
 * 原子替换：在同一目录写临时文件（排他创建）、fsync、按原文件的权限 chmod，再 rename 到目标。rename 替换目录项本身，
 * 目标是符号链接时替换链接而不写入链接指向的位置。失败时删除临时文件。
 */
async function replaceFile(path: string, bytes: Uint8Array): Promise<void> {
  const dir = dirname(path)
  await mkdir(dir, { recursive: true })
  const previous = await lstat(path).catch(() => undefined)
  const mode = previous?.isFile() ? previous.mode & 0o7777 : undefined
  const temp = join(dir, `.${basename(path)}.coko-${randomBytes(6).toString('hex')}`)
  const handle = await open(temp, 'wx', 0o600)
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await chmod(temp, mode ?? 0o644)
    await rename(temp, path)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
}

/** 回退代码的文件端口：摘要与快照正文读 <dataDir>/blobs，写入为原子替换。 */
export function createRewindFiles(dataDir: string, store: BlobStore = openBlobStore(blobsDir(dataDir))): RewindFiles {
  return {
    hashFile,
    readBlob: (hash) => store.read(hash),
    writeFile: replaceFile,
    remove: (path) => rm(path, { force: true }),
  }
}

/** 打开 <dataDir>/blobs：tracker 写快照的端口与回退代码的文件端口；目录在第一次写入时创建。 */
export function openCheckpointStore(dataDir: string): { snapshots: SnapshotPort; files: RewindFiles } {
  const store = openBlobStore(blobsDir(dataDir))
  return { snapshots: createBlobSnapshots(store), files: createRewindFiles(dataDir, store) }
}
