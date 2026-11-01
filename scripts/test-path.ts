// 测试进程的 PATH：去掉 git 解析到其他程序的目录（例如 git-ai 的 ~/.git-ai/bin/git -> git-ai）。
// 这类包装按 HOME 各起一个后台进程；测试的 git 夹具每次使用新的临时 HOME，删除临时目录后进程仍在，累积后耗尽 kern.maxprocperuid。
// 根 vitest.config.ts 在 worker 启动前调用，worker、Sidecar 与 Electron 子进程都继承清理后的 PATH。只影响测试进程。
import { realpathSync } from 'node:fs'
import path from 'node:path'

/** 返回去掉 git 包装目录后的 PATH；目录中的 git 是解析到名为 git 的文件时保留。 */
export function withoutGitWrappers(value: string | undefined): string | undefined {
  if (value === undefined || value === '') return value
  return value
    .split(path.delimiter)
    .filter((dir) => {
      let target: string
      try {
        target = realpathSync(path.join(dir, 'git'))
      } catch {
        return true
      }
      return path.basename(target) === 'git'
    })
    .join(path.delimiter)
}
