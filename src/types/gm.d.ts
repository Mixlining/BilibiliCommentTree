// 本项目只依赖 Tampermonkey 的同步 GM_* API 与 unsafeWindow，
// 因此不引入完整 @types/tampermonkey，仅声明用到的最小集合。

interface GMValueChangeDetails {
  key: string
  oldValue: unknown
  newValue: unknown
  /** true 表示变更来自其他标签页；false 表示本标签页自己的 GM_setValue */
  remote: boolean
}

declare function GM_getValue<T>(key: string, defaultValue?: T): T
declare function GM_setValue(key: string, value: unknown): void
declare function GM_addValueChangeListener(
  key: string,
  listener: (details: GMValueChangeDetails) => void,
): number
declare function GM_registerMenuCommand(
  caption: string,
  onClick: () => void,
  options?: { autoClose?: boolean, accessKey?: string },
): number
declare function GM_unregisterMenuCommand(menuCommandId: number): void

declare const unsafeWindow: Window & typeof globalThis
