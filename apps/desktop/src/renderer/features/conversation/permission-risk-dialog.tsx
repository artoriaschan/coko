import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@coko/ui'
import { IconFiles, IconWorld, IconShieldExclamation, IconTerminal } from '@tabler/icons-react'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'

/** 选择完全访问权限前的风险确认：列出越出工作区后的能力，确认后才切换模式。 */
export function PermissionRiskDialog({ open, onOpenChange, onConfirm }: { open: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void }) {
  const { t } = useI18n()
  const cancel = React.useRef<HTMLButtonElement>(null)
  const rows = [
    { icon: IconFiles, title: t('permissions.risk.filesTitle'), detail: t('permissions.risk.filesDetail'), tone: 'text-link' },
    { icon: IconTerminal, title: t('permissions.risk.commandsTitle'), detail: t('permissions.risk.commandsDetail'), tone: 'text-foreground' },
    { icon: IconWorld, title: t('permissions.risk.networkTitle'), detail: t('permissions.risk.networkDetail'), tone: 'text-link' },
  ] as const
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        role="alertdialog"
        data-permission-risk-dialog
        aria-label={t('permissions.risk.title')}
        closeLabel={t('permissions.risk.close')}
        className="w-[560px] max-w-[calc(100vw-32px)] gap-4 p-6"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          cancel.current?.focus()
        }}
      >
        <div className="flex items-center gap-2.5">
          <IconShieldExclamation aria-hidden className="size-5 shrink-0 text-warning-text" />
          <DialogTitle className="text-ui-heading">{t('permissions.risk.title')}</DialogTitle>
        </div>
        <DialogDescription className="text-ui-body leading-5">{t('permissions.risk.description')}</DialogDescription>
        <ul data-slot="permission-risk-capabilities" className="overflow-hidden rounded-lg bg-accent">
          {rows.map(({ icon: Icon, title, detail, tone }) => (
            <li
              key={title}
              className="flex min-h-14 items-center gap-3 px-4 py-2.5 [&:not(:first-child)]:border-t-hairline [&:not(:first-child)]:border-border"
            >
              <Icon aria-hidden className={`size-5 shrink-0 ${tone}`} />
              <div className="min-w-0 flex-1">
                <span className="block font-medium">{title}</span>
                <p className="text-ui-small text-muted-foreground">{detail}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <Button ref={cancel} variant="secondary" onClick={() => onOpenChange(false)}>
            {t('permissions.risk.cancel')}
          </Button>
          <Button variant="ghost" className="bg-warning-text/10 text-warning-text hover:bg-warning-text/20" onClick={onConfirm}>
            <IconShieldExclamation aria-hidden className="size-3.5" />
            {t('permissions.risk.confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
