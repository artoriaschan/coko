import type { Locale } from '@coko/i18n'
import {
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
  Button,
} from '@coko/ui'
import { SunMoonIcon } from 'lucide-react'
import type { Theme } from '../../app/appearance-store.ts'
import { useI18n } from '../../app/i18n.tsx'

export interface AppearanceMenuProps {
  theme: Theme
  onThemeChange: (theme: Theme) => void
  onLocaleChange: (locale: Locale) => void
}

/** 主题与语言切换；设置弹窗接入后可迁入 General 分区。 */
export function AppearanceMenu({ theme, onThemeChange, onLocaleChange }: AppearanceMenuProps) {
  const { t, locale } = useI18n()
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="toolbar" size="icon" aria-label={t('appearance.menu')}>
              <SunMoonIcon />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">{t('appearance.menu')}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="top" align="start">
        <DropdownMenuLabel>{t('appearance.theme')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(value) => onThemeChange(value as Theme)}>
          <DropdownMenuRadioItem value="light">{t('appearance.light')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">{t('appearance.dark')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t('appearance.language')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={locale} onValueChange={(value) => onLocaleChange(value as Locale)}>
          {/* 语言名始终以其本身的语言显示。 */}
          <DropdownMenuRadioItem value="zh" lang="zh-CN">
            {t('locale.zh')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="en" lang="en">
            {t('locale.en')}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
