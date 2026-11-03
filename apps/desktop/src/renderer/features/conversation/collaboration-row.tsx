import * as React from 'react'
import { ChevronDownIcon } from 'lucide-react'
import './collaboration-rows.css'

/** Coko-specific facts use the same compact 14/24 disclosure geometry as process rows. */
export function CollaborationRow({
  icon,
  label,
  triggerLabel,
  children,
  className,
  ...props
}: React.ComponentProps<'div'> & { icon: React.ReactNode; label: React.ReactNode; triggerLabel?: string }) {
  const [open, setOpen] = React.useState(false)
  const id = React.useId()
  return (
    <div {...props} className={`conversation-collaboration-row ${className ?? ''}`}>
      <button
        type="button"
        className="conversation-collaboration-trigger focus-ring"
        aria-label={triggerLabel}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <span className="conversation-collaboration-icon">{icon}</span>
        <span className="conversation-collaboration-label">{label}</span>
        <ChevronDownIcon aria-hidden className="conversation-collaboration-chevron" />
      </button>
      {open && (
        <div id={id} className="conversation-collaboration-body">
          {children}
        </div>
      )}
    </div>
  )
}
