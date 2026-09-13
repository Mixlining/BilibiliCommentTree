import type { CommentReplyAvatarAnchor, CommentReplyTreeBranch } from '../shared/treeGeometry'
import type { CommentReplyTreeCachedMeta, CommentReplyTreeNode, CommentReplyTreeState, CommentReplyTreeTailCollapse } from './constants'
import { getCommentReplyTreeMode, isCommentReplyLoadMoreEnabled } from '../settings'
import {
  formatCommentReplyGuideCoordinate,
  getCommentReplyBranchExpandedToggleY,
  getCommentReplyBranchPath,
  getCommentReplyBranchToggleY,
} from '../shared/treeGeometry'
import {
  COMMENT_REPLY_EXPAND_ALL_ID,
  COMMENT_REPLY_TREE_FALLBACK_AVATAR_RADIUS,
  COMMENT_REPLY_TREE_GUIDES_ID,
  COMMENT_REPLY_TREE_INDENT_STEP,
  COMMENT_REPLY_TREE_MIN_GUIDE_GAP,
  COMMENT_REPLY_TREE_ROOT_KEY,
  COMMENT_SHADOW_STYLE_PATCHES,
  commentRepliesRenderers,
  commentReplyPaginationModeStates,
  commentReplyPaginationStates,
  commentReplyTreeEpochs,
  commentReplyTreeStates,
  COMPACT_COMMENT_REPLY_TREE_CONTAINER_WIDTH,
  COMPACT_COMMENT_REPLY_TREE_INDENT_STEP,
  DEFAULT_COMMENT_REPLY_TREE_INDENT_STEP,
  getCommentReplyBranchLabel,
  getCommentReplyTailLabel,
  MAX_COMMENT_REPLY_TREE_DEPTH,
  MIN_COMMENT_REPLY_TREE_CONTENT_WIDTH,
  MISSING_PARENT_LABEL,
  pendingCommentReplyTreeLayoutUpdates,
} from './constants'
import {
  ensureCommentShadowStyle,
  getCommentRendererAuthorName,
  getCommentReplyData,
  getReplyAuthorName,
  getReplyParentRpid,
  getReplyRootRpid,
  getReplyRpid,
  isCommentReplyRenderer,
} from './dom'
import { clearCommentReplyOffpageParentLabel, updateCommentReplyOffpageParentLabel } from './offpage'
import {
  clearCommentReplyPaginationState,
  invalidateCommentReplyPaginationLoading,
  restoreCommentReplyPaginationHead,
  suspendCommentReplyPaginationForNativeCollapse,
  updateCommentReplyExpandAllControl,
} from './pagination'
import { setCommentReplyAtPrefixHidden } from './prefix'
import {
  getCommentRendererMessageText,
  getReplyAtAuthorFromMessage,
  getReplyMessageText,
  pickRicherReplyMessageText,
  truncateReplyMessageSnippet,
} from './replyText'

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

export function getCommentReplyTreeState(component: object): CommentReplyTreeState {
  let state = commentReplyTreeStates.get(component)
  if (!state) {
    state = {
      collapsedNodeKeys: new Set(),
      collapsedTailKeys: new Set(),
      branchToggleOffsetByKey: new Map(),
      tailToggleOffsetByKey: new Map(),
      replyMetaByRpid: new Map(),
      enabled: false,
      nextOriginalOrder: 0,
      originalOrderByRenderer: new WeakMap(),
    }
    commentReplyTreeStates.set(component, state)
  }
  else {
    if (!state.collapsedTailKeys)
      state.collapsedTailKeys = new Set()
    if (!state.branchToggleOffsetByKey)
      state.branchToggleOffsetByKey = new Map()
    if (!state.tailToggleOffsetByKey)
      state.tailToggleOffsetByKey = new Map()
    if (!state.replyMetaByRpid)
      state.replyMetaByRpid = new Map()
  }
  return state
}

function isCommentReplyTreeRootParent(parentRpid: string | null, rootRpid: string | null, selfRpid: string | null): boolean {
  if (!parentRpid || parentRpid === '0')
    return true
  if (selfRpid && parentRpid === selfRpid)
    return true
  if (rootRpid && parentRpid === rootRpid)
    return true
  return false
}

/** 写入/合并当前页见到的回复关系，供跨页挂载回溯 */
export function cacheCommentReplyTreeMeta(
  state: CommentReplyTreeState,
  replyItem: any,
  extras?: { messageText?: string | null },
): CommentReplyTreeCachedMeta | null {
  const rpid = getReplyRpid(replyItem)
  if (!rpid)
    return null

  const previous = state.replyMetaByRpid.get(rpid)
  const fromData = getReplyMessageText(replyItem)
  const messageText = pickRicherReplyMessageText(
    pickRicherReplyMessageText(previous?.messageText, fromData),
    extras?.messageText ?? null,
  )
  const next: CommentReplyTreeCachedMeta = {
    authorName: getReplyAuthorName(replyItem) ?? previous?.authorName ?? null,
    ctime: getCommentReplyCtime(replyItem) ?? previous?.ctime ?? null,
    messageText,
    parentRpid: getReplyParentRpid(replyItem) ?? previous?.parentRpid ?? null,
    rootRpid: getReplyRootRpid(replyItem) ?? previous?.rootRpid ?? null,
  }
  state.replyMetaByRpid.set(rpid, next)
  return next
}

interface CommentReplyTreeParentResolve {
  /** 用于缩进/引导线的最近可见祖先；undefined 表示挂在楼中楼根下 */
  visualParent: CommentReplyTreeNode | undefined
  /** 直接 parent 是否在当前页 */
  directParentVisible: boolean
  /** 直接父回复作者（用于跨页时展示「回复了谁」） */
  directParentAuthorName: string | null
  /** 直接父回复正文（跨页缓存摘要） */
  directParentMessageText: string | null
}

/**
 * 在当前可见节点中解析父节点：直接 parent 不在页内时，
 * 沿 replyMetaByRpid 向上找最近仍在 DOM 的祖先。
 * 同时记录真实直接父是否在本页，供 UI 保留「回复 @xxx」。
 */
function resolveCommentReplyTreeParentNode(
  node: CommentReplyTreeNode,
  nodeByRpid: Map<string, CommentReplyTreeNode>,
  metaByRpid: Map<string, CommentReplyTreeCachedMeta>,
): CommentReplyTreeParentResolve {
  const directParentRpid = node.parentRpid
  if (!directParentRpid || isCommentReplyTreeRootParent(directParentRpid, node.rootRpid, node.rpid)) {
    return {
      visualParent: undefined,
      directParentVisible: true,
      directParentAuthorName: null,
      directParentMessageText: null,
    }
  }

  const directInDom = nodeByRpid.get(directParentRpid)
  const directMeta = metaByRpid.get(directParentRpid)
  const directParentAuthorName = (
    directInDom?.authorName
    ?? directMeta?.authorName
    ?? null
  )
  const directParentMessageText = (
    directMeta?.messageText
    ?? null
  )

  if (directInDom && directInDom !== node) {
    return {
      visualParent: directInDom,
      directParentVisible: true,
      directParentAuthorName,
      directParentMessageText,
    }
  }

  // 直接父不在本页：沿缓存向上找最近可见祖先
  let parentRpid: string | null = directMeta?.parentRpid ?? null
  if (!node.rootRpid && directMeta?.rootRpid)
    node.rootRpid = directMeta.rootRpid

  const seen = new Set<string>([directParentRpid])
  if (node.rpid)
    seen.add(node.rpid)

  while (parentRpid) {
    if (seen.has(parentRpid))
      break
    seen.add(parentRpid)

    if (isCommentReplyTreeRootParent(parentRpid, node.rootRpid, node.rpid)) {
      return {
        visualParent: undefined,
        directParentVisible: false,
        directParentAuthorName,
        directParentMessageText,
      }
    }

    const parentNode = nodeByRpid.get(parentRpid)
    if (parentNode && parentNode !== node) {
      return {
        visualParent: parentNode,
        directParentVisible: false,
        directParentAuthorName,
        directParentMessageText,
      }
    }

    const cachedParent = metaByRpid.get(parentRpid)
    if (!cachedParent) {
      return {
        visualParent: undefined,
        directParentVisible: false,
        directParentAuthorName,
        directParentMessageText,
      }
    }

    if (!node.rootRpid && cachedParent.rootRpid)
      node.rootRpid = cachedParent.rootRpid

    parentRpid = cachedParent.parentRpid
  }

  return {
    visualParent: undefined,
    directParentVisible: false,
    directParentAuthorName,
    directParentMessageText,
  }
}

