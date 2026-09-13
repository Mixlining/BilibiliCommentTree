import COMMENT_REPLY_TREE_GUIDES_CSS from '../styles/commentReplyTree.scss?inline'

export const SCRIPT_NAME = 'BilibiliCommentTree'

// 组件补丁标记，避免重复 patch 同一个原型
export const COMMENT_COMPONENT_PATCHED = Symbol('bewly-comment-component-patched')
export const COMMENT_REPLY_PAGINATION_PATCHED = Symbol('bewly-comment-reply-pagination-patched')
export const COMMENT_REPLIES_DISCONNECT_PATCHED = Symbol('bewly-comment-replies-disconnect-patched')

export const pendingCommentEnhancements = new WeakSet<object>()
export const commentRepliesRenderers = new Set<any>()
export const commentReplyTreeStates = new WeakMap<object, CommentReplyTreeState>()
export const commentReplyTreeEpochs = new WeakMap<object, number>()
export const commentReplyPaginationStates = new WeakMap<object, CommentReplyPaginationState>()
export const commentReplyPaginationModeStates = new WeakMap<object, boolean>()
export const pendingCommentReplyTreeLayoutUpdates = new WeakSet<object>()

export const MAX_COMMENT_REPLY_TREE_DEPTH = 10
export const MIN_COMMENT_REPLY_TREE_CONTENT_WIDTH = 150
export const COMPACT_COMMENT_REPLY_TREE_CONTAINER_WIDTH = 640
export const DEFAULT_COMMENT_REPLY_TREE_INDENT_STEP = 32
export const COMPACT_COMMENT_REPLY_TREE_INDENT_STEP = 24
export const COMMENT_REPLY_TREE_MIN_GUIDE_GAP = 4
export const COMMENT_REPLY_TREE_FALLBACK_AVATAR_RADIUS = 12
export const COMMENT_REPLY_TREE_INDENT_STEP = 'var(--bew-comment-reply-indent-step, var(--bew-space-8, 32px))'
export const COMMENT_REPLY_TREE_GUIDES_ID = 'bewly-comment-reply-tree-guides'
export const COMMENT_REPLY_EXPAND_ALL_ID = 'bewly-comment-expand-all-replies'
export const COMMENT_REPLY_EXPAND_ALL_LOADING_ATTRIBUTE = 'data-bewly-comment-expand-all-loading'
// B 站分页项使用从 0 开始的 idx；-1 已被原生用于省略号，-2 留给我们的
// 「展开全部」动作，避免把它误当成真实页码。
export const COMMENT_REPLY_EXPAND_ALL_IDX = -2
export const COMMENT_REPLY_TREE_ROOT_KEY = 'thread-root'
export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

// 文案硬编码中文（来源：BewlyCat src/_locales/cmn-CN.yml）
export const LOADING_TEXT = '加载中…'
export const LOAD_MORE_TEXT = '加载更多'
export const EXPAND_ALL_TEXT = '展开全部回复'
export const PAGINATION_OF_TEXT = '共'

export function buildPaginationPagePrefixText(currentPage: number): string {
  return `第${currentPage}页，共`
}

const BRANCH_COLLAPSE_LABEL = '收起此评论及回复'
const BRANCH_EXPAND_LABEL = '展开此评论及回复'
const TAIL_COLLAPSE_LABEL = '收起后续同级评论'
const TAIL_EXPAND_LABEL = '展开后续同级评论'
export const OFFPAGE_REPLY_WORD = '回复'
export const OFFPAGE_BADGE_TEXT = '不在本页'
export const MISSING_PARENT_LABEL = '评论不在本页或已丢失'
export const COMMENT_REPLY_OFFPAGE_PARENT_SNIPPET_MAX = 96

export function getCommentReplyBranchLabel(collapsed: boolean): string {
  return collapsed ? BRANCH_EXPAND_LABEL : BRANCH_COLLAPSE_LABEL
}

export function getCommentReplyTailLabel(collapsed: boolean): string {
  return collapsed ? TAIL_EXPAND_LABEL : TAIL_COLLAPSE_LABEL
}

export function buildOffpageParentTitle(authorName: string): string {
  return `回复 @${authorName} · 不在本页`
}

/** 楼中楼已见过的回复关系（跨分页保留，用于父节点不在当前页时回溯挂载） */
export interface CommentReplyTreeCachedMeta {
  authorName: string | null
  ctime: number | null
  /** 纯文本正文（已去掉「回复 @」前缀），用于离页父评引用 */
  messageText: string | null
  parentRpid: string | null
  rootRpid: string | null
}

