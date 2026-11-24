import { ensureOverlayStyles, getOverlayContainer } from './overlay'

const TOAST_ID = 'bewly-comment-toast'
const TOAST_REGION_ID = 'bewly-comment-toast-region'
const TOAST_MESSAGE_ID = 'bewly-comment-toast-message'
const TOAST_LIVE_ID = 'bewly-comment-toast-live'
const TOAST_DURATION_MS = 4000

type ToggleEventLike = Event & { newState?: string }
type AriaNotifyDocument = Document & {
  ariaNotify?: (message: string, options?: { priority?: 'normal' | 'important' }) => void
}

let region: HTMLElement | null = null
let toast: HTMLElement | null = null
let message: HTMLElement | null = null
let liveRegion: HTMLElement | null = null
let timer: number | undefined
let timerStartedAt = 0
let remainingMs = TOAST_DURATION_MS
let paused = false
let previousFocus: HTMLElement | null = null
let focusWasInside = false
const boundToasts = new WeakSet<HTMLElement>()
let visibilityBound = false

/**
 * 用户主动操作失败时的唯一反馈出口。
 * 顶部居中 toast 位于 top layer，不受 B 站 z-index/transform/overflow 影响。
 */
export function showErrorToast(text: string) {
  const element = ensureToast()
  if (!element || !message) {
    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', () => showErrorToast(text), { once: true })
    return
  }

  const wasOpen = element.matches(':popover-open')
  if (!wasOpen) {
    previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    focusWasInside = false
  }

  message.textContent = text
  if (!wasOpen) {
    try {
      element.showPopover()
      // 不同 Chromium 版本对 popover 的初始焦点处理不完全一致；
      // toast 不应抢走用户当前焦点（否则 4 秒计时也会被暂停）。
      restoreStolenFocus(element)
      window.requestAnimationFrame(() => {
        if (element.matches(':popover-open'))
          restoreStolenFocus(element)
      })
    }
    catch {
      // 极早期或已被移出 DOM 时忽略；下一次错误会重新尝试。
    }
  }

  announce(text)
  restartTimer()
  if (document.hidden || element.matches(':hover') || element.contains(document.activeElement))
    pauseTimer()
}

function restoreStolenFocus(element: HTMLElement) {
  if (!element.contains(document.activeElement))
    return

  focusWasInside = false
  if (previousFocus?.isConnected)
    previousFocus.focus({ preventScroll: true })
  else if (document.activeElement instanceof HTMLElement)
    document.activeElement.blur()
  resumeTimer()
}

function ensureToast(): HTMLElement | null {
  ensureOverlayStyles()
  if (toast?.isConnected)
    return toast

  const container = getOverlayContainer()
  if (!container)
    return null

  region = document.getElementById(TOAST_REGION_ID)
  if (!region) {
    region = document.createElement('div')
    region.id = TOAST_REGION_ID
    region.setAttribute('role', 'region')
    region.setAttribute('aria-label', '评论树通知')
    container.appendChild(region)
  }
  else if (!region.isConnected) {
    container.appendChild(region)
  }

  liveRegion = document.getElementById(TOAST_LIVE_ID)
  if (!liveRegion) {
    liveRegion = document.createElement('div')
    liveRegion.id = TOAST_LIVE_ID
    liveRegion.className = 'bewly-visually-hidden'
    liveRegion.setAttribute('aria-live', 'polite')
    liveRegion.setAttribute('aria-atomic', 'true')
    container.appendChild(liveRegion)
  }
  else if (!liveRegion.isConnected) {
    container.appendChild(liveRegion)
  }

  toast = document.getElementById(TOAST_ID) as HTMLElement | null
  if (!toast) {
    toast = document.createElement('div')
    toast.id = TOAST_ID
    // 使用属性而不是 IDL，避免未来 polyfill 在脚本早期被属性访问器遮蔽。
    toast.setAttribute('popover', 'manual')

    message = document.createElement('span')
    message.id = TOAST_MESSAGE_ID
    message.className = 'bewly-comment-toast__message'

    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'bewly-comment-toast__close'
    close.setAttribute('popovertarget', TOAST_ID)
    close.setAttribute('popovertargetaction', 'hide')
    close.setAttribute('aria-label', '关闭通知')
    close.textContent = '×'

    toast.append(message, close)
    region.appendChild(toast)
    bindToastListeners(toast)
  }
  else {
    message = toast.querySelector<HTMLElement>(`#${TOAST_MESSAGE_ID}`)
    if (!message) {
      message = document.createElement('span')
      message.id = TOAST_MESSAGE_ID
      message.className = 'bewly-comment-toast__message'
      toast.prepend(message)
    }
    if (!toast.isConnected && region)
      region.appendChild(toast)
    bindToastListeners(toast)
  }

  return toast
}