function disconnectCommentReplyTreeResizeObserver(state: CommentReplyTreeState) {
  state.resizeObserver?.disconnect()
  state.resizeObserver = undefined
  state.observedTargetsKey = undefined
  state.replyContainerMutationObserver?.disconnect()
  state.replyContainerMutationObserver = undefined
  state.observedReplyContainer = undefined
  state.imageLoadAbort?.abort()
  state.imageLoadAbort = undefined
  state.imageLoadListeners = undefined
  if (state.layoutUpdateRaf !== undefined) {
    cancelAnimationFrame(state.layoutUpdateRaf)
    state.layoutUpdateRaf = undefined
  }
}

/**
 * 原生「收起回复」会在后续展开时复用组件实例。此时上一次展开的
 * 折叠状态、父子关系和布局偏移都已失效，必须作为同一个会话整体清理。
 */
export function clearCommentReplyTreeState(component: any) {
  commentReplyTreeEpochs.set(component, (commentReplyTreeEpochs.get(component) ?? 0) + 1)
  const state = commentReplyTreeStates.get(component)
  if (state)
    disconnectCommentReplyTreeResizeObserver(state)

  if (component instanceof HTMLElement) {
    const root = component.shadowRoot
    const replyContainer = root?.querySelector<HTMLElement>('#expander-contents')
    if (replyContainer) {
      removeCommentReplyTreeGuides(component, replyContainer)
      replyContainer.querySelectorAll('.bewly-comment-missing-parent').forEach(node => node.remove())
      Array.from(replyContainer.children)
        .filter(isCommentReplyRenderer)
        .forEach((renderer) => {
          delete renderer.dataset.bewlyCommentReplyDepth
          delete renderer.dataset.bewlyCommentReplyHidden
          delete renderer.dataset.bewlyCommentReplyCollapsed
          renderer.style.removeProperty('--bew-comment-reply-indent')
          renderer.style.removeProperty('--bew-comment-reply-order')
          setCommentReplyAtPrefixHidden(renderer, false)
          clearCommentReplyOffpageParentLabel(renderer)
        })
    }
    getCommentReplyTreeRootRenderer(component)
      ?.removeAttribute('data-bewly-comment-reply-collapsed')
    root?.querySelector(`#${COMMENT_REPLY_EXPAND_ALL_ID}`)?.remove()
    component.removeAttribute('data-bewly-comment-reply-tree')
    component.style.removeProperty('--bew-comment-reply-indent-step')
  }

  pendingCommentReplyTreeLayoutUpdates.delete(component)
  commentReplyTreeStates.delete(component)
  commentRepliesRenderers.delete(component)
}

/**
 * 主评论图文加载/展开会把楼中楼整体下推；仅 observe 回复容器时
 * ResizeObserver 不会因「上方变高导致位移」触发，线条会错位。
 * 同时监听楼层 host、主评论与回复容器，并在图片 load 后重算。
 */
export function scheduleCommentReplyTreeLayoutUpdate(component: any) {
  if (!component || pendingCommentReplyTreeLayoutUpdates.has(component))
    return

  const treeEpoch = commentReplyTreeEpochs.get(component) ?? 0
  pendingCommentReplyTreeLayoutUpdates.add(component)
  requestAnimationFrame(() => {
    pendingCommentReplyTreeLayoutUpdates.delete(component)
    if (
      !component?.isConnected
      || (commentReplyTreeEpochs.get(component) ?? 0) !== treeEpoch
    ) {
      return
    }
    updateCommentReplyTree(component)
  })
}

/**
 * 原生「收起回复」会在后续展开时复用组件实例；SPA 直接移除整层回复
 * 组件时也依赖断连清理。相关 disconnect patch 见 pagination.ts。
 */
function observeCommentReplyTreeLayout(
  component: any,
  state: CommentReplyTreeState,
  replyContainer: HTMLElement,
) {
  const threadRoot = getCommentReplyTreeThreadRoot(component)
  const threadHost = threadRoot?.host instanceof HTMLElement ? threadRoot.host : null
  const mainRenderer = getCommentReplyTreeRootRenderer(component)
  const targets = new Set<HTMLElement>()
  const addTarget = (target: Element | null | undefined) => {
    if (target instanceof HTMLElement)
      targets.add(target)
  }
  addTarget(replyContainer)
  addTarget(threadHost)
  addTarget(mainRenderer)
  addTarget(component)

  // 主评论图片和正文可能分别位于多层 shadow root；只观察外层 renderer
  // 在某些布局下无法捕获内部图片高度变化，导致回复坐标仍停留在旧位置。
  const layoutTargetSelector = '#body, #main, #header, #content, #pictures, #footer, #user-avatar, bili-comment-pictures-renderer, bili-rich-text, img'
  const collectNestedLayoutTargets = (root: ParentNode) => {
    root.querySelectorAll<HTMLElement>(layoutTargetSelector).forEach(addTarget)
    root.querySelectorAll<HTMLElement>('*').forEach((element) => {
      if (element.shadowRoot)
        collectNestedLayoutTargets(element.shadowRoot)
    })
  }
  if (threadRoot)
    collectNestedLayoutTargets(threadRoot)
  else if (component instanceof HTMLElement && component.shadowRoot)
    collectNestedLayoutTargets(component.shadowRoot)

  const targetList = [...targets]
  const targetsKey = targetList.map(el => `${el.localName}#${el.id || ''}`).join('|')

  if (state.observedTargetsKey !== targetsKey || !state.resizeObserver) {
    disconnectCommentReplyTreeResizeObserver(state)
    state.observedTargetsKey = targetsKey
    state.resizeObserver = new ResizeObserver(() => {
      if (!component?.isConnected) {
        disconnectCommentReplyTreeResizeObserver(state)
        return
      }
      scheduleCommentReplyTreeLayoutUpdate(component)
    })
    targetList.forEach(target => state.resizeObserver?.observe(target))
  }

  // 删除/屏蔽回复时，B 站有时直接从列表移除 renderer，不触发回复组件自身的
  // update；仅依赖 ResizeObserver 可能错过这一帧，导致楼层 shadow root 内的线条
  // 没有按剩余回复重新绘制。
  if (state.observedReplyContainer !== replyContainer || !state.replyContainerMutationObserver) {
    state.replyContainerMutationObserver?.disconnect()
    const observer = new MutationObserver((mutations) => {
      if (!component?.isConnected) {
        observer.disconnect()
        return
      }

      const isTreeGuideNode = (node: Node) => (
        node instanceof Element
        && (node.id === COMMENT_REPLY_TREE_GUIDES_ID
          || Boolean(node.closest('.bewly-comment-missing-parent'))
          || Boolean(node.closest(`#${COMMENT_REPLY_TREE_GUIDES_ID}`)))
      )
      const hasExternalChildListMutation = mutations.some(({ target, addedNodes, removedNodes }) => {
        if (target instanceof Element && (target.id === COMMENT_REPLY_TREE_GUIDES_ID
          || target.closest('.bewly-comment-missing-parent')
          || target.closest(`#${COMMENT_REPLY_TREE_GUIDES_ID}`))) {
          return false
        }

        return [...Array.from(addedNodes), ...Array.from(removedNodes)]
          .some(node => !isTreeGuideNode(node))
      })
      if (hasExternalChildListMutation)
        scheduleCommentReplyTreeLayoutUpdate(component)
    })
    observer.observe(replyContainer, { childList: true })
    state.observedReplyContainer = replyContainer
    state.replyContainerMutationObserver = observer
  }

  // 每次更新都补一次图片监听，避免图片/嵌套 shadow 在首次更新后才挂载时漏监听。
  // 主评论/回复内图片异步解码完成也会改变高度。
  const imageRoot = threadHost ?? component
  if (imageRoot instanceof HTMLElement) {
    const abort = state.imageLoadAbort ?? new AbortController()
    state.imageLoadAbort = abort
    const imageLoadListeners = state.imageLoadListeners ?? new WeakSet<HTMLImageElement>()
    state.imageLoadListeners = imageLoadListeners
    const onImageLayout = () => scheduleCommentReplyTreeLayoutUpdate(component)
    const listenImages = (root: ParentNode) => {
      root.querySelectorAll('img').forEach((img) => {
        if (img.complete || imageLoadListeners.has(img))
          return
        imageLoadListeners.add(img)
        img.addEventListener('load', onImageLayout, { once: true, signal: abort.signal })
        img.addEventListener('error', onImageLayout, { once: true, signal: abort.signal })
      })
      root.querySelectorAll<HTMLElement>('*').forEach((element) => {
        if (element.shadowRoot)
          listenImages(element.shadowRoot)
      })
    }
    listenImages(imageRoot)
    if (imageRoot.shadowRoot)
      listenImages(imageRoot.shadowRoot)
  }
}

