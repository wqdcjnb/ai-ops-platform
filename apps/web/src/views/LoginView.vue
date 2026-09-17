<script setup lang="ts">
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import { IconArrowRight, IconCommand, IconLock, IconShieldCheck, IconUser } from '@tabler/icons-vue'
import { AuthApiError, login } from '../auth-api'

const route = useRoute()
const username = ref('admin')
const password = ref('admin-demo')
const isLoading = ref(false)
const errorMessage = ref('')

function useAccount(nextUsername: string, nextPassword: string) {
  username.value = nextUsername
  password.value = nextPassword
  errorMessage.value = ''
}

async function submit() {
  if (isLoading.value) return
  isLoading.value = true
  errorMessage.value = ''
  try {
    const session = await login(username.value, password.value)
    const requested = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') ? route.query.redirect : ''
    const fallback = session.user.role === 'employee' ? '/me' : '/'
    window.location.assign(requested || fallback)
  } catch (error) {
    errorMessage.value = error instanceof AuthApiError ? error.message : '登录失败，请稍后重试'
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <main class="auth-page">
    <section class="auth-card" aria-labelledby="login-title">
      <div class="auth-brand"><span><IconCommand :size="24" /></span><div><strong>AI OPS</strong><small>运营管理平台</small></div></div>
      <div class="auth-heading"><div class="auth-icon"><IconShieldCheck :size="22" /></div><div><h1 id="login-title">登录运营平台</h1><p>使用平台账号进入对应工作区。</p></div></div>

      <form class="auth-form" @submit.prevent="submit">
        <label><span>账号</span><div class="auth-input"><IconUser :size="17" /><input v-model="username" autocomplete="username" required placeholder="请输入账号" /></div></label>
        <label><span>密码</span><div class="auth-input"><IconLock :size="17" /><input v-model="password" type="password" autocomplete="current-password" required placeholder="请输入密码" /></div></label>
        <p v-if="errorMessage" class="auth-error" role="alert">{{ errorMessage }}</p>
        <button class="auth-submit" type="submit" :disabled="isLoading">{{ isLoading ? '登录中…' : '登录' }}<IconArrowRight :size="17" /></button>
      </form>

      <div class="auth-demo-panel">
        <div><strong>本机验证账号</strong><small>开发环境演示，生产环境请替换为企业身份认证。</small></div>
        <div class="auth-account-actions">
          <button type="button" @click="useAccount('admin', 'admin-demo')"><span>管理员</span><small>admin</small></button>
          <button type="button" @click="useAccount('employee', 'employee-demo')"><span>员工</span><small>employee</small></button>
        </div>
      </div>
      <footer class="auth-footnote">会话有效期 8 小时 · HttpOnly Cookie · 未保存上游密钥</footer>
    </section>
  </main>
</template>
