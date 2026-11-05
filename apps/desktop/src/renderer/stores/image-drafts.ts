import { Value } from 'typebox/value'
import { FILE_ATTACHMENT_MAX_BYTES, IMAGE_ATTACHMENT_MAX_BYTES, FileAttachment, ImageAttachment } from '@coko/protocol'

export interface DraftImage extends ImageAttachment {
  id: string
}
function isDraftImage(value: unknown): value is DraftImage {
  if (typeof value !== 'object' || value === null || !('id' in value)) return false
  const { id, ...image } = value
  return typeof id === 'string' && Value.Check(ImageAttachment, image)
}
let database: Promise<IDBDatabase> | undefined
function db(): Promise<IDBDatabase> {
  return (database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('coko.image-drafts', 2)
    request.onupgradeneeded = () => {
      for (const name of ['images', 'files']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      database = undefined
      reject(request.error)
    }
  }))
}
async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>, name = 'images'): Promise<T> {
  const database = await db()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(name, mode)
    const request = action(transaction.objectStore(name))
    transaction.oncomplete = () => resolve(request.result)
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}
export const imageDrafts = {
  async save(image: ImageAttachment): Promise<DraftImage> {
    const value = { ...image, id: crypto.randomUUID() }
    await transaction('readwrite', (store) => store.put(value))
    return value
  },
  async load(refs: readonly string[]): Promise<DraftImage[]> {
    const images = await Promise.all(refs.map((id) => transaction<unknown>('readonly', (store) => store.get(id))))
    return images.filter(isDraftImage)
  },
  async remove(refs: readonly string[]): Promise<void> {
    await Promise.all(refs.map((id) => transaction('readwrite', (store) => store.delete(id))))
  },
  refs(key: string): string[] {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(key + '.images') ?? '[]')
      return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
    } catch {
      return []
    }
  },
  remember(key: string, refs: readonly string[]): void {
    if (refs.length) localStorage.setItem(key + '.images', JSON.stringify(refs))
    else localStorage.removeItem(key + '.images')
  },
}
export async function imageFromFile(file: File): Promise<ImageAttachment> {
  if (file.size > IMAGE_ATTACHMENT_MAX_BYTES) throw new Error('image-too-large')
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) throw new Error('image-format')
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
  return { name: file.name, mimeType: file.type as ImageAttachment['mimeType'], data }
}

export type DraftFile = FileAttachment & { id: string }
function isDraftFile(value: unknown): value is DraftFile {
  if (typeof value !== 'object' || value === null || !('id' in value)) return false
  const { id, ...file } = value
  return typeof id === 'string' && Value.Check(FileAttachment, file)
}
export const fileDrafts = {
  async save(file: FileAttachment): Promise<DraftFile> {
    const value = { ...file, id: crypto.randomUUID() }
    await transaction('readwrite', (store) => store.put(value), 'files')
    return value
  },
  async load(refs: readonly string[]): Promise<DraftFile[]> {
    const files = await Promise.all(refs.map((id) => transaction<unknown>('readonly', (store) => store.get(id), 'files')))
    return files.filter(isDraftFile)
  },
  async remove(refs: readonly string[]): Promise<void> {
    await Promise.all(refs.map((id) => transaction('readwrite', (store) => store.delete(id), 'files')))
  },
  refs(key: string): string[] {
    return imageDrafts.refs(key + '.files')
  },
  remember(key: string, refs: readonly string[]): void {
    imageDrafts.remember(key + '.files', refs)
  },
}
export async function attachmentFromFile(file: File, path: string): Promise<FileAttachment> {
  if (file.size > FILE_ATTACHMENT_MAX_BYTES) throw new Error('file-too-large')
  if (path) return { name: file.name, path }
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
  return { name: file.name, data }
}
