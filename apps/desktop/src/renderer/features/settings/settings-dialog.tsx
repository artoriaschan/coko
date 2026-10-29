import { cn, Dialog, DialogContent, DialogDescription, DialogTitle } from '@coko/ui'
import type * as React from 'react'
import type { Theme } from '../../app/appearance-store.ts'
import { useI18n } from '../../app/i18n.tsx'
import { useSettingsDialog } from '../../app/settings.tsx'
import { resolveSection, visibleSections } from './sections.ts'

const navRow =
  'flex h-8 min-w-0 shrink-0 items-center gap-2 rounded-md px-2 text-left text-ui-body focus-ring hover:bg-accent aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground'

/** 设置弹窗：分区来自注册表（sections.ts），未交付的分区不显示。窄窗口下分区导航改为横排。 */
export function SettingsDialog({ theme }: { theme: Theme }) {
  const { t } = useI18n()
  const { open, section, setSection, close } = useSettingsDialog()
  const current = resolveSection(section)
  const Current = current.Component
  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent closeLabel={t('settings.close')} className="h-[min(640px,calc(100vh-32px))] max-w-[820px] sm:flex-row" aria-describedby={undefined}>
        <div className="flex shrink-0 flex-col gap-3 border-b-hairline border-border p-4 pe-14 sm:w-48 sm:border-e-hairline sm:border-b-0 sm:pe-3">
          <DialogTitle className="px-2">{t('settings.title')}</DialogTitle>
          <DialogDescription className="sr-only">{t('settings.sections')}</DialogDescription>
          <nav aria-label={t('settings.sections')} className="flex gap-1 overflow-x-auto sm:flex-col sm:overflow-visible">
            {visibleSections().map(({ id, label, icon: Icon }) => (
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
          </nav>
        </div>
        <div className={cn('min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 sm:pt-12')}>
          <Current theme={theme} />
        </div>
      </DialogContent>
    </Dialog>
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
