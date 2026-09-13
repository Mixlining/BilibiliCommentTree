import type { CommentReplyInteractionState, CommentReplyLayoutReservation, CommentReplyPaginationState } from './constants'
import { getCommentReplyTreeMode, isCommentReplyLoadMoreEnabled } from '../settings'
import {
  buildPaginationPagePrefixText,
  COMMENT_REPLIES_DISCONNECT_PATCHED,
  COMMENT_REPLY_EXPAND_ALL_ID,
  COMMENT_REPLY_EXPAND_ALL_IDX,
  COMMENT_REPLY_EXPAND_ALL_LOADING_ATTRIBUTE,
  COMMENT_REPLY_PAGINATION_PATCHED,
  commentReplyPaginationStates,
  commentReplyTreeEpochs,
  EXPAND_ALL_TEXT,
  LOAD_MORE_TEXT,
  LOADING_TEXT,
  PAGINATION_OF_TEXT,
  SCRIPT_NAME,
} from './constants'
import {
  findCommentComponentLifecycleMethod,
  findCommentPropertyDescriptor,
  findCommentRepliesRendererHost,
  getCommentReplyData,
  getCommentReplyInvisibleIds,
  getCommentReplyPaginationIdentity,
  getReplyRpid,
  isCommentReplyRenderer,
} from './dom'
import {
  clearCommentReplyTreeState,
  updateCommentReplyTree,
} from './tree'

export function updateCommentReplyPaginationHead(component: any, currentPage: number) {
  const head = component?.shadowRoot?.querySelector('#pagination-head') as HTMLElement | null | undefined
  if (!head)
    return
  const prefix = buildPaginationPagePrefixText(currentPage)
  const first = head.firstChild
  if (first && first.nodeType === Node.TEXT_NODE && first.textContent !== prefix)
    first.textContent = prefix
}

export function restoreCommentReplyPaginationHead(component: any) {
  const head = component?.shadowRoot?.querySelector('#pagination-head') as HTMLElement | null | undefined
  if (!head)
    return
  const first = head.firstChild
  if (first && first.nodeType === Node.TEXT_NODE && first.textContent !== PAGINATION_OF_TEXT)
    first.textContent = PAGINATION_OF_TEXT
}

export function clearCommentReplyPaginationState(renderer: any, restoreCurrentPage: boolean) {
  const state = commentReplyPaginationStates.get(renderer)
  if (!state)
    return
  const original = state.pages.get(state.currentPage)
  if (restoreCurrentPage && state.mergedList && renderer.list === state.mergedList && original) {
    renderer.list = original.slice()
    renderer.requestUpdate?.()
  }
  releaseCommentReplyLayoutReservation(state.pending?.layoutReservation)
  state.pending = undefined
  state.loading = undefined
  state.expandAllLoading = undefined
  state.frozenTreeIndentStep = undefined
  state.expandAllLayoutKey = undefined
  renderer.removeAttribute?.(COMMENT_REPLY_EXPAND_ALL_LOADING_ATTRIBUTE)
  renderer.removeAttribute?.('aria-busy')
  state.pages.clear()
  commentReplyPaginationStates.delete(renderer)
  // 切换分页模式或评论身份时立即刷新，不再等旧 Promise 结算。
  renderer.requestUpdate?.()
}

/**
 * 结束当前「加载更多」的 UI 会话，但保留已累计页。请求本身由 B 站
 * 组件持有，无法可靠 abort；树分支收起时可恢复迟到结果，原生收起则必须忽略它。
 */
export function invalidateCommentReplyPaginationLoading(renderer: any) {
  const state = commentReplyPaginationStates.get(renderer)
  if (!state || (!state.pending && !state.loading))
    return

  releaseCommentReplyLayoutReservation(state.pending?.layoutReservation)
  if (!state.mergedList && state.pages.size > 0)
    state.mergedList = mergeCommentReplyPaginationPages(state)
  if (state.mergedList)
    renderer.list = state.mergedList
  state.pending = undefined
  state.loading = undefined
  renderer.requestUpdate?.()
}

