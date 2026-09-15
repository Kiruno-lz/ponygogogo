#!/usr/bin/env bash
# 无链 Demo 的边界检查，全部可机械检查（docs/plan/demo.md §1）
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0

say() { printf '%s\n' "$1"; }

# 1. 任何链依赖进入 package.json
if grep -Eq '"(viem|wagmi|ethers|web3|@mera/[^"]*)"' package.json; then
  say "✗ package.json 出现链依赖"; fail=1
else
  say "✓ package.json 无链依赖"
fi

# 2. 源码里出现 RPC URL、chainId、合约地址、ABI
SRC="src tests"
if grep -rInE 'https?://[a-z0-9.-]*rpc[a-z0-9.-]*|\bchainId\b|\babi\b *[:=]|0x[0-9a-fA-F]{40}\b' $SRC \
     --include='*.ts' --include='*.tsx' 2>/dev/null ; then
  say "✗ 源码出现 RPC / chainId / 合约地址 / ABI"; fail=1
else
  say "✓ 源码无 RPC / chainId / 合约地址 / ABI"
fi

# 3. 源码 import window.ethereum 或任何钱包对象
if grep -rIn 'window\.ethereum\|@mera\|WalletConnect\|injected()' $SRC --include='*.ts' --include='*.tsx' 2>/dev/null; then
  say "✗ 源码引用钱包对象"; fail=1
else
  say "✓ 源码不引用钱包对象"
fi

# 4. 界面出现 tx hash、区块浏览器链接、"上链中"字样
if grep -rInE 'txHash|tx_hash|explorer\.|etherscan|blockscout|上链中|交易哈希' src --include='*.ts' --include='*.tsx' 2>/dev/null; then
  say "✗ 界面文案出现交易哈希 / 区块浏览器 / 上链中"; fail=1
else
  say "✓ 界面文案中性，无交易哈希 / 区块浏览器 / 上链中"
fi

# 5. 规则内核单向依赖：src/race/ 不得 import 渲染 / DOM / 链
if grep -rIn "from '\.\./\.\./\(game\|ui\|chain\|cards\|result\|export\)\|from 'phaser'\|from 'react'" src/race --include='*.ts' 2>/dev/null; then
  say "✗ 规则内核反向依赖了渲染 / 链"; fail=1
else
  say "✓ 规则内核单向依赖成立"
fi

exit $fail
