// 无界面运行的入口（产物 dist/sidecar/headless.mjs）：参数、装配与输出见 run.ts 与 docs/subsystems/headless.md（ADR 0019）。
import { runHeadless } from './run.ts'

await runHeadless()