function getCommentReplyOriginalOrder(state: CommentReplyTreeState, renderer: HTMLElement): number {
  let originalOrder = state.originalOrderByRenderer.get(renderer)
  if (originalOrder === undefined) {
    originalOrder = state.nextOriginalOrder
    state.nextOriginalOrder += 1
    state.originalOrderByRenderer.set(renderer, originalOrder)
  }
  return originalOrder
}

function getCommentReplyCtime(replyItem: any): number | null {
  const ctime = replyItem?.ctime
  if (ctime === null || ctime === undefined || ctime === '')
    return null

  const numericCtime = Number(ctime)
  return Number.isFinite(numericCtime) ? numericCtime : null
}

function compareCommentReplyTreeNodes(a: CommentReplyTreeNode, b: CommentReplyTreeNode): number {
  if (a.ctime !== null && b.ctime !== null && a.ctime !== b.ctime)
    return a.ctime - b.ctime
  if (a.ctime !== null && b.ctime === null)
    return -1
  if (a.ctime === null && b.ctime !== null)
    return 1
  return a.originalOrder - b.originalOrder
}

function getCommentReplyIndent(depth: number): string {
  if (depth <= 0)
    return '0px'
  if (depth === 1)
    return COMMENT_REPLY_TREE_INDENT_STEP

  return `calc(${Array.from({ length: depth }).fill(COMMENT_REPLY_TREE_INDENT_STEP).join(' + ')})`
}

function getCommentReplyTreeIndentStep(
  replyContainer: HTMLElement,
  orderedNodes: Array<{ depth: number, node: CommentReplyTreeNode }>,
  maxDepthOverride?: number,
): number {
  const preferredIndentStep = replyContainer.clientWidth <= COMPACT_COMMENT_REPLY_TREE_CONTAINER_WIDTH
    ? COMPACT_COMMENT_REPLY_TREE_INDENT_STEP
    : DEFAULT_COMMENT_REPLY_TREE_INDENT_STEP
  const observedMaxDepth = orderedNodes.reduce((maximum, { depth }) => Math.max(maximum, depth), 0)
  const maxDepth = Math.max(observedMaxDepth, maxDepthOverride ?? 0)
  if (maxDepth <= 0)
    return preferredIndentStep

  const availableIndentWidth = Math.max(
    0,
    replyContainer.clientWidth - MIN_COMMENT_REPLY_TREE_CONTENT_WIDTH,
  )
  const fittedIndentStep = availableIndentWidth / maxDepth
  const minimumGuideIndentStep = orderedNodes.reduce((minimum, { node }) => {
    const avatar = node.renderer.shadowRoot?.querySelector<HTMLElement>('#user-avatar')
      ?? node.renderer.shadowRoot?.querySelector<HTMLElement>('bili-avatar')
    const avatarWidth = avatar?.getBoundingClientRect().width ?? 0
    const avatarRadius = avatarWidth > 0
      ? avatarWidth / 2
      : COMMENT_REPLY_TREE_FALLBACK_AVATAR_RADIUS
    return Math.max(minimum, avatarRadius + COMMENT_REPLY_TREE_MIN_GUIDE_GAP)
  }, COMMENT_REPLY_TREE_FALLBACK_AVATAR_RADIUS + COMMENT_REPLY_TREE_MIN_GUIDE_GAP)

  // 优先保留正文最小宽度；空间不足时也至少让子头像位于父头像中心右侧，
  // 否则深层节点会落在同一列，引导线会因没有水平分支空间而消失。
  return Math.max(minimumGuideIndentStep, Math.min(preferredIndentStep, fittedIndentStep))
}

function getCommentReplyAvatarAnchor(
  renderer: HTMLElement,
  containerRect: DOMRect,
): CommentReplyAvatarAnchor | null {
  const avatar = renderer.shadowRoot?.querySelector<HTMLElement>('#user-avatar')
    ?? renderer.shadowRoot?.querySelector<HTMLElement>('bili-avatar')
    ?? renderer.querySelector<HTMLElement>('.bewly-comment-missing-parent__avatar')
  const avatarRect = avatar?.getBoundingClientRect()
  const hasValidAvatar = Boolean(avatarRect && avatarRect.width > 0 && avatarRect.height > 0)

  // 折叠后主体 visibility:hidden + overflow:hidden，头像尺寸可能不可用，回退到渲染器自身矩形
  if (renderer.hasAttribute('data-bewly-comment-reply-collapsed')) {
    const rendererRect = renderer.getBoundingClientRect()
    const fallbackHeight = Number.parseFloat(
      getComputedStyle(renderer).getPropertyValue('--bew-space-6'),
    ) || 24
    const height = rendererRect.height > 0 ? rendererRect.height : fallbackHeight
    if (rendererRect.width <= 0 && height <= 0)
      return null

    const centerY = rendererRect.top + height / 2 - containerRect.top
    const centerX = hasValidAvatar
      ? avatarRect!.left + avatarRect!.width / 2 - containerRect.left
      : rendererRect.left + 20 - containerRect.left
    const left = hasValidAvatar
      ? avatarRect!.left - containerRect.left
      : centerX - 12

    return {
      bottom: centerY,
      centerX,
      centerY,
      left,
      toggleY: centerY,
    }
  }

  if (!hasValidAvatar || !avatarRect)
    return null

  const footer = renderer.shadowRoot?.querySelector<HTMLElement>('#footer')
  const footerRect = footer?.getBoundingClientRect()
  const avatarBottom = avatarRect.bottom - containerRect.top
  const footerCenterY = footerRect && footerRect.height > 0
    ? footerRect.top + footerRect.height / 2 - containerRect.top
    : avatarBottom

  return {
    bottom: avatarBottom,
    centerX: avatarRect.left + avatarRect.width / 2 - containerRect.left,
    centerY: avatarRect.top + avatarRect.height / 2 - containerRect.top,
    left: avatarRect.left - containerRect.left,
    toggleY: Math.max(avatarBottom, footerCenterY),
  }
}

function getCommentReplyTreeThreadRoot(component: HTMLElement): ShadowRoot | null {
  const rootNode = component.getRootNode()
  if (!(rootNode instanceof ShadowRoot) || rootNode.host.localName !== 'bili-comment-thread-renderer')
    return null

  return rootNode
}

function getCommentReplyTreeRootRenderer(component: HTMLElement): HTMLElement | null {
  const threadRoot = getCommentReplyTreeThreadRoot(component)
  if (!threadRoot)
    return null

  return threadRoot.querySelector<HTMLElement>('#comment')
    ?? threadRoot.querySelector<HTMLElement>('bili-comment-renderer')
}

function getCommentReplyTreeNodeKey(node: CommentReplyTreeNode): string {
  return node.rpid ? `reply:${node.rpid}` : `order:${node.originalOrder}`
}

/** 收起 parent 下 afterSibling 之后的全部同级评论 */
function getCommentReplyTailCollapseKey(parentKey: string, afterSiblingKey: string): string {
  return `tail:${parentKey}:after:${afterSiblingKey}`
}

function removeCommentReplyTreeGuides(
  component: HTMLElement,
  replyContainer: HTMLElement,
) {
  replyContainer.querySelector(`#${COMMENT_REPLY_TREE_GUIDES_ID}`)?.remove()
  getCommentReplyTreeThreadRoot(component)
    ?.querySelector(`#${COMMENT_REPLY_TREE_GUIDES_ID}`)
    ?.remove()
}

function collectCommentReplyTailHiddenRenderers(
  state: CommentReplyTreeState,
  parentKey: string,
  siblings: CommentReplyTreeNode[],
  hiddenRenderers: Set<HTMLElement>,
) {
  let hideRemaining = false
  siblings.forEach((sibling, index) => {
    if (hideRemaining) {
      const markSubtree = (node: CommentReplyTreeNode) => {
        hiddenRenderers.add(node.renderer)
        node.children.forEach(markSubtree)
      }
      markSubtree(sibling)
      return
    }

    if (index >= siblings.length - 1)
      return

    const tailKey = getCommentReplyTailCollapseKey(parentKey, getCommentReplyTreeNodeKey(sibling))
    if (state.collapsedTailKeys.has(tailKey))
      hideRemaining = true
  })
}

