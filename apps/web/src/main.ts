import { createApp } from 'vue'
import { createPinia } from 'pinia'
import '@tabler/core/dist/css/tabler.min.css'
import './styles.css'
import App from './App.vue'
import { createAppRouter } from './router'
import { bootstrapAdmin, fetchCurrentUser } from './auth-api'

const currentUser = await fetchCurrentUser().catch(() => null) ?? await bootstrapAdmin().catch(() => null)

createApp(App)
  .use(createPinia())
  .use(createAppRouter({ role: currentUser?.user.role ?? 'super_admin', authenticated: true }))
  .mount('#app')
