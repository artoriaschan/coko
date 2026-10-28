# AGENTS.md

## 开发流程与文档入口

- 新会话处理项目任务时，先从 [文档导航](docs/README.md) 定位相关正文并核对其状态和适用范围；旧链接、搜索结果及会话摘要按 [文档生命周期](docs/DOCUMENT_LIFECYCLE.md) 追溯到有效资料。
- 规划、架构设计、实施和交付的阶段衔接见 [开发与文档流程](docs/DEVELOPMENT_WORKFLOW.md)；使用新版 Matt skills，并区分用户调用入口与可自动使用的专项能力。
- 生成、提炼、保存或维护文档时，先查 [文档体系](docs/DOCUMENTATION_SYSTEM.md) 的类型与归属；优先更新已有正文，用 [模板](docs/templates/README.md) 创建必要的新文档，区分目标设计、已确认决策、当前行为和执行证据。
- 拆分或新增文档目录前，按 [归属边界](docs/DOCUMENTATION_SYSTEM.md#需求已选型与实现的边界) 登记职责和路径；项目已选技术、功能需求/设计、当前实现说明分别维护，迁移不得改变确认状态或实施状态。
- `.scratch/` 外的文档不得链接或依赖其中的具体材料；长期结论先提炼到所属正式正文，再由任务材料引用。配置中的路径模式与查找操作按 [引用边界](docs/DOCUMENTATION_SYSTEM.md#正式文档与任务材料的引用方向) 执行。
- 更新、移动、弃用或归档文档时，按 [生命周期流程](docs/DOCUMENT_LIFECYCLE.md) 在同一交付批次同步受影响的引用、摘要和导航；从入口读回核验后才报告完成。

## Agent skills

### Issue tracker

本项目使用本地 Markdown tracker；生成、读取、分拣或推进地图、规格和任务前，读取 [tracker 配置](docs/agents/issue-tracker.md)。

### Triage labels

使用五个默认分拣角色；分拣需求或缺陷前，读取 [标签映射](docs/agents/triage-labels.md)，区分分拣状态与决策票状态。

### Domain docs

采用 single-context：根 GLOSSARY.md 与 docs/adr/；探索领域、编写规格或修改代码前，按 [领域文档配置](docs/agents/domain.md) 读取已存在的相关术语和决定。

## UI 与设计系统

新增或修改界面前，先阅读 [界面约定](docs/tech-stack/ui.md)：技术接入、设计系统、交互与布局、UI 状态与验收，并检查目标页面、相邻页面及 `packages/ui` 中已有的组件和样式。

## 测试

新增功能、修复缺陷或改变已有行为，以及编写或修改测试、fixture、子进程和测试配置前，先阅读 [测试约定](docs/tech-stack/testing.md)；报告验证结果前按其 [执行与报告规则](docs/tech-stack/testing.md#测试执行与结果报告) 确认范围和措辞。
