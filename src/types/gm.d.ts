// 本项目只依赖 Tampermonkey 的同步 GM_* API 与 unsafeWindow，
// 因此不引入完整 @types/tampermonkey，仅声明用到的最小集合。

declare function GM_getValue<T>(key: string, defaultValue?: T): T
declare function GM_setValue(key: string, value: unknown): void
declare function GM_addValueChangeListener(
  key: string,
  listener: (key: string, oldValue: unknown, newValue: unknown, remote: boolean) => void,
): number
declare function GM_registerMenuCommand(
  caption: string,
  onClick: () => void,
  options?: { id?: number | string },
): number | string

declare const unsafeWindow: Window & typeof globalThis
