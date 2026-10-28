// Checkpoint 的宿主端口（ADR 0006）：快照的保存与读取、回退代码时的文件写入。Sidecar 的实现在 apps/server/src/adapters/checkpoints.ts。

/** 快照端口：内容寻址保存文件当前的字节（宿主实现，Sidecar 为 @coko/session/blobs）。 */
export interface SnapshotPort {
  /** 文件不存在为 absent；超过快照上限为 too-large（不保存）；其他失败抛错。 */
  saveFile(path: string): Promise<{ kind: 'stored'; hash: string } | { kind: 'absent' } | { kind: 'too-large' }>
  /** 文件当前内容的 SHA-256；不存在时抛错（ENOENT）。 */
  hashFile(path: string): Promise<string>
}

/** 回退代码的文件端口：当前内容的摘要、快照正文与文件的写入、删除。 */
export interface RewindFiles {
  /** 文件当前内容的 SHA-256；不存在时以 ENOENT 拒绝。 */
  hashFile(path: string): Promise<string>
  /** 快照正文；不存在时拒绝。 */
  readBlob(hash: string): Promise<Uint8Array>
  /**
   * 原子替换文件内容：先写同目录临时文件再 rename（进程中途退出不留半截文件）；父目录不在时创建。路径最后一段是符号链接时
   * 替换链接本身，不写入链接指向的位置。
   */
  writeFile(path: string, bytes: Uint8Array): Promise<void>
  /** 删除文件；已不存在时不报错。 */
  remove(path: string): Promise<void>
}
