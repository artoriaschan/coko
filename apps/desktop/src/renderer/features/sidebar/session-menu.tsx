import type * as React from 'react'
import { DropdownMenuItem, DropdownMenuSeparator, RowMenu, type RowMenuPoint } from '@coko/ui'
import { PencilIcon, PinIcon, PinOffIcon } from 'lucide-react'
import type { Session } from '@coko/protocol'
import { useI18n } from '../../app/i18n.tsx'

/** Later lifecycle operations fill their named position without reordering the common menu. */
export interface SessionMenuSlots {
  archive?: React.ReactNode
  moveToProject?: React.ReactNode
  delete?: React.ReactNode
}

export function SessionMenu({
  session,
  open,
  onOpenChange,
  point,
  onRename,
  onPin,
  pending,
  onCloseAutoFocus,
  slots = {},
}: {
  session: Session
  open: boolean
  onOpenChange: (open: boolean) => void
  point: RowMenuPoint | null
  onRename: () => void
  onPin: () => void
  pending: boolean
  onCloseAutoFocus: (event: Event) => void
  slots?: SessionMenuSlots
}) {
  const { t } = useI18n()
  const Pin = session.pinnedAt === null ? PinIcon : PinOffIcon
  return (
    <RowMenu open={open} onOpenChange={onOpenChange} point={point} label={t('sidebar.conversationActions')} onCloseAutoFocus={onCloseAutoFocus}>
      <DropdownMenuItem onSelect={onRename}>
        <SessionMenuIcon>
          <PencilIcon aria-hidden className="size-3.5" strokeWidth={1.1} />
        </SessionMenuIcon>
        {t('sidebar.rename')}
      </DropdownMenuItem>
      <DropdownMenuItem disabled={pending} onSelect={onPin}>
        <SessionMenuIcon>
          <Pin aria-hidden className="size-3.5 rotate-45" strokeWidth={1.1} />
        </SessionMenuIcon>
        {t(session.pinnedAt === null ? 'sidebar.pinConversation' : 'sidebar.unpinConversation')}
      </DropdownMenuItem>
      {slots.archive}
      {slots.moveToProject}
      {slots.delete && (
        <>
          <DropdownMenuSeparator />
          {slots.delete}
        </>
      )}
    </RowMenu>
  )
}

export function SessionMenuIcon({ children }: { children: React.ReactNode }) {
  return (
    <span data-session-menu-icon className="flex size-3.5 shrink-0 items-center justify-center">
      {children}
    </span>
  )
}
