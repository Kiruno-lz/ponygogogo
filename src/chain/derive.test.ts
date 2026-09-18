/**
 * L1：账户派生。这条路径决定「同一把通行密钥必须永远对应同一个地址」，
 * 所以这里钉死一组向量——派生路径、助记词长度或 BIP 实现任何一处变动都会在这里红。
 */
import { describe, expect, test } from 'bun:test'
import { isMeraError } from '@category-labs/mera'
import { DERIVATION_PATH, accountFromMnemonic, accountFromPrf, mnemonicFromPrf, shortAddress } from './derive.ts'

/** 固定 PRF 输出：0x00 01 02 … 1f，同时是 BIP-39 的公开测试向量 */
const PRF_A = Uint8Array.from({ length: 32 }, (_, i) => i)
const PRF_B = new Uint8Array(32).fill(0xab)

const MNEMONIC_A =
  'abandon amount liar amount expire adjust cage candy arch gather drum bullet absurd math era live bid rhythm alien crouch range attend journey unaware'
const ADDRESS_A = '0xF9297b542BDb5DA50C364f9AE4Cbe1F3933bA40F'
const ADDRESS_B = '0x7399fC24EFaEB532418BA09aFAdf9e249290c621'

describe('账户派生', () => {
  test('派生路径就是 BIP-44 以太坊第一个账户', () => {
    expect(DERIVATION_PATH).toBe("m/44'/60'/0'/0/0")
  })

  test('32 字节 PRF 输出派生出 24 词助记词，向量钉死', () => {
    const m = mnemonicFromPrf(PRF_A)
    expect(m.split(' ')).toHaveLength(24)
    expect(m).toBe(MNEMONIC_A)
  })

  test('固定 PRF 输出派生出固定地址', () => {
    expect(accountFromPrf(PRF_A).address).toBe(ADDRESS_A)
    expect(accountFromPrf(PRF_B).address).toBe(ADDRESS_B)
  })

  test('助记词与 PRF 输出是同一条路径的两个入口', () => {
    expect(accountFromMnemonic(MNEMONIC_A).address).toBe(ADDRESS_A)
  })

  test('同一个 PRF 输出反复派生，地址与公钥逐字节相等', () => {
    const a = accountFromPrf(PRF_A)
    const b = accountFromPrf(PRF_A)
    expect(b.address).toBe(a.address)
    expect(Array.from(b.session.publicKey)).toEqual(Array.from(a.session.publicKey))
  })

  test('不同 PRF 输出派生出不同地址', () => {
    expect(accountFromPrf(PRF_B).address).not.toBe(accountFromPrf(PRF_A).address)
  })

  test('地址是 EIP-55 大小写混合形态，不是全小写', () => {
    const addr = accountFromPrf(PRF_A).address
    expect(addr).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(addr).not.toBe(addr.toLowerCase())
  })

  test('PRF 输出长度不对就拒绝派生，不悄悄补零', () => {
    expect(() => mnemonicFromPrf(new Uint8Array(31))).toThrow('PRF_OUTPUT_LENGTH')
    expect(() => mnemonicFromPrf(new Uint8Array(33))).toThrow('PRF_OUTPUT_LENGTH')
  })

  test('会话结束后私钥已清零，再签名必须失败', async () => {
    const { session } = accountFromPrf(PRF_A)
    session.end()
    const err = await session.signDigest(new Uint8Array(32)).catch((e: unknown) => e)
    expect(isMeraError(err) && err.code).toBe('SESSION_ENDED')
  })

  test('地址摘要保留首尾，够辨认也不会误读成完整地址', () => {
    expect(shortAddress(ADDRESS_A)).toBe('0xF929…A40F')
  })
})
