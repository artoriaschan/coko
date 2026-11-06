import * as React from 'react'
import { cn } from '@coko/ui'
import { ToolResultImages } from '../conversation/tool-image-details.tsx'
import { JsonTree, type JsonTreeProps } from './json-tree.tsx'
import { useTrajectoryLocale } from './locales.ts'
import { stringify } from './trajectory-record.ts'
import css from './trajectory-panel.module.css'

const Wrapping = React.createContext<JsonTreeProps['stringWrapping']>(undefined)

export function PayloadPreferences({ children }: { children: React.ReactNode }) {
  const t = useTrajectoryLocale()
  const wrapped = React.useRef(false)
  const value = React.useMemo(
    () => ({
      label: t('record.wrapLines'),
      getDefault: () => wrapped.current,
      setDefault: (next: boolean) => {
        wrapped.current = next
      },
    }),
    [t],
  )
  return <Wrapping.Provider value={value}>{children}</Wrapping.Provider>
}

export function Payload({ value, label, preview = false, images }: { value: unknown; label: string; preview?: boolean; images?: unknown }) {
  const t = useTrajectoryLocale()
  const stringWrapping = React.useContext(Wrapping)
  let data = value
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      /* Recorded plain text remains a string. */
    }
  }
  const labels = {
    copyValue: t('copy.value'),
    copyJson: t('copy.json'),
    copyPath: t('copy.path'),
    copyPrettyJson: t('copy.prettyJson'),
    copyCompactJson: t('copy.compactJson'),
    copied: t('copied'),
    copyFailed: t('copy.failed'),
    collapseNode: t('collapse'),
    expandNode: t('expand'),
    copyButtonTitle: (action: string) => t('copy.optionsHint', { action }),
  }
  return (
    <div className={cn(css.payloadBlock, preview && css.payloadPreview)} data-user-content>
      {images !== undefined && <ToolResultImages content={images} />}
      {data === undefined ? (
        <p className={css.noPayload}>{t('record.noResult')}</p>
      ) : typeof data === 'object' && data !== null ? (
        <JsonTree
          data={data}
          label={label}
          labels={labels}
          stringWrapping={stringWrapping}
          collapsedStringLines={preview ? 3 : 12}
          className={preview ? css.jsonPreview : css.jsonPayload}
        />
      ) : (
        <pre className={cn(css.payload, preview && css.payloadPreview)}>{stringify(data)}</pre>
      )}
    </div>
  )
}
