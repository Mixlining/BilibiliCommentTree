// 设置与 GM 菜单：取代原扩展「ISOLATED 世界存储 → postMessage 协议」的设置链路。
// GM_getValue/GM_setValue 同步读写，配合 GM_addValueChangeListener 跨标签页同步。

import {
  COMMENT_REPLY_TREE_CONTAINER_DEFAULT_HEIGHT,
  COMMENT_REPLY_TREE_CONTAINER_MAX_HEIGHT,
  COMMENT_REPLY_TREE_CONTAINER_MIN_HEIGHT,
} from './core/constants'

export type CommentReplyTreeMode = 'lineCollapseMain' | 'lineKeepMain' | 'indentOnly'
export type CommentReplyPaginationMode = 'loadMore' | 'pagination'

export interface ScriptSettings {
  /** 评论区树状显示总开关（对应原 enableCommentReplyTreeDisplay） */
  enabled: boolean
  /** 树状展示模式（对应原 commentReplyTreeMode） */
  treeMode: CommentReplyTreeMode
  /** 楼中楼回复加载方式（对应原 commentReplyPaginationMode） */
  paginationMode: CommentReplyPaginationMode
  /** 固定高度回复容器（对应原 enableCommentReplyTreeContainer） */
  enableCommentReplyTreeContainer: boolean
  /** 回复容器高度（对应原 commentReplyTreeContainerHeight） */
  commentReplyTreeContainerHeight: number
}

const STORAGE_KEY = 'settings'

const TREE_MODES: CommentReplyTreeMode[] = ['lineCollapseMain', 'lineKeepMain', 'indentOnly']
const PAGINATION_MODES: CommentReplyPaginationMode[] = ['loadMore', 'pagination']

// 默认值与原 BewlyCat storage.ts 一致：默认启用、线条-不收起主评论、累计加载；
// 回复容器默认关闭（用户 opt-in），高度默认 480px。
const DEFAULT_SETTINGS: ScriptSettings = {
  enabled: true,
  treeMode: 'lineKeepMain',
  paginationMode: 'loadMore',
  enableCommentReplyTreeContainer: false,
  commentReplyTreeContainerHeight: COMMENT_REPLY_TREE_CONTAINER_DEFAULT_HEIGHT,
}

function normalizeCommentReplyTreeContainerHeight(value: unknown): number {
  const height = Number(value)
  if (!Number.isFinite(height))
    return COMMENT_REPLY_TREE_CONTAINER_DEFAULT_HEIGHT

  return Math.min(
    COMMENT_REPLY_TREE_CONTAINER_MAX_HEIGHT,
    Math.max(COMMENT_REPLY_TREE_CONTAINER_MIN_HEIGHT, height),
  )
}

function normalizeSettings(value: unknown): ScriptSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { ...DEFAULT_SETTINGS }
  const record = value as Record<string, unknown>
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : DEFAULT_SETTINGS.enabled,
    treeMode: TREE_MODES.includes(record.treeMode as CommentReplyTreeMode)
      ? record.treeMode as CommentReplyTreeMode
      : DEFAULT_SETTINGS.treeMode,
    paginationMode: PAGINATION_MODES.includes(record.paginationMode as CommentReplyPaginationMode)
      ? record.paginationMode as CommentReplyPaginationMode
      : DEFAULT_SETTINGS.paginationMode,
    enableCommentReplyTreeContainer: typeof record.enableCommentReplyTreeContainer === 'boolean'
      ? record.enableCommentReplyTreeContainer
      : DEFAULT_SETTINGS.enableCommentReplyTreeContainer,
    commentReplyTreeContainerHeight: normalizeCommentReplyTreeContainerHeight(
      record.commentReplyTreeContainerHeight,
    ),
  }
}

let currentSettings: ScriptSettings = normalizeSettings(GM_getValue(STORAGE_KEY, undefined))

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

type SettingsChangeListener = (settings: ScriptSettings, previous: ScriptSettings) => void
const settingsChangeListeners: SettingsChangeListener[] = []

export function registerSettingsChangeListener(listener: SettingsChangeListener) {
  settingsChangeListeners.push(listener)
}

function notifySettingsChange(previous: ScriptSettings) {
  settingsChangeListeners.forEach(listener => listener(currentSettings, previous))
}

// GM 菜单文案（硬编码中文）
const TREE_MODE_LABELS: Record<CommentReplyTreeMode, string> = {
  lineCollapseMain: '线条-收起主评论',
  lineKeepMain: '线条-不收起主评论',
  indentOnly: '缩进-无收起功能',
}
const PAGINATION_MODE_LABELS: Record<CommentReplyPaginationMode, string> = {
  loadMore: '更多',
  pagination: '分页',
}

let menuCommandIds: number[] = []

function rebuildMenus() {
  menuCommandIds.forEach(id => GM_unregisterMenuCommand(id))
  menuCommandIds = []

  const register = (caption: string, onClick: () => void) => {
    menuCommandIds.push(GM_registerMenuCommand(caption, onClick))
  }

  register(
    currentSettings.enabled ? '树状显示：开' : '树状显示：关',
    () => applySettings({ ...currentSettings, enabled: !currentSettings.enabled }),
  )
  register(
    `树状样式：${TREE_MODE_LABELS[currentSettings.treeMode]}（点击切换）`,
    () => {
      const index = TREE_MODES.indexOf(currentSettings.treeMode)
      const next = TREE_MODES[(index + 1) % TREE_MODES.length]!
      applySettings({ ...currentSettings, treeMode: next })
    },
  )
  register(
    `回复加载：${PAGINATION_MODE_LABELS[currentSettings.paginationMode]}（点击切换）`,
    () => {
      const index = PAGINATION_MODES.indexOf(currentSettings.paginationMode)
      const next = PAGINATION_MODES[(index + 1) % PAGINATION_MODES.length]!
      applySettings({ ...currentSettings, paginationMode: next })
    },
  )
  register(
    currentSettings.enableCommentReplyTreeContainer ? '回复容器：开' : '回复容器：关',
    () => {
      applySettings({
        ...currentSettings,
        enableCommentReplyTreeContainer: !currentSettings.enableCommentReplyTreeContainer,
      })
    },
  )
}

function applySettings(next: ScriptSettings) {
  const previous = currentSettings
  currentSettings = next
  GM_setValue(STORAGE_KEY, next)
  rebuildMenus()
  notifySettingsChange(previous)
}

export function initScriptSettings() {
  // 其他标签页修改设置时同步本页（本页自己的写入已由 applySettings 处理）
  GM_addValueChangeListener(STORAGE_KEY, ({ remote, newValue }) => {
    if (!remote)
      return
    const previous = currentSettings
    const next = normalizeSettings(newValue)
    if (next.enabled === previous.enabled
      && next.treeMode === previous.treeMode
      && next.paginationMode === previous.paginationMode
      && next.enableCommentReplyTreeContainer === previous.enableCommentReplyTreeContainer
      && next.commentReplyTreeContainerHeight === previous.commentReplyTreeContainerHeight) {
      return
    }
    currentSettings = next
    rebuildMenus()
    notifySettingsChange(previous)
  })

  rebuildMenus()
}
