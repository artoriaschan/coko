# 设置与会话改存 SQLite 的存储边界

Type: grilling
Label: wayfinder:grilling
Status: open
Assignee: none
Blocked by: 01, 02
Map: [Coko 桌面应用](../map.md)

## Question

用户要求桌面端的设置与会话存储在 SQLite。现有约定是 Session 用 append-only JSONL、SQLite 仅作写者互斥。新的存储边界是什么：哪些数据进 SQLite（设置、会话、消息、执行记录、Goal/Task/授权、Memory），由哪个包持有（packages/session 的 SQLite 实现），事务与提交屏障、迁移、损坏恢复如何定义？是否以 ADR 替代原 JSONL 约定？
