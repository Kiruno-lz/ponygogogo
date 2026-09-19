import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { enforceCanonicalHost } from './chain/canonicalHost.ts'
import './ui/theme.css'

// 必须在挂载之前：账户绑在域名上，一旦界面能点，玩家就可能在错误的域名下注册出另一个钱包
enforceCanonicalHost()

const el = document.getElementById('root')
if (!el) throw new Error('#root not found')
createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
