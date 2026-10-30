import { useI18n } from '../../app/i18n.tsx'
import { SettingsCard } from './settings-page.tsx'

export function AboutSection() {
  const { t } = useI18n()
  return (
    <section aria-labelledby="settings-about" className="flex flex-col gap-3">
      <h2 id="settings-about" className="text-ui-body-lg font-medium">
        {t('settings.about')}
      </h2>
      <SettingsCard className="flex flex-col gap-1 px-4 py-3">
        <p className="text-ui-title font-medium">{t('app.name')}</p>
        <p data-app-version className="text-ui-body text-muted-foreground">
          {t('about.version', { version: __COKO_VERSION__ })}
        </p>
        <p className="text-ui-body">{t('about.description')}</p>
      </SettingsCard>
      <p className="text-ui-small text-muted-foreground">{t('about.securityNote')}</p>
    </section>
  )
}
