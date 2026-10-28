import { Button, ComposerEditor, Tooltip, TooltipContent, TooltipTrigger, type ComposerEditorHandle } from '@coko/ui'
import { ArrowUpIcon, SquareIcon } from 'lucide-react'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'

export interface ComposerProps {
  running: boolean
  /** 没有可发送的目标（无 Workspace）时禁用。 */
  disabled: boolean
  onSend: (text: string) => Promise<boolean>
  onStop: () => void
  className?: string
}

/** 基础 composer：Lexical 编辑区与发送 / 停止按钮。运行中按钮变为停止，Escape 也可停止。 */
export function Composer({ running, disabled, onSend, onStop, className }: ComposerProps) {
  const { t } = useI18n()
  const editor = React.useRef<ComposerEditorHandle>(null)
  const [empty, setEmpty] = React.useState(true)
  const action = running ? t('conversation.stop') : t('conversation.send')
  return (
    <form
      className={className}
      onSubmit={(event) => {
        event.preventDefault()
        if (running) onStop()
        else void editor.current?.submit()
      }}
    >
      <ComposerEditor
        ref={editor}
        label={t('conversation.composerPlaceholder')}
        placeholder={t('conversation.composerPlaceholder')}
        disabled={disabled}
        onSubmit={onSend}
        onEscape={running ? onStop : undefined}
        onEmptyChange={setEmpty}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button type="submit" size="icon" aria-label={action} data-action={running ? 'stop' : 'send'} disabled={disabled || (!running && empty)}>
            {running ? <SquareIcon className="fill-current" /> : <ArrowUpIcon />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">{action}</TooltipContent>
      </Tooltip>
    </form>
  )
}
