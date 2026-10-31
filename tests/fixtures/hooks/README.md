# Hook 测试夹具

`hook.mjs` 是外部 Hook 的测试替身：读取 stdin 的一行 JSON，按参数记录、输出与退出。参数见脚本开头的注释。
集成测试以 `node <path>/hook.mjs --record <file> --exit 2 --stderr reason` 之类的命令配置 Hook，再读取记录文件断言 Hook 收到的输入。

并行用 barrier 证明，不用墙钟上限：两个 Hook 分别以 `--start <a> --await <b>` 与 `--start <b> --await <a>` 运行，各自创建自己的 start 文件后
等待对方的出现。并行时两者都立即继续；串行时第一个一直等待，用例超时失败。
