// Inspector presentation adapted from DeepSeek Harness (MIT), Copyright (c) 2026 DeepSeek.
import * as React from 'react'
import { cn } from '@coko/ui'
import { ChevronRightIcon, WrenchIcon } from './trajectory-icons.tsx'
import { structuredPatch } from 'diff'
import { useI18n } from '../../app/i18n.tsx'
import { Markdown } from '../conversation/markdown.tsx'
import { useDocumentTheme } from '../conversation/plan-review-panel.tsx'
import { ToolResultImages } from '../conversation/tool-image-details.tsx'
import { Payload, PayloadPreferences } from './detail-payload.tsx'
import { RecordTiming, RequestUsage, UsageRows, type DetailUsage } from './detail-metrics.tsx'
import { useTrajectoryLocale } from './locales.ts'
import { stringify, type TrajectoryCellProps } from './trajectory-record.ts'
import css from './trajectory-panel.module.css'

type DetailTab = 'summary' | 'preview' | 'raw' | 'payload' | 'result' | 'schema' | 'timing' | 'usage' | 'systemPrompt' | 'tools' | 'options' | 'diff'

function OverviewSection({ label, onOpen, children }: { label: string; onOpen: () => void; children: React.ReactNode }) {
  const region = React.useRef<HTMLDivElement>(null)
  const measure = () => {
    const element = region.current
    if (element) element.toggleAttribute('data-scroll-more', element.scrollHeight - element.scrollTop > element.clientHeight + 1)
  }
  React.useLayoutEffect(() => {
    const element = region.current
    if (!element) return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    for (const child of element.children) observer.observe(child)
    measure()
    return () => observer.disconnect()
  }, [children])
  return (
    <section className={css.overviewSection}>
      <header className={css.overviewHeading}>
        <h3>
          <button type="button" onClick={onOpen}>
            {label}
            <ChevronRightIcon aria-hidden />
          </button>
        </h3>
      </header>
      <div ref={region} className={css.overviewPreview} data-summary-scroll-region onScroll={measure}>
        {children}
      </div>
    </section>
  )
}

function RawMessageContent({ cell, onOpenCall }: { cell: TrajectoryCellProps; onOpenCall: (id: string) => void }) {
  const t = useTrajectoryLocale()
  if (!cell.sourceBlocks?.length)
    return (
      <pre className={css.payload} data-user-content>
        {[
          cell.thinking,
          typeof cell.input === 'string' ? cell.input : cell.kind === 'message' || cell.kind === 'compacted' ? stringify(cell.output) : cell.text,
        ]
          .filter(Boolean)
          .join('\n\n')}
      </pre>
    )
  return (
    <div className={css.sourceBlocks} data-user-content>
      {cell.sourceBlocks.map((value, index) => {
        const block = value as { type?: string; text?: string; thinking?: string; id?: string; arguments?: unknown }
        const label = t('block.label', { index: index + 1, type: block.type === 'toolCall' ? 'tool-call' : (block.type ?? '') })
        const content = block.type === 'toolCall' ? JSON.stringify(block.arguments) : (block.thinking ?? block.text ?? stringify(value))
        return (
          <section className={css.sourceBlock} key={index}>
            {block.type === 'toolCall' && block.id ? (
              <button
                type="button"
                className={css.sourceBlockJumpTarget}
                aria-label={t('block.openSummary', { index: index + 1 })}
                onClick={() => onOpenCall(block.id!)}
              >
                <span className={css.sourceBlockLabel}>{label}</span>
                <ChevronRightIcon className={css.sourceBlockJumpIcon} aria-hidden />
              </button>
            ) : (
              <div className={css.sourceBlockHeader}>
                <span className={css.sourceBlockLabel}>{label}</span>
              </div>
            )}
            <pre className={css.sourceBlockContent}>{content}</pre>
          </section>
        )
      })}
    </div>
  )
}

function ToolCatalog({ tools }: { tools: readonly unknown[] }) {
  const t = useTrajectoryLocale()
  if (tools.length === 0) return <p className={css.noPayload}>{t('record.toolsMissing')}</p>
  return (
    <div className={css.toolCatalog} data-user-content>
      {tools.map((value, index) => {
        const tool = value as { name?: string; description?: string; parameters?: unknown }
        return (
          <details className={css.toolCatalogItem} key={`${tool.name}:${index}`}>
            <summary>
              <ChevronRightIcon aria-hidden />
              <WrenchIcon aria-hidden />
              <span>{tool.name}</span>
              <span className={css.toolDescription}>{tool.description}</span>
            </summary>
            <div className={css.toolCatalogDefinition}>
              <p className={css.toolCatalogFullDescription}>{tool.description}</p>
              <div className={css.toolCatalogTree}>
                <Payload value={tool.parameters} label={t('record.parametersJson')} />
              </div>
            </div>
          </details>
        )
      })}
    </div>
  )
}

