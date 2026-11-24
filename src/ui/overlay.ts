import OVERLAY_CSS from './overlay.scss?inline'

const OVERLAY_STYLE_ID = 'bewly-comment-overlay-style'

/** 只注入一次；浮层脚本可能在 document-start 之后任意时刻才真正挂载。 */
export function ensureOverlayStyles() {
  if (document.getElementById(OVERLAY_STYLE_ID))
    return

  const parent = document.head
  if (!parent) {
    document.addEventListener('DOMContentLoaded', ensureOverlayStyles, { once: true })
    return
  }

  const style = document.createElement('style')
  style.id = OVERLAY_STYLE_ID
  style.textContent = OVERLAY_CSS
  parent.appendChild(style)
}

export function getOverlayContainer(): HTMLElement | null {
  // 浮层必须挂在 body 下；document-start 时 body 尚未创建，调用方会等待 DOMContentLoaded。
  return document.body
}
