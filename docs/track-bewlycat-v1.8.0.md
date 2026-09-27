# BewlyCat 上游同步追踪：v1.7.10 → v1.8.0

> 本文档记录 2026-09-27 这次上游合并的范围、处理措施与行为差异，供未来追踪上游行为差异时查阅。

## 概要

| 项 | 值 |
| --- | --- |
| 上游仓库 | keleus/BewlyCat（本项目抽取自其 `src/inject/index.ts` 评论区树状改造部分） |
| 抽取基线（旧基线） | `4c1e1241e025eee39ec0cf4f6b6c5132ad21a6a7`（v1.7.10，2026-09-15） |
| **本次合并基于的上游最终 commit** | **`9d0b0c6683fc88ac8f19f15d1780cdb6eaecfdfa`**（v1.8.0，2026-09-26，本地 main 与 origin/main 同步） |
| 区间提交总数 | 87 个，其中评论树领域相关 9 个 |
| 同步执行日期 | 2026-09-27 |
| 本地落地提交 | `c0832be`（分页增强）/ `bfb4faa`（回复容器）/ `a5a612a`（错位修复）/ `14dbffc`、`d1f7a0c`（文档） |

上游 9 个相关提交按功能归并为 3 个本地提交（按最终态移植，不逐提交 cherry-pick）：

## 一、合并的功能内容

### 1. 楼中楼分页增强（`8cc71f55` + `3abf64b7` + `e838e1b6` → 本地 `c0832be`）

- 独立分页头 `#bewly-comment-reply-page-head`：`<select>` 页码直接跳页 + 「，共 x 页」汇总，CSS `:has(+ ...)` 隐藏原生 `#pagination-head`，不再改写 Lit 管理的文本节点
- 跨页元缓存：按楼层身份（oid|type|root）LRU 64 层，保留已见回复的 parent/root/正文摘要/头像，对抗 B 站切页时销毁重建 replies renderer
- 完整单页缓存 + 后台预取：`CommentReplyPageCache`（新增上游文件 `src/utils/commentReplyPageCache.ts`）直连 `api.bilibili.com/x/v2/reply/reply` 顺序预取（15s 超时可中断），完成后自动补齐离页父评占位
- 直接选页：`pageJump` 状态使选页后只显示目标页、后续「加载更多」从该页继续追加；失败回滚 `restoreFailedPageJump`；同页码改走 `getList()` 重新拉取
- 「加载全部」分批：每批最多 5 页（`COMMENT_REPLY_BATCH_PAGE_LIMIT`），从最早缺失页补齐，每批完成后合并已加载页；按钮文案在「加载全部」/「加载 5 页」间切换
- 切页滚动位置保持：滚动容器快照（遍历 shadow root 祖先链 + `#expander-contents` 置尾）+ 锚点 60 帧持续校正，用户滚动即中止
- `getCommentReplyTotalPage` 增加 `count/pageSize` 估算兜底；`isCommentReplyPaginationComplete` 改为校验缓存页集合完整性
- 离页父评占位升级：真头像 + 缓存正文（`data-cached` 样式），不再显示「加载中」过渡态
- loading 转圈改主题色（`color-mix`）；「加载全部」按钮在分页列表中右对齐（CSS `order` 排列，不移动 Lit DOM 节点）

### 2. 固定高度回复容器（`d0fc055d` + `ea53c01e` + `6ac9a12a` + `7735af1b` + `ddf8643b` → 本地 `bfb4faa`）

五个上游提交中途方案有互相推翻，按**最终态**移植：

- 新设置 `enableCommentReplyTreeContainer`（上游 `7735af1b` 起默认 **false**，opt-in）+ `commentReplyTreeContainerHeight`（240–960px，默认 480）
- 宿主属性 `data-bewly-comment-reply-container` + 变量 `--bew-comment-reply-container-height` 驱动 CSS
- `#expander-contents` 变为固定高度滚动容器；原生「收起回复」sticky 钉底；**不使用** `overscroll-behavior: contain`（Chrome 对未溢出容器同样生效会吞滚轮，`ddf8643b`）
- 引导线图层挂入滚动容器，坐标换算到滚动内容坐标系（`top = replyRect.top - scrollTop`、`height = replyRect.height`），滚动时无需逐帧重算整树；图层 `maximumY` 不以容器高度为下限，消除折叠后的幽灵滚动留白（`6ac9a12a`）
- 容器模式**不绘制主评论根分支线**（`ea53c01e` 推翻 `d0fc055d` 的根锚点钳位方案）；应用可见性前复位根分支折叠键与根级「收起后续」键，避免楼层永久隐藏

### 3. 引导线折叠按钮错位修复（`13cd313d` → 本地 `a5a612a`）

- 整体删除「收起按钮位置缓存」机制：`CommentReplyTreeState.branchToggleOffsetByKey` / `tailToggleOffsetByKey` 及全部读写清空逻辑
- `getCommentReplyBranchPath` / `getCommentReplyBranchToggleY` 删除 `cachedToggleY` 参数，折叠改变布局后按钮与线条一律按当前父评论/可见兄弟锚点实时定位

## 二、处理措施（上游实现 → 本项目落地）

### 文件映射

