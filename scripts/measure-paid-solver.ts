/** Read-only Monad gas check: runtime state overrides, no key, signature, deployment or broadcast. */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createPublicClient, decodeAbiParameters, encodeFunctionData, http, parseAbi, type Address, type Hex } from 'viem'
import { PAID_RULESET_HASH } from '../src/race/paid/cardRules.ts'

const root = resolve(import.meta.dir, '..')
const flag = (name: string) => process.argv[process.argv.indexOf(name) + 1]
const exportPath = process.argv.includes('--export') ? flag('--export') : null
const rpcUrl = process.argv.includes('--rpc') ? flag('--rpc')! : 'https://testnet-rpc.monad.xyz'
const output = resolve(root, process.argv.includes('--out') ? flag('--out')! : 'out/paid-solver-monad-gas.json')
const raw = exportPath ? readFileSync(exportPath, 'utf8') : execFileSync('forge', [
  'test', '--match-contract', 'PaidRaceHotCoreTest', '--match-test', 'testExportMonadProbe', '-vv', '--json',
], { cwd: root, encoding: 'utf8', maxBuffer: 5_000_000 })
const suites = JSON.parse(raw) as Record<string, { test_results: Record<string, { status: string; decoded_logs: string[] }> }>
const test = Object.values(suites).flatMap((suite) => Object.values(suite.test_results))[0]!
if (test.status !== 'Success') throw new Error('Probe export failed')
const logs = new Map(test.decoded_logs.map((line) => {
  const colon = line.indexOf(': ')
  return [line.slice(0, colon), line.slice(colon + 2)]
}))
const get = (key: string): Hex => {
  const value = logs.get(key)
  if (!value || !/^0x[0-9a-f]+$/i.test(value)) throw new Error(`Missing probe value: ${key}`)
  return value as Hex
}
const solver = get('solver address') as Address
if (get('ruleset hash') !== PAID_RULESET_HASH) throw new Error('Probe export uses a different ruleset')
const probe = get('probe address') as Address
const stateOverride = ['solver', 'probe', 'diagnostic'].map((role) => ({ address: get(`${role} address`) as Address, code: get(`${role} code`) }))
const client = createPublicClient({ transport: http(rpcUrl, { timeout: 30_000, retryCount: 0 }) })
const abi = parseAbi(['function measure(address solver, bytes data) view returns (uint256 used, bytes32 resultHash)'])
const samples: { name: string; gas: number; resultHash: Hex }[] = []
for (let offset = 0; offset < 80; offset += 4) {
  const batch = await Promise.all(Array.from({ length: 4 }, async (_, n) => {
    const name = `derived-${offset + n}`
    const data = encodeFunctionData({ abi, functionName: 'measure', args: [solver, get(`input ${name}`)] })
    const result = await client.call({ to: probe, data, gas: 30_000_000n, stateOverride, blockTag: 'latest' })
    if (!result.data) throw new Error(`${name}: no probe result`)
    const [used, resultHash] = decodeAbiParameters([{ type: 'uint256' }, { type: 'bytes32' }], result.data)
    if (resultHash !== get(`expected ${name}`)) throw new Error(`${name}: Monad result differs from local solver`)
    if (used + 300_000n > 23_500_000n) throw new Error(`${name}: solve exceeds the regression gas budget`)
    return { name, gas: Number(used), resultHash }
  }))
  // Keep the public RPC workload below its 15 requests/second limit.
  await Bun.sleep(450)
  samples.push(...batch)
  console.log(`Monad probe: ${samples.length}/80 result hashes matched`)
}
const gases = samples.map((s) => s.gas).sort((a, b) => a - b)
const stats = {
  count: samples.length, mean: gases.reduce((a, b) => a + b, 0) / gases.length,
  min: gases[0], max: gases.at(-1), median: (gases[39]! + gases[40]!) / 2,
}
const adversarialData = encodeFunctionData({ abi, functionName: 'measure', args: [get('diagnostic address') as Address, get('input adversarial')] })
const adversarialResult = await client.call({ to: probe, data: adversarialData, gas: 30_000_000n, stateOverride, blockTag: 'latest' })
if (!adversarialResult.data) throw new Error('No adversarial probe result')
const [adversarialGas, adversarialHash] = decodeAbiParameters([{ type: 'uint256' }, { type: 'bytes32' }], adversarialResult.data)
if (adversarialHash !== get('expected adversarial')) throw new Error('Adversarial result differs from the local kernel')
if (adversarialGas + 300_000n > 23_500_000n) throw new Error('Adversarial kernel exceeds the regression gas budget')
const adversarial = { name: 'worst-gas-adversarial-climb', kind: 'diagnostic kernel', gas: Number(adversarialGas), resultHash: adversarialHash }
writeFileSync(output, JSON.stringify({ rpcUrl, rulesetHash: PAID_RULESET_HASH, runtimeStateOverrides: true, broadcast: false, stats, samples, adversarial }, null, 2) + '\n')
console.log(JSON.stringify(stats))
console.log(JSON.stringify(adversarial))
console.log(`Saved ${output}`)
