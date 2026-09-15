import DefaultTheme from 'vitepress/theme'
import { h } from 'vue'
import DownloadSource from './DownloadSource.vue'
import MermaidDiagram from './MermaidDiagram.vue'
import './style.css'
export default {
  extends: DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, { 'doc-before': () => h(DownloadSource) }),
  enhanceApp({ app }) { app.component('MermaidDiagram', MermaidDiagram) }
}
