import type { CommentReplyPaginationMode, CommentReplyTreeMode, ScriptSettings } from '../settings/model'
import {
  COMMENT_REPLY_CONTAINER_PREVIEW_HEIGHT_VAR,
  COMMENT_REPLY_TREE_CONTAINER_MAX_HEIGHT,
  COMMENT_REPLY_TREE_CONTAINER_MIN_HEIGHT,
} from '../core/constants'
import { getScriptSettings, registerSettingsChangeListener, updateScriptSettings } from '../settings'
import { createDefaultSettings, PAGINATION_MODES, TREE_MODES } from '../settings/model'
import { ensureOverlayStyles, getOverlayContainer } from './overlay'

const DIALOG_ID = 'bewly-comment-settings-dialog'
const TITLE_ID = 'bewly-comment-settings-title'
const HEIGHT_ID = 'bewly-comment-settings-height'
const TREE_MODE_GROUP = 'bewly-comment-settings-tree-mode'
const PAGINATION_MODE_GROUP = 'bewly-comment-settings-pagination-mode'

const TREE_MODE_LABELS: Record<CommentReplyTreeMode, string> = {
  lineCollapseMain: '线条-收起主评论',
  lineKeepMain: '线条-不收起主评论',
  indentOnly: '缩进-无收起功能',
}
const PAGINATION_MODE_LABELS: Record<CommentReplyPaginationMode, string> = {
  loadMore: '更多',
  pagination: '分页',
}

type ToggleEventLike = Event & { newState?: string }

interface SettingsControls {
  enabled: HTMLInputElement
  treeModeInputs: HTMLInputElement[]
  paginationModeInputs: HTMLInputElement[]
  container: HTMLInputElement
  height: HTMLInputElement
  heightOutput: HTMLOutputElement
}

let dialog: HTMLDialogElement | null = null
let controls: SettingsControls | null = null
let returnFocus: HTMLElement | null = null
let settingsListenerBound = false

/** GM 菜单唯一入口：打开右侧非模态设置面板。 */
export function openSettingsDialog() {
  ensureOverlayStyles()
  const panel = ensureDialog()
  if (!panel) {
    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', openSettingsDialog, { once: true })
    return
  }

  if (panel.matches(':popover-open')) {
    focusInitialControl()
    return
  }

  returnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
    ? document.activeElement
    : null
  syncControls(getScriptSettings())

  try {
    panel.showPopover()
  }
  catch {
    return
  }
  focusInitialControl()
}

function ensureDialog(): HTMLDialogElement | null {
  if (dialog?.isConnected)
    return dialog

  const container = getOverlayContainer()
  if (!container)
    return null

  if (!dialog)
    dialog = createDialog()
  container.appendChild(dialog)
  bindDialogListeners()
  return dialog
}

