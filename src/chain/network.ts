/**
 * 网络与外部端点的唯一事实来源。链 ID、RPC、水龙头地址只在这里出现一次，
 * 其余模块一律从这里取；scripts/get_faucet.sh 是同一个水龙头端点的命令行孪生体。
 */
import { getAddress, isAddress, zeroAddress, type Address, type Hex } from 'viem'
import { monadTestnet } from 'viem/chains'

/** 运行时可覆盖，方便指向自建 RPC；默认用 viem 自带的 Monad 测试网定义。 */
const RPC_OVERRIDE = import.meta.env?.VITE_MONAD_RPC_URL as string | undefined

export const CHAIN = monadTestnet
export const RPC_URL: string = RPC_OVERRIDE ?? CHAIN.rpcUrls.default.http[0]
export const CURRENCY = CHAIN.nativeCurrency.symbol

/** 与 scripts/get_faucet.sh 请求的是同一个端点，响应带 `access-control-allow-origin: *`，浏览器可直接调用。 */
export const FAUCET_URL =
  (import.meta.env?.VITE_FAUCET_URL as string | undefined) ?? 'https://agents.devnads.com/v1/faucet'

/** 交易哈希的浏览器链接。只拼接 32 字节哈希，别的输入一律不给链接。 */
export const EXPLORER_TX_BASE = 'https://testnet.monadexplorer.com/tx/'
export function explorerTxUrl(hash: Hex): string | null {
  return /^0x[0-9a-fA-F]{64}$/.test(hash) ? `${EXPLORER_TX_BASE}${hash}` : null
}

/**
 * 合约地址只从构建期变量读取，**不接受 URL 参数覆盖**：能被链接改写的 Vault 地址等于把玩家的
 * 下注发往任意地址。空值、非法值与零地址都视为未配置。
 */
export function parseContractAddress(raw: string | undefined | null): Address | null {
  const s = (raw ?? '').trim()
  if (!isAddress(s, { strict: false })) return null
  const address = getAddress(s)
  return address === zeroAddress ? null : address
}

export const PONY_VAULT_ADDRESS = parseContractAddress(import.meta.env?.VITE_PONY_VAULT_ADDRESS as string | undefined)
export const PONY_GAME_ADDRESS = parseContractAddress(import.meta.env?.VITE_PONY_GAME_ADDRESS as string | undefined)

/** WebAuthn 的 relying party：passkey 绑定在当前站点的 host 上，换域名即换账户。 */
export const RP_NAME = 'Ponygogogo'
/** 注册时用户名输入框的默认值；玩家可以改成别的，改了也只影响认证器列表里的显示。 */
export const DEFAULT_PASSKEY_NAME = 'ponygogogo'

export function defaultRpId(): string {
  if (typeof location === 'undefined') return 'localhost'
  return location.hostname
}
