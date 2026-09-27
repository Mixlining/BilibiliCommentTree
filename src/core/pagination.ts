import type { CommentReplyInteractionState, CommentReplyLayoutReservation, CommentReplyPaginationState } from './constants'
import { getCommentReplyTreeMode, isCommentReplyLoadMoreEnabled } from '../settings'
import {
  ALL_PAGES_TEXT,
  buildPaginationPageNumberText,
  buildPaginationPageTotalText,
  COMMENT_REPLIES_DISCONNECT_PATCHED,
  COMMENT_REPLY_BATCH_PAGE_LIMIT,
  COMMENT_REPLY_EXPAND_ALL_ID,
  COMMENT_REPLY_EXPAND_ALL_IDX,
  COMMENT_REPLY_EXPAND_ALL_LOADING_ATTRIBUTE,
  COMMENT_REPLY_PAGE_HEAD_ID,
  COMMENT_REPLY_PAGE_SELECT_ID,
  COMMENT_REPLY_PAGINATION_PATCHED,
  commentReplyPaginationStates,
  commentReplyTreeEpochs,
  EXPAND_ALL_TEXT,
  LOAD_MORE_TEXT,
  LOADING_TEXT,
  SCRIPT_NAME,
  SELECT_REPLY_PAGE_TEXT,
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
  getCommentReplyPageCache,
  rememberCommentReplyPages,
} from './pageCache'
import {
  clearCommentReplyTreeState,
  updateCommentReplyTree,
} from './tree'

export function updateCommentReplyPaginationHead(component: any) {
  const head = component?.shadowRoot?.querySelector('#pagination-head') as HTMLElement | null | undefined
  if (!head)
    return
  const totalPage = getCommentReplyTotalPage(component)
  if (component.showPagination !== true || totalPage <= 1 || typeof component.handleChangePage !== 'function') {
    restoreCommentReplyPaginationHead(component)
    return
  }

  // 单独渲染完整分页头，不改写 Lit 管理的文本（原生可能把总页数放在同一节点）。
  let pageHead = head.parentElement?.querySelector<HTMLElement>(`#${COMMENT_REPLY_PAGE_HEAD_ID}`)
  if (!pageHead) {
    pageHead = document.createElement('span')
    pageHead.id = COMMENT_REPLY_PAGE_HEAD_ID
    head.after(pageHead)
  }
  let select = pageHead.querySelector<HTMLSelectElement>(`#${COMMENT_REPLY_PAGE_SELECT_ID}`)
  if (!select) {
    select = document.createElement('select')
    select.id = COMMENT_REPLY_PAGE_SELECT_ID
    select.addEventListener('click', event => event.stopPropagation())
    select.addEventListener('change', (event) => {
      event.stopPropagation()
      void jumpToCommentReplyPage(component, Number((event.currentTarget as HTMLSelectElement).value))
    })
    pageHead.append(select, document.createElement('span'))
  }
  const state = commentReplyPaginationStates.get(component)
  const allExpanded = state?.allRepliesExpanded === true
  const optionsKey = `${totalPage}|${allExpanded}`
  if (select.dataset.optionsKey !== optionsKey) {
    const options = document.createDocumentFragment()
    if (allExpanded) {
      const option = document.createElement('option')
      option.value = ''
      option.textContent = ALL_PAGES_TEXT
      option.disabled = true
      option.hidden = true
      options.appendChild(option)
    }
    for (let page = 1; page <= totalPage; page += 1) {
      const option = document.createElement('option')
      option.value = String(page)
      option.textContent = buildPaginationPageNumberText(page)
      options.appendChild(option)
    }
    select.replaceChildren(options)
    select.dataset.optionsKey = optionsKey
  }
  select.value = allExpanded ? '' : String(Number(component.currentPage) || 1)
  select.disabled = Boolean(state?.loading || state?.expandAllLoading || component.showSpinner)
  select.title = SELECT_REPLY_PAGE_TEXT
  select.setAttribute('aria-label', select.title)
  const totalLabel = buildPaginationPageTotalText(totalPage)
  const summary = select.nextElementSibling
  if (summary && summary.textContent !== totalLabel)
    summary.textContent = totalLabel
}

