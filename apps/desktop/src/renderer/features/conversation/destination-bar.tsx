import { ProjectGitMenu } from './project-git-menu.tsx'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  cn,
} from '@coko/ui'
import { ChevronDownIcon, FolderClosedIcon, MessageCircleIcon, PlusIcon, XIcon } from 'lucide-react'
import * as React from 'react'
import { useLists, useNewChat } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { useCreateProject } from '../projects/project-dialogs.tsx'

/** 只配置尚未创建的 Session；已有 Session 的工作目录不会经此入口改变。 */
export function DestinationBar({ className }: { className?: string }) {
  const { t } = useI18n()
  const createProject = useCreateProject()
  const projects = useLists((state) => state.projects)
  const projectId = useNewChat((state) => state.projectId)
  const selectProject = useNewChat((state) => state.selectProject)
  const sending = useNewChat((state) => state.sending)
  const project = projects.find((item) => item.id === projectId)
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const searchInput = React.useRef<HTMLInputElement>(null)
  const label = project?.name ?? t('conversation.destinationChat')
  const names = new Map<string, number>()
  for (const item of projects) names.set(item.name, (names.get(item.name) ?? 0) + 1)
  const needle = search.trim().toLocaleLowerCase()
  const matches = projects.filter((item) => item.name.toLocaleLowerCase().includes(needle))
  return (
    <div data-slot="destination-bar" className={cn('mb-2 flex h-7 items-center', className)}>
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) setSearch('')
        }}
      >
        <div data-destination-control className="group/destination relative flex h-7 min-w-0 max-w-full items-center">
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="toolbar"
              size="sm"
              disabled={sending}
              aria-label={t('conversation.destinationCurrent', { name: label })}
              className="h-7 min-w-0 gap-1.5 px-2 has-[>svg]:px-2 [&_svg]:size-3.5"
            >
              {project ? (
                <FolderClosedIcon
                  aria-hidden
                  className="size-3.5 shrink-0 group-hover/destination:invisible group-focus-within/destination:invisible"
                  strokeWidth={1.1}
                />
              ) : (
                <MessageCircleIcon aria-hidden className="size-3.5 shrink-0" strokeWidth={1.1} />
              )}
              <span data-destination-name data-user-content={project ? '' : undefined} className="flex h-7 min-w-0 items-center truncate pb-0.5 text-ui-body">
                {label}
              </span>
              <ChevronDownIcon aria-hidden className="size-3! shrink-0" strokeWidth={1.1} />
            </Button>
          </DropdownMenuTrigger>
          {project && (
            <button
              type="button"
              aria-label={t('conversation.destinationClear')}
              disabled={sending}
              className="absolute left-1 flex size-6 items-center justify-center rounded-sm opacity-0 focus-ring hover:bg-accent group-hover/destination:opacity-100 group-focus-within/destination:opacity-100"
              onClick={() => selectProject(null)}
            >
              <XIcon aria-hidden className="size-3.5" strokeWidth={1.1} />
            </button>
          )}
        </div>
        <DropdownMenuContent
          side="top"
          sideOffset={6}
          align="start"
          aria-label={t('conversation.destination')}
          aria-labelledby={undefined}
          className="w-70 max-w-[calc(100vw-16px)]"
        >
          <div className="p-1">
            <Input
              ref={searchInput}
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
          <DropdownMenuRadioGroup value={projectId ?? ''} onValueChange={(value) => selectProject(value || null)}>
            {matches.map((item) => {
              const folder = item.folders
                .find((folder) => folder.primary)
                ?.path.split('/')
                .filter(Boolean)
                .at(-1)
              return (
                <DropdownMenuRadioItem key={item.id} value={item.id} indicatorAlign="end">
                  <FolderClosedIcon aria-hidden className="size-3.5" strokeWidth={1.1} />
                  <span data-user-content className="min-w-0 truncate">
                    {item.name}
                    {(names.get(item.name) ?? 0) > 1 && folder && <span className="text-muted-foreground"> · {folder}</span>}
                  </span>
                </DropdownMenuRadioItem>
              )
            })}
            {matches.length === 0 && (
              <p role="status" className="px-2 py-2 text-ui-body text-muted-foreground">
                {t('conversation.destinationEmpty')}
              </p>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuRadioItem value="" indicatorAlign="end">
              <MessageCircleIcon aria-hidden className="size-3.5" strokeWidth={1.1} />
              {t('conversation.destinationNone')}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          {createProject && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  setOpen(false)
                  // 等菜单释放焦点约束后再打开模态表单。
                  requestAnimationFrame(() => createProject({ onComplete: (created) => selectProject(created.id) }))
                }}
              >
                <PlusIcon aria-hidden className="size-3.5" strokeWidth={1.1} />
                {t('projectForm.newProject')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ProjectGitMenu project={project} />
    </div>
  )
}
