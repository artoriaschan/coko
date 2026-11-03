---
kind: evidence
description: "最终独立 Spec 复核：原两项已解决，剩余与新增均为零。"
lifecycle: active
---

# Spec

复核对象为实际集成 HEAD `28f9b22ab4160cb56682e686c5b1cb9f56d9bb59`，产品提交 `0cfe838b4291278651286f9d6378b5bdb0269d53`。固定比较：`git diff 6e57ed0a7605996ec96173c897b1546c57ed42aa...HEAD`；已读取最终 67 提交清单，并复核原审查后全部源码、证据及文档增量。

1. **原 P2 文件双向折叠与焦点：resolved。** 规格 READ-04 要求“键盘可操作每层开合”及“手动收起先恢复焦点到控制项”。`apps/desktop/src/renderer/features/conversation/file-tool-details.tsx:129` 的控件现在双向切换，折叠时位于头尾之间、全文时位于末尾（:189、:209），符合锁定参考 ReadBlock/DiffBlock 的实际 FoldToggle 消费者；:60 的 layout effect 将焦点恢复到当前控件。整个工具及 FileCodeCard 保持原身份，wrap、复制原文及异步高亮选区逻辑未被替换。真实 App read/edit 双向 Enter、wrap 和既有选区断言，以及最终重构建原生 read→edit 检查均有证据。

2. **原 P2 紧凑编辑统计：resolved。** 规格 DETAIL-03 要求“行号、增删统计、错误与截断提示等实际存在的能力一并对照”并“只展示当前调用有真实数据支持的字段”。`file-tool-details.tsx:38` 仅接受成功 edit 的实际 `details.diff`，与正文共用编号显示 diff 的 +/- 行计数；`tool-cards.tsx:284` 在摘要截断之外显示统计，缺失和错误结果不显示。没有解析独立 patch、重建缺失文件或更改协议。与锁定真实 ToolRow 后缀消费者对应。

新增/剩余 missing、partial、wrong implementation：**0**；unrequested scope：**0**。字体 token 的最终同值成对引用及稳定活动 ID 的字典组合未发现新增规格偏离；已查看亮宽/暗窄存档图及实际动效参数。最终证据区分 R357/S91、1194 原生14/14 与最终重构建1通过/7跳过，没有累加为全仓结果。

本轮为独立只读复核，未运行额外测试。历史 IME/settings Escape/wheel 异常仍未证明根因；参考完整 Host、真实模型、OS 指针/窗口层、发布包与 CI 的未验证限制继续保留，不作为已修复或已验证事实。

Spec：原2项已解决，剩余0项，新增0项。
