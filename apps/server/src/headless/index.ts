// 无界面运行的入口（产物 dist/sidecar/headless.mjs）：参数、装配与输出见 run.ts 与 docs/subsystems/headless.md（ADR 0019）。
// 先过滤 node:sqlite 的实验警告，再动态导入 run.ts：静态导入会先于本文件的语句执行，警告在过滤安装前就已输出。
import { withoutSqliteExperimentalWarning } from './warnings.ts'

process.emitWarning = withoutSqliteExperimentalWarning(
  process.emitWarning.bind(process) as Parameters<typeof withoutSqliteExperimentalWarning>[0],
) as typeof process.emitWarning
const { runHeadless } = await import('./run.ts')
await runHeadless()
