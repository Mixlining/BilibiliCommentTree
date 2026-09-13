import {
  COMMENT_SHADOW_STYLE_PATCHES,
  SCRIPT_NAME,
} from './core/constants'
import {
  ensureCommentShadowStyle,
  findCommentRepliesRendererHost,
  findCommentThreadRepliesRenderer,
  patchCommentComponentUpdate,
} from './core/dom'
import {
  patchCommentRepliesRendererDisconnect,
  patchCommentReplyPaginationPrototype,
  syncRenderedCommentReplyInteraction,
} from './core/pagination'
import {
  cacheCommentReplyTreeMeta,
  getCommentReplyDeepLinkId,
  getCommentReplyTreeState,
  scheduleCommentReplyDeepLinkSettlement,
  scheduleCommentReplyTreeLayoutUpdate,
  updateCommentReplyTree,
} from './core/tree'
import { getCommentReplyTreeMode } from './settings'

function patchCommentCustomElement(name: string, classConstructor: unknown) {
  if (typeof classConstructor !== 'function')
    return

  if (name === 'bili-comment-replies-renderer') {
    patchCommentReplyPaginationPrototype(classConstructor)
    patchCommentRepliesRendererDisconnect(classConstructor)
  }

  if (name === 'bili-comment-action-buttons-renderer') {
    try {
      // 点赞等交互先落到渲染组件，再同步回分页缓存，避免翻页后状态回滚。
      patchCommentComponentUpdate(name, classConstructor, (component) => {
        syncRenderedCommentReplyInteraction(component)
      })
    }
    catch (error) {
      console.warn(`[${SCRIPT_NAME}] Failed to patch ${name}.`, error)
    }
    return
  }

  const shadowStylePatch = COMMENT_SHADOW_STYLE_PATCHES[name]
  if (shadowStylePatch) {
    try {
      patchCommentComponentUpdate(name, classConstructor, (component) => {
        const root = component.shadowRoot
        if (!root)
          return

        ensureCommentShadowStyle(root, shadowStylePatch.id, shadowStylePatch.css)
        if (name === 'bili-comment-thread-renderer') {
          // 删除/屏蔽回复可能让楼层组件整体重绘，之前挂在其 shadow root
          // 内的 SVG 线条会随渲染结果一并被移除；重绘完成后从当前回复容器恢复。
          const repliesRenderer = root.querySelector('bili-comment-replies-renderer') as HTMLElement | null
          if (repliesRenderer) {
            updateCommentReplyTree(repliesRenderer)
            if (getCommentReplyDeepLinkId())
              scheduleCommentReplyDeepLinkSettlement('hash')
          }
        }
        else if (name === 'bili-comment-replies-renderer') {
          updateCommentReplyTree(component)
          // 深链目标楼中楼刚挂载/更新时再结算一次
          if (getCommentReplyDeepLinkId())
            scheduleCommentReplyDeepLinkSettlement('hash')
        }
      })
    }
    catch (error) {
      console.warn(`[${SCRIPT_NAME}] Failed to patch ${name}.`, error)
    }
    return
  }

  if (name === 'bili-comment-reply-renderer') {
    try {
      patchCommentComponentUpdate(name, classConstructor, (component) => {
        const rootNode = component.getRootNode?.()
        const repliesRenderer = rootNode instanceof ShadowRoot ? rootNode.host : null
        if (repliesRenderer?.localName === 'bili-comment-replies-renderer') {
          updateCommentReplyTree(repliesRenderer)
          if (getCommentReplyDeepLinkId())
            scheduleCommentReplyDeepLinkSettlement('hash')
        }
      })
    }
    catch (error) {
      console.warn(`[${SCRIPT_NAME}] Failed to patch ${name}.`, error)
    }
    return
  }

  // 处理评论区图片组件
  if (name === 'bili-comment-pictures-renderer') {
    try {
      patchCommentComponentUpdate(name, classConstructor, (component) => {
        // 图片组件位于主评论的嵌套 shadow DOM 中，图片尺寸变化不一定能
        // 通过回复容器的 ResizeObserver 传递出来；尺寸调整后主动重算树线。
        const repliesRenderer = findCommentThreadRepliesRenderer(component)
        if (repliesRenderer)
          scheduleCommentReplyTreeLayoutUpdate(repliesRenderer)
      })
    }
    catch (error) {
      console.warn(`[${SCRIPT_NAME}] Failed to patch ${name}.`, error)
    }
    return
  }

  // 处理评论用户信息组件：仅保留树关系缓存（IP/性别/楼主标识不移植）
  if (name === 'bili-comment-user-info') {
    try {
      patchCommentComponentUpdate(name, classConstructor, (component) => {
        const root = component.shadowRoot
        if (!root)
          return

        // 找到用户名元素
        const userNameEl = root.querySelector('#user-name')
        if (!userNameEl)
          return

        // 楼中楼 user-info 先于/并行于 replies 树更新时也写入关系缓存，避免跨页丢 parent
        const repliesRenderer = findCommentRepliesRendererHost(component)
        if (repliesRenderer && component.data && getCommentReplyTreeMode() !== null)
          cacheCommentReplyTreeMeta(getCommentReplyTreeState(repliesRenderer), component.data)
      })
    }
    catch (error) {
      console.warn(`[${SCRIPT_NAME}] Failed to patch ${name}.`, error)
    }
  }
}

export function initCommentCustomElementPatching() {
  // 油猴沙箱中的 window 是代理；劫持必须落在真实页面窗口的
  // customElements 注册表上，页面脚本调用 define 时才会经过补丁。
  const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window
  if (!targetWindow.customElements) {
    console.warn(`[${SCRIPT_NAME}] customElements is unavailable; comment tree disabled.`)
    return
  }

  const { define: originalDefine } = targetWindow.customElements
  targetWindow.customElements.define = new Proxy(originalDefine, {
    apply: (target, thisArg, args) => {
      const [name, classConstructor] = args
      if (typeof name === 'string')
        patchCommentCustomElement(name, classConstructor)
      return Reflect.apply(target, thisArg, args)
    },
  })

  // document_start 仍可能晚于页面内联脚本；回补已经注册的评论组件。
  const commentElementNames = new Set([
    ...Object.keys(COMMENT_SHADOW_STYLE_PATCHES),
    'bili-comment-action-buttons-renderer',
    'bili-comment-reply-renderer',
    'bili-comment-pictures-renderer',
    'bili-comment-user-info',
  ])
  for (const name of commentElementNames)
    patchCommentCustomElement(name, targetWindow.customElements.get(name))
}