export function suspendCommentReplyPaginationForNativeCollapse(
  renderer: any,
  captureCollapsedList: boolean,
) {
  const state = commentReplyPaginationStates.get(renderer)
  if (!state)
    return
  state.suppressInvalidatedResultRestore = true
  state.allRepliesExpanded = false
  state.frozenTreeIndentStep = undefined
  state.expandAllLayoutKey = undefined
  if (captureCollapsedList && Array.isArray(renderer.list))
    state.collapsedList = renderer.list.slice()
  invalidateCommentReplyPaginationLoading(renderer)
}

export function getCommentReplyPaginationState(renderer: any): CommentReplyPaginationState {
  const identity = getCommentReplyPaginationIdentity(renderer)
  const existing = commentReplyPaginationStates.get(renderer)
  if (existing && existing.identity === identity)
    return existing
  if (existing)
    clearCommentReplyPaginationState(renderer, false)
  const state: CommentReplyPaginationState = {
    identity,
    pages: new Map(),
    currentPage: Number(renderer.currentPage) || 1,
    allRepliesExpanded: false,
  }
  commentReplyPaginationStates.set(renderer, state)
  return state
}

function mergeCommentReplyPaginationPages(state: CommentReplyPaginationState): any[] {
  return mergeCommentReplyLists(
    ...[...state.pages.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, page]) => page),
  )
}

function mergeCommentReplyLists(...lists: any[][]): any[] {
  const merged: any[] = []
  const seen = new Set<string>()
  lists.forEach((list) => {
    list.forEach((reply) => {
      const rpid = getReplyRpid(reply)
      if (rpid) {
        if (seen.has(rpid))
          return
        seen.add(rpid)
      }
      merged.push(reply)
    })
  })
  return merged
}

/** 保留第一次出现的位置，但用最后一次出现的数据覆盖同一条回复。 */
function mergeCommentReplyListsPreferringLatest(...lists: any[][]): any[] {
  const merged: any[] = []
  const indexByRpid = new Map<string, number>()
  const indexByReply = new Map<any, number>()
  lists.forEach((list) => {
    list.forEach((reply) => {
      const rpid = getReplyRpid(reply)
      const existingIndex = rpid
        ? indexByRpid.get(rpid)
        : indexByReply.get(reply)
      if (existingIndex !== undefined) {
        merged[existingIndex] = reply
        return
      }
      const index = merged.length
      merged.push(reply)
      if (rpid)
        indexByRpid.set(rpid, index)
      else
        indexByReply.set(reply, index)
    })
  })
  return merged
}

function getCommentReplyInteractionState(component: any): CommentReplyInteractionState | null {
  const reply = getCommentReplyData(component)
  const actionRenderer = component?.localName === 'bili-comment-action-buttons-renderer'
    ? component
    : component?.shadowRoot?.querySelector('bili-comment-action-buttons-renderer')
  if (!actionRenderer) {
    if (!reply)
      return null
    const interaction: CommentReplyInteractionState = {}
    const action = Number(reply.action)
    const like = Number(reply.like)
    if (Number.isFinite(action))
      interaction.action = action
    if (Number.isFinite(like))
      interaction.like = like
    return interaction.action !== undefined || interaction.like !== undefined
      ? interaction
      : null
  }

  const interaction: CommentReplyInteractionState = {}
  if (typeof actionRenderer.isLike === 'boolean' && typeof actionRenderer.isDislike === 'boolean')
    interaction.action = actionRenderer.isLike ? 1 : actionRenderer.isDislike ? 2 : 0

  const likeCount = Number(actionRenderer.likeCount)
  if (Number.isFinite(likeCount))
    interaction.like = likeCount

  return interaction.action !== undefined || interaction.like !== undefined
    ? interaction
    : null
}

function applyCommentReplyInteraction(
  reply: any,
  rpid: string,
  interaction: CommentReplyInteractionState,
): any {
  if (getReplyRpid(reply) !== rpid)
    return reply
  const actionMatches = interaction.action === undefined || Number(reply?.action) === interaction.action
  const likeMatches = interaction.like === undefined || Number(reply?.like) === interaction.like
  if (actionMatches && likeMatches)
    return reply
  return {
    ...reply,
    ...(interaction.action === undefined ? {} : { action: interaction.action }),
    ...(interaction.like === undefined ? {} : { like: interaction.like }),
  }
}

