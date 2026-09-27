import {
  commentReplyPaginationStates,
} from './constants'
import {
  getCommentReplyInvisibleIds,
  getCommentReplyPaginationIdentity,
  getReplyRpid,
} from './dom'

export interface CommentReplyPageSource {
  oid: string
  type: string
  root: string
  totalPage: number
}

/** 完整单页缓存与可中断的顺序预取；不操作原生 renderer 的页码或列表。 */
export class CommentReplyPageCache {
  readonly pages = new Map<number, any[]>()
  private controller?: AbortController
  private operation?: Promise<void>

  constructor(readonly pageSize: number) {}

  get loading(): boolean {
    return Boolean(this.operation)
  }

  stop() {
    this.controller?.abort()
    this.controller = undefined
    this.operation = undefined
  }

  prefetch(
    source: CommentReplyPageSource,
    isActive: () => boolean,
    onPage: (replies: any[]) => void,
  ): Promise<void> {
    if (this.operation)
      return this.operation

    const controller = new AbortController()
    this.controller = controller
    const active = () => !controller.signal.aborted && isActive()
    // 延后一个 microtask，保证回调执行时 loading 状态已经建立。
    const operation = Promise.resolve().then(async () => {
      for (let page = 1; page <= source.totalPage && active(); page += 1) {
        if (this.pages.has(page))
          continue
        const url = new URL('https://api.bilibili.com/x/v2/reply/reply')
        url.search = new URLSearchParams({
          oid: source.oid,
          type: source.type,
          root: source.root,
          pn: String(page),
          ps: String(this.pageSize),
        }).toString()
        const timeout = setTimeout(() => controller.abort(), 15_000)
        try {
          const response = await fetch(url, { credentials: 'include', signal: controller.signal })
          if (!response.ok)
            throw new Error(`Reply page request failed: HTTP ${response.status}`)
          const result = await response.json()
          if (result.code !== 0 || !result.data
            || (result.data.replies !== null && !Array.isArray(result.data.replies))
            || (result.data.page?.num != null && Number(result.data.page.num) !== page)
            || (result.data.page?.size != null && Number(result.data.page.size) !== this.pageSize)) {
            throw new Error('Reply page response is invalid')
          }
          if (!active())
            return
          // 用户切页或原生请求可能先返回；不让预取结果覆盖更新的单页。
          if (!this.pages.has(page)) {
            const replies = result.data.replies ?? []
            this.pages.set(page, replies)
            onPage(replies)
          }
        }
        finally {
          clearTimeout(timeout)
        }
      }
    }).catch((error) => {
      if (!controller.signal.aborted)
        throw error
    }).finally(() => {
      if (this.operation === operation) {
        this.operation = undefined
        this.controller = undefined
      }
    })
    this.operation = operation
    return operation
  }
}

/** B 站切页时可能销毁并重建 replies renderer；按楼层身份保留完整单页，重建后无需重新请求。 */
const commentReplyPageCaches = new Map<string, CommentReplyPageCache>()
export const MAX_COMMENT_REPLY_CROSS_PAGE_CACHE_THREADS = 64

export function getCommentReplyPageCache(renderer: any): CommentReplyPageCache | undefined {
  const identity = getCommentReplyPaginationIdentity(renderer)
  if (!identity.split('|').every(part => /^\d+$/.test(part)))
    return undefined
  const pageSize = Number(renderer.pageSize) || 20
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100)
    return undefined
  const key = `${identity}|${pageSize}`
  let cache = commentReplyPageCaches.get(key)
  if (!cache)
    cache = new CommentReplyPageCache(pageSize)
  // 按最近使用淘汰；同一楼层的组件重建后仍可复用完整单页。
  commentReplyPageCaches.delete(key)
  commentReplyPageCaches.set(key, cache)
  while (commentReplyPageCaches.size > MAX_COMMENT_REPLY_CROSS_PAGE_CACHE_THREADS) {
    const oldest = commentReplyPageCaches.keys().next().value!
    commentReplyPageCaches.get(oldest)?.stop()
    commentReplyPageCaches.delete(oldest)
  }
  return cache
}

export function rememberCommentReplyPages(renderer: any, cache: CommentReplyPageCache) {
  const state = commentReplyPaginationStates.get(renderer)
  state?.pages.forEach((replies, page) => cache.pages.set(page, replies))
  const invisibleIds = getCommentReplyInvisibleIds(renderer)
  if (invisibleIds.size) {
    cache.pages.forEach((replies, page) => {
      cache.pages.set(page, replies.filter(reply => !invisibleIds.has(getReplyRpid(reply) ?? '')))
    })
  }
  if (renderer.showPagination !== true || renderer.showSpinner || state?.loading)
    return
  const page = Number(renderer.currentPage) || 1
  // 累计列表并非完整单页，不能当作当前页写进缓存。
  const replies = state?.mergedList === renderer.list ? state?.pages.get(page) : renderer.list
  if (Array.isArray(replies))
    cache.pages.set(page, replies.filter(reply => !invisibleIds.has(getReplyRpid(reply) ?? '')))
}
