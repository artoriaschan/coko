import type { MessageKey } from '@coko/i18n'
import { MODEL_CATALOG_DEFAULTS, ModelProtocol, PROVIDER_ID_PATTERN, type CatalogModel, type Provider } from '@coko/protocol'
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger, Input, toast } from '@coko/ui'
import { ChevronDownIcon, KeyRoundIcon, LoaderCircleIcon, PlusIcon } from 'lucide-react'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import { useSettings, useSettingsActions } from '../../app/settings.tsx'
import type { ProviderSaveErrorCode } from '../../../shared/bridge.ts'
import type { ProviderDraft } from '../../stores/settings-store.ts'
import { SettingsCard } from './settings-dialog.tsx'

/** 协议下拉的顺序即协议 schema 中的顺序；默认 OpenAI Chat Completions。 */
const PROTOCOLS: ModelProtocol[] = ModelProtocol.anyOf.map((literal) => literal.const)
const PROVIDER_ID = new RegExp(PROVIDER_ID_PATTERN)

/** 正在编辑的表单：key 在表单生命周期内不变。 */
interface Editing {
  key: string
  /** 正在编辑的已有 Provider；新建表单没有 id。 */
  id?: string
}

let formSeq = 0

export function ModelsSection() {
  const { t } = useI18n()
  const status = useSettings((s) => s.status)
  const providers = useSettings((s) => s.providers)
  const { load } = useSettingsActions()
  const [editing, setEditing] = React.useState<Editing | null>(null)
  const isNew = editing?.key.startsWith('new-') ?? false

  const form = (target: Editing, provider?: Provider) => (
    <ProviderForm
      key={target.key}
      provider={provider}
      takenIds={providers.filter((p) => p.id !== provider?.id).map((p) => p.id)}
      onCancel={() => setEditing(null)}
      onSaved={() => setEditing(null)}
    />
  )

  return (
    <section aria-labelledby="settings-models" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <h2 id="settings-models" className="text-ui-body-lg font-medium">
            {t('providers.title')}
          </h2>
          <p className="text-ui-small text-muted-foreground">{t('providers.description')}</p>
        </div>
        <Button variant="outline" size="sm" disabled={status !== 'ready' || editing !== null} onClick={() => setEditing({ key: `new-${++formSeq}` })}>
          <PlusIcon />
          {t('providers.add')}
        </Button>
      </div>

      {status === 'loading' && providers.length === 0 && (
        <div className="flex justify-center py-8">
          <LoaderCircleIcon aria-label={t('settings.models')} className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none" />
        </div>
      )}
      {status === 'error' && (
        <div className="flex flex-col items-start gap-2 text-ui-body text-muted-foreground">
          <p>{t('providers.loadFailed')}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            {t('settings.retry')}
          </Button>
        </div>
      )}

      {editing && isNew && form(editing)}

      {status === 'ready' && providers.length === 0 && !editing && <p className="py-4 text-ui-body text-muted-foreground">{t('providers.empty')}</p>}

      {providers.map((provider) =>
        editing?.id === provider.id ? (
          <React.Fragment key={provider.id}>{form(editing, provider)}</React.Fragment>
        ) : (
          <ProviderCard key={provider.id} provider={provider} disabled={editing !== null} onEdit={() => setEditing({ key: provider.id, id: provider.id })} />
        ),
      )}
    </section>
  )
}

function CredentialStatus({ provider }: { provider: Provider }) {
  const { t } = useI18n()
  const credential = provider.credential
  return (
    <span data-credential-status={credential ? 'configured' : 'missing'} className="inline-flex items-center gap-1 text-ui-small text-muted-foreground">
      <KeyRoundIcon aria-hidden className="size-3.5" />
      {credential
        ? credential.hint
          ? t('providers.credentialConfigured', { hint: credential.hint })
          : t('providers.credentialConfiguredNoHint')
        : t('providers.credentialMissing')}
    </span>
  )
}

