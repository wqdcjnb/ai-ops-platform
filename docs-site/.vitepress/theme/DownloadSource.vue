<script setup>
import { useData, withBase } from 'vitepress'
const { page } = useData()
</script>
<template>
  <div class="doc-meta"><span>PROJECT KNOWLEDGE / 项目知识库</span><a :href="withBase('/raw/' + page.relativePath)" download>下载 Markdown 原文 ↓</a></div>
</template>
