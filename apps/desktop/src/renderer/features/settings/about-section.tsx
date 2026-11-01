import { Button } from '@coko/ui'
import { CircleAlertIcon } from 'lucide-react'
import * as React from 'react'
import { useStore } from 'zustand'
import type { UpdateStatus } from '../../../shared/bridge.ts'
import { useI18n } from '../../app/i18n.tsx'
import { updateStore as defaultUpdateStore, type UpdateStore } from '../../stores/update-store.ts'
import { SettingsCard } from './settings-page.tsx'

/** 打包时 build.ts 注入的运行时版本（随包 Electron 与其 Node）；开发服务器与测试中可能没有。 */
declare const __COKO_RUNTIME_VERSIONS__: { electron: string; node: string } | undefined
const runtimeVersions = typeof __COKO_RUNTIME_VERSIONS__ === 'object' ? __COKO_RUNTIME_VERSIONS__ : undefined

/** 设置 → 关于（注册表中的分区组件）：使用应用内共用的更新 store。 */
export function AboutSection() {
  return <AboutSectionView store={defaultUpdateStore} />
}

/** 应用与运行时版本、更新状态与"检查更新"（disabled 时说明原因），已下载时"重启以更新"。测试传入自己的 store。 */
export function AboutSectionView({ store }: { store: UpdateStore }) {
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
        {runtimeVersions !== undefined && (
          <p data-runtime-versions className="text-ui-small text-muted-foreground">
            {t('update.runtime', runtimeVersions)}
          </p>
        )}
        <p className="text-ui-body">{t('about.description')}</p>
      </SettingsCard>
      <UpdateCard store={store} />
      <p className="text-ui-small text-muted-foreground">{t('about.securityNote')}</p>
    </section>
  )
}

function UpdateCard({ store }: { store: UpdateStore }) {
  const { t } = useI18n()
  const status = useStore(store, (s) => s.status)
  const pending = useStore(store, (s) => s.pending)
  const { connect, check, install } = store.getState()
  React.useEffect(() => connect(), [connect])
  const titleId = React.useId()
  const state = status?.state
  const checkable =
    state !== undefined && state !== 'disabled' && state !== 'checking' && state !== 'available' && state !== 'downloading' && state !== 'downloaded'

  return (
    <SettingsCard aria-labelledby={titleId} data-update-state={state ?? 'unknown'} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-col gap-0.5" aria-live="polite">
        <p id={titleId} className="text-ui-body font-medium">
          {t('update.title')}
        </p>
        {status !== undefined && (
          <p data-update-status className="flex items-center gap-1.5 text-ui-body">
            {/* 小号文字用 destructive 色在卡片上低于 4.5:1，错误只用图标着色，文字保持中性色。 */}
            {status.state === 'error' && <CircleAlertIcon aria-hidden data-update-error-icon className="size-4 shrink-0 text-destructive" />}
            {t(`update.state.${status.state}`)}
          </p>
        )}
        {status !== undefined && <UpdateDetail status={status} />}
      </div>
      <div className="flex shrink-0 gap-2">
        {state === 'downloaded' ? (
          <Button
            size="sm"
            data-action="install-update"
            disabled={pending !== undefined}
            aria-busy={pending === 'install' || undefined}
            onClick={() => void install()}
          >
            {t('update.install')}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            data-action="check-updates"
            disabled={!checkable || pending !== undefined}
            aria-busy={state === 'checking' || pending === 'check' || undefined}
            onClick={() => void check()}
          >
            {t('update.check')}
          </Button>
        )}
      </div>
    </SettingsCard>
  )
}

function UpdateDetail({ status }: { status: UpdateStatus }) {
  const { t } = useI18n()
  const text =
    status.state === 'disabled'
      ? t(status.reason === 'not-packaged' || status.reason === 'no-feed' ? `update.reason.${status.reason}` : 'update.reason.unknown')
      : status.state === 'downloaded' && status.version !== undefined
        ? t('update.versionReady', { version: status.version })
        : (status.state === 'downloading' || status.state === 'available') && status.version !== undefined
          ? t('update.versionDownloading', { version: status.version })
          : status.state === 'error' && status.message !== undefined && status.message !== ''
            ? t('update.errorDetail', { message: status.message })
            : undefined
  if (text === undefined) return null
  return (
    <p data-update-detail className="text-ui-small break-words text-muted-foreground">
      {text}
    </p>
  )
}
