import {
  COMMENT_COMPONENT_PATCHED,
  pendingCommentEnhancements,
  SCRIPT_NAME,
} from './constants'

export function ensureCommentShadowStyle(root: ShadowRoot, id: string, css: string) {
  if (root.querySelector(`#${id}`))
    return

  const style = document.createElement('style')
  style.id = id
  style.textContent = css
  root.appendChild(style)
}

export function findCommentComponentLifecycleMethod(
  prototype: object,
  methodName: string,
): ((...args: any[]) => any) | null {
  const descriptor = findCommentPropertyDescriptor(prototype, methodName)
  return descriptor && typeof descriptor.value === 'function' ? descriptor.value : null
}

/**
 * 在评论相关自定义元素的生命周期后执行增强逻辑。
 * 优先 patch update（Lit）；若无 update 则回退 connectedCallback / updated。
 */
export function patchCommentComponentUpdate(
  name: string,
  classConstructor: any,
  enhance: (component: any) => void,
  options?: { silent?: boolean },
) {
  const prototype = classConstructor?.prototype as object | undefined
  if (!prototype) {
    if (!options?.silent)
      console.warn(`[${SCRIPT_NAME}] Skip patching ${name}: prototype is unavailable.`)
    return false
  }

  if ((prototype as any)[COMMENT_COMPONENT_PATCHED])
    return true

  const scheduleEnhance = (instance: any) => {
    // Do not run DOM work inside Bilibili's render lifecycle.
    if (pendingCommentEnhancements.has(instance))
      return
    pendingCommentEnhancements.add(instance)
    const runAfterBilibiliRender = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          pendingCommentEnhancements.delete(instance)
          if (instance instanceof Node && !instance.isConnected)
            return

          try {
            enhance(instance)
          }
          catch (error) {
            console.warn(`[${SCRIPT_NAME}] Failed to enhance ${name}.`, error)
          }
        })
      })
    }

    // 设置在脚本初始化时同步读取完成；这里只需等 B 站两帧渲染后增强，
    // 避免与 B 站首次水合争抢 DOM。
    runAfterBilibiliRender()
  }

  const lifecycleMethods = ['update', 'updated', 'connectedCallback'] as const
  let patchedMethod: typeof lifecycleMethods[number] | null = null
  let originalMethod: ((...args: any[]) => any) | null = null

  for (const methodName of lifecycleMethods) {
    const method = findCommentComponentLifecycleMethod(prototype, methodName)
    if (typeof method === 'function') {
      patchedMethod = methodName
      originalMethod = method
      break
    }
  }

  if (!patchedMethod || !originalMethod) {
    if (!options?.silent)
      console.warn(`[${SCRIPT_NAME}] Skip patching ${name}: no suitable lifecycle method.`)
    return false
  }

  const boundOriginal = originalMethod
  const patched = function (this: any, ...updateArgs: any[]) {
    const result = Reflect.apply(boundOriginal, this, updateArgs)
    scheduleEnhance(this)
    return result
  }

  Object.defineProperty(prototype, patchedMethod, {
    configurable: true,
    writable: true,
    value: patched,
  })
  Object.defineProperty(prototype, COMMENT_COMPONENT_PATCHED, {
    configurable: true,
    value: true,
  })
  return true
}

function toIdString(id: unknown): string | null {
  if (id === null || id === undefined || id === '')
    return null
  return String(id)
}

export function getReplyRpid(replyItem: any): string | null {
  return toIdString(replyItem?.rpid_str ?? replyItem?.rpid)
}

export function getReplyRootRpid(replyItem: any): string | null {
  return toIdString(replyItem?.root_str ?? replyItem?.root)
}

export function getReplyParentRpid(replyItem: any): string | null {
  return toIdString(replyItem?.parent_str ?? replyItem?.parent)
}

export function getReplyAuthorName(replyItem: any): string | null {
  const authorName = replyItem?.member?.uname
    ?? replyItem?.member?.name
    ?? replyItem?.uname
    ?? replyItem?.name
  return typeof authorName === 'string' && authorName.trim()
    ? authorName.trim()
    : null
}

/** 从评论组件解析作者昵称（含 DOM 回退，折叠后 data 偶发缺失） */
export function getCommentRendererAuthorName(renderer: HTMLElement | null | undefined): string | null {
  if (!renderer)
    return null

  const fromData = getReplyAuthorName(getCommentReplyData(renderer))
  if (fromData)
    return fromData

  const shadow = renderer.shadowRoot
  if (!shadow)
    return null

  const nameCandidates = [
    shadow.querySelector('#user-name'),
    shadow.querySelector('.user-name'),
    shadow.querySelector('bili-comment-user-info'),
  ]
  for (const el of nameCandidates) {
    const text = el?.textContent?.trim()
    if (text)
      return text
  }
  return null
}

export function getCommentReplyData(component: any): any | null {
  const userInfoData = component?.shadowRoot
    ?.querySelector('bili-comment-user-info')
    ?.data
  const candidates = [component?.data, component?.reply, component?.replyItem, userInfoData]
  return candidates.find(candidate => candidate && typeof candidate === 'object') ?? null
}

export function findCommentPropertyDescriptor(
  prototype: object,
  property: string,
): PropertyDescriptor | null {
  let current: object | null = prototype
  while (current && current !== Object.prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(current, property)
    if (descriptor)
      return descriptor
    current = Object.getPrototypeOf(current)
  }
  return null
}

export function getCommentReplyPaginationIdentity(renderer: any): string {
  const data = getCommentReplyData(renderer) ?? {}
  const oid = toIdString(renderer.oid) ?? toIdString(data.oid_str ?? data.oid)
  const type = toIdString(renderer.type) ?? toIdString(data.type ?? data.business)
  const root = toIdString(renderer.root) ?? getReplyRpid(data) ?? getReplyRootRpid(data)
  return [oid ?? '', type ?? '', root ?? ''].join('|')
}

export function getCommentReplyInvisibleIds(renderer: any): Set<string> {
  if (!renderer.invisibleID || typeof renderer.invisibleID !== 'object')
    return new Set()
  return new Set(
    Object.keys(renderer.invisibleID).filter(rpid => renderer.invisibleID[rpid]),
  )
}

/** 从评论子组件向上找到所属的 bili-comment-replies-renderer */
export function findCommentRepliesRendererHost(component: HTMLElement | null | undefined): HTMLElement | null {
  let node: Node | null = component ?? null
  for (let depth = 0; depth < 10 && node; depth++) {
    if (node instanceof ShadowRoot) {
      node = node.host
      continue
    }
    if (node instanceof HTMLElement && node.localName === 'bili-comment-replies-renderer')
      return node
    node = node.parentNode
  }
  return null
}

/** 从主评论内的图片等子组件向上找到同一楼层的回复容器 */
export function findCommentThreadRepliesRenderer(component: HTMLElement | null | undefined): HTMLElement | null {
  let node: Node | null = component ?? null
  for (let depth = 0; depth < 12 && node; depth++) {
    if (node instanceof ShadowRoot) {
      if (node.host.localName === 'bili-comment-thread-renderer')
        return node.querySelector<HTMLElement>('bili-comment-replies-renderer')
      node = node.host
      continue
    }
    if (node instanceof HTMLElement && node.localName === 'bili-comment-thread-renderer')
      return node.shadowRoot?.querySelector<HTMLElement>('bili-comment-replies-renderer') ?? null
    node = node.parentNode
  }
  return null
}

export function isCommentReplyRenderer(element: Element): element is HTMLElement {
  return element.localName === 'bili-comment-reply-renderer'
    || element.localName === 'bili-comment-renderer'
}
