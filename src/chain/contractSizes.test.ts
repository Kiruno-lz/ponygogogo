import { expect, test } from 'bun:test'
import { checkContractSize, MONAD_INITCODE_LIMIT, MONAD_RUNTIME_LIMIT, type ContractArtifact } from '../../scripts/check-contract-sizes.ts'

const artifact = (runtime: number, initcode: number): ContractArtifact => ({
  deployedBytecode: { object: '0x' + '00'.repeat(runtime), linkReferences: {} },
  bytecode: { object: '0x' + '00'.repeat(initcode), linkReferences: {} },
})

test('Monad gate accepts its exact size limits, including runtime above EIP-170', () => {
  expect(checkContractSize('Solver', artifact(MONAD_RUNTIME_LIMIT, MONAD_INITCODE_LIMIT)))
    .toEqual({ runtime: MONAD_RUNTIME_LIMIT, initcode: MONAD_INITCODE_LIMIT })
})

test('Monad gate rejects either size one byte above its limit', () => {
  expect(() => checkContractSize('Solver', artifact(MONAD_RUNTIME_LIMIT + 1, 1))).toThrow('runtime')
  expect(() => checkContractSize('Solver', artifact(1, MONAD_INITCODE_LIMIT + 1))).toThrow('initcode')
})

test('gate rejects linked runtime and creation code, even when the library is already resolved', () => {
  for (const kind of ['bytecode', 'deployedBytecode'] as const) {
    const code = artifact(1, 1)
    code[kind].linkReferences = { 'Lib.sol': { Lib: [{ start: 1, length: 20 }] } }
    expect(() => checkContractSize('Solver', code)).toThrow('linked libraries')
  }
  const code = artifact(1, 1)
  code.bytecode.object = '0x__$unresolved$__'
  expect(() => checkContractSize('Solver', code)).toThrow('invalid initcode')
})
