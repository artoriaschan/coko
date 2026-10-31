// 无界面运行的入口（产物 dist/sidecar/headless.mjs）：参数与输出格式、审批自动拒绝（ADR 0019）由无界面运行接入。当前只打印说明并以 4
// （参数或启动错误）退出。
process.stderr.write('coko headless: not implemented\n')
process.exit(4)
