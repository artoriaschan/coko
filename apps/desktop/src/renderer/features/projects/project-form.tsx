import type { CreateProjectResponse, Project, ProjectFields } from '@coko/protocol'
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@coko/ui'
import { IconFolder, IconFolderPlus, IconX } from '@tabler/icons-react'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import { IconButton } from '../../app/icon-button.tsx'
import { ApiError, projectApi } from '../../client/api.ts'

export type ProjectFormResult = CreateProjectResponse | { status: 'updated'; project: Project }
export interface ProjectFormDialogProps {
  mode: 'create' | 'edit'
  initial?: ProjectFields
  pickDirectory: () => Promise<string | null>
  checkFolder?: (path: string) => Promise<{ path: string }>
  onSubmit: (fields: ProjectFields) => Promise<ProjectFormResult>
  onSubmitBlank?: (name: string) => Promise<CreateProjectResponse>
  /** 创建、命中已有项目与编辑均由调用者决定完成动作；此组件不切换会话。 */
  onComplete: (result: ProjectFormResult) => void
  onClose: () => void
}

/** 创建与编辑共用的草稿表单。仅在提交成功后把结果交还调用者。 */
export function ProjectFormDialog({
  mode,
  initial,
  pickDirectory,
  checkFolder = projectApi.checkFolder,
  onSubmit,
  onSubmitBlank,
  onComplete,
  onClose,
}: ProjectFormDialogProps) {
  const { t } = useI18n()
  const [blank, setBlank] = React.useState(false)
  const [name, setName] = React.useState(initial?.name ?? '')
  const [folders, setFolders] = React.useState<ProjectFields['folders']>(() => initial?.folders.map((folder) => ({ ...folder })) ?? [])
  const [pending, setPending] = React.useState(false)
  const [picking, setPicking] = React.useState(false)
  const [confirmDiscard, setConfirmDiscard] = React.useState(false)
  const [feedback, setFeedback] = React.useState<{ error: boolean; text: string } | null>(null)
  const busy = React.useRef(false)
  const input = React.useRef<HTMLInputElement>(null)
  const dirty = name !== (initial?.name ?? '') || JSON.stringify(folders) !== JSON.stringify(initial?.folders ?? [])
  const requestClose = () => {
    if (busy.current) return
    if (dirty) setConfirmDiscard(true)
    else onClose()
  }
  const addFolder = async () => {
    if (busy.current) return
    busy.current = true
    setPicking(true)
    setFeedback(null)
    try {
      const path = await pickDirectory()
      if (path === null) return
      const canonical = await checkFolder(path)
      if (folders.some((folder) => folder.path === canonical.path)) {
        setFeedback({ error: false, text: t('projectForm.duplicate') })
        return
      }
      setFolders([...folders, { path: canonical.path, primary: folders.length === 0 }])
      // 创建项目时名称为空，先用所选文件夹名回填，用户仍可继续修改。
      if (mode === 'create') {
        const folderName = canonical.path.split('/').filter(Boolean).at(-1) ?? canonical.path
        setName((current) => (current.trim() === '' ? [...folderName].slice(0, 50).join('') : current))
      }
    } catch (error) {
      const reason = error instanceof ApiError ? error.details?.reason : undefined
      setFeedback({
        error: true,
        text: t(reason === 'not-directory' ? 'projectForm.notDirectory' : reason === 'absolute' ? 'projectForm.absolute' : 'projectForm.unavailable'),
      })
    } finally {
      busy.current = false
      setPicking(false)
    }
  }
  const removeFolder = (index: number) => {
    const next = folders.filter((_, current) => current !== index)
    if (folders[index]?.primary && next.length) next[Math.min(index, next.length - 1)] = { ...next[Math.min(index, next.length - 1)]!, primary: true }
    setFolders(next)
    setFeedback(null)
  }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy.current || (!blank && (!name.trim() || folders.length === 0)) || [...name].length > 50) return
    busy.current = true
    setPending(true)
    setFeedback(null)
    try {
      const result = blank && onSubmitBlank ? await onSubmitBlank(name) : await onSubmit({ name: name.trim(), folders })
      onComplete(result)
    } catch (error) {
      const conflict = error instanceof ApiError && error.details?.reason === 'primary-conflict' ? error.details.project : undefined
      const conflictName =
        typeof conflict === 'object' && conflict !== null && 'name' in conflict && typeof conflict.name === 'string' ? conflict.name : undefined
      setFeedback({ error: true, text: conflictName ? t('projectForm.primaryConflict', { name: conflictName }) : t('projectForm.failed') })
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  return (
    <TooltipProvider>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) requestClose()
        }}
      >
        <DialogContent
          data-project-form
          className="max-w-[520px] gap-5 p-6"
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            input.current?.focus()
          }}
          onEscapeKeyDown={(event) => {
            event.preventDefault()
            if (!confirmDiscard) requestClose()
          }}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogTitle className="h-6 pr-8">{t(mode === 'create' ? 'projectForm.create' : 'projectForm.edit')}</DialogTitle>
          <IconButton label={t('projectForm.close')} type="button" disabled={pending || picking} className="absolute top-3 right-3" onClick={requestClose}>
            <IconX aria-hidden className="size-4" stroke={1.1} />
          </IconButton>
          <form
            aria-busy={pending}
            className="flex min-h-0 flex-col gap-5"
            onSubmit={(event) => void submit(event)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault()
            }}
          >
            <div className="relative">
              <IconFolder aria-hidden className="pointer-events-none absolute top-2 left-3 size-4 text-muted-foreground" stroke={1.1} />
              <Input
                ref={input}
                value={name}
                aria-label={t('projectForm.name')}
                placeholder={t('projectForm.name')}
                className="pl-9"
                maxLength={50}
                disabled={pending || picking}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            {blank ? (
              <p className="text-ui-body text-muted-foreground">{t('projectForm.blankHint')}</p>
            ) : (
              <section aria-label={t('projectForm.folders')} className="flex min-h-0 flex-col gap-2">
                <h2 className="text-ui-body font-medium">{t('projectForm.folders')}</h2>
                {folders.length === 0 ? (
                  <button
                    type="button"
                    disabled={pending || picking}
                    onClick={() => void addFolder()}
                    className="flex h-33 shrink-0 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-input text-ui-body focus-ring hover:bg-accent disabled:opacity-50"
                  >
                    <IconFolderPlus aria-hidden className="size-5 text-muted-foreground" stroke={1.1} />
                    <span>{t('projectForm.add')}</span>
                    <span className="text-ui-small text-muted-foreground">{t('projectForm.hint')}</span>
                  </button>
                ) : (
                  <div className="max-h-[min(380px,45vh)] overflow-y-auto rounded-lg bg-card ring-(length:--hairline) ring-border ring-inset">
                    {folders.map((folder, index) => {
                      const basename = folder.path.split('/').filter(Boolean).at(-1) ?? folder.path
                      return (
                        <div
                          key={folder.path}
                          data-project-folder={folder.path}
                          data-primary-folder={folder.primary}
                          className="group/folder flex min-h-14 items-center gap-3 border-b-hairline border-border px-3 py-2"
                        >
                          <IconFolder aria-hidden className="size-4 shrink-0 text-muted-foreground" stroke={1.1} />
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div data-folder-copy data-user-content className="min-w-0 flex-1">
                                <p className="truncate text-ui-body">{basename}</p>
                                <p className="truncate text-ui-small text-muted-foreground">{folder.path}</p>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-[min(420px,calc(100vw-32px))] break-all">{folder.path}</TooltipContent>
                          </Tooltip>
                          <div className="flex w-[68px] shrink-0 items-center justify-center">
                            {folder.primary ? (
                              <span className="rounded-round bg-muted px-2 py-0.5 text-ui-small text-muted-foreground">{t('projectForm.primary')}</span>
                            ) : (
                              <Button
                                type="button"
                                data-make-primary
                                variant="ghost"
                                size="sm"
                                disabled={pending || picking}
                                className="w-full opacity-0 group-hover/folder:opacity-100 group-focus-within/folder:opacity-100 [@media(hover:none)]:opacity-100"
                                onClick={() => setFolders(folders.map((item, current) => ({ ...item, primary: current === index })))}
                              >
                                {t('projectForm.makePrimary')}
                              </Button>
                            )}
                          </div>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                disabled={pending || picking}
                                aria-label={t('projectForm.remove', { name: basename })}
                                className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground focus-ring hover:bg-accent"
                                onClick={() => removeFolder(index)}
                              >
                                <IconX aria-hidden className="size-3.5" stroke={1.1} />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>{t('projectForm.remove', { name: basename })}</TooltipContent>
                          </Tooltip>
                        </div>
                      )
                    })}
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={pending || picking}
                      className="w-full justify-start rounded-none px-3"
                      onClick={() => void addFolder()}
                    >
                      <IconFolderPlus aria-hidden className="size-4" stroke={1.1} />
                      {t('projectForm.add')}
                    </Button>
                  </div>
                )}
              </section>
            )}
            {feedback && (
              <p role={feedback.error ? 'alert' : 'status'} className={feedback.error ? 'text-ui-body text-destructive' : 'text-ui-body text-muted-foreground'}>
                {feedback.text}
              </p>
            )}
            {picking && (
              <p role="status" className="sr-only">
                {t('projectForm.picking')}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              {mode === 'create' && onSubmitBlank && (
                <Button
                  type="button"
                  variant="ghost"
                  className="mr-auto"
                  disabled={pending || picking}
                  onClick={() => {
                    setBlank(!blank)
                    setFeedback(null)
                  }}
                >
                  {t(blank ? 'projectForm.existingFolder' : 'projectForm.blank')}
                </Button>
              )}
              <Button type="button" variant="ghost" disabled={pending || picking} onClick={requestClose}>
                {t('projectForm.cancel')}
              </Button>
              <Button type="submit" disabled={pending || picking || (!blank && (!name.trim() || folders.length === 0))}>
                {t(mode === 'create' ? 'projectForm.create' : 'projectForm.save')}
              </Button>
            </div>
          </form>
          <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
            <DialogContent
              role="alertdialog"
              className="max-w-[400px] gap-3 p-6"
              onOpenAutoFocus={(event) => {
                event.preventDefault()
                document.querySelector<HTMLButtonElement>('[data-keep-project]')?.focus()
              }}
            >
              <DialogTitle>{t('projectForm.discardTitle')}</DialogTitle>
              <DialogDescription>{t('projectForm.discardBody')}</DialogDescription>
              <div className="flex justify-end gap-2">
                <Button data-keep-project variant="ghost" onClick={() => setConfirmDiscard(false)}>
                  {t('projectForm.keep')}
                </Button>
                <Button variant="destructive" onClick={onClose}>
                  {t('projectForm.discard')}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  )
}
