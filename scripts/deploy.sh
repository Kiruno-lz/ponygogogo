#!/usr/bin/env bash
# 一键部署到 Cloudflare Workers 静态资源与同源图鉴 API：检查 → 构建 → D1 迁移 → 部署
# DRY_RUN=1 只跑到核验为止，不执行部署
set -uo pipefail
cd "$(dirname "$0")/.."

# Worker 名与自定义域绑定在 Cloudflare 侧管理；名字的真源是 wrangler.toml 的 name，
# 这里只用来在日志里显示
PROJECT_NAME="${PROJECT_NAME:-ponygogogo}"
SITE_URL="${SITE_URL:-https://ponygo.kiruno.cc}"
DIST_DIR="dist"
# Workers 静态资源硬限制：单文件 25 MiB、单次版本文件数免费计划 20000（付费计划 100000）
# 本项目未声明付费计划，按免费计划的上限核验
MAX_FILE_BYTES=$((25 * 1024 * 1024))
MAX_FILE_COUNT=20000

say() { printf '\033[1;36m[deploy]\033[0m %s\n' "$1"; }
die() { printf '\033[1;31m[deploy]\033[0m %s\n' "$1"; exit 1; }

# ---- 1. 环境自检 ----
command -v bun >/dev/null 2>&1 || die "缺少 bun：请先安装 https://bun.sh"
say "bun $(bun --version)"
command -v npx >/dev/null 2>&1 || die "缺少 npx（随 Node.js 附带）：请先安装 https://nodejs.org"
say "npx $(npx --version)"

if [ ! -d node_modules ]; then
  say "安装依赖…"
  bun install || die "bun install 失败"
fi

# ---- 2. 类型检查 ----
# 本项目 bun run <script> 有已知故障（CouldntReadCurrentDirectory），一律直接调二进制，不写 bun run
say "类型检查…"
node node_modules/typescript/bin/tsc -b || die "tsc 类型检查未通过"

# ---- 3. 构建 ----
say "构建生产产物…"
rm -rf "$DIST_DIR"
node node_modules/vite/bin/vite.js build || die "vite build 失败"
[ -d "$DIST_DIR" ] || die "构建未产出 $DIST_DIR 目录"

# ---- 3b. 清掉系统垃圾文件 ----
# Vite 把 public/ 原样拷进 dist/，Finder 随手生成的 .DS_Store 会跟着上线：
# 既占文件数，又落在 _headers 的规则之外。构建后统一清，不指望每个人都记得删。
JUNK=$(find "$DIST_DIR" \( -name '.DS_Store' -o -name 'Thumbs.db' \) -type f -print -delete 2>/dev/null)
[ -n "$JUNK" ] && say "清掉系统垃圾文件：$(echo "$JUNK" | wc -l | tr -d ' ') 个"

# ---- 4. 产物体积报告 ----
say "产物体积："
printf '  %-13s %s\n' "dist/" "$(du -sh "$DIST_DIR" 2>/dev/null | cut -f1)"
[ -d "$DIST_DIR/build" ]  && printf '  %-13s %s\n' "dist/build/"  "$(du -sh "$DIST_DIR/build"  2>/dev/null | cut -f1)"
[ -d "$DIST_DIR/assets" ] && printf '  %-13s %s\n' "dist/assets/" "$(du -sh "$DIST_DIR/assets" 2>/dev/null | cut -f1)"
say "体积最大的 10 个文件（一眼看出是否把素材原图误打进了 dist/）："
find "$DIST_DIR" -type f -exec du -k {} + 2>/dev/null | sort -rn | head -10 | awk -F'\t' '{printf "  %8s KiB  %s\n", $1, $2}'

# ---- 5. Cloudflare Pages 硬限制核验 ----
say "核验 Workers 静态资源限制（单文件 ≤ 25 MiB，单次版本 ≤ ${MAX_FILE_COUNT} 个文件）…"
FILE_COUNT=$(find "$DIST_DIR" -type f | wc -l | tr -d ' ')
say "文件数：$FILE_COUNT"
if [ "$FILE_COUNT" -gt "$MAX_FILE_COUNT" ]; then
  die "文件数 $FILE_COUNT 超过 $MAX_FILE_COUNT，请检查是否把素材原图或多余产物打进了 dist/"
fi

OVERSIZED=$(find "$DIST_DIR" -type f -size +"${MAX_FILE_BYTES}"c -print 2>/dev/null)
if [ -n "$OVERSIZED" ]; then
  say "以下文件超过 25 MiB："
  echo "$OVERSIZED" | sed 's/^/  /'
  die "存在超过单文件大小上限的产物，部署会被 Cloudflare 拒绝"
fi
say "限制核验通过"

# ---- 5b. 缓存规则覆盖核验 ----
# public/_headers 里素材的缓存规则按子目录写死（/assets/art/*、/assets/placeholder/*、
# /assets/manifest.json），换来规则互不重叠、不依赖 Cloudflare 的头撤销语义。
# 代价是管线新增顶层目录时会静默漏掉规则，所以在这里守住。
# SPA 回退不走 _redirects，由 wrangler.toml 的 not_found_handling 负责。
[ -f "$DIST_DIR/_headers" ] || die "_headers 没有进入产物，站点会失去全部缓存策略"
UNCOVERED=$(find "$DIST_DIR/assets" -type f 2>/dev/null \
  | sed "s|^$DIST_DIR/||" \
  | grep -v -e '^assets/art/' -e '^assets/placeholder/' -e '^assets/manifest\.json$' || true)
if [ -n "$UNCOVERED" ]; then
  say "以下产物不在 public/_headers 的任何一条素材规则内："
  echo "$UNCOVERED" | sed 's/^/  /'
  die "补一条对应的规则到 public/_headers，或把它们归回 art/ 与 placeholder/"
fi
say "缓存规则覆盖核验通过"

# ---- 6. 生产 D1 迁移与部署 ----
if [ "${DRY_RUN:-0}" = "1" ]; then
  say "DRY_RUN=1，跳过部署，仅完成构建与核验"
  exit 0
fi

# 先迁移再切 Worker；否则新 API 会在旧 schema 上启动。
say "应用 production 图鉴 D1 迁移…"
npx wrangler d1 migrations apply COLLECTION_DB --remote || die "production D1 迁移失败"

# 目录与名字都从 wrangler.toml 读，命令行不重复一遍，避免两处打架
say "部署到 Cloudflare（Worker：$PROJECT_NAME）…"
npx wrangler deploy || die "wrangler 部署失败"
say "部署完成 → $SITE_URL"