function ProviderCard({ provider, disabled, onEdit }: { provider: Provider; disabled: boolean; onEdit: () => void }) {
  const { t } = useI18n()
  const { deleteProvider } = useSettingsActions()
  const [confirming, setConfirming] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const remove = async () => {
    setDeleting(true)
    const ok = await deleteProvider(provider.id)
    setDeleting(false)
    if (ok) toast.success(t('providers.deleted'))
    else {
      setConfirming(false)
      toast.error(t('providers.deleteFailed'))
    }
  }
  const modelIds = provider.models.map((m) => m.id).join(', ')
  return (
    <SettingsCard data-provider-id={provider.id} data-protocol={provider.api} className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <span data-user-content className="truncate text-ui-body font-medium" title={provider.name}>
            {provider.name}
          </span>
          <span data-user-content className="shrink-0 font-mono text-ui-small text-muted-foreground">
            {provider.id}
          </span>
        </div>
        <CredentialStatus provider={provider} />
        <span data-user-content className="truncate font-mono text-ui-small text-muted-foreground" title={modelIds}>
          {modelIds}
        </span>
      </div>
      <div className="flex shrink-0 gap-1">
        {confirming ? (
          <>
            <Button variant="destructive" size="sm" disabled={deleting} onClick={() => void remove()}>
              {t('providers.confirmDelete')}
            </Button>
            <Button variant="ghost" size="sm" disabled={deleting} onClick={() => setConfirming(false)}>
              {t('providers.cancel')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" size="sm" disabled={disabled} onClick={onEdit}>
              {t('providers.edit')}
            </Button>
            <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setConfirming(true)}>
              {t('providers.delete')}
            </Button>
          </>
        )}
      </div>
    </SettingsCard>
  )
}

/** 一次提交的错误码到字典键；其余错误用 providers.saveFailed。任何失败都表示什么都没有保存。 */
const PROVIDER_ERROR_KEYS: Partial<Record<ProviderSaveErrorCode, MessageKey>> = {
  'bad-request': 'providers.errors.invalid',
  'already-exists': 'providers.idTaken',
  'not-found': 'providers.errors.notFound',
  'storage-unavailable': 'providers.errors.unavailable',
  'invalid-input': 'providers.credentialErrors.invalid-input',
  'encryption-unavailable': 'providers.credentialErrors.encryption-unavailable',
  'sidecar-unavailable': 'providers.credentialErrors.sidecar-unavailable',
  timeout: 'providers.credentialErrors.timeout',
}

const parseModelIds = (text: string) => [...new Set(text.split(/[\s,]+/).filter(Boolean))]

/** 由逗号分隔的模型 ID 得到目录：已有模型保留其能力配置，新模型使用默认值（后续票提供逐项编辑）。 */
const toCatalog = (ids: string[], existing: readonly CatalogModel[]): CatalogModel[] =>
  ids.map((id) => existing.find((m) => m.id === id) ?? { id, name: '', ...MODEL_CATALOG_DEFAULTS, input: ['text'], reasoning: false, thinkingLevels: [] })

const isHttpUrl = (text: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(text).protocol)
  } catch {
    return false
  }
}

