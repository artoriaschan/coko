---
kind: reference
description: "需求与缺陷分拣的五个默认角色及本地字段映射。"
lifecycle: active
---

# Triage labels

使用已确认的默认分拣角色；每条经过 triage 的请求只使用一个当前分拣状态。

| Skill 角色 | 本地 Status 值 | 含义 |
| --- | --- | --- |
| needs-triage | needs-triage | 等待维护者评估 |
| needs-info | needs-info | 等待补充信息 |
| ready-for-agent | ready-for-agent | 规格充分，可交由 Agent 实施 |
| ready-for-human | ready-for-human | 需要人工处理 |
| wontfix | wontfix | 本次不予处理 |

`triage` 的 bug / enhancement 是类别，写在 `Category:`，与上述状态分开。当前 wayfinder 决策票的状态不使用本表；关闭操作与字段规则见 [tracker 配置](issue-tracker.md)。文档批准状态、实施状态和生命周期分别遵循文档体系，不从分拣角色推导。
