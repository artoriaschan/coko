import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@coko/ui'
import { ChevronDownIcon } from 'lucide-react'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import type { RightPanelTabProps } from '../right-panel/tabs.ts'

/** 只检查当前主区 Session；数据表格由后续诊断数据模块提供。 */
export function SessionDiagnostics({ sessionId }: RightPanelTabProps) {
  const { t } = useI18n()
  const [format, setFormat] = React.useState('raw')
  return (
    <section aria-labelledby="session-diagnostics-title" data-session-id={sessionId} className="flex min-h-0 flex-1 flex-col">
      <h2 id="session-diagnostics-title" className="px-3 pt-3 text-ui-body font-medium">
        {t('diagnostics.title')}
      </h2>
      <div className="flex shrink-0 flex-wrap items-center gap-2 p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" aria-label={t('diagnostics.format')}>
              {format === 'raw' ? t('diagnostics.raw') : t('diagnostics.grouping')}
              <ChevronDownIcon aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup value={format} onValueChange={setFormat}>
              <DropdownMenuRadioItem value="raw">{t('diagnostics.raw')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="grouping">{t('diagnostics.grouping')}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-3 text-ui-body text-muted-foreground">{t('diagnostics.empty')}</div>
    </section>
  )
}
