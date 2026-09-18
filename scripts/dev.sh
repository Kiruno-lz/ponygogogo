#!/usr/bin/env bash
# 一键启动开发环境：环境自检 → 缺失提示 → 端口释放 → 启动 Vite → 健康检查
set -uo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-5173}"
HOST=127.0.0.1

say() { printf '\033[1;36m[dev]\033[0m %s\n' "$1"; }
die() { printf '\033[1;31m[dev]\033[0m %s\n' "$1"; exit 1; }

# ---- 1. 环境自检 ----
command -v bun >/dev/null 2>&1 || die "缺少 bun：请先安装 https://bun.sh"
say "bun $(bun --version)"

if [ ! -d node_modules ]; then
  say "安装依赖…"
  bun install || die "bun install 失败"
fi

# ---- 2. 素材与清单 ----
if [ ! -d public/assets/placeholder/icons ]; then
  say "占位素材缺失，正在生成…"
  command -v python3 >/dev/null 2>&1 || die "缺少 python3，无法生成占位素材"
  python3 scripts/process-assets.py || die "占位素材生成失败"
fi
if [ ! -f public/assets/placeholder/bg/far_clean.png ]; then
  say "背景分层二次裁切…"
  python3 scripts/postprocess-assets.py || die "背景分层生成失败"
fi
if [ ! -d public/assets/placeholder/audio ]; then
  say "占位音频缺失，正在下载…"
  bash scripts/fetch-audio.sh || die "占位音频获取失败"
fi
say "生成资源清单…"
bun run scripts/gen-manifest.ts || die "manifest 生成失败"

# ---- 3. 端口占用检测与释放 ----
PIDS=$(lsof -ti tcp:"$PORT" 2>/dev/null || true)
if [ -n "$PIDS" ]; then
  say "端口 $PORT 被占用（pid: $PIDS），正在释放…"
  # shellcheck disable=SC2086
  kill $PIDS 2>/dev/null || true
  sleep 1
  PIDS=$(lsof -ti tcp:"$PORT" 2>/dev/null || true)
  [ -n "$PIDS" ] && kill -9 $PIDS 2>/dev/null || true
fi

# ---- 4. 启动 ----
say "启动 Vite: http://$HOST:$PORT"
bun run dev >/tmp/ponygogogo-dev.log 2>&1 &
VITE_PID=$!
trap 'kill $VITE_PID 2>/dev/null || true' EXIT INT TERM

# ---- 5. 健康检查 ----
for i in $(seq 1 60); do
  if curl -sf "http://$HOST:$PORT/" >/dev/null 2>&1; then
    say "就绪（${i}×0.5s）→ http://$HOST:$PORT"
    if [ "${DEV_DETACH:-0}" = "1" ]; then trap - EXIT; exit 0; fi
    wait $VITE_PID
    exit 0
  fi
  sleep 0.5
done
say "启动超时，日志："
tail -30 /tmp/ponygogogo-dev.log
exit 1