| 上游 | 本项目 | 说明 |
| --- | --- | --- |
| `src/inject/index.ts`（评论树内联部分） | `src/core/{tree,pagination,offpage,prefix,replyText,constants}.ts` + `src/main.ts` + `src/patch.ts` | 按功能拆分，区间内上游未拆分此文件 |
| `src/utils/commentReplyTree.ts` | `src/shared/treeGeometry.ts` | 机械 diff 与上游 HEAD 逐字一致 |
| `src/utils/commentReplyPageCache.ts`（区间新增） | `src/core/pageCache.ts` | 类体逐字一致 + LRU 池 / `rememberCommentReplyPages` |
| `src/styles/commentReplyTree.scss` | `src/styles/commentReplyTree.scss` | 区间内上游零改动 |
| `src/logic/storage.ts`（设置） | `src/settings.ts`（GM 存储 + GM 菜单） | |
| `src/_locales/*.yml`（i18n） | 文案常量硬编码中文（`constants.ts` / 模板串） | AGENTS.md 约定 |

新增容器逻辑落位为 `src/core/container.ts`（`applyCommentReplyContainer`）；`isCommentReplyContainerEnabled` / `getCommentReplyContainerHeight` 归入 `settings.ts`。

### 适配措施

1. **i18n → 硬编码中文**，映射（取自上游 `cmn-CN.yml` 现行值）：`page_number`→`第{current}页`、`page_total`→`，共 {total} 页`、`all_pages`→`全部`、`select_reply_page`→`选择回复页码`、`load_reply_pages`→`加载 {count} 页`、`expand_all_replies`→`加载全部`
2. 页码 select 的 `optionsKey` 去掉语言维度（本项目文案恒定中文）
3. 容器 sticky 底栏背景：上游回退链含 Bewly 专有变量 `--bewly-widescreen-sidebar-bg`，本项目按 AGENTS.md 改为 `var(--bg1, var(--bew-bg, #fff))`
4. 设置并入 GM 存储体系，跨标签页 value change 监听纳入两个新字段比较；normalize 对缺失字段给默认值（旧存储向后兼容）
5. **GM 菜单仅暴露「回复容器：开/关」**，高度无菜单项（见行为差异第 1 条）
6. 日志前缀 `[BewlyCat]` → `[BilibiliCommentTree]`
7. 模块拆分新增依赖边 `tree → pageCache`、`pagination → pageCache`（无回边），既有 `tree ↔ pagination` 环不变；所有跨模块引用均为运行时调用，无模块求值期调用

新增内部 DOM/CSS 标记（沿用 `bewly-*` 命名）：`#bewly-comment-reply-page-select`、`#bewly-comment-reply-page-head`、`data-bewly-comment-reply-container`、`--bew-comment-reply-container-height`、`data-cached`（missing-parent 占位）。

## 三、与上游的行为差异

1. **有意差异（决策引入，仅 1 项）**：容器高度在上游设置页可调（240–960px），本项目 GM 菜单只有「回复容器：开/关」，高度固定默认 480px。`commentReplyTreeContainerHeight` 字段与 clamp 逻辑已保留，未来加 UI 只需改 `settings.ts`。
2. **其余行为一致**：9 个上游提交的全部 diff hunk 逐一比对一致；机械文件 diff 证明 `shared/treeGeometry.ts` 与上游 HEAD 逐字一致、`pageCache.ts` 类体逐字一致。静态检查（lint / typecheck / build）全过，且每个功能提交独立可构建。
3. **继承自上游的已知行为**（上游 HEAD 亦如此，非本项目引入）：
   - `paginationItems` 的 `hasNext` 用原生 `totalPage`（无 `count/pageSize` 兜底），与批次标签用的兜底版 `getCommentReplyTotalPage` 来源不同
   - 「树状显示：关」+「回复加载：分页」时页码下拉仍显示（`updateCommentReplyPaginationHead` 不检查树开关），而后台预取会检查
   - 树收起状态下分页头不写入「共」字样（本项目 v1.0.0 旧行为是写入，随本次同步对齐上游）
4. **未混入的无关变更**：区间内约 76 个无关提交（播放器/宽屏/顶栏/历史/收藏/稍后再看/toast/原版动态过滤等）；`f6577818`（本地音量均衡）、`09031c1e`（弹幕三档开关）仅与 inject 共文件；`a9fbce5f` 改在 `src/contentScripts/index.ts` 不属于注入脚本；区间内无 IP 属地等外观微调（`src/utils/commentUserInfo.ts` 零改动，本项目本就明确不移植）；`13cd313d` 涉及的 `MomentCommentTree.vue` 为 Bewly 内部动态评论树，本项目不适用。

## 四、验证情况

- `pnpm lint` / `pnpm typecheck` / `pnpm build` 全过；三个功能提交各自独立验证可构建
- review 方式：全量 1605 行 diff 逐 hunk 对照上游合并 diff + 机械文件 diff（见三.2）
- **静态检查盲区，待人工实测**：跳页滚动位置保持、容器内滚动时引导线随动、后台预取补齐离页父评占位三条运行时链路

## 五、未来追踪指引

- **下次同步的基线即本次终点**：`9d0b0c6683fc88ac8f19f15d1780cdb6eaecfdfa`（v1.8.0）。建议后续文档命名为 `docs/track-bewlycat-v<上游版本>.md`
- 快速判别上游是否触及本项目领域：
  `git log 9d0b0c66..HEAD -- src/inject src/utils/commentReplyTree.ts src/utils/commentReplyPageCache.ts src/styles/commentReplyTree.scss`
- 上游关注文件：`src/inject/index.ts`（评论树仍内联其中）、`src/utils/commentReplyTree.ts`、`src/utils/commentReplyPageCache.ts`、`src/styles/commentReplyTree.scss`、`src/logic/storage.ts`（设置项）
- 若上游拆分/迁移 `inject/index.ts`，需重建文件映射后再移植；同步策略维持「按最终态、按功能归并」，容器类多提交互相推翻的特性切勿按提交顺序逐个套用
