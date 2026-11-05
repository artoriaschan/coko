import type { RunEntry } from '@coko/agent'
import { attachmentReferenceFromText, attachmentReferenceText } from '@coko/protocol'
import { randomUUID } from 'node:crypto'
import { mkdir, open, realpath, rm, rmdir } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
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
  /** Forks own their copies so deleting the source Session cannot invalidate inherited history. */
  async fork(sessionId: string, entries: readonly RunEntry[]): Promise<{ entries: RunEntry[]; rollback(): Promise<void> }> {
    const references = new Map<string, AttachmentReference>()
    for (const entry of entries) {
      if (entry.kind !== 'message' || entry.payload.role !== 'user' || !Array.isArray(entry.payload.content)) continue
      for (const block of entry.payload.content) {
        if (block.type !== 'text') continue
        const reference = attachmentReferenceFromText(block.text)
        if (!reference) continue
        const within = (root: string, path: string) => {
          const rel = relative(root, path)
          return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel)
        }
        // A user-typed marker must never turn an unrelated local path into an implicit upload.
        if (!within(this.root, reference.path)) continue
        const [root, path] = await Promise.all([realpath(this.root), realpath(reference.path)])
        if (!within(root, path)) throw new AppError('bad-request', 'A copied attachment is outside attachment storage')
        references.set(reference.path, { name: reference.name, path })
      }
    }
    const sourcePaths = [...references.keys()]
    const prepared = await this.prepare(sessionId, [], [...references.values()])
    const copied = new Map(sourcePaths.map((path, index) => [path, prepared.references[index]!]))
    return {
      rollback: prepared.rollback,
      entries: entries.map((entry) => {
        if (entry.kind !== 'message' || entry.payload.role !== 'user' || !Array.isArray(entry.payload.content)) return entry
        return {
          ...entry,
          payload: {
            ...entry.payload,
            content: entry.payload.content.map((block) => {
              const reference = block.type === 'text' ? attachmentReferenceFromText(block.text) : undefined
              const replacement = reference && copied.get(reference.path)
              return replacement ? { type: 'text' as const, text: attachmentReferenceText(replacement) } : block
            }),
          },
        }
      }),
    }
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
        if ('data' in file) {
          const bytes = Buffer.from(file.data, 'base64')
          const limit = 'mimeType' in file ? IMAGE_ATTACHMENT_MAX_BYTES : FILE_ATTACHMENT_MAX_BYTES
          if (bytes.length > limit || bytes.toString('base64') !== file.data)
            throw new AppError('bad-request', `Attachment exceeds the ${'mimeType' in file ? '4.5' : '32'} MB limit or has invalid bytes`)
          const output = await open(path, 'wx', 0o600)
          references.push({ name, path })
          try {
            await output.writeFile(bytes)
          } finally {
            await output.close()
          }
        } else {
          if (!isAbsolute(file.path)) throw new AppError('bad-request', 'Attachment path must be absolute')
          const source = await open(file.path, 'r')
          try {
            const info = await source.stat()
            if (!info.isFile()) throw new AppError('bad-request', 'Attachment must be a file')
            if (info.size > FILE_ATTACHMENT_MAX_BYTES) throw new AppError('bad-request', 'Attachment exceeds the 32 MB limit')
            const output = await open(path, 'wx', 0o600)
            references.push({ name, path })
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