export function restoreCommentReplyPaginationHead(component: any) {
  const head = component?.shadowRoot?.querySelector('#pagination-head') as HTMLElement | null | undefined
  if (!head)
    return
  head.parentElement?.querySelector(`#${COMMENT_REPLY_PAGE_HEAD_ID}`)?.remove()
}

async function jumpToCommentReplyPage(renderer: any, page: number) {
  const state = isCommentReplyLoadMoreEnabled()
    ? getCommentReplyPaginationState(renderer)
    : commentReplyPaginationStates.get(renderer)
  if (!Number.isInteger(page) || page < 1 || page > getCommentReplyTotalPage(renderer)
    || renderer.showPagination !== true || renderer.showSpinner
    || state?.loading || state?.expandAllLoading) {
    updateCommentReplyPaginationHead(renderer)
    return
  }
  const previousPage = Number(renderer.currentPage) || 1
  const previousList = Array.isArray(renderer.list) ? renderer.list.slice() : []
  const identity = getCommentReplyPaginationIdentity(renderer)
  const cache = getCommentReplyPageCache(renderer)
  if (cache) {
    rememberCommentReplyPages(renderer, cache)
    // 用户选页优先于后台预取；迟到的旧请求不能覆盖选中的页。
    cache.stop()
  }
  if (page === previousPage && !state?.mergedList) {
    updateCommentReplyPaginationHead(renderer)
    prefetchOtherCommentReplyPages(renderer)
    return
  }
  const scrollSnapshot = captureCommentReplyScrollSnapshot(renderer)
  // 已访问过的页直接从缓存恢复，避免再次请求时 B 站暂时只返回当前页，
  // 也避免切页过程中旧回复短暂消失导致树关系被判定为「不在本页」。
  {
    const cachedPage = cache?.pages.get(page) ?? state?.pages.get(page)
    if (cachedPage) {
      const invisibleIds = getCommentReplyInvisibleIds(renderer)
      const visiblePage = cachedPage.filter(reply => !invisibleIds.has(getReplyRpid(reply) ?? ''))
      const restoredPage = state ? restoreCommentReplyInteractionState(state, visiblePage) : visiblePage
      if (state) {
        state.pages.set(page, restoredPage)
        state.currentPage = page
        state.mergedList = restoredPage
        state.allRepliesExpanded = false
      }
      renderer.currentPage = page
      renderer.list = restoredPage
      renderer.requestUpdate?.()
      scheduleCommentReplyPaginationTreeUpdate(renderer)
      restoreCommentReplyScrollSnapshot(scrollSnapshot)
      updateCommentReplyPaginationHead(renderer)
      prefetchOtherCommentReplyPages(renderer)
      return
    }
  }
  if (isCommentReplyLoadMoreEnabled() && state) {
    state.pageJump = {
      previousPage,
      allRepliesExpanded: state?.allRepliesExpanded,
    }
  }
  try {
    const result = renderer.handleChangePage({ idx: page - 1, clickable: true })
    updateCommentReplyPaginationHead(renderer)
    await result
    const currentState = commentReplyPaginationStates.get(renderer)
    if (currentState?.loading)
      await currentState.loading
  }
  catch (error) {
    if (!isCommentReplyLoadMoreEnabled() && renderer.showPagination === true
      && identity === getCommentReplyPaginationIdentity(renderer)) {
      renderer.currentPage = previousPage
      renderer.list = previousList
      renderer.requestUpdate?.()
    }
    console.warn(`[${SCRIPT_NAME}] Failed to change comment reply page.`, error)
  }
  finally {
    if (state)
      state.pageJump = undefined
    if (!renderer.isConnected || identity !== getCommentReplyPaginationIdentity(renderer))
      scrollSnapshot.controller.abort()
    restoreCommentReplyScrollSnapshot(scrollSnapshot)
    updateCommentReplyPaginationHead(renderer)
    if (identity === getCommentReplyPaginationIdentity(renderer)
      && Number(renderer.currentPage) === page && !renderer.showSpinner) {
      prefetchOtherCommentReplyPages(renderer)
    }
  }
}

