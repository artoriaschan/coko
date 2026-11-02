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
import { ClipboardListIcon, EyeIcon, HandIcon, ShieldAlertIcon, ShieldIcon, TerminalIcon } from 'lucide-react'
import type * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'

/** 设置中的默认模式仍为四档；输入区快捷菜单只展示三档。 */
export const PERMISSION_MODES: readonly StandardPermissionMode[] = ['read-only', 'default', 'accept-edits', 'full-access']

export const MODE_ICONS: Record<PermissionMode, React.ComponentType<{ className?: string }>> = {
  'read-only': EyeIcon,
  default: HandIcon,
  'accept-edits': ShieldTerminalIcon,
  'full-access': ShieldAlertIcon,
  plan: ClipboardListIcon,
}

/** Shift+Tab 的下一档：只在前三档之间循环（不含 plan）；从 full-access 或 plan 回到第一档。 */
export function nextCycledMode(mode: PermissionMode): PermissionMode {
  const index = CYCLED_PERMISSION_MODES.indexOf(mode as (typeof CYCLED_PERMISSION_MODES)[number])
  return CYCLED_PERMISSION_MODES[(index + 1) % CYCLED_PERMISSION_MODES.length]!
}

function ShieldTerminalIcon({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn('relative inline-flex size-3.5 shrink-0', className)}>
      <ShieldIcon className="size-3.5" />
      <TerminalIcon className="absolute inset-1 size-1.5" />
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
  return (
    <DropdownMenu>
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
                'min-w-0 shrink data-[state=open]:bg-accent hover:text-muted-foreground',
                warning && 'text-destructive [&_svg]:text-destructive hover:bg-destructive/10 hover:text-destructive data-[state=open]:bg-destructive/10',
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
      <DropdownMenuContent side="top" align="start" className="w-80">
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(next as PermissionMode)}>
          {(['default', 'accept-edits', 'full-access'] as const).map((mode) => {
            const ModeIcon = MODE_ICONS[mode]
            return (
              <DropdownMenuRadioItem key={mode} value={mode} data-mode={mode} className={cn('h-auto py-1.5', mode === 'full-access' && 'text-destructive')}>
                <span className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-2">
                    <ModeIcon className={mode === 'full-access' ? 'text-destructive' : undefined} />
                    {t(`permissions.modes.${mode}`)}
                  </span>
                  <span className="text-ui-small text-muted-foreground">{t(`permissions.modeDescriptions.${mode}`)}</span>
                </span>
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
        {warning && (
          <p role="note" className="px-2 py-1 text-ui-small text-destructive">
            {t('permissions.fullAccessWarning')}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