function bindToastListeners(element: HTMLElement) {
  if (boundToasts.has(element))
    return
  boundToasts.add(element)

  element.addEventListener('pointerenter', pauseTimer)
  element.addEventListener('pointerleave', resumeTimer)
  element.addEventListener('focusin', () => {
    focusWasInside = true
    pauseTimer()
  })
  element.addEventListener('focusout', (event) => {
    const next = event.relatedTarget as Node | null
    if (next && element.contains(next))
      return
    // 点关闭按钮会先触发 focusout 再触发 toggle；延迟到下一轮再判断，
    // 避免关闭时误清 focusWasInside 导致焦点无法回到打开前的位置。
    window.setTimeout(() => {
      if (!element.matches(':popover-open'))
        return
      focusWasInside = false
      resumeTimer()
    }, 0)
  })
  element.addEventListener('toggle', (event) => {
    if ((event as ToggleEventLike).newState === 'closed')
      handleClosed()
  })

  if (!visibilityBound) {
    visibilityBound = true
    document.addEventListener('visibilitychange', () => {
      if (document.hidden)
        pauseTimer()
      else
        resumeTimer()
    })
  }
}

function announce(text: string) {
  const notify = (document as AriaNotifyDocument).ariaNotify
  if (typeof notify === 'function') {
    try {
      notify.call(document, text, { priority: 'normal' })
      return
    }
    catch {
      // 回退到 live-region。
    }
  }

  // Chrome 150 已稳定支持 ariaNotify；保留最小 live-region 回退。
  if (!liveRegion)
    return
  liveRegion.textContent = ''
  window.setTimeout(() => {
    if (liveRegion)
      liveRegion.textContent = text
  }, 0)
}

function restartTimer() {
  clearTimer()
  paused = false
  remainingMs = TOAST_DURATION_MS
  startTimer()
}

function startTimer() {
  if (!toast?.matches(':popover-open'))
    return
  timerStartedAt = performance.now()
  timer = window.setTimeout(hideToast, remainingMs)
}

function pauseTimer() {
  if (paused || timer === undefined)
    return
  paused = true
  remainingMs = Math.max(0, remainingMs - (performance.now() - timerStartedAt))
  clearTimer()
}

function resumeTimer() {
  if (!paused)
    return
  paused = false
  if (remainingMs <= 0) {
    hideToast()
    return
  }
  startTimer()
}

function clearTimer() {
  if (timer === undefined)
    return
  window.clearTimeout(timer)
  timer = undefined
}

function hideToast() {
  clearTimer()
  if (!toast?.matches(':popover-open'))
    return
  try {
    toast.hidePopover()
  }
  catch {
    handleClosed()
  }
}

function handleClosed() {
  clearTimer()
  paused = false
  remainingMs = TOAST_DURATION_MS

  const shouldRestoreFocus = focusWasInside
  focusWasInside = false
  const target = previousFocus
  previousFocus = null
  if (shouldRestoreFocus && target?.isConnected)
    target.focus({ preventScroll: true })
}
