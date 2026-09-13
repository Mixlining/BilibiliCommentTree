import { COMMENT_REPLY_OFFPAGE_PARENT_SNIPPET_MAX } from './constants'

/** 从子回复正文「回复 @xxx」前缀解析被回复者昵称（父评未缓存时的回退） */
export function getReplyAtAuthorFromMessage(replyItem: any): string | null {
  const raw = typeof replyItem?.content?.message === 'string'
    ? replyItem.content.message
    : typeof replyItem?.message === 'string'
      ? replyItem.message
      : null
  if (!raw)
    return null
  // 用单一 \s+ 避免 \s*@?\s* 回溯；@ 可选，捕获昵称
  const match = raw.match(/^(?:回复|回覆|Reply(?:\s+to)?)\s+@?([^\s:：]+)/iu)
  const name = match?.[1]?.trim()
  return name || null
}

/** 去掉「回复 @xxx :」前缀并压空白，供缓存与引用展示 */
function normalizeReplyMessageText(text: string | null | undefined): string | null {
  if (typeof text !== 'string')
    return null
  // @ 已可由 [^\s:：]+ 吞掉，无需再写 @?
  const stripped = text
    .replace(/^(?:回复|回覆|Reply(?:\s+to)?)\s+[^\s:：]+(?:\s*[:：]\s*|\s+)/iu, '')
    .replace(/\s+/gu, ' ')
    .trim()
  return stripped || null
}

export function getReplyMessageText(replyItem: any): string | null {
  if (!replyItem || typeof replyItem !== 'object')
    return null

  const candidates = [
    replyItem?.content?.message,
    replyItem?.content?.text,
    replyItem?.message,
    replyItem?.text,
  ]
  for (const candidate of candidates) {
    const normalized = normalizeReplyMessageText(typeof candidate === 'string' ? candidate : null)
    if (normalized)
      return normalized
  }
  return null
}

export function pickRicherReplyMessageText(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a)
    return b ?? null
  if (!b)
    return a
  return b.length > a.length ? b : a
}

export function truncateReplyMessageSnippet(
  text: string,
  maxLen = COMMENT_REPLY_OFFPAGE_PARENT_SNIPPET_MAX,
): string {
  if (text.length <= maxLen)
    return text
  return `${text.slice(0, maxLen).trimEnd()}…`
}

export function findCommentRichTextContents(renderer: HTMLElement): HTMLElement[] {
  const root = renderer.shadowRoot
  if (!root)
    return []

  const richTexts = Array.from(root.querySelectorAll('bili-rich-text'))
  const contentsList: HTMLElement[] = []
  richTexts.forEach((richText) => {
    const contents = richText.shadowRoot?.querySelector<HTMLElement>('#contents')
    if (contents)
      contentsList.push(contents)
  })

  // 兼容未再套一层 shadow 的正文容器
  const directContents = root.querySelector<HTMLElement>('#content #contents, #contents')
  if (directContents && !contentsList.includes(directContents))
    contentsList.push(directContents)

  return contentsList
}

export function getCommentRendererMessageText(renderer: HTMLElement): string | null {
  const contentsList = findCommentRichTextContents(renderer)
  if (contentsList.length === 0)
    return null

  const raw = contentsList
    .map((contents) => {
      // 忽略我们隐藏的「回复 @」前缀节点，避免污染正文缓存；
      // 无该标记时子树无需克隆
      if (!contents.querySelector('[data-bewly-hide-reply-at]'))
        return contents.textContent || ''
      const clone = contents.cloneNode(true) as HTMLElement
      clone.querySelectorAll('[data-bewly-hide-reply-at]').forEach(el => el.remove())
      return clone.textContent || ''
    })
    .join(' ')
  return normalizeReplyMessageText(raw)
}
