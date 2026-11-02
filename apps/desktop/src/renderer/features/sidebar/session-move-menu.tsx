import * as React from 'react'
import type { Session } from '@coko/protocol'
import {
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuStackedSubContent,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  Input,
  toast,
} from '@coko/ui'
import { FolderClosedIcon, FolderInputIcon, FolderMinusIcon, FolderPlusIcon } from 'lucide-react'
import { useChatStoreApi, useLists } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { useCreateProject } from '../projects/project-dialogs.tsx'
import { SessionMenuIcon } from './session-menu.tsx'

/** The completion closure captures the source identity before menus or source rows unmount. */
export function SessionMoveMenu({ session, close }: { session: Session; close: () => void }) {
  const { t } = useI18n()
  const lists = useChatStoreApi().lists
  const projects = useLists((state) => state.projects)
  const createProject = useCreateProject()
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const trigger = React.useRef<HTMLDivElement>(null)
  const names = new Map<string, number>()
  for (const project of projects) names.set(project.name, (names.get(project.name) ?? 0) + 1)
  const matches = projects.filter((project) => project.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const move = async (id: string, projectId: string | null, created = false) => {
    if (!(await lists.getState().moveSession(id, projectId))) toast.error(t(created ? 'sidebar.moveCreatedFailed' : 'sidebar.moveFailed'))
  }
  return (
    <DropdownMenuSub
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setSearch('')
      }}
    >
      <DropdownMenuSubTrigger ref={trigger}>
        <SessionMenuIcon>
          <FolderInputIcon aria-hidden className="size-3.5" strokeWidth={1.1} />
        </SessionMenuIcon>
        {t('sidebar.moveToProject')}
      </DropdownMenuSubTrigger>
      <DropdownMenuStackedSubContent
        aria-label={t('sidebar.moveToProject')}
        aria-labelledby={undefined}
        collisionPadding={8}
        className="w-70 max-w-(--radix-dropdown-menu-content-available-width) max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto"
        onEscapeKeyDown={(event) => {
          if (!open) return
          event.preventDefault()
          setOpen(false)
          requestAnimationFrame(() => trigger.current?.focus())
        }}
      >
        <div className="p-1">
          <Input
            autoFocus
            aria-label={t('conversation.destinationSearch')}
            placeholder={t('conversation.destinationSearch')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' && !event.nativeEvent.isComposing) {
                event.preventDefault()
                event.currentTarget.closest('[role="menu"]')?.querySelector<HTMLElement>('[role="menuitemradio"]')?.focus()
              }
              if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation()
            }}
          />
        </div>
        <DropdownMenuRadioGroup
          value={session.projectId ?? ''}
          onValueChange={(projectId) => {
            close()
            void move(session.id, projectId)
          }}
        >
          {matches.map((project) => {
            const folder = project.folders
              .find((folder) => folder.primary)
              ?.path.split('/')
              .filter(Boolean)
              .at(-1)
            return (
              <DropdownMenuRadioItem key={project.id} value={project.id} indicatorAlign="end">
                <FolderClosedIcon aria-hidden className="size-3.5" strokeWidth={1.1} />
                <span data-user-content className="min-w-0 truncate">
                  {project.name}
                  {(names.get(project.name) ?? 0) > 1 && folder && <span className="text-muted-foreground"> · {folder}</span>}
                </span>
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
        {matches.length === 0 && (
          <p role="status" className="px-2 py-2 text-ui-body text-muted-foreground">
            {t('conversation.destinationEmpty')}
          </p>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!createProject}
          onSelect={() => {
            const sourceId = session.id
            close()
            requestAnimationFrame(() =>
              createProject?.({
                onComplete: (project, status) => {
                  void move(sourceId, project.id, status === 'created')
                },
              }),
            )
          }}
        >
          <FolderPlusIcon aria-hidden className="size-3.5" strokeWidth={1.1} />
          {t('sidebar.chooseProjectFolder')}
        </DropdownMenuItem>
        {session.projectId !== null && (
          <DropdownMenuItem
            onSelect={() => {
              close()
              void move(session.id, null)
            }}
          >
            <FolderMinusIcon aria-hidden className="size-3.5" strokeWidth={1.1} />
            {t('sidebar.moveOutOfProject')}
          </DropdownMenuItem>
        )}
      </DropdownMenuStackedSubContent>
    </DropdownMenuSub>
  )
}
