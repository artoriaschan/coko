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
  ProviderIcon,
  ThinkingSlider,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  type ThinkingSliderValue,
} from '@coko/ui'
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'

const keyOf = (model: SessionModel) => `${model.providerId}\u0000${model.modelId}`

/** 推理等级名称与设置中登记的档位一致（off / minimal / …）；英文档位首字母大写。 */
const LEVEL_NAMES: Record<ThinkingSliderValue, string> = {
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Xhigh',
  max: 'Max',
}

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
              className="h-auto min-h-7 min-w-0 shrink gap-1 rounded-round px-2.5 py-0.5 text-left whitespace-normal data-[state=open]:bg-accent"
            >
              {/* 模型名与档位完整展示：放不下时模型名换行，按钮高度随内容增长。 */}
              <span data-user-content={current ? '' : undefined} className="min-w-0 break-words">
                {label}
              </span>
              {current !== undefined && (
                <>
                  <span aria-hidden className="shrink-0 text-muted-foreground">
                    ·
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-muted-foreground">{LEVEL_NAMES[level]}</span>
                </>
              )}
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
          <div className="flex flex-col items-center gap-3 p-2">
            <DropdownMenuItem
              aria-label={t('models.pickerCurrent', { model: label })}
              className="min-h-12 w-fit min-w-36 flex-col justify-center gap-0 px-3 py-1.5"
              onSelect={(event) => {
                event.preventDefault()
                setView('list')
              }}
            >
              <span className="text-ui-title leading-6 font-medium text-link">{LEVEL_NAMES[level]}</span>
              <span className="flex min-h-5 max-w-full items-center gap-1.5 text-muted-foreground">
                <ProviderIcon variant="mono" modelId={current.modelId} name={current.name} id={current.providerId} />
                {/* 当前模型名完整展示，不省略。 */}
                <span data-user-content className="min-w-0 break-words">
                  {label}
                </span>
                <ChevronRightIcon className="size-3 shrink-0" aria-hidden />
              </span>
            </DropdownMenuItem>
            <div className="w-full">
              <ThinkingSlider
                levels={current.thinkingLevels}
                value={level}
                labels={LEVEL_NAMES}
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
          </div>
        ) : (
          <>
            <DropdownMenuLabel className="flex h-7 items-center px-2 pt-0 pb-0 text-ui-small">{t('models.picker')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={current ? keyOf(current) : ''}>
              {groups.map(([providerId, group], index) => (
                <DropdownMenuGroup key={providerId} className={index === 0 ? undefined : 'pt-2'}>
                  {/* 供应商名称不配图标；模型行按模型名称/ID 显示品牌图标。 */}
                  <DropdownMenuLabel data-user-content className="flex h-6 items-center px-2 pt-0 pb-0 text-ui-body font-medium">
                    <span className="truncate">{group.name}</span>
                  </DropdownMenuLabel>
                  {group.models.map((model) => (
                    <DropdownMenuRadioItem
                      key={model.modelId}
                      value={keyOf(model)}
                      indicatorAlign="end"
                      className="h-auto min-h-8 py-1 data-[state=checked]:bg-accent"
                      onSelect={(event) => {
                        event.preventDefault()
                        setPreview(null)
                        onChange({ providerId: model.providerId, modelId: model.modelId }, levelForModel(model, level))
                        setView('detail')
                      }}
                    >
                      <ProviderIcon variant="mono" modelId={model.modelId} name={model.name} id={model.providerId} />
                      {/* 模型名完整展示：放不下时换行，行高随内容增长。 */}
                      <span data-user-content className="min-w-0 break-words">
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
