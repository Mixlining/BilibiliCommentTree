import {
  REPLY_AT_COLON_PREFIX,
  REPLY_AT_PREFIX_SINGLE,
  REPLY_AT_PREFIX_WORD,
} from './constants'
import { findCommentRichTextContents } from './replyText'

const commentReplyAtPrefixObservers = new WeakMap<HTMLElement, MutationObserver>()

function disconnectCommentReplyAtPrefixObserver(renderer: HTMLElement) {
  const observer = commentReplyAtPrefixObservers.get(renderer)
  if (!observer)
    return
  observer.disconnect()
  commentReplyAtPrefixObservers.delete(renderer)
}

function ensureCommentReplyAtPrefixObserver(renderer: HTMLElement) {
  // 每次重建，确保新挂载的 bili-rich-text shadow 也被监听到
  disconnectCommentReplyAtPrefixObserver(renderer)

  const observer = new MutationObserver(() => {
    if (!renderer.isConnected || !renderer.hasAttribute('data-bewly-hide-reply-at')) {
      disconnectCommentReplyAtPrefixObserver(renderer)
      return
    }
    // 富文本重绘后重新隐藏前缀（自身改 DOM 时若已处理会直接 return）
    applyCommentReplyAtPrefixHidden(renderer, true)
  })

  const observeTargets = new Set<Node>()
  if (renderer.shadowRoot)
    observeTargets.add(renderer.shadowRoot)
  findCommentRichTextContents(renderer).forEach((contents) => {
    observeTargets.add(contents)
    const root = contents.getRootNode()
    if (root instanceof ShadowRoot)
      observeTargets.add(root)
  })
  renderer.shadowRoot?.querySelectorAll('bili-rich-text').forEach((richText) => {
    if (richText.shadowRoot)
      observeTargets.add(richText.shadowRoot)
  })

  observeTargets.forEach((target) => {
    observer.observe(target, { childList: true, subtree: true, characterData: true })
  })
  commentReplyAtPrefixObservers.set(renderer, observer)
}

function applyCommentReplyAtPrefixHidden(renderer: HTMLElement, hidden: boolean) {
  findCommentRichTextContents(renderer).forEach((contents) => {
    if (!hidden) {
      unwrapBewlyHiddenReplyAtPrefix(contents)
      return
    }
    hideLeadingReplyAtPrefixInContents(contents)
  })
}

export function setCommentReplyAtPrefixHidden(renderer: HTMLElement, hidden: boolean) {
  renderer.toggleAttribute('data-bewly-hide-reply-at', hidden)
  applyCommentReplyAtPrefixHidden(renderer, hidden)

  if (hidden)
    ensureCommentReplyAtPrefixObserver(renderer)
  else
    disconnectCommentReplyAtPrefixObserver(renderer)
}

function unwrapBewlyHiddenReplyAtPrefix(contents: HTMLElement) {
  // 还原被改写的正文 span（: 前缀拆分）
  contents.querySelectorAll<HTMLElement>('[data-bewly-reply-at-rest]').forEach((el) => {
    const original = el.dataset.bewlyReplyAtOriginal
    if (original !== undefined)
      el.textContent = original
    delete el.dataset.bewlyReplyAtRest
    delete el.dataset.bewlyReplyAtOriginal
  })

  contents.querySelectorAll('[data-bewly-hide-reply-at]').forEach((el) => {
    const parent = el.parentNode
    if (!parent)
      return
    while (el.firstChild)
      parent.insertBefore(el.firstChild, el)
    parent.removeChild(el)
  })
}

function wrapNodesAndHideReplyAtPrefix(nodes: Node[]) {
  if (nodes.length === 0)
    return

  const first = nodes[0]
  const parent = first.parentNode
  if (!parent)
    return

  const wrapper = document.createElement('span')
  wrapper.dataset.bewlyHideReplyAt = 'true'
  wrapper.style.display = 'none'
  parent.insertBefore(wrapper, first)
  nodes.forEach(node => wrapper.appendChild(node))
}

function findFirstReplyAtTextNode(root: Node): Text | null {
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      if ((node.textContent || '').trim())
        return node as Text
      continue
    }
    if (node.nodeType !== Node.ELEMENT_NODE)
      continue
    const textNode = findFirstReplyAtTextNode(node)
    if (textNode)
      return textNode
  }
  return null
}

