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
  Switch,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  cn,
} from '@coko/ui'
import { IconChevronDown, IconFolder, IconMessageCircle, IconPlus, IconX } from '@tabler/icons-react'
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
  const newWorktree = useNewChat((state) => state.newWorktree)
  const configure = useNewChat((state) => state.configure)
  const sending = useNewChat((state) => state.sending)
  const project = projects.find((item) => item.id === projectId)
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const composing = React.useRef(false)
  const searchInput = React.useRef<HTMLInputElement>(null)
  const label = project?.name ?? t('conversation.destinationChat')
  const names = new Map<string, number>()
  for (const item of projects) names.set(item.name, (names.get(item.name) ?? 0) + 1)
  const needle = search.trim().toLocaleLowerCase()
  const matches = projects.filter((item) => item.name.toLocaleLowerCase().includes(needle))
  return (
    <div data-slot="destination-bar" className={cn('flex h-9 items-center px-2', className)}>
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) {
            setSearch('')
            composing.current = false
          }
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
              className="h-7 min-w-0 gap-1.5 rounded-round px-2 has-[>svg]:px-2 [&_svg]:size-3.5"
            >
              {project ? (
                <span
                  aria-hidden
                  className="flex size-6 shrink-0 items-center justify-center group-hover/destination:invisible group-focus-within/destination:invisible"
                >
                  <IconFolder aria-hidden className="size-3.5" stroke={1.1} />
                </span>
              ) : (
                <IconMessageCircle aria-hidden className="size-3.5 shrink-0" stroke={1.1} />
              )}
              <span data-destination-name data-user-content={project ? '' : undefined} className="flex h-7 min-w-0 items-center truncate pb-0.5 text-ui-body">
                {label}
              </span>
              {/* 项目归属的箭头在悬停时让位给清除按钮；视觉稿只保留文件夹/清除图标。 */}
              {!project && <IconChevronDown aria-hidden className="size-3! shrink-0" stroke={1.1} />}
            </Button>
          </DropdownMenuTrigger>
          {project && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t('conversation.destinationClear')}
                  disabled={sending}
                  className="absolute left-2 flex size-6 items-center justify-center rounded-sm opacity-0 focus-ring group-hover/destination:opacity-100 group-focus-within/destination:opacity-100"
                  onClick={() => selectProject(null)}
                >
                  <IconX aria-hidden className="size-3.5" stroke={1.1} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t('conversation.destinationClear')}</TooltipContent>
            </Tooltip>
          )}
        </div>
        <DropdownMenuContent
          onEscapeKeyDown={(event) => {
            if (composing.current || event.isComposing || event.keyCode === 229) event.preventDefault()
          }}
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
              onCompositionStart={() => {
                composing.current = true
              }}
              onCompositionEnd={() => {
                composing.current = false
              }}
              onKeyDown={(event) => {
                if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) {
                  event.stopPropagation()
                  return
                }
                if (event.key === 'ArrowDown') {
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
                  <IconFolder aria-hidden className="size-3.5" stroke={1.1} />
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
              <IconMessageCircle aria-hidden className="size-3.5" stroke={1.1} />
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
                <IconPlus aria-hidden className="size-3.5" stroke={1.1} />
                {t('projectForm.newProject')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* 独立对话没有分支与工作树可配置，右侧设置按钮只在归属项目时出现。 */}
      {project && (
        <ProjectGitMenu
          project={project}
          worktreeSlot={({ available, pending, loading }) => (
            <DropdownMenuItem
              role="switch"
              aria-label={t('worktrees.newWorktree')}
              aria-checked={newWorktree}
              disabled={!available || pending || loading}
              onSelect={(event) => {
                event.preventDefault()
                configure({ newWorktree: !newWorktree, branch: null })
              }}
            >
              <span>{t('worktrees.newWorktree')}</span>
              <Switch aria-hidden tabIndex={-1} checked={newWorktree} disabled={!available || pending || loading} className="pointer-events-none ml-auto" />
            </DropdownMenuItem>
          )}
        />
      )}
    </div>
  )
}
