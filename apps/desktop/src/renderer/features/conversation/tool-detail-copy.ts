import { toast } from '@coko/ui'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'

/** Shared clipboard boundary for the recorded file and search detail toolbars. */
export function useToolDetailCopy(text: string) {
  const { t } = useI18n()
  const [copied, setCopied] = React.useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast.success(t('tool.fileCopied'))
    } catch {
      toast.error(t('tool.fileCopyFailed'))
    }
  }
  return { copied, copy }
}