export interface CommentReplyTreeState {
  collapsedNodeKeys: Set<string>
  /** 收起某条评论之后的全部同级评论（及子树） */
  collapsedTailKeys: Set<string>
  /** 展开时缓存的分支收起按钮相对父节点偏移，避免布局移动后复用过期绝对坐标 */
  branchToggleOffsetByKey: Map<string, number>
  /** 展开时缓存的平级收起按钮相对父节点偏移 */
  tailToggleOffsetByKey: Map<string, number>
  /**
   * 按 rpid 缓存回复的 parent/root 等关系。
   * 翻页后用缓存补齐缺失的父评论占位层级。
   */
  replyMetaByRpid: Map<string, CommentReplyTreeCachedMeta>
  enabled: boolean
  nextOriginalOrder: number
  originalOrderByRenderer: WeakMap<HTMLElement, number>
  observedTargetsKey?: string
  resizeObserver?: ResizeObserver
  observedReplyContainer?: HTMLElement
  replyContainerMutationObserver?: MutationObserver
  imageLoadAbort?: AbortController
  imageLoadListeners?: WeakSet<HTMLImageElement>
  layoutUpdateRaf?: number
  /** 锚点未就绪时的重试次数，防止无限 rAF */
  layoutRetryCount?: number
}

export interface CommentReplyTreeNode {
  authorName: string | null
  renderer: HTMLElement
  rpid: string | null
  parentRpid: string | null
  rootRpid: string | null
  ctime: number | null
  originalOrder: number
  children: CommentReplyTreeNode[]
  /**
   * 直接 parent 是否在当前页 DOM。
   * 缺失的父评论由独立占位节点表达层级。
   */
  directParentVisible: boolean
  /** 直接父回复作者（当前页或跨页缓存） */
  directParentAuthorName: string | null
  /** 直接父回复正文摘要（跨页缓存） */
  directParentMessageText: string | null
}

export interface CommentReplyPaginationState {
  identity: string
  pages: Map<number, any[]>
  currentPage: number
  mergedList?: any[]
  collapsedList?: any[]
  suppressInvalidatedResultRestore?: boolean
  pending?: {
    page: number
    beforeList: any[]
    layoutReservation?: CommentReplyLayoutReservation
  }
  loading?: Promise<any>
  expandAllLoading?: Promise<void>
  allRepliesExpanded?: boolean
  /**
   * 从已渲染回复组件捕获的用户交互状态。楼中楼接口可能返回点赞前的
   * 缓存数据，后续分页合并时需要以本地刚完成的操作为准。
   */
  interactionByRpid?: Map<string, CommentReplyInteractionState>
  /** 批量加载期间固定树缩进，避免每个用户信息更新都横向重排。 */
  frozenTreeIndentStep?: number
  expandAllLayoutKey?: string
}

export interface CommentReplyInteractionState {
  action?: number
  like?: number
}

/** 平级评论之间的「收起后续」控件 */
export interface CommentReplyTreeTailCollapse {
  collapsed: boolean
  hiddenCount: number
  key: string
  x: number
  y: number
}

export interface CommentReplyLayoutReservation {
  appliedMinHeight: string
  anchorHost: HTMLElement
  container: HTMLElement
  previousMinHeight: string
  previousOverflowAnchor: string
}

