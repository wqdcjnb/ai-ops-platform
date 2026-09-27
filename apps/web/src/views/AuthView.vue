<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { IconArrowRight, IconAt, IconBolt, IconKey, IconShieldCheck, IconSparkles, IconUser } from '@tabler/icons-vue'
import { AuthApiError, login, registerEmployee } from '../auth-api'

const route = useRoute()
const mode = ref<'login' | 'register'>(route.path === '/register' ? 'register' : 'login')
const email = ref('')
const password = ref('')
const realName = ref('')
const errorMessage = ref('')
const isSubmitting = ref(false)

const submitLabel = computed(() => mode.value === 'login' ? '登录工作台' : '创建账号并进入')

watch(() => route.path, (path) => {
  mode.value = path === '/register' ? 'register' : 'login'
  errorMessage.value = ''
})

function switchMode(next: 'login' | 'register') {
  if (isSubmitting.value) return
  mode.value = next
  errorMessage.value = ''
  history.replaceState(null, '', next === 'register' ? '/register' : '/login')
}

async function submit() {
  if (isSubmitting.value) return
  errorMessage.value = ''
  const normalizedEmail = email.value.trim().toLocaleLowerCase('en-US')
  if (!normalizedEmail || !password.value || (mode.value === 'register' && !realName.value.trim())) {
    errorMessage.value = mode.value === 'register' ? '请填写姓名、邮箱和密码。' : '请填写邮箱和密码。'
    return
  }
  if (mode.value === 'register' && password.value.length < 8) {
    errorMessage.value = '密码至少需要 8 位。'
    return
  }
  isSubmitting.value = true
  try {
    const result = mode.value === 'login'
      ? await login(normalizedEmail, password.value)
      : await registerEmployee(realName.value.trim(), normalizedEmail, password.value)
    window.location.assign(result.user.role === 'employee' ? '/employee' : '/people')
  } catch (error) {
    errorMessage.value = error instanceof AuthApiError ? error.message : '暂时无法完成登录，请稍后重试。'
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <main class="access-page">
    <section class="access-shell" aria-labelledby="access-title">
      <aside class="access-story" aria-label="AI OPS 平台说明">
        <div class="access-brand"><span class="access-brand-mark"><IconSparkles :size="21" /></span><span><strong>AI OPS</strong><small>UNIFIED AI ACCESS</small></span></div>
        <div class="access-story-copy">
          <p class="access-kicker">ONE KEY · MANY CAPABILITIES</p>
          <h1>让 AI 接入，<br />变得简单可靠。</h1>
          <p>一个平台 Key，即可按需使用文本、图片、视频和语音能力；平台会自动保障稳定、顺畅的服务体验。</p>
        </div>
        <ul class="access-points">
          <li><IconBolt :size="17" /><span><strong>更快响应</strong><small>平台会自动优化服务响应。</small></span></li>
          <li><IconKey :size="17" /><span><strong>一个 Key 即可</strong><small>无需为不同模型或客户端重复配置凭据。</small></span></li>
          <li><IconShieldCheck :size="17" /><span><strong>安全可控</strong><small>你的访问权限受到保护，使用记录可追溯。</small></span></li>
        </ul>
        <p class="access-story-footer"><IconShieldCheck :size="15" />使用邮箱登录；员工账号需自行注册</p>
      </aside>

      <section class="access-form-panel">
        <header class="access-form-heading">
          <p>{{ mode === 'login' ? 'WELCOME BACK' : 'CREATE EMPLOYEE ACCOUNT' }}</p>
          <h2 id="access-title">{{ mode === 'login' ? '登录 AI OPS' : '创建员工账号' }}</h2>
          <span>{{ mode === 'login' ? '使用你的邮箱和密码继续。' : '请使用姓名、邮箱和密码注册。' }}</span>
        </header>

        <div class="access-switch" role="tablist" aria-label="登录或注册">
          <button :class="{ active: mode === 'login' }" type="button" role="tab" :aria-selected="mode === 'login'" @click="switchMode('login')">登录</button>
          <button :class="{ active: mode === 'register' }" type="button" role="tab" :aria-selected="mode === 'register'" @click="switchMode('register')">员工注册</button>
        </div>

        <form class="access-form" @submit.prevent="submit">
          <label v-if="mode === 'register'">
            <span>姓名</span>
            <div class="access-input"><IconUser :size="18" /><input v-model="realName" autocomplete="name" maxlength="40" placeholder="请输入姓名" /></div>
          </label>
          <label>
            <span>邮箱</span>
            <div class="access-input"><IconAt :size="18" /><input v-model="email" type="email" autocomplete="email" maxlength="320" placeholder="请输入邮箱" /></div>
          </label>
          <label>
            <span>密码</span>
            <div class="access-input"><IconKey :size="18" /><input v-model="password" type="password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" maxlength="200" placeholder="请输入密码" /></div>
          </label>
          <p v-if="errorMessage" class="access-error" role="alert">{{ errorMessage }}</p>
          <button class="access-submit" type="submit" :disabled="isSubmitting"><span>{{ isSubmitting ? '处理中…' : submitLabel }}</span><IconArrowRight :size="18" /></button>
        </form>

        <p class="access-note">忘记密码？请联系管理员重置。</p>
      </section>
    </section>
  </main>
</template>

<style scoped>
.access-page { min-height: 100vh; display: grid; place-items: center; padding: 28px 18px; background: radial-gradient(circle at 15% 15%, #d9f0ed 0, transparent 34%), radial-gradient(circle at 90% 85%, #e4edf8 0, transparent 30%), #f3f7f8; }
.access-shell { width: min(100%, 1000px); min-height: 620px; display: grid; grid-template-columns: minmax(330px, .94fr) minmax(420px, 1.06fr); overflow: hidden; border: 1px solid rgba(20, 65, 70, .12); border-radius: 24px; background: #fff; box-shadow: 0 28px 75px rgba(27, 58, 68, .16); }
.access-story { position: relative; display: flex; flex-direction: column; min-width: 0; padding: 42px; overflow: hidden; color: #e9f7f6; background: linear-gradient(148deg, #0d4f56 0%, #126c70 58%, #0d3e49 100%); }.access-story::after { content: ''; position: absolute; right: -110px; bottom: -128px; width: 300px; height: 300px; border: 1px solid rgba(204, 244, 238, .16); border-radius: 50%; box-shadow: 0 0 0 36px rgba(204, 244, 238, .04), 0 0 0 74px rgba(204, 244, 238, .03); pointer-events: none; }
.access-brand { display: flex; align-items: center; gap: 11px; position: relative; z-index: 1; }.access-brand-mark { width: 39px; height: 39px; display: grid; place-items: center; border-radius: 12px; color: #093e45; background: #b9ece5; box-shadow: 0 8px 22px rgba(0, 0, 0, .16); }.access-brand strong, .access-brand small { display: block; }.access-brand strong { color: #fff; font-size: 15px; letter-spacing: .12em; }.access-brand small { margin-top: 3px; color: #a9d9d5; font-size: 9px; font-weight: 700; letter-spacing: .14em; }
.access-story-copy { position: relative; z-index: 1; margin-top: 76px; }.access-kicker { margin: 0 0 14px; color: #9ad9d3; font-size: 10px; font-weight: 800; letter-spacing: .14em; }.access-story-copy h1 { margin: 0; color: #fff; font-size: clamp(28px, 3.1vw, 40px); line-height: 1.22; letter-spacing: -.04em; }.access-story-copy > p:last-child { max-width: 340px; margin: 17px 0 0; color: #c1e6e2; font-size: 13px; line-height: 1.8; }
.access-points { position: relative; z-index: 1; display: grid; gap: 15px; margin: auto 0 0; padding: 0; list-style: none; }.access-points li { display: grid; grid-template-columns: 30px minmax(0, 1fr); align-items: start; gap: 10px; }.access-points li > svg { margin-top: 2px; color: #a2e2da; }.access-points strong, .access-points small { display: block; }.access-points strong { color: #fff; font-size: 12px; }.access-points small { margin-top: 3px; color: #b6dedb; font-size: 11px; line-height: 1.5; }.access-story-footer { position: relative; z-index: 1; display: flex; align-items: center; gap: 6px; margin: 28px 0 0; padding-top: 18px; border-top: 1px solid rgba(218, 250, 246, .16); color: #a9d7d3; font-size: 10px; }
.access-form-panel { display: flex; flex-direction: column; justify-content: center; min-width: 0; padding: 52px clamp(34px, 6vw, 76px); background: #fff; }.access-form-heading p { margin: 0 0 9px; color: #177278; font-size: 10px; font-weight: 800; letter-spacing: .13em; }.access-form-heading h2 { margin: 0; color: #172c37; font-size: 29px; letter-spacing: -.035em; }.access-form-heading span { display: block; margin-top: 10px; color: #70818b; font-size: 13px; line-height: 1.65; }
.access-switch { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin: 31px 0 23px; padding: 4px; border-radius: 10px; background: #f0f5f5; }.access-switch button { min-height: 38px; border: 0; border-radius: 7px; color: #71818b; background: transparent; font: inherit; font-size: 13px; font-weight: 650; }.access-switch button.active { color: #173a42; background: #fff; box-shadow: 0 2px 7px rgba(33, 65, 71, .12); }
.access-form { display: grid; gap: 17px; }.access-form label { display: grid; gap: 7px; color: #425761; font-size: 12px; font-weight: 700; }.access-input { display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 0 13px; border: 1px solid #d7e2e4; border-radius: 10px; color: #7f9199; background: #fbfdfd; transition: border-color .18s, box-shadow .18s, background .18s; }.access-input:focus-within { border-color: #19767a; background: #fff; box-shadow: 0 0 0 4px rgba(25, 118, 122, .11); }.access-input input { width: 100%; min-width: 0; border: 0; outline: 0; color: #1e3440; background: transparent; font: inherit; font-size: 14px; }.access-input input::placeholder { color: #a3b0b6; }.access-error { margin: -4px 0 0; padding: 10px 12px; border-radius: 9px; color: #a33737; background: #fff1f1; font-size: 12px; line-height: 1.45; }.access-submit { display: inline-flex; align-items: center; justify-content: space-between; min-height: 49px; margin-top: 2px; padding: 0 16px 0 19px; border: 0; border-radius: 10px; color: #fff; background: linear-gradient(90deg, #11767b, #218d87); box-shadow: 0 10px 20px rgba(17, 118, 123, .2); font: inherit; font-size: 14px; font-weight: 750; transition: transform .18s, box-shadow .18s; }.access-submit:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 13px 24px rgba(17, 118, 123, .25); }.access-submit:disabled { cursor: wait; opacity: .65; }.access-note { margin: 23px 0 0; color: #87959c; font-size: 11px; line-height: 1.65; text-align: center; }
@media (max-width: 760px) { .access-page { align-items: start; padding: 18px 13px; }.access-shell { min-height: 0; grid-template-columns: 1fr; border-radius: 18px; }.access-story { min-height: 242px; padding: 28px; }.access-story-copy { margin-top: 36px; }.access-story-copy h1 { font-size: 28px; }.access-story-copy > p:last-child, .access-points, .access-story-footer { display: none; }.access-form-panel { padding: 32px 25px; }.access-form-heading h2 { font-size: 25px; }.access-switch { margin-top: 24px; } }
</style>