function updateCommentReplyTreeVisibility(
  component: HTMLElement,
  state: CommentReplyTreeState,
  orderedNodes: Array<{ depth: number, node: CommentReplyTreeNode }>,
  rootNodes: CommentReplyTreeNode[],
  collapseParentBody: boolean,
) {
  const hideDescendantsAtDepth: boolean[] = []
  const rootBranchCollapsed = state.collapsedNodeKeys.has(COMMENT_REPLY_TREE_ROOT_KEY)
  // 仅「收起主评论」模式才折叠父节点本体；「不收起主评论」只隐藏子回复
  getCommentReplyTreeRootRenderer(component)
    ?.toggleAttribute('data-bewly-comment-reply-collapsed', collapseParentBody && rootBranchCollapsed)

  const hiddenByTail = new Set<HTMLElement>()
  collectCommentReplyTailHiddenRenderers(state, COMMENT_REPLY_TREE_ROOT_KEY, rootNodes, hiddenByTail)
  orderedNodes.forEach(({ node }) => {
    if (node.children.length > 1)
      collectCommentReplyTailHiddenRenderers(state, getCommentReplyTreeNodeKey(node), node.children, hiddenByTail)
  })

  orderedNodes.forEach(({ depth, node }) => {
    const hiddenByAncestor = depth === 0
      ? rootBranchCollapsed
      : hideDescendantsAtDepth[depth - 1] === true
    const hidden = hiddenByAncestor || hiddenByTail.has(node.renderer)
    const branchCollapsed = state.collapsedNodeKeys.has(getCommentReplyTreeNodeKey(node))
    const collapsedBody = !hidden && collapseParentBody && branchCollapsed
    node.renderer.toggleAttribute('data-bewly-comment-reply-hidden', hidden)
    node.renderer.toggleAttribute('data-bewly-comment-reply-collapsed', collapsedBody)
    // 任一模式下父分支收起都隐藏子树；父本体是否折叠由 collapseParentBody 决定
    hideDescendantsAtDepth[depth] = hidden || branchCollapsed
    hideDescendantsAtDepth.length = depth + 1
  })
}

function toggleCommentReplyTreeBranch(
  component: HTMLElement,
  state: CommentReplyTreeState,
  branchKey: string,
) {
  if (state.collapsedNodeKeys.has(branchKey)) {
    state.collapsedNodeKeys.delete(branchKey)
  }
  else {
    invalidateCommentReplyPaginationLoading(component)
    state.collapsedNodeKeys.add(branchKey)
  }
  updateCommentReplyTree(component)
}

function toggleCommentReplyTreeTail(
  component: HTMLElement,
  state: CommentReplyTreeState,
  tailKey: string,
) {
  if (state.collapsedTailKeys.has(tailKey)) {
    state.collapsedTailKeys.delete(tailKey)
  }
  else {
    invalidateCommentReplyPaginationLoading(component)
    state.collapsedTailKeys.add(tailKey)
  }
  updateCommentReplyTree(component)
}

function createCommentReplyTreeTailElement(
  component: HTMLElement,
  state: CommentReplyTreeState,
  tail: CommentReplyTreeTailCollapse,
  toggleHitRadius: number,
  toggleNodeRadius: number,
): SVGGElement {
  const coordinate = formatCommentReplyGuideCoordinate
  const symbolHalfSize = toggleNodeRadius / 2
  const tailGroup = document.createElementNS(SVG_NAMESPACE, 'g')
  tailGroup.classList.add('bewly-comment-reply-tail')
  tailGroup.setAttribute('role', 'button')
  tailGroup.setAttribute('tabindex', '0')
  tailGroup.setAttribute('aria-expanded', String(!tail.collapsed))
  tailGroup.setAttribute('aria-label', getCommentReplyTailLabel(tail.collapsed))

  const nodeHitArea = document.createElementNS(SVG_NAMESPACE, 'circle')
  nodeHitArea.classList.add('bewly-comment-reply-tail__node-hit')
  nodeHitArea.setAttribute('cx', coordinate(tail.x))
  nodeHitArea.setAttribute('cy', coordinate(tail.y))
  nodeHitArea.setAttribute('r', coordinate(toggleHitRadius))
  tailGroup.appendChild(nodeHitArea)

  const focusRing = document.createElementNS(SVG_NAMESPACE, 'circle')
  focusRing.classList.add('bewly-comment-reply-tail__focus')
  focusRing.setAttribute('cx', coordinate(tail.x))
  focusRing.setAttribute('cy', coordinate(tail.y))
  focusRing.setAttribute('r', coordinate(toggleHitRadius - 2))
  tailGroup.appendChild(focusRing)

  const toggleNode = document.createElementNS(SVG_NAMESPACE, 'circle')
  toggleNode.classList.add('bewly-comment-reply-tail__node')
  toggleNode.setAttribute('cx', coordinate(tail.x))
  toggleNode.setAttribute('cy', coordinate(tail.y))
  toggleNode.setAttribute('r', coordinate(toggleNodeRadius))
  tailGroup.appendChild(toggleNode)

  const toggleSymbol = document.createElementNS(SVG_NAMESPACE, 'path')
  toggleSymbol.classList.add('bewly-comment-reply-tail__symbol')
  const horizontalSymbol = `M ${coordinate(tail.x - symbolHalfSize)} ${coordinate(tail.y)} H ${coordinate(tail.x + symbolHalfSize)}`
  const verticalSymbol = `M ${coordinate(tail.x)} ${coordinate(tail.y - symbolHalfSize)} V ${coordinate(tail.y + symbolHalfSize)}`
  toggleSymbol.setAttribute('d', tail.collapsed ? `${horizontalSymbol} ${verticalSymbol}` : horizontalSymbol)
  tailGroup.appendChild(toggleSymbol)

  const toggleTail = () => toggleCommentReplyTreeTail(component, state, tail.key)
  tailGroup.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    toggleTail()
  })
  tailGroup.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ')
      return
    event.preventDefault()
    event.stopPropagation()
    toggleTail()
  })

  return tailGroup
}

function buildCommentReplyTreeTailCollapses(
  state: CommentReplyTreeState,
  parentKey: string,
  parentAnchor: CommentReplyAvatarAnchor,
  siblings: CommentReplyTreeNode[],
  avatarAnchorByNode: Map<CommentReplyTreeNode, CommentReplyAvatarAnchor>,
  toggleHitRadius: number,
): CommentReplyTreeTailCollapse[] {
  if (siblings.length < 2)
    return []

  let firstHiddenIndex = siblings.length
  for (let index = 0; index < siblings.length - 1; index += 1) {
    const tailKey = getCommentReplyTailCollapseKey(parentKey, getCommentReplyTreeNodeKey(siblings[index]))
    if (state.collapsedTailKeys.has(tailKey)) {
      firstHiddenIndex = index + 1
      break
    }
  }

  const tails: CommentReplyTreeTailCollapse[] = []

  // 已收起后续：+ 使用展开时缓存的位置，避免随布局上缩后断线
  if (firstHiddenIndex < siblings.length) {
    const afterSibling = siblings[firstHiddenIndex - 1]
    const afterAnchor = avatarAnchorByNode.get(afterSibling)
    if (afterAnchor) {
      const key = getCommentReplyTailCollapseKey(parentKey, getCommentReplyTreeNodeKey(afterSibling))
      const cachedOffset = state.tailToggleOffsetByKey.get(key)
      const cachedY = cachedOffset === undefined
        ? undefined
        : parentAnchor.centerY + cachedOffset
      const fallbackY = afterAnchor.bottom + toggleHitRadius + 4
      // 缓存优先；至少略低于最后可见评论中心，保证仍落在主干上
      const y = cachedY !== undefined
        ? Math.max(afterAnchor.centerY + toggleHitRadius, cachedY)
        : fallbackY
      tails.push({
        collapsed: true,
        hiddenCount: siblings.length - firstHiddenIndex,
        key,
        x: parentAnchor.centerX,
        y,
      })
    }
    return tails
  }

  // 未收起：在相邻平级评论之间放置收起后续控件，并缓存位置
  for (let index = 0; index < siblings.length - 1; index += 1) {
    const current = siblings[index]
    const next = siblings[index + 1]
    const currentAnchor = avatarAnchorByNode.get(current)
    const nextAnchor = avatarAnchorByNode.get(next)
    if (!currentAnchor || !nextAnchor)
      continue

    const gap = nextAnchor.centerY - currentAnchor.centerY
    if (gap < toggleHitRadius * 2)
      continue

    const key = getCommentReplyTailCollapseKey(parentKey, getCommentReplyTreeNodeKey(current))
    const y = currentAnchor.centerY + gap / 2
    state.tailToggleOffsetByKey.set(key, y - parentAnchor.centerY)
    tails.push({
      collapsed: false,
      hiddenCount: siblings.length - index - 1,
      key,
      x: parentAnchor.centerX,
      y,
    })
  }

  return tails
}

