#!/usr/bin/env bash
#
# 手动领测试币。游戏内的领水走 src/chain/faucet.ts，打的是同一个端点、同一份 body；
# 浏览器里跑不了 shell，所以那边是这段请求的 TypeScript 孪生体。
# 端点或 chainId 要改，两处一起改：这里和 src/chain/network.ts。

set -euo pipefail

ADDRESS="${1:-}"

if [[ -z "$ADDRESS" ]]; then
  echo "Usage: bash get_faucet.sh <address>"
  exit 1
fi

if [[ ! "$ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "Invalid Ethereum address: $ADDRESS"
  exit 1
fi

curl -i -sS \
  -X POST 'https://agents.devnads.com/v1/faucet' \
  -H 'Content-Type: application/json' \
  --data "{
    \"chainId\": 10143,
    \"address\": \"$ADDRESS\"
  }"

echo