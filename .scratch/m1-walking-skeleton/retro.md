# M1 复盘

2026-10-29，lead。按 retro skill 的分类列出对后续里程碑环境的改进建议；标"已采纳"的是 lead 在授权范围内直接执行的流程调整，其余为建议。

## 按严重度

1. **自动检查 / 无 CI 守卫。** 仓库只有本地 husky（lint-staged、commitlint），没有 CI 运行 typecheck / lint / test。仓库没有 remote，CI 暂不可接；替代做法：合入 main 前由 lead 在 main 上复核 install、typecheck、lint、format:check、test、check:docs（M1 每次合入都执行，已采纳）。有 remote 后接入 CI 是首选。
2. **并行票的共享文件冲突。** 票 05/06 在 renderer 根文件、票 08/09 在 main 装配入口与 bridge、所有票在 TECH_STACK"接入状态"表与 lockfile 上冲突；05/06 冲突需要单独的合并子代理。后台子代理无法接收 send_message，开工后无法协调。改进（已采纳）：M2 起每张票在票头写 `Write scope:`，lead 只并行写范围不重叠的票；共享装配点（main 入口、bridge、protocol index）在票中指定唯一所有者。
3. **评审发现的安全缺口来自跨层路径。** A1（进度未脱敏）、A2（bash 继承凭据环境）、F5（编码路径绕过）都是"入库路径做了、另一路径漏了"。改进建议：在 tests/integration 增加一个"秘密不外泄"总闸测试，用唯一标记密钥驱动错误、重试、工具输出后扫描 WebSocket 帧、HTTP 响应、库文件与日志（M2 第一张票的验收项）。
4. **评审时点。** 两轴评审在 9 张票全部合入后对 2 万行 diff 抽样进行，未读部分较多。改进（已采纳）：M2 起每张票合入前由 lead 起一个轻量 Spec 评审（只看该票 diff），里程碑末再做两轴全量评审。
5. **工具经济。** lead 多次只回复"OK"而未执行合并，靠下一轮发现。改进（已采纳）：收到实施完成报告时，同一步完成"评审 diff → 合入 → main 复核 → 关票 → 清理 worktree"。
6. **信息获取。** 无真实模型密钥，真实模型场景全部跳过。建议用户在方便时提供 `DEEPSEEK_API_KEY`（仅环境变量），以补跑真实模型用例。
7. **耗时。** 每次 `pnpm run test` 都打包一次（约 6 秒）且 E2E 串行；当前可接受。若 M2 后全量超过数分钟，再拆出 `test:fast`（不含 E2E）。

## 结果

- 交付：9 张票 + 评审修复票，main 532d285 起；全量 55 文件 438 通过、1 跳过（真实模型）。
- ADR：0002、0004 implemented；0001、0003 partial。
- 遗留项已记入地图 Carry-overs。