function createCommentReplyTreeBranchElement(
  component: HTMLElement,
  state: CommentReplyTreeState,
  branch: CommentReplyTreeBranch,
  pathData: string,
  toggleHitRadius: number,
  toggleNodeRadius: number,
  toggleY: number,
): SVGGElement {
  const coordinate = formatCommentReplyGuideCoordinate
  const symbolHalfSize = toggleNodeRadius / 2
  const branchGroup = document.createElementNS(SVG_NAMESPACE, 'g')
  branchGroup.classList.add('bewly-comment-reply-branch')
  branchGroup.setAttribute('role', 'button')
  branchGroup.setAttribute('tabindex', '0')
  branchGroup.setAttribute('aria-expanded', String(!branch.collapsed))
  branchGroup.setAttribute('aria-label', getCommentReplyBranchLabel(branch.collapsed))

  const visiblePath = document.createElementNS(SVG_NAMESPACE, 'path')
  visiblePath.classList.add('bewly-comment-reply-branch__line')
  visiblePath.setAttribute('d', pathData)
  branchGroup.appendChild(visiblePath)

  const hitPath = document.createElementNS(SVG_NAMESPACE, 'path')
  hitPath.classList.add('bewly-comment-reply-branch__hit')
  hitPath.setAttribute('d', pathData)
  branchGroup.appendChild(hitPath)

  const nodeHitArea = document.createElementNS(SVG_NAMESPACE, 'circle')
  nodeHitArea.classList.add('bewly-comment-reply-branch__node-hit')
  nodeHitArea.setAttribute('cx', coordinate(branch.parentAnchor.centerX))
  nodeHitArea.setAttribute('cy', coordinate(toggleY))
  nodeHitArea.setAttribute('r', coordinate(toggleHitRadius))
  branchGroup.appendChild(nodeHitArea)

  const focusRing = document.createElementNS(SVG_NAMESPACE, 'circle')
  focusRing.classList.add('bewly-comment-reply-branch__focus')
  focusRing.setAttribute('cx', coordinate(branch.parentAnchor.centerX))
  focusRing.setAttribute('cy', coordinate(toggleY))
  focusRing.setAttribute('r', coordinate(toggleHitRadius - 2))
  branchGroup.appendChild(focusRing)

  const toggleNode = document.createElementNS(SVG_NAMESPACE, 'circle')
  toggleNode.classList.add('bewly-comment-reply-branch__node')
  toggleNode.setAttribute('cx', coordinate(branch.parentAnchor.centerX))
  toggleNode.setAttribute('cy', coordinate(toggleY))
  toggleNode.setAttribute('r', coordinate(toggleNodeRadius))
  branchGroup.appendChild(toggleNode)

  const toggleSymbol = document.createElementNS(SVG_NAMESPACE, 'path')
  toggleSymbol.classList.add('bewly-comment-reply-branch__symbol')
  const horizontalSymbol = `M ${coordinate(branch.parentAnchor.centerX - symbolHalfSize)} ${coordinate(toggleY)} H ${coordinate(branch.parentAnchor.centerX + symbolHalfSize)}`
  const verticalSymbol = `M ${coordinate(branch.parentAnchor.centerX)} ${coordinate(toggleY - symbolHalfSize)} V ${coordinate(toggleY + symbolHalfSize)}`
  toggleSymbol.setAttribute('d', branch.collapsed ? `${horizontalSymbol} ${verticalSymbol}` : horizontalSymbol)
  branchGroup.appendChild(toggleSymbol)

  // 仅「收起主评论」且父节点本体被折叠时显示昵称；「不收起主评论」父正文仍在，无需昵称
  if (branch.collapsed && branch.collapseParentBody) {
    const authorLabel = document.createElementNS(SVG_NAMESPACE, 'text')
    authorLabel.classList.add('bewly-comment-reply-branch__author')
    authorLabel.setAttribute('x', coordinate(branch.parentAnchor.centerX + toggleHitRadius + 4))
    authorLabel.setAttribute('y', coordinate(toggleY))
    authorLabel.setAttribute('dominant-baseline', 'middle')
    authorLabel.textContent = branch.parentAuthorName || '…'
    branchGroup.appendChild(authorLabel)
  }

  const toggleBranch = () => toggleCommentReplyTreeBranch(component, state, branch.key)
  branchGroup.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    toggleBranch()
  })
  branchGroup.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ')
      return
    event.preventDefault()
    event.stopPropagation()
    toggleBranch()
  })

  return branchGroup
}

function isCommentReplyTreeNodeVisible(node: CommentReplyTreeNode): boolean {
  return !node.renderer.hasAttribute('data-bewly-comment-reply-hidden')
}

