// BilibiliCommentTree —— B 站评论区树状排序与折叠 Tampermonkey 脚本。
// 抽取自 BewlyCat 扩展 src/inject/index.ts 的原生评论区树状改造部分。
//
// 脚本以 @run-at document-start 注入页面主世界：先同步读设置，再劫持
// customElements.define 拦截 B 站评论 Lit 组件，在组件渲染后重排楼中楼、
// 画树状引导线并提供折叠。

import {
  clearCommentReplyDeepLinkSettlement,
  getCommentReplyDeepLinkId,
  initDeepLinkListeners,
  refreshCommentReplyTrees,
  scheduleCommentReplyDeepLinkSettlement,
} from './core/tree'
import { initCommentCustomElementPatching } from './patch'
import { getCommentReplyTreeMode, initScriptSettings, registerSettingsChangeListener } from './settings'

const scriptGlobal = globalThis as typeof globalThis & {
  __BILIBILI_COMMENT_TREE_INITIALIZED__?: boolean
}

if (!scriptGlobal.__BILIBILI_COMMENT_TREE_INITIALIZED__) {
  scriptGlobal.__BILIBILI_COMMENT_TREE_INITIALIZED__ = true

  // 设置同步读取；先初始化设置再劫持组件，保证首个组件增强时模式可用。
  initScriptSettings()
  registerSettingsChangeListener(() => {
    refreshCommentReplyTrees()
    if (getCommentReplyTreeMode() === null)
      clearCommentReplyDeepLinkSettlement()
    // 设置变更后 B 站可能才开始 #reply 定位/展开
    if (getCommentReplyDeepLinkId() && getCommentReplyTreeMode() !== null)
      scheduleCommentReplyDeepLinkSettlement('hash')
  })
  initCommentCustomElementPatching()
  initDeepLinkListeners()
}
