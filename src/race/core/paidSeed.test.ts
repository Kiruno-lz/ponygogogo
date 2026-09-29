import { expect, test } from 'bun:test'
import { derivePaidSeed } from './paidSeed.ts'

const GAME = '0x1111111111111111111111111111111111111111'
const PLAYER = '0x2222222222222222222222222222222222222222'

test('entry seed is domain separated and derived from account nonce rather than client input', () => {
  expect(derivePaidSeed(10143n, GAME, PLAYER, 7n)).toBe('0x722555e6546c117e5a3a3d075ab7201d092809d0314e9b451b2b1fb30eea11ca')
  expect(derivePaidSeed(10143n, GAME, PLAYER, 8n)).not.toBe(derivePaidSeed(10143n, GAME, PLAYER, 7n))
})
