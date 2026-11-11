import { CYCLED_PERMISSION_MODES, type PermissionMode, type StandardPermissionMode } from '@coko/protocol'
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@coko/ui'
import { IconClipboardList, IconEye, IconHandStop, IconShieldExclamation, IconShield, IconTerminal } from '@tabler/icons-react'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import { PermissionRiskDialog } from './permission-risk-dialog.tsx'

/** 设置中的默认模式仍为四档；输入区快捷菜单只展示三档。 */
export const PERMISSION_MODES: readonly StandardPermissionMode[] = ['read-only', 'default', 'accept-edits', 'full-access']

export const MODE_ICONS: Record<PermissionMode, React.ComponentType<{ className?: string }>> = {
  'read-only': IconEye,
  default: IconHandStop,
  'accept-edits': ShieldTerminalIcon,
  'full-access': IconShieldExclamation,
  plan: IconClipboardList,
}

/** Shift+Tab 的下一档：只在前三档之间循环（不含 plan）；从 full-access 或 plan 回到第一档。 */
export function nextCycledMode(mode: PermissionMode): PermissionMode {
  const index = CYCLED_PERMISSION_MODES.indexOf(mode as (typeof CYCLED_PERMISSION_MODES)[number])
  return CYCLED_PERMISSION_MODES[(index + 1) % CYCLED_PERMISSION_MODES.length]!
}

function ShieldTerminalIcon({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn('relative inline-flex size-3.5 shrink-0', className)}>
      <IconShield aria-hidden className="size-3.5" />
      <IconTerminal aria-hidden className="absolute inset-1 size-1.5" />
    </span>
  )
}

export interface ModePickerProps {
  value: PermissionMode
  prior?: PermissionMode
  disabled?: boolean
  onChange: (mode: PermissionMode) => void
}

/** 输入区的 Permission Mode 选择（模型选择旁）。full-access 只能在此显式选择，选中时以警示色显示。 */
export function ModePicker({ value, prior = 'default', disabled, onChange }: ModePickerProps) {
  const { t } = useI18n()
  const shown = value === 'plan' ? (prior === 'plan' ? 'default' : prior) : value
  const Icon = MODE_ICONS[shown]
  const label = t(`permissions.modes.${shown}`)
  const warning = shown === 'full-access'
  const [open, setOpen] = React.useState(false)
  const [riskOpen, setRiskOpen] = React.useState(false)
  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="toolbar"
                size="toolbar"
                disabled={disabled}
                data-permission-mode={value}
                data-warning={warning || undefined}
                aria-label={t('permissions.modeCurrent', { mode: label })}
                className={cn(
                  // Tooltip 会覆盖触发器的 data-state，展开态用组件自身的 open 控制。
                  'min-w-0 shrink rounded-round pl-2 pr-3',
                  warning
                    ? cn('text-warning-text hover:bg-warning-text/8 hover:text-foreground', open && 'bg-warning-text/8 text-foreground')
                    : cn('hover:text-muted-foreground', open && 'bg-accent'),
                )}
              >
                <Icon className="size-3.5" />
                {/* 窄主区中只显示图标（名称在 aria-label 与菜单中），让编辑区保留宽度。 */}
                <span className="truncate @max-[560px]/main:hidden">{label}</span>
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">
            {/* 窄宽度下按钮只有图标：Tooltip 同时给出当前模式。 */}
            <span className="block">{label}</span>
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent side="top" align="start" className="w-81">
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(next) => {
              // 完全访问越出工作区，先确认风险；其余档位立即生效。
              if (next === 'full-access') setRiskOpen(true)
              else onChange(next as PermissionMode)
            }}
          >
            {(['default', 'accept-edits', 'full-access'] as const).map((mode) => {
              const ModeIcon = MODE_ICONS[mode]
              const warned = mode === 'full-access'
              return (
                <DropdownMenuRadioItem
                  key={mode}
                  value={mode}
                  data-mode={mode}
                  indicatorAlign="end"
                  className={cn(
                    // 选项 H44/R12，图标 16 独立一列，名称与说明在右列；选中项铺 accent，勾选标记继承项色。
                    'h-11 gap-2 data-[state=checked]:bg-accent [&>span>span>svg]:text-inherit!',
                    warned ? 'text-warning-text' : 'text-foreground',
                  )}
                >
                  <ModeIcon className={cn('size-4 shrink-0', warned ? 'text-warning-text' : 'text-foreground')} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-ui-body leading-5">{t(`permissions.modes.${mode}`)}</span>
                    <span
                      title={t(`permissions.modeDescriptions.${mode}`)}
                      className={cn('truncate text-ui-small leading-[18px]', warned ? 'text-warning-text' : 'text-muted-foreground')}
                    >
                      {t(`permissions.modeDescriptions.${mode}`)}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              )
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <PermissionRiskDialog
        open={riskOpen}
        onOpenChange={setRiskOpen}
        onConfirm={() => {
          setRiskOpen(false)
          onChange('full-access')
        }}
      />
    </>
  )
}
