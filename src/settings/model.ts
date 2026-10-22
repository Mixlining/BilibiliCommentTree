import {
  COMMENT_REPLY_TREE_CONTAINER_DEFAULT_HEIGHT,
  COMMENT_REPLY_TREE_CONTAINER_MAX_HEIGHT,
  COMMENT_REPLY_TREE_CONTAINER_MIN_HEIGHT,
} from '../core/constants'

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

export const TREE_MODES: CommentReplyTreeMode[] = ['lineCollapseMain', 'lineKeepMain', 'indentOnly']
export const PAGINATION_MODES: CommentReplyPaginationMode[] = ['loadMore', 'pagination']

// 默认值与原 BewlyCat storage.ts 一致：默认启用、线条-不收起主评论、累计加载；
// 回复容器默认关闭（用户 opt-in），高度默认 480px。
const DEFAULT_SETTINGS: ScriptSettings = {
  enabled: true,
  treeMode: 'lineKeepMain',
  paginationMode: 'loadMore',
  enableCommentReplyTreeContainer: false,
  commentReplyTreeContainerHeight: COMMENT_REPLY_TREE_CONTAINER_DEFAULT_HEIGHT,
}

export function normalizeCommentReplyTreeContainerHeight(value: unknown): number {
  const height = Number(value)
  if (!Number.isFinite(height))
    return COMMENT_REPLY_TREE_CONTAINER_DEFAULT_HEIGHT

  return Math.min(
    COMMENT_REPLY_TREE_CONTAINER_MAX_HEIGHT,
    Math.max(COMMENT_REPLY_TREE_CONTAINER_MIN_HEIGHT, height),
  )
}

export function normalizeSettings(value: unknown): ScriptSettings {
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

export function areSettingsEqual(a: ScriptSettings, b: ScriptSettings): boolean {
  return a.enabled === b.enabled
    && a.treeMode === b.treeMode
    && a.paginationMode === b.paginationMode
    && a.enableCommentReplyTreeContainer === b.enableCommentReplyTreeContainer
    && a.commentReplyTreeContainerHeight === b.commentReplyTreeContainerHeight
}
