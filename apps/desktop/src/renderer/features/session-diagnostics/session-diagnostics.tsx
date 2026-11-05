import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@coko/ui'
import { ChevronDownIcon } from 'lucide-react'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import { useChat } from '../../app/chat.tsx'
import { buildRawRecords } from './raw-model.ts'
import { DiagnosticTable } from './diagnostic-table.tsx'
import type { RightPanelTabProps } from '../right-panel/tabs.ts'

/** 只检查当前主区 Session 已加载的数据；展示形式切换重置表格局部状态。 */
export function SessionDiagnostics({ sessionId }: RightPanelTabProps) {
  const { t } = useI18n()
  const [format, setFormat] = React.useState('raw')
  const entries = useChat((state) => (sessionId === null ? undefined : state.conversations[sessionId]?.entries))
  const model = React.useMemo(() => buildRawRecords(entries ?? []), [entries])
  return (
    <section aria-labelledby="session-diagnostics-title" data-session-id={sessionId} className="flex min-h-0 flex-1 flex-col">
      <h2 id="session-diagnostics-title" className="px-3 pt-3 text-ui-body font-medium">
        {t('diagnostics.title')}
      </h2>
      <DiagnosticTable
        key={`${sessionId}:${format}`}
        model={format === 'raw' ? model : { rows: [], records: new Map() }}
        showTime={format === 'raw'}
        toolbar={
          <>
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
          </>
        }
      />
    </section>
  )
}
