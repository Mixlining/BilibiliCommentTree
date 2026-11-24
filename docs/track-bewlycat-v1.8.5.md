# BewlyCat 上游同步追踪：v1.8.2 → v1.8.5

> 本文档记录 2026-11-24 对上游 v1.8.5 的增量核对与评论显示修复移植。本次只引入原生评论区显示相关的两个修复，不引入 AI 评论过滤、Bewly 主题层和其他功能。

## 概要

| 项 | 值 |
| --- | --- |
| 上游仓库 | keleus/BewlyCat |
| 上次同步终点 | `697dd869b2c273a5bb63519a6bc1c52deffd1070`（v1.8.2） |
| **本次核对终点 / 下次同步基线** | **`63682e51f2b42baf7883b0112a5c01ad63962f8f`**（`v1.8.5-2-g63682e51`） |
| 本地上游状态 | BewlyCat 的 HEAD 即上述提交；本次未联网 fetch |
| 区间提交总数 | 319 个，335 个变更文件 |
| 区间评论显示相关提交 | 2 个必须移植，若干明确排除 |
| 本项目状态 | v0.2.5；同步代码与升版分提交处理 |

## 一、历史覆盖范围

历史同步采用按最终态、按功能归并的方式；移植对象为 B 站原生评论区的树状排列、引导线、折叠及配套加载行为。详细实现与文件映射见 [v1.8.0 追踪](track-bewlycat-v1.8.0.md)、[v1.8.1 追踪](track-bewlycat-v1.8.1.md) 和 [v1.8.2 追踪](track-bewlycat-v1.8.2.md)。

本次不再重复已落地的树算法、跨页缓存、分页加载、离页父评占位和深链定位。

## 二、本次增量与处理

### 已移植

| 上游提交 | 内容 | 本地落地 |
| --- | --- | --- |
| `078c5bf7` | 回复容器吸底栏不再被 B 站 fixed 评论框盖住（#1416） | `src/core/constants.ts` 在容器启用规则内增加 `isolation: isolate` |
| `fac75273` | 吸底栏仅在容器溢出且未滚到底部时铺底，避免未展开的「共 x 条回复」出现实色横条（#1444/#1445） | 新增 `data-bewly-comment-reply-footer-stuck` 属性与滚动监听；`src/core/constants.ts`、`src/core/container.ts`、`src/core/tree.ts` |

`fac75273` 只移植了显示行为部分。上游同一提交中的评论框、工具按钮、固定底栏毛玻璃钩子属于 Bewly 主题层，未引入；吸底栏背景只使用 B 站原生 `var(--bg1, #fff)`，不保留 `--bew-comment-sticky-footer-bg`、`--bewly-widescreen-sidebar-bg` 或 backdrop-filter 钩子。

### 明确排除

| 上游提交 / 范围 | 内容 | 排除原因 |
| --- | --- | --- |
| `925cecdf` | AI 评论过滤全链路（MAIN world 控制器、content bridge、扩展后台、7 个设置键、Vue 设置页、B 站 index-translate 请求） | 需要扩展后台、`declarativeNetRequest` 改 Origin/Referer 和异步网络传输；本项目只使用同步 GM API，且本轮不引入 AI |
| `ea0c9a3b` / `53fc0748` / `603425c0` / `338135f1` | 原生 `<select>` 替换为 902 行自定义下拉 | 属于交互/视觉改造，不是显示正确性修复；保留原生 `<select>` 更符合原生 UI 约束 |
| `4b73f695` | 树节点填充色增加 `--bew-comment-tree-node-bg` | 本地无人设置该变量，回退链与原行为完全一致，纯 no-op |
| `5efc82c2` / `07d4223d` | 回复容器高度改为可输入数值的 Vue 滑块 | 仅设置页 UI 改动，运行时和存储键无变化；本地 GM 菜单不暴露高度 |
| `00ab7e4c` | 评论图片查看器关闭按钮置底 | 独立的默认关闭功能，不属于评论树显示 |
| `270c014c` / `48051905` / `d1117460` / `8fd212f0` / `e312f591` / `1a963366` | 视频页毛玻璃、评论框/复选框/投票卡/固定底栏钩子、宽屏用户卡 | Bewly 主题/宽屏层，本项目不引入 |
| `384e5a51` | 评论深链进入视频页时避免播放器滚动 | 修的是 Bewly 播放器滚动逻辑，本地没有对应实现 |
| `582d481a` / `44870b0a` | 宽屏模式评论重载与返回顶部 | 宽屏专属 |
| 动态页评论相关提交 | `MomentComments.vue`、原版动态折叠等 | Bewly Vue 动态页 UI，不在原生视频评论区范围 |
| `9dc9b22d` / `bd0cfcfb` / `0966cde2` / `646f35f4` / `63682e51` | page-script 握手、inject i18n、样式分包、版本号、开发构建 | 扩展基础设施或本项目不适用的构建链路 |

## 三、上游回归警告

`925cecdf` 在移植 AI 过滤时顺带修改了树引导线的可见节点计算：

- 根级和节点级「收起后续」控件改为只接收 `visibleRootNodes` / `visibleChildren`；
- 增加 `visibleChildren.length === 0 && !nodeBranchCollapsed` 时提前返回。

在原版（无 AI）场景下，点击「收起后续」后，被收起的同级评论带有 `data-bewly-comment-reply-hidden`，`visibleChildren` 可能只剩 1 个；`buildCommentReplyTreeTailCollapses` 对少于 2 个同级直接返回空数组，导致收起后的 `+` 恢复控件消失，用户无法从树 UI 展开被收起的回复。**后续同步不得照搬这段可见性过滤**；如果将来移植 AI 过滤，应保留完整同级列表计算收起控件，仅把 AI 隐藏用于绘制/可见性判断，或显式保留已收起 tail 的控件。

本项目的 `isCommentReplyTreeNodeVisible`、`renderCommentReplyTreeGuides` 维持 v1.8.2 行为，未应用该回归。

## 四、验证与限制

- 已运行 `pnpm lint`、`pnpm typecheck`、`pnpm build`，均通过；产物为 `dist/bilibili-comment-tree.user.js`。
- 本次未进行真实浏览器运行验证。`isolation: isolate` 的层叠效果和吸底栏遮挡态依赖 B 站页面实际布局与滚动，仍需在视频页评论区手动确认：
  - 展开回复容器后，吸底「收起回复」栏不被页面底部评论框盖住；
  - 容器未溢出时，吸底栏没有整条实色背景；
  - 容器溢出且未滚到底时，吸底栏有底衬；滚到底后底衬消失；
  - 关闭/重新展开回复、切换分页或切换树状开关后，没有残留的 `data-bewly-comment-reply-footer-stuck` 属性或重复滚动监听。
- 静态检查与构建通过不代表上述运行时行为已验证。

## 五、后续追踪

下次从 `63682e51f2b42baf7883b0112a5c01ad63962f8f` 开始比较。先查看完整增量文件列表，再筛选评论相关提交，以便发现上游模块拆分或迁移：

```bash
git diff --name-status 63682e51..HEAD
git log --oneline 63682e51..HEAD -- src/inject src/utils/commentReplyTree.ts src/utils/commentReplyPageCache.ts src/utils/commentUserInfo.ts src/utils/commentAiFilter.ts src/utils/commentAiFilterClient.ts src/utils/nativeSelectDropdown.ts src/styles/commentReplyTree.scss src/styles/adaptedStyles/common/comments.scss src/logic/storage.ts src/components/Settings/BilibiliFeaturesEnhancement/Comments src/background/commentAiFilter.ts src/contentScripts/features/commentAiFilterBridge.ts
```
