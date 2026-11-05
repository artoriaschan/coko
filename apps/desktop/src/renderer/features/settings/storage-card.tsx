import type { StoragePathsResponse } from '@coko/protocol'
import { Button } from '@coko/ui'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import { loadStoragePaths } from '../../client/storage.ts'
import { SettingsCard } from './settings-page.tsx'

const openStorageDirectory = async (path: string) => (await window.coko?.openDirectory(path)) ?? false

type StorageState = { status: 'loading' | 'error' } | { status: 'ready'; paths: StoragePathsResponse }

/** 运行时存储位置只读展示，不进入可编辑设置库。 */
export function StorageCard({
  load = loadStoragePaths,
  openDirectory = openStorageDirectory,
}: {
  load?: () => Promise<StoragePathsResponse>
  openDirectory?: (path: string) => Promise<boolean>
}) {
  const { t } = useI18n()
  const titleId = React.useId()
  const [opening, setOpening] = React.useState<string>()
  const [openError, setOpenError] = React.useState<string>()
  const [reload, setReload] = React.useState(0)
  const [state, setState] = React.useState<StorageState>({ status: 'loading' })
  React.useEffect(() => {
    let active = true
    setState({ status: 'loading' })
    void load().then(
      (paths) => {
        if (active) setState({ status: 'ready', paths })
      },
      () => {
        if (active) setState({ status: 'error' })
      },
    )
    return () => {
      active = false
    }
  }, [load, reload])

  const open = async (path: string) => {
    setOpening(path)
    setOpenError(undefined)
    try {
      if (!(await openDirectory(path))) setOpenError(path)
    } catch {
      setOpenError(path)
    } finally {
      setOpening(undefined)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 id={titleId} className="text-ui-body font-medium">
        {t('storage.title')}
      </h3>
      <SettingsCard role="group" aria-labelledby={titleId} aria-busy={state.status === 'loading' || undefined}>
        {state.status === 'ready' ? (
          (['home', 'chatsRoot'] as const).map((key) => (
            <div key={key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 not-last:border-b-hairline not-last:border-border">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-ui-body">{t(`storage.${key}`)}</span>
                <code data-user-content data-storage-path={key} className="font-mono text-ui-small break-all text-muted-foreground">
                  {state.paths[key]}
                </code>
              </div>
              <Button
                variant="outline"
                size="sm"
                aria-label={t(key === 'home' ? 'storage.openHome' : 'storage.openChatsRoot')}
                disabled={opening !== undefined}
                aria-busy={opening === state.paths[key] || undefined}
                onClick={() => void open(state.paths[key])}
              >
                {t('storage.openFolder')}
              </Button>
            </div>
          ))
        ) : state.status === 'loading' ? (
          <p role="status" className="px-4 py-3 text-ui-small text-muted-foreground">
            {t('storage.loading')}
          </p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p role="alert" className="text-ui-small">
              {t('storage.loadFailed')}
            </p>
            <Button variant="outline" size="sm" onClick={() => setReload((value) => value + 1)}>
              {t('storage.retry')}
            </Button>
          </div>
        )}
      </SettingsCard>
      {openError && (
        <p role="alert" className="text-ui-small break-all">
          {t('storage.openFailed')}{' '}
          <code data-user-content className="font-mono">
            {openError}
          </code>
        </p>
      )}
      <p className="text-ui-small text-muted-foreground">{t('storage.hint')}</p>
    </div>
  )
}
