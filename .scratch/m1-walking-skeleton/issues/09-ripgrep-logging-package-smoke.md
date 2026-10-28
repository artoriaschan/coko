# 09: 随包 ripgrep、日志落盘与打包 smoke

**What to build:** @vscode/ripgrep 经 apps/desktop 分发并传给 Sidecar，server 覆盖内置 grep；main 的 desktop.jsonl 与 renderer 日志转发；`electron-forge package` 产物 smoke（启动、一次对话、确认使用随包 ripgrep）。

**Blocked by:** 07

**Status:** ready-for-agent

- [ ] ripgrep grep 通过与内置 grep 相同的契约测试
- [ ] 路径不可执行时 Sidecar fatal 并在窗口提示
- [ ] package 产物 E2E：启动并完成一次 faux 对话；日志显示生效的 grep 实现为 ripgrep
- [ ] desktop.jsonl 与 sidecar.jsonl 存在且已脱敏

## Comments
