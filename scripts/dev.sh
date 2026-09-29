#!/usr/bin/env bash
# 一键启动开发环境：环境自检 → 缺失提示 → 端口释放 → 启动 → 健康检查
#
#   bash scripts/dev.sh                         只起 Vite（链上走 .env 里的 Monad 测试网配置）
#   DEV_CHAIN=anvil bash scripts/dev.sh         本地全栈：anvil + 部署 Game/Vault/求时器 + Vite（--mode anvil）
#   DEV_DETACH=1 ...                            就绪后留在后台运行并退出（E2E 用）
#   bash scripts/dev.sh stop                    停掉 DEV_DETACH 留在后台的进程
#
# 可覆盖：PORT（Vite，默认 5173）、ANVIL_PORT（默认 8545）、DEV_SOLVER=auto|mock|real（默认 auto：
# out/PaidRaceSolver.sol 存在即用真实求时器，否则部署替身并启动对齐器 scripts/dev-mock-oracle.ts）。
# anvil 模式只用 anvil 公开的默认开发账户，不读 .env 里的任何密钥；地址写进 .env.anvil.local（已被 .gitignore 忽略）。
set -uo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-5173}"
ANVIL_PORT="${ANVIL_PORT:-8545}"
DEV_CHAIN="${DEV_CHAIN:-}"
DEV_SOLVER="${DEV_SOLVER:-auto}"
FOUNDRY_BIN="${FOUNDRY_BIN:-$HOME/.foundry/bin}"
# 通行密钥的 rpId 不接受 IP 字面量，必须用 localhost 打开
HOST=localhost
STATE_DIR=.cache/dev-chain
PID_FILE="$STATE_DIR/pids"
LOG_DIR="${TMPDIR:-/tmp}"

say() { printf '\033[1;36m[dev]\033[0m %s\n' "$1"; }
die() { printf '\033[1;31m[dev]\033[0m %s\n' "$1"; exit 1; }