export const COMMENT_SHADOW_STYLE_PATCHES: Record<string, { id: string, css: string }> = {
  'bili-comment-thread-renderer': {
    id: 'bewly-comment-thread-style',
    css: `
      :host {
        position: relative;
      }

      :is(#comment, bili-comment-renderer)[data-bewly-comment-reply-collapsed] {
        box-sizing: border-box;
        height: var(--bew-space-6, 24px) !important;
        min-height: var(--bew-space-6, 24px) !important;
        overflow: hidden !important;
        visibility: hidden !important;
      }

      ${COMMENT_REPLY_TREE_GUIDES_CSS}
    `,
  },
  'bili-comment-replies-renderer': {
    id: 'bewly-comment-replies-style',
    css: `
      #spinner {
        background: var(--bew-comment-replies-mask-bg, rgba(var(--bg1_rgb), 0.85)) !important;
      }

      #pagination {
        color: var(--bew-text-3) !important;
      }

      #${COMMENT_REPLY_EXPAND_ALL_ID} {
        min-height: 24px;
        margin-inline-start: var(--bew-space-2, 8px);
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--bew-text-3, var(--text3, #9499a0));
        font: inherit;
        line-height: inherit;
        cursor: pointer;
        white-space: nowrap;
      }

      #${COMMENT_REPLY_EXPAND_ALL_ID}:active:not(:disabled) {
        transform: scale(0.98);
      }

      #${COMMENT_REPLY_EXPAND_ALL_ID}:focus-visible {
        outline: 2px solid var(--bew-theme-color, #00aeec);
        outline-offset: 2px;
        border-radius: var(--bew-radius-sm, 4px);
      }

      #${COMMENT_REPLY_EXPAND_ALL_ID}:disabled {
        color: var(--bew-text-3, var(--text3, #9499a0));
        cursor: wait;
      }

      :host([${COMMENT_REPLY_EXPAND_ALL_LOADING_ATTRIBUTE}]) {
        cursor: wait;
      }

      :host([${COMMENT_REPLY_EXPAND_ALL_LOADING_ATTRIBUTE}]) #spinner {
        display: flex !important;
        opacity: 1 !important;
        visibility: visible !important;
      }

      :host([${COMMENT_REPLY_EXPAND_ALL_LOADING_ATTRIBUTE}]) #expander-contents::before {
        content: '';
        position: absolute;
        inset: 0;
        z-index: 2147483646;
        background: var(--bew-comment-replies-mask-bg, rgba(var(--bg1_rgb), 0.85));
        pointer-events: auto;
      }

      :host([${COMMENT_REPLY_EXPAND_ALL_LOADING_ATTRIBUTE}]) #expander-contents::after {
        content: '';
        position: sticky;
        bottom: var(--bew-space-4, 16px);
        z-index: 2147483647;
        align-self: center;
        width: var(--bew-space-6, 24px);
        height: var(--bew-space-6, 24px);
        box-sizing: border-box;
        border: 2px solid var(--bew-text-3, var(--text3, #9499a0));
        border-top-color: var(--bew-theme-color, #00aeec);
        border-radius: 50%;
        animation: bewly-comment-expand-all-spin 0.8s linear infinite;
        pointer-events: none;
      }

      @keyframes bewly-comment-expand-all-spin {
        to {
          transform: rotate(360deg);
        }
      }

      :host([data-bewly-comment-reply-tree]) {
        --bew-comment-reply-branch-radius: var(--bew-radius-lg, 12px);
        --bew-comment-reply-indent-step: var(--bew-space-8, 32px);
      }

      :host([data-bewly-comment-reply-tree]) #expander-contents {
        position: relative;
        /*
         * 不直接移动 Lit repeat 生成的回复节点。B 站用注释节点保存
         * keyed repeat 的边界，移动 host 而不移动这些边界会在下一次
         * requestUpdate 后重新插入同一条回复，表现为整条评论成对重复。
         * 用 flex order 表达树顺序可以保留原生 DOM 锚点。
         */
        display: flex;
        flex-direction: column;
        align-items: stretch;
      }

      :host([data-bewly-comment-reply-tree]) #expander-contents > :is(bili-comment-reply-renderer, bili-comment-renderer, .bewly-comment-missing-parent)[data-bewly-comment-reply-depth] {
        box-sizing: border-box;
        display: block;
        padding-inline-start: var(--bew-comment-reply-indent, 0px);
        width: 100%;
        order: var(--bew-comment-reply-order, 0);
      }

      :host([data-bewly-comment-reply-tree]) #expander-contents > #expander-footer {
        order: 2147483647;
      }

      :host([data-bewly-comment-reply-tree]) #expander-contents > :is(bili-comment-reply-renderer, bili-comment-renderer, .bewly-comment-missing-parent)[data-bewly-comment-reply-hidden] {
        display: none !important;
      }

      :host([data-bewly-comment-reply-tree]) #expander-contents > :is(bili-comment-reply-renderer, bili-comment-renderer, .bewly-comment-missing-parent)[data-bewly-comment-reply-collapsed] {
        box-sizing: border-box;
        height: var(--bew-space-6, 24px) !important;
        min-height: var(--bew-space-6, 24px) !important;
        overflow: hidden !important;
        visibility: hidden !important;
      }

      .bewly-comment-missing-parent__body {
        display: flex;
        align-items: flex-start;
        gap: var(--bew-space-2, 8px);
        padding-block: var(--bew-space-3, 12px);
        color: var(--bew-text-2, var(--text2, #61666d));
        font-size: var(--bew-font-size-caption, 12px);
        line-height: var(--bew-line-height-caption, 16px);
        overflow-wrap: anywhere;
      }

      .bewly-comment-missing-parent__avatar {
        display: grid;
        place-items: center;
        flex: 0 0 var(--bew-space-6, 24px);
        height: var(--bew-space-6, 24px);
        border-radius: var(--bew-radius-full, 50%);
        background: var(--bew-fill-2, var(--bg2, #f1f2f3));
      }

      ${COMMENT_REPLY_TREE_GUIDES_CSS}
    `,
  },
}