function renderCommentReplyTreeGuides(
  component: HTMLElement,
  state: CommentReplyTreeState,
  replyContainer: HTMLElement,
  orderedNodes: Array<{ depth: number, node: CommentReplyTreeNode }>,
  rootNodes: CommentReplyTreeNode[],
  collapseParentBody: boolean,
) {
  const threadRoot = getCommentReplyTreeThreadRoot(component)
  const guideContainer: HTMLElement | ShadowRoot = threadRoot ?? replyContainer
  const coordinateRect = threadRoot
    ? threadRoot.host.getBoundingClientRect()
    : replyContainer.getBoundingClientRect()
  // 布局未就绪（宽度为 0 或高度异常小）时不画线，避免未展开/图片未加载时的错位
  if (coordinateRect.width <= 0 || coordinateRect.height <= 0)
    return

  if (threadRoot) {
    const threadStylePatch = COMMENT_SHADOW_STYLE_PATCHES['bili-comment-thread-renderer']
    ensureCommentShadowStyle(threadRoot, threadStylePatch.id, threadStylePatch.css)
  }

  const nodes = orderedNodes.map(({ node }) => node)
  const avatarAnchorByNode = new Map<CommentReplyTreeNode, CommentReplyAvatarAnchor>()
  let missingVisibleAvatar = false
  nodes.forEach((node) => {
    if (!isCommentReplyTreeNodeVisible(node))
      return
    const anchor = getCommentReplyAvatarAnchor(node.renderer, coordinateRect)
    if (anchor) {
      avatarAnchorByNode.set(node, anchor)
      return
    }
    // 可见节点却拿不到锚点：多半是删除/屏蔽后的过渡节点或尚未完成布局。
    // 跳过该节点继续绘制其余分支，避免单个异常节点清空整棵树。
    missingVisibleAvatar = true
  })
  const retryLayout = () => {
    const retries = state.layoutRetryCount ?? 0
    if (retries >= 12)
      return
    state.layoutRetryCount = retries + 1
    scheduleCommentReplyTreeLayoutUpdate(component)
  }

  // 主评论锚点同样需要有效，否则根分支线会整体错位
  if (threadRoot) {
    const mainRenderer = getCommentReplyTreeRootRenderer(component)
    if (mainRenderer && !getCommentReplyAvatarAnchor(mainRenderer, coordinateRect)) {
      retryLayout()
      return
    }
  }

  if (!missingVisibleAvatar)
    state.layoutRetryCount = 0

  const componentStyle = getComputedStyle(component)
  const branchRadius = Number.parseFloat(
    componentStyle.getPropertyValue('--bew-comment-reply-branch-radius'),
  ) || 12
  const toggleHitRadius = Number.parseFloat(componentStyle.getPropertyValue('--bew-space-3')) || 12
  const toggleNodeRadius = Number.parseFloat(componentStyle.getPropertyValue('--bew-radius-half')) || 6
  const branches: CommentReplyTreeBranch[] = []
  const tails: CommentReplyTreeTailCollapse[] = []

  const visibleRootNodes = rootNodes.filter(isCommentReplyTreeNodeVisible)
  const threadRootRenderer = getCommentReplyTreeRootRenderer(component)
  const rootBranchCollapsed = state.collapsedNodeKeys.has(COMMENT_REPLY_TREE_ROOT_KEY)
  const threadRootAnchor = threadRootRenderer
    ? getCommentReplyAvatarAnchor(threadRootRenderer, coordinateRect)
    : null
  // 分支收起后即使子回复全隐藏，也保留控件以便展开
  if (threadRootAnchor && (rootNodes.length > 0 || rootBranchCollapsed)) {
    let rootTrunkExtendY: number | undefined
    // 父分支未收起时，才在同级回复间提供「收起后续」
    if (!rootBranchCollapsed) {
      const rootTails = buildCommentReplyTreeTailCollapses(
        state,
        COMMENT_REPLY_TREE_ROOT_KEY,
        threadRootAnchor,
        rootNodes,
        avatarAnchorByNode,
        toggleHitRadius,
      )
      tails.push(...rootTails)
      rootTrunkExtendY = rootTails.find(tail => tail.collapsed)?.y
    }

    branches.push({
      childAnchors: visibleRootNodes
        .map(node => avatarAnchorByNode.get(node))
        .filter((anchor): anchor is CommentReplyAvatarAnchor => Boolean(anchor))
        .filter(anchor => anchor.left > threadRootAnchor.centerX),
      collapsed: rootBranchCollapsed,
      collapseParentBody,
      key: COMMENT_REPLY_TREE_ROOT_KEY,
      parentAnchor: threadRootAnchor,
      parentAuthorName: getCommentRendererAuthorName(threadRootRenderer),
      trunkExtendY: rootTrunkExtendY,
    })
  }

  nodes.forEach((node) => {
    if (!isCommentReplyTreeNodeVisible(node))
      return

    let parentAnchor = avatarAnchorByNode.get(node)
    if (!parentAnchor) {
      // 折叠后可能首次未写入 map，再解析一次锚点
      const resolvedAnchor = getCommentReplyAvatarAnchor(node.renderer, coordinateRect)
      if (resolvedAnchor) {
        parentAnchor = resolvedAnchor
        avatarAnchorByNode.set(node, resolvedAnchor)
      }
    }
    if (!parentAnchor || node.children.length === 0)
      return

    const nodeBranchCollapsed = state.collapsedNodeKeys.has(getCommentReplyTreeNodeKey(node))
    const visibleChildren = node.children.filter(isCommentReplyTreeNodeVisible)

    let nodeTrunkExtendY: number | undefined
    if (!nodeBranchCollapsed && node.children.length > 1) {
      const nodeTails = buildCommentReplyTreeTailCollapses(
        state,
        getCommentReplyTreeNodeKey(node),
        parentAnchor,
        node.children,
        avatarAnchorByNode,
        toggleHitRadius,
      )
      tails.push(...nodeTails)
      nodeTrunkExtendY = nodeTails.find(tail => tail.collapsed)?.y
    }

    branches.push({
      childAnchors: visibleChildren
        .map(child => avatarAnchorByNode.get(child))
        .filter((anchor): anchor is CommentReplyAvatarAnchor => Boolean(anchor))
        .filter(anchor => anchor.left > parentAnchor.centerX),
      collapsed: nodeBranchCollapsed,
      collapseParentBody,
      key: getCommentReplyTreeNodeKey(node),
      parentAnchor,
      parentAuthorName: node.authorName ?? getCommentRendererAuthorName(node.renderer),
      trunkExtendY: nodeTrunkExtendY,
    })
  })

  const renderedBranches = branches
    .map((branch) => {
      // 展开且无平级收起时刷新父分支 + 缓存；
      // 平级收起后子节点变少，勿覆盖缓存，否则父级 − 也会上缩
      if (!branch.collapsed && branch.trunkExtendY === undefined) {
        const expandedToggleY = getCommentReplyBranchExpandedToggleY(
          branch.parentAnchor,
          branch.childAnchors,
          toggleHitRadius,
        )
        state.branchToggleOffsetByKey.set(
          branch.key,
          expandedToggleY - branch.parentAnchor.bottom,
        )
      }

      const cachedToggleOffset = state.branchToggleOffsetByKey.get(branch.key)
      const cachedToggleY = cachedToggleOffset === undefined
        ? undefined
        : branch.parentAnchor.bottom + cachedToggleOffset
      const pathData = getCommentReplyBranchPath(
        branch,
        branchRadius,
        toggleHitRadius,
        cachedToggleY,
      )
      if (!pathData)
        return null

      const toggleY = getCommentReplyBranchToggleY(branch, toggleHitRadius, cachedToggleY)
      return { branch, pathData, toggleY }
    })
    .filter((entry): entry is {
      branch: CommentReplyTreeBranch
      pathData: string
      toggleY: number
    } => Boolean(entry))
  if (renderedBranches.length === 0 && tails.length === 0) {
    if (missingVisibleAvatar) {
      // 新布局尚未具备足够锚点时保留上一帧，避免先清空线条再等待重试。
      retryLayout()
      return
    }
    // 布局有效但已经没有可绘制分支（例如最后一条回复被删除），清理旧线条。
    removeCommentReplyTreeGuides(component, replyContainer)
    return
  }

  const minimumX = Math.min(
    0,
    ...renderedBranches.map(({ branch }) => branch.parentAnchor.centerX - toggleHitRadius),
    ...tails.map(tail => tail.x - toggleHitRadius),
  )
  const minimumY = Math.min(
    0,
    ...renderedBranches.map(({ branch, toggleY }) => Math.min(
      branch.parentAnchor.bottom,
      toggleY - toggleHitRadius,
    )),
    ...tails.map(tail => tail.y - toggleHitRadius),
  )
  const maximumY = Math.max(
    coordinateRect.height,
    ...renderedBranches.flatMap(({ branch, toggleY }) => [
      branch.parentAnchor.centerY,
      branch.parentAnchor.bottom + toggleHitRadius * 2,
      toggleY + toggleHitRadius,
      ...branch.childAnchors.map(anchor => anchor.centerY),
    ]),
    ...tails.map(tail => tail.y + toggleHitRadius),
  )
  const layerWidth = Math.max(1, coordinateRect.width - minimumX)
  const layerHeight = Math.max(1, maximumY - minimumY)
  const guideLayer = document.createElementNS(SVG_NAMESPACE, 'svg')
  guideLayer.id = COMMENT_REPLY_TREE_GUIDES_ID
  guideLayer.classList.add('bewly-comment-reply-tree-guides')
  guideLayer.setAttribute('focusable', 'false')
  guideLayer.setAttribute('viewBox', `${minimumX} ${minimumY} ${layerWidth} ${layerHeight}`)
  guideLayer.setAttribute('preserveAspectRatio', 'none')
  guideLayer.style.left = `${minimumX}px`
  guideLayer.style.top = `${minimumY}px`
  guideLayer.style.right = 'auto'
  guideLayer.style.bottom = 'auto'
  guideLayer.style.width = `${layerWidth}px`
  guideLayer.style.height = `${layerHeight}px`

  renderedBranches.forEach(({ branch, pathData, toggleY }) => {
    guideLayer.appendChild(createCommentReplyTreeBranchElement(
      component,
      state,
      branch,
      pathData,
      toggleHitRadius,
      toggleNodeRadius,
      toggleY,
    ))
  })
  tails.forEach((tail) => {
    guideLayer.appendChild(createCommentReplyTreeTailElement(
      component,
      state,
      tail,
      toggleHitRadius,
      toggleNodeRadius,
    ))
  })
  // 只有新图层已完整创建后才替换旧图层；中途布局失败时旧线条仍可保留。
  removeCommentReplyTreeGuides(component, replyContainer)
  guideContainer.appendChild(guideLayer)
  if (missingVisibleAvatar)
    retryLayout()
}

/**
 * 给回复设置视觉顺序，但保留 B 站 Lit repeat 产生的 DOM 顺序。
 *
 * `bili-comment-replies-renderer` 的列表由 keyed repeat 渲染。回复 host
 * 两侧的注释节点是 repeat 的边界；以前通过 insertBefore 移动 host 会把
 * host 与边界拆开，下一次列表更新时 Lit 会把旧节点再插入一次。用 flex
 * item 的 order 只改变视觉位置，不触碰这些边界，因此分页/更新都不会
 * 生成重复评论。
 */
function setCommentReplyRendererOrder(
  currentRenderers: HTMLElement[],
  orderedRenderers: HTMLElement[],
) {
  const orderByRenderer = new Map(
    orderedRenderers.map((renderer, index) => [renderer, index] as const),
  )
  currentRenderers.forEach((renderer) => {
    const order = orderByRenderer.get(renderer)
    if (order === undefined)
      renderer.style.removeProperty('--bew-comment-reply-order')
    else
      renderer.style.setProperty('--bew-comment-reply-order', String(order))
  })
}

function getCommentReplyTreeLayoutKey(replyRenderers: HTMLElement[]): string {
  return replyRenderers.map((renderer, index) => {
    const rpid = getReplyRpid(getCommentReplyData(renderer))
    return rpid ? `r:${rpid}` : `i:${index}`
  }).join('|')
}

