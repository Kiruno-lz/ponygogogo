import { parseAbi, type Address, type PublicClient } from 'viem'

/** PonyVault 的公开接口；只含浏览器与脚本会调用的入口，记账入口留给 Game。 */
export const vaultAbi = parseAbi([
  'function deposit() payable',
  'function withdraw(uint256 amount)',
  'function game() view returns (address)',
  'function available(address player) view returns (uint256)',
  'function totalAvailable() view returns (uint256)',
  'function totalLocked() view returns (uint256)',
  'function houseLiquidity() view returns (uint256)',
  'function reservedLiquidity() view returns (uint256)',
])

export type VaultSolvency = {
  blockNumber: bigint
  nativeBalance: bigint
  totalAvailable: bigint
  totalLocked: bigint
  houseLiquidity: bigint
  reservedLiquidity: bigint
}

export async function readVaultSolvency(client: PublicClient, vault: Address): Promise<VaultSolvency> {
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 })
  const [nativeBalance, totalAvailable, totalLocked, houseLiquidity, reservedLiquidity] = await Promise.all([
    client.getBalance({ address: vault, blockNumber }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: 'totalAvailable', blockNumber }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: 'totalLocked', blockNumber }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: 'houseLiquidity', blockNumber }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: 'reservedLiquidity', blockNumber }),
  ])
  if (nativeBalance < totalAvailable + totalLocked + houseLiquidity || houseLiquidity < reservedLiquidity) {
    throw new Error('VAULT_INSOLVENT')
  }
  return { blockNumber, nativeBalance, totalAvailable, totalLocked, houseLiquidity, reservedLiquidity }
}
