import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const port = Number(process.env.VITE_PORT ?? 4174)
const bffPort = Number(process.env.VITE_BFF_PORT ?? 4175)

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port,
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${bffPort}`,
    },
  },
})
