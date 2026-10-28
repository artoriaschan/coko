// Sidecar 进程入口：由 Electron main 以 ELECTRON_RUN_AS_NODE=1 启动，或脱离桌面独立运行。
import { main } from './runtime/main.ts'

await main()
