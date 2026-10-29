import type { AvailableModel, SessionModel, ThinkingLevel } from '@coko/protocol'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@coko/ui'
import { ChevronDownIcon } from 'lucide-react'
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

/**
 * 输入区的模型选择：按 Provider 分组。会话的模型已不在可用列表中时仍显示其 id。当前模型除 off 外还有可选档位时（推理开关打开且
 * 配置了档位），菜单末尾列出推理档位。
 */
export function ModelPicker({ models, value, thinkingLevel, disabled, onChange }: ModelPickerProps) {
  const { t } = useI18n()
  const groups = React.useMemo(() => {
    const byProvider = new Map<string, { name: string; models: AvailableModel[] }>()
    for (const model of models) {
      const group = byProvider.get(model.providerId) ?? { name: model.providerName, models: [] }
      group.models.push(model)
      byProvider.set(model.providerId, group)
    }
    return [...byProvider.entries()]
  }, [models])
  const current = value ? models.find((m) => m.providerId === value.providerId && m.modelId === value.modelId) : undefined
  const label = current?.name ?? value?.modelId ?? t('models.picker')
  const levels = current && current.thinkingLevels.length > 1 ? current.thinkingLevels : []
  const level = current ? levelForModel(current, thinkingLevel) : 'off'

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="toolbar"
              size="sm"
              disabled={disabled}
              data-model-picker
              data-model={value ? `${value.providerId}/${value.modelId}` : undefined}
              data-thinking-level-current={levels.length > 0 ? level : undefined}
              aria-label={t('models.pickerCurrent', { model: label })}
              // 窄输入区中可收缩并截断（完整名称在菜单中）。
              className="max-w-48 min-w-0 shrink"
            >
              <span data-user-content={value ? '' : undefined} className="truncate">
                {label}
              </span>
              {levels.length > 0 && level !== 'off' && <span className="shrink-0 text-muted-foreground">{t(`models.thinkingLevels.${level}`)}</span>}
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">{t('models.picker')}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="top" align="end" className="max-w-72">
        <DropdownMenuRadioGroup
          value={value ? keyOf(value) : ''}
          onValueChange={(key) => {
            const model = models.find((m) => keyOf(m) === key)
            if (model) onChange({ providerId: model.providerId, modelId: model.modelId }, levelForModel(model, level))
          }}
        >
          {groups.map(([providerId, group]) => (
            <DropdownMenuGroup key={providerId}>
              <DropdownMenuLabel data-user-content className="truncate">
                {group.name}
              </DropdownMenuLabel>
              {group.models.map((model) => (
                <DropdownMenuRadioItem key={model.modelId} value={keyOf(model)}>
                  <span data-user-content className="truncate">
                    {model.name}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuGroup>
          ))}
        </DropdownMenuRadioGroup>
        {current && levels.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t('models.thinkingLevel')}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={level}
                onValueChange={(next) => onChange({ providerId: current.providerId, modelId: current.modelId }, next as ThinkingLevel)}
              >
                {levels.map((option) => (
                  <DropdownMenuRadioItem key={option} value={option} data-thinking-level={option}>
                    {t(`models.thinkingLevels.${option}`)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
