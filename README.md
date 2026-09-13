# BilibiliCommentTree

按回复关系整理 bilibili 评论区楼中楼的 Tampermonkey 脚本：**树状排序、引导线与折叠**。

抽取自 [BewlyCat](https://github.com/keleus/BewlyCat) 扩展的原生评论区树状改造功能（`src/inject/index.ts` 评论树部分），以独立 userscript 形态运行，不依赖任何扩展框架。

## 功能

- **树状排列**：楼中楼按回复关系重排（父回复紧邻子回复），子回复按时间升序；主评论顺序跟随 B 站（默认热度）
- **SVG 引导线**：父头像到子头像的树状连线，随布局自动重算（图片加载、展开收起、窗口缩放）
- **折叠**：任意父级分支折叠/展开；平级评论之间可「收起后续同级」
- **三种展示模式**：线条-收起主评论 / 线条-不收起主评论 / 缩进-无收起功能
- **楼中楼加载方式**：「更多」（保持阅读位置向下累计）或「分页」（B 站原生分页），支持「展开全部回复」
- **离页父评标注**：父回复不在当前分页时显示「回复 @xxx · 不在本页」或引用原正文
- **深链定位**：`#reply{rpid}` 链接跳转后引导线自动重新结算
- **明暗主题**：颜色全部回退到 B 站原生 CSS 变量（`--bg1`/`--text2`/`--line_regular` 等），跟随页面明暗自动适配

## 安装

1. 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/)
2. 打开 Tampermonkey 管理面板 → 「实用工具」→「导入文件」，或直接将 `dist/bilibili-comment-tree.user.js` 拖入浏览器
3. 访问任意带评论区的 bilibili 页面（视频页、专栏、动态等）即可生效

## 使用

所有设置通过 Tampermonkey 扩展菜单操作（点击 Tampermonkey 图标）：

| 菜单项 | 说明 |
| --- | --- |
| 树状显示：开/关 | 功能总开关 |
| 树状样式：…（点击切换） | 三种展示模式循环切换 |
| 回复加载：更多/分页（点击切换） | 楼中楼加载方式 |

设置通过 `GM_setValue` 持久化，多标签页自动同步。

## 开发

```bash
pnpm install
pnpm dev        # 开发模式（vite-plugin-monkey 热重载，需在 Tampermonkey 中安装 dev 版脚本并允许访问文件网址）
pnpm build      # 构建产物 dist/bilibili-comment-tree.user.js
pnpm lint       # ESLint
pnpm typecheck  # tsc --noEmit
```

## 与原 BewlyCat 扩展的差异

- 不移植 Bewly 主题配色层：样式直接回退 B 站原生变量，视觉与 B 站原生一致
- 折叠状态为会话内存级（`WeakMap`），刷新页面后重置（与原扩展行为一致）
- 不包含 IP 属地/性别图标/楼主标识等评论外观微调
- 排序行为保持原样（树状排列本身即排序），未新增排序选项
- 代码内部 DOM 标记（类名 `bewly-*`、属性 `data-bewly-*`、CSS 变量回退 `--bew-*`）沿用上游命名，均为纯内部标识符

## 风险说明

本脚本深度依赖 B 站评论 Lit Web Components 的内部结构（`bili-comment-thread-renderer`、`#expander-contents`、`getList`/`handleChangePage` 等生命周期与属性）。B 站前端改版可能导致功能失效，届时需跟随上游 BewlyCat 的适配更新。
