import { Button, ComposerEditor, Tooltip, TooltipContent, TooltipTrigger, type ComposerEditorHandle } from '@coko/ui'
import { ArrowUpIcon, PauseIcon, SettingsIcon, SquareIcon } from 'lucide-react'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import type { CommandTarget } from '../../stores/commands-store.ts'
import { CommandMenu } from './command-menu.tsx'

export interface ComposerProps {
  running: boolean
  /** 没有可发送的目标（无 Workspace）时禁用。 */
  disabled: boolean
  /** 没有可用模型：发送入口改为引导到设置，草稿保留。 */
  needsSetup: boolean
  onSend: (text: string) => Promise<boolean>
  /** Run 进行中提交：作为追加指令送进当前 Run（返回 false 时保留输入）。 */
  onSteer: (text: string) => Promise<boolean>
  onStop: () => void
  /** Run 进行中暂停：当前步骤完成后停下。 */
  onPause: () => void
  /** 已请求暂停、等待 Run 结束。 */
  pausing?: boolean
  onSetup: () => void
  /** 编辑区与发送按钮之间的控件（模型选择）。 */
  accessory?: React.ReactNode
  /** 焦点在编辑区时 Shift+Tab：切换到下一档 Permission Mode（不移动焦点）。 */
  onCycleMode?: () => void
  className?: string
  /** 命令目录的作用域（当前会话或 Workspace 草稿）：草稿开头输入 / 时显示命令菜单。省略时没有命令菜单。 */
  commandTarget?: CommandTarget | undefined
  /** 外部聚焦编辑区（⌘N 新建会话后）或放回文本（退回的追加指令）。 */
  ref?: React.Ref<ComposerHandle>
}

export interface ComposerHandle {
  focus(): void
  /** 把文本放回编辑区（已有草稿时接在其前面）。 */
  restore(text: string): void
}

/**
 * 基础 composer：Lexical 编辑区与发送按钮。Run 进行中编辑区保持可输入，Enter 与发送按钮把内容作为追加指令送进当前 Run；
 * 暂停与停止按钮并列，Escape 也可停止。
 */
export function Composer({
  running,
  disabled,
  needsSetup,
  onSend,
  onSteer,
  onStop,
  onPause,
  pausing = false,
  onSetup,
  accessory,
  onCycleMode,
  className,
  commandTarget,
  ref,
}: ComposerProps) {
  const { t } = useI18n()
  const editor = React.useRef<ComposerEditorHandle>(null)
  const [empty, setEmpty] = React.useState(true)
  React.useImperativeHandle(
    ref,
    () => ({
      focus: () => editor.current?.focus(),
      restore: (text) => {
        const current = (editor.current?.getText() ?? '').trim()
        editor.current?.setText(current === '' ? text : text + '\n' + current)
        editor.current?.focus()
      },
    }),
    [],
  )
  const setup = needsSetup && !running
  const sendLabel = running ? t('conversation.steeringHint') : setup ? t('models.configure') : t('conversation.send')
  return (
    <form
      className={className}
      // 只在编辑区内拦截 Shift+Tab；按钮等其他控件上的 Shift+Tab 仍按常规移动焦点。
      onKeyDownCapture={(event) => {
        if (!onCycleMode || event.key !== 'Tab' || !event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
        if (event.nativeEvent.isComposing || !(event.target as Element).closest('[contenteditable="true"]')) return
        event.preventDefault()
        onCycleMode()
      }}
      onSubmit={(event) => {
        event.preventDefault()
        if (setup) onSetup()
        else void editor.current?.submit()
      }}
    >
      <ComposerEditor
        ref={editor}
        // basis-0：长草稿不会把控件挤到下一行；只有控件本身放不下时才换行。
        className="basis-0"
        label={t('conversation.composerPlaceholder')}
        placeholder={t('conversation.composerPlaceholder')}
        disabled={disabled}
        // 未配置模型时 Enter 也引导到设置；返回 false 保留草稿。Run 进行中 Enter 发送追加指令。
        onSubmit={
          setup
            ? async () => {
                onSetup()
                return false
              }
            : running
              ? onSteer
              : onSend
        }
        onEscape={running ? onStop : undefined}
        onEmptyChange={setEmpty}
      >
        {commandTarget && <CommandMenu target={commandTarget} />}
      </ComposerEditor>
      {accessory}
      {setup ? (
        <Button type="submit" size="sm" data-action="setup" disabled={disabled} className="shrink-0">
          <SettingsIcon />
          {t('models.configure')}
        </Button>
      ) : (
        <>
          {(!running || !empty) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="submit" size="icon" aria-label={sendLabel} data-action={running ? 'steer' : 'send'} disabled={disabled || empty}>
                  <ArrowUpIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{sendLabel}</TooltipContent>
            </Tooltip>
          )}
          {running && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    aria-label={pausing ? t('conversation.pausing') : t('conversation.pause')}
                    data-action="pause"
                    data-pausing={pausing || undefined}
                    disabled={disabled || pausing}
                    onClick={onPause}
                  >
                    <PauseIcon className="fill-current" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">{pausing ? t('conversation.pausing') : t('conversation.pause')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" size="icon" aria-label={t('conversation.stop')} data-action="stop" disabled={disabled} onClick={onStop}>
                    <SquareIcon className="fill-current" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">{t('conversation.stop')}</TooltipContent>
              </Tooltip>
            </>
          )}
        </>
      )}
    </form>
  )
}
