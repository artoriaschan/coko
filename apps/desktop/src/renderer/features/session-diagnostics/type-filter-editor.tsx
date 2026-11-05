// Adapted from DeepSeek Harness (MIT), Copyright (c) 2026 DeepSeek.
import { Button, Input, Popover, PopoverContent, PopoverTrigger } from '@coko/ui'
import { FilterIcon } from 'lucide-react'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'

/** Draft-only editor; the caller owns confirmed filtering and the complete candidate source. */
export function TypeFilterEditor({
  value,
  suggest,
  apply,
}: {
  value: string
  suggest: (query: string) => Promise<readonly string[]>
  apply: (query: string) => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState(value)
  const [active, setActive] = React.useState(-1)
  const [result, setResult] = React.useState<{ query: string; source: typeof suggest; items: readonly string[] }>()
  const [panel, setPanel] = React.useState<HTMLDivElement | null>(null)
  const input = React.useRef<HTMLInputElement>(null)
  const id = React.useId()
  const current = result?.query === draft && result.source === suggest ? result : undefined
  const items = current?.items ?? []
  const selected = active >= 0 && active < items.length ? active : -1
  const commit = (query: string) => {
    apply(query)
    setOpen(false)
  }
  React.useEffect(() => {
    if (!open) return
    let current = true
    setResult(undefined)
    setActive(-1)
    void suggest(draft).then((items) => {
      if (current) setResult({ query: draft, source: suggest, items })
    })
    return () => {
      current = false
    }
  }, [open, draft, suggest])
  React.useEffect(() => {
    if (!open || !panel) return
    // Radix measures its portaled content offscreen before positioning. Wait for the
    // actual positioned rectangle, then focus without moving the table's scrollport.
    let frame: number
    const focusWhenPositioned = () => {
      const rect = panel.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight + 1) {
        input.current?.focus({ preventScroll: true })
        input.current?.select()
      } else frame = requestAnimationFrame(focusWhenPositioned)
    }
    frame = requestAnimationFrame(focusWhenPositioned)
    const blur = () => setOpen(false)
    window.addEventListener('blur', blur)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('blur', blur)
    }
  }, [open, panel])
  React.useEffect(() => {
    if (selected >= 0) panel?.querySelectorAll<HTMLElement>('[role="option"]')[selected]?.scrollIntoView({ block: 'nearest' })
  }, [selected, panel])
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setDraft(value)
          setResult(undefined)
          setActive(-1)
        }
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex size-5 items-center justify-center rounded-xs focus-ring hover:bg-muted"
          aria-label={t('diagnostics.filter.title')}
          aria-pressed={value !== ''}
        >
          <FilterIcon className="size-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        ref={setPanel}
        role="dialog"
        aria-label={t('diagnostics.filter.title')}
        align="start"
        updatePositionStrategy="always"
        className="max-h-(--radix-popover-content-available-height) overflow-y-auto"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          // oxlint-disable-next-line typescript/no-deprecated -- IME confirmation can report 229 after composition ends.
          if (event.isComposing || event.keyCode === 229) event.preventDefault()
        }}
      >
        <Input
          ref={input}
          role="combobox"
          aria-label={t('diagnostics.filter.input')}
          aria-autocomplete="list"
          aria-expanded
          aria-controls={`${id}-types`}
          aria-activedescendant={selected < 0 ? undefined : `${id}-option-${selected}`}
          value={draft}
          placeholder={t('diagnostics.filter.placeholder')}
          onChange={(event) => {
            setDraft(event.currentTarget.value)
            setActive(-1)
          }}
          onKeyDown={(event) => {
            // oxlint-disable-next-line typescript/no-deprecated -- IME confirmation can report 229 after composition ends.
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              setActive(
                items.length === 0
                  ? -1
                  : selected < 0
                    ? event.key === 'ArrowDown'
                      ? 0
                      : items.length - 1
                    : (selected + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length,
              )
            } else if (event.key === 'Enter') {
              event.preventDefault()
              commit(items[selected] ?? draft)
            }
          }}
        />
        <p className="py-2 text-ui-small text-muted-foreground">{t('diagnostics.filter.help')}</p>
        <div
          id={`${id}-types`}
          role="listbox"
          aria-label={t('diagnostics.filter.candidates')}
          aria-busy={current === undefined}
          className="max-h-48 overflow-y-auto"
        >
          {items.map((type, index) => (
            <button
              key={type}
              id={`${id}-option-${index}`}
              type="button"
              role="option"
              aria-selected={selected === index}
              tabIndex={-1}
              className="block h-8 w-full truncate rounded-md px-2 text-start text-ui-body hover:bg-accent aria-selected:bg-accent"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => commit(type)}
            >
              {type}
            </button>
          ))}
        </div>
        {current !== undefined && items.length === 0 && (
          <p role="status" className="py-2 text-ui-small text-muted-foreground">
            {t('diagnostics.filter.noCandidates')}
          </p>
        )}
        <div className="mt-2 flex flex-wrap justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft('')
              setActive(-1)
              input.current?.focus()
            }}
          >
            {t('diagnostics.filter.clear')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            {t('diagnostics.filter.cancel')}
          </Button>
          <Button size="sm" onClick={() => commit(draft)}>
            {t('diagnostics.filter.apply')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