/** 缺失父评也占据真实树节点；相同父 ID 共用占位，加载到原评论后移除。 */
function addMissingCommentReplyTreeParents(
  nodes: CommentReplyTreeNode[],
  metaByRpid: Map<string, CommentReplyTreeCachedMeta>,
  replyContainer: HTMLElement,
) {
  const nodeByRpid = new Map(nodes.filter(node => node.rpid).map(node => [node.rpid!, node]))
  const existing = new Map(Array.from(
    replyContainer.querySelectorAll<HTMLElement>('.bewly-comment-missing-parent'),
  ).map(renderer => [renderer.dataset.parentRpid!, renderer]))
  const retained = new Set<string>()
  // 新增的占位也继续补齐已知父链；ID 去重同时阻止循环缓存无限扩展。
  for (let index = 0; index < nodes.length; index++) {
    const child = nodes[index]
    const rpid = child.parentRpid
    if (isCommentReplyTreeRootParent(rpid, child.rootRpid, child.rpid) || !rpid || nodeByRpid.has(rpid))
      continue

    const meta = metaByRpid.get(rpid)
    const authorName = meta?.authorName ?? getReplyAtAuthorFromMessage(getCommentReplyData(child.renderer))
    let renderer = existing.get(rpid)
    if (!renderer) {
      renderer = document.createElement('div')
      renderer.className = 'bewly-comment-missing-parent'
      renderer.dataset.parentRpid = rpid
      const body = document.createElement('div')
      body.className = 'bewly-comment-missing-parent__body'
      const avatar = document.createElement('span')
      avatar.className = 'bewly-comment-missing-parent__avatar'
      avatar.textContent = '?'
      avatar.setAttribute('aria-hidden', 'true')
      const text = document.createElement('span')
      text.className = 'bewly-comment-missing-parent__text'
      body.append(avatar, text)
      renderer.append(body)
    }
    const text = renderer.querySelector<HTMLElement>('.bewly-comment-missing-parent__text')!
    const content = `${authorName ? `@${authorName} · ` : ''}${MISSING_PARENT_LABEL}${meta?.messageText ? `：${truncateReplyMessageSnippet(meta.messageText)}` : ''}`
    if (text.textContent !== content)
      text.textContent = content
    if (renderer.parentElement !== replyContainer)
      replyContainer.append(renderer)
    retained.add(rpid)
    const parent: CommentReplyTreeNode = {
      authorName,
      renderer,
      rpid,
      parentRpid: meta?.parentRpid ?? null,
      rootRpid: meta?.rootRpid ?? child.rootRpid,
      ctime: meta?.ctime ?? child.ctime,
      originalOrder: child.originalOrder,
      children: [],
      directParentVisible: true,
      directParentAuthorName: null,
      directParentMessageText: null,
    }
    nodeByRpid.set(rpid, parent)
    nodes.push(parent)
  }
  existing.forEach((renderer, rpid) => {
    if (!retained.has(rpid))
      renderer.remove()
  })
}

function buildCommentReplyTreeOrder(
  nodes: CommentReplyTreeNode[],
  metaByRpid: Map<string, CommentReplyTreeCachedMeta> = new Map(),
): Array<{
  depth: number
  node: CommentReplyTreeNode
}> {
  const nodeByRpid = new Map<string, CommentReplyTreeNode>()
  nodes.forEach((node) => {
    if (node.rpid && !nodeByRpid.has(node.rpid))
      nodeByRpid.set(node.rpid, node)
  })

  const rootNodes: CommentReplyTreeNode[] = []
  nodes.forEach((node) => {
    // 当前页没有直接父节点时，沿缓存的 parent 链挂到最近可见祖先
    const resolved = resolveCommentReplyTreeParentNode(node, nodeByRpid, metaByRpid)
    node.directParentVisible = resolved.directParentVisible
    node.directParentAuthorName = resolved.directParentAuthorName
    node.directParentMessageText = resolved.directParentMessageText
    // 父评昵称未缓存时，从子评正文「回复 @xxx」回退
    if (!node.directParentAuthorName && node.parentRpid && !node.directParentVisible) {
      const replyItem = getCommentReplyData(node.renderer)
      node.directParentAuthorName = getReplyAtAuthorFromMessage(replyItem)
    }
    if (resolved.visualParent)
      resolved.visualParent.children.push(node)
    else
      rootNodes.push(node)
  })

  rootNodes.sort(compareCommentReplyTreeNodes)
  nodes.forEach(node => node.children.sort(compareCommentReplyTreeNodes))

  // Keep every branch contiguous: parent first, then its time-ordered children.
  const orderedNodes: Array<{ depth: number, node: CommentReplyTreeNode }> = []
  const visitedRenderers = new Set<HTMLElement>()
  const visitNode = (node: CommentReplyTreeNode, depth: number) => {
    if (visitedRenderers.has(node.renderer))
      return

    visitedRenderers.add(node.renderer)
    orderedNodes.push({ node, depth: Math.min(depth, MAX_COMMENT_REPLY_TREE_DEPTH) })
    node.children.forEach(child => visitNode(child, depth + 1))
  }

  rootNodes.forEach(node => visitNode(node, 0))
  nodes
    .filter(node => !visitedRenderers.has(node.renderer))
    .sort(compareCommentReplyTreeNodes)
    .forEach(node => visitNode(node, 0))

  return orderedNodes
}

