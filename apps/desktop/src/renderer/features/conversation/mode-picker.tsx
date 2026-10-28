import { CYCLED_PERMISSION_MODES, type PermissionMode } from '@coko/protocol'
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@coko/ui'
import { ChevronDownIcon, EyeIcon, FilePenLineIcon, ShieldAlertIcon, ShieldIcon } from 'lucide-react'
import type * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'

export const PERMISSION_MODES: readonly PermissionMode[] = ['read-only', 'default', 'accept-edits', 'full-access']

export const MODE_ICONS: Record<PermissionMode, React.ComponentType<{ className?: string }>> = {
  'read-only': EyeIcon,
  default: ShieldIcon,
  'accept-edits': FilePenLineIcon,
  'full-access': ShieldAlertIcon,
}

/** Shift+Tab 的下一档：只在前三档之间循环；从 full-access 回到第一档。 */
export function nextCycledMode(mode: PermissionMode): PermissionMode {
  const index = CYCLED_PERMISSION_MODES.indexOf(mode as (typeof CYCLED_PERMISSION_MODES)[number])
  return CYCLED_PERMISSION_MODES[(index + 1) % CYCLED_PERMISSION_MODES.length]!
}

export interface ModePickerProps {
  value: PermissionMode
  disabled?: boolean
  onChange: (mode: PermissionMode) => void
}

/** 输入区的 Permission Mode 选择（模型选择旁）。full-access 只能在此显式选择，选中时以警示色显示。 */
export function ModePicker({ value, disabled, onChange }: ModePickerProps) {
  const { t } = useI18n()
  const Icon = MODE_ICONS[value]
  const label = t(`permissions.modes.${value}`)
  const warning = value === 'full-access'
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
              data-permission-mode={value}
              data-warning={warning || undefined}
              aria-label={t('permissions.modeCurrent', { mode: label })}
              className={cn('min-w-0 shrink', warning && 'text-destructive [&_svg]:text-destructive')}
            >
              <Icon />
              <span className="truncate">{label}</span>
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">{t('permissions.modeCycleHint')}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="top" align="start" className="w-80">
        <DropdownMenuLabel>{t('permissions.mode')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(next as PermissionMode)}>
          {PERMISSION_MODES.map((mode) => {
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
          <>
            <DropdownMenuSeparator />
            <p role="note" className="px-2 py-1 text-ui-small text-destructive">
              {t('permissions.fullAccessWarning')}
            </p>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
