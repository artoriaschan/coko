import type { AvailableModel, SessionModel, ThinkingLevel } from '@coko/protocol'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuItem,
  ThinkingSlider,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@coko/ui'
import { BotIcon, ChevronDownIcon, ChevronRightIcon } from 'lucide-react'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'

const keyOf = (model: SessionModel) => `${model.providerId}\u0000${model.modelId}`

/** 换模型时的档位：新模型能选当前档位时保留，否则回到 off（与 Sidecar 的规则一致）。 */
export const levelForModel = (model: Pick<AvailableModel, 'thinkingLevels'>, level: ThinkingLevel): ThinkingLevel =>
  model.thinkingLevels.includes(level) ? level : 'off'

export interface ModelPickerProps {
  models: readonly AvailableModel[]
  /** 当前会话（或草稿将使用）的模型；null 表示尚无模型。 */
  value: SessionModel | null
  /** 当前会话（或草稿）的 Thinking Level。 */
  thinkingLevel: ThinkingLevel
  disabled: boolean
  /** 模型与档位总是一起给出：换模型时档位按 levelForModel 调整。 */
  onChange: (model: SessionModel, thinkingLevel: ThinkingLevel) => void
}

/** 同一共享菜单表面在当前详情和供应商列表之间替换，选择后保留详情。 */
export function ModelPicker({ models, value, thinkingLevel, disabled, onChange }: ModelPickerProps) {
  const { t } = useI18n()
  const [open, setOpen] = React.useState(false)
  const [view, setView] = React.useState<'detail' | 'list'>('detail')
  const content = React.useRef<HTMLDivElement>(null)
  const current = value ? models.find((m) => keyOf(m) === keyOf(value)) : undefined
  const label = current?.name ?? t('models.picker')
  const [preview, setPreview] = React.useState<ThinkingLevel | null>(null)
  const level = current ? levelForModel(current, preview ?? thinkingLevel) : 'off'
  const groups = React.useMemo(() => {
    const result = new Map<string, { name: string; models: AvailableModel[] }>()
    for (const model of models) {
      const group = result.get(model.providerId) ?? { name: model.providerName, models: [] }
      group.models.push(model)
      result.set(model.providerId, group)
    }
    return [...result.entries()]
  }, [models])
  const detail = view === 'detail' && current !== undefined
  React.useLayoutEffect(() => {
    content.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"], [role="menuitemradio"], [role="menuitem"]')?.focus()
  }, [view, detail])
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setView(current ? 'detail' : 'list')
        else setPreview(null)
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="toolbar"
              size="sm"
              disabled={disabled || models.length === 0}
              data-model-picker
              data-model={current ? `${current.providerId}/${current.modelId}` : undefined}
              data-thinking-level-current={level}
              aria-label={t('models.pickerCurrent', { model: label })}
              className="max-w-48 min-w-0 shrink data-[state=open]:bg-accent"
            >
              <span data-user-content={current ? '' : undefined} className="truncate">
                {label}
              </span>
              {level !== 'off' && <span className="shrink-0 text-muted-foreground">{t(`models.thinkingLevels.${level}`)}</span>}
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">{t('models.picker')}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        ref={content}
        side="top"
        align="end"
        className="w-70 max-w-[calc(100vw-16px)]"
        data-model-view={detail ? 'detail' : 'list'}
        onKeyDownCapture={(event) => {
          if (detail && event.key === 'Tab') event.stopPropagation()
        }}
      >
        {detail ? (
          <>
            <DropdownMenuItem
              aria-label={t('models.pickerCurrent', { model: label })}
              className="mx-auto mt-2 mb-3 h-12 w-fit min-w-36 flex-col justify-center gap-0 px-3"
              onSelect={(event) => {
                event.preventDefault()
                setView('list')
              }}
            >
              <span className="text-ui-title">{t(`models.thinkingLevels.${level}`)}</span>
              <span className="flex max-w-full items-center gap-1.5 text-muted-foreground">
                <BotIcon className="size-3.5" aria-hidden />
                <span data-user-content className="truncate">
                  {label}
                </span>
                <ChevronRightIcon className="size-3" aria-hidden />
              </span>
            </DropdownMenuItem>
            <div className="mx-2 mb-2">
              <ThinkingSlider
                levels={current.thinkingLevels}
                value={level}
                labels={{
                  off: t('models.thinkingLevels.off'),
                  minimal: t('models.thinkingLevels.minimal'),
                  low: t('models.thinkingLevels.low'),
                  medium: t('models.thinkingLevels.medium'),
                  high: t('models.thinkingLevels.high'),
                  xhigh: t('models.thinkingLevels.xhigh'),
                  max: t('models.thinkingLevels.max'),
                }}
                label={t('models.thinkingLevel')}
                active={open}
                onValueChange={setPreview}
                onValueCommit={async (next) => {
                  try {
                    await onChange({ providerId: current.providerId, modelId: current.modelId }, next)
                  } finally {
                    setPreview(null)
                  }
                }}
              />
            </div>
          </>
        ) : (
          <>
            <DropdownMenuLabel>{t('models.picker')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={current ? keyOf(current) : ''}>
              {groups.map(([providerId, group]) => (
                <DropdownMenuGroup key={providerId}>
                  <DropdownMenuLabel data-user-content>{group.name}</DropdownMenuLabel>
                  {group.models.map((model) => (
                    <DropdownMenuRadioItem
                      key={model.modelId}
                      value={keyOf(model)}
                      indicatorAlign="end"
                      onSelect={(event) => {
                        event.preventDefault()
                        setPreview(null)
                        onChange({ providerId: model.providerId, modelId: model.modelId }, levelForModel(model, level))
                        setView('detail')
                      }}
                    >
                      <BotIcon aria-hidden className="size-3.5" />
                      <span data-user-content className="truncate">
                        {model.name}
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuGroup>
              ))}
            </DropdownMenuRadioGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
