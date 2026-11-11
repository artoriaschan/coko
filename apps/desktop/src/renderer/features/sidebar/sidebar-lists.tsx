import { IconEdit } from '@tabler/icons-react'
import * as React from 'react'
import { IconButton } from '../../app/icon-button.tsx'
import type { SidebarCategory } from '../../stores/list-store.ts'
import type { Project, Session } from '@coko/protocol'
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@coko/ui'
import { IconChevronDown, IconChevronRight, IconPlus, IconDots, IconGripVertical, IconFold, IconSelector } from '@tabler/icons-react'
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { useChat, useChatActions, useChatStoreApi, useLists } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { ProjectRow } from './project-row.tsx'
import { SessionRow } from './session-row.tsx'
import { ProjectDeleteProvider } from '../projects/project-delete-dialog.tsx'

export interface SidebarListsProps {
  onAddWorkspace: () => void
  search: string | null
  onSelect: (id: string) => void
  onNewSession: (workspaceId?: string) => void
}

export const sortSessions = (sessions: readonly Session[]) => sessions.toSorted((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))

const isSidebarCategory = (id: UniqueIdentifier): id is SidebarCategory => id === 'conversations' || id === 'projects'

/** 指针落在分类区域之间或窗口边缘时，仍取最近的分类作为落点。 */
const categoryCollisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  return hits.length > 0 ? hits : closestCenter(args)
}

/** 浮层按手柄抓取点跟随指针：卡片 32px 高，16px 处是卡片垂直中心；与卡片内边距对应。 */
const followPointer: Modifier = ({ transform, activatorEvent, activeNodeRect }) => {
  if (!activeNodeRect || !activatorEvent || !('clientX' in activatorEvent)) return transform
  const pointer = activatorEvent as PointerEvent
  return {
    ...transform,
    x: transform.x + (pointer.clientX - activeNodeRect.left) - 16,
    y: transform.y + (pointer.clientY - activeNodeRect.top) - 16,
  }
}

export function SidebarLists(props: SidebarListsProps) {
  return (
    <ProjectDeleteProvider>
      <SidebarListsContent {...props} />
    </ProjectDeleteProvider>
  )
}

