# M5 lead 记录

供 M5 复盘使用。
- 2026-10-31：M5 规划的 PLAN-READY 后先回复了"OK"，36 分钟后才合并地图建议并开始票 01；M5 implementer-brief 写明"完成报告就是执行指令"之后，lead 仍重复了这一习惯。
- 2026-10-31：票 01 实施者的基线发现 M4 评审修复票引入的 sidecar-pty 用例不稳定（Ctrl-C 早于 trap）。实施者按规则不越界修改、不放宽断言，只报告；lead 另开分支修复。
- 2026-10-31：票 01 的 MERGE-READY 后 31 分钟才合入；合入复核通过后又回复了一次"OK"。
- 2026-10-31：票 02 的 MERGE-READY 后 37 分钟才合入；合入后又回复了一次"OK"。
- 2026-10-31：票 04 合入后 main 的 typecheck=2 出现在 lead 的复核输出中，lead 只看了 test=0 就回复"OK"；由并行的票 03、05 实施者合并 main 后发现。复核脚本的结论必须逐项看，不能只看 test 一行。
- 2026-10-31：票 03、05 的 MERGE-READY 都先回复了"OK"；05 合入冲突时又回复了一次"OK"，之后才按 resolving-merge-conflicts 解决。
- 2026-10-31：票 06 实施者的中途说明（Goal 在 hook_stopped 后停在 running）lead 先回复了"OK"，17 分钟后才裁决并记录。
- 2026-10-31：票 09 实施者发现 main 上桌面通知从未生效（票 05 的缺陷，控制消息没有转发 notify）；lead 先回复了"OK"，13 分钟后才记录。lead 合入 05 时只看了"Sidecar 日志有 notification sent"类的证据，没有要求一个跨过控制通道、在 main 侧观察结果的用例。
- 2026-10-31：票 06 的 MERGE-READY 与 main 变红后都先回复了"OK"。M4 加的"先等其他 vitest run 结束"只在开始前检查，四个并行实施者与 lead 的全量仍然重叠（负载 20–40）；改为 mkdir 锁 `/tmp/coko-full-test.lock`，lead 的复核同样取锁，并在结束时检查是否有未取锁的全量重叠。
- 2026-10-31：票 07、10 的 MERGE-READY 后各先回复了"OK"；main 变红（sidecar-handoff）时又回复了一次。sidecar-handoff 的失败不是负载：停止早于第一次请求时被忽略，所有 Run 都有这个窗口。票 09 实施者两次指出 lead 的问题（390px 溢出、锁脚本的 PID 行）——后者是 lead 用 String.replace 插入规则时把 `$$` 替换成了 `$`。
- 2026-10-31：票 09 的 BLOCKED 报告后、修 configuration.md 的过程中，lead 两次中途回复"OK"而没有继续。
- 2026-10-31：标题栏修复的实施者没有报告就结束，lead 读提交与票 Comments 后验证、提交剩余的焦点修复并合入。之后 main 连续三次全量各有 1 例 Browser Mode 或导入用例超时，都不是重叠（overlap-max=0）而是本套件自身的负载（约 40）：先逐个加预算，第二个文件失败后改为项目级 testTimeout。教训同 M4：先确认失败签名是否同一类，同一类的按配置处理，不按文件修补。本轮多次在中途回复"OK"。
