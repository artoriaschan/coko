import { Button, MarkdownRenderer } from '@coko/ui'
import { ArrowUpIcon, PanelRightCloseIcon, PanelRightOpenIcon } from 'lucide-react'
import type { Theme } from '../../app/appearance-store.ts'
import type { FixtureMessage } from '../../app/fixtures.ts'
import { useI18n } from '../../app/i18n.tsx'
import { IconButton } from '../../app/icon-button.tsx'
import type { ConnectionState } from '../../client/connection.ts'
import { ConnectionFailure, ConnectionStatus } from '../connection/connection-status.tsx'

export interface ConversationPaneProps {
  title: string
  messages: FixtureMessage[]
  theme: Theme
  rightOpen: boolean
  onToggleRight: () => void
  connection: ConnectionState
}

// 聊天列宽度轴：clamp(680px, 列宽×0.64, 920px)，窄于该值时取列宽；composer 比聊天列宽 32px。
const chatColumn = 'mx-auto w-full max-w-[clamp(680px,64cqi,920px)]'
const composerColumn = 'mx-auto w-full max-w-[calc(clamp(680px,64cqi,920px)_+_32px)]'

export function ConversationPane({ title, messages, theme, rightOpen, onToggleRight, connection }: ConversationPaneProps) {
  const { t, dictionary } = useI18n()
  return (
    <>
      <header
        data-window-drag
        className="flex h-(--frame-top-clearance) shrink-0 items-center gap-2 ps-[calc(16px_+_max(0px,_var(--frame-leading-clearance)_-_var(--local-sidebar-column)))] pe-2"
      >
        <h1 data-user-content className="min-w-0 flex-1 truncate text-ui-body-lg font-medium" title={title}>
          {title}
        </h1>
        <ConnectionStatus state={connection} />
        <IconButton label={rightOpen ? t('frame.closeRightPanel') : t('frame.openRightPanel')} aria-pressed={rightOpen} onClick={onToggleRight}>
          {rightOpen ? <PanelRightCloseIcon /> : <PanelRightOpenIcon />}
        </IconButton>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          <div className={`${chatColumn} flex flex-col gap-6 py-4`}>
            {messages.map((message) =>
              message.role === 'user' ? (
                <article key={message.id} aria-label={t('conversation.you')} className="ms-auto w-fit max-w-[85%]">
                  <p data-user-content className="rounded-xl bg-bubble px-4 py-2.5 text-ui-body-lg whitespace-pre-wrap">
                    {message.text}
                  </p>
                </article>
              ) : (
                <article key={message.id} aria-label={t('conversation.assistant')} data-user-content className="min-w-0">
                  <MarkdownRenderer mode="static" colorScheme={theme} translations={dictionary.markdown}>
                    {message.text}
                  </MarkdownRenderer>
                </article>
              ),
            )}
          </div>
        </div>

        <div className="shrink-0 px-4 pb-4">
          <form className={`${composerColumn} flex items-end gap-2 rounded-panel bg-background p-2 shadow-soft`} onSubmit={(event) => event.preventDefault()}>
            <textarea
              rows={1}
              aria-label={t('conversation.composerPlaceholder')}
              placeholder={t('conversation.composerPlaceholder')}
              className="min-h-10 min-w-0 flex-1 resize-none rounded-lg bg-transparent px-3 py-2 text-ui-body-lg placeholder:text-muted-foreground pointer-coarse:text-ui-title"
            />
            <Button type="submit" size="icon" aria-label={t('conversation.send')} disabled>
              <ArrowUpIcon />
            </Button>
          </form>
        </div>
        {connection.phase === 'failed' && <ConnectionFailure code={connection.code} message={connection.message} />}
      </div>
    </>
  )
}