function applyCommentReplyInteractionToList(
  list: any[] | undefined,
  rpid: string,
  interaction: CommentReplyInteractionState,
): any[] | undefined {
  if (!Array.isArray(list))
    return list
  let changed = false
  const nextList = list.map((reply) => {
    const nextReply = applyCommentReplyInteraction(reply, rpid, interaction)
    changed ||= nextReply !== reply
    return nextReply
  })
  return changed ? nextList : list
}

export function syncRenderedCommentReplyInteraction(actionRenderer: any) {
  const reply = getCommentReplyData(actionRenderer)
  const rpid = getReplyRpid(reply)
  const interaction = getCommentReplyInteractionState(actionRenderer)
  const repliesRenderer = findCommentRepliesRendererHost(actionRenderer) as any
  if (!rpid || !interaction || !repliesRenderer)
    return

  const nextList = applyCommentReplyInteractionToList(repliesRenderer.list, rpid, interaction)
  if (nextList !== repliesRenderer.list)
    repliesRenderer.list = nextList

  const state = commentReplyPaginationStates.get(repliesRenderer)
  if (!state)
    return
  const interactionByRpid = state.interactionByRpid ?? new Map()
  interactionByRpid.set(rpid, interaction)
  state.interactionByRpid = interactionByRpid
  state.mergedList = applyCommentReplyInteractionToList(state.mergedList, rpid, interaction)
  state.collapsedList = applyCommentReplyInteractionToList(state.collapsedList, rpid, interaction)
  if (state.pending) {
    state.pending.beforeList = applyCommentReplyInteractionToList(
      state.pending.beforeList,
      rpid,
      interaction,
    ) ?? state.pending.beforeList
  }
  state.pages.forEach((page, pageNumber) => {
    const nextPage = applyCommentReplyInteractionToList(page, rpid, interaction)
    if (nextPage && nextPage !== page)
      state.pages.set(pageNumber, nextPage)
  })
}

function getRenderedCommentReplyData(renderer: any): any[] {
  const root = renderer?.shadowRoot as ShadowRoot | null | undefined
  const container = root?.querySelector<HTMLElement>('#expander-contents')
  if (!container)
    return []
  return Array.from(container.children)
    .filter(isCommentReplyRenderer)
    .map((component) => {
      const reply = getCommentReplyData(component)
      const rpid = getReplyRpid(reply)
      const interaction = getCommentReplyInteractionState(component)
      return reply && rpid && interaction
        ? applyCommentReplyInteraction(reply, rpid, interaction)
        : reply
    })
    .filter((reply): reply is object => Boolean(reply))
}

function captureCommentReplyInteractionState(
  state: CommentReplyPaginationState,
  replies: any[],
) {
  const interactionByRpid = state.interactionByRpid ?? new Map()
  replies.forEach((reply) => {
    const rpid = getReplyRpid(reply)
    if (!rpid)
      return
    const interaction: CommentReplyInteractionState = {}
    if (Number.isFinite(Number(reply?.action)))
      interaction.action = Number(reply.action)
    if (Number.isFinite(Number(reply?.like)))
      interaction.like = Number(reply.like)
    if (interaction.action !== undefined || interaction.like !== undefined)
      interactionByRpid.set(rpid, interaction)
  })
  state.interactionByRpid = interactionByRpid
}

function restoreCommentReplyInteractionState(
  state: CommentReplyPaginationState,
  replies: any[],
): any[] {
  const interactionByRpid = state.interactionByRpid
  if (!interactionByRpid?.size)
    return replies
  return replies.map((reply) => {
    const rpid = getReplyRpid(reply)
    const interaction = rpid ? interactionByRpid.get(rpid) : undefined
    if (!interaction)
      return reply
    const actionMatches = interaction.action === undefined || Number(reply?.action) === interaction.action
    const likeMatches = interaction.like === undefined || Number(reply?.like) === interaction.like
    if (actionMatches && likeMatches)
      return reply
    return {
      ...reply,
      ...(interaction.action === undefined ? {} : { action: interaction.action }),
      ...(interaction.like === undefined ? {} : { like: interaction.like }),
    }
  })
}

