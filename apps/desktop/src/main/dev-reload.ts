import { watch, type FSWatcher } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'

export interface ReloadWatcher {
  /** 已读取初始内容；之后的替换才会触发。 */
  readonly ready: Promise<void>
  close(): void
}

/**
 * 开发时监视 Sidecar 重建的通知文件（forge.config.ts 经 COKO_SIDECAR_RELOAD_FILE 传入，build.ts 原子替换它）。
 * 监视所在目录：rename 替换后直接监视文件会失效。同一次替换的多个事件在 debounceMs 内合并，内容未变时不触发。
 */
export function watchSidecarReload(file: string, onReload: () => void, { debounceMs = 100 }: { debounceMs?: number } = {}): ReloadWatcher {
  const name = basename(file)
  let last: string | undefined
  let timer: NodeJS.Timeout | undefined
  let closed = false
  const read = () => readFile(file, 'utf8').catch(() => undefined)
  const initial = read().then((content) => {
    last ??= content
  })
  const check = async () => {
    await initial
    const content = await read()
    if (closed || content === undefined || content === last) return
    last = content
    onReload()
  }
  const watcher: FSWatcher = watch(dirname(file), (_event, changed) => {
    if (changed !== null && changed !== name) return
    clearTimeout(timer)
    timer = setTimeout(() => void check(), debounceMs)
  })
  watcher.on('error', () => undefined)
  return {
    ready: initial,
    close: () => {
      closed = true
      clearTimeout(timer)
      watcher.close()
    },
  }
}
