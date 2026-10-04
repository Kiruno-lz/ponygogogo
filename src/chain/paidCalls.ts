import { PAID_CARD_COUNT } from '../race/paid/cardRules.ts'
/**
 * 有奖会话的调用编码与手写 ABI（会话协议 v2，对应 contracts/PonyGame.sol 与 PonyVault.sol）。
 *
 * 这里只做两件事：把浏览器会用到的每个 PonyGame 条目写成人读 ABI，把一次开场/选牌/结算/判负编码成
 * `ContractCall`。没有退款：永久不可结算的会话只能 `forfeitSession`（返还 0）。不发交易、不读链——流程与回执解析在 paidSession.ts。ABI 与 Foundry 产物逐项比对
 * 见 tests/api/ts/paid-session.test.ts，任何一侧改了签名、字段名或 indexed 都会在那里失败。
 */
import { encodeFunctionData, isAddress, isAddressEqual, parseAbi, zeroAddress, type Address, type Hex } from 'viem'
import type { ContractCall } from './alchemy.ts'
import { paidTierForStake } from './paidStakes.ts'

export const ponyGameAbi = parseAbi([
  'struct ChoiceView { bool present; uint32 txSec; uint64 blockNumber; uint8 cardId; uint8[] refreshSlots; bytes32 anchor; }',
  'struct SessionView { address player; uint8 state; uint8 playerHorseId; uint8 stakeTier; uint256 stake; uint64 openedAt; uint64 openedBlock; bytes32 seed; bytes32 openAnchor; uint8 lastCheckpoint; ChoiceView[3] choices; }',
  'struct RaceResult { uint32[5] finishTime; uint32[5] finishWall; uint8[5] rawOrder; uint8[5] settlementOrder; uint8 playerRawRank; uint8 playerSettlementRank; uint8[3] acquired; uint32 eventCount; bytes32 digest; }',
  'function openSession(uint8 horseId, uint256 stake) payable returns (bytes32 sessionId)',
  'function chooseCard(bytes32 sessionId, uint8 checkpoint, uint8 cardId, uint8[] refreshSlots)',
  'function settleSession(bytes32 sessionId) returns (uint256 payout)',
  'function forfeitSession(bytes32 sessionId)',
  'function sealAnchors(bytes32 sessionId) returns (uint256 count)',
  'function sessionOf(address) view returns (bytes32)',
  'function getSession(bytes32 sessionId) view returns (SessionView view_)',
  'function previewSettlement(bytes32 sessionId) view returns (RaceResult result, uint256 payout, uint256 settleableAt)',
  'function canForfeit(bytes32 sessionId) view returns (bool, uint8)',
  'function entryPaused() view returns (bool)',
  'function rulesetHash() view returns (bytes32)',
  'function vault() view returns (address)',
  'event SessionOpened(bytes32 indexed sessionId, address indexed player, uint8 horseId, uint256 stake, bytes32 seed, uint64 openedAt, uint64 openedBlock, bytes32 rulesetHash)',
  'event CardChosen(bytes32 indexed sessionId, address indexed player, uint8 checkpoint, uint8 cardId, uint8[] refreshSlots, uint32 txSec, uint64 blockNumber)',
  'event RandomAnchorSealed(bytes32 indexed sessionId, uint64 sourceBlock, bytes32 anchor)',
  'event SessionSettled(bytes32 indexed sessionId, address indexed player, uint32[5] finishTime, uint8[5] rawOrder, uint8[5] settlementOrder, uint8 playerSettlementRank, uint256 payout, bytes32 digest, uint8[3] acquired)',
  'event SessionForfeited(bytes32 indexed sessionId, address indexed player, uint256 stake, uint8 reason)',
  'error ActiveSession()',
  'error AnchorUnavailable()',
  'error EntryPaused()',
  'error ForfeitNotAllowed()',
  'error ForfeitProbeGasTooLow()',
  'error ForfeitTooEarly(uint256 availableAt)',
  'error InvalidCard()',
  'error InvalidCheckpoint()',
  'error InvalidEntry()',
  'error StakeValueMismatch()',
  'error InvalidRefreshSlot()',
  'error InvalidSolverResult()',
  'error NotSessionPlayer()',
  'error RaceNotFinished(uint256 elapsedMs, uint32 finishWall)',
  'error SessionNotOpen()',
  'error TooManyRefreshes()',
  'error UnknownSession()',
])

