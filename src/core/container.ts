import { getCommentReplyContainerHeight } from '../settings'
import {
  COMMENT_REPLY_CONTAINER_ATTRIBUTE,
  COMMENT_REPLY_CONTAINER_HEIGHT_VAR,
} from './constants'

/** 回复容器由 CSS 驱动：属性切换生效范围，变量承载用户配置的高度 */
export function applyCommentReplyContainer(component: any, enabled: boolean) {
  if (!(component instanceof HTMLElement))
    return

  component.toggleAttribute(COMMENT_REPLY_CONTAINER_ATTRIBUTE, enabled)
  if (enabled)
    component.style.setProperty(COMMENT_REPLY_CONTAINER_HEIGHT_VAR, `${getCommentReplyContainerHeight()}px`)
  else
    component.style.removeProperty(COMMENT_REPLY_CONTAINER_HEIGHT_VAR)
}
