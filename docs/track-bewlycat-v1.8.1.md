# BewlyCat 上游同步追踪：v1.8.0 → v1.8.1

> 本文档记录 2026-10-21 这次上游合并的范围、处理措施与行为差异，供未来追踪上游行为差异时查阅。

## 概要

| 项 | 值 |
| --- | --- |
| 上游仓库 | keleus/BewlyCat（本项目抽取自其 `src/inject/index.ts` 评论区树状改造部分） |
| 抽取基线（旧基线） | `9d0b0c6683fc88ac8f19f15d1780cdb6eaecfdfa`（v1.8.0 后同步终点，2026-09-26） |
| **本次合并基于的上游最终 commit** | **`056e775b7ae112ea983b474b4f1c31dbb48cd1d9`**（本地 HEAD，2026-10-21） |
| 上游正式发布 tag | `v1.8.1` = `321c09a44d77d01fcee9b11a10111057f438bd2b`（2026-10-19）；本次额外覆盖 tag 之后 2 天的 `29d2b57f` |
| 区间提交总数 | 129 个，其中评论树领域相关 4 个 |
| 同步执行日期 | 2026-10-21 |
| 本地落地提交 | `7d23c93`（树序 DOM 重排）/ `2272cd5`（加载全部按钮）/ `ea22d67`（补丁异常隔离）/ `be34e82`（发布 v0.2.1）/ 本文档单独提交 |

上游 4 个相关提交按功能归并为 3 个本地提交（按最终态移植，不逐提交 cherry-pick）：

## 一、合并的功能内容

### 1. 树状回复按 DOM 顺序重排（`29d2b57f` → 本地 `7d23c93`）

上游 issue #1327：此前树序只通过 CSS `flex order` 表达，视觉顺序与 DOM 顺序不一致，跨多条回复拖选/复制时按 DOM 顺序取文本，会跳过子回复。

- `setCommentReplyRendererOrder` 增加可选 `replyContainer` 参数并返回是否实际移动节点；`--bew-comment-reply-order` 保留为兜底
- 新增 `isLitRepeatItemMarker` / `getCommentReplyRendererNodeGroup` / `moveCommentReplyRendererNodes`：
  - Lit keyed repeat 的每一项是 `<!----> host <!---->`，按「起始注释 + host + 结束注释」整段移动，避免拆散 repeat 边界导致下次更新重复插入同一条回复
  - 以 DOM 中最后一个 repeat 项之后为插入终点；缺失父评占位（`.bewly-comment-missing-parent`）不属于任何 part，仅作为单节点参与排序
  - 任一 renderer 找不到边界（或不在容器内）时整体放弃 DOM 移动，退回纯 flex order
- `updateCommentReplyTree` 重排后调用 `state.replyContainerMutationObserver?.takeRecords()`，丢弃自身移动产生的 childList 记录，避免多排一帧
- `clearCommentReplyTreeState` 在清除标记前，按 `originalOrderByRenderer` 还原 DOM 顺序（仅 `state.enabled` 时），保证原生「收起/重新展开」后与列表数据一致
- 关闭树状显示时的还原分支同样传入 `replyContainer`
- `constants.ts` 中 `#expander-contents` 的注释同步改为「树序优先连同 repeat 边界整段写入 DOM，flex order 兜底」

### 2. 「加载全部」按钮位置（`aec55079` → 本地 `2272cd5`）

- 分页项 `[data-idx="${COMMENT_REPLY_EXPAND_ALL_IDX}"]`：`margin-inline-start: auto` → `var(--bew-space-6, 24px)`
- 按钮 `#bewly-comment-expand-all-replies`：`margin-inline-start: auto` → `var(--bew-space-4, 16px)`
- 效果：「加载全部」紧跟「加载更多」右侧，不再被推到分页行尾

### 3. 评论增强补丁异常隔离（`e49e5bd5` 评论部分 → 本地 `ea22d67`）

上游 #1268 收窄注入钩子，其中与评论区相关的四处改动：

- `paginationItems` getter：增强段整体 try/catch，异常时 `console.warn` 并返回原生 `items`。该 getter 在 Lit 渲染中调用，抛错会中断渲染
- `handleRevert` 的 `cleanup`：try/catch 包裹 `suspendCommentReplyPaginationForNativeCollapse` + `clearCommentReplyTreeState`
- `bili-comment-replies-renderer` 的 `disconnectedCallback` 清理（`finally` 内）：同样加 try/catch
- `customElements.define` 劫持：抽出 `safePatchCommentCustomElement` 统一兜底；Proxy 安装本身包 try/catch；回补已注册组件时也走安全包装。补丁异常不再抛进 B 站组件注册流程

