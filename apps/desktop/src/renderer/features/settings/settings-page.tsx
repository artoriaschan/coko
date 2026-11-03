import { createTranslator } from '@coko/i18n'
import { cn } from '@coko/ui'
import { ArrowLeftIcon, SearchIcon } from 'lucide-react'
import * as React from 'react'
import type { Theme } from '../../app/appearance-store.ts'
import { useI18n } from '../../app/i18n.tsx'
import { useSettingsPage } from '../../app/settings.tsx'
import { navigationGroups, resolveSection, type SettingsNavigationGroup } from './sections.ts'

const navRow =
  'flex h-8 min-w-0 shrink-0 items-center gap-2 rounded-md px-2 text-left text-ui-body focus-ring hover:bg-accent aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium aria-[current=page]:text-sidebar-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground aria-[current=page]:[&_svg]:text-foreground'

const english = createTranslator('en')

/** 按菜单项名称过滤：匹配当前语言与英文名称，不区分大小写；没有菜单项的分类随之隐藏。 */
function filterGroups(groups: SettingsNavigationGroup[], query: string, label: (key: SettingsNavigationGroup['sections'][number]['label']) => string) {
  const needle = query.trim().toLowerCase()
  if (needle === '') return groups
  return groups
    .map((group) => ({
      ...group,
      sections: group.sections.filter((s) => [label(s.label), english(s.label)].some((name) => name.toLowerCase().includes(needle))),
    }))
    .filter((group) => group.sections.length > 0)
}

/**
 * 整页设置（规格 2.1）：左侧 240px 设置导航（48px 窗口控制安全区、“返回应用”、“搜索设置…”与分类菜单），右侧居中、最宽 800px 的详情。
 * 分区来自注册表（sections.ts），未交付的分区与空分类不显示，无分类的分区（关于）在菜单最底部。只在显示时挂载，搜索词随之重置。
 * 窄窗口下导航移到详情上方，菜单横排，分类标题只保留为分组的无障碍名称。
 */
export function SettingsPage({ theme }: { theme: Theme }) {
  const { visible } = useSettingsPage()
  return visible ? <SettingsPageContent theme={theme} /> : null
}

function SettingsPageContent({ theme }: { theme: Theme }) {
  const { t } = useI18n()
  const { section, setSection, back } = useSettingsPage()
  const current = resolveSection(section)
  const Current = current.Component
  const titleId = React.useId()
  const [query, setQuery] = React.useState('')
  const navRef = React.useRef<HTMLElement>(null)
  const groups = filterGroups(navigationGroups(), query, t)

  // 打开时焦点进入设置导航的当前项（应用已 inert，焦点不能留在其中）。
  React.useLayoutEffect(() => {
    navRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus()
  }, [])

  return (
    <section aria-labelledby={titleId} data-settings-page className="absolute inset-0 z-10 flex flex-col bg-background text-foreground sm:flex-row">
      <h1 id={titleId} className="sr-only">
        {t('settings.title')}
      </h1>
      <div className="flex min-h-0 shrink-0 flex-col border-b-hairline border-sidebar-border bg-sidebar px-3 pb-3 text-sidebar-foreground sm:w-60 sm:border-e-hairline sm:border-b-0 sm:pb-6">
        <div data-window-drag className="h-12 shrink-0" />
        <button
          type="button"
          onClick={back}
          className="flex h-9 shrink-0 items-center gap-2 rounded-md px-2 text-left text-ui-body focus-ring hover:bg-accent [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
        >
          <ArrowLeftIcon />
          {t('settings.back')}
        </button>
        <div className="relative mt-1 shrink-0">
          <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t('settings.searchLabel')}
            placeholder={t('settings.search')}
            autoComplete="off"
            spellCheck={false}
            className="box-border h-8 w-full min-w-0 rounded-md border-hairline border-input bg-background ps-7 pe-2.5 text-ui-small text-foreground focus-ring placeholder:text-muted-foreground pointer-coarse:text-ui-title [&::-webkit-search-cancel-button]:hidden"
          />
        </div>
        <nav
          ref={navRef}
          aria-label={t('settings.sections')}
          className="flex min-h-0 flex-1 gap-1 overflow-x-auto pt-3 sm:flex-col sm:gap-3 sm:overflow-x-visible sm:overflow-y-auto sm:pt-4"
        >
          {groups.length === 0 && (
            <p role="status" className="px-2 py-1 text-ui-small text-muted-foreground">
              {t('settings.searchEmpty')}
            </p>
          )}
          {groups.map((group) => {
            const groupTitleId = group.id && `${titleId}-${group.id}`
            return (
              <div
                key={group.id ?? 'ungrouped'}
                role="group"
                data-settings-group={group.id ?? ''}
                aria-labelledby={groupTitleId ?? undefined}
                className={cn('flex shrink-0 gap-1 sm:flex-col', !group.id && 'sm:mt-auto')}
              >
                {group.label && (
                  <div id={groupTitleId!} className="hidden h-[18px] items-center px-2 text-ui-small text-muted-foreground sm:flex">
                    {t(group.label)}
                  </div>
                )}
                {group.sections.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    data-section={id}
                    aria-current={current.id === id ? 'page' : undefined}
                    className={navRow}
                    onClick={() => setSection(id)}
                  >
                    <Icon />
                    {t(label)}
                  </button>
                ))}
              </div>
            )
          })}
        </nav>
      </div>
      <div data-settings-detail data-scroll-stable className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pt-6 pb-8 sm:px-16 sm:pt-18 sm:pb-16">
        <div className="mx-auto w-full max-w-[800px]">
          <Current theme={theme} />
        </div>
      </div>
    </section>
  )
}

/** 分区内的设置卡：R20、0.5px card-stroke、card-fill。 */
export function SettingsCard({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('rounded-xl border-hairline border-card-stroke bg-card-fill', className)} {...props} />
}

export function SettingsRow({ label, children, htmlFor }: { label: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 not-last:border-b-hairline not-last:border-border">
      <label htmlFor={htmlFor} className="text-ui-body">
        {label}
      </label>
      {children}
    </div>
  )
}
