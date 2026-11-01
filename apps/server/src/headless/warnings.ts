// node:sqlite 在 Electron 内置的 Node 中首次加载时经 process.emitWarning 输出一条 ExperimentalWarning。headless 的 stderr 只放运行说明
// （docs/subsystems/headless.md），脚本据此判断是否出错，所以只过滤这一条；其他警告照常输出。

type EmitWarning = (warning: string | Error, ...rest: unknown[]) => void

/** 包装 emitWarning：丢弃 SQLite 的 ExperimentalWarning，其余调用原样转给 emit。 */
export function withoutSqliteExperimentalWarning(emit: EmitWarning): EmitWarning {
  return (warning, ...rest) => {
    const option = rest[0]
    const type = typeof option === 'string' ? option : (option as { type?: unknown } | undefined)?.type
    if (type === 'ExperimentalWarning' && typeof warning === 'string' && warning.startsWith('SQLite ')) return
    emit(warning, ...rest)
  }
}
