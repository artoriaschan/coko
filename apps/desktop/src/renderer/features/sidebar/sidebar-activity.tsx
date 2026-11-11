import type { Session } from '@coko/protocol'
import { IconLoader2 } from '@tabler/icons-react'
import { useI18n } from '../../app/i18n.tsx'
import './sidebar-activity.css'

/** A single activity predicate shared by Session rows and collapsed Project rows. */
export function sessionExecuting(session: Session): boolean {
  return session.running || (session.agentsRunning ?? false)
}

export function SidebarActivity({ running }: { running: boolean }) {
  const { t } = useI18n()
  return (
    <span data-sidebar-activity className="pointer-events-none absolute right-2 top-1 flex size-6 items-center justify-center text-muted-foreground">
      <IconLoader2
        role="img"
        aria-label={t(running ? 'sidebar.running' : 'sidebar.backgroundRunning')}
        className="size-3 animate-spin motion-reduce:animate-none"
        stroke={1.1}
      />
    </span>
  )
}
