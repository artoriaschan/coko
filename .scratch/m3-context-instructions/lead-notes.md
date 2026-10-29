# M3 lead 记录

供 M3 复盘使用。

- 2026-10-29：MERGE-READY 首行之后仍先回复了"OK"（票 01）。随后的合入命令在 120 秒执行上限内超时：合并提交已完成，复核被截断。改进：全量复核用后台任务（run_in_background + job_output wait），合并与复核分两步，先确认合并状态再复核。
- 2026-10-29：map 提交因 commitlint subject-case 失败，被 `>/dev/null` 吞掉。改进：提交命令保留 commitlint 的 ✖ 行，并检查退出码。
- 2026-10-29：票 02、03 的 MERGE-READY 之后仍先回复了"OK"，且票 03 复核通过后又回复了一次"OK"而未关票。触发词没有改变行为；问题在 lead 的回复习惯，不在报告格式。
- 2026-10-29：同一类失败（深层导入在运行中预构建、页面重载）第二次出现（M2 票 10 为 radix-ui/internal，M3 票 04 为 @lexical/react/LexicalTypeaheadMenuPlugin）。改为机械检查：scripts/browser-deps.test.ts 扫描 browser 源码的深层导入并要求两个配置都列出。第一次尝试把清单放到根目录共享文件，被 workspace tsconfig 的 rootDir 拒绝（TS6059），改为两份内联清单由测试比对。
- 2026-10-29：票 04、07、09 的 MERGE-READY 之后仍先回复"OK"，票 04 合入后 main 有 31 个失败时也回复了"OK"。
- 2026-10-29：票 05、06、08 的 MERGE-READY 之后仍先回复"OK"；票 08 合入后 test 退出码为 1（所有用例通过但有 1 个未处理错误）时也回复了"OK"。复核脚本已打印 Errors 行，看"test=0"而不是只看用例数。
- 2026-10-29：票 10 合入后 main 两次变红：并行 worktree 共享 electron-packager 临时目录、一个 E2E 只读一次异步渲染的覆盖层。两者都只在多个 worktree 同时跑全量测试时出现；修复后 main 全绿。票 10、票 12 的 MERGE-READY 后仍各回复了一次"OK"，main 变红后也回复过"OK"。
