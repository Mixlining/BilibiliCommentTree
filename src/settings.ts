// 本项目的 GM 设置入口；上游移植模块继续通过此文件读取配置。
import type { CommentReplyTreeMode, ScriptSettings } from './settings/model'
import { createSettingsMenus } from './settings/menus'
import { areSettingsEqual, normalizeCommentReplyTreeContainerHeight, normalizeSettings } from './settings/model'

export type { CommentReplyPaginationMode, CommentReplyTreeMode, ScriptSettings } from './settings/model'

const STORAGE_KEY = 'settings'
let currentSettings: Readonly<ScriptSettings> = Object.freeze(normalizeSettings(undefined))
let initialized = false

export function getCommentReplyTreeMode(): CommentReplyTreeMode | null {
  if (!currentSettings.enabled)
    return null
  return currentSettings.treeMode
}

export function isCommentReplyLoadMoreEnabled(): boolean {
  return getCommentReplyTreeMode() !== null
    && currentSettings.paginationMode !== 'pagination'
}

export function isCommentReplyContainerEnabled(): boolean {
  return getCommentReplyTreeMode() !== null
    && currentSettings.enableCommentReplyTreeContainer === true
}

export function getCommentReplyContainerHeight(): number {
  return normalizeCommentReplyTreeContainerHeight(currentSettings.commentReplyTreeContainerHeight)
}

type SettingsChangeListener = (settings: Readonly<ScriptSettings>, previous: Readonly<ScriptSettings>) => void
const settingsChangeListeners = new Set<SettingsChangeListener>()
const updateMenus = createSettingsMenus((update) => {
  // 点击时读取已持久化的最新值，避免远端通知尚未到达时覆盖另一标签页的设置。
  const stored = normalizeSettings(GM_getValue(STORAGE_KEY))
  const next = normalizeSettings(update(stored))
  if (!areSettingsEqual(stored, next))
    GM_setValue(STORAGE_KEY, next)
  // 写入失败时不发布未持久化的状态。
  publishSettings(next)
})

export function registerSettingsChangeListener(listener: SettingsChangeListener) {
  settingsChangeListeners.add(listener)
  return () => settingsChangeListeners.delete(listener)
}

function publishSettings(next: ScriptSettings) {
  if (areSettingsEqual(currentSettings, next))
    return
  const previous = currentSettings
  currentSettings = Object.freeze(next)
  updateMenus(currentSettings)
  for (const listener of settingsChangeListeners)
    listener(currentSettings, previous)
}

export function initScriptSettings() {
  if (initialized)
    return

  currentSettings = Object.freeze(normalizeSettings(GM_getValue(STORAGE_KEY)))
  GM_addValueChangeListener(STORAGE_KEY, (_key, _oldValue, newValue, remote) => {
    // 本标签页的写入由 publishSettings 发布；远端只应用状态，不回写存储。
    if (remote)
      publishSettings(normalizeSettings(newValue))
  })
  initialized = true
  updateMenus(currentSettings)
}
