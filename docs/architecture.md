# 模块边界与自有设置层

## 上游同步边界

本项目按功能拆分了 BewlyCat 的原生评论区注入代码。拆分后的文件不能仅因位于本项目的 `core/` 目录，就视为自有实现。

| 文件 | 来源与维护方式 |
| --- | --- |
| `src/core/*.ts` | 上游 `src/inject/index.ts` 的评论逻辑及 `commentReplyPageCache.ts`；保留算法、状态结构和内部标记，随上游同步 |
| `src/shared/treeGeometry.ts` | 上游 `src/utils/commentReplyTree.ts`；保持同步 |
| `src/styles/commentReplyTree.scss` | 上游评论树样式；保持同步 |
| `src/patch.ts` | 上游组件补丁的 userscript 适配，包含 `unsafeWindow` 等必要差异；保持现有结构，不作自主性能重写 |
| `src/settings.ts`、`src/settings/` | 本项目的同步 GM 存储、单一菜单入口、配置通知与页内设置面板的写入口；可独立改进，上游设置语义仍需保持 |
| `src/ui/`、`src/styles/localUi.scss` | 本项目自有的原生浮层、错误提示与交互增强；不参与上游同步 |
| `src/main.ts`、`src/types/`、`vite.config.ts` | 本项目的启动、最小 GM 声明和 userscript 构建适配 |

自有设置层、启动联动、类型声明、构建配置及 CI 可独立维护。`core/`、`shared/`、样式与 `patch.ts` 保留上游结构。为把上游差异控制在最小范围，本地 UI 只在上游派生文件中保留两类单点钩子：`constants.ts` 的本地样式追加与高度预览变量、`pagination.ts`/`tree.ts` 的错误提示调用；树布局、分页状态机和内部标记均未改动。历史同步详情见 `track-bewlycat-v*.md`。

## 设置层职责

- `settings/model.ts`：类型、默认值、值归一化、语义相等判断。原有高度转换与上下限逻辑保持不变，并继续引用上游常量，避免重复维护数值。
- `settings.ts`：公开读取接口、同步 GM 存储、跨标签页通知和订阅。`getScriptSettings` 提供当前冻结配置，`updateScriptSettings` 是唯一写入口，供 GM 菜单与页内面板共用；写入前重新读取存储，避免覆盖另一标签页刚写入、通知尚未到达的配置。
- `ui/settings-dialog.ts`：单一 GM 菜单入口打开的非模态 `<dialog popover="auto">`，右侧停靠；全部 5 项配置即时生效，支持恢复默认。高度滑块拖动时只改文档级预览变量，松手后才持久化，避免拖动期间反复重建整棵树。
- `main.ts`：注册唯一的“评论树设置…”菜单；将已应用的配置变化传给评论树；总开关持续关闭时不做无效刷新。

模块导入不读 GM 存储。`initScriptSettings()` 在组件补丁安装前同步读取设置；重复调用不会再注册菜单或存储监听。配置只在初始化和发布时替换，已发布的对象通过 `Object.freeze` 保护；订阅函数返回取消订阅方法。

本地写入路径先读取存储中的最新配置，再应用变更、持久化并发布。这样可以保留远端已写入但通知尚未到达的其他偏好；写入失败不发布未保存的状态。GM 同步 API 没有原子比较交换能力，因此不承诺解决多个标签页完全同时读写产生的覆盖。

远端监听采用 Tampermonkey 的四参数回调 `(key, oldValue, newValue, remote)`。远端配置只归一化和发布，不回写；等效配置不更新面板、不通知订阅方。本标签页写入产生的 `remote=false` 通知被忽略，由本地写入路径发布一次。

## 原生 UI 层

