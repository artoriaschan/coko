---
kind: design
description: "消息底栏的请求级计量事实、完整性和兼容读取设计。"
lifecycle: active
status: approved
---

# 消息底栏功能设计

## 问题与来源

本设计实施[规格](spec.md)的 USAGE-01—09。2026-11-04 用户已批准规格及实施流程；以下为该授权内工程选择，未改变产品范围。遵守 [append-only 存储](../../docs/adr/0003-settings-and-sessions-in-sqlite.md)、[测试边界](../../docs/tech-stack/testing.md)和[界面规则](../../docs/tech-stack/ui.md)。

## 计量事实与责任

- Provider 适配边界通过 pi-ai 支持的请求级 onProviderStreamEvent，在依赖默认填零及归一化之前观察原始协议 usage，不复制 SSE 解析器、不全局替换 fetch、不保存正文或凭据。依赖生成的 Usage 默认零不能证明服务报告；仅原始有效非负整数及协议定义的缺省零形成 known 分桶。
- 四分桶是互斥的 input（未缓存）、cacheRead、cacheWrite、output。OpenAI 输入含缓存，先减去缓存；Anthropic input 原本不含缓存。reasoning 仅作为 output 子集。字段缺失或非法时保留其他有效分桶，完整性为 false；未知字段不导致整个报告丢弃。
- 请求终止时把归一化计数及 usageReport（complete、known、可选 reasoning）送入既有 model_request；请求身份 requestId 每个实际调用创建一次，信封 Session 与 runId 确定归属。02 将重试内层的每次真正调用纳入同一 meter 契约；计划中的重试没有身份。
- model_request 是新请求的唯一累计来源。UI 按 requestId 去重；一个 Run 有新计量记录时不再把同 Run 的助手消息或压缩记录相加。标题只入 Session 累计，子 Session 自行归属，复制到 Fork 的无 runId 历史不计新增。
- assistant usage 保留费用和合法 reasoning/cacheWrite1h，旧合法记录可读取。旧记录没有 usageReport 时只提供已知历史小计，不能证明完整；不更新既有 Session Entry。model_request 新字段可选，旧版记录保持兼容；无需补写猜测计数。

## 状态与失败

报告记录已知分桶，所有必要分桶可靠且请求正常终止时 complete。失败或取消强制不完整；未取得报告时 known 为空。数值字段保留零以兼容预算与追踪消费者，但 UI 必须依据 known 区别零和未知。费用字段沿用现有定价，移除费用仅限新底栏展示。

## 选择与验证

复用既有请求记录避免再建计量表。放宽所有校验无法保留字段存在性，单从助手消息求和会漏失败压缩，因此不采用。验证使用已确认的真实 Sidecar 协议、App Browser Mode 和静默 Electron；仅模型/网络/时钟边界可替换。先以真实三协议 SSE 捕获扩展字段回归，再检查持久化重启、去重和可见未知/实测零。真实 Provider 凭据未提供时单独报告。

## 助手底栏的展示

底栏消费已有 Run 与请求事实，不新增存储或第二套汇总。只有实际 run_end 为 completed，且其之前最后一条助手消息以 stop/length 结束并有非空文本时，在该消息最后一个可见文本块下放置一个底栏；复制合并该消息全部原始文本块，以空行分隔。显示身份沿用原有 live→committed 映射，底栏只作为原消息的子节点追加。停止、失败与无最终正文保留既有结束输出，由后续切片接入同一计数。

消息底栏不依赖定价设置，因而独立子 Session 阅读器也能通过自己所属条目呈现。共用 sumUsage 的 reported 小计只累计 known 分桶，兼容数值仍留给费用等原消费者；展示四个互斥分桶，不完整时名称为已报告小计，缺失分桶使用未知或已知下界，reasoning 明确为已报告的输出子集。缓存命中率只在完整报告且总输入非零时展示，分母包含未缓存输入、缓存读取与缓存写入。

时间始终独立于操作显隐。历史操作在 hover/focus 时显示；共享 Popover 打开状态保持操作可见，因为 portal 不在父消息 hover 树内。共享浮层负责上下优先与边缘避让、关闭与焦点归还，长模型名允许换行。分支保留位于复制与用量之间的真实动作插槽，调用方没有提供动作时不产生按钮。
## 每次尝试、失败压缩与计量消费者

02 将原有 meter 移入 withRetry 内层，只有真正调用模型时创建 requestId，按结束顺序排队；失败尝试在重试退避前等待持久化，最终尝试在消息结束时提交。每条记录 retries 表示该逻辑调用之前失败的次数，durationMs 仅该次尝试，不含退避。退避中取消仍只有已经发出的记录。因此退避时崩溃重启仍能回看已报告的失败消耗；摘要结果在 finally 提交请求事实，不依赖 compaction 成功。

Goal 用量对每个 Run 优先采用带 requestId 的请求事实，按身份去重并抑制消息/压缩/交接重复载体；旧 Run 沿用原 usage，子 Session 保持原 Goal 归属。Trace 同样按请求身份去重。UI 继续复用 01 的汇总，不另造异常算法。上下文估算仍以当前上下文计量，不改为历史消耗累计。

原始协议连续报告可省略先前字段，观察器保留已经取得的计数；OpenAI 缓存重新分桶基于最近有效原始输入总数，不将已缓存计数重复相加。必要字段缺失、非法或桶间矛盾时，不完整状态不会升级成完整计量。