function ProviderForm({
  provider,
  takenIds,
  onCancel,
  onSaved,
}: {
  provider?: Provider | undefined
  takenIds: string[]
  onCancel: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const { saveProvider } = useSettingsActions()
  const id = React.useId()
  const [providerId, setProviderId] = React.useState(provider?.id ?? '')
  const [name, setName] = React.useState(provider?.name ?? '')
  const [api, setApi] = React.useState<ModelProtocol>(provider?.api ?? 'openai-completions')
  const [baseUrl, setBaseUrl] = React.useState(provider?.baseUrl ?? '')
  const [modelText, setModelText] = React.useState((provider?.models ?? []).map((m) => m.id).join(', '))
  const [secret, setSecret] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  /** 服务端错误的技术原文：只放在可展开的详情中。 */
  const [detail, setDetail] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const isNew = provider === undefined

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const ids = parseModelIds(modelText)
    if (isNew && !PROVIDER_ID.test(providerId)) return setError(t('providers.idInvalid'))
    if (isNew && takenIds.includes(providerId)) return setError(t('providers.idTaken'))
    if (name.trim() === '') return setError(t('providers.nameRequired'))
    if (!isHttpUrl(baseUrl.trim())) return setError(t('providers.baseUrlInvalid'))
    if (ids.length === 0) return setError(t('providers.modelsRequired'))
    if (isNew && secret.trim() === '') return setError(t('providers.credentialRequired'))
    setError(null)
    setDetail(null)
    setSaving(true)
    const draft: ProviderDraft = {
      id: provider?.id ?? providerId,
      isNew,
      name: name.trim(),
      api,
      baseUrl: baseUrl.trim(),
      models: toCatalog(ids, provider?.models ?? []),
      secret: secret.trim(),
    }
    const result = await saveProvider(draft)
    setSaving(false)
    if (result.ok) {
      toast.success(t('providers.saved'))
      onSaved()
      return
    }
    // 整次提交失败：配置与 Key 都没有保存，表单保留草稿以便修改或重试。
    setError(t(PROVIDER_ERROR_KEYS[result.code] ?? 'providers.saveFailed'))
    setDetail(`${result.message} (${result.code})`)
    toast.error(t('providers.saveFailed'))
  }

  return (
    <SettingsCard data-provider-form className="px-4 py-3">
      <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)} noValidate>
        {isNew ? (
          <Field id={`${id}-id`} label={t('providers.id')} hint={t('providers.idHint')}>
            <Input
              id={`${id}-id`}
              name="providerId"
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          </Field>
        ) : (
          <p className="flex min-w-0 items-baseline gap-2">
            <span data-user-content className="truncate text-ui-body font-medium">
              {provider.name}
            </span>
            <span data-user-content className="font-mono text-ui-small text-muted-foreground">
              {provider.id}
            </span>
          </p>
        )}
        <Field id={`${id}-name`} label={t('providers.name')}>
          <Input id={`${id}-name`} name="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </Field>
        <Field id={`${id}-protocol`} label={t('providers.protocol')}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button id={`${id}-protocol`} type="button" variant="outline" size="sm" data-protocol={api} className="justify-between self-start">
                {t(`providers.protocols.${api}`)}
                <ChevronDownIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup value={api} onValueChange={(value) => setApi(value as ModelProtocol)}>
                {PROTOCOLS.map((protocol) => (
                  <DropdownMenuRadioItem key={protocol} value={protocol} data-protocol={protocol}>
                    {t(`providers.protocols.${protocol}`)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </Field>
        <Field id={`${id}-url`} label={t('providers.baseUrl')}>
          <Input
            id={`${id}-url`}
            name="baseUrl"
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-required
          />
        </Field>
        <Field id={`${id}-models`} label={t('providers.models')} hint={t('providers.modelsHint')}>
          <Input id={`${id}-models`} name="models" value={modelText} onChange={(e) => setModelText(e.target.value)} autoComplete="off" spellCheck={false} />
        </Field>
        <Field id={`${id}-secret`} label={t('providers.credential')} hint={provider?.credential ? t('providers.credentialKeep') : undefined}>
          <Input
            id={`${id}-secret`}
            name="credential"
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={t('providers.credentialPlaceholder')}
            autoComplete="off"
            spellCheck={false}
          />
          {provider && <CredentialStatus provider={provider} />}
        </Field>
        {error !== null && (
          <p role="alert" className="text-ui-small text-destructive">
            {error}
          </p>
        )}
        {detail !== null && (
          <details className="text-ui-small text-muted-foreground">
            <summary className="cursor-pointer select-none">{t('providers.errorDetail')}</summary>
            <p data-error-detail data-user-content className="mt-1 break-words select-text">
              {detail}
            </p>
          </details>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
            {t('providers.cancel')}
          </Button>
          <Button type="submit" size="sm" disabled={saving}>
            {t('providers.save')}
          </Button>
        </div>
      </form>
    </SettingsCard>
  )
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string | undefined; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-ui-small text-muted-foreground">
        {label}
      </label>
      {children}
      {hint !== undefined && <p className="text-ui-small text-muted-foreground">{hint}</p>}
    </div>
  )
}
