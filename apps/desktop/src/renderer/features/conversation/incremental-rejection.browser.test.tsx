import '../../styles.css'
import { expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { TooltipProvider } from '@coko/ui'
import type { SessionEntry } from '@coko/protocol'
import { I18nProvider } from '../../app/i18n.tsx'
import { buildTimeline } from './timeline.ts'
import { TimelineView } from './timeline-view.tsx'

const entries: SessionEntry[] = [
  {
    sessionId: 's1',
    seq: 1,
    kind: 'run_end',
    runId: 'r1',
    payloadVersion: 1,
    createdAt: 1,
    payload: { status: 'error', error: { code: 'incremental_tools_rejected', message: '400 fixture rejection' } },
  },
]

it.each([
  ['en', 'If this service doesn\'t support it, turn off "Keep the prompt cache when loading tools" in the provider settings and retry.'],
  ['zh', '如果该服务不支持，请在 Provider 设置中关闭「加载新工具时保留提示词缓存」后重试。'],
] as const)('renders native rejection in current %s locale from the same stored error', async (locale, hint) => {
  const items = buildTimeline({ status: 'ready', entries, lastSeq: 1, running: false, live: null })
  await render(
    <I18nProvider locale={locale}>
      <TooltipProvider>
        <TimelineView items={items} entries={entries} theme="light" onRetry={() => {}} />
      </TooltipProvider>
    </I18nProvider>,
  )
  await expect.element(page.getByText('400 fixture rejection', { exact: true })).toBeVisible()
  await expect.element(page.getByText(hint, { exact: true })).toBeVisible()
})