export function updateCommentReplyTree(component: any) {
  const root = component?.shadowRoot as ShadowRoot | null | undefined
  if (!root)
    return

  commentRepliesRenderers.add(component)
  const treeMode = getCommentReplyTreeMode()
  const paginationEnabled = isCommentReplyLoadMoreEnabled()
  if (commentReplyPaginationModeStates.get(component) !== paginationEnabled) {
    commentReplyPaginationModeStates.set(component, paginationEnabled)
    component.requestUpdate?.()
  }
  if (!paginationEnabled) {
    clearCommentReplyPaginationState(component, true)
    restoreCommentReplyPaginationHead(component)
  }
  const existingState = commentReplyTreeStates.get(component)
  const paginationState = commentReplyPaginationStates.get(component)
  if (treeMode === null && !existingState?.enabled) {
    component.removeAttribute('data-bewly-comment-reply-tree')
    return
  }

  const replyContainer = root.querySelector<HTMLElement>('#expander-contents')
  if (!replyContainer)
    return

  // 在原生「点击查看」旁补充快捷入口；进入分页后改由 paginationItems
  // 提供同一个动作项。控件只在登录且「更多」模式下显示。
  updateCommentReplyExpandAllControl(component)

  const replyRenderers = Array.from(replyContainer.children)
    .filter(isCommentReplyRenderer)
  const state = existingState ?? getCommentReplyTreeState(component)
  replyRenderers.forEach(renderer => getCommentReplyOriginalOrder(state, renderer))

  // 批量加载时，回复节点本身会先后经历 data、用户信息、IP 标签等多次
  // 更新。节点集合没有变化时无需反复重画整棵树；等新页挂载或批量结束
  // 后再统一计算，避免现有评论随每个 IP 标签的到达而来回缩进。
  const expandAllLoading = Boolean(paginationState?.expandAllLoading)
  const layoutKey = expandAllLoading
    ? getCommentReplyTreeLayoutKey(replyRenderers)
    : ''
  if (treeMode !== null
    && expandAllLoading
    && state.enabled
    && paginationState?.expandAllLayoutKey === layoutKey) {
    updateCommentReplyExpandAllControl(component)
    return
  }
  if (paginationState)
    paginationState.expandAllLayoutKey = expandAllLoading ? layoutKey : undefined

  const enabled = treeMode !== null
  const showGuides = treeMode === 'lineCollapseMain' || treeMode === 'lineKeepMain'
  // true：收起时折叠所有父节点本体；false：收起时父节点保持显示，仅隐藏子回复
  const collapseParentBody = treeMode === 'lineCollapseMain'
  component.toggleAttribute('data-bewly-comment-reply-tree', enabled)

  if (!enabled) {
    disconnectCommentReplyTreeResizeObserver(state)
    component.style.removeProperty('--bew-comment-reply-indent-step')
    removeCommentReplyTreeGuides(component, replyContainer)
    replyContainer.querySelectorAll('.bewly-comment-missing-parent').forEach(node => node.remove())
    state.collapsedNodeKeys.clear()
    state.collapsedTailKeys.clear()
    state.branchToggleOffsetByKey.clear()
    state.tailToggleOffsetByKey.clear()
    if (state.enabled) {
      const originalOrder = [...replyRenderers].sort((a, b) => (
        getCommentReplyOriginalOrder(state, a) - getCommentReplyOriginalOrder(state, b)
      ))
      setCommentReplyRendererOrder(replyRenderers, originalOrder)
    }

    replyRenderers.forEach((replyRenderer) => {
      delete replyRenderer.dataset.bewlyCommentReplyDepth
      delete replyRenderer.dataset.bewlyCommentReplyHidden
      delete replyRenderer.dataset.bewlyCommentReplyCollapsed
      replyRenderer.style.removeProperty('--bew-comment-reply-indent')
      replyRenderer.style.removeProperty('--bew-comment-reply-order')
      setCommentReplyAtPrefixHidden(replyRenderer, false)
      clearCommentReplyOffpageParentLabel(replyRenderer)
    })
    delete getCommentReplyTreeRootRenderer(component)?.dataset.bewlyCommentReplyCollapsed
    state.enabled = false
    return
  }

  // 仅缩进模式关闭全部折叠
  if (!showGuides) {
    state.collapsedNodeKeys.clear()
    state.collapsedTailKeys.clear()
    state.branchToggleOffsetByKey.clear()
    state.tailToggleOffsetByKey.clear()
  }

  observeCommentReplyTreeLayout(component, state, replyContainer)

  const nodes: CommentReplyTreeNode[] = replyRenderers.map((replyRenderer) => {
    const replyItem = getCommentReplyData(replyRenderer)
    // 同步 data + DOM 正文进缓存，翻页后仍可引用父评摘要
    const fromDomMessage = getCommentRendererMessageText(replyRenderer)
    const cachedMeta = cacheCommentReplyTreeMeta(state, replyItem, { messageText: fromDomMessage })
    const rpid = getReplyRpid(replyItem) ?? null
    // 当前页 data 偶发缺字段时回退到跨页缓存
    const parentRpid = getReplyParentRpid(replyItem) ?? cachedMeta?.parentRpid ?? null
    const rootRpid = getReplyRootRpid(replyItem) ?? cachedMeta?.rootRpid ?? null
    return {
      authorName: getReplyAuthorName(replyItem) ?? cachedMeta?.authorName ?? null,
      renderer: replyRenderer,
      rpid,
      parentRpid: isCommentReplyTreeRootParent(parentRpid, rootRpid, rpid) ? null : parentRpid,
      rootRpid,
      ctime: getCommentReplyCtime(replyItem) ?? cachedMeta?.ctime ?? null,
      originalOrder: getCommentReplyOriginalOrder(state, replyRenderer),
      children: [],
      directParentVisible: true,
      directParentAuthorName: null,
      directParentMessageText: null,
    }
  })

  addMissingCommentReplyTreeParents(nodes, state.replyMetaByRpid, replyContainer)
  const orderedNodes = buildCommentReplyTreeOrder(nodes, state.replyMetaByRpid)
  const rootNodes = orderedNodes
    .filter(({ depth }) => depth === 0)
    .map(({ node }) => node)
  if (expandAllLoading && paginationState && paginationState.frozenTreeIndentStep === undefined) {
    // 按最大支持深度预留空间，保证后续页出现更深层回复时也不需要
    // 重新缩放已有节点；批量结束后再恢复正常的自适应计算。
    paginationState.frozenTreeIndentStep = getCommentReplyTreeIndentStep(
      replyContainer,
      orderedNodes,
      MAX_COMMENT_REPLY_TREE_DEPTH,
    )
  }
  const indentStep = expandAllLoading && paginationState?.frozenTreeIndentStep !== undefined
    ? paginationState.frozenTreeIndentStep
    : getCommentReplyTreeIndentStep(replyContainer, orderedNodes)
  component.style.setProperty('--bew-comment-reply-indent-step', `${indentStep}px`)
  orderedNodes.forEach(({ depth, node }) => {
    node.renderer.dataset.bewlyCommentReplyDepth = String(depth)
    node.renderer.style.setProperty('--bew-comment-reply-indent', getCommentReplyIndent(depth))
  })
  updateCommentReplyTreeVisibility(component, state, orderedNodes, rootNodes, collapseParentBody)
  setCommentReplyRendererOrder(
    nodes.map(node => node.renderer),
    orderedNodes.map(({ node }) => node.renderer),
  )
  // 父节点展示：
  // - 直接父在本页：引导线/缩进表达层级；线条模式隐藏正文「回复 @xxx」
  // - 直接父不在本页且有正文缓存：引用卡展示原正文
  // - 直接父不在本页无正文但有 parent rpid：紧凑「回复 @… + 不在本页」
  orderedNodes.forEach(({ node }) => {
    const parentOffpage = Boolean(node.parentRpid && !node.directParentVisible)
    const hasCachedBody = Boolean(node.directParentMessageText?.trim())
    // 有正文缓存 或 仅有离页父 ID 都展示我们的标注
    const showOffpageLabel = Boolean(parentOffpage && (hasCachedBody || node.parentRpid))
    // 展示自有标注时隐藏原生前缀，避免「回复 @」重复
    const hideNativePrefix = showOffpageLabel
      ? true
      : (showGuides && !parentOffpage)
    setCommentReplyAtPrefixHidden(node.renderer, hideNativePrefix)
    updateCommentReplyOffpageParentLabel(node.renderer, {
      authorName: node.directParentAuthorName,
      messageText: node.directParentMessageText,
      parentRpid: node.parentRpid,
      show: showOffpageLabel,
    })
  })
  // 未进入树序的节点恢复显示
  replyRenderers.forEach((replyRenderer) => {
    if (!orderedNodes.some(({ node }) => node.renderer === replyRenderer)) {
      setCommentReplyAtPrefixHidden(replyRenderer, false)
      clearCommentReplyOffpageParentLabel(replyRenderer)
    }
  })
  if (showGuides) {
    renderCommentReplyTreeGuides(
      component,
      state,
      replyContainer,
      orderedNodes,
      rootNodes,
      collapseParentBody,
    )
  }
  else {
    removeCommentReplyTreeGuides(component, replyContainer)
  }
  updateCommentReplyExpandAllControl(component)
  state.enabled = true
}

export function refreshCommentReplyTrees() {
  commentRepliesRenderers.forEach((component) => {
    if (!component?.isConnected) {
      // 原生收起可能暂时移除同一组件实例，保留其已加载页。
      suspendCommentReplyPaginationForNativeCollapse(component, true)
      clearCommentReplyTreeState(component)
      return
    }

    updateCommentReplyTree(component)
  })
}

/**
 * 带 #reply{rpid} 的深链会触发 B 站：滚动定位、展开楼中楼、高亮目标评论。
 * 这些步骤常在我们首次画线之后才完成，导致线条错位。在结算窗口内多次重算。
 */
const COMMENT_REPLY_DEEP_LINK_RE = /#reply(\d+)/i
const commentReplyDeepLinkSettleTimers: number[] = []
let commentReplyDeepLinkScrollUntil = 0
let commentReplyDeepLinkScrollScheduled = false

export function getCommentReplyDeepLinkId(): string | null {
  const match = location.hash.match(COMMENT_REPLY_DEEP_LINK_RE)
  return match?.[1] ?? null
}

export function clearCommentReplyDeepLinkSettlement() {
  while (commentReplyDeepLinkSettleTimers.length > 0) {
    const timer = commentReplyDeepLinkSettleTimers.pop()
    if (timer !== undefined)
      window.clearTimeout(timer)
  }
  commentReplyDeepLinkScrollUntil = 0
}

export function scheduleCommentReplyDeepLinkSettlement(reason: 'immediate' | 'hash' = 'hash') {
  if (!getCommentReplyDeepLinkId() || getCommentReplyTreeMode() === null)
    return

  // 已在结算窗口：只做轻量刷新，避免每条回复 update 重置长定时器
  if (commentReplyDeepLinkSettleTimers.length > 0 && reason !== 'immediate') {
    onCommentReplyDeepLinkScrollOrResize()
    return
  }

  clearCommentReplyDeepLinkSettlement()
  // 覆盖：首屏渲染、展开楼中楼、滚动动画、高亮样式、图片解码
  const delays = reason === 'immediate'
    ? [0, 50, 120, 280, 500, 900, 1500, 2500, 4000]
    : [0, 100, 300, 600, 1000, 1800, 3000, 5000]
  commentReplyDeepLinkScrollUntil = Date.now() + Math.max(...delays) + 500

  delays.forEach((delay) => {
    const timer = window.setTimeout(() => {
      // 深链结算时允许更多锚点重试
      commentRepliesRenderers.forEach((component) => {
        const state = commentReplyTreeStates.get(component)
        if (state)
          state.layoutRetryCount = 0
      })
      refreshCommentReplyTrees()
    }, delay)
    commentReplyDeepLinkSettleTimers.push(timer)
  })
}

function onCommentReplyDeepLinkScrollOrResize() {
  if (
    Date.now() > commentReplyDeepLinkScrollUntil
    || !getCommentReplyDeepLinkId()
    || getCommentReplyTreeMode() === null
  ) {
    return
  }
  if (commentReplyDeepLinkScrollScheduled)
    return
  commentReplyDeepLinkScrollScheduled = true
  requestAnimationFrame(() => {
    commentReplyDeepLinkScrollScheduled = false
    refreshCommentReplyTrees()
  })
}

export function initDeepLinkListeners() {
  window.addEventListener('hashchange', () => {
    if (getCommentReplyDeepLinkId())
      scheduleCommentReplyDeepLinkSettlement('hash')
    else
      clearCommentReplyDeepLinkSettlement()
  })
  window.addEventListener('scroll', onCommentReplyDeepLinkScrollOrResize, { passive: true, capture: true })
  window.addEventListener('resize', onCommentReplyDeepLinkScrollOrResize, { passive: true })
  // 部分浏览器滚动结束事件
  window.addEventListener('scrollend', onCommentReplyDeepLinkScrollOrResize, { passive: true, capture: true } as AddEventListenerOptions)

  if (getCommentReplyDeepLinkId())
    scheduleCommentReplyDeepLinkSettlement('immediate')
}
