import type { MessageKey } from '@coko/i18n'
import { ModelProtocol, type Provider } from '@coko/protocol'
import { Button, cn, DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger, Input, toast } from '@coko/ui'
import { ChevronDownIcon, CircleAlertIcon } from 'lucide-react'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import { useSettingsActions } from '../../app/settings.tsx'
import type { ProviderSaveErrorCode } from '../../../shared/bridge.ts'
import { toProviderDraft, validateDraft, type DraftErrors, type DraftField, type FormDraft } from './provider-draft.ts'

/** 协议下拉的顺序即协议 schema 中的顺序；默认 OpenAI Chat Completions。 */
const PROTOCOLS: ModelProtocol[] = ModelProtocol.anyOf.map((literal) => literal.const)

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

/**
 * 列表内的供应商表单（规格 4.2、4.3）。草稿由列表持有（判断未保存修改），表单负责校验与一次提交；
 * 新建与编辑共用字段，编辑时 Provider ID 为静态文本，Key 留空表示保留原 Credential。
 */
export function ProviderForm({
  id,
  provider,
  draft,
  onChange,
  takenIds,
  onCancel,
  onSaved,
}: {
  id: string
  /** 编辑的已有 Provider；新建时省略。 */
  provider?: Provider | undefined
  draft: FormDraft
  onChange: (draft: FormDraft) => void
  takenIds: readonly string[]
  onCancel: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const { saveProvider } = useSettingsActions()
  const formRef = React.useRef<HTMLFormElement>(null)
  const [errors, setErrors] = React.useState<DraftErrors>({})
  const [formError, setFormError] = React.useState<string | null>(null)
  /** 服务端错误的技术原文：只放在可展开的详情中。 */
  const [detail, setDetail] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [focusTick, setFocusTick] = React.useState(0)
  const isNew = provider === undefined

  // 校验失败后聚焦第一个出错的字段。
  React.useEffect(() => {
    if (focusTick > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [focusTick])

  const update = (field: keyof FormDraft, value: string) => {
    onChange({ ...draft, [field]: value })
    if (field in errors)
      setErrors((current) => {
        const next = { ...current }
        delete next[field as DraftField]
        return next
      })
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return
    const found = validateDraft(draft, { isNew, takenIds })
    setErrors(found)
    setFormError(null)
    setDetail(null)
    if (Object.keys(found).length > 0) return setFocusTick((n) => n + 1)
    setSaving(true)
    const result = await saveProvider(toProviderDraft(draft, provider))
    setSaving(false)
    if (result.ok) {
      toast.success(t('providers.saved'))
      onSaved()
      return
    }
    // 整次提交失败：配置与 Key 都没有保存，表单保留草稿以便修改或重试。
    if (result.code === 'already-exists') {
      setErrors({ providerId: 'providers.idTaken' })
      setFocusTick((n) => n + 1)
    }
    setFormError(t(PROVIDER_ERROR_KEYS[result.code] ?? 'providers.saveFailed'))
    setDetail(`${result.message} (${result.code})`)
    toast.error(t('providers.saveFailed'))
  }

  const field = (name: DraftField) => ({ id: `${id}-${name}`, error: errors[name] && t(errors[name]) })

  const idField = (
    <Field {...field('providerId')} label={t('providers.id')} hint={t('providers.idHint')}>
      {(aria) => (
        <Input
          {...aria}
          name="providerId"
          value={draft.providerId}
          onChange={(e) => update('providerId', e.target.value)}
          placeholder={t('providers.idPlaceholder')}
          autoComplete="off"
          spellCheck={false}
          autoFocus
          className="font-mono"
        />
      )}
    </Field>
  )
  const nameField = (
    <Field {...field('name')} label={t('providers.name')}>
      {(aria) => <Input {...aria} name="name" value={draft.name} onChange={(e) => update('name', e.target.value)} autoComplete="off" />}
    </Field>
  )
  const urlField = (
    <Field {...field('baseUrl')} label={t('providers.baseUrl')}>
      {(aria) => (
        <Input
          {...aria}
          name="baseUrl"
          type="url"
          value={draft.baseUrl}
          onChange={(e) => update('baseUrl', e.target.value)}
          placeholder={t('providers.baseUrlPlaceholder')}
          autoComplete="off"
          spellCheck={false}
        />
      )}
    </Field>
  )
  const protocolField = (
    <Field id={`${id}-protocol`} label={t('providers.protocol')}>
      {(aria) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button {...aria} type="button" variant="outline" data-protocol={draft.api} className="w-full justify-between px-3 font-normal">
              {t(`providers.protocols.${draft.api}`)}
              <ChevronDownIcon className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width)">
            <DropdownMenuRadioGroup value={draft.api} onValueChange={(value) => update('api', value)}>
              {PROTOCOLS.map((protocol) => (
                <DropdownMenuRadioItem key={protocol} value={protocol} data-protocol={protocol}>
                  {t(`providers.protocols.${protocol}`)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </Field>
  )
  const secretField = (
    <Field {...field('secret')} label={t('providers.credential')}>
      {(aria) => (
        <Input
          {...aria}
          name="credential"
          type="password"
          value={draft.secret}
          onChange={(e) => update('secret', e.target.value)}
          placeholder={t(isNew ? 'providers.credentialPlaceholder' : 'providers.credentialKeep')}
          autoComplete="off"
          spellCheck={false}
        />
      )}
    </Field>
  )

  return (
    <form
      ref={formRef}
      id={id}
      data-provider-form={isNew ? 'create' : 'edit'}
      className="flex flex-col gap-3"
      onSubmit={(event) => void submit(event)}
      noValidate
    >
      {isNew ? (
        <div className="flex flex-col gap-1">
          <h3 className="text-ui-title font-medium">{t('providers.formTitle')}</h3>
          <p className="text-ui-small text-muted-foreground">{t('providers.formDescription')}</p>
        </div>
      ) : (
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2.5">
          <span data-user-content className="min-w-0 truncate text-ui-title font-medium" title={provider.name}>
            {provider.name}
          </span>
          <span data-user-content data-provider-static-id className="font-mono text-ui-small text-muted-foreground">
            {provider.id}
          </span>
        </p>
      )}
      {isNew ? (
        <div className="flex flex-col gap-2">
          {idField}
          {nameField}
          {urlField}
          {protocolField}
          {secretField}
        </div>
      ) : (
        <>
          {secretField}
          <Separator />
          <h4 className="text-ui-body font-medium">{t('providers.settingsHeading')}</h4>
          <div className="flex flex-col gap-2">
            {nameField}
            {urlField}
            {protocolField}
          </div>
        </>
      )}
      <Separator />
      <Field {...field('modelText')} label={t('providers.models')} hint={t('providers.modelsHint')} heading>
        {(aria) => (
          <Input
            {...aria}
            name="models"
            value={draft.modelText}
            onChange={(e) => update('modelText', e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
        )}
      </Field>
      {formError !== null && (
        <div className="flex flex-col gap-1">
          <p role="alert" className="flex items-start gap-1.5 text-ui-small text-destructive">
            <CircleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {formError}
          </p>
          {detail !== null && (
            <details className="text-ui-small text-muted-foreground">
              <summary className="cursor-pointer select-none">{t('providers.errorDetail')}</summary>
              <p data-error-detail data-user-content className="mt-1 break-words select-text">
                {detail}
              </p>
            </details>
          )}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>
          {t('providers.cancel')}
        </Button>
        <Button type="submit" disabled={saving} aria-busy={saving || undefined}>
          {t(isNew ? 'providers.create' : 'providers.save')}
        </Button>
      </div>
    </form>
  )
}

function Separator() {
  return <div aria-hidden className="h-hairline shrink-0 bg-border" />
}

interface FieldAria {
  id: string
  'aria-invalid'?: true
  'aria-describedby'?: string
}

/** 标签、控件与提示；错误以图标和文字显示在控件下方并关联为无障碍描述，不只靠边框颜色。 */
function Field({
  id,
  label,
  hint,
  error,
  heading = false,
  children,
}: {
  id: string
  label: string
  hint?: string | undefined
  error?: string | undefined
  /** 作为分组标题显示的标签（模型目录）。 */
  heading?: boolean
  children: (aria: FieldAria) => React.ReactNode
}) {
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [error !== undefined && errorId, hint !== undefined && hintId].filter(Boolean).join(' ')
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={cn(heading ? 'text-ui-body-lg font-medium' : 'text-ui-small text-muted-foreground')}>
        {label}
      </label>
      {children({ id, ...(error !== undefined ? { 'aria-invalid': true } : {}), ...(describedBy ? { 'aria-describedby': describedBy } : {}) })}
      {error !== undefined && (
        <p id={errorId} data-field-error className="flex items-start gap-1.5 text-ui-small text-destructive">
          <CircleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      )}
      {hint !== undefined && (
        <p id={hintId} className="text-ui-caption text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  )
}