function createDialog(): HTMLDialogElement {
  const panel = document.createElement('dialog')
  panel.id = DIALOG_ID
  panel.setAttribute('popover', 'auto')
  panel.setAttribute('aria-labelledby', TITLE_ID)

  const header = document.createElement('div')
  header.className = 'bewly-settings-panel__header'

  const title = document.createElement('h2')
  title.id = TITLE_ID
  title.className = 'bewly-settings-panel__title'
  title.textContent = '评论树设置'

  const headerClose = createCloseButton('bewly-settings-panel__icon-button', '关闭设置', '×')
  header.append(title, headerClose)

  const body = document.createElement('div')
  body.className = 'bewly-settings-panel__body'

  const enabledSwitch = createSwitchRow('启用树状显示', true)
  const enabledGroup = createGroup('显示')
  enabledGroup.appendChild(enabledSwitch.row)
  const enabledHint = document.createElement('p')
  enabledHint.className = 'bewly-settings-panel__hint'
  enabledHint.textContent = '关闭后保留现有配置，重新开启时立即应用。'
  enabledGroup.appendChild(enabledHint)

  const treeModeGroup = createGroup('树状样式')
  const treeModeOptions = document.createElement('div')
  treeModeOptions.className = 'bewly-settings-panel__options'
  const treeModeInputs = TREE_MODES.map(mode => createRadioOption(
    TREE_MODE_GROUP,
    mode,
    TREE_MODE_LABELS[mode],
    treeModeOptions,
  ))
  treeModeGroup.appendChild(treeModeOptions)

  const paginationModeGroup = createGroup('回复加载')
  const paginationModeOptions = document.createElement('div')
  paginationModeOptions.className = 'bewly-settings-panel__options'
  const paginationModeInputs = PAGINATION_MODES.map(mode => createRadioOption(
    PAGINATION_MODE_GROUP,
    mode,
    PAGINATION_MODE_LABELS[mode],
    paginationModeOptions,
  ))
  paginationModeGroup.appendChild(paginationModeOptions)

  const containerGroup = createGroup('回复容器')
  const containerSwitch = createSwitchRow('固定高度容器')
  const heightInput = createHeightRange()
  const heightOutput = document.createElement('output')
  heightOutput.className = 'bewly-settings-panel__range-output'
  heightOutput.setAttribute('for', HEIGHT_ID)

  const rangeHead = document.createElement('div')
  rangeHead.className = 'bewly-settings-panel__range-head'
  const rangeLabel = document.createElement('label')
  rangeLabel.htmlFor = HEIGHT_ID
  rangeLabel.textContent = '容器高度'
  rangeHead.append(rangeLabel, heightOutput)

  const containerHint = document.createElement('p')
  containerHint.className = 'bewly-settings-panel__hint'
  containerHint.textContent = '拖动时实时预览，松手后保存。'

  containerGroup.append(containerSwitch.row, rangeHead, heightInput, containerHint)

  body.append(enabledGroup, treeModeGroup, paginationModeGroup, containerGroup)

  const footer = document.createElement('div')
  footer.className = 'bewly-settings-panel__footer'

  const resetButton = document.createElement('button')
  resetButton.type = 'button'
  resetButton.className = 'bewly-settings-panel__button'
  resetButton.textContent = '恢复默认'

  const footerClose = createCloseButton('bewly-settings-panel__button', '关闭设置', '关闭')
  footerClose.dataset.variant = 'primary'

  footer.append(resetButton, footerClose)
  panel.append(header, body, footer)

  controls = {
    enabled: enabledSwitch.input,
    treeModeInputs,
    paginationModeInputs,
    container: containerSwitch.input,
    height: heightInput,
    heightOutput,
  }

  bindControlListeners(resetButton)
  syncControls(getScriptSettings())
  return panel
}

function createGroup(legendText: string): HTMLFieldSetElement {
  const group = document.createElement('fieldset')
  group.className = 'bewly-settings-panel__group'
  const legend = document.createElement('legend')
  legend.className = 'bewly-settings-panel__legend'
  legend.textContent = legendText
  group.appendChild(legend)
  return group
}

function createSwitchRow(labelText: string, autofocus = false): { row: HTMLLabelElement, input: HTMLInputElement } {
  const row = document.createElement('label')
  row.className = 'bewly-settings-panel__row'

  const text = document.createElement('span')
  text.textContent = labelText

  const switchWrap = document.createElement('span')
  switchWrap.className = 'bewly-settings-panel__switch'

  const input = document.createElement('input')
  input.type = 'checkbox'
  input.className = 'bewly-settings-panel__switch-input'
  input.setAttribute('role', 'switch')
  if (autofocus)
    input.setAttribute('autofocus', '')

  const track = document.createElement('span')
  track.className = 'bewly-settings-panel__switch-track'
  track.setAttribute('aria-hidden', 'true')

  switchWrap.append(input, track)
  row.append(text, switchWrap)
  return { row, input }
}

function createRadioOption(
  name: string,
  value: string,
  labelText: string,
  parent: HTMLElement,
): HTMLInputElement {
  const option = document.createElement('label')
  option.className = 'bewly-settings-panel__option'

  const input = document.createElement('input')
  input.type = 'radio'
  input.name = name
  input.value = value

  const text = document.createElement('span')
  text.textContent = labelText

  option.append(input, text)
  parent.appendChild(option)
  return input
}

function createHeightRange(): HTMLInputElement {
  const input = document.createElement('input')
  input.id = HEIGHT_ID
  input.type = 'range'
  input.className = 'bewly-settings-panel__range'
  input.min = String(COMMENT_REPLY_TREE_CONTAINER_MIN_HEIGHT)
  input.max = String(COMMENT_REPLY_TREE_CONTAINER_MAX_HEIGHT)
  input.step = '1'
  return input
}

