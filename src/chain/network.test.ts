import { describe, expect, test } from 'bun:test'
import { explorerTxUrl, parseContractAddress } from './network.ts'

describe('contract address configuration', () => {
  test('accepts a real address in any case and returns its checksum form', () => {
    expect(parseContractAddress(' 0xb2cd1abbb940d612a71e545067c05f900b32960e ')).toBe('0xB2Cd1aBBb940D612A71e545067C05f900B32960e')
  })

  test('treats empty, malformed and zero addresses as unconfigured', () => {
    for (const raw of [undefined, null, '', '   ', '0x123', 'vault', `0x${'0'.repeat(40)}`]) {
      expect(parseContractAddress(raw)).toBeNull()
    }
  })
})

describe('explorer links', () => {
  test('link only well-formed transaction hashes', () => {
    const hash = `0x${'ab'.repeat(32)}` as const
    expect(explorerTxUrl(hash)).toBe(`https://testnet.monadexplorer.com/tx/${hash}`)
    expect(explorerTxUrl('0x1234')).toBeNull()
  })
})
