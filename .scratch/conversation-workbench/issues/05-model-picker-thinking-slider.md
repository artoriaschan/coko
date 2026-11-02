# 05: 模型详情、供应商列表与推理档位拉条

**What to build:** 模型按钮显示当前模型名称、档位摘要与下拉箭头，hover 为浅灰背景。第一次点击打开当前模型详情：上方为当前推理档位，模型区域有模型图标、名称与进入列表的指示，底部为推理档位拉条；没有闪电与重置按钮。点击档位与名称的组合区域，详情关闭、打开按供应商分组的模型列表：行有模型图标、名称与当前项勾选，没有倍率、价格等列；选择后关闭列表并回到该模型的详情，两种菜单互斥替换。拉条只提供当前模型实际配置的档位，拖动跟手、松开吸附，被填充覆盖的节点隐藏；填充轨道有从右向左流动的粒子，数量与流速按 MODEL-09 的表逐档提高；菜单关闭、不可见、档位关闭或开启减少动态效果时粒子停止，不影响选择。没有可用模型时按钮显示“选择模型”、发送位置换成“配置模型”，点击打开设置的模型服务分区；会话的模型因供应商删除或移出目录被清空时，下次运行前提示重新选择；切到不支持当前档位的模型时档位回到“关闭”；认不出的品牌显示通用的模型图标。

- 行为依据：[规格](../spec.md) MODEL-01 至 MODEL-11、10.2 的流程图；[推理档位动效预览](../../../docs/ui/thinking-slider-preview.html)。新对话的默认模型（MODEL-12）由 11 负责。

**User stories:** 48、49、50

**Blocked by:** 无（可立即开始）

**Status:** ready-for-agent

**Write scope:** renderer 的 model-picker；packages/ui 的推理档位拉条部件；i18n；workbench.md 的模型选择一节（文件不存在时按 coko-docs 新建）。

**跨票接口：** 模型选择组件的对外 props 不变，03 把它原样放入工具栏；会话与草稿的模型选择沿用 chat-store 现有的选择入口（11 保持其签名）。

- [ ] Browser Mode：先出现详情，内容完整、没有两角按钮；点击名称区打开分组列表，选择后回到详情，任何时候只有一个模型浮层；拉条只停在有效档位，松开吸附、详情保持展开、按钮摘要同步、覆盖的节点隐藏；七档的粒子数量与单轮时长与 MODEL-09 的表一致，方向从右向左；关闭菜单、切到关闭或开启减少动态效果时粒子停止而选择正常；没有模型、模型被清空、切到不支持当前档位的模型三种情形（CW-29 至 CW-33）。
- [ ] Electron E2E：在已有对话中切到另一个供应商的模型并选一个档位，Sidecar 读回的模型与档位一致。
- [ ] 文档按 Write scope 更新；`check:docs` 通过。


## Comments

2026-11-03（05 实施）：

- 按规格第 18 节已批准的 renderer Browser Mode 与真实 Electron 接口做 TDD。首个 red：旧实现打开混合模型/档位菜单，找不到 `Thinking level` 滑条；随后详情 → 供应商列表 → 所选模型详情场景转 green。后续检查实际渲染的档位、滑块、粒子动画、焦点与协议读回。
- 画布读取 `c51g4`、`nfVk9`、`K9XY5G` 与 `Y9gy6`：详情 280×112、滑条 256×28、滑块 28。Browser Mode 在浅色/深色、390px 窗口边缘量测与截图确认这些几何；截图位于 git 忽略的 `.vitest/cw05-light.png`、`.vitest/cw05-dark.png`，均已目视核对，无裁剪、溢出或布局断裂。
- 滑条只渲染有效档位；拖动时详情和主按钮都显示预览，释放吸附后提交一次。通过 CDP 的真实指针按下/移动/释放验证跟手和吸附。粒子用 Web Animations 从右向左运行；播放速率更新保留已有相位。逐档验证数量与实际有效时长（0/3/6/10/15/21/28；停止/4000/3000/2200/1600/1100/750ms）、覆盖刻度隐藏；减少动态效果、页面隐藏、关闭与 off 时停止，不影响键盘选择。
- `ModelPickerProps` 保持不变；会话回调返回原有 `selectModel` 的 Promise，使拖动预览在保存完成后恢复权威值。空目录仍显示“选择模型”，配置模型按钮及模型被清空后的重选提示沿用并验证既有真实应用入口。供应商与模型 ID 是用户自定义值，当前没有品牌字段，模型图标使用图标库的通用 Bot，避免据用户命名猜品牌。
- 旧用例调整：`app.browser.test.tsx` 中两个模型场景改为先详情、再列表、选择后回详情，档位菜单断言换成真实滑条；fixture 原本把会话的 `faux` Provider 与目录的 `p1` 混用，现先通过公开选择操作设置有效目录模型，避免把不可用模型当作有效显示。`delete-provider.browser.test.tsx` 与 `provider-delete.e2e.test.ts` 在重选后显式关闭保持打开的详情，以完成原有后续操作及清理。设置中的 API 档位参数值保持协议原文。
- 文档影响：模型流程与状态 → `docs/subsystems/workbench.md` 增加模型/档位及验证入口；总入口 → `docs/README.md` 同步摘要。搜索隐藏目录中的 `workbench.md`、模型选择与旧菜单描述；历史任务保留当时事实，当前正文没有重复维护模型菜单的其他入口。AGENTS → docs/README → workbench 正文读回：路径、语义、归属与权威、引用方向、生命周期、当前入口、新会话读入、历史保留均通过。
- 集成同步前验证：`rtk pnpm run test apps/desktop/src/renderer/features/conversation/model-picker.browser.test.tsx apps/desktop/src/renderer/app/app.browser.test.tsx apps/desktop/src/renderer/features/settings/delete-provider.browser.test.tsx packages/ui/src/guards/style-guard.test.ts`：4 文件、76 项通过；之后关闭时清空预览的局部修正重跑模型文件 6 项通过。`rtk pnpm run test apps/desktop/e2e/model-picker.e2e.test.ts apps/desktop/e2e/provider-delete.e2e.test.ts`：2 文件、2 项通过（本次 Forge 测试构建、真实 Electron/Sidecar；更换供应商/档位后重新读回持久化会话）。`rtk pnpm run typecheck`、`rtk pnpm run lint`、`rtk pnpm run check:docs`（245 Markdown、0 问题）、`rtk git diff --check` 通过；Impeccable detector 结果 `[]`。真实外部模型与 CI 未运行；本票不改变模型适配协议。
- 尚需合入最新集成分支并核对相关检查，完成记录随后追加。