function createCloseButton(className: string, label: string, text: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.setAttribute('popovertarget', DIALOG_ID)
  button.setAttribute('popovertargetaction', 'hide')
  button.setAttribute('aria-label', label)
  button.textContent = text
  return button
}

function bindControlListeners(resetButton: HTMLButtonElement) {
  if (!controls)
    return

  const {
    enabled,
    treeModeInputs,
    paginationModeInputs,
    container,
    height,
  } = controls

  enabled.addEventListener('change', () => {
    applySettings({ enabled: enabled.checked })
  })

  for (const input of treeModeInputs) {
    input.addEventListener('change', () => {
      if (input.checked)
        applySettings({ treeMode: input.value as CommentReplyTreeMode })
    })
  }

  for (const input of paginationModeInputs) {
    input.addEventListener('change', () => {
      if (input.checked)
        applySettings({ paginationMode: input.value as CommentReplyPaginationMode })
    })
  }

  container.addEventListener('change', () => {
    applySettings({ enableCommentReplyTreeContainer: container.checked })
    syncControls(getScriptSettings())
  })

  height.addEventListener('input', () => {
    const value = Number(height.value)
    updateHeightValue(value)
    document.documentElement.style.setProperty(
      COMMENT_REPLY_CONTAINER_PREVIEW_HEIGHT_VAR,
      `${value}px`,
    )
  })

  height.addEventListener('change', () => {
    const value = Number(height.value)
    clearHeightPreview()
    applySettings({ commentReplyTreeContainerHeight: value })
  })

  resetButton.addEventListener('click', () => {
    clearHeightPreview()
    const next = updateScriptSettings(() => createDefaultSettings())
    syncControls(next)
  })
}

function bindDialogListeners() {
  if (!dialog || settingsListenerBound)
    return
  settingsListenerBound = true

  registerSettingsChangeListener((settings) => {
    if (dialog?.matches(':popover-open'))
      syncControls(settings)
  })

  dialog.addEventListener('toggle', (event) => {
    if ((event as ToggleEventLike).newState !== 'closed')
      return

    clearHeightPreview()
    const target = returnFocus
    returnFocus = null
    if (target?.isConnected)
      target.focus({ preventScroll: true })
  })
}

function focusInitialControl() {
  window.requestAnimationFrame(() => {
    if (!dialog?.matches(':popover-open'))
      return
    controls?.enabled.focus({ preventScroll: true })
  })
}

function applySettings(patch: Partial<ScriptSettings>) {
  updateScriptSettings(settings => ({ ...settings, ...patch }))
}

function syncControls(settings: Readonly<ScriptSettings>) {
  if (!controls)
    return

  controls.enabled.checked = settings.enabled
  for (const input of controls.treeModeInputs)
    input.checked = input.value === settings.treeMode
  for (const input of controls.paginationModeInputs)
    input.checked = input.value === settings.paginationMode
  controls.container.checked = settings.enableCommentReplyTreeContainer

  controls.height.disabled = !settings.enableCommentReplyTreeContainer
  controls.height.value = String(settings.commentReplyTreeContainerHeight)
  updateHeightValue(settings.commentReplyTreeContainerHeight)
  clearHeightPreview()
}

function updateHeightValue(value: number) {
  if (!controls)
    return

  controls.heightOutput.textContent = `${value} px`
  controls.height.setAttribute('aria-valuetext', `${value} 像素`)

  const range = COMMENT_REPLY_TREE_CONTAINER_MAX_HEIGHT - COMMENT_REPLY_TREE_CONTAINER_MIN_HEIGHT
  const progress = range > 0
    ? ((value - COMMENT_REPLY_TREE_CONTAINER_MIN_HEIGHT) / range) * 100
    : 0
  controls.height.style.setProperty(
    '--bew-settings-range-progress',
    `${Math.max(0, Math.min(100, progress))}%`,
  )
}

function clearHeightPreview() {
  document.documentElement.style.removeProperty(COMMENT_REPLY_CONTAINER_PREVIEW_HEIGHT_VAR)
}
