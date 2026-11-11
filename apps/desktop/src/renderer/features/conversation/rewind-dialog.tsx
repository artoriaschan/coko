import type { RewindMode, RewindResponse } from '@coko/protocol'
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, ToggleGroup, ToggleGroupItem } from '@coko/ui'
import { IconLoader2, IconAlertTriangle } from '@tabler/icons-react'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'

export interface RewindDialogProps {
  /** 目标用户消息；null 时关闭。 */
  target: { seq: number; text: string } | null
  /** Workspace 目录：文件清单显示为相对路径。 */
  workspacePath: string | undefined
  /** dry-run：将恢复、删除、在 Agent 之外改过与未追踪的文件；失败时 undefined。 */
  onPreview: (seq: number, mode: RewindMode) => Promise<RewindResponse | undefined>
  /** 执行回退；返回是否成功（成功后关闭）。 */
  onConfirm: (seq: number, mode: RewindMode) => Promise<boolean>
  onClose: () => void
  /** 关闭后焦点去向（默认回到触发按钮）；回退成功后由调用方移到输入区。 */
  onCloseAutoFocus?: (event: Event) => void
}

const MODES: RewindMode[] = ['both', 'conversation', 'code']

/** Workspace 下的路径显示为相对路径（macOS 的 /private 前缀两边可能不一致）。 */
function displayPath(path: string, root: string | undefined): string {
  if (!root) return path
  const strip = (p: string) => p.replace(/^\/private(?=\/)/, '')
  const base = strip(root).replace(/\/+$/, '') + '/'
  const target = strip(path)
  return target.startsWith(base) ? target.slice(base.length) : path
}

/**
 * 回退确认（ADR 0006）：选择回退对话、代码或两者；涉及代码时以 dry-run 列出将恢复和删除的文件，标出在 Agent 之外改过的、
 * 位于 Workspace 之外或受保护的、因路径被替换而跳过的与过大未追踪的文件，并说明命令造成的变化不回退。
 * 每次打开由调用方换 key 重新挂载，本地状态（模式、提交中）随之重置。
 */
export function RewindDialog({ target, workspacePath, onPreview, onConfirm, onClose, onCloseAutoFocus }: RewindDialogProps) {
  const { t } = useI18n()
  const [mode, setMode] = React.useState<RewindMode>('both')
  const [preview, setPreview] = React.useState<{ key: string; result: RewindResponse | undefined } | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const seq = target?.seq
  const key = `${seq}:${mode}`
  const needsFiles = mode !== 'conversation'

  React.useEffect(() => {
    if (seq === undefined || !needsFiles) return
    let current = true
    setPreview(null)
    void onPreview(seq, mode).then((result) => {
      if (current) setPreview({ key: `${seq}:${mode}`, result })
    })
    return () => {
      current = false
    }
  }, [seq, mode, needsFiles, onPreview])

  const ready = !needsFiles || preview?.key === key
  const files = needsFiles && preview?.key === key ? preview.result : undefined
  const failed = needsFiles && preview?.key === key && preview.result === undefined
  const diverged = new Set(files?.diverged ?? [])
  const outside = new Set(files?.outside ?? [])

  const list = (paths: string[], label: string, slot: string) =>
    paths.length > 0 && (
      <section data-slot={slot} className="flex flex-col gap-1">
        <h3 className="text-ui-body font-medium">{label}</h3>
        <ul className="flex flex-col gap-0.5 text-ui-body">
          {paths.map((path) => (
            <li
              key={path}
              data-path={path}
              data-diverged={diverged.has(path) || undefined}
              data-outside={outside.has(path) || undefined}
              className="flex min-w-0 items-center gap-1.5"
            >
              {(diverged.has(path) || outside.has(path)) && <IconAlertTriangle aria-hidden className="size-3.5 shrink-0 text-warning" />}
              <span data-user-content className="truncate font-mono text-ui-small" title={path}>
                {displayPath(path, workspacePath)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    )

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        closeLabel={t('rewind.close')}
        data-slot="rewind-dialog"
        className="max-w-[560px] gap-4 p-6"
        {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}
      >
        <div className="flex flex-col gap-1 pe-8">
          <DialogTitle>{t('rewind.title')}</DialogTitle>
          <DialogDescription>{t('rewind.description')}</DialogDescription>
        </div>
        {target && (
          <p data-user-content className="line-clamp-3 rounded-lg bg-bubble px-3 py-2 text-ui-body break-words whitespace-pre-wrap">
            {target.text}
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <ToggleGroup
            type="single"
            aria-label={t('rewind.mode')}
            value={mode}
            onValueChange={(value) => value && setMode(value as RewindMode)}
            className="flex-wrap"
          >
            {MODES.map((m) => (
              <ToggleGroupItem key={m} value={m} data-rewind-mode={m}>
                {t(`rewind.modes.${m}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-ui-small text-muted-foreground">{t(`rewind.modeDescriptions.${mode}`)}</p>
        </div>
        {needsFiles && (
          <div data-slot="rewind-files" aria-busy={!ready} className="flex max-h-60 min-h-8 flex-col gap-3 overflow-y-auto">
            {!ready && (
              <p className="flex items-center gap-2 text-ui-body text-muted-foreground">
                <IconLoader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
                {t('rewind.checking')}
              </p>
            )}
            {failed && <p className="text-ui-body text-destructive">{t('rewind.previewFailed')}</p>}
            {files && (
              <>
                {files.restored.length + files.deleted.length + files.untracked.length + files.skipped.length === 0 && (
                  <p className="text-ui-body text-muted-foreground">{t('rewind.noFileChanges')}</p>
                )}
                {files.diverged.length > 0 && (
                  <p role="alert" data-slot="rewind-diverged" className="flex items-start gap-1.5 text-ui-body text-warning-text">
                    <IconAlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
                    {t('rewind.diverged', { count: files.diverged.length })}
                  </p>
                )}
                {files.outside.length > 0 && (
                  <p role="alert" data-slot="rewind-outside" className="flex items-start gap-1.5 text-ui-body text-warning-text">
                    <IconAlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
                    {t('rewind.outside', { count: files.outside.length })}
                  </p>
                )}
                {list(files.outside, t('rewind.outsideList', { count: files.outside.length }), 'rewind-outside-list')}
                {list(
                  files.restored.filter((p) => !outside.has(p)),
                  t('rewind.restore', { count: files.restored.filter((p) => !outside.has(p)).length }),
                  'rewind-restored',
                )}
                {list(
                  files.deleted.filter((p) => !outside.has(p)),
                  t('rewind.delete', { count: files.deleted.filter((p) => !outside.has(p)).length }),
                  'rewind-deleted',
                )}
                {list(files.skipped, t('rewind.skipped', { count: files.skipped.length }), 'rewind-skipped')}
                {list(files.untracked, t('rewind.untracked', { count: files.untracked.length }), 'rewind-untracked')}
              </>
            )}
          </div>
        )}
        <p data-slot="rewind-bash-note" className="text-ui-small text-muted-foreground">
          {t('rewind.bashNote')}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('rewind.cancel')}
          </Button>
          <Button
            data-action="confirm-rewind"
            disabled={!ready || failed || submitting || seq === undefined}
            onClick={() => {
              if (seq === undefined) return
              setSubmitting(true)
              void onConfirm(seq, mode).then((ok) => {
                setSubmitting(false)
                if (ok) onClose()
              })
            }}
          >
            {t('rewind.confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
