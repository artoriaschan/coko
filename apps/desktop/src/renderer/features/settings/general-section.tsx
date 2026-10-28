import { createTranslator, type Locale } from '@coko/i18n'
import { toast, ToggleGroup, ToggleGroupItem } from '@coko/ui'
import { MoonIcon, SunIcon } from 'lucide-react'
import type { Theme } from '../../app/appearance-store.ts'
import { useI18n } from '../../app/i18n.tsx'
import { usePreferences } from '../../app/settings.tsx'
import { SettingsCard, SettingsRow } from './settings-dialog.tsx'

export function GeneralSection({ theme }: { theme: Theme }) {
  const { t, locale } = useI18n()
  const preferences = usePreferences()
  return (
    <section aria-labelledby="settings-general" className="flex flex-col gap-3">
      <h2 id="settings-general" className="text-ui-body-lg font-medium">
        {t('settings.general')}
      </h2>
      <SettingsCard>
        <SettingsRow label={t('appearance.theme')}>
          <ToggleGroup
            type="single"
            aria-label={t('appearance.theme')}
            value={theme}
            onValueChange={(value) => value && void preferences.setTheme(value as Theme)}
          >
            <ToggleGroupItem value="light" data-theme-option="light">
              <SunIcon />
              {t('appearance.light')}
            </ToggleGroupItem>
            <ToggleGroupItem value="dark" data-theme-option="dark">
              <MoonIcon />
              {t('appearance.dark')}
            </ToggleGroupItem>
          </ToggleGroup>
        </SettingsRow>
        <SettingsRow label={t('appearance.language')}>
          <ToggleGroup
            type="single"
            aria-label={t('appearance.language')}
            value={locale}
            onValueChange={(value) => {
              if (!value || value === locale) return
              const next = value as Locale
              void preferences.setLocale(next)
              toast.success(createTranslator(next)('appearance.localeChanged'))
            }}
          >
            {/* 语言名始终以其本身的语言显示。 */}
            <ToggleGroupItem value="zh" lang="zh-CN">
              {t('locale.zh')}
            </ToggleGroupItem>
            <ToggleGroupItem value="en" lang="en">
              {t('locale.en')}
            </ToggleGroupItem>
          </ToggleGroup>
        </SettingsRow>
      </SettingsCard>
    </section>
  )
}
