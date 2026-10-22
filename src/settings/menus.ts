import type { CommentReplyPaginationMode, CommentReplyTreeMode, ScriptSettings } from './model'
import { PAGINATION_MODES, TREE_MODES } from './model'

const TREE_MODE_LABELS: Record<CommentReplyTreeMode, string> = {
  lineCollapseMain: '线条-收起主评论',
  lineKeepMain: '线条-不收起主评论',
  indentOnly: '缩进-无收起功能',
}
const PAGINATION_MODE_LABELS: Record<CommentReplyPaginationMode, string> = {
  loadMore: '更多',
  pagination: '分页',
}

type SettingsUpdate = (settings: Readonly<ScriptSettings>) => ScriptSettings

interface SettingsMenu {
  caption: (settings: Readonly<ScriptSettings>) => string
  update: SettingsUpdate
}

const MENUS: readonly SettingsMenu[] = [
  {
    caption: settings => `树状显示：${settings.enabled ? '开' : '关'}`,
    update: settings => ({ ...settings, enabled: !settings.enabled }),
  },
  {
    caption: settings => `树状样式：${TREE_MODE_LABELS[settings.treeMode]}（点击切换）`,
    update: settings => ({
      ...settings,
      treeMode: TREE_MODES[(TREE_MODES.indexOf(settings.treeMode) + 1) % TREE_MODES.length]!,
    }),
  },
  {
    caption: settings => `回复加载：${PAGINATION_MODE_LABELS[settings.paginationMode]}（点击切换）`,
    update: settings => ({
      ...settings,
      paginationMode: PAGINATION_MODES[(PAGINATION_MODES.indexOf(settings.paginationMode) + 1) % PAGINATION_MODES.length]!,
    }),
  },
  {
    caption: settings => `回复容器：${settings.enableCommentReplyTreeContainer ? '开' : '关'}`,
    update: settings => ({ ...settings, enableCommentReplyTreeContainer: !settings.enableCommentReplyTreeContainer }),
  },
]

/** 保留菜单 ID 和顺序，仅在文案变化时更新对应项（Tampermonkey 5.0+）。 */
export function createSettingsMenus(apply: (update: SettingsUpdate) => void) {
  const entries = MENUS.map(menu => ({
    ...menu,
    onClick: () => apply(menu.update),
    id: undefined as number | string | undefined,
    lastCaption: undefined as string | undefined,
  }))

  return (settings: Readonly<ScriptSettings>) => {
    for (const entry of entries) {
      const caption = entry.caption(settings)
      if (caption === entry.lastCaption)
        continue
      entry.id = entry.id === undefined
        ? GM_registerMenuCommand(caption, entry.onClick)
        : GM_registerMenuCommand(caption, entry.onClick, { id: entry.id })
      entry.lastCaption = caption
    }
  }
}