## 二、处理措施（上游实现 → 本项目落地）

### 文件映射

| 上游 | 本项目 | 说明 |
| --- | --- | --- |
| `src/inject/index.ts`（评论树内联部分） | `src/core/{tree,pagination,constants}.ts` + `src/patch.ts` | 按功能拆分 |
| `src/utils/commentReplyTree.ts` | `src/shared/treeGeometry.ts` | 区间内零改动 |
| `src/utils/commentReplyPageCache.ts` | `src/core/pageCache.ts` | 区间内零改动 |
| `src/styles/commentReplyTree.scss` | `src/styles/commentReplyTree.scss` | 区间内零改动 |
| `src/utils/commentUserInfo.ts` | 未移植（本项目明确不移植 IP/性别等外观微调） | 区间内零改动 |
| `src/logic/storage.ts`（设置） | `src/settings.ts` | 区间内无评论相关设置增删 |

### 适配措施

1. 日志前缀 `[BewlyCat]` → `[${SCRIPT_NAME}]`（`BilibiliCommentTree`）
2. `moveCommentReplyRendererNodes` 等新增函数置于 `src/core/tree.ts` 现有排序函数旁，与上游函数体逐字一致（仅缩进差异）
3. 无 i18n / 无新增设置项，`settings.ts` 未改动

## 三、与上游的行为差异

1. **未移植 `c9368d1e`（评论标签直接继承外层深色主题 #1263）**：上游为 `bili-comment-renderer` 增加 `#body .tag` 规则，并在 `shadowDom/comments.scss` 同步。本项目没有 Bewly 主题层、也未补丁 `bili-comment-renderer`，该规则实际为空操作，且属于外观微调（AGENTS.md 要求颜色依赖 B 站原生变量）。若未来需要标签配色，应作为独立需求评估。
2. **未移植同一区间内其他无关变更**：`MomentCard/*` 动态评论（Bewly 自有 Vue UI）、动态评论富文本编辑器、直播站脚本拦截、Firefox UA、搜索去个性化、一键三连监听、剪贴板净化、收藏夹整理、播放器/顶栏/宽屏等。
3. **上游 `e49e5bd5` 中与评论区无关的部分**（启动快照、弹幕实验、UA 改写、fetch/XHR 钩子安装时机）未移植；本项目只保留评论增强的异常隔离。
4. **其余行为一致**：三个功能提交与上游对应 hunk 逐行比对一致。

## 四、验证情况

- `pnpm lint` / `pnpm typecheck` 全过（每个提交前各执行一次）
- 静态 review：`setCommentReplyRendererOrder`、`isLitRepeatItemMarker`、`getCommentReplyRendererNodeGroup`、`moveCommentReplyRendererNodes` 与上游去缩进后 diff 为空；`clearCommentReplyTreeState` 还原逻辑位于断开 observer 之后、占位节点不进入 repeat 整段移动
- **本次未构建产物**：`dist/` 已被 `.gitignore` 忽略，发布由 `v*` tag 触发的 `.github/workflows/release.yml` 构建
- **静态检查盲区，待人工实测**：
  1. 跨楼层拖选/复制是否按视觉顺序包含子回复
  2. 原生「收起回复」后重新展开，回复顺序是否与列表数据一致（不残留树序）
  3. 分页切页 / 「加载全部」多批加载后是否仍无重复节点（repeat 边界未被拆散）
  4. 增强代码异常时（可临时注入抛错）分页是否回退原生渲染

## 五、未来追踪指引

- **下次同步的基线即本次终点**：`056e775b7ae112ea983b474b4f1c31dbb48cd1d9`
- 快速判别上游是否触及本项目领域：
  `git log 056e775b..HEAD -- src/inject src/utils/commentReplyTree.ts src/utils/commentReplyPageCache.ts src/styles/commentReplyTree.scss src/styles/adaptedStyles/shadowDom/comments.scss`
- 上游关注文件：`src/inject/index.ts`（评论树仍内联其中）、`src/utils/commentReplyTree.ts`、`src/utils/commentReplyPageCache.ts`、`src/styles/commentReplyTree.scss`、`src/logic/storage.ts`（设置项）
- 同步策略维持「按最终态、按功能归并」；涉及 Lit repeat / DOM 顺序的改动务必确认边界注释一并移动，切勿只移动 host
