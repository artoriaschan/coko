import type { MessageKey } from '@coko/i18n'
import { Button, Checkbox, cn, Dialog, DialogContent, DialogDescription, DialogTitle, Input } from '@coko/ui'
import { IconAlertCircle, IconLoader2, IconSearch } from '@tabler/icons-react'
import * as React from 'react'
import type { FetchProviderModelsErrorCode, FetchProviderModelsInput } from '../../../shared/bridge.ts'
import { useI18n } from '../../app/i18n.tsx'
import { useSettingsActions } from '../../app/settings.tsx'
import type { ModelRowDraft } from './catalog-draft.ts'
import { importRows, matchesModelId, selectionState, toggleAll } from './fetch-models-selection.ts'

/** 获取请求中由表单决定的部分；null 表示“获取可用模型”不可点（新建时地址或 Key 未填）。 */
export type FetchModelsRequest = Omit<FetchProviderModelsInput, 'requestKey'> | null

type Result =
  | { status: 'loading' }
  | { status: 'error'; code: FetchProviderModelsErrorCode; message: string; httpStatus?: number | undefined }
  | { status: 'ready'; models: readonly string[] }

const ERROR_KEYS: Partial<Record<FetchProviderModelsErrorCode, MessageKey>> = {
  'no-credential': 'providers.fetchModels.errors.no-credential',
  'bad-request': 'providers.fetchModels.errors.bad-request',
  unreachable: 'providers.fetchModels.errors.unreachable',
  'upstream-error': 'providers.fetchModels.errors.upstream-error',
  'invalid-response': 'providers.fetchModels.errors.invalid-response',
  timeout: 'providers.fetchModels.errors.timeout',
  'sidecar-unavailable': 'providers.fetchModels.errors.sidecar-unavailable',
  'invalid-input': 'providers.fetchModels.errors.invalid-input',
}

/**
 * “获取可用模型”按钮与“选择要添加的模型”弹窗（规格 4.6）。每次打开都按表单当前的协议、地址与 Key 重新获取，之前的候选不保留；
 * 初次不选中任何模型；“添加所选”把所选模型按返回顺序追加到目录草稿，不保存供应商。取消、关闭或 Escape 不修改目录，并取消进行中的请求。
 */
