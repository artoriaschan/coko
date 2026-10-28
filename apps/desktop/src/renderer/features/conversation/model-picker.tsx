import type { AvailableModel, SessionModel } from '@coko/protocol'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@coko/ui'
import { ChevronDownIcon } from 'lucide-react'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'

const keyOf = (model: SessionModel) => `${model.providerId}\u0000${model.modelId}`

export interface ModelPickerProps {
  models: readonly AvailableModel[]
  /** 当前会话（或草稿将使用）的模型；null 表示尚无模型。 */
  value: SessionModel | null
  disabled: boolean
  onChange: (model: SessionModel) => void
}

/** 输入区的模型选择：按 Provider 分组。会话的模型已不在可用列表中时仍显示其 id。 */
export function ModelPicker({ models, value, disabled, onChange }: ModelPickerProps) {
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
              aria-label={t('models.pickerCurrent', { model: label })}
              // 窄输入区中可收缩并截断（完整名称在菜单中）。
              className="max-w-48 min-w-0 shrink"
            >
              <span data-user-content={value ? '' : undefined} className="truncate">
                {label}
              </span>
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
            if (model) onChange({ providerId: model.providerId, modelId: model.modelId })
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
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