function getNewCommentReplyPage(beforeList: any[], loadedList: any[]): any[] {
  const existingRpids = new Set(
    beforeList.map(getReplyRpid).filter((rpid): rpid is string => Boolean(rpid)),
  )
  const existingReplies = new Set(beforeList)
  const newRpids = new Set<string>()
  return loadedList.filter((reply) => {
    const rpid = getReplyRpid(reply)
    if (rpid) {
      if (existingRpids.has(rpid) || newRpids.has(rpid))
        return false
      newRpids.add(rpid)
      return true
    }
    return !existingReplies.has(reply)
  })
}

function getCommentReplyTotalPage(renderer: any): number {
  const totalPage = Number(renderer?.totalPage)
  return Number.isFinite(totalPage) && totalPage > 0 ? totalPage : 1
}

function isCommentReplyPaginationComplete(renderer: any): boolean {
  const totalPage = Number(renderer?.totalPage)
  return Number.isFinite(totalPage)
    && totalPage > 0
    && (Number(renderer?.currentPage) || 1) >= totalPage
}

/** 等待一次 B 站回复请求结算；兼容旧版本组件未返回 Promise 的情况。 */
async function waitForCommentReplyPaginationRequest(
  renderer: any,
  state: CommentReplyPaginationState,
): Promise<void> {
  const loading = state.loading
  if (loading) {
    await loading
    return
  }

  // getList 在少数 B 站版本中不是 async 方法，但会先打开 spinner，
  // 所以短暂轮询状态，避免「展开全部」在请求刚发出时提前结束。
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (state.loading) {
      await state.loading
      return
    }
    // 某些旧版组件没有公开 showSpinner 属性；只有明确回到 false
    // 时才认为请求已结束，避免在 Promise 尚未挂上 state 时提前退出。
    if (renderer?.showSpinner === false)
      return
    await new Promise<void>(resolve => window.setTimeout(resolve, 50))
  }
}

/**
 * 顺序加载当前楼层的剩余回复页。
 *
 * 必须逐页等待：B 站回复接口按页返回，且组件自身只允许一个在途
 * 请求。复用已 patch 的 getList 可以继续使用去重、树关系缓存和布局
 * 占位逻辑，不会额外发起绕过 B 站组件的请求。
 */
function expandAllCommentReplies(renderer: any): Promise<void> {
  const state = getCommentReplyPaginationState(renderer)
  if (state.expandAllLoading)
    return state.expandAllLoading

  state.allRepliesExpanded = false
  state.frozenTreeIndentStep = undefined
  state.expandAllLayoutKey = undefined
  renderer.setAttribute?.(COMMENT_REPLY_EXPAND_ALL_LOADING_ATTRIBUTE, '')
  renderer.setAttribute?.('aria-busy', 'true')

  const operation = (async () => {
    if (!isCommentReplyLoadMoreEnabled() || !renderer?.user)
      return

    // 允许在原生「点击查看」尚未打开分页时直接使用本按钮。
    if (renderer.showPagination !== true) {
      const handleViewMore = renderer.handleViewMore
      if (typeof handleViewMore !== 'function')
        return
      handleViewMore.call(renderer, { stopPropagation() {} })
      await waitForCommentReplyPaginationRequest(renderer, state)
    }

    const maxPages = getCommentReplyTotalPage(renderer) + 1
    let loadedPages = 0
    while (
      isCommentReplyLoadMoreEnabled()
      && renderer.showPagination === true
      && Number(renderer.currentPage) < getCommentReplyTotalPage(renderer)
      && loadedPages < maxPages
    ) {
      const currentPage = Number(renderer.currentPage) || 1
      const handleChangePage = renderer.handleChangePage
      if (typeof handleChangePage !== 'function')
        break

      // handleChangePage 接收 0-based idx；当前页为 1-based，因此传入
      // currentPage 正好请求下一页。
      handleChangePage.call(renderer, {
        idx: currentPage,
        clickable: true,
      })
      await waitForCommentReplyPaginationRequest(renderer, state)
      loadedPages += 1

      // 防止某个版本的原生组件在请求失败后不推进页码而陷入循环。
      if ((Number(renderer.currentPage) || 1) <= currentPage && !state.loading)
        break
    }

    state.allRepliesExpanded = Boolean(
      renderer.showPagination === true
      && isCommentReplyPaginationComplete(renderer),
    )
  })()

  state.expandAllLoading = operation
  operation.finally(() => {
    if (commentReplyPaginationStates.get(renderer) !== state)
      return
    state.expandAllLoading = undefined
    state.frozenTreeIndentStep = undefined
    state.expandAllLayoutKey = undefined
    renderer.removeAttribute?.(COMMENT_REPLY_EXPAND_ALL_LOADING_ATTRIBUTE)
    renderer.removeAttribute?.('aria-busy')
    renderer.requestUpdate?.()
    requestAnimationFrame(() => {
      if (renderer.isConnected && getCommentReplyTreeMode() !== null) {
        if (state.allRepliesExpanded)
          restoreCommentReplyPaginationHead(renderer)
        updateCommentReplyTree(renderer)
      }
    })
  }).catch(() => {
    // 调用方会在控制台记录错误；finally 中的状态清理仍需执行。
  })
  return operation
}

