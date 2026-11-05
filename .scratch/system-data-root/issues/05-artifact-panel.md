# 05: Artifact 接口与右栏 tab

**What to build:** 独立会话的右栏新增 Artifacts tab，实时列出 `outputs/` 下的文件树。用户可以看文件名、相对路径和大小，用默认应用打开文件、在 Finder 中显示、复制路径。文件被覆盖或删除后列表立即反映；隐藏文件与指向 `outputs/` 外的符号链接不显示。项目会话与旧会话不显示该 tab。

**Blocked by:** 03 独立会话目录与 work/outputs

**Status:** ready-for-agent

- [ ] 独立会话的右栏可以打开 `artifacts` tab，空 `outputs/` 显示明确的空态。
- [ ] 列表包含子目录中的普通文件，显示相对路径；点击文件可以用默认应用打开，支持在 Finder 中显示与复制路径。
- [ ] `outputs/` 下新增、覆盖或删除文件后，重新打开或刷新 tab 能看到变化，不保留历史版本或“已删除”占位。
- [ ] 以 `.` 开头的隐藏文件、指向 `outputs/` 外的符号链接不出现在列表；越界链接不会被跟随。
- [ ] 项目会话、没有 `directory` 的旧会话不显示 Artifacts tab。
- [ ] Artifact 列表通过 sidecar 的 HTTP 接口读取，renderer 不直接访问文件系统；集成测试覆盖过滤与实时变化，浏览器测试覆盖 tab 的空态与文件操作。
