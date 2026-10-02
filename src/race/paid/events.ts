import { keccak256, type Hex } from 'viem'

/**
 * Event codes of the paid solver log; the Solidity port mirrors this table.
 * Every logged event folds into the digest:
 *   digest = keccak256(abi.encode(bytes32 digest, uint8 code, uint32 tau, uint8 horse, int256 arg)), starting at bytes32(0).
 *
 * | code | name          | class      | horse          | arg                                   |
 * | ---- | ------------- | ---------- | -------------- | ------------------------------------- |
 * | 1    | FINISH        | 2          | finisher       | pos (µu)                              |
 * | 2    | CHECKPOINT    | 5          | crosser        | k                                     |
 * | 3    | CARD          | 5 / 6      | acquirer       | cardId                                |
 * | 4    | CPU_CARD_CUT  | 5          | CPU            | k (CPU holds C-03)                    |
 * | 5    | PANEL_OPEN    | 5 / 6      | player         | k (manual panel)                      |
 * | 6    | PANEL_AUTO    | 5 / 6      | player         | k (C-04 panel, closes after 3 s)      |
 * | 7    | PANEL_CUT     | 5 / 6      | player         | k (C-03: no panel, no slow motion)    |
 * | 8    | PANEL_DEFER   | 5          | player         | k (crossed while another panel open)  |
 * | 9    | PANEL_CLOSE   | 6 / 2      | player         | k·16 + CLOSE_*                        |
 * | 10   | EXPIRE        | 0          | owner          | instanceId (buff / ability)           |
 * | 11   | EQUIP_ON      | 5 / 6      | holder         | instanceId                            |
 * | 12   | EQUIP_OFF     | 0 / 5 / 6  | holder         | instanceId·4 + OFF_*                  |
 * | 13   | BOMB_PLACE    | 5 / 6      | placer         | pos·8 + lane                          |
 * | 14   | BOMB_EXPLODE  | 3          | victim         | bombId (0-based placement order)      |
 * | 15   | DEATH         | 0 / 3      | victim         | respawn instanceId                    |
 * | 16   | DEATH_IMMUNE  | 0 / 3      | victim         | 0 (respawning)                        |
 * | 17   | RESPAWN_END   | 0          | owner          | instanceId                            |
 * | 18   | SWAP          | 4          | C-09 owner     | attempt·8 + targetHorse               |
 * | 19   | SWAP_BLOCKED  | 4          | C-09 owner     | attempt·8 + targetHorse               |
 * | 20   | WHEEL_BURST   | 4          | holder         | burst index 1..4                      |
 * | 21   | WIND          | 5 / 6      | placer         | ±1000 bps                             |
 * | 22   | STEAL         | 5 / 6      | thief          | stolen instanceId                     |
 * | 23   | STEAL_NONE    | 5 / 6      | thief          | 0                                     |
 * | 24   | EXHAUST_ENTER | 1          | horse          | 0                                     |
 * | 25   | EXHAUST_EXIT  | 1 / 5 / 6  | horse          | stamina after exit                    |
 * | 26   | OVERCAP_END   | 1          | horse          | stamina                               |
 * | 27   | BASE_CAP      | 1          | horse          | b = C·1000                            |
 * | 28   | CHOICE_INVALID | 5 / 6 / 2 | player        | k·16 + INVALID_* (reason)             |
 *
 * CHOICE_INVALID (有奖规则 v3): a stored choice that breaks a rule counts as no transaction at checkpoint k. It is
 * logged right after the panel event that decides it (PANEL_OPEN/AUTO/CUT when the panel opens, PANEL_CLOSE when the
 * player finishes inside it) or, for a checkpoint whose panel never opened, after the last event of a complete solve.
 */
export const EV_FINISH = 1
export const EV_CHECKPOINT = 2
export const EV_CARD = 3
export const EV_CPU_CARD_CUT = 4
export const EV_PANEL_OPEN = 5
export const EV_PANEL_AUTO = 6
export const EV_PANEL_CUT = 7
export const EV_PANEL_DEFER = 8
export const EV_PANEL_CLOSE = 9
export const EV_EXPIRE = 10
export const EV_EQUIP_ON = 11
export const EV_EQUIP_OFF = 12
export const EV_BOMB_PLACE = 13
export const EV_BOMB_EXPLODE = 14
export const EV_DEATH = 15
export const EV_DEATH_IMMUNE = 16
export const EV_RESPAWN_END = 17
export const EV_SWAP = 18
export const EV_SWAP_BLOCKED = 19
export const EV_WHEEL_BURST = 20
export const EV_WIND = 21
export const EV_STEAL = 22
export const EV_STEAL_NONE = 23
export const EV_EXHAUST_ENTER = 24
export const EV_EXHAUST_EXIT = 25
export const EV_OVERCAP_END = 26
export const EV_BASE_CAP = 27
export const EV_CHOICE_INVALID = 28
export const EV_TRIGGER = 29
export const EV_RESOURCE = 30
export const EV_GUARD = 31
export const EV_TARGET = 32
export const EV_EQUIP_REFRESH = 33
export const EV_FIXED = 34

