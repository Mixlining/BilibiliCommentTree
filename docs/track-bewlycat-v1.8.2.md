# BewlyCat 上游同步追踪：v1.8.1 → v1.8.2

> 本文档记录 2026-10-22 对上游 v1.8.2 的增量核对。本次评论区移植范围内无新增改动，仅更新追踪记录。

## 概要

| 项 | 值 |
| --- | --- |
| 上游仓库 | keleus/BewlyCat |
| 上次同步终点 | `056e775b7ae112ea983b474b4f1c31dbb48cd1d9`（已超过 v1.8.1 正式 tag） |
| **本次核对终点 / 下次同步基线** | **`697dd869b2c273a5bb63519a6bc1c52deffd1070`**（v1.8.2） |
| 本地上游状态 | BewlyCat 的 HEAD、origin/main 与 v1.8.2 tag 指向同一提交；本次未联网 fetch |
| 区间提交总数 | 3 个（含 1 个合并提交），评论区移植范围内相关提交 0 个 |
| 区间实际变更文件 | `package.json`、`src/styles/adaptedStyles/pages/momentsPage.scss` |
| 本项目状态 | v0.2.2；本次无需改动运行时代码或升级版本 |

## 一、历史覆盖范围

历史同步采用按最终态、按功能归并的方式；移植对象为 B 站原生评论区的树状排列、引导线、折叠及配套加载行为。

| 阶段 | 已移植内容 | 本地落地提交 |
| --- | --- | --- |
| 初始抽取（上游 v1.7.10 基线） | 原生评论树、三种展示模式、引导线与折叠、回复加载、离页父评占位、深链定位等基础能力 | 详见既有源码及 v1.8.0 追踪文档 |
| v1.8.0 同步 | 页码选择、跨页缓存与后台预取、每批 5 页加载、切页位置保持；固定高度回复容器；折叠按钮错位修复 | `c0832be` / `bfb4faa` / `a5a612a` |
| v1.8.1 及其后续提交同步 | 连同 Lit repeat 边界重排 DOM，修复跨楼层选中复制遗漏子回复；加载全部按钮位置调整；评论增强补丁异常隔离 | `7d23c93` / `2272cd5` / `ea22d67` |
| v1.8.2 核对（本次） | 移植范围内无新增变更 | 仅新增本文档 |

详细实现、文件映射与历史验证见 [v1.8.0 追踪](track-bewlycat-v1.8.0.md) 和 [v1.8.1 追踪](track-bewlycat-v1.8.1.md)。上次文档标题虽为 v1.8.1，但终点已经包含 `29d2b57f` 的跨楼层复制修复，不能以 v1.8.1 正式 tag 重新计算待移植范围。

## 二、本次增量与处理

| 上游提交 | 内容 | 处理 |
| --- | --- | --- |
| `532e0a6c` | 移除原站动态页深色纹理遮罩，纠正正文层级（#1333） | 未移植：修改 Bewly 动态页 `.momentsPage` 样式，属于页面级主题与布局适配 |
| `75d61f74` | 合并上述改动的 PR #1334 | 同上，无独立评论树变更 |
| `697dd869` | 上游版本号更新到 1.8.2 | 不同步上游扩展版本号；本项目维持独立版本 |

本次对全部增量文件进行了核对，且以下评论相关路径在上次终点与本次终点之间 diff 为空：

- `src/inject/`
- `src/utils/commentReplyTree.ts`
- `src/utils/commentReplyPageCache.ts`
- `src/utils/commentUserInfo.ts`
- `src/styles/commentReplyTree.scss`
- `src/styles/adaptedStyles/shadowDom/comments.scss`
- `src/styles/adaptedStyles/common/comments.scss`
- `src/logic/storage.ts`
- `src/components/Settings/BilibiliFeaturesEnhancement/Comments/`

沿用历史范围：不引入 Bewly 自有动态评论 Vue UI、IP 属地/性别/楼主标识等外观微调或 Bewly 主题层。回复容器高度仍保留设置字段与范围限制，GM 菜单仅暴露开关，默认 480px；此前明确保留的行为差异没有变化。

## 三、验证与限制

- 核对上游提交列表、完整增量文件列表和动态页样式 diff，确认不存在因只筛选评论文件而漏掉的新增模块。
- 评论相关路径执行 `git diff --quiet 056e775b HEAD -- <上述路径>`，退出码为 0。
- 对照本地提交历史与源码，确认上一轮 DOM 排序、加载全部按钮间距、组件补丁异常隔离仍已落地。
- 本次只新增 Markdown 追踪文档，不运行 lint、类型检查或构建；没有重新进行页面运行验证。历史文档中的待实测项目仍保留，不能将本次增量核对视为运行验证通过。

## 四、后续追踪

下次从 `697dd869b2c273a5bb63519a6bc1c52deffd1070` 开始比较。先查看完整增量文件列表，再筛选评论相关提交，以便发现上游模块拆分或迁移：

```bash
git diff --name-status 697dd869..HEAD
git log --oneline 697dd869..HEAD -- src/inject src/utils/commentReplyTree.ts src/utils/commentReplyPageCache.ts src/utils/commentUserInfo.ts src/styles/commentReplyTree.scss src/styles/adaptedStyles/shadowDom/comments.scss src/styles/adaptedStyles/common/comments.scss src/logic/storage.ts src/components/Settings/BilibiliFeaturesEnhancement/Comments
```
