import type { Session } from '@coko/protocol'
import { LoaderCircleIcon } from 'lucide-react'
import { useI18n } from '../../app/i18n.tsx'
import './sidebar-activity.css'

/** A single activity predicate shared by Session rows and collapsed Project rows. */
export function sessionExecuting(session: Session): boolean {
  return session.running
}

export function SidebarActivity() {
  const { t } = useI18n()
  return (
    <span data-sidebar-activity className="pointer-events-none absolute right-2 top-1 flex size-6 items-center justify-center text-muted-foreground">
      <LoaderCircleIcon role="img" aria-label={t('sidebar.running')} className="size-3 animate-spin motion-reduce:animate-none" strokeWidth={1.1} />
    </span>
  )
}
