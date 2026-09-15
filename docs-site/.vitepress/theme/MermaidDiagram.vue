<script setup>
import { ref, watch, onMounted } from 'vue'
import { useData } from 'vitepress'
const props = defineProps({ source: String })
const { isDark } = useData()
const html = ref(''), error = ref('')
let sequence = 0
async function render() {
  const current = ++sequence
  try {
    const { default: mermaid } = await import('mermaid')
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: isDark.value ? 'dark' : 'neutral', fontFamily: 'Microsoft YaHei, sans-serif' })
    const result = await mermaid.render('diagram-' + Math.random().toString(36).slice(2), decodeURIComponent(props.source))
    if (current === sequence) { html.value = result.svg; error.value = '' }
  } catch { error.value = '图表暂时无法渲染，请下载 Markdown 查看图表源文。' }
}
onMounted(render)
watch([() => props.source, isDark], render)
</script>
<template><figure class="diagram" aria-label="系统架构图"><p v-if="error" role="alert">{{ error }}</p><div v-else-if="html" v-html="html" /><p v-else>正在加载架构图…</p></figure></template>
