# 08: 设置、Provider 与 Credential

**What to build:** 设置弹窗（General：主题、语言；Models：Provider 增改删与模型列表；About）；Credential 经 preload → main safeStorage 加密 → Sidecar 存密文；Sidecar 调模型时经控制 IPC 取明文（[ADR 0004](../../../docs/adr/0004-model-credentials-safe-storage.md)）；输入区模型选择；未配置时引导到设置。

**Blocked by:** 07

**Status:** ready-for-agent

- [ ] Electron E2E：添加 Provider 与密钥后界面只显示末四位；数据库文件中不含明文
- [ ] 设置在重启后保留；revision 冲突时提示并保留输入
- [ ] 未配置 Provider 时发送入口引导到设置
- [ ] 具备真实凭据环境变量时，一次真实对话成功；否则报告未验证

## Comments