function SidebarListsContent({ onAddWorkspace, onSelect, onNewSession }: SidebarListsProps) {
  const { t } = useI18n()
  const sessions = useLists((state) => state.sessions)
  const projects = useLists((state) => state.projects)
  const status = useLists((state) => state.listStatus)
  const order = useLists((state) => state.categoryOrder)
  const [activeCategory, setActiveCategory] = React.useState<SidebarCategory | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const expanded = useLists((state) => state.categoryExpanded)
  const listActions = useChatStoreApi().lists.getState()
  const projectSort = useLists((state) => state.projectSort)
  const expandedProjects = useLists((state) => state.expandedProjects)
  const counts = useLists((state) => state.visibleCounts)
  const active = useChat((state) => state.activeSessionId)
  const { load } = useChatActions()
  const visible = sortSessions(sessions.filter((session) => session.archivedAt === null && session.pinnedAt === null))
  const standalone = visible.filter((session) => session.projectId === null)
  const pinned = sessions
    .filter((session) => session.archivedAt === null && session.pinnedAt !== null)
    .toSorted((a, b) => b.pinnedAt! - a.pinnedAt! || a.id.localeCompare(b.id))
  const pinnedProjects = projects.filter((project) => project.pinnedAt !== null)
  const pinnedItems = [
    ...pinned.map((session) => ({ kind: 'session' as const, item: session })),
    ...pinnedProjects.map((project) => ({ kind: 'project' as const, item: project })),
  ].toSorted((a, b) => b.item.pinnedAt! - a.item.pinnedAt! || a.item.id.localeCompare(b.item.id))
  const lastUsed = new Map(projects.map((project) => [project.id, project.lastUsedAt]))
  for (const session of sessions) {
    if (session.projectId !== null) lastUsed.set(session.projectId, Math.max(lastUsed.get(session.projectId) ?? 0, session.updatedAt))
  }
  const ordered = projects
    .filter((project) => project.pinnedAt === null)
    .toSorted(
      (a, b) =>
        (projectSort === 'created' ? b.createdAt - a.createdAt : (lastUsed.get(b.id) ?? b.createdAt) - (lastUsed.get(a.id) ?? a.createdAt)) ||
        b.createdAt - a.createdAt ||
        a.id.localeCompare(b.id),
    )
  const shownProjects = ordered
  const anyExpanded = ordered.some((project) => expandedProjects[project.id] ?? true)
  const categoryName = (id: UniqueIdentifier) =>
    id === 'projects' ? t('sidebar.projects') : id === 'conversations' ? t('sidebar.conversations') : t('sidebar.sessions')
  const handleDragStart = (event: DragStartEvent) => {
    if (!isSidebarCategory(event.active.id)) return
    setActiveCategory(event.active.id)
  }
  const handleDragEnd = (event: DragEndEvent) => {
    setActiveCategory(null)
    const { active, over } = event
    if (!over || !isSidebarCategory(active.id) || !isSidebarCategory(over.id) || active.id === over.id) return
    const from = order.indexOf(active.id)
    const to = order.indexOf(over.id)
    if (from < 0 || to < 0) return
    const next = [...order]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved!)
    listActions.reorderCategories(next[0]!)
  }
  React.useEffect(() => {
    if (!activeCategory) return
    const previous = document.body.style.cursor
    document.body.style.cursor = 'grabbing'
    return () => {
      document.body.style.cursor = previous
    }
  }, [activeCategory])
  return (
    <nav
      aria-label={t('sidebar.sessions')}
      aria-busy={status === 'loading' || undefined}
      data-scroll-stable
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pt-4 pb-2"
    >
      {status === 'loading' && (
        <div aria-hidden className="flex flex-col gap-0.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-8 rounded-sm bg-skeleton" />
          ))}
        </div>
      )}
      {status === 'error' && (
        <div className="px-2 text-ui-body text-muted-foreground">
          <p>{t('sidebar.loadFailed')}</p>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            {t('sidebar.retry')}
          </Button>
        </div>
      )}
      {pinnedItems.length > 0 && (
        <section data-category="pinned" className="flex flex-col gap-0.5" aria-labelledby="pinned-heading">
          <SidebarCategoryHeader
            id="pinned-heading"
            name={t('sidebar.pinned')}
            expanded={expanded.pinned ?? true}
            onToggle={() => listActions.toggleCategory('pinned')}
            muted
          />
          {(expanded.pinned ?? true) && (
            <div className="flex flex-col gap-0.5">
              {pinnedItems.map(({ kind, item }) =>
                kind === 'session' ? (
                  <SessionRow key={item.id} session={item} active={active} onSelect={onSelect} pinned />
                ) : (
                  <ProjectTree
                    key={item.id}
                    project={item}
                    sessions={visible.filter((session) => session.projectId === item.id)}
                    active={active}
                    onSelect={onSelect}
                    onNewSession={onNewSession}
                  />
                ),
              )}
            </div>
          )}
        </section>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={categoryCollisionDetection}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        accessibility={{
          screenReaderInstructions: { draggable: t('sidebar.dragInstructions') },
          announcements: {
            onDragStart: ({ active }) => t('sidebar.dragStartAnnouncement', { name: categoryName(active.id) }),
            onDragOver: ({ active, over }) =>
              over ? t('sidebar.dragOverAnnouncement', { name: categoryName(active.id), over: categoryName(over.id) }) : undefined,
            onDragEnd: ({ active, over }) =>
              over && over.id !== active.id ? t('sidebar.dragEndAnnouncement', { name: categoryName(active.id), over: categoryName(over.id) }) : undefined,
            onDragCancel: ({ active }) => t('sidebar.dragCancelAnnouncement', { name: categoryName(active.id) }),
          },
        }}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveCategory(null)}
      >
        {order.map((category) =>
          category === 'conversations' ? (
            <CategorySection
              key="conversations"
              category="conversations"
              headingId="standalone-heading"
              expanded={expanded.conversations ?? true}
              onToggle={() => listActions.toggleCategory('conversations')}
              activeCategory={activeCategory}
              renderActions={(dragHandle) => (
                <>
                  {dragHandle}
                  <IconButton
                    label={t('sidebar.createConversation')}
                    size="icon-xs"
                    className="size-6 rounded-sm [&_svg]:size-3.5"
                    onClick={() => onNewSession()}
                  >
                    <IconEdit aria-hidden className="size-3.5" stroke={1.1} />
                  </IconButton>
                </>
              )}
            >
              {(expanded.conversations ?? true) &&
                (standalone.length === 0 ? (
                  <SidebarEmpty label={t('sidebar.noConversations')} />
                ) : (
                  <>
                    <div className="flex flex-col gap-0.5">
                      {standalone.slice(0, counts.conversations ?? 5).map((session) => (
                        <SessionRow key={session.id} session={session} active={active} onSelect={onSelect} />
                      ))}
                    </div>
                    <ListPaging listKey="conversations" total={standalone.length} />
                  </>
                ))}
            </CategorySection>
          ) : (
            <CategorySection
              key="projects"
              category="projects"
              headingId="projects-heading"
              expanded={expanded.projects ?? true}
              onToggle={() => listActions.toggleCategory('projects')}
              activeCategory={activeCategory}
              renderActions={(dragHandle) => (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="toolbar"
                        size="icon-xs"
                        className="size-6 rounded-sm [&_svg]:size-3.5"
                        aria-label={t(anyExpanded ? 'sidebar.collapseAllProjects' : 'sidebar.expandAllProjects')}
                        onClick={() =>
                          listActions.expandProjects(
                            ordered.map((project) => project.id),
                            !anyExpanded,
                          )
                        }
                      >
                        {anyExpanded ? (
                          <IconFold aria-hidden className="size-3.5" stroke={1.1} />
                        ) : (
                          <IconSelector aria-hidden className="size-3.5" stroke={1.1} />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t(anyExpanded ? 'sidebar.collapseAllProjects' : 'sidebar.expandAllProjects')}</TooltipContent>
                  </Tooltip>
                  {dragHandle}
                  <ProjectSortMenu value={projectSort} onChange={listActions.sortProjects} />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="toolbar"
                        size="icon-xs"
                        className="size-6 rounded-sm [&_svg]:size-3.5"
                        aria-label={t('sidebar.addProject')}
                        onClick={onAddWorkspace}
                      >
                        <IconPlus aria-hidden className="size-3.5" stroke={1.1} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('sidebar.addProject')}</TooltipContent>
                  </Tooltip>
                </>
              )}
            >
              {(expanded.projects ?? true) &&
                (shownProjects.length === 0 ? (
                  <SidebarEmpty label={t('sidebar.noProjects')} />
                ) : (
                  <>
                    <div className="flex flex-col gap-0.5">
                      {shownProjects.slice(0, counts.projects ?? 5).map((project) => (
                        <ProjectTree
                          key={project.id}
                          project={project}
                          sessions={visible.filter((session) => session.projectId === project.id)}
                          active={active}
                          onSelect={onSelect}
                          onNewSession={onNewSession}
                        />
                      ))}
                    </div>
                    <ListPaging listKey="projects" total={shownProjects.length} />
                  </>
                ))}
            </CategorySection>
          ),
        )}
        <DragOverlay
          modifiers={[followPointer]}
          dropAnimation={null}
          // 默认浮层沿用拖拽节点（手柄）的 24px 矩形，这里让卡片按内容宽度展开。
          style={{ width: 'max-content', height: 'max-content' }}
        >
          {activeCategory && <CategoryDragCard category={activeCategory} />}
        </DragOverlay>
      </DndContext>
    </nav>
  )
}