export function FetchModels({
  request,
  rows,
  onImport,
}: {
  request: FetchModelsRequest
  rows: readonly ModelRowDraft[]
  onImport: (rows: ModelRowDraft[]) => void
}) {
  const { t } = useI18n()
  const { fetchProviderModels, cancelProviderModels } = useSettingsActions()
  const [open, setOpen] = React.useState(false)
  const [result, setResult] = React.useState<Result>({ status: 'loading' })
  const [query, setQuery] = React.useState('')
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(() => new Set())
  /** 进行中请求的 requestKey；结束、取消或过期后为 null。 */
  const pending = React.useRef<string | null>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const searchRef = React.useRef<HTMLInputElement>(null)
  const searchId = React.useId()

  const cancel = React.useCallback(() => {
    if (pending.current !== null) cancelProviderModels(pending.current)
    pending.current = null
  }, [cancelProviderModels])
  // 表单卸载时取消进行中的请求。
  React.useEffect(() => cancel, [cancel])

  const load = async () => {
    if (request === null) return
    cancel()
    const requestKey = crypto.randomUUID()
    pending.current = requestKey
    setResult({ status: 'loading' })
    const outcome = await fetchProviderModels({ ...request, requestKey })
    // 已取消或被新的请求取代。
    if (pending.current !== requestKey) return
    pending.current = null
    setResult(
      outcome.ok ? { status: 'ready', models: outcome.models } : { status: 'error', code: outcome.code, message: outcome.message, httpStatus: outcome.status },
    )
  }

  const show = () => {
    setQuery('')
    setSelected(new Set())
    setOpen(true)
    void load()
  }
  const close = () => {
    cancel()
    setOpen(false)
  }

  const candidates = result.status === 'ready' ? result.models : []
  const inCatalog = React.useMemo(() => new Set(rows.map((row) => row.id.trim())), [rows])
  const visible = candidates.filter((id) => matchesModelId(id, query))
  const { count, allSelected } = selectionState(candidates, inCatalog, selected, visible)
  const present = candidates.filter((id) => inCatalog.has(id)).length
  const addableVisible = visible.some((id) => !inCatalog.has(id))
  const loading = open && result.status === 'loading'

  const add = () => {
    onImport(importRows(rows, candidates, selected))
    setOpen(false)
  }
  const toggle = (id: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })

  const errorText =
    result.status === 'error' &&
    (result.code === 'upstream-error' && result.httpStatus !== undefined
      ? t('providers.fetchModels.errors.upstreamStatus', { status: String(result.httpStatus) })
      : t(ERROR_KEYS[result.code] ?? 'providers.fetchModels.errors.failed'))

  return (
    <>
      <Button ref={triggerRef} data-fetch-models type="button" variant="outline" size="sm" disabled={request === null || loading} onClick={show}>
        {t('providers.fetchModels.trigger')}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !next && close()}>
        <DialogContent
          data-fetch-models-dialog
          closeLabel={t('providers.fetchModels.close')}
          className="h-[min(640px,calc(100vh-32px))] max-w-[560px] gap-4 p-6"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            searchRef.current?.focus()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            triggerRef.current?.focus()
          }}
        >
          <div className="flex flex-col gap-1 pe-10">
            <DialogTitle className="text-ui-heading">{t('providers.fetchModels.title')}</DialogTitle>
            <DialogDescription>{t('providers.fetchModels.description')}</DialogDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <IconSearch aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                id={searchId}
                type="search"
                aria-label={t('providers.fetchModels.search')}
                placeholder={t('providers.fetchModels.search')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="ps-8"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={result.status !== 'ready' || !addableVisible}
              onClick={() => setSelected((current) => toggleAll(current, visible, inCatalog))}
            >
              {t(allSelected ? 'providers.fetchModels.clearAll' : 'providers.fetchModels.selectAll')}
            </Button>
          </div>
          {result.status === 'ready' && candidates.length > 0 && (
            <p className="-mt-2 text-ui-small text-muted-foreground">
              {present > 0
                ? t('providers.fetchModels.totalWithPresent', { count: String(candidates.length), present: String(present) })
                : t('providers.fetchModels.total', { count: String(candidates.length) })}
            </p>
          )}
          <div aria-live="polite" aria-busy={loading || undefined} className="flex min-h-0 flex-1 flex-col">
            {result.status === 'loading' && (
              <div className="flex flex-1 items-center justify-center gap-2 text-ui-body text-muted-foreground">
                <IconLoader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
                {t('providers.fetchModels.loading')}
              </div>
            )}
            {result.status === 'error' && (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                <p role="alert" className="flex items-start gap-1.5 text-ui-body text-destructive">
                  <IconAlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {errorText}
                </p>
                <details className="max-w-full text-ui-small text-muted-foreground">
                  <summary className="cursor-pointer select-none">{t('providers.fetchModels.errorDetail')}</summary>
                  <p data-error-detail data-user-content className="mt-1 break-words select-text">
                    {result.message}
                  </p>
                </details>
                <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                  {t('providers.fetchModels.retry')}
                </Button>
              </div>
            )}
            {result.status === 'ready' && candidates.length === 0 && (
              <p className="flex flex-1 items-center justify-center text-ui-body text-muted-foreground">{t('providers.fetchModels.empty')}</p>
            )}
            {result.status === 'ready' && candidates.length > 0 && visible.length === 0 && (
              <p className="flex flex-1 items-center justify-center text-ui-body text-muted-foreground">{t('providers.fetchModels.noMatch')}</p>
            )}
            {visible.length > 0 && (
              <ul aria-label={t('providers.fetchModels.title')} className="-mx-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1">
                {visible.map((id) => {
                  const already = inCatalog.has(id)
                  return (
                    <li key={id}>
                      <label
                        data-candidate={id}
                        data-in-catalog={already || undefined}
                        className={cn(
                          'flex h-8 items-center gap-2.5 rounded-md px-2 text-ui-body',
                          already ? 'text-muted-foreground' : 'cursor-pointer hover:bg-accent',
                        )}
                      >
                        <Checkbox checked={already || selected.has(id)} disabled={already} onCheckedChange={(next) => toggle(id, next === true)} />
                        <span data-user-content className="min-w-0 flex-1 truncate font-mono" title={id}>
                          {id}
                        </span>
                        {already && <span className="shrink-0 text-ui-caption">{t('providers.fetchModels.present')}</span>}
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <div aria-hidden className="h-hairline shrink-0 bg-border" />
          <div className="flex items-center justify-between gap-2">
            <p className="text-ui-small text-muted-foreground">{t('providers.fetchModels.selected', { count: String(count) })}</p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={close}>
                {t('providers.fetchModels.cancel')}
              </Button>
              <Button type="button" disabled={count === 0} onClick={add}>
                {t('providers.fetchModels.add')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