/** PonyGame 的会话状态码（STATE_*）。 */
export const SESSION_STATE = { none: 0, open: 1, settled: 2, forfeited: 3 } as const
/** `SessionForfeited.reason` / `canForfeit` 的原因码（FORFEIT_*）：1 = 所需锚过窗丢失（任何人），2 = owner 关闭求时器故障会话。 */
export const FORFEIT_REASON = { anchorLost: 1, solverFault: 2 } as const
export const MAX_REFRESH_SLOTS = 3

export function requireContract(address: Address): void {
  if (!isAddress(address) || isAddressEqual(address, zeroAddress)) throw new Error('INVALID_CONTRACT_ADDRESS')
}

export function requireSession(sessionId: Hex): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(sessionId) || /^0x0{64}$/.test(sessionId)) throw new Error('INVALID_SESSION_ID')
}

/** 一次开场调用携带完整下注；Game 在同一交易内转入绑定的 Vault。 */
export function openSessionCall(game: Address, horseId: number, stake: bigint): ContractCall {
  requireContract(game)
  if (!Number.isInteger(horseId) || horseId < 0 || horseId >= 5) throw new Error('INVALID_PAID_ENTRY')
  paidTierForStake(stake)
  return {
    to: game, data: encodeFunctionData({ abi: ponyGameAbi, functionName: 'openSession', args: [horseId, stake] }), value: stake,
  }
}

/**
 * 检查点 1..3；cardId 0 是主动放弃；刷新槽位按使用顺序、各 0..2 且不重复。合约只做同样的廉价形状检查就记录，
 * 选择是否生效（时间窗、候选、刷新额度）由结算求时判定（有奖规则 v3），发送前的规则校验在 TS 求时器。
 */
export function chooseCardCall(
  game: Address, sessionId: Hex, checkpoint: number, cardId: number, refreshSlots: readonly number[],
): ContractCall {
  requireContract(game)
  requireSession(sessionId)
  const slotsOk = refreshSlots.length <= MAX_REFRESH_SLOTS
    && refreshSlots.every((slot) => Number.isInteger(slot) && slot >= 0 && slot <= 2)
    && new Set(refreshSlots).size === refreshSlots.length
  if (!Number.isInteger(checkpoint) || checkpoint < 1 || checkpoint > 3 || !Number.isInteger(cardId)
    || cardId < 0 || cardId > PAID_CARD_COUNT || !slotsOk) {
    throw new Error('INVALID_CARD_CHOICE')
  }
  return {
    to: game,
    data: encodeFunctionData({
      abi: ponyGameAbi, functionName: 'chooseCard', args: [sessionId, checkpoint, cardId, [...refreshSlots]],
    }),
  }
}

export function settleSessionCall(game: Address, sessionId: Hex): ContractCall {
  requireContract(game)
  requireSession(sessionId)
  return { to: game, data: encodeFunctionData({ abi: ponyGameAbi, functionName: 'settleSession', args: [sessionId] }) }
}

/** 判负（返还 0）：`canForfeit` 为 (true, 1) 时任何人可调；原因 2 只有 owner，且交易须留足 FORFEIT_PROBE_GAS。 */
export function forfeitSessionCall(game: Address, sessionId: Hex): ContractCall {
  requireContract(game)
  requireSession(sessionId)
  return { to: game, data: encodeFunctionData({ abi: ponyGameAbi, functionName: 'forfeitSession', args: [sessionId] }) }
}

/** 任何人都能调用；浏览器正常流程不需要它——选牌与结算会自动封存所需的锚。 */
export function sealAnchorsCall(game: Address, sessionId: Hex): ContractCall {
  requireContract(game)
  requireSession(sessionId)
  return { to: game, data: encodeFunctionData({ abi: ponyGameAbi, functionName: 'sealAnchors', args: [sessionId] }) }
}