export function updateCommentReplyExpandAllControl(renderer: any) {
  const root = renderer?.shadowRoot as ShadowRoot | null | undefined
  if (!root)
    return

  const existing = root.querySelector<HTMLButtonElement>(`#${COMMENT_REPLY_EXPAND_ALL_ID}`)
  const state = commentReplyPaginationStates.get(renderer)
  // 分页状态下按钮由 paginationItems 提供；如果再把 DOM 快捷按钮
  // 插入 pagination-foot，就会出现两个「展开全部回复」。
  if (renderer.showPagination === true) {
    existing?.remove()
    return
  }
  const canShow = Boolean(
    isCommentReplyLoadMoreEnabled()
    && renderer.user
    && state?.allRepliesExpanded !== true
    && (
      renderer.showViewMore === true
        ? Number(renderer.count) > Number(renderer.pageSize || 0)
        : false
    ),
  )

  if (!canShow) {
    existing?.remove()
    return
  }

  const target = root.querySelector<HTMLElement>('#view-more')
  if (!target)
    return

  const button = existing ?? document.createElement('button')
  button.id = COMMENT_REPLY_EXPAND_ALL_ID
  button.type = 'button'
  button.className = 'bewly-comment-expand-all-replies'
  button.textContent = state?.expandAllLoading
    ? LOADING_TEXT
    : EXPAND_ALL_TEXT
  button.disabled = Boolean(state?.expandAllLoading)
  button.setAttribute('aria-label', button.textContent)
  button.title = button.textContent
  button.onclick = (event) => {
    event.preventDefault()
    event.stopPropagation()
    void expandAllCommentReplies(renderer).catch((error) => {
      console.warn(`[${SCRIPT_NAME}] Failed to expand all comment replies.`, error)
    })
  }
  if (button.parentElement !== target)
    target.appendChild(button)
}

const activeCommentReplyLayoutReservations = new WeakMap<HTMLElement, CommentReplyLayoutReservation>()

function reserveCommentReplyLayoutHeight(renderer: any): CommentReplyLayoutReservation | undefined {
  const root = renderer?.shadowRoot as ShadowRoot | null | undefined
  const container = root?.querySelector<HTMLElement>('#expander-contents')
  if (!container)
    return undefined

  const height = Math.ceil(container.getBoundingClientRect().height)
  if (height <= 0)
    return undefined

  const existingReservation = activeCommentReplyLayoutReservations.get(container)
  const anchorHost = renderer instanceof HTMLElement ? renderer : container
  const reservation = {
    appliedMinHeight: `${height}px`,
    anchorHost,
    container,
    previousMinHeight: existingReservation?.previousMinHeight ?? container.style.minHeight,
    previousOverflowAnchor: existingReservation?.previousOverflowAnchor
      ?? anchorHost.style.getPropertyValue('overflow-anchor'),
  }
  container.style.minHeight = reservation.appliedMinHeight
  anchorHost.style.setProperty('overflow-anchor', 'none')
  activeCommentReplyLayoutReservations.set(container, reservation)
  return reservation
}

