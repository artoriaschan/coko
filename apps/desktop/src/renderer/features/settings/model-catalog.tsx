import type { MessageKey } from '@coko/i18n'
import { MODEL_CATALOG_DEFAULTS, USAGE_CURRENCY_SETTING, usageCurrencyOf, type CatalogModel } from '@coko/protocol'
import { Button, Checkbox, cn, Input, Tooltip, TooltipContent, TooltipTrigger } from '@coko/ui'
import { ChevronDownIcon, ChevronRightIcon, CircleAlertIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import { useSettings } from '../../app/settings.tsx'
import { ThinkingLevelsEditor } from './thinking-levels-editor.tsx'
import { emptyModelRow, formatTokens, PRICE_FIELDS, type CatalogErrors, type ModelRowDraft, type ModelRowField, type PriceField } from './catalog-draft.ts'

const PRICE_LABELS: Record<PriceField, MessageKey> = {
  priceInput: 'usage.price.input',
  priceOutput: 'usage.price.output',
  priceCacheRead: 'usage.price.cacheRead',
  priceCacheWrite: 'usage.price.cacheWrite',
}

/** 显示货币的符号（设置 usage.currency）。 */
const CURRENCY_SYMBOLS = { USD: '$', CNY: '¥' } as const

const INPUT_KINDS: CatalogModel['input'][number][] = ['text', 'image']

type FocusTarget = { kind: 'row'; key: string } | { kind: 'add' }

/**
 * 供应商表单中的模型目录（规格 4.4、4.5）：逐行填写模型 ID 与显示名称，展开后配置容量与输入类型。行草稿由表单持有，
 * 展开状态只是显示状态，不进入草稿；添加、删除与收起都不提交。revealErrors 每次变化（提交校验失败）时展开有容量错误的行，
 * 使表单能聚焦到出错的输入框。展开的选项另有价格（每百万 token，留空为未定价）。
 */
export function ModelCatalog({
  id,
  rows,
  onChange,
  errors = {},
  emptyError,
  revealErrors,
  actions,
}: {
  id: string
  rows: readonly ModelRowDraft[]
  onChange: (rows: ModelRowDraft[]) => void
  errors?: CatalogErrors | undefined
  /** 空目录的错误文案。 */
  emptyError?: string | undefined
  revealErrors: number
  /** 目录标题行右侧的操作（获取可用模型）。 */
  actions?: React.ReactNode
}) {
  const { t } = useI18n()
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(() => new Set())
  const [revealed, setRevealed] = React.useState(revealErrors)
  const focusAfter = React.useRef<FocusTarget | null>(null)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const headingId = `${id}-heading`
  const emptyErrorId = `${id}-error`

  // 在渲染中同步展开，父表单的聚焦 effect 运行时出错的容量输入框已经在 DOM 中。
  if (revealed !== revealErrors) {
    setRevealed(revealErrors)
    // 容量与价格在展开的选项中：有这些错误的行展开。
    const hidden = rows.filter((row) => !expanded.has(row.key) && Object.keys(errors[row.key] ?? {}).some((field) => field !== 'id'))
    if (hidden.length > 0) setExpanded(new Set([...expanded, ...hidden.map((row) => row.key)]))
  }

  // 新增后聚焦新行的模型 ID；删除后聚焦相邻行或“添加模型”，不落到 body。
  React.useEffect(() => {
    const target = focusAfter.current
    if (!target) return
    focusAfter.current = null
    const selector = target.kind === 'add' ? '[data-model-add]' : `[data-model-row-key="${CSS.escape(target.key)}"] [name="modelId"]`
    rootRef.current?.querySelector<HTMLElement>(selector)?.focus()
  })

  const add = () => {
    const row = emptyModelRow()
    focusAfter.current = { kind: 'row', key: row.key }
    onChange([...rows, row])
  }
  const update = (key: string, patch: Partial<ModelRowDraft>) => onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  const remove = (key: string) => {
    const index = rows.findIndex((row) => row.key === key)
    const neighbour = rows[index + 1] ?? rows[index - 1]
    focusAfter.current = neighbour ? { kind: 'row', key: neighbour.key } : { kind: 'add' }
    onChange(rows.filter((row) => row.key !== key))
  }
  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })

  return (
    <div ref={rootRef} className="flex flex-col gap-3">
      <div className="flex min-h-7 flex-wrap items-center justify-between gap-2">
        <h4 id={headingId} className="text-ui-body-lg font-medium">
          {t('providers.models')}
        </h4>
        {actions}
      </div>
      {rows.length === 0 ? (
        <p className="text-ui-small text-muted-foreground">{t('providers.catalog.empty')}</p>
      ) : (
        <ul aria-labelledby={headingId} className="flex flex-col gap-2">
          {rows.map((row) => (
            <ModelRow
              key={row.key}
              id={`${id}-${row.key}`}
              row={row}
              errors={errors[row.key] ?? {}}
              expanded={expanded.has(row.key)}
              onChange={(patch) => update(row.key, patch)}
              onToggle={() => toggle(row.key)}
              onRemove={() => remove(row.key)}
            />
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-1">
        <Button
          data-model-add
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={add}
          {...(emptyError !== undefined ? { 'aria-invalid': true, 'aria-describedby': emptyErrorId } : {})}
        >
          <PlusIcon />
          {t('providers.catalog.add')}
        </Button>
        {emptyError !== undefined && <FieldError id={emptyErrorId}>{emptyError}</FieldError>}
        <p className="text-ui-caption text-muted-foreground">{t('providers.catalog.hint')}</p>
      </div>
    </div>
  )
}

/** 一个模型：紧凑行为模型 ID、显示名称、展开与删除；展开后在行内向下显示容量与输入类型。 */
function ModelRow({
  id,
  row,
  errors,
  expanded,
  onChange,
  onToggle,
  onRemove,
}: {
  id: string
  row: ModelRowDraft
  errors: Partial<Record<ModelRowField, MessageKey>>
  expanded: boolean
  onChange: (patch: Partial<ModelRowDraft>) => void
  onToggle: () => void
  onRemove: () => void
}) {
  const { t } = useI18n()
  const currency = useSettings((s) => usageCurrencyOf(s.values[USAGE_CURRENCY_SETTING]?.value))
  const optionsId = `${id}-options`
  const idError = errors.id && t(errors.id)
  const invalid = Object.keys(errors).length > 0
  return (
    <li
      data-model-row
      data-model-row-key={row.key}
      data-expanded={expanded || undefined}
      data-invalid={invalid || undefined}
      className={cn('flex flex-col gap-3 rounded-lg border-hairline border-card-stroke p-2.5', expanded && 'bg-muted')}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Input
            name="modelId"
            aria-label={t('providers.catalog.id')}
            placeholder={t('providers.catalog.id')}
            value={row.id}
            onChange={(e) => onChange({ id: e.target.value })}
            autoComplete="off"
            spellCheck={false}
            className="flex-1 font-mono"
            {...(idError ? { 'aria-invalid': true, 'aria-describedby': `${id}-id-error` } : {})}
          />
          <Input
            name="modelName"
            aria-label={t('providers.catalog.name')}
            // 显示名称留空时使用模型 ID。
            placeholder={row.id.trim() || t('providers.catalog.namePlaceholder')}
            value={row.name}
            onChange={(e) => onChange({ name: e.target.value })}
            autoComplete="off"
            className="flex-1"
          />
          <IconButton label={t('providers.catalog.options')} aria-expanded={expanded} aria-controls={optionsId} onClick={onToggle}>
            {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
          </IconButton>
          <IconButton label={t('providers.catalog.remove')} onClick={onRemove}>
            <Trash2Icon />
          </IconButton>
        </div>
        {idError && <FieldError id={`${id}-id-error`}>{idError}</FieldError>}
      </div>
      {expanded && (
        <div id={optionsId} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            {(['contextWindow', 'maxTokens'] as const).map((field) => (
              <TokenField
                key={field}
                id={`${id}-${field}`}
                name={field}
                label={t(`providers.catalog.${field}`)}
                placeholder={formatTokens(MODEL_CATALOG_DEFAULTS[field])}
                value={row[field]}
                error={errors[field] && t(errors[field])}
                onChange={(value) => onChange({ [field]: value })}
              />
            ))}
          </div>
          <div role="group" aria-labelledby={`${id}-input`} className="flex min-h-6 items-center gap-4">
            <span id={`${id}-input`} className="text-ui-small text-muted-foreground">
              {t('providers.catalog.input')}
            </span>
            {INPUT_KINDS.map((kind) => {
              const checked = row.input.includes(kind)
              return (
                <label key={kind} className="inline-flex items-center gap-1.5 text-ui-body">
                  <Checkbox
                    name={`input-${kind}`}
                    checked={checked}
                    // 至少保留一种输入类型。
                    disabled={checked && row.input.length === 1}
                    onCheckedChange={(next) => onChange({ input: INPUT_KINDS.filter((k) => (k === kind ? next === true : row.input.includes(k))) })}
                  />
                  {t(`providers.catalog.inputs.${kind}`)}
                </label>
              )
            })}
          </div>
          <div aria-hidden className="h-hairline shrink-0 bg-border" />
          <div role="group" aria-labelledby={`${id}-price`} aria-describedby={`${id}-price-hint`} data-model-price className="flex flex-col gap-2">
            <span id={`${id}-price`} className="text-ui-small text-muted-foreground">
              {t('usage.price.title', { symbol: CURRENCY_SYMBOLS[currency] })}
            </span>
            <div className="grid grid-cols-2 gap-3">
              {PRICE_FIELDS.map((field) => (
                <TokenField
                  key={field}
                  id={`${id}-${field}`}
                  name={field}
                  label={t(PRICE_LABELS[field])}
                  placeholder=""
                  value={row[field]}
                  error={errors[field] && t(errors[field])}
                  onChange={(value) => onChange({ [field]: value })}
                />
              ))}
            </div>
            <p id={`${id}-price-hint`} className="text-ui-caption text-muted-foreground">
              {t('usage.price.hint')}
            </p>
          </div>
          <div aria-hidden className="h-hairline shrink-0 bg-border" />
          <ThinkingLevelsEditor id={`${id}-thinking`} reasoning={row.reasoning} levels={row.thinkingLevels} onChange={onChange} />
        </div>
      )}
    </li>
  )
}

function TokenField({
  id,
  name,
  label,
  placeholder,
  value,
  error,
  onChange,
}: {
  id: string
  name: string
  label: string
  placeholder: string
  value: string
  error: string | undefined
  onChange: (value: string) => void
}) {
  const errorId = `${id}-error`
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-ui-small text-muted-foreground">
        {label}
      </label>
      <Input
        id={id}
        name={name}
        value={value}
        placeholder={placeholder}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        {...(error ? { 'aria-invalid': true, 'aria-describedby': errorId } : {})}
      />
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  )
}

/** 仅图标的行内操作：可访问名称与 Tooltip 使用同一条文案。 */
function IconButton({ label, ...props }: { label: string } & Omit<React.ComponentProps<typeof Button>, 'aria-label'>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="outline" size="icon-sm" aria-label={label} {...props} />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} data-field-error className="flex items-start gap-1.5 text-ui-small text-destructive">
      <CircleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      {children}
    </p>
  )
}
