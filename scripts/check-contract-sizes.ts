import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

// https://docs.monad.xyz/developer-essentials/differences
export const MONAD_RUNTIME_LIMIT = 131_072
export const MONAD_INITCODE_LIMIT = 262_144

type Bytecode = { object: string; linkReferences: Record<string, Record<string, unknown[]>> }
export type ContractArtifact = { bytecode: Bytecode; deployedBytecode: Bytecode }

export function checkContractSize(name: string, artifact: ContractArtifact): { runtime: number; initcode: number } {
  const sizes = [artifact.deployedBytecode, artifact.bytecode].map((code, index) => {
    const kind = index === 0 ? 'runtime' : 'initcode'
    if (!code || !code.linkReferences || Object.values(code.linkReferences).some((libs) => Object.keys(libs).length > 0)) {
      throw new Error(`${name}: ${kind} contains linked libraries`)
    }
    const hex = code.object.replace(/^0x/, '')
    if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
      throw new Error(`${name}: invalid ${kind} bytecode`)
    }
    const size = hex.length / 2
    const limit = index === 0 ? MONAD_RUNTIME_LIMIT : MONAD_INITCODE_LIMIT
    if (size > limit) throw new Error(`${name}: ${kind} ${size} B exceeds Monad limit ${limit} B`)
    return size
  })
  return { runtime: sizes[0]!, initcode: sizes[1]! }
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, '..')
  execFileSync('forge', ['build', '--skip', 'test', '--skip', 'script', '--quiet'], { cwd: root, stdio: 'inherit' })
  // Only concrete deployable contracts live at contracts/ root.
  for (const file of readdirSync(resolve(root, 'contracts')).filter((file) => file.endsWith('.sol')).sort()) {
    const name = file.slice(0, -4)
    const artifact = JSON.parse(readFileSync(resolve(root, 'out', file, `${name}.json`), 'utf8')) as ContractArtifact
    const { runtime, initcode } = checkContractSize(name, artifact)
    console.log(`${name}: runtime ${runtime}/${MONAD_RUNTIME_LIMIT} B; initcode ${initcode}/${MONAD_INITCODE_LIMIT} B; EIP-170 margin ${24_576 - runtime} B; no linked libraries`)
  }
}
