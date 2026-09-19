import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 通行密钥的 rpId 不接受 IP 字面量，本地一律走 localhost
  server: { port: 5173, strictPort: true, host: 'localhost' },
  preview: { port: 5174, strictPort: true, host: 'localhost' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    // Vite 自己的带 hash 产物落到 dist/build/，美术素材独占 dist/assets/，两者才能分开设缓存策略
    assetsDir: 'build',
    // 素材由 manifest 按路径加载；内联成 base64 会绕开这条路径，必须关闭
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        // 三组体积都不小、更新频率差异大，拆开后回访用户只重下变化的那一块
        manualChunks: {
          phaser: ['phaser'],
          react: ['react', 'react-dom'],
          chain: ['viem', '@scure/bip32', '@scure/bip39', '@category-labs/mera'],
        },
      },
    },
  },
})
