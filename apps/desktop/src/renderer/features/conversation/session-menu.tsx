import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@coko/ui'
import { DownloadIcon, EllipsisIcon } from 'lucide-react'
import { useI18n } from '../../app/i18n.tsx'
import { IconButton } from '../../app/icon-button.tsx'
import { useSessionDownload } from './session-download.tsx'

export function SessionMenu({ sessionId }: { sessionId: string }) {
  const { t } = useI18n()
  const { exporting, download } = useSessionDownload(sessionId, 'jsonl')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={t('trace.more')} data-action="session-menu" size="icon-sm">
          <EllipsisIcon className="size-4" strokeWidth={1} />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={exporting} onSelect={() => void download()}>
          <DownloadIcon aria-hidden />
          {t('trace.downloadSession')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
