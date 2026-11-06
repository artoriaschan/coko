import { Dialog, DialogClose, DialogContent, DialogTitle } from '@coko/ui'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import type { TimelineItem } from './timeline.ts'
import { useProcessFocusLock } from './process-disclosure.tsx'
import './tool-image-details.css'

type ToolItem = Extract<TimelineItem, { kind: 'tool' }>
const RASTER_IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const BASE64 = /^[A-Za-z0-9+/=\s]+$/
interface ToolImage {
  src: string
  key: string
}
type Dimensions = { width: number; height: number }

/** Keep the existing inline raster/base64 boundary; never fetch a tool-provided URL. */
function imagesOf(content: unknown): ToolImage[] {
  if (!Array.isArray(content)) return []
  const occurrences = new Map<string, number>()
  return content.flatMap((block: unknown) => {
    const b = block as { type?: unknown; data?: unknown; mimeType?: unknown } | null
    if (b?.type !== 'image' || typeof b.data !== 'string' || typeof b.mimeType !== 'string' || !RASTER_IMAGES.has(b.mimeType) || !BASE64.test(b.data)) return []
    const src = `data:${b.mimeType};base64,${b.data.replace(/\s/g, '')}`
    // Source plus occurrence distinguishes duplicate pictures while added text,
    // entry sequences and freshly allocated wire objects leave identity intact.
    const occurrence = occurrences.get(src) ?? 0
    occurrences.set(src, occurrence + 1)
    return [{ src, key: `${src}:${occurrence}` }]
  })
}

/** Tool cards and the trajectory inspector share the same inline-result gallery. */
export function ToolImages({ item }: { item: ToolItem }) {
  const content = item.result !== null ? item.result.content : ((item.live?.result ?? item.live?.partialResult) as { content?: unknown } | undefined)?.content
  return <ToolResultImages content={content} />
}

/** Inline bytes already belong to the Session: data URLs need no Blob lifecycle. */
export function ToolResultImages({ content }: { content: unknown }) {
  const images = React.useMemo(() => imagesOf(content), [content])
  const { t } = useI18n()
  const [sizes, setSizes] = React.useState<Record<string, Dimensions>>({})
  const decoded = React.useCallback((key: string, size: Dimensions) => setSizes((previous) => ({ ...previous, [key]: size })), [])
  React.useEffect(() => {
    const current = new Set(images.map((image) => image.key))
    setSizes((previous) =>
      Object.keys(previous).some((key) => !current.has(key)) ? Object.fromEntries(Object.entries(previous).filter(([key]) => current.has(key))) : previous,
    )
  }, [images])
  if (images.length === 0) return null
  return (
    <div className="tool-image-details" onClick={(event) => event.stopPropagation()}>
      <div className="tool-image-gallery">
        {images.map((image, index) => (
          <ImageTile key={image.key} image={image} index={index} multiple={images.length > 1} onDecoded={decoded} />
        ))}
      </div>
      <div className="tool-image-meta">
        {images.map((image) => (sizes[image.key] ? <div key={image.key}>{t('mcp.image.dimensions', sizes[image.key]!)}</div> : null))}
      </div>
    </div>
  )
}

function ImageTile({
  image,
  index,
  multiple,
  onDecoded,
}: {
  image: ToolImage
  index: number
  multiple: boolean
  onDecoded: (key: string, size: Dimensions) => void
}) {
  const { t } = useI18n()
  const [size, setSize] = React.useState<{ width: number; height: number } | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  useProcessFocusLock(open)
  const opener = React.useRef<HTMLButtonElement>(null)
  const label = t('mcp.image.alt', { index: index + 1 })
  let fit: React.CSSProperties | undefined
  if (!multiple && size) {
    const natural = size.width / size.height
    const ratio = Math.min(4, Math.max(0.25, natural))
    const width = ratio >= 1 ? 240 : 240 * ratio
    const height = ratio >= 1 ? 240 / ratio : 240
    const scale = Math.min(1, size.width / width, size.height / height)
    fit = { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
  }
  return (
    <figure className="tool-image-item">
      <button
        ref={opener}
        type="button"
        data-action="open-image"
        data-tool-image-preview-open={open || undefined}
        className="tool-image-frame rounded-xl focus-ring"
        data-variant={multiple ? 'tile' : 'single'}
        data-failed={failed || undefined}
        aria-label={failed ? `${label}: ${t('mcp.image.failed')}` : `${t('mcp.image.open')}: ${label}`}
        disabled={failed}
        style={fit}
        onClick={() => setOpen(true)}
      >
        {failed ? (
          <span role="status">{t('mcp.image.failed')}</span>
        ) : (
          <img
            data-tool-image
            src={image.src}
            alt={label}
            style={
              size && size.width / size.height < 0.25
                ? { objectPosition: 'center top' }
                : size && size.width / size.height > 4
                  ? { objectPosition: 'left center' }
                  : undefined
            }
            onLoad={(event) => {
              const actual = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }
              setSize(actual)
              onDecoded(image.key, actual)
            }}
            onError={() => setFailed(true)}
          />
        )}
      </button>
      {open && (
        <Dialog open onOpenChange={(value) => !value && setOpen(false)}>
          <DialogContent
            className="tool-image-lightbox translate-x-0 translate-y-0"
            aria-describedby={undefined}
            data-tool-image-dialog
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) setOpen(false)
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              opener.current?.focus()
            }}
          >
            <DialogTitle className="sr-only">{label}</DialogTitle>
            <img className="tool-image-original rounded-lg shadow-prominent" src={image.src} alt={label} />
            <DialogClose className="tool-image-close rounded-round focus-ring" aria-label={t('mcp.image.close')}>
              <svg aria-hidden viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1">
                <path d="m4 4 8 8M12 4l-8 8" />
              </svg>
            </DialogClose>
          </DialogContent>
        </Dialog>
      )}
    </figure>
  )
}
