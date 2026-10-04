import { parseAbi, type Address, type PublicClient } from 'viem'

/** PonyVault 的公开接口；只含浏览器与脚本会调用的入口，记账入口留给 Game。 */
export const vaultAbi = parseAbi([
  'function game() view returns (address)',
  'function totalLocked() view returns (uint256)',
  'function houseLiquidity() view returns (uint256)',
  'function reservedLiquidity() view returns (uint256)',
])

export type VaultSolvency = {
  blockNumber: bigint
  nativeBalance: bigint
  totalLocked: bigint
  houseLiquidity: bigint
  reservedLiquidity: bigint
}

export async function readVaultSolvency(client: PublicClient, vault: Address): Promise<VaultSolvency> {
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 })
  const [nativeBalance, totalLocked, houseLiquidity, reservedLiquidity] = await Promise.all([
    client.getBalance({ address: vault, blockNumber }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: 'totalLocked', blockNumber }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: 'houseLiquidity', blockNumber }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: 'reservedLiquidity', blockNumber }),
  ])
  if (nativeBalance < totalLocked + houseLiquidity || houseLiquidity < reservedLiquidity) {
    throw new Error('VAULT_INSOLVENT')
  }
  return { blockNumber, nativeBalance, totalLocked, houseLiquidity, reservedLiquidity }
}