export const COMMENT_REPLY_OFFPAGE_PARENT_ID = 'bewly-reply-offpage-parent'
export const COMMENT_REPLY_OFFPAGE_PARENT_STYLE_ID = 'bewly-reply-offpage-parent-style'
export const COMMENT_REPLY_OFFPAGE_PARENT_CSS = `
  #${COMMENT_REPLY_OFFPAGE_PARENT_ID} {
    display: block;
    box-sizing: border-box;
    margin: 0 0 var(--bew-space-2, 8px);
    padding: 0;
    border: none;
    background: transparent;
    font-size: var(--bew-font-size-caption, 12px);
    line-height: var(--bew-line-height-caption, 16px);
    color: var(--bew-text-3, var(--text3, #9499a0));
  }

  #${COMMENT_REPLY_OFFPAGE_PARENT_ID} .bewly-reply-offpage-parent__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--bew-space-1, 4px) var(--bew-space-2, 8px);
    margin: 0;
    font-weight: var(--bew-font-weight-regular, 400);
    color: var(--bew-text-3, var(--text3, #9499a0));
  }

  #${COMMENT_REPLY_OFFPAGE_PARENT_ID} .bewly-reply-offpage-parent__reply-word {
    flex: 0 0 auto;
  }

  #${COMMENT_REPLY_OFFPAGE_PARENT_ID} .bewly-reply-offpage-parent__at {
    flex: 0 1 auto;
    color: var(--bew-theme-color, #00a1d6);
    font-weight: var(--bew-font-weight-medium, 500);
    word-break: break-all;
  }

  #${COMMENT_REPLY_OFFPAGE_PARENT_ID} .bewly-reply-offpage-parent__badge {
    flex: 0 0 auto;
    padding: 0 var(--bew-space-1, 4px);
    border-radius: var(--bew-badge-radius, 9999px);
    border: 1px solid var(--bew-text-3, var(--text3, #9499a0));
    background: transparent;
    font-size: 11px;
    line-height: 16px;
    font-weight: var(--bew-font-weight-regular, 400);
    color: var(--bew-text-3, var(--text3, #9499a0));
  }

  /* 有正文缓存：仅文字下方浅色虚线，不拉满整行 */
  #${COMMENT_REPLY_OFFPAGE_PARENT_ID} .bewly-reply-offpage-parent__quote {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    margin: var(--bew-space-1, 4px) 0 0;
    padding: 0;
    border: none;
    background: transparent;
    overflow: hidden;
    font-weight: var(--bew-font-weight-regular, 400);
    color: var(--bew-text-3, var(--text3, #9499a0));
    word-break: break-word;
    text-decoration: underline;
    text-decoration-style: dashed;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
    text-decoration-color: color-mix(in srgb, var(--bew-text-3, #9499a0) 45%, transparent);
  }

  #${COMMENT_REPLY_OFFPAGE_PARENT_ID}[data-mode="compact"] .bewly-reply-offpage-parent__quote {
    display: none;
  }
`

/**
 * 线条模式下，有父级引导线的回复会隐藏正文前的「回复 @xxx :」
 * 实际 DOM：
 * <p id="contents">
 *   <span>回复 </span>
 *   <a data-type="mention">@用户</a>
 *   <span> : 正文...</span>
 * </p>
 */
export const REPLY_AT_PREFIX_WORD = /^(?:回复|回覆|Reply(?:\s+to)?)\s*$/i
export const REPLY_AT_PREFIX_SINGLE = /^(?:回复|回覆|Reply(?:\s+to)?)\s*[^\s:：]+\s*[:：]\s*/i
export const REPLY_AT_COLON_PREFIX = /^\s*[:：]\s*/
