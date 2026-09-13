# AGENTS.md

BilibiliCommentTree：B 站评论区树状排序与折叠的 Tampermonkey userscript（Vite + vite-plugin-monkey + TypeScript + SCSS，包管理用 `pnpm`）。代码抽取自 BewlyCat 扩展 `src/inject/index.ts` 的原生评论区树状改造部分。

## 命令

- `pnpm lint` / `pnpm lint:fix`
- `pnpm typecheck`
- `pnpm build`：产出 `dist/bilibili-comment-tree.user.js`（交付物本身，需要发布/验证产物时构建）
- `pnpm dev`：vite-plugin-monkey 开发模式，Tampermonkey 内安装 dev 脚本后支持热重载

提交或推送前无需由 Agent 额外手动运行检查；Git hooks 会自动执行 lint-staged（如已配置）。不要使用 `--no-verify` 绕过 hooks。

## 工具链约定

- **TypeScript 锁定 5.9.x**（`^5.9.2`）：Vue 生态与 typescript-eslint 均不兼容 TS 7，不要升级。
- **pnpm 11**：依赖构建脚本审批走 `pnpm-workspace.yaml` 的 `allowBuilds`；供应链策略 `trustPolicy: no-downgrade`，误报用 `trustPolicyExclude` 豁免（如 `semver@6.3.1`），不要整体关闭策略。
- ESLint 使用 `@antfu/eslint-config`；其内置 perfectionist 已负责导入排序，不要再引入 `eslint-plugin-simple-import-sort`（两者会循环冲突）。
- GM_* API 类型声明在 `src/types/gm.d.ts`，只声明用到的最小集合，不引入 `@types/tampermonkey`。

## 代码约定

- 运行在 Tampermonkey 沙箱（MAIN world 等价）：涉及页面全局对象（如 `customElements`）的劫持必须经由 `unsafeWindow`；GM_* 仅用同步 API（`GM_getValue`/`GM_setValue` 等）。
- 设置一律走 `src/settings.ts`（GM 存储 + GM 菜单），不要重新引入 postMessage 协议或 vue-i18n；
- 界面文案硬编码中文。
- 内部 DOM 标记（`bewly-*` 类名、`data-bewly-*` 属性、`--bew-*` CSS 变量回退）沿用上游命名，为纯内部标识符；颜色必须依赖 B 站原生变量的明暗自动适配，不要硬编码主题色。

## 提交规范

- 标头遵循 Conventional Commits：`<type>(<scope>)!: <description>`；`scope` 和 `!` 可选
- 支持的 `type`：`feat` / `fix` / `docs` / `style` / `refactor` / `perf` / `test` / `build` / `ci` / `chore` / `revert` / `merge`
- 冒号后说明用中文，准确概括改动