function ProjectTree({
  project,
  sessions,
  active,
  onSelect,
  onNewSession,
}: {
  project: Project
  sessions: Session[]
  active: string | null
  onSelect: (id: string) => void
  onNewSession: (workspaceId?: string) => void
}) {
  const { t } = useI18n()
  const count = useLists((state) => state.visibleCounts[`project:${project.id}`] ?? 5)
  const expanded = useLists((state) => state.expandedProjects[project.id] ?? true)
  return (
    <div data-project-id={project.id} className="flex flex-col gap-0.5">
      <ProjectRow project={project} onNewSession={onNewSession} />
      {expanded &&
        (sessions.length ? (
          <>
            <div className="flex flex-col gap-0.5">
              {sessions.slice(0, count).map((session) => (
                <SessionRow key={session.id} session={session} active={active} onSelect={onSelect} nested />
              ))}
            </div>
            <ListPaging listKey={`project:${project.id}`} total={sessions.length} nested />
          </>
        ) : (
          <SidebarEmpty label={t('sidebar.noConversations')} indent />
        ))}
    </div>
  )
}

/** 分类或项目内的空状态：H32、左对齐；项目内保留前导图标空槽。 */
function SidebarEmpty({ label, indent = false }: { label: string; indent?: boolean }) {
  return (
    <p
      data-slot="sidebar-empty"
      data-indent={indent || undefined}
      className={`flex h-8 items-center text-ui-body text-muted-foreground ${indent ? 'ps-8 pe-2' : 'px-2'}`}
    >
      {label}
    </p>
  )
}

