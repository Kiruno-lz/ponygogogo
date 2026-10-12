import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    // Both Workers Builds and local Wrangler releases must embed the wallet configuration.
    const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env }
    const required = ['VITE_ALCHEMY_API_KEY', 'VITE_ALCHEMY_POLICY_ID',
      'VITE_PONY_GAME_ADDRESS', 'VITE_PONY_VAULT_ADDRESS', 'VITE_ENVIO_GRAPHQL_URL']
    const missing = required.filter(key => !env[key]?.trim())
    if (missing.length) throw new Error(`Missing build configuration: ${missing.join(', ')}`)
  }
  return {
    plugins: [react()],
    // 通行密钥的 rpId 不接受 IP 字面量，本地一律走 localhost
    server: { port: 5173, strictPort: true, host: 'localhost' },
    preview: { port: 5174, strictPort: true, host: 'localhost' },
    build: {
      target: 'es2022',
      chunkSizeWarningLimit: 2000,
      assetsDir: 'build',
      assetsInlineLimit: 0,
      rollupOptions: {
        output: {
          manualChunks: {
            phaser: ['phaser'],
            react: ['react', 'react-dom'],
            chain: ['viem', '@scure/bip32', '@scure/bip39', '@category-labs/mera'],
          },
        },
      },
    },
  }
})
