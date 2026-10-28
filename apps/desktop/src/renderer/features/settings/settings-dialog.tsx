import { cn, Dialog, DialogContent, DialogDescription, DialogTitle } from '@coko/ui'
import { BoxIcon, InfoIcon, SlidersHorizontalIcon } from 'lucide-react'
import type * as React from 'react'
import type { Theme } from '../../app/appearance-store.ts'
import { useI18n } from '../../app/i18n.tsx'
import type { SettingsSection } from '../../app/settings-dialog-store.ts'
import { useSettingsDialog } from '../../app/settings.tsx'
import { AboutSection } from './about-section.tsx'
import { GeneralSection } from './general-section.tsx'
import { ModelsSection } from './models-section.tsx'

const SECTIONS: { id: SettingsSection; icon: React.ComponentType }[] = [
  { id: 'general', icon: SlidersHorizontalIcon },
  { id: 'models', icon: BoxIcon },
  { id: 'about', icon: InfoIcon },
]

const navRow =
  'flex h-8 min-w-0 shrink-0 items-center gap-2 rounded-md px-2 text-left text-ui-body outline-none hover:bg-accent aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground'

/** 设置弹窗：General、Models、About（M1 分区）。窄窗口下分区导航改为横排。 */
export function SettingsDialog({ theme }: { theme: Theme }) {
  const { t } = useI18n()
  const { open, section, setSection, close } = useSettingsDialog()
  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent closeLabel={t('settings.close')} className="h-[min(640px,calc(100vh-32px))] max-w-[820px] sm:flex-row" aria-describedby={undefined}>
        <div className="flex shrink-0 flex-col gap-3 border-b-hairline border-border p-4 pe-14 sm:w-48 sm:border-e-hairline sm:border-b-0 sm:pe-3">
          <DialogTitle className="px-2">{t('settings.title')}</DialogTitle>
          <DialogDescription className="sr-only">{t('settings.sections')}</DialogDescription>
          <nav aria-label={t('settings.sections')} className="flex gap-1 overflow-x-auto sm:flex-col sm:overflow-visible">
            {SECTIONS.map(({ id, icon: Icon }) => (
              <button
                key={id}
                type="button"
                data-section={id}
                aria-current={section === id ? 'page' : undefined}
                className={navRow}
                onClick={() => setSection(id)}
              >
                <Icon />
                {t(`settings.${id}`)}
              </button>
            ))}
          </nav>
        </div>
        <div className={cn('min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 sm:pt-12')}>
          {section === 'general' && <GeneralSection theme={theme} />}
          {section === 'models' && <ModelsSection />}
          {section === 'about' && <AboutSection />}
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