function ListPaging({ listKey, total, nested = false }: { listKey: string; total: number; nested?: boolean }) {
  const { t } = useI18n()
  const count = useLists((state) => state.visibleCounts[listKey] ?? 5)
  const actions = useChatStoreApi().lists.getState()
  if (total <= 5) return null
  return (
    <div className={`flex h-7 items-center gap-5 text-ui-small text-muted-foreground ${nested ? 'ps-8 pe-2' : 'px-2'}`}>
      {count < total && (
        <button type="button" className="focus-ring hover:text-foreground" onClick={() => actions.showMore(listKey)}>
          {t('sidebar.expandList')}
        </button>
      )}
      {count > 5 && (
        <button type="button" className="focus-ring hover:text-foreground" onClick={() => actions.showLess(listKey)}>
          {t('sidebar.collapseList')}
        </button>
      )}
    </div>
  )
}

/** 分类标题的固定布局；右端 actions 按分类规则传入，置顶不传操作。 */
export function SidebarCategoryHeader({
  id,
  name,
  expanded,
  onToggle,
  actions,
  muted = false,
}: {
  id: string
  name: string
  expanded: boolean
  onToggle: () => void
  actions?: React.ReactNode
  muted?: boolean
}) {
  const { t } = useI18n()
  const Arrow = expanded ? IconChevronDown : IconChevronRight
  return (
    <div
      data-category-header
      className="group/category flex h-8 cursor-pointer items-center px-2"
      onClick={(event) => {
        // 整行可切换分类，但右侧操作（新建、排序、拖拽）保持各自功能，不触发切换。
        const target = event.target instanceof Element ? event.target : null
        if (target?.closest('[data-category-toggle]') || target?.closest('[data-category-actions]')) return
        onToggle()
      }}
    >
      <h2 id={id} aria-label={name} className="min-w-0 flex-1 text-ui-body font-medium">
        <button
          type="button"
          data-category-toggle
          aria-label={t(expanded ? 'sidebar.collapseCategory' : 'sidebar.expandCategory', { name })}
          aria-expanded={expanded}
          onClick={onToggle}
          className={`flex max-w-full items-center gap-1 rounded-xs focus-ring ${muted ? 'text-muted-foreground' : ''}`}
        >
          <span data-category-label className="truncate">
            {name}
          </span>
          <Arrow
            aria-hidden
            data-category-arrow
            className={`size-3 shrink-0 ${expanded ? 'opacity-0 group-hover/category:opacity-100 group-focus-within/category:opacity-100' : ''}`}
          />
        </button>
      </h2>
      {actions && (
        <div
          data-category-actions
          onClick={(event) => event.stopPropagation()}
          className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover/category:opacity-100 group-focus-within/category:opacity-100"
        >
          {actions}
        </div>
      )}
    </div>
  )
}

