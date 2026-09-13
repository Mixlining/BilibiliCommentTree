import {
  buildOffpageParentTitle,
  COMMENT_REPLY_OFFPAGE_PARENT_CSS,
  COMMENT_REPLY_OFFPAGE_PARENT_ID,
  COMMENT_REPLY_OFFPAGE_PARENT_STYLE_ID,
  OFFPAGE_BADGE_TEXT,
  OFFPAGE_REPLY_WORD,
} from './constants'
import { ensureCommentShadowStyle } from './dom'
import { truncateReplyMessageSnippet } from './replyText'

type CommentReplyOffpageParentMode = 'quote' | 'compact'

/**
 * 直接父回复不在本页时的标注：
 * - 有正文缓存 → quote：带样式引用原正文
 * - 无正文但有父 rpid → compact：回复 + @昵称 + 不在本页
 * 父在本页时移除标注。
 */
export function updateCommentReplyOffpageParentLabel(
  renderer: HTMLElement,
  options: {
    authorName: string | null
    messageText: string | null
    parentRpid: string | null
    show: boolean
  },
) {
  const { authorName, messageText, parentRpid, show } = options
  const root = renderer.shadowRoot
  const fullQuote = messageText?.trim() || ''
  const mode: CommentReplyOffpageParentMode | null = !show
    ? null
    : fullQuote
      ? 'quote'
      : parentRpid
        ? 'compact'
        : null

  if (!root) {
    if (!mode) {
      delete renderer.dataset.bewlyParentOffpage
      delete renderer.dataset.bewlyParentAuthor
      delete renderer.dataset.bewlyParentRpid
    }
    return
  }

  let label = root.querySelector<HTMLElement>(`#${COMMENT_REPLY_OFFPAGE_PARENT_ID}`)

  if (!mode) {
    label?.remove()
    delete renderer.dataset.bewlyParentOffpage
    delete renderer.dataset.bewlyParentAuthor
    delete renderer.dataset.bewlyParentRpid
    return
  }

  renderer.dataset.bewlyParentOffpage = mode
  if (authorName)
    renderer.dataset.bewlyParentAuthor = authorName
  else
    delete renderer.dataset.bewlyParentAuthor
  if (parentRpid)
    renderer.dataset.bewlyParentRpid = parentRpid
  else
    delete renderer.dataset.bewlyParentRpid

  ensureCommentShadowStyle(root, COMMENT_REPLY_OFFPAGE_PARENT_STYLE_ID, COMMENT_REPLY_OFFPAGE_PARENT_CSS)

  if (!label) {
    label = document.createElement('div')
    label.id = COMMENT_REPLY_OFFPAGE_PARENT_ID
    label.innerHTML = [
      '<div class="bewly-reply-offpage-parent__head">',
      '<span class="bewly-reply-offpage-parent__reply-word"></span>',
      '<span class="bewly-reply-offpage-parent__at"></span>',
      '<span class="bewly-reply-offpage-parent__badge"></span>',
      '</div>',
      '<div class="bewly-reply-offpage-parent__quote"></div>',
    ].join('')
    const richText = root.querySelector('bili-rich-text')
    const body = root.querySelector('#body') ?? root.querySelector('#main')
    if (richText?.parentElement)
      richText.parentElement.insertBefore(label, richText)
    else if (body)
      body.insertAdjacentElement('afterbegin', label)
    else
      root.appendChild(label)
  }

  label.dataset.mode = mode

  // compact 无昵称时仍展示 @ 占位，避免只剩「回复 / 不在本页」语义不清
  const atText = authorName ? `@${authorName}` : '@…'

  const replyWordEl = label.querySelector<HTMLElement>('.bewly-reply-offpage-parent__reply-word')
  const atEl = label.querySelector<HTMLElement>('.bewly-reply-offpage-parent__at')
  const badgeEl = label.querySelector<HTMLElement>('.bewly-reply-offpage-parent__badge')
  const quoteEl = label.querySelector<HTMLElement>('.bewly-reply-offpage-parent__quote')

  if (replyWordEl)
    replyWordEl.textContent = OFFPAGE_REPLY_WORD
  if (atEl)
    atEl.textContent = atText
  if (badgeEl)
    badgeEl.textContent = OFFPAGE_BADGE_TEXT

  if (quoteEl) {
    if (mode === 'quote') {
      quoteEl.textContent = truncateReplyMessageSnippet(fullQuote)
      quoteEl.hidden = false
    }
    else {
      quoteEl.textContent = ''
      quoteEl.hidden = true
    }
  }

  const tooltipHead = authorName
    ? buildOffpageParentTitle(authorName)
    : `${OFFPAGE_REPLY_WORD} ${atText} · ${OFFPAGE_BADGE_TEXT}`
  label.setAttribute(
    'title',
    mode === 'quote' && fullQuote ? `${tooltipHead}\n${fullQuote}` : tooltipHead,
  )
}

export function clearCommentReplyOffpageParentLabel(renderer: HTMLElement) {
  updateCommentReplyOffpageParentLabel(renderer, {
    authorName: null,
    messageText: null,
    parentRpid: null,
    show: false,
  })
}
