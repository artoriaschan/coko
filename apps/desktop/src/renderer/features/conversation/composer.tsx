import { IMAGE_ATTACHMENT_MAX_BYTES, type FileAttachment, type ImageAttachment } from '@coko/protocol'
import { Button, cn, ComposerEditor, Tooltip, TooltipContent, TooltipTrigger, type ComposerEditorHandle } from '@coko/ui'
import { IconArrowUp, IconLoader2, IconPlayerPause, IconPlus, IconSettings, IconSquare, IconX } from '@tabler/icons-react'
import * as React from 'react'
import { useStore } from 'zustand'
import { useI18n } from '../../app/i18n.tsx'
import type { CommandTarget } from '../../stores/commands-store.ts'
import { contextStore as defaultContextStore, type ContextStore } from '../../stores/context-store.ts'
import { appDraftStore, draftKey, type DraftStore } from '../../stores/draft-store.ts'
import { attachmentFromFile, fileDrafts, imageDrafts, imageFromFile, type DraftFile, type DraftImage } from '../../stores/image-drafts.ts'
import { CommandMenu } from './command-menu.tsx'
import { ContextRingControl } from './context-ring.tsx'
import { FileMenu } from './file-menu.tsx'

export interface ComposerProps {
  running: boolean
  /** 没有可发送的目标（无 Workspace）时禁用。 */
  disabled: boolean
  /** 没有可用模型：发送入口改为引导到设置，草稿保留。 */
  needsSetup: boolean
  onSend: (text: string, images?: ImageAttachment[], files?: FileAttachment[]) => Promise<boolean>
  supportsImages?: boolean
  imageRefs?: string[]
  onImageRefsChange?: (refs: string[]) => void
  readPickedImage?: (path: string) => Promise<ImageAttachment>
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
  /** 权限选择，位于计划状态之前。模型选择继续使用 accessory。 */
  permissionControl?: React.ReactNode
  /** 底栏最前的 Plan chip 槽（plan 模式时显示）；没有内容时不占位。 */
  planChip?: React.ReactNode
  /** 焦点在编辑区时 Shift+Tab：切换到下一档 Permission Mode（不移动焦点）。 */
  onCycleMode?: () => void
  className?: string
  /** 命令目录的作用域（当前会话或 Workspace 草稿）：草稿开头输入 / 时显示命令菜单。省略时没有命令菜单。 */
  commandTarget?: CommandTarget | undefined
  /** @ 文件菜单的 Workspace（当前会话的或草稿的）。省略时没有文件菜单。 */
  fileWorkspaceId?: string | undefined
  pickFiles?: () => Promise<readonly string[]>
  getFilePath?: (file: File) => string
  /** 草稿持久化（测试注入）；缺省为应用内共用的 localStorage store。草稿按 commandTarget 区分，省略 commandTarget 时不持久化。 */
  drafts?: DraftStore
  /** 新对话使用独立且唯一的草稿键，不需要虚构 Workspace 或启用命令。 */
  draftStorageKey?: string
  /** 上下文用量与压缩进度（测试注入）；缺省为应用内共用的 store。 */
  contextStore?: ContextStore
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
  supportsImages = false,
  imageRefs,
  onImageRefsChange,
  readPickedImage = async (path) => {
    const result = await window.coko?.readPickedImage(path)
    if (!result) throw new Error('Image read unavailable')
    return { ...result, mimeType: result.mimeType as ImageAttachment['mimeType'] }
  },
  onSteer,
  onStop,
  onPause,
  pausing = false,
  onSetup,
  accessory,
  permissionControl,
  planChip,
  onCycleMode,
  className,
  commandTarget,
  fileWorkspaceId,
  pickFiles = () => window.coko?.pickFiles() ?? Promise.resolve([]),
  getFilePath = (file) => window.coko?.getFilePath(file) ?? '',
  drafts: injectedDrafts,
  draftStorageKey,
  contextStore = defaultContextStore,
  ref,
}: ComposerProps) {
  const { t } = useI18n()
  const sessionId = commandTarget && 'sessionId' in commandTarget ? commandTarget.sessionId : undefined
  const compacting = useStore(contextStore, (s) => sessionId !== undefined && s.compacting[sessionId] === true)
  const editor = React.useRef<ComposerEditorHandle>(null)
  const [empty, setEmpty] = React.useState(true)
  const [attachmentError, setAttachmentError] = React.useState<string | null>(null)
  const [picking, setPicking] = React.useState(false)
  const key = draftStorageKey ?? (commandTarget ? draftKey(commandTarget) : undefined)
  const [imagesReady, setImagesReady] = React.useState(false)
  const [files, setFiles] = React.useState<DraftFile[]>([])
  const fileState = React.useRef<{ key: string | undefined; files: DraftFile[] }>({ key, files: [] })
  const rememberFiles = (target: string | undefined, next: DraftFile[]) => {
    if (target !== undefined)
      fileDrafts.remember(
        target,
        next.map((file) => file.id),
      )
    if (fileState.current.key === target) {
      fileState.current.files = next
      setFiles(next)
    }
  }
  const [images, setImages] = React.useState<DraftImage[]>([])
  const imageState = React.useRef<{ key: string | undefined; images: DraftImage[] }>({ key, images: [] })
  const refsChanged = React.useRef(onImageRefsChange)
  refsChanged.current = onImageRefsChange
  const rememberImages = (target: string | undefined, next: DraftImage[]) => {
    const refs = next.map((image) => image.id)
    if (target !== undefined) {
      if (target === draftStorageKey && refsChanged.current) refsChanged.current(refs)
      else imageDrafts.remember(target, refs)
    }
    if (imageState.current.key === target) {
      imageState.current.images = next
      setImages(next)
    }
  }
  React.useLayoutEffect(() => {
    imageState.current = { key, images: [] }
    setImages([])
    fileState.current = { key, files: [] }
    setFiles([])
    const fileRefs = key === undefined ? [] : fileDrafts.refs(key)
    const refs = key === undefined ? [] : (imageRefs ?? imageDrafts.refs(key))
    setImagesReady(refs.length === 0 && fileRefs.length === 0)
    setAttachmentError(null)
    let active = true
    if (refs.length > 0 || fileRefs.length > 0)
      void Promise.all([imageDrafts.load(refs), fileDrafts.load(fileRefs)])
        .then(([loaded, loadedFiles]) => {
          if (active) {
            imageState.current.images = loaded
            fileState.current.files = loadedFiles
            setImages(loaded)
            setFiles(loadedFiles)
            setImagesReady(true)
          }
        })
        .catch(() => {
          if (active) setAttachmentError(t('conversation.attachmentFailed'))
        })
    return () => {
      active = false
    }
  }, [key])
  const attach = async (items: readonly { path: string; type?: string; file?: File }[]) => {
    if (disabled || !imagesReady) return
    const target = imageState.current.key
    let error: string | null = null
    for (const item of items) {
      if (item.type?.startsWith('image/') || /\.(?:png|jpe?g|gif|webp|bmp|svg|heic|avif|tiff?)$/i.test(item.path)) {
        if (!supportsImages) {
          error = t('conversation.imagesUnavailable')
          continue
        }
        try {
          const image = item.file ? await imageFromFile(item.file) : await readPickedImage(item.path)
          if (image.data.length > Math.ceil(IMAGE_ATTACHMENT_MAX_BYTES / 3) * 4) throw new Error('image-too-large')
          const saved = await imageDrafts.save(image)
          if (imageState.current.key !== target) {
            await imageDrafts.remove([saved.id])
            continue
          }
          rememberImages(target, [...imageState.current.images, saved])
        } catch (reason) {
          error = t(reason instanceof Error && /4.5|image-too-large/.test(reason.message) ? 'conversation.imageTooLarge' : 'conversation.imageInvalid')
        }
        continue
      }
      try {
        const sourcePath = item.file ? getFilePath(item.file) : item.path
        if (!item.file) await window.coko?.validatePickedFile?.(sourcePath)
        const file = item.file
          ? await attachmentFromFile(item.file, sourcePath)
          : { name: item.path.replace(/\\/g, '/').split('/').pop() || 'attachment', path: item.path }
        const saved = await fileDrafts.save(file)
        if (fileState.current.key !== target) {
          await fileDrafts.remove([saved.id])
          continue
        }
        rememberFiles(target, [...fileState.current.files, saved])
      } catch (reason) {
        error = t(reason instanceof Error && /file-too-large|32 MB/.test(reason.message) ? 'conversation.fileTooLarge' : 'conversation.attachmentFailed')
      }
    }
    if (imageState.current.key === target) setAttachmentError(error)
  }
  const attachTransfer = (files: FileList) => {
    try {
      void attach(Array.from(files, (file) => ({ path: getFilePath(file) || file.name, type: file.type, file })))
    } catch {
      setAttachmentError(t('conversation.attachmentFailed'))
    }
  }
  const drafts = React.useMemo(() => (key === undefined ? undefined : (injectedDrafts ?? appDraftStore())), [key === undefined, injectedDrafts])
  // 编辑区当前内容所属的草稿键；作用域改变时读目标草稿，不复制已提交的消息。
  const loadedKey = React.useRef<string | undefined>(undefined)
  const persist = React.useCallback(() => {
    const target = loadedKey.current
    const handle = editor.current
    if (target === undefined || !drafts || !handle) return
    if (handle.getText().trim() === '') drafts.remove(target)
    else drafts.schedule(target, () => handle.getEditorState())
  }, [drafts])
  // 作用域变化（切换会话、新会话）：写入上一个作用域的待写草稿，载入新作用域的草稿；损坏的草稿丢弃，输入区为空。
  React.useLayoutEffect(() => {
    const handle = editor.current
    if (key === undefined || !drafts || !handle) {
      loadedKey.current = undefined
      return
    }
    loadedKey.current = key
    const saved = drafts.load(key)
    if (saved === undefined) handle.clear()
    else if (!handle.setEditorState(saved)) {
      drafts.discard(key, 'rejected-by-editor')
      handle.clear()
    }
    return () => drafts.flush()
  }, [key, drafts, persist])
  /** 提交被接受后清除提交时所属作用域的草稿（编辑区随后被清空，persist 再处理当前作用域）。 */
  const withDraft = React.useCallback(
    (submit: (text: string, images?: ImageAttachment[], files?: FileAttachment[]) => Promise<boolean>) => async (text: string) => {
      if (!imagesReady) return false
      const at = loadedKey.current
      const submitted = [...imageState.current.images]
      const submittedFiles = [...fileState.current.files]
      if (submitted.length && !supportsImages) {
        setAttachmentError(t('conversation.imagesUnavailable'))
        return false
      }
      if ((submitted.length || submittedFiles.length) && running) {
        setAttachmentError(t('conversation.attachmentsWhileRunning'))
        return false
      }
      const imagePayload = submitted.map(({ id: _id, ...image }) => image)
      const filePayload = submittedFiles.map(({ id: _id, ...file }) => file)
      const accepted = await (filePayload.length
        ? submit(text, imagePayload.length ? imagePayload : undefined, filePayload)
        : imagePayload.length
          ? submit(text, imagePayload)
          : submit(text))
      if (accepted && submittedFiles.length) {
        const removed = new Set(submittedFiles.map((file) => file.id))
        if (fileState.current.key === at)
          rememberFiles(
            at,
            fileState.current.files.filter((file) => !removed.has(file.id)),
          )
        else if (at !== undefined)
          fileDrafts.remember(
            at,
            fileDrafts.refs(at).filter((id) => !removed.has(id)),
          )
        await fileDrafts.remove([...removed])
      }
      if (accepted && submitted.length) {
        const removed = new Set(submitted.map((image) => image.id))
        if (imageState.current.key === at)
          rememberImages(
            at,
            imageState.current.images.filter((image) => !removed.has(image.id)),
          )
        else if (at !== undefined)
          imageDrafts.remember(
            at,
            imageDrafts.refs(at).filter((id) => !removed.has(id)),
          )
        await imageDrafts.remove([...removed])
      }
      if (accepted && at !== undefined && at !== loadedKey.current) drafts?.remove(at)
      return accepted
    },
    [drafts, supportsImages, running, imagesReady],
  )
  const send = React.useMemo(() => withDraft(onSend), [withDraft, onSend])
  const steer = React.useMemo(() => withDraft(onSteer), [withDraft, onSteer])
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
      data-slot="composer"
      className={cn(
        'relative flex min-h-30 flex-col rounded-panel bg-background shadow-soft',
        (compacting || images.length > 0 || files.length > 0) && 'h-auto min-h-30',
        className,
      )}
      onPasteCapture={(event) => {
        if (event.clipboardData.files.length === 0) return
        event.preventDefault()
        attachTransfer(event.clipboardData.files)
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault()
      }}
      onDropCapture={(event) => {
        if (event.dataTransfer.files.length === 0) return
        event.preventDefault()
        attachTransfer(event.dataTransfer.files)
      }}
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
      {attachmentError && (
        <p role="alert" className="absolute bottom-full left-3 mb-2 text-ui-body text-destructive">
          {attachmentError}
        </p>
      )}
      {compacting && (
        // 压缩进行中（自动或 /compact）：独占一行，排在编辑区之上；停止不提交 compaction 条目。
        <div role="status" data-slot="compaction-status" className="order-first flex w-full items-center gap-2 px-3 pt-3 text-ui-body text-muted-foreground">
          <IconLoader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
          <span className="min-w-0 flex-1">{t('context.compaction.inProgress')}</span>
          <Button type="button" size="sm" variant="ghost" data-action="stop-compaction" onClick={onStop}>
            {t('context.compaction.stop')}
          </Button>
        </div>
      )}
      {files.length > 0 && (
        <ul data-slot="file-drafts" className="flex flex-wrap gap-2 px-3 pt-3" aria-label={t('conversation.fileAttachments')}>
          {files.map((file) => (
            <li key={file.id} className="flex min-w-0 items-center gap-2 rounded-lg border-hairline border-border px-2 py-1 text-ui-body">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="min-w-0 max-w-60 truncate">
                    {file.name}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{file.name}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={t('conversation.removeFile', { name: file.name })}
                    onClick={() => {
                      rememberFiles(
                        key,
                        files.filter((item) => item.id !== file.id),
                      )
                      void fileDrafts.remove([file.id])
                    }}
                  >
                    <IconX aria-hidden />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('conversation.removeFile', { name: file.name })}</TooltipContent>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
      {images.length > 0 && (
        <ul data-slot="image-drafts" className="flex shrink-0 gap-2 overflow-x-auto px-3 pt-3" aria-label={t('conversation.imageAttachments')}>
          {images.map((image) => (
            <li key={image.id} className="relative shrink-0">
              <img
                src={`data:${image.mimeType};base64,${image.data}`}
                alt={image.name}
                className="size-16 rounded-sm border-hairline border-border bg-muted object-contain"
              />
              <Button
                type="button"
                size="icon-xs"
                variant="outline"
                className="absolute top-1 right-1 bg-background"
                aria-label={t('conversation.removeImage', { name: image.name })}
                onClick={() => {
                  rememberImages(
                    key,
                    images.filter((item) => item.id !== image.id),
                  )
                  void imageDrafts.remove([image.id])
                }}
              >
                <IconX aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex min-h-0 flex-1 flex-col px-3 pt-3 pb-2">
        <ComposerEditor
          allowEmpty={images.length > 0 || files.length > 0}
          ref={editor}
          // 输入框自身不留内边距，编辑区与工具栏各自留白；编辑区独立滚动，长草稿不挤压工具栏。
          className="min-h-0 [&_[contenteditable]]:h-full [&_[contenteditable]]:min-h-0 [&_[contenteditable]]:max-h-full [&_[contenteditable]]:p-0 [&_[contenteditable]]:outline-hidden [&_[data-slot=composer-placeholder]]:inset-x-0 [&_[data-slot=composer-placeholder]]:top-0"
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
                ? steer
                : send
          }
          onEscape={running ? onStop : undefined}
          onEmptyChange={setEmpty}
          onDraftChange={persist}
        >
          {commandTarget && <CommandMenu target={commandTarget} />}
          {fileWorkspaceId !== undefined && <FileMenu workspaceId={fileWorkspaceId} />}
        </ComposerEditor>
      </div>
      <div data-slot="composer-toolbar" className="relative flex h-10 shrink-0 items-center gap-2 px-3 pb-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-toolbar"
              variant="toolbar"
              data-action="attach"
              aria-label={t('conversation.attach')}
              disabled={disabled || picking || !imagesReady}
              onClick={async () => {
                setPicking(true)
                try {
                  await attach((await pickFiles()).map((path) => ({ path })))
                } catch {
                  setAttachmentError(t('conversation.attachmentFailed'))
                } finally {
                  setPicking(false)
                }
              }}
            >
              <IconPlus aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('conversation.attach')}</TooltipContent>
        </Tooltip>
        {permissionControl}
        {planChip}
        <span className="min-w-0 flex-1" />
        {/* 上下文用量环：只属于已发送过请求的会话；新对话草稿与无会话作用域不显示。 */}
        {commandTarget && 'sessionId' in commandTarget && <ContextRingControl target={commandTarget} store={contextStore} />}
        {accessory}
        {setup ? (
          <Button type="submit" size="sm" data-action="setup" disabled={disabled} className="shrink-0">
            <IconSettings aria-hidden />
            {t('models.configure')}
          </Button>
        ) : (
          <>
            {(!running || !empty) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="submit"
                    size="icon-toolbar"
                    aria-label={sendLabel}
                    data-action={running ? 'steer' : 'send'}
                    disabled={disabled || !imagesReady || (empty && images.length === 0 && files.length === 0)}
                    className="rounded-round [&_svg]:size-4 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 disabled:[&_svg]:opacity-35"
                  >
                    <IconArrowUp aria-hidden />
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
                      size="icon-toolbar"
                      variant="outline"
                      aria-label={pausing ? t('conversation.pausing') : t('conversation.pause')}
                      data-action="pause"
                      data-pausing={pausing || undefined}
                      disabled={disabled || pausing}
                      onClick={onPause}
                    >
                      <IconPlayerPause aria-hidden className="fill-current" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{pausing ? t('conversation.pausing') : t('conversation.pause')}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button type="button" size="icon-toolbar" aria-label={t('conversation.stop')} data-action="stop" disabled={disabled} onClick={onStop}>
                      <IconSquare aria-hidden className="fill-current" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{t('conversation.stop')}</TooltipContent>
                </Tooltip>
              </>
            )}
          </>
        )}
      </div>
    </form>
  )
}
