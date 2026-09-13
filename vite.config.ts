import { defineConfig } from 'vite'
import monkey from 'vite-plugin-monkey'

// 匹配规则与原 BewlyCat 扩展 manifest 的内容脚本保持一致
const MATCHES = [
  '*://www.bilibili.com/*',
  '*://search.bilibili.com/*',
  '*://t.bilibili.com/*',
  '*://space.bilibili.com/*',
  '*://message.bilibili.com/*',
  '*://member.bilibili.com/*',
  '*://account.bilibili.com/*',
  '*://www.hdslb.com/*',
  '*://passport.bilibili.com/*',
  '*://music.bilibili.com/*',
]

const EXCLUDE_MATCHES = [
  '*://www.bilibili.com/match/game*',
  '*://www.bilibili.com/toy*',
]

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        'name': {
          '': 'BilibiliCommentTree',
          'zh-CN': 'Bilibili 评论树状折叠',
        },
        'namespace': 'bilibili-comment-tree',
        'description': '按回复关系整理 bilibili 评论区楼中楼：树状排序、引导线与折叠',
        'match': MATCHES,
        'exclude': EXCLUDE_MATCHES,
        'run-at': 'document-start',
        'grant': [
          'GM_getValue',
          'GM_setValue',
          'GM_addValueChangeListener',
          'GM_registerMenuCommand',
          'GM_unregisterMenuCommand',
          'unsafeWindow',
        ],
      },
    }),
  ],
})