free_port() {
  local port=$1 pids
  pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    say "端口 $port 被占用（pid: $pids），正在释放…"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 1
    pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
    # shellcheck disable=SC2086
    [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
  fi
}

stop_recorded() {
  [ -f "$PID_FILE" ] || return 0
  while read -r pid; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done < "$PID_FILE"
  rm -f "$PID_FILE"
}

if [ "${1:-}" = "stop" ]; then
  stop_recorded
  say "已停止后台开发进程"
  exit 0
fi

# ---- 1. 环境自检 ----
command -v bun >/dev/null 2>&1 || die "缺少 bun：请先安装 https://bun.sh"
say "bun $(bun --version)"

if [ ! -d node_modules ]; then
  say "安装依赖…"
  bun install || die "bun install 失败"
fi

if [ "$DEV_CHAIN" = "anvil" ]; then
  [ -x "$FOUNDRY_BIN/anvil" ] && [ -x "$FOUNDRY_BIN/forge" ] \
    || die "缺少 Foundry（anvil/forge）：curl -L https://foundry.paradigm.xyz | bash && foundryup"
  say "$("$FOUNDRY_BIN/anvil" --version | head -1)"
elif [ -n "$DEV_CHAIN" ]; then
  die "不支持的 DEV_CHAIN=$DEV_CHAIN（只支持 anvil）"
fi

# ---- 2. 素材 ----
# art-src/ 是母版，public/assets/ 是 scripts/build-web-assets.py 的产物并已提交进仓库。
# 管线跑一次约五分钟，日常开发不重跑；只有产物整个缺失时才从母版重建。
# 改了母版或改了版位之后要手动跑：python3 scripts/build-web-assets.py
if [ ! -f public/assets/manifest.json ]; then
  command -v python3 >/dev/null 2>&1 || die "缺少 python3，无法生成素材产物"
  if [ ! -d art-src/placeholder/icons ]; then
    say "占位素材母版缺失，正在生成…"
    python3 scripts/process-assets.py || die "占位素材生成失败"
  fi
  if [ ! -d art-src/placeholder/audio ]; then
    say "占位音频缺失，正在下载…"
    bash scripts/fetch-audio.sh || die "占位音频获取失败"
  fi
  say "从母版生成素材产物（约五分钟）…"
  python3 scripts/build-web-assets.py || die "素材产物生成失败"
fi

# ---- 3. 端口占用检测与释放 ----
stop_recorded
free_port "$PORT"
[ "$DEV_CHAIN" = "anvil" ] && free_port "$ANVIL_PORT"

PIDS=()
cleanup() {
  for pid in ${PIDS[@]+"${PIDS[@]}"}; do kill "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT INT TERM

# ---- 4. 本地链：anvil → 编译 → 部署 → 对齐器 ----
VITE_MODE_ARGS=()
if [ "$DEV_CHAIN" = "anvil" ]; then
  RPC="http://127.0.0.1:$ANVIL_PORT"
  mkdir -p "$STATE_DIR"
  # 与 Monad 测试网同 chainId，0.5 s 出块（Monad 约 0.35 s，时间戳同样是整秒、可重复）；真实求时器超过 24 KB
  "$FOUNDRY_BIN/anvil" --port "$ANVIL_PORT" --chain-id 10143 --block-time 0.5 --code-size-limit 131072 --silent \
    >"$LOG_DIR/ponygogogo-anvil.log" 2>&1 &
  PIDS+=($!)
  for i in $(seq 1 50); do
    if curl -sf -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$RPC" >/dev/null 2>&1; then
      say "anvil 就绪 → $RPC（chainId 10143）"
      break
    fi
    [ "$i" = 50 ] && die "anvil 启动超时，日志：$LOG_DIR/ponygogogo-anvil.log"
    sleep 0.2
  done
  # 只编译本地全栈用到的合约：仓库里其他在制的合约（求时器、向量测试）编不过也不挡开发环境
  BUILD_PATHS=(contracts/PonyGame.sol contracts/PonyVault.sol tests/contracts/MockPaidRaceSolver.sol scripts/DeployPony.s.sol)
  [ -f contracts/PaidRaceSolver.sol ] && [ "$DEV_SOLVER" != "mock" ] && BUILD_PATHS+=(contracts/PaidRaceSolver.sol)
  say "编译合约（forge build ${BUILD_PATHS[*]}）…"
  if ! "$FOUNDRY_BIN/forge" build "${BUILD_PATHS[@]}" >"$LOG_DIR/ponygogogo-forge.log" 2>&1; then
    if [ "$DEV_SOLVER" = "auto" ] && [ -f contracts/PaidRaceSolver.sol ]; then
      say "真实求时器编译失败，退回替身（日志：$LOG_DIR/ponygogogo-forge.log）"
      DEV_SOLVER=mock
      "$FOUNDRY_BIN/forge" build contracts/PonyGame.sol contracts/PonyVault.sol tests/contracts/MockPaidRaceSolver.sol scripts/DeployPony.s.sol \
        >"$LOG_DIR/ponygogogo-forge.log" 2>&1 || die "forge build 失败，日志：$LOG_DIR/ponygogogo-forge.log"
    else
      die "forge build 失败，日志：$LOG_DIR/ponygogogo-forge.log"
    fi
  fi
  say "部署 Game / Vault / 求时器…"
  bun --no-env-file scripts/dev-chain.ts --rpc "$RPC" --solver "$DEV_SOLVER" >"$LOG_DIR/ponygogogo-deploy.log" 2>&1 \
    || { tail -30 "$LOG_DIR/ponygogogo-deploy.log"; die "部署失败"; }
  SOLVER_KIND=$(bun --no-env-file -e "console.log(JSON.parse(require('fs').readFileSync('$STATE_DIR/anvil.json','utf8')).solverKind)")
  say "已部署（求时器：$SOLVER_KIND）→ .env.anvil.local、$STATE_DIR/anvil.json"
  if [ "$SOLVER_KIND" = "mock" ]; then
    bun --no-env-file scripts/dev-mock-oracle.ts >"$LOG_DIR/ponygogogo-oracle.log" 2>&1 &
    PIDS+=($!)
    say "替身求时器对齐器已启动（日志：$LOG_DIR/ponygogogo-oracle.log）"
  fi
  VITE_MODE_ARGS=(--mode anvil)
fi

# ---- 5. 启动 Vite ----
# 直接调 vite：本仓库里 `bun run <script>` 会报 CouldntReadCurrentDirectory
say "启动 Vite: http://$HOST:$PORT ${VITE_MODE_ARGS[*]:-}"
# macOS 自带 bash 3.2 在 set -u 下展开空数组会报错，用 ${a[@]+...} 兜住
./node_modules/.bin/vite --port "$PORT" --strictPort --host "$HOST" ${VITE_MODE_ARGS[@]+"${VITE_MODE_ARGS[@]}"} >"$LOG_DIR/ponygogogo-dev.log" 2>&1 &
PIDS+=($!)
VITE_PID=$!

# ---- 6. 健康检查 ----
for i in $(seq 1 60); do
  if curl -sf "http://$HOST:$PORT/" >/dev/null 2>&1; then
    if [ "$DEV_CHAIN" = "anvil" ]; then
      curl -sf -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' \
        "http://127.0.0.1:$ANVIL_PORT" >/dev/null 2>&1 || die "anvil 健康检查失败"
    fi
    say "就绪（${i}×0.5s）→ http://$HOST:$PORT"
    if [ "${DEV_DETACH:-0}" = "1" ]; then
      mkdir -p "$STATE_DIR"
      printf '%s\n' "${PIDS[@]}" >"$PID_FILE"
      trap - EXIT INT TERM
      say "后台运行中；停止：bash scripts/dev.sh stop"
      exit 0
    fi
    wait "$VITE_PID"
    exit 0
  fi
  sleep 0.5
done
say "启动超时，日志："
tail -30 "$LOG_DIR/ponygogogo-dev.log"
exit 1
