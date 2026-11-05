import { randomUUID } from 'node:crypto'
import { mkdir, open, rm, rmdir, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import { FILE_ATTACHMENT_MAX_BYTES, IMAGE_ATTACHMENT_MAX_BYTES, type AttachmentReference, type FileAttachment, type ImageAttachment } from '@coko/protocol'
import { AppError } from './errors.ts'

/** Copies are owned by their Session. Preparation is rolled back unless its message is accepted. */
export class AttachmentStore {
  readonly root: string
  constructor(root: string) {
    this.root = root
  }
  directory(sessionId: string): string {
    return join(this.root, encodeURIComponent(sessionId))
  }
  async prepare(
    sessionId: string,
    images: readonly ImageAttachment[],
    files: readonly FileAttachment[],
  ): Promise<{ references: AttachmentReference[]; rollback(): Promise<void> }> {
    const directory = this.directory(sessionId)
    const references: AttachmentReference[] = []
    const rollback = async () => {
      await Promise.all(references.map(({ path }) => rm(path, { force: true })))
      await rmdir(directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') throw error
      })
    }
    if (!images.length && !files.length) return { references, rollback: async () => {} }
    try {
      await mkdir(directory, { recursive: true })
      for (const file of [...images, ...files]) {
        const name =
          Array.from(basename(file.name.replace(/\\/g, '/')))
            .filter((character) => character.charCodeAt(0) >= 32)
            .join('') || 'attachment'
        const path = join(directory, `${randomUUID()}-${name}`)
        references.push({ name, path })
        if ('data' in file) {
          const bytes = Buffer.from(file.data, 'base64')
          const limit = 'mimeType' in file ? IMAGE_ATTACHMENT_MAX_BYTES : FILE_ATTACHMENT_MAX_BYTES
          if (bytes.length > limit || bytes.toString('base64') !== file.data)
            throw new AppError('bad-request', `Attachment exceeds the ${'mimeType' in file ? '4.5' : '32'} MB limit or has invalid bytes`)
          await writeFile(path, bytes, { flag: 'wx', mode: 0o600 })
        } else {
          if (!isAbsolute(file.path)) throw new AppError('bad-request', 'Attachment path must be absolute')
          const source = await open(file.path, 'r')
          try {
            const info = await source.stat()
            if (!info.isFile()) throw new AppError('bad-request', 'Attachment must be a file')
            if (info.size > FILE_ATTACHMENT_MAX_BYTES) throw new AppError('bad-request', 'Attachment exceeds the 32 MB limit')
            const output = await open(path, 'wx', 0o600)
            try {
              const buffer = Buffer.alloc(64 * 1024)
              let total = 0
              while (true) {
                const { bytesRead } = await source.read(buffer)
                if (!bytesRead) break
                total += bytesRead
                if (total > FILE_ATTACHMENT_MAX_BYTES) throw new AppError('bad-request', 'Attachment exceeds the 32 MB limit')
                await output.writeFile(buffer.subarray(0, bytesRead))
              }
            } finally {
              await output.close()
            }
          } finally {
            await source.close()
          }
        }
      }
      return { references, rollback }
    } catch (error) {
      await rollback()
      if (error instanceof AppError) throw error
      throw new AppError('bad-request', 'Could not copy attachment; the message was not sent')
    }
  }
}
