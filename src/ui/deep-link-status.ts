import { SCRIPT_NAME } from '../core/constants'
import { getCommentReplyData, getReplyRpid } from '../core/dom'
import { showErrorToast } from './status'

let notifiedFor: string | null = null

/**
 * 深链结算窗口结束时目标评论仍不在 DOM，给用户一次明确反馈。
 * 扫描逻辑放在自有 UI 层，上游派生文件只保留一个调用点。
 */
export function notifyCommentReplyDeepLinkMiss(targetId: string | null) {
  if (!targetId || targetId === notifiedFor)
    return
  if (isCommentReplyDeepLinkTargetPresent(targetId))
    return

  notifiedFor = targetId
  console.warn(`[${SCRIPT_NAME}] Comment reply deep link target not found.`, targetId)
  showErrorToast('未找到目标评论，可能已被删除或不在当前页')
}

/**
 * 深链目标可能在多层 Lit shadow root 内；只在结算结束时扫描一次，
 * 不参与布局或滚动路径。读取组件 data 比解析文本更可靠。
 */
function isCommentReplyDeepLinkTargetPresent(rpid: string): boolean {
  return scanCommentReplyTarget(document, rpid, new Set<Node>(), 0)
}

function scanCommentReplyTarget(
  root: ParentNode,
  rpid: string,
  visited: Set<Node>,
  depth: number,
): boolean {
  if (depth > 8)
    return false

  for (const element of root.querySelectorAll<HTMLElement>('*')) {
    if (
      element.localName === 'bili-comment-renderer'
      || element.localName === 'bili-comment-reply-renderer'
      || element.localName === 'bili-comment-thread-renderer'
    ) {
      const data = getCommentReplyData(element)
      if (getReplyRpid(data) === rpid || getReplyRpid(element as any) === rpid)
        return true
    }

    const shadow = element.shadowRoot
    if (shadow && !visited.has(shadow)) {
      visited.add(shadow)
      if (scanCommentReplyTarget(shadow, rpid, visited, depth + 1))
        return true
    }
  }
  return false
}