- 设置面板与错误提示都使用浏览器 top layer：面板为 `<dialog popover="auto">`，页面保持可操作，支持 Esc、外部点击和关闭按钮；错误提示为 `popover="manual"`，不受 B 站 z-index、transform 或 overflow 影响。
- `ui/overlay.scss` 由 `ui/overlay.ts` 注入一次；颜色全部回退到 B 站原生变量，明暗主题自动适配。进入/退出使用 `@starting-style`、`transition-behavior: allow-discrete` 与 `overlay` 过渡，并提供 `prefers-reduced-motion` 版本。
- `ui/status.ts` 只覆盖用户主动操作失败：翻页、展开全部、深链未定位。提示 4 秒后自动关闭，悬停或聚焦时暂停；播报优先使用 `ariaNotify()`，保留最小 live-region 回退。背景预取失败和补丁异常仍只写控制台。
- `ui/deep-link-status.ts` 在深链结算窗口结束时扫描多层 Lit shadow root，确认 `#reply` 目标评论是否存在；缺失时调用同一个 toast。扫描只在窗口结束时执行一次，不参与布局或滚动路径。
- 深链结算定时器触发时会从待执行数组移除，保证同一页面后续 `#reply` 链接仍会重新开启结算窗口；否则第二次深链会因数组残留而静默失效。
- **有意偏离**：`persistent-toast-notifications` 指南要求自动消失时信息还能从别处获得；本项目按产品决策不提供内联标记或重试入口，4 秒后只保留控制台日志。这是明确接受的例外，不应在后续迭代中当作遗漏。
- 高度实时预览通过 `constants.ts` 中 `max-height` 的文档级变量回退实现；未设置该变量时行为与上游完全一致。
- `styles/localUi.scss` 只补充树控件与分页控件的 hover/active/focus-visible/reduced-motion 状态，追加到 replies 的 shadow 样式末尾，不改变上游树布局或分页状态机。
- 平台基线为 Chrome 150+：使用 `dialog popover`、Popover、`@starting-style`、`transition-behavior: allow-discrete`、`overlay`、`ariaNotify`；不使用 151+ 的 `popover="hint"`、`position-visibility: anchor-visible`。原生 `<input type="checkbox" switch>` 在 Chrome 未支持，因此 on/off 控件使用带 `role="switch"` 的原生 checkbox 加本地样式。

## 性能收益与兼容要求

GM 菜单现在只有一个固定入口，不再需要在设置变化时更新菜单文案或 ID；菜单 API 调用从每次设置变化多次降为初始化时一次。页内面板的即时应用、恢复默认与跨标签页同步复用同一发布路径。

菜单仍采用同步 GM API 和最小本地类型声明，不引入异步初始化或更高版本专有选项。`GM_addValueChangeListener` 与 `GM_registerMenuCommand` 的契约参照 [Tampermonkey 值变更监听文档](https://www.tampermonkey.net/documentation.php?q=GM_values) 和 [菜单文档](https://www.tampermonkey.net/documentation.php?q=GM_registerMenuCommand)。BewlyCat 实现来源为本地仓库。

## 工具链与静态检查

pnpm 版本由项目 `package.json` 的 `packageManager` 固定在 11.x；TypeScript 使用 `~6.0.3`，只接受 6.0.x 补丁更新。依赖在现有主版本范围内升级，并遵守使用者环境的依赖源、最低发布时间和项目供应链策略；不改全局工具或配置。解析结果由 `pnpm-lock.yaml` 固定。

本项目不保留测试代码或测试运行脚本，不新增运行时依赖。日常修改通过 `pnpm lint`、`pnpm typecheck`、`git diff --check` 和代码 review 检查。

GitHub 普通 CI 保留独立的 lint 与 typecheck 作业。CI 与发布工作流均从 `packageManager` 读取 pnpm 版本，使用 Node 24，以 `pnpm-lock.yaml` 作为缓存依赖文件，并通过 `pnpm install --frozen-lockfile` 安装，不在 CI 中升级依赖或覆盖依赖策略。

发布仍由 `v*` tag 触发，依次完成 lint、类型检查、构建，再上传 `dist/bilibili-comment-tree.user.js`。静态检查结果不代表真实浏览器运行验证通过。