function releaseCommentReplyLayoutReservation(
  reservation: CommentReplyLayoutReservation | undefined,
) {
  if (!reservation)
    return
  const {
    anchorHost,
    appliedMinHeight,
    container,
    previousMinHeight,
    previousOverflowAnchor,
  } = reservation
  if (activeCommentReplyLayoutReservations.get(container) !== reservation)
    return
  activeCommentReplyLayoutReservations.delete(container)
  if (container.style.minHeight === appliedMinHeight)
    container.style.minHeight = previousMinHeight
  if (anchorHost.style.getPropertyValue('overflow-anchor') === 'none') {
    if (previousOverflowAnchor)
      anchorHost.style.setProperty('overflow-anchor', previousOverflowAnchor)
    else
      anchorHost.style.removeProperty('overflow-anchor')
  }
}

function scheduleCommentReplyPaginationTreeUpdate(
  renderer: any,
  layoutReservation?: CommentReplyLayoutReservation,
) {
  const treeEpoch = commentReplyTreeEpochs.get(renderer) ?? 0
  try {
    renderer.requestUpdate?.()
  }
  catch (error) {
    releaseCommentReplyLayoutReservation(layoutReservation)
    throw error
  }
  requestAnimationFrame(() => requestAnimationFrame(() => {
    try {
      if (
        renderer.isConnected
        && getCommentReplyTreeMode() !== null
        && (commentReplyTreeEpochs.get(renderer) ?? 0) === treeEpoch
      ) {
        updateCommentReplyTree(renderer)
      }
    }
    finally {
      releaseCommentReplyLayoutReservation(layoutReservation)
    }
  }))
}

