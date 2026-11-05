/** A persisted, copied upload. The marker is a text block so model history keeps the readable path. */
export interface AttachmentReference {
  name: string
  path: string
}
export function attachmentReferenceText(reference: AttachmentReference): string {
  return `<coko_attachment>${JSON.stringify(reference)}</coko_attachment>`
}
export function attachmentReferenceFromText(text: string): AttachmentReference | undefined {
  if (!text.startsWith('<coko_attachment>') || !text.endsWith('</coko_attachment>')) return undefined
  try {
    const value: unknown = JSON.parse(text.slice(17, -18))
    if (typeof value === 'object' && value !== null && 'name' in value && 'path' in value && typeof value.name === 'string' && typeof value.path === 'string')
      return { name: value.name, path: value.path }
  } catch {
    /* Not a generated attachment block. */
  }
  return undefined
}