function hideSingleTextReplyAtPrefix(textNode: Text): boolean {
  const match = textNode.data.match(REPLY_AT_PREFIX_SINGLE)
  if (!match)
    return false

  const parent = textNode.parentNode
  if (!parent)
    return false

  const prefix = match[0]
  const rest = textNode.data.slice(prefix.length)
  const wrapper = document.createElement('span')
  wrapper.dataset.bewlyHideReplyAt = 'true'
  wrapper.style.display = 'none'
  wrapper.textContent = prefix

  if (rest) {
    const restNode = document.createTextNode(rest)
    parent.replaceChild(restNode, textNode)
    parent.insertBefore(wrapper, restNode)
  }
  else {
    parent.replaceChild(wrapper, textNode)
  }
  return true
}

function isReplyAtMentionElement(node: Node): node is HTMLElement {
  if (!(node instanceof HTMLElement))
    return false
  if (node.getAttribute('data-type') === 'mention')
    return true
  if (node.localName === 'a' && (node.textContent || '').trim().startsWith('@'))
    return true
  return Boolean(node.querySelector?.('a[data-type="mention"], a[href*="space.bilibili.com"]'))
}

function hideLeadingReplyAtPrefixInContents(contents: HTMLElement) {
  if (contents.querySelector('[data-bewly-hide-reply-at], [data-bewly-reply-at-rest]')) {
    contents.querySelectorAll<HTMLElement>('[data-bewly-hide-reply-at]').forEach((el) => {
      el.style.display = 'none'
    })
    return
  }

  const nodes = Array.from(contents.childNodes).filter((node) => {
    if (node.nodeType === Node.TEXT_NODE)
      return Boolean((node.textContent || '').trim())
    return node.nodeType === Node.ELEMENT_NODE
  })
  if (nodes.length === 1) {
    const [onlyNode] = nodes
    if (onlyNode?.nodeType === Node.TEXT_NODE) {
      hideSingleTextReplyAtPrefix(onlyNode as Text)
    }
    else if (onlyNode instanceof HTMLElement) {
      const firstTextNode = findFirstReplyAtTextNode(onlyNode)
      if (firstTextNode)
        hideSingleTextReplyAtPrefix(firstTextNode)
    }
    return
  }
  if (nodes.length < 2)
    return

  const first = nodes[0]
  const second = nodes[1]
  const third = nodes[2] as Node | undefined

  // 主路径：<span>回复 </span><a data-type="mention">@xxx</a><span> : 正文</span>
  const firstText = (first.textContent || '').trimEnd()
  const isReplyWord = REPLY_AT_PREFIX_WORD.test(firstText)

  if (isReplyWord && isReplyAtMentionElement(second)) {
    const toHide: Node[] = [first, second]

    if (third && (third.nodeType === Node.ELEMENT_NODE || third.nodeType === Node.TEXT_NODE)) {
      const colonHost = third
      const colonText = colonHost.textContent || ''
      const colonMatch = colonText.match(REPLY_AT_COLON_PREFIX)
      if (colonMatch) {
        const prefix = colonMatch[0]
        const rest = colonText.slice(prefix.length)
        if (colonHost instanceof HTMLElement) {
          // 第三段常为 <span> : 正文</span>，只去掉冒号前缀
          colonHost.dataset.bewlyReplyAtRest = 'true'
          colonHost.dataset.bewlyReplyAtOriginal = colonText
          colonHost.textContent = rest
        }
        else if (colonHost.nodeType === Node.TEXT_NODE) {
          if (rest) {
            const hideColon = document.createTextNode(prefix)
            const restAfterColon = document.createTextNode(rest)
            const parent = colonHost.parentNode
            if (parent) {
              parent.replaceChild(restAfterColon, colonHost)
              parent.insertBefore(hideColon, restAfterColon)
              toHide.push(hideColon)
            }
          }
          else {
            toHide.push(colonHost)
          }
        }
      }
    }

    wrapNodesAndHideReplyAtPrefix(toHide)
    return
  }

  // 兼容单文本节点：回复 @name : 内容
  if (first.nodeType === Node.TEXT_NODE) {
    hideSingleTextReplyAtPrefix(first as Text)
  }
}
