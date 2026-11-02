import * as React from 'react'
import { Input } from './input.tsx'

/** Mount to begin editing. Failures keep the draft; the consumer supplies localized feedback. */
export function InlineRename({
  value,
  label,
  maxLength,
  onSave,
  onComplete,
  className,
}: {
  value: string
  label: string
  maxLength: number
  onSave: (value: string) => Promise<boolean>
  onComplete: () => void
  className?: string
}) {
  const [draft, setDraft] = React.useState(value)
  const [pending, setPending] = React.useState(false)
  const input = React.useRef<HTMLInputElement>(null)
  const busy = React.useRef(false)
  const completed = React.useRef(false)
  React.useLayoutEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  function complete() {
    completed.current = true
    onComplete()
  }
  async function save() {
    if (busy.current || completed.current) return
    const title = draft.trim()
    if (!title || title === value.trim()) return complete()
    busy.current = true
    setPending(true)
    try {
      if (await onSave(title)) complete()
      else input.current?.focus()
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  return (
    <Input
      ref={input}
      aria-label={label}
      aria-busy={pending}
      className={className}
      value={draft}
      maxLength={maxLength}
      readOnly={pending}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => void save()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Escape' && !busy.current) {
          event.preventDefault()
          complete()
        } else if (event.key === 'Enter') {
          event.preventDefault()
          void save()
        }
      }}
    />
  )
}
