/**
 * 账户派生。**这条路径一旦发布就不能再改**：改动等于让所有已注册的通行密钥指向另一个地址。
 *
 * PRF 输出（32 字节，由 rpId + 凭据 + 固定 salt 决定）→ BIP-39 助记词 → BIP-32 主种子
 * → BIP-44 以太坊路径第 0 个账户。走标准助记词而不是直接把 PRF 当私钥，是为了让玩家能把
 * 这把钥匙导入任何标准钱包——导出助记词这个功能才有意义。
 */
import { createSecp256k1SigningSession, getEvmAddress, type EvmAddress, type Secp256k1SigningSession } from '@category-labs/mera'
import { HDKey } from '@scure/bip32'
import { entropyToMnemonic, mnemonicToSeedSync } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'

/** 固定派生路径，与 MetaMask 等标准钱包的第一个账户一致。 */
export const DERIVATION_PATH = "m/44'/60'/0'/0/0"

export type DerivedAccount = {
  /** 签名会话，登出时必须 end() 把私钥清零 */
  readonly session: Secp256k1SigningSession
  readonly address: EvmAddress
}

/** 32 字节 PRF 输出 → 24 词助记词。 */
export function mnemonicFromPrf(prfOutput: Uint8Array): string {
  if (prfOutput.length !== 32) throw new Error('PRF_OUTPUT_LENGTH')
  return entropyToMnemonic(prfOutput, wordlist)
}

/** 助记词 → 签名会话与地址。中间的种子与私钥用完即清零，不留在闭包里。 */
export function accountFromMnemonic(mnemonic: string): DerivedAccount {
  const seed = mnemonicToSeedSync(mnemonic)
  const master = HDKey.fromMasterSeed(seed)
  const node = master.derive(DERIVATION_PATH)
  const privateKey = node.privateKey
  if (!privateKey) throw new Error('DERIVATION_EMPTY')
  try {
    const session = createSecp256k1SigningSession({ privateKey })
    return { session, address: getEvmAddress(session.publicKey) }
  } finally {
    node.wipePrivateData()
    master.wipePrivateData()
    seed.fill(0)
  }
}

/** 注册与登录共用的一步：PRF 输出直接派生出账户，两条路径必然得到同一个地址。 */
export function accountFromPrf(prfOutput: Uint8Array): DerivedAccount {
  return accountFromMnemonic(mnemonicFromPrf(prfOutput))
}

/** 地址摘要，界面上短展示用。 */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}
