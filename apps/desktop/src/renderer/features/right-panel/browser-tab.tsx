import { Input } from '@coko/ui'
import { IconArrowUpRight, IconChevronLeft, IconChevronRight, IconRefresh } from '@tabler/icons-react'
import { useI18n } from '../../app/i18n.tsx'
import { IconButton } from '../../app/icon-button.tsx'

/**
 * 右栏浏览器页的占位：工具栏的排布已就位，页面承载尚未提供，所有控件禁用。
 * ponytail: 没有 webview、导航状态或地址校验；提供浏览能力时在此接入载体，并启用这些控件。
 */
export function BrowserTab() {
  const { t } = useI18n()
  return (
    <div data-slot="browser-tab" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b-hairline border-border px-1.5 py-[5px]">
        <IconButton size="icon-sm" tooltipSide="bottom" label={t('browser.back')} disabled>
          <IconChevronLeft aria-hidden className="size-4" />
        </IconButton>
        <IconButton size="icon-sm" tooltipSide="bottom" label={t('browser.forward')} disabled>
          <IconChevronRight aria-hidden className="size-4" />
        </IconButton>
        <IconButton size="icon-sm" tooltipSide="bottom" label={t('browser.reload')} disabled>
          <IconRefresh aria-hidden className="size-4" />
        </IconButton>
        <Input
          className="h-7 flex-1 rounded-sm px-2 text-ui-small"
          aria-label={t('browser.address')}
          placeholder={t('browser.address')}
          spellCheck={false}
          disabled
        />
        <IconButton size="icon-sm" tooltipSide="bottom" label={t('browser.external')} disabled>
          <IconArrowUpRight aria-hidden className="size-4" />
        </IconButton>
      </div>
      <p className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-ui-body text-muted-foreground">{t('browser.unavailable')}</p>
    </div>
  )
}
