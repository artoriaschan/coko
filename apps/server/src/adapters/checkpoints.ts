// Checkpoint 快照的宿主适配（ADR 0006）：把 @coko/agent 的 SnapshotPort 接到 <dataDir>/blobs（@coko/session/blobs）。
import { join } from 'node:path'
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

/** 打开 <dataDir>/blobs：tracker 写快照的端口与回退代码读快照正文的端口；目录在第一次写入时创建。 */
export function openCheckpointStore(dataDir: string): { snapshots: SnapshotPort; files: RewindFiles } {
  const store = openBlobStore(blobsDir(dataDir))
  return { snapshots: createBlobSnapshots(store), files: { hashFile, readBlob: (hash) => store.read(hash) } }
}
