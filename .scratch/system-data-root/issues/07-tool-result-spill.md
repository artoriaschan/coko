# 07: 超长工具结果落盘

**What to build:** 工具结果被截断时，完整正文写入 `~/.coko/data/tool-results/<sessionId>/<toolCallId>.txt`，返回给模型的文本末尾附上该路径。单文件上限 32 MB，超过时只写前 32 MB 并在文件末尾与返回文本中标注 `[truncated]`。当前会话的该目录加入只读根，Agent 可以直接读取；未截断的结果不写盘。

**Blocked by:** 01 主数据根切换到 ~/.coko

**Status:** ready-for-agent

- [ ] 产生超长输出并被截断的工具调用结束后，`data/tool-results/<sessionId>/<toolCallId>.txt` 存在并包含完整正文。
- [ ] 返回给模型的工具结果文本包含该文件的绝对路径，模型可以继续读取完整内容。
- [ ] 未被截断的结果不产生落盘文件。
- [ ] 超过 32 MB 的结果只写入前 32 MB，文件末尾和返回文本都标注 `[truncated]`。
- [ ] Agent 读取当前会话的落盘文件不需要审批；读取其他会话的落盘文件被拒绝或按越界处理。
- [ ] 集成测试覆盖截断落盘、未截断不落盘、上限与跨会话读取限制。
