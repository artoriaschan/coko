import { XIcon } from 'lucide-react'
import { useI18n } from '../../app/i18n.tsx'
import { IconButton } from '../../app/icon-button.tsx'

export function RightPanel({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  return (
    <>
      <header data-window-drag className="flex h-(--frame-top-clearance) shrink-0 items-center gap-2 ps-4 pe-2">
        <h2 className="min-w-0 flex-1 truncate text-ui-body-lg font-medium">{t('rightPanel.title')}</h2>
        <IconButton label={t('frame.closeRightPanel')} onClick={onClose}>
          <XIcon />
        </IconButton>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-ui-body text-muted-foreground">{t('rightPanel.empty')}</div>
    </>
  )
}
