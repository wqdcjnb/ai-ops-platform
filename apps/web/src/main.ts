import { createApp } from 'vue'
import { createPinia } from 'pinia'
import '@tabler/core/dist/css/tabler.min.css'
import './styles.css'
import App from './App.vue'
import { createAppRouter } from './router'

// Authentication is not implemented yet. A direct /me visit selects the fixed,
// explicitly unverified employee demo scope; all other routes use the admin demo.
const demoRole = window.location.pathname.startsWith('/me') ? 'employee' : 'super_admin'

createApp(App)
  .use(createPinia())
  .use(createAppRouter({ role: demoRole }))
  .mount('#app')
