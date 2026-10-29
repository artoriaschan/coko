# M3 lead 记录

供 M3 复盘使用。

- 2026-10-29：MERGE-READY 首行之后仍先回复了"OK"（票 01）。随后的合入命令在 120 秒执行上限内超时：合并提交已完成，复核被截断。改进：全量复核用后台任务（run_in_background + job_output wait），合并与复核分两步，先确认合并状态再复核。
- 2026-10-29：map 提交因 commitlint subject-case 失败，被 `>/dev/null` 吞掉。改进：提交命令保留 commitlint 的 ✖ 行，并检查退出码。
- 2026-10-29：票 02、03 的 MERGE-READY 之后仍先回复了"OK"，且票 03 复核通过后又回复了一次"OK"而未关票。触发词没有改变行为；问题在 lead 的回复习惯，不在报告格式。
