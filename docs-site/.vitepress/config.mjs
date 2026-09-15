import { defineConfig } from 'vitepress'
import { readFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { groups, pages } from './pages.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../content')
const allowed = new Set(pages)
function rawMarkdown() {
  return {
    name: 'approved-markdown-downloads',
    buildStart() {
      for (const page of pages) {
        const target = resolve(root, 'public/raw', page)
        mkdirSync(dirname(target), { recursive: true })
        copyFileSync(resolve(root, page), target)
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0]
        if (!url.startsWith('/raw/')) return next()
        let page
        try { page = decodeURIComponent(url.slice(5)) } catch { res.statusCode = 400; return res.end() }
        if (!allowed.has(page)) { res.statusCode = 404; return res.end('Not found') }
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('Content-Disposition', `attachment; filename="${page.split('/').pop()}"`)
        res.end(readFileSync(resolve(root, page)))
      })
    }
  }
}
export default defineConfig({
  title: 'AI 运营文档中心',
  description: '电商团队 AI 接入、额度管理与成本治理的项目知识库',
  lang: 'zh-CN',
  srcDir: 'content',
  srcExclude: ['public/**'],
  cleanUrls: true,
  head: [
    ['meta', { name: 'robots', content: 'noindex, nofollow' }],
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }]
  ],
  markdown: {
    config(md) {
      const fence = md.renderer.rules.fence
      md.renderer.rules.fence = (tokens, idx, ...args) => {
        if (tokens[idx].info.trim() === 'mermaid') {
          return `<MermaidDiagram source="${encodeURIComponent(tokens[idx].content)}" />`
        }
        return fence(tokens, idx, ...args)
      }
    }
  },
  vite: { plugins: [rawMarkdown()], server: { fs: { strict: true, allow: [resolve(root, '..')] } } },
  themeConfig: {
    siteTitle: 'AI 运营 / 文档中心',
    nav: [{ text: '需求', link: '/requirements/core' }, { text: '方案', link: '/technical/architecture' }, { text: '后台入口 ↗', link: '/portal' }],
    sidebar: groups.map(g => ({ text: g.text, items: g.items.map(([path, text]) => ({ text, link: path === 'index' ? '/' : '/' + path })) })),
    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    darkModeSwitchLabel: '切换主题', sidebarMenuLabel: '文档目录', returnToTopLabel: '返回顶部',
    search: { provider: 'local', options: {
      miniSearch: { options: { tokenize: text => Array.from(new Intl.Segmenter('zh-CN', { granularity: 'word' }).segment(text), s => s.segment).filter(t => /[\p{L}\p{N}]/u.test(t)) } },
      translations: { button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' }, modal: { noResultsText: '未找到相关结果', resetButtonTitle: '清空搜索', footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' } } }
    } },
    footer: { message: 'Markdown 是维护主版本 · 本机文档站 · 功能状态以验收记录为准' }
  }
})