export function patchCommentReplyPaginationPrototype(classConstructor: any) {
  const prototype = classConstructor?.prototype as object | undefined
  if (!prototype || (prototype as any)[COMMENT_REPLY_PAGINATION_PATCHED])
    return
  const getListDescriptor = findCommentPropertyDescriptor(prototype, 'getList')
  const originalGetList = getListDescriptor?.value
  if (typeof originalGetList === 'function') {
    Object.defineProperty(prototype, 'getList', {
      configurable: true,
      writable: true,
      value(this: any, ...args: any[]) {
        if (!isCommentReplyLoadMoreEnabled()) {
          clearCommentReplyPaginationState(this, true)
          return Reflect.apply(originalGetList, this, args)
        }
        const state = getCommentReplyPaginationState(this)
        if (state.loading)
          return state.loading
        // 重新展开后进入了新的加载会话，不再受上次原生收起限制。
        state.suppressInvalidatedResultRestore = false
        state.collapsedList = undefined
        state.allRepliesExpanded = false
        if (!state.expandAllLoading) {
          state.frozenTreeIndentStep = undefined
          state.expandAllLayoutKey = undefined
        }
        const invisibleIds = getCommentReplyInvisibleIds(this)
        if (invisibleIds.size) {
          state.pages.forEach((page, pageNumber) => {
            state.pages.set(pageNumber, page.filter((reply: any) => !invisibleIds.has(getReplyRpid(reply) ?? '')))
          })
          if (state.mergedList) {
            state.mergedList = state.mergedList
              .filter((reply: any) => !invisibleIds.has(getReplyRpid(reply) ?? ''))
          }
        }
        // 原生组件可能替换 list，也可能原地改写。请求前先保存独立的
        // 累计列表快照，后续始终以它为基础追加新页。
        const currentList = Array.isArray(this.list)
          ? this.list.filter((reply: any) => !invisibleIds.has(getReplyRpid(reply) ?? ''))
          : []
        const renderedList = getRenderedCommentReplyData(this)
          .filter((reply: any) => !invisibleIds.has(getReplyRpid(reply) ?? ''))
        // 回复组件会先更新本地点赞/发表评论结果，但 renderer.list 与分页
        // 缓存不一定同步。保留原顺序，同时让当前 list 和实际 DOM 数据
        // 覆盖旧缓存，避免下一页返回的旧数据把交互状态回滚。
        captureCommentReplyInteractionState(state, renderedList)
        const beforeList = restoreCommentReplyInteractionState(
          state,
          mergeCommentReplyListsPreferringLatest(
            state.mergedList ?? [],
            currentList,
            renderedList,
          ),
        )
        state.mergedList = beforeList
        const pending = {
          page: Number(this.currentPage) || 1,
          beforeList,
          layoutReservation: reserveCommentReplyLayoutHeight(this),
        }
        state.pending = pending
        let result: any
        try {
          result = Reflect.apply(originalGetList, this, args)
        }
        catch (error) {
          if (state.pending === pending) {
            releaseCommentReplyLayoutReservation(pending.layoutReservation)
            state.pending = undefined
            state.loading = undefined
          }
          throw error
        }
        const promise = Promise.resolve(result).then((value) => {
          if (state.pending === pending) {
            state.pending = undefined
            state.loading = undefined
            if (isCommentReplyLoadMoreEnabled()
              && state.identity === getCommentReplyPaginationIdentity(this)
              && Array.isArray(this.list)) {
              const latestInvisibleIds = getCommentReplyInvisibleIds(this)
              const retainedBeforeList = pending.beforeList
                .filter((reply: any) => !latestInvisibleIds.has(getReplyRpid(reply) ?? ''))
              const loadedList = restoreCommentReplyInteractionState(
                state,
                this.list.filter((reply: any) => !latestInvisibleIds.has(getReplyRpid(reply) ?? '')),
              )
              const page = getNewCommentReplyPage(retainedBeforeList, loadedList)
              state.pages.forEach((cachedPage, pageNumber) => {
                state.pages.set(
                  pageNumber,
                  cachedPage.filter((reply: any) => !latestInvisibleIds.has(getReplyRpid(reply) ?? '')),
                )
              })
              // pages 始终保存原生完整单页，供切回「分页」模式时恢复。
              state.pages.set(pending.page, loadedList)
              state.pages.forEach((cachedPage, pageNumber) => {
                state.pages.set(
                  pageNumber,
                  restoreCommentReplyInteractionState(state, cachedPage),
                )
              })
              state.currentPage = pending.page
              state.allRepliesExpanded = isCommentReplyPaginationComplete(this)
              const merged = mergeCommentReplyLists(retainedBeforeList, page)
              state.mergedList = merged
              this.list = merged
              scheduleCommentReplyPaginationTreeUpdate(this, pending.layoutReservation)
            }
            else {
              releaseCommentReplyLayoutReservation(pending.layoutReservation)
            }
          }
          else if (
            commentReplyPaginationStates.get(this) === state
            && state.identity === getCommentReplyPaginationIdentity(this)
          ) {
            if (state.suppressInvalidatedResultRestore && state.collapsedList) {
              // 原生收起后迟到的请求会先将 list 改成单页，立即恢复收起态缓存。
              this.list = state.collapsedList
              this.requestUpdate?.()
            }
            else if (
              !state.pending
              && !state.loading
              && state.mergedList
            ) {
              // 树分支折叠后的迟到请求恢复折叠前累计列表。
              this.list = state.mergedList
              scheduleCommentReplyPaginationTreeUpdate(this)
            }
          }
          return value
        }, (error) => {
          if (state.pending === pending) {
            releaseCommentReplyLayoutReservation(pending.layoutReservation)
            state.pending = undefined
            state.loading = undefined
          }
          throw error
        })
        state.loading = promise
        return promise
      },
    })
  }

  const changePageDescriptor = findCommentPropertyDescriptor(prototype, 'handleChangePage')
  const originalChangePage = changePageDescriptor?.value
  if (typeof originalChangePage === 'function') {
    Object.defineProperty(prototype, 'handleChangePage', {
      configurable: true,
      writable: true,
      value(this: any, ...args: any[]) {
        if (!isCommentReplyLoadMoreEnabled())
          return Reflect.apply(originalChangePage, this, args)
        const pageItem = args[0]
        if (pageItem?.idx === COMMENT_REPLY_EXPAND_ALL_IDX) {
          return expandAllCommentReplies(this).catch((error) => {
            console.warn(`[${SCRIPT_NAME}] Failed to expand all comment replies.`, error)
          })
        }
        const state = getCommentReplyPaginationState(this)
        if (state.loading)
          return state.loading
        const currentPage = Number(this.currentPage) || 1
        if (!state.pages.has(currentPage)
          && Array.isArray(this.list)
          && this.list !== state.mergedList) {
          state.pages.set(currentPage, this.list.slice())
          state.currentPage = currentPage
        }
        return Reflect.apply(originalChangePage, this, args)
      },
    })
  }

  const paginationDescriptor = findCommentPropertyDescriptor(prototype, 'paginationItems')
  const originalPaginationItems = paginationDescriptor?.get
  if (typeof originalPaginationItems === 'function') {
    Object.defineProperty(prototype, 'paginationItems', {
      configurable: true,
      get(this: any) {
        const items = Reflect.apply(originalPaginationItems, this, [])
        if (!isCommentReplyLoadMoreEnabled() || this.showPagination !== true || !Array.isArray(items))
          return items
        const state = getCommentReplyPaginationState(this)
        const currentPage = Number(this.currentPage) || 1
        if (state.loading || state.expandAllLoading) {
          return [{ text: LOADING_TEXT, idx: currentPage, clickable: false }]
        }
        if (state.allRepliesExpanded) {
          // 批量展开完成后恢复 B 站原生的「共 x 页」，不要继续显示
          // 我们在逐页阅读模式下使用的「第 1 页，共 x 页」。
          queueMicrotask(() => restoreCommentReplyPaginationHead(this))
          return []
        }
        const totalPage = Number(this.totalPage) || 0
        const hasNext = currentPage < totalPage
        queueMicrotask(() => updateCommentReplyPaginationHead(this, currentPage))
        if (!hasNext)
          return []

        return [
          { text: LOAD_MORE_TEXT, idx: currentPage, clickable: true },
          {
            text: EXPAND_ALL_TEXT,
            idx: COMMENT_REPLY_EXPAND_ALL_IDX,
            clickable: true,
          },
        ]
      },
    })
  }

  const revertDescriptor = findCommentPropertyDescriptor(prototype, 'handleRevert')
  const originalRevert = revertDescriptor?.value
  if (typeof originalRevert === 'function') {
    Object.defineProperty(prototype, 'handleRevert', {
      configurable: true,
      writable: true,
      value(this: any, ...args: any[]) {
        const cleanup = (captureCollapsedList: boolean) => {
          // 原生收起只结束未完成请求；已加载页必须留给下次展开继续追加。
          suspendCommentReplyPaginationForNativeCollapse(this, captureCollapsedList)
          clearCommentReplyTreeState(this)
        }
        cleanup(false)
        let result: any
        try {
          result = Reflect.apply(originalRevert, this, args)
        }
        catch (error) {
          cleanup(true)
          throw error
        }
        // 原生收起会同步改写 list/展示状态，调用后再清一次布局会话。
        cleanup(true)
        return result
      },
    })
  }
  Object.defineProperty(prototype, COMMENT_REPLY_PAGINATION_PATCHED, {
    configurable: true,
    value: true,
  })
}