function PromptDiff({ cell }: { cell: TrajectoryCellProps }) {
  const t = useTrajectoryLocale()
  const before = cell.previousSnapshot
  const after = cell.promptSnapshot ?? cell.request?.snapshot
  if (!before || !after) return null
  return (
    <div className={css.promptDiff} data-user-content>
      {(['system', 'tools'] as const).map((key) => {
        const left = stringify(before[key]),
          right = stringify(after[key])
        const patch = structuredPatch('', '', left, right, undefined, undefined, { context: 3 })
        if (patch.hunks.length === 0) return null
        return (
          <section key={key}>
            <h3>{t(key === 'system' ? 'tab.systemPrompt' : 'tab.tools')}</h3>
            <pre>
              {patch.hunks.map((hunk, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <span className={css.diffMeta}>{' \n'}</span>}
                  <span className={css.diffMeta}>{`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n`}</span>
                  {hunk.lines
                    .filter((line) => !line.startsWith('\\'))
                    .map((line, j) => (
                      <span key={j} data-change={line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : undefined}>
                        {line}
                        {'\n'}
                      </span>
                    ))}
                </React.Fragment>
              ))}
            </pre>
          </section>
        )
      })}
    </div>
  )
}

function MessageContent({
  cell,
  onOpenCall,
  thinkingExpanded,
  onThinkingChange,
}: {
  cell: TrajectoryCellProps
  onOpenCall: (id: string) => void
  thinkingExpanded: boolean
  onThinkingChange: (expanded: boolean) => void
}) {
  const t = useTrajectoryLocale()
  const theme = useDocumentTheme()
  const calls =
    cell.sourceBlocks?.filter(
      (value): value is { type: string; id: string; name: string; arguments?: unknown } =>
        value !== null &&
        typeof value === 'object' &&
        'type' in value &&
        value.type === 'toolCall' &&
        'id' in value &&
        typeof value.id === 'string' &&
        'name' in value &&
        typeof value.name === 'string',
    ) ?? []
  const content = cell.kind === 'message' || cell.kind === 'compacted' ? cell.output : typeof cell.input === 'string' ? cell.input : cell.text
  if (cell.contextRemoved) return <p className={css.noPayload}>{t('record.contextRemoved', { name: cell.contextSection ?? '' })}</p>
  return (
    <div className={css.assistantContent} data-user-content>
      {cell.thinking && (
        <div className={css.thinkingQuote}>
          <button className={css.thinkingToggle} type="button" aria-expanded={thinkingExpanded} onClick={() => onThinkingChange(!thinkingExpanded)}>
            {t('record.thinking')}
            <ChevronRightIcon className={css.thinkingChevron} aria-hidden />
          </button>
          {thinkingExpanded && (
            <div className={css.markdown}>
              <Markdown theme={theme} streaming={false} text={cell.thinking} compact />
            </div>
          )}
        </div>
      )}
      {content !== undefined && stringify(content) !== '' && (
        <div className={css.markdown}>
          <Markdown
            theme={theme}
            streaming={false}
            text={cell.kind === 'context' ? stringify(content).replace(/<([^\n>]+)>/g, '&lt;$1&gt;') : stringify(content)}
          />
        </div>
      )}
      {calls.length > 0 && (
        <ul className={css.assistantCalls}>
          {calls.map((call) => (
            <li key={call.id}>
              <button type="button" onClick={() => onOpenCall(call.id)}>
                <WrenchIcon aria-hidden />
                <span className={css.assistantCallText}>
                  <span className={css.assistantCallName}>{call.name}</span>
                  <span className={css.assistantCallArgs}>{JSON.stringify(call.arguments)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {cell.kind === 'user' && Array.isArray(cell.input) && <ToolResultImages content={cell.input} />}
      {!cell.thinking && !content && calls.length === 0 && <p className={css.noPayload}>{t('record.noContent')}</p>}
    </div>
  )
}

export function DetailPanel({
  cell,
  requestDetail = false,
  selectionRevision = 0,
  toolCallCount = 0,
  subtoolCallCount = 0,
  cumulative,
  onClose,
  onOpenCall,
  onOpenRequest,
}: {
  cell: TrajectoryCellProps
  requestDetail?: boolean
  selectionRevision?: number
  toolCallCount?: number
  subtoolCallCount?: number
  cumulative?: DetailUsage
  onClose: () => void
  onOpenCall: (id: string) => void
  onOpenRequest: () => void
}) {
  const t = useTrajectoryLocale()
  const { locale } = useI18n()
  const theme = useDocumentTheme()
  const tool = cell.kind === 'tool' || cell.kind === 'subtool'
  const initialTab = !requestDetail && cell.kind === 'system' ? (cell.previousSnapshot ? 'diff' : 'systemPrompt') : 'summary'
  const [tab, setTab] = React.useState<DetailTab>(initialTab)
  const tabs: DetailTab[] = requestDetail
    ? ['summary', 'options', 'usage', 'timing']
    : tool
      ? ['summary', ...(cell.input === undefined ? [] : ['payload' as const]), ...(cell.output === undefined ? [] : ['result' as const]), 'schema', 'timing']
      : cell.kind === 'system'
        ? [...(cell.previousSnapshot ? ['diff' as const] : []), 'systemPrompt', 'tools']
        : cell.kind === 'compacted'
          ? ['summary', 'raw']
          : ['summary', 'preview', 'raw']
  const active = tabs.includes(tab) ? tab : tabs[0]!
  const panelId = React.useId()
  const requestedTab = React.useRef<DetailTab | null>(null)
  const root = React.useRef<HTMLElement>(null)
  const body = React.useRef<HTMLDivElement>(null)
  const [width, setWidth] = React.useState<number | null>(null)
  const drag = React.useRef<{ pointerId: number; x: number; width: number; available: number } | null>(null)
  const clampWidth = (next: number, available: number) => Math.max(320, Math.min(720, available - 280, next))
  const [thinking, setThinking] = React.useState<{ id: string; expanded: boolean } | null>(null)
  const thinkingExpanded = thinking?.id === cell.id ? thinking.expanded : cell.kind === 'message' && Boolean(cell.thinking?.trim())
  const onThinkingChange = (expanded: boolean) => setThinking({ id: cell.id, expanded })
  const activate = (next: DetailTab) => {
    setTab(next)
    if (body.current) body.current.scrollTop = 0
  }
  React.useEffect(() => {
    setTab(requestedTab.current ?? initialTab)
    requestedTab.current = null
    root.current?.querySelectorAll<HTMLElement>('[data-summary-scroll-region]').forEach((region) => {
      region.scrollTop = 0
    })
    if (body.current) body.current.scrollTop = 0
  }, [cell.id, initialTab, requestDetail, selectionRevision])
  const request = cell.request
  const prompt = cell.promptSnapshot ?? request?.snapshot
  const status =
    cell.isError || (requestDetail && request?.errorCode) ? t('status.failed') : cell.status === 'running' ? t('status.pending') : t('status.completed')
  const title = cell.promptMissing ? t('record.initialSystemPromptUnrecorded') : cell.promptChange ? t(`layout.${cell.promptChange}`) : cell.text
  const location =
    cell.kind === 'system'
      ? title
      : [
          cell.turn === null ? t('section.betweenTurns') : t('turn.label', { turn: cell.turn }),
          !requestDetail && cell.requestStep ? t('request.step', { step: cell.requestStep }) : undefined,
        ]
          .filter(Boolean)
          .join(' · ')
  const usage = request ? { ...request.usage, ...(request.reasoning === undefined ? {} : { reasoning: request.reasoning }) } : undefined
  const rendered = <MessageContent cell={cell} onOpenCall={onOpenCall} thinkingExpanded={thinkingExpanded} onThinkingChange={onThinkingChange} />
  const timing = <RecordTiming cell={cell} />
  const schema =
    cell.schema === undefined ? <p className={css.noPayload}>{t('record.schemaUnavailable')}</p> : <ToolSchema cell={cell} preview={active === 'summary'} />
  const options = request?.snapshot ? { provider: request.provider, model: request.model, ...request.snapshot } : undefined
  const hierarchy = !requestDetail && ((cell.kind === 'message' && request) || (tool && cell.parentId))
  return (
    <PayloadPreferences>
      <aside
        ref={root}
        className={css.details}
        aria-label={t(requestDetail ? 'details.request' : 'details.event')}
        data-inspector={requestDetail ? 'request' : 'record'}
        style={width === null ? undefined : ({ '--local-detail-width': `${width}px` } as React.CSSProperties)}
      >
        <div
          role="separator"
          aria-label={t('details.resize')}
          aria-orientation="vertical"
          tabIndex={0}
          className={css.resize}
          title={t('details.resizeTitle')}
          onDoubleClick={() => setWidth(null)}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            drag.current = {
              pointerId: event.pointerId,
              x: event.clientX,
              width: root.current?.getBoundingClientRect().width ?? 320,
              available: root.current?.parentElement?.getBoundingClientRect().width ?? 0,
            }
            event.currentTarget.setPointerCapture(event.pointerId)
            event.preventDefault()
          }}
          onPointerMove={(event) => {
            const start = drag.current
            if (start?.pointerId === event.pointerId) setWidth(clampWidth(start.width + start.x - event.clientX, start.available))
          }}
          onPointerUp={(event) => {
            drag.current = null
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onPointerCancel={() => {
            drag.current = null
          }}
          onLostPointerCapture={() => {
            drag.current = null
          }}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return
            event.preventDefault()
            if (event.key === 'Home') setWidth(null)
            else
              setWidth(
                clampWidth(
                  (root.current?.getBoundingClientRect().width ?? 320) + (event.key === 'ArrowLeft' ? 16 : -16),
                  root.current?.parentElement?.getBoundingClientRect().width ?? 800,
                ),
              )
          }}
        />
        <header className={css.detailsHeader}>
          <div className={css.detailsTitle}>
            {requestDetail ? (
              <>
                <span className={css.requestDetailsDot} aria-hidden />
                <span className={css.requestDetailsName}>{t('request.label', { request: cell.requestNumber ?? 0 })}</span>
              </>
            ) : (
              <span className={css.kindTag} data-kind={cell.kind}>
                {t(`kind.${cell.kind === 'message' ? 'assistant' : cell.kind}`)}
              </span>
            )}
            <span className={css.detailsLocation}>{location}</span>
          </div>
          <button type="button" className={css.close} aria-label={t('details.close')} onClick={onClose}>
            <span aria-hidden>×</span>
          </button>
        </header>
        <div
          role="tablist"
          aria-label={t('details.event')}
          className={css.detailTabs}
          onKeyDown={(event) => {
            const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
            if (!offset) return
            event.preventDefault()
            const next = tabs[(tabs.indexOf(active) + offset + tabs.length) % tabs.length]!
            activate(next)
            event.currentTarget.querySelector<HTMLButtonElement>(`[data-detail-tab="${next}"]`)?.focus()
          }}
        >
          {tabs.map((item) => (
            <button
              type="button"
              role="tab"
              id={`${panelId}-${item}`}
              aria-controls={panelId}
              data-detail-tab={item}
              aria-selected={active === item}
              tabIndex={active === item ? 0 : -1}
              key={item}
              onClick={() => activate(item)}
            >
              {t(item === 'raw' && cell.kind === 'compacted' ? 'tab.rawOutput' : `tab.${item}`)}
            </button>
          ))}
        </div>
        <div
          ref={body}
          id={panelId}
          role="tabpanel"
          aria-labelledby={`${panelId}-${active}`}
          aria-label={t(active === 'raw' && cell.kind === 'compacted' ? 'tab.rawOutput' : `tab.${active}`)}
          className={cn(css.detailBody, active === 'summary' && css.detailBodySummary)}
        >
          {active === 'summary' && (
            <>
              <dl className={cn(css.overview, css.summaryScrollRegion)} data-summary-scroll-region>
                {hierarchy && (
                  <div>
                    <dt>{t(cell.kind === 'message' ? 'details.source' : 'details.hierarchy')}</dt>
                    <dd>
                      <button type="button" className={css.hierarchyLink} onClick={cell.kind === 'message' ? onOpenRequest : () => onOpenCall(cell.parentId!)}>
                        {cell.kind === 'message' ? t('request.label', { request: cell.requestNumber ?? 0 }) : t('details.assistantMessage')}
                        <ChevronRightIcon aria-hidden />
                      </button>
                    </dd>
                  </div>
                )}
                <div>
                  <dt>{t('details.status')}</dt>
                  <dd data-error={cell.isError || undefined}>{status}</dd>
                </div>
                {cell.kind === 'compacted' && !requestDetail && (
                  <>
                    <div>
                      <dt>{t('timing.duration')}</dt>
                      <dd>{cell.timeSeconds === null ? '—' : t('unit.milliseconds', { value: Math.round(cell.timeSeconds * 1000).toLocaleString(locale) })}</dd>
                    </div>
                    <div>
                      <dt>{t('usage.tokens')}</dt>
                      <dd>—</dd>
                    </div>
                  </>
                )}
                {requestDetail && request && (
                  <>
                    {request.purpose !== 'turn' && (
                      <div>
                        <dt>{t('details.purpose')}</dt>
                        <dd>{t(`request.purpose.${request.purpose}`)}</dd>
                      </div>
                    )}
                    <div>
                      <dt>{t('details.provider')}</dt>
                      <dd>{request.provider}</dd>
                    </div>
                    <div>
                      <dt>{t('details.model')}</dt>
                      <dd>{request.model}</dd>
                    </div>
                    <div>
                      <dt>{t('details.toolCalls')}</dt>
                      <dd>{toolCallCount}</dd>
                    </div>
                    {subtoolCallCount > 0 && (
                      <div>
                        <dt>{t('details.subtoolCalls')}</dt>
                        <dd>{subtoolCallCount}</dd>
                      </div>
                    )}
                    {request.errorCode && (
                      <div>
                        <dt>{t('details.error')}</dt>
                        <dd data-error>{request.errorCode}</dd>
                      </div>
                    )}
                    {request.retries > 0 && (
                      <div>
                        <dt>{t('details.retry')}</dt>
                        <dd>{request.retries}</dd>
                      </div>
                    )}
                    {!cell.requestOnly && (
                      <div>
                        <dt>{t('details.result')}</dt>
                        <dd>
                          <button type="button" className={css.hierarchyLink} onClick={() => onOpenCall(cell.id)}>
                            {t('details.assistantMessage')}
                            <ChevronRightIcon aria-hidden />
                          </button>
                        </dd>
                      </div>
                    )}
                  </>
                )}
                {!requestDetail && cell.kind === 'message' && request && (
                  <>
                    <div>
                      <dt>{t('usage.tokens')}</dt>
                      <dd>{t('unit.tokens', { value: request.usage.output.toLocaleString(locale) })}</dd>
                    </div>
                    {request.reasoning !== undefined && (
                      <>
                        <div className={css.requestTokenDetail}>
                          <dt>{t('usage.reasoning')}</dt>
                          <dd>{t('unit.tokens', { value: request.reasoning.toLocaleString(locale) })}</dd>
                        </div>
                        <div className={css.requestTokenDetail}>
                          <dt>{t('usage.content')}</dt>
                          <dd>{t('unit.tokens', { value: Math.max(0, request.usage.output - request.reasoning).toLocaleString(locale) })}</dd>
                        </div>
                      </>
                    )}
                  </>
                )}
              </dl>
              {cell.kind === 'compacted' && !requestDetail ? (
                <div className={cn(css.compactedSummary, css.summaryScrollRegion)} data-summary-scroll-region>
                  {rendered}
                </div>
              ) : (
                <div className={css.overviewSections}>
                  {requestDetail ? (
                    <>
                      {options && (
                        <OverviewSection label={t('tab.options')} onOpen={() => activate('options')}>
                          <Payload value={options} label={t('options.json')} preview />
                        </OverviewSection>
                      )}
                      <OverviewSection label={t('tab.usage')} onOpen={() => activate('usage')}>
                        <UsageRows usage={usage} />
                      </OverviewSection>
                      <OverviewSection label={t('tab.timing')} onOpen={() => activate('timing')}>
                        <RecordTiming cell={cell} preview />
                      </OverviewSection>
                    </>
                  ) : tool ? (
                    <>
                      {cell.input !== undefined && (
                        <OverviewSection label={t('tab.payload')} onOpen={() => activate('payload')}>
                          <Payload value={cell.input} label={t('record.parametersJson')} preview />
                        </OverviewSection>
                      )}
                      {cell.output !== undefined && (
                        <OverviewSection label={t('tab.result')} onOpen={() => activate('result')}>
                          <Payload value={cell.output} label={t('record.outputJson')} images={cell.outputBlocks} preview />
                        </OverviewSection>
                      )}
                      <OverviewSection label={t('tab.schema')} onOpen={() => activate('schema')}>
                        {schema}
                      </OverviewSection>
                      <OverviewSection label={t('tab.timing')} onOpen={() => activate('timing')}>
                        <RecordTiming cell={cell} preview />
                      </OverviewSection>
                    </>
                  ) : (
                    <>
                      <OverviewSection label={t('tab.preview')} onOpen={() => activate('preview')}>
                        {rendered}
                      </OverviewSection>
                      {cell.kind === 'message' && request && (
                        <OverviewSection
                          label={t('timing.request')}
                          onOpen={() => {
                            requestedTab.current = 'timing'
                            onOpenRequest()
                          }}
                        >
                          <RecordTiming cell={cell} preview />
                        </OverviewSection>
                      )}
                    </>
                  )}
                  {cell.tool?.hooks.map((hook, index) => (
                    <OverviewSection label={hook.event} onOpen={() => activate('timing')} key={index}>
                      <Payload value={hook} label={hook.event} preview />
                    </OverviewSection>
                  ))}
                </div>
              )}
            </>
          )}
          {active === 'preview' && rendered}
          {active === 'raw' && <RawMessageContent cell={cell} onOpenCall={onOpenCall} />}
          {active === 'payload' && <Payload value={cell.input} label={t('record.parametersJson')} />}
          {active === 'result' && (
            <div className={css.resultSections}>
              <section className={css.resultSection} aria-label={t('record.rawResult')}>
                <header className={css.overviewHeading}>
                  <h3>{t('record.rawResult')}</h3>
                </header>
                {cell.rawResult === undefined ? (
                  <p className={css.noPayload}>{t('record.rawResultUnavailable')}</p>
                ) : (
                  <Payload value={cell.rawResult} label={t('record.json')} />
                )}
              </section>
              <section className={css.resultSection} aria-label={t('record.renderedResult')}>
                <header className={css.overviewHeading}>
                  <h3>{t('record.renderedResult')}</h3>
                </header>
                <Payload value={cell.output} images={cell.outputBlocks} label={t('record.outputJson')} />
              </section>
            </div>
          )}
          {active === 'schema' && schema}
          {active === 'options' &&
            (options ? <Payload value={options} label={t('options.json')} /> : <p className={css.noPayload}>{t('record.snapshotUnavailable')}</p>)}
          {active === 'timing' && timing}
          {active === 'usage' && <RequestUsage usage={usage} cumulative={cumulative} />}
          {active === 'diff' && <PromptDiff cell={cell} />}
          {(active === 'systemPrompt' || active === 'tools') &&
            (prompt === undefined ? (
              <p className={css.noPayload}>{t(cell.promptMissing ? 'record.contextHistoryUnavailable' : 'record.snapshotUnavailable')}</p>
            ) : active === 'tools' ? (
              <ToolCatalog tools={prompt.tools} />
            ) : prompt.system === '' ? (
              <p className={css.noPayload}>{t('record.systemPromptMissing')}</p>
            ) : (
              <div className={css.markdown} data-user-content>
                <Markdown theme={theme} streaming={false} text={prompt.system.replace(/<([^\n>]+)>/g, '&lt;$1&gt;')} />
              </div>
            ))}
        </div>
      </aside>
    </PayloadPreferences>
  )
}

function ToolSchema({ cell, preview = false }: { cell: TrajectoryCellProps; preview?: boolean }) {
  const t = useTrajectoryLocale()
  const definition = cell.schema as { name?: string; description?: string; parameters?: unknown } | undefined
  if (!definition) return <p className={css.noPayload}>{t('record.schemaUnavailable')}</p>
  return (
    <div className={cn(css.schema, preview && css.schemaPreview)}>
      <div className={css.schemaIntro}>
        <h3 className={css.schemaName}>{definition.name ?? cell.tool?.name ?? cell.text.split(' ')[0]}</h3>
        {definition.description && <p className={css.schemaDescription}>{definition.description}</p>}
      </div>
      <h4 className={css.schemaParametersTitle}>{t('record.parameters')}</h4>
      <div className={css.schemaTree}>
        <Payload
          value={definition.parameters ?? definition}
          label={t('record.namedParametersJson', { name: definition.name ?? cell.tool?.name ?? '' })}
          preview={preview}
        />
      </div>
    </div>
  )
}