export const CLOSE_PICKED = 1
export const CLOSE_FORFEIT_TX = 2
export const CLOSE_TIMEOUT = 3
export const CLOSE_AUTO = 4
export const CLOSE_FINISHED = 5

/** CHOICE_INVALID reasons, judged in this order when the panel opens (NOT_OPENED and AFTER_FINISH later). */
export const INVALID_NOT_OPENED = 1
export const INVALID_EARLY = 2
export const INVALID_LATE = 3
export const INVALID_AFTER_FINISH = 4
export const INVALID_AUTO = 5
export const INVALID_CUT = 6
export const INVALID_NO_CREDIT = 7
export const INVALID_BAD_SLOT = 8
export const INVALID_EXHAUSTED = 9
export const INVALID_NOT_OFFERED = 10

export type PaidChoiceInvalidReason =
  | 'not-opened' | 'early' | 'late' | 'after-finish' | 'auto' | 'cut' | 'no-credit' | 'bad-slot' | 'exhausted'
  | 'not-offered'

export const PAID_CHOICE_INVALID_NAMES: Readonly<Record<number, PaidChoiceInvalidReason>> = {
  1: 'not-opened', 2: 'early', 3: 'late', 4: 'after-finish', 5: 'auto', 6: 'cut', 7: 'no-credit', 8: 'bad-slot',
  9: 'exhausted', 10: 'not-offered',
}

export const OFF_EXPIRED = 0
export const OFF_REPLACED = 1
export const OFF_STOLEN = 2
export const OFF_RECYCLED = 3

export const GLOBAL_HORSE = 255

export const PAID_EVENT_NAMES: Readonly<Record<number, string>> = {
  1: 'FINISH', 2: 'CHECKPOINT', 3: 'CARD', 4: 'CPU_CARD_CUT', 5: 'PANEL_OPEN', 6: 'PANEL_AUTO', 7: 'PANEL_CUT',
  8: 'PANEL_DEFER', 9: 'PANEL_CLOSE', 10: 'EXPIRE', 11: 'EQUIP_ON', 12: 'EQUIP_OFF', 13: 'BOMB_PLACE',
  14: 'BOMB_EXPLODE', 15: 'DEATH', 16: 'DEATH_IMMUNE', 17: 'RESPAWN_END', 18: 'SWAP', 19: 'SWAP_BLOCKED',
  20: 'WHEEL_BURST', 21: 'WIND', 22: 'STEAL', 23: 'STEAL_NONE', 24: 'EXHAUST_ENTER', 25: 'EXHAUST_EXIT',
  26: 'OVERCAP_END', 27: 'BASE_CAP', 28: 'CHOICE_INVALID', 29: 'TRIGGER', 30: 'RESOURCE', 31: 'GUARD',
  32: 'TARGET', 33: 'EQUIP_REFRESH', 34: 'FIXED',
}

export type PaidLoggedEvent = { code: number; tau: bigint; wall: bigint; horse: number; arg: bigint }

export const ZERO_DIGEST: Hex = `0x${'00'.repeat(32)}`

const WORD = 32
const INT256_MOD = 1n << 256n

function writeWord(buf: Uint8Array, offset: number, value: bigint): void {
  let v = value < 0n ? INT256_MOD + value : value
  for (let i = WORD - 1; i >= 0; i--) {
    buf[offset + i] = Number(v & 0xffn)
    v >>= 8n
  }
}

function hexToBytes(hex: Hex, out: Uint8Array): void {
  for (let i = 0; i < WORD; i++) out[i] = Number.parseInt(hex.slice(2 + 2 * i, 4 + 2 * i), 16)
}

/** One digest step; the encoding equals abi.encode(bytes32, uint8, uint32, uint8, int256). */
export function foldPaidEvent(digest: Hex, code: number, tau: bigint, horse: number, arg: bigint): Hex {
  if (!Number.isInteger(code) || code < 0 || code > 255 || !Number.isInteger(horse) || horse < 0 || horse > 255
    || tau < 0n || tau > 0xffff_ffffn || arg < -(1n << 255n) || arg >= 1n << 255n) {
    throw new Error('INVALID_EVENT')
  }
  const buf = new Uint8Array(5 * WORD)
  hexToBytes(digest, buf)
  buf[2 * WORD - 1] = code
  writeWord(buf, 2 * WORD, tau)
  buf[4 * WORD - 1] = horse
  writeWord(buf, 4 * WORD, arg)
  return keccak256(buf)
}