function prefetchOtherCommentReplyPages(renderer: any) {
  const cache = getCommentReplyPageCache(renderer)
  if (!cache || getCommentReplyTreeMode() === null)
    return
  rememberCommentReplyPages(renderer, cache)
  const identity = getCommentReplyPaginationIdentity(renderer)
  const [oid, type, root] = identity.split('|')
  const isActive = () => renderer.isConnected && renderer.showPagination === true
    && getCommentReplyTreeMode() !== null && identity === getCommentReplyPaginationIdentity(renderer)
  const refreshParents = (replies?: any[]) => {
    if (!isActive() || commentReplyPaginationStates.get(renderer)?.loading || renderer.showSpinner)
      return
    const missing = renderer.shadowRoot?.querySelectorAll('.bewly-comment-missing-parent') as NodeListOf<HTMLElement> | undefined
    if (!missing?.length)
      return
    const loadedIds = replies ? new Set(replies.map(getReplyRpid)) : undefined
    if (loadedIds && !Array.from(missing).some(node => loadedIds.has(node.dataset.parentRpid ?? '')))
      return
    const snapshot = captureCommentReplyScrollSnapshot(renderer)
    updateCommentReplyTree(renderer)
    restoreCommentReplyScrollSnapshot(snapshot)
  }
  void cache.prefetch({ oid, type, root, totalPage: getCommentReplyTotalPage(renderer) }, isActive, refreshParents)
    .catch((error: unknown) => console.warn(`[${SCRIPT_NAME}] Failed to cache other reply pages.`, error))
    .finally(() => refreshParents())
  refreshParents()
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

function getCommentReplyPaginationState(renderer: any): CommentReplyPaginationState {
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

  getCommentReplyPageCache(repliesRenderer)?.pages.forEach((page, pageNumber, pages) => {
    const nextPage = applyCommentReplyInteractionToList(page, rpid, interaction)
    if (nextPage && nextPage !== page)
      pages.set(pageNumber, nextPage)
  })
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
  if (Number.isSafeInteger(totalPage) && totalPage > 0)
    return totalPage
  const count = Number(renderer?.count)
  const pageSize = Number(renderer?.pageSize)
  const estimatedPages = Math.ceil(count / pageSize)
  return pageSize > 0 && Number.isSafeInteger(estimatedPages) && estimatedPages > 0 ? estimatedPages : 1
}

function isCommentReplyPaginationComplete(renderer: any): boolean {
  const totalPage = getCommentReplyTotalPage(renderer)
  const pages = commentReplyPaginationStates.get(renderer)?.pages
  return Boolean(pages && pages.size === totalPage
    && [...pages.keys()].every(page => page >= 1 && page <= totalPage))
}

function getCommentReplyBatchLabel(renderer: any): string {
  const totalPage = getCommentReplyTotalPage(renderer)
  const pages = commentReplyPaginationStates.get(renderer)?.pages
  const loadedPages = pages ? [...pages.keys()].filter(page => page >= 1 && page <= totalPage).length : 0
  return totalPage - loadedPages > COMMENT_REPLY_BATCH_PAGE_LIMIT
    ? `加载 ${COMMENT_REPLY_BATCH_PAGE_LIMIT} 页`
    : EXPAND_ALL_TEXT
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
 * 每次顺序加载最多 5 个未加载的回复页，后续点击继续补齐。
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

    let loadedPages = 0
    const pagesBeforeExpand = new Set(state.pages.keys())
    // 首次展开请求的页也计入本次额度，避免第一次实际加载 6 页。
    // 允许在原生「点击查看」尚未打开分页时直接使用本按钮。
    if (renderer.showPagination !== true) {
      const handleViewMore = renderer.handleViewMore
      if (typeof handleViewMore !== 'function')
        return
      handleViewMore.call(renderer, { stopPropagation() {} })
      await waitForCommentReplyPaginationRequest(renderer, state)
      loadedPages = [...state.pages.keys()].filter(page => !pagesBeforeExpand.has(page)).length
    }

    while (
      isCommentReplyLoadMoreEnabled()
      && renderer.showPagination === true
      && commentReplyPaginationStates.get(renderer) === state
      && !isCommentReplyPaginationComplete(renderer)
      && loadedPages < COMMENT_REPLY_BATCH_PAGE_LIMIT
    ) {
      const handleChangePage = renderer.handleChangePage
      if (typeof handleChangePage !== 'function')
        break

      // 直接跳页后前面的页可能尚未加载，从最早缺失页补齐。
      let nextPage = 1
      while (state.pages.has(nextPage) && nextPage <= getCommentReplyTotalPage(renderer))
        nextPage += 1
      handleChangePage.call(renderer, {
        idx: nextPage - 1,
        clickable: true,
      })
      await waitForCommentReplyPaginationRequest(renderer, state)
      loadedPages += 1

      // 防止某个版本的原生组件在请求失败后不推进页码而陷入循环。
      if (!state.pages.has(nextPage) && !state.loading)
        break
    }

    state.allRepliesExpanded = Boolean(
      renderer.showPagination === true
      && isCommentReplyPaginationComplete(renderer),
    )
    // 每批完成后合并已加载页；跳页后也能重新显示之前加载的回复。
    if (renderer.showPagination === true && commentReplyPaginationStates.get(renderer) === state) {
      state.mergedList = restoreCommentReplyInteractionState(state, mergeCommentReplyPaginationPages(state))
      renderer.list = state.mergedList
      scheduleCommentReplyPaginationTreeUpdate(renderer)
    }
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
        updateCommentReplyPaginationHead(renderer)
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
    : getCommentReplyBatchLabel(renderer)
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

interface CommentReplyScrollSnapshot {
  controller: AbortController
  windowX: number
  windowY: number
  anchor: HTMLElement | null
  anchorTop: number
  elements: Array<{ element: HTMLElement, left: number, top: number }>
}

const activeCommentReplyScrollRestores = new WeakMap<HTMLElement, AbortController>()

/** B 站替换回复节点时可能触发 scroll anchoring，切页后恢复原视口位置。 */
function captureCommentReplyScrollSnapshot(renderer: any): CommentReplyScrollSnapshot {
  const elements: CommentReplyScrollSnapshot['elements'] = []
  const anchor = (renderer?.shadowRoot?.querySelector?.(`#${COMMENT_REPLY_PAGE_HEAD_ID}, #pagination-head:not(:has(+ #${COMMENT_REPLY_PAGE_HEAD_ID}))`) as HTMLElement | null) ?? null
  const anchorTop = anchor?.getBoundingClientRect().top ?? 0
  const controller = new AbortController()
  if (anchor) {
    activeCommentReplyScrollRestores.get(anchor)?.abort()
    activeCommentReplyScrollRestores.set(anchor, controller)
  }
  // 从请求前捕获位置时就监听用户操作，等待响应期间的滚动也应取消恢复。
  for (const name of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
    window.addEventListener(name, () => controller.abort(), {
      signal: controller.signal,
      passive: true,
      capture: true,
    })
  }
  let node: Node | null = renderer ?? null
  const visited = new Set<Node>()
  while (node && !visited.has(node)) {
    visited.add(node)
    if (node instanceof HTMLElement) {
      const style = getComputedStyle(node)
      const canScroll = /auto|scroll|overlay/.test(`${style.overflow} ${style.overflowY} ${style.overflowX}`)
      if (canScroll && (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth)) {
        elements.push({ element: node, left: node.scrollLeft, top: node.scrollTop })
      }
    }
    if (node.parentNode) {
      node = node.parentNode
    }
    else if (node instanceof ShadowRoot) {
      node = node.host
    }
    else {
      const root = node.getRootNode()
      node = root instanceof ShadowRoot ? root.host : null
    }
  }
  // 回复容器在 renderer 的 shadow root 内部，向上遍历祖先不会包含它。
  // 必须放在最后：elements[0] 仍需是最外层滚动容器，否则恢复时的锚点校正
  // 会不断把内层容器往下推。
  const replyContainer = renderer?.shadowRoot?.querySelector?.('#expander-contents') as HTMLElement | null
  if (replyContainer && replyContainer.scrollHeight > replyContainer.clientHeight)
    elements.push({ element: replyContainer, left: replyContainer.scrollLeft, top: replyContainer.scrollTop })
  return { controller, anchor, anchorTop, elements, windowX: window.scrollX, windowY: window.scrollY }
}

function restoreCommentReplyScrollSnapshot(snapshot: CommentReplyScrollSnapshot | undefined) {
  if (!snapshot || snapshot.controller.signal.aborted)
    return
  const { controller } = snapshot
  const restore = () => {
    if (controller.signal.aborted)
      return
    // B 站页面可能全局开启 smooth scrolling；切页定位必须使用即时滚动，
    // 否则恢复动作尚未完成时下一帧又会被平滑动画推走。
    try {
      window.scrollTo({ left: snapshot.windowX, top: snapshot.windowY, behavior: 'instant' })
    }
    catch {
      window.scrollTo(snapshot.windowX, snapshot.windowY)
    }
    snapshot.elements.forEach(({ element, left, top }) => {
      if (element.isConnected) {
        element.scrollLeft = left
        element.scrollTop = top
      }
    })
    if (snapshot.anchor?.isConnected) {
      const offset = snapshot.anchor.getBoundingClientRect().top - snapshot.anchorTop
      if (Math.abs(offset) > 0.5) {
        const container = snapshot.elements[0]?.element
        if (container?.isConnected) {
          container.scrollTop += offset
        }
        else {
          try {
            window.scrollBy({ top: offset, left: 0, behavior: 'instant' })
          }
          catch {
            window.scrollBy(0, offset)
          }
        }
      }
    }
  }
  restore()
  // Lit 更新、树状布局和图片尺寸结算可能跨越多个 frame；持续约 1 秒
  // 校正锚点，覆盖异步内容到达造成的二次位移。
  let remainingFrames = 60
  const settle = () => {
    if (controller.signal.aborted)
      return
    restore()
    remainingFrames -= 1
    if (remainingFrames > 0)
      requestAnimationFrame(settle)
    else
      controller.abort()
  }
  requestAnimationFrame(settle)
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
        const pageJump = state.pageJump
        state.pageJump = undefined
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
        const restoreFailedPageJump = () => {
          if (!pageJump || state.pending !== pending)
            return
          this.currentPage = pageJump.previousPage
          this.list = beforeList
          state.mergedList = beforeList
          state.allRepliesExpanded = pageJump.allRepliesExpanded
          this.requestUpdate?.()
        }
        state.pending = pending
        let result: any
        try {
          result = Reflect.apply(originalGetList, this, args)
        }
        catch (error) {
          restoreFailedPageJump()
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
              const retainedBeforeList = (pageJump ? [] : pending.beforeList)
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
              const merged = mergeCommentReplyLists(retainedBeforeList, page)
              state.allRepliesExpanded = !pageJump && isCommentReplyPaginationComplete(this)
                && merged.length === mergeCommentReplyPaginationPages(state).length
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
          restoreFailedPageJump()
          if (state.pending === pending) {
            releaseCommentReplyLayoutReservation(pending.layoutReservation)
            state.pending = undefined
            state.loading = undefined
          }
          throw error
        })
        state.loading = promise
        this.requestUpdate?.()
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
        // 有些原生版本会忽略相同页码；累计多页后仍应允许只查看当前页。
        if (state.pageJump && pageItem?.idx === currentPage - 1)
          return this.getList()
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
        queueMicrotask(() => updateCommentReplyPaginationHead(this))
        if (!isCommentReplyLoadMoreEnabled() || this.showPagination !== true || !Array.isArray(items))
          return items
        const state = getCommentReplyPaginationState(this)
        const currentPage = Number(this.currentPage) || 1
        if (state.loading || state.expandAllLoading) {
          return [{ text: LOADING_TEXT, idx: currentPage, clickable: false }]
        }
        if (state.allRepliesExpanded) {
          return []
        }
        const totalPage = Number(this.totalPage) || 0
        const hasNext = currentPage < totalPage

        return [
          ...(hasNext ? [{ text: LOAD_MORE_TEXT, idx: currentPage, clickable: true }] : []),
          {
            text: getCommentReplyBatchLabel(this),
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
        getCommentReplyPageCache(this)?.stop()
        clearCommentReplyTreeState(this)
      }
    },
  })
  Object.defineProperty(prototype, COMMENT_REPLIES_DISCONNECT_PATCHED, {
    configurable: true,
    value: true,
  })
}
