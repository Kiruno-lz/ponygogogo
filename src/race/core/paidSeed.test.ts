import { expect, test } from 'bun:test'
import { derivePaidSeed } from './paidSeed.ts'

const GAME = '0x1111111111111111111111111111111111111111'
const PLAYER = '0x2222222222222222222222222222222222222222'

test('entry seed is domain separated and derived from account nonce rather than client input', () => {
  expect(derivePaidSeed(10143n, GAME, PLAYER, 7n)).toBe('0x59ae1f00bdb152224756f06b86cf49f469dd2d35067db89838856e5dff53cf99')
  expect(derivePaidSeed(10143n, GAME, PLAYER, 8n)).not.toBe(derivePaidSeed(10143n, GAME, PLAYER, 7n))
})
