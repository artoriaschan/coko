import { Button, ComposerEditor, Tooltip, TooltipContent, TooltipTrigger, type ComposerEditorHandle } from '@coko/ui'
import { ArrowUpIcon, SettingsIcon, SquareIcon } from 'lucide-react'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'

export interface ComposerProps {
  running: boolean
  /** 没有可发送的目标（无 Workspace）时禁用。 */
  disabled: boolean
  /** 没有可用模型：发送入口改为引导到设置，草稿保留。 */
  needsSetup: boolean
  onSend: (text: string) => Promise<boolean>
  onStop: () => void
  onSetup: () => void
  /** 编辑区与发送按钮之间的控件（模型选择）。 */
  accessory?: React.ReactNode
  className?: string
  /** 外部聚焦编辑区（⌘N 新建会话后）。 */
  ref?: React.Ref<ComposerHandle>
}

export interface ComposerHandle {
  focus(): void
}

/** 基础 composer：Lexical 编辑区与发送 / 停止按钮。运行中按钮变为停止，Escape 也可停止。 */
export function Composer({ running, disabled, needsSetup, onSend, onStop, onSetup, accessory, className, ref }: ComposerProps) {
  const { t } = useI18n()
  const editor = React.useRef<ComposerEditorHandle>(null)
  React.useImperativeHandle(ref, () => ({ focus: () => editor.current?.focus() }), [])
  const [empty, setEmpty] = React.useState(true)
  const setup = needsSetup && !running
  const action = running ? t('conversation.stop') : setup ? t('models.configure') : t('conversation.send')
  return (
    <form
      className={className}
      onSubmit={(event) => {
        event.preventDefault()
        if (running) onStop()
        else if (setup) onSetup()
        else void editor.current?.submit()
      }}
    >
      <ComposerEditor
        ref={editor}
        label={t('conversation.composerPlaceholder')}
        placeholder={t('conversation.composerPlaceholder')}
        disabled={disabled}
        // 未配置模型时 Enter 也引导到设置；返回 false 保留草稿。
        onSubmit={
          setup
            ? async () => {
                onSetup()
                return false
              }
            : onSend
        }
        onEscape={running ? onStop : undefined}
        onEmptyChange={setEmpty}
      />
      {accessory}
      {setup ? (
        <Button type="submit" size="sm" data-action="setup" disabled={disabled} className="shrink-0">
          <SettingsIcon />
          {action}
        </Button>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="submit" size="icon" aria-label={action} data-action={running ? 'stop' : 'send'} disabled={disabled || (!running && empty)}>
              {running ? <SquareIcon className="fill-current" /> : <ArrowUpIcon />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{action}</TooltipContent>
        </Tooltip>
      )}
    </form>
  )
}
