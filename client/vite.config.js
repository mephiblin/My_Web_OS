import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
const proxyTarget = process.env.VITE_DEV_PROXY_TARGET || 'http://localhost:3000'

export default defineConfig({
  plugins: [svelte()],
  server: {
    host: true, // 0.0.0.0 바인딩 - 도커 컨테이너 및 외부 네트워크 접속에 필요
    proxy: {
      '/api': proxyTarget,
      '/socket.io': {
        target: proxyTarget,
        ws: true
      }
    }
  }
})