function ProjectSortMenu({ value, onChange }: { value: 'recent' | 'created'; onChange: (value: 'recent' | 'created') => void }) {
  const { t } = useI18n()
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="toolbar" size="icon-xs" className="size-6 rounded-sm [&_svg]:size-3.5" aria-label={t('sidebar.sortProjects')}>
              <IconDots aria-hidden className="size-3.5" stroke={1.1} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t('sidebar.sortProjects')}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(value) => {
            if (value === 'recent' || value === 'created') onChange(value)
          }}
        >
          <DropdownMenuRadioItem value="created">{t('sidebar.byCreated')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="recent">{t('sidebar.byRecent')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type CategoryDragListeners = ReturnType<typeof useDraggable>['listeners']

/**
 * 分类 section 同时是排序项与放置区：手柄是唯一激活入口，section 的矩形用于判断指针落在哪个分类。
 * 不应用 sortable 的位移变换，落点改由蓝色指示线表达，避免整段分类内容跳动。
 */
function CategorySection({
  category,
  headingId,
  expanded,
  onToggle,
  activeCategory,
  renderActions,
  children,
}: {
  category: SidebarCategory
  headingId: string
  expanded: boolean
  onToggle: () => void
  activeCategory: SidebarCategory | null
  renderActions: (dragHandle: React.ReactNode) => React.ReactNode
  children: React.ReactNode
}) {
  const { t } = useI18n()
  const listActions = useChatStoreApi().lists.getState()
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({ id: category })
  const { setNodeRef: setDragRef, listeners } = useDraggable({ id: category })
  return (
    <section
      ref={setDroppableRef}
      data-category={category}
      data-dragging={activeCategory === category || undefined}
      aria-labelledby={headingId}
      className="relative flex flex-col gap-0.5 data-[dragging]:opacity-50"
    >
      {isOver && activeCategory !== null && activeCategory !== category && <CategoryDropIndicator />}
      <SidebarCategoryHeader
        id={headingId}
        name={t(category === 'projects' ? 'sidebar.projects' : 'sidebar.conversations')}
        expanded={expanded}
        onToggle={onToggle}
        actions={renderActions(
          <CategoryDrag category={category} handleRef={setDragRef} listeners={listeners} onMove={(first) => listActions.reorderCategories(first)} />,
        )}
      />
      {children}
    </section>
  )
}

/** 拖到另一分类表示两者交换，指示线画在目标分类的起始边界，即拖动项将要占据的位置。 */
function CategoryDropIndicator() {
  return (
    <div aria-hidden data-category-drop-indicator className="pointer-events-none absolute inset-x-2 -top-1 z-1 h-0.5 rounded-round bg-ring">
      <span className="absolute left-0 top-1/2 size-2 -translate-x-1 -translate-y-1/2 rounded-round bg-popover inset-ring-1 inset-ring-ring" />
    </div>
  )
}

function CategoryDragCard({ category }: { category: SidebarCategory }) {
  const { t } = useI18n()
  return (
    <div data-category-drag-card className="flex h-8 items-center gap-2 rounded-md bg-popover px-3 text-foreground shadow-panel">
      <IconGripVertical aria-hidden className="size-3.5 shrink-0 text-muted-foreground" stroke={1.5} />
      <span className="truncate text-ui-body font-medium">{t(category === 'projects' ? 'sidebar.projects' : 'sidebar.conversations')}</span>
    </div>
  )
}

function CategoryDrag({
  category,
  handleRef,
  listeners,
  onMove,
}: {
  category: SidebarCategory
  handleRef: (node: HTMLElement | null) => void
  listeners: CategoryDragListeners
  onMove: (first: SidebarCategory) => void
}) {
  const { t } = useI18n()
  const label = t('sidebar.dragCategory', { name: t(category === 'projects' ? 'sidebar.projects' : 'sidebar.conversations') })
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          ref={handleRef}
          variant="toolbar"
          size="icon-xs"
          aria-label={label}
          {...listeners}
          className="size-6 cursor-grab rounded-sm active:cursor-grabbing [&_svg]:size-3.5"
          onKeyDown={(event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
            event.preventDefault()
            const handle = event.currentTarget
            onMove(event.key === 'ArrowUp' ? category : category === 'projects' ? 'conversations' : 'projects')
            requestAnimationFrame(() => handle.focus())
          }}
        >
          <IconGripVertical aria-hidden className="size-3.5" stroke={1.1} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