/**
 * B 站 SPA 会直接移除整层回复组件，不一定触发 handleRevert。普通 Set
 * 若不在 disconnectedCallback 清理，会把旧组件、Shadow DOM 与分页数据
 * 永久保留到下一次设置刷新。
 */
export function patchCommentRepliesRendererDisconnect(classConstructor: any) {
  const prototype = classConstructor?.prototype as object | undefined
  if (!prototype || (prototype as any)[COMMENT_REPLIES_DISCONNECT_PATCHED])
    return

  const originalDisconnected = findCommentComponentLifecycleMethod(prototype, 'disconnectedCallback')
  Object.defineProperty(prototype, 'disconnectedCallback', {
    configurable: true,
    writable: true,
    value(this: any, ...args: any[]) {
      let result: any
      try {
        if (originalDisconnected)
          result = Reflect.apply(originalDisconnected, this, args)
        return result
      }
      finally {
        // 分页状态保存在 WeakMap 中；临时折叠后若复用同一实例仍可恢复，
        // 这里只释放会形成强引用的树布局与全局可迭代集合。
        suspendCommentReplyPaginationForNativeCollapse(this, true)
        clearCommentReplyTreeState(this)
      }
    },
  })
  Object.defineProperty(prototype, COMMENT_REPLIES_DISCONNECT_PATCHED, {
    configurable: true,
    value: true,
  })
}
