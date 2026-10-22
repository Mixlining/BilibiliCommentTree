# 模块边界与自有设置层

## 上游同步边界

本项目按功能拆分了 BewlyCat 的原生评论区注入代码。拆分后的文件不能仅因位于本项目的 `core/` 目录，就视为自有实现。

| 文件 | 来源与维护方式 |
| --- | --- |
| `src/core/*.ts` | 上游 `src/inject/index.ts` 的评论逻辑及 `commentReplyPageCache.ts`；保留算法、状态结构和内部标记，随上游同步 |
| `src/shared/treeGeometry.ts` | 上游 `src/utils/commentReplyTree.ts`；保持同步 |
| `src/styles/commentReplyTree.scss` | 上游评论树样式；保持同步 |
| `src/patch.ts` | 上游组件补丁的 userscript 适配，包含 `unsafeWindow` 等必要差异；保持现有结构，不作自主性能重写 |
| `src/settings.ts`、`src/settings/` | 本项目的同步 GM 存储、中文菜单和配置通知；可独立改进，上游设置语义仍需保持 |
| `src/main.ts`、`src/types/`、`vite.config.ts` | 本项目的启动、最小 GM 声明和 userscript 构建适配 |

自有设置层、启动联动、类型声明、构建配置及 CI 可独立维护。`core/`、`shared/`、样式与 `patch.ts` 保留上游结构，本次改造没有修改这些文件。历史同步详情见 `track-bewlycat-v*.md`。

## 设置层职责

- `settings/model.ts`：类型、默认值、值归一化、语义相等判断。原有高度转换与上下限逻辑保持不变，并继续引用上游常量，避免重复维护数值。
- `settings/menus.ts`：中文文案、菜单动作和增量更新。菜单回调不捕获旧设置；每个动作接收入口提供的当前配置。
- `settings.ts`：公开读取接口、同步 GM 存储、跨标签页通知和订阅。既有导出路径保持不变，上游模块无需修改 import。
- `main.ts`：将已应用的配置变化传给评论树；总开关持续关闭时不做无效刷新。

模块导入不读 GM 存储。`initScriptSettings()` 在组件补丁安装前同步读取设置；重复调用不会再注册菜单或存储监听。配置只在初始化和发布时替换，已发布的对象通过 `Object.freeze` 保护；订阅函数返回取消订阅方法。

本地菜单动作先读取存储中的最新配置，再应用单项变更、持久化并发布。这样可以保留远端已写入但通知尚未到达的其他偏好；写入失败不发布未保存的状态。GM 同步 API 没有原子比较交换能力，因此不承诺解决多个标签页完全同时读写产生的覆盖。

远端监听采用 Tampermonkey 的四参数回调 `(key, oldValue, newValue, remote)`。远端配置只归一化和发布，不回写；等效配置不更新菜单、不通知订阅方。本标签页写入产生的 `remote=false` 通知被忽略，由本地写入路径发布一次。

## 性能收益与兼容要求

菜单使用 Tampermonkey 5.0+ 的 `GM_registerMenuCommand` `options.id` 更新已有项，保留菜单 ID 和顺序。一次只改变一个菜单文案时，原来的 4 次注销与 4 次注册变为 1 次更新；只改变高度时没有菜单 API 调用。无需再声明 `GM_unregisterMenuCommand` 权限。

首次注册仅传入文案和回调，后续更新才传入上次返回的 ID；ID 可以是数字或字符串。接口按 Tampermonkey 5.5.1 核对，仍采用同步 GM API 和最小本地类型声明，不引入异步初始化或更高版本专有选项。

这些收益是减少确定的 API 调用和无效刷新；未测量浏览器帧率或评论树布局耗时，不能据此声称树布局变快。

API 契约参照 [Tampermonkey 值变更监听文档](https://www.tampermonkey.net/documentation.php?q=GM_values) 和 [菜单文档](https://www.tampermonkey.net/documentation.php?q=GM_registerMenuCommand)。BewlyCat 实现来源为本地仓库。

## 工具链与静态检查

pnpm 版本由项目 `package.json` 的 `packageManager` 固定在 11.x；TypeScript 使用 `~6.0.3`，只接受 6.0.x 补丁更新。依赖在现有主版本范围内升级，并遵守使用者环境的依赖源、最低发布时间和项目供应链策略；不改全局工具或配置。解析结果由 `pnpm-lock.yaml` 固定。

本项目不保留测试代码或测试运行脚本，不新增运行时依赖。日常修改通过 `pnpm lint`、`pnpm typecheck`、`git diff --check` 和代码 review 检查。

GitHub 普通 CI 保留独立的 lint 与 typecheck 作业。CI 与发布工作流均从 `packageManager` 读取 pnpm 版本，使用 Node 24，以 `pnpm-lock.yaml` 作为缓存依赖文件，并通过 `pnpm install --frozen-lockfile` 安装，不在 CI 中升级依赖或覆盖依赖策略。

发布仍由 `v*` tag 触发，依次完成 lint、类型检查、构建，再上传 `dist/bilibili-comment-tree.user.js`。静态检查结果不代表真实浏览器运行验证通过。
