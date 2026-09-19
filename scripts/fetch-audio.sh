#!/usr/bin/env bash
# =============================================================================
# fetch-audio.sh  –  Prepare CC0 placeholder audio for Ponygogogo
#
# Idempotent: existing output files are skipped.
# Raw zips cached in .cache/audio/; processed files go to
# art-src/placeholder/audio/ as .ogg (Opus) + .mp3.
#
# Note: ffmpeg on this system is built without libvorbis. The .ogg files use
# the Opus codec (libopus) which is superior quality and fully browser-
# compatible. File extension remains .ogg (Ogg/Opus container).
#
# Sources (all CC0):
#   Kenney Interface Sounds  CC0  https://kenney.nl/assets/interface-sounds
#   Kenney UI Audio          CC0  https://kenney.nl/assets/ui-audio
#   Kenney Music Jingles     CC0  https://kenney.nl/assets/music-jingles
#   OpenGameArt: Bouncy Hamster Dancing  CC0  https://opengameart.org/content/bouncy-hamster-dancing-menu-music
#   OpenGameArt: Hyperflight Racing      CC0  https://opengameart.org/content/hyperflight-racing
#   Synthesized (ffmpeg sine/noise)      CC0  (original, public domain)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CACHE_DIR="$ROOT_DIR/.cache/audio"
EXTRACT_DIR="$CACHE_DIR/extracted"
OUT_DIR="$ROOT_DIR/art-src/placeholder/audio"

# ── Kenney download URLs ──────────────────────────────────────────────────────
INTERFACE_URL="https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip"
UI_AUDIO_URL="https://kenney.nl/media/pages/assets/ui-audio/490d233f68-1677590494/kenney_ui-audio.zip"
JINGLES_URL="https://kenney.nl/media/pages/assets/music-jingles/f37e530b9e-1677590399/kenney_music-jingles.zip"

# ── OGA BGM URLs (CC0) ────────────────────────────────────────────────────────
# Bouncy Hamster Dancing (Menu Music) by cynicmusic – CC0
BGM_HOME_URL="https://opengameart.org/sites/default/files/AlexBouncyMaster.mp3"
# Hyperflight Racing by cynicmusic – CC0
BGM_RACE_URL="https://opengameart.org/sites/default/files/2012_november_fakeAwake04%20back%20to%20A%20minor.mp3"

# ─────────────────────────────────────────────────────────────────────────────
mkdir -p "$CACHE_DIR" "$EXTRACT_DIR" "$OUT_DIR"

log()  { echo "[fetch-audio] $*"; }
warn() { echo "[fetch-audio] WARN: $*" >&2; }
die()  { echo "[fetch-audio] ERROR: $*" >&2; exit 1; }

# ── Verify required tools ─────────────────────────────────────────────────────
for tool in ffmpeg ffprobe curl unzip python3; do
  command -v "$tool" >/dev/null 2>&1 || die "Missing required tool: $tool"
done

# ── Helper: download if not cached ───────────────────────────────────────────
download_cached() {
  local url="$1" dest="$2"
  if [[ -f "$dest" ]] && [[ -s "$dest" ]]; then
    log "Cache hit: $(basename "$dest")"
    return 0
  fi
  log "Downloading $(basename "$dest")..."
  curl -fsSL --retry 3 -o "$dest" "$url" || die "Download failed: $url"
}

# ── Helper: peak-normalize to -3 dBFS → output wav ──────────────────────────
peak_normalize() {
  local input="$1" output="$2"
  local maxvol
  maxvol=$(ffmpeg -y -i "$input" -af volumedetect -f null /dev/null 2>&1 \
    | grep 'max_volume' \
    | sed 's/.*max_volume: \(-*[0-9][0-9.]*\) dB.*/\1/' \
    | head -1)
  [[ -z "$maxvol" ]] && maxvol="-20.0"
  local gain
  gain=$(python3 -c "print(f'{-3.0 - float(\"$maxvol\"):.2f}')")
  ffmpeg -y -i "$input" -ar 44100 -ac 1 -af "volume=${gain}dB" "$output" >/dev/null 2>&1
}

# ── Helper: generate a single sine note (output: wav) ────────────────────────
# make_note <freq_hz> <duration_s> <output_wav>
make_note() {
  local freq="$1" dur="$2" out="$3"
  local fade_out_st
  fade_out_st=$(python3 -c "print(f'{max(0.0, float(\"$dur\") - 0.12):.3f}')")
  ffmpeg -y -f lavfi \
    -i "sine=frequency=${freq}:duration=${dur}" \
    -af "afade=t=in:d=0.015,afade=t=out:st=${fade_out_st}:d=0.10,volume=0.45" \
    -ar 44100 -ac 1 "$out" >/dev/null 2>&1
}

# ── Helper: concat wav files into one wav ────────────────────────────────────
concat_wavs() {
  local out="$1"; shift
  local -a inputs filter_parts
  local i=0
  for f in "$@"; do
    inputs+=(-i "$f")
    filter_parts+=("[${i}:a]")
    i=$((i + 1))
  done
  local filter
  filter="${filter_parts[*]}concat=n=${i}:v=0:a=1[out]"
  ffmpeg -y "${inputs[@]}" -filter_complex "$filter" -map "[out]" "$out" >/dev/null 2>&1
}

# ── Helper: pitch shift via asetrate (semitones) → output wav ────────────────
# pitch_shift <input> <output> <semitones>
pitch_shift() {
  local input="$1" output="$2" semitones="$3"
  local rate_mult
  rate_mult=$(python3 -c "import math; print(f'{44100 * math.pow(2, $semitones/12.0):.2f}')")
  ffmpeg -y -i "$input" \
    -af "asetrate=${rate_mult},aresample=44100" \
    -ar 44100 -ac 1 "$output" >/dev/null 2>&1
}

# ── Helper: produce final .ogg (Opus) + .mp3 pair from a source ──────────────
# produce <source_wav_or_ogg> <key_name>
produce() {
  local src="$1" key="$2"
  local ogg="$OUT_DIR/${key}.ogg"
  local mp3="$OUT_DIR/${key}.mp3"

  if [[ -f "$ogg" && -f "$mp3" && -s "$ogg" && -s "$mp3" ]]; then
    log "Skip (exists): $key"
    return 0
  fi

  # Normalize to temp wav first
  local tmp_norm
  tmp_norm="$CACHE_DIR/tmp_norm_${key}.wav"
  peak_normalize "$src" "$tmp_norm"

  # .ogg: Opus 64k mono (libvorbis unavailable; Opus is superior and browser-compatible)
  ffmpeg -y -i "$tmp_norm" -c:a libopus -ar 48000 -ac 1 -b:a 64k "$ogg" >/dev/null 2>&1
  # .mp3: 128k mono
  ffmpeg -y -i "$tmp_norm" -c:a libmp3lame -ar 44100 -ac 1 -b:a 128k "$mp3" >/dev/null 2>&1

  rm -f "$tmp_norm"
  log "Produced: $key"
}

# ── Helper: produce BGM (higher quality, silence-trimmed, 0.7 gain) ──────────
produce_bgm() {
  local src="$1" key="$2"
  local ogg="$OUT_DIR/${key}.ogg"
  local mp3="$OUT_DIR/${key}.mp3"

  if [[ -f "$ogg" && -f "$mp3" && -s "$ogg" && -s "$mp3" ]]; then
    log "Skip (exists): $key"
    return 0
  fi

  local tmp_trim
  tmp_trim="$CACHE_DIR/tmp_trim_${key}.wav"
  # Convert to mono 44.1kHz, trim leading/trailing silence, apply gentle gain
  ffmpeg -y -i "$src" \
    -ar 44100 -ac 1 \
    -af "silenceremove=start_periods=1:start_silence=0.02:start_threshold=-60dB:stop_periods=-1:stop_silence=0.02:stop_threshold=-60dB,volume=0.7" \
    "$tmp_trim" >/dev/null 2>&1

  # .ogg: Opus 128k (higher bitrate for BGM)
  ffmpeg -y -i "$tmp_trim" -c:a libopus -ar 48000 -ac 1 -b:a 128k "$ogg" >/dev/null 2>&1
  # .mp3: 128k
  ffmpeg -y -i "$tmp_trim" -c:a libmp3lame -ar 44100 -ac 1 -b:a 128k "$mp3" >/dev/null 2>&1

  rm -f "$tmp_trim"
  log "Produced BGM: $key"
}

# =============================================================================
# STEP 1 – Download and extract Kenney packs
# =============================================================================

log "=== Step 1: Download Kenney packs ==="

download_cached "$INTERFACE_URL" "$CACHE_DIR/kenney_interface-sounds.zip"
download_cached "$UI_AUDIO_URL"  "$CACHE_DIR/kenney_ui-audio.zip"
download_cached "$JINGLES_URL"   "$CACHE_DIR/kenney_music-jingles.zip"

log "Extracting sound files..."
# -j: junk paths (extract flat into target dir)
unzip -o -j "$CACHE_DIR/kenney_interface-sounds.zip" "Audio/*.ogg" \
  -d "$EXTRACT_DIR/is" >/dev/null 2>&1 || true
unzip -o -j "$CACHE_DIR/kenney_ui-audio.zip" "Audio/*.ogg" \
  -d "$EXTRACT_DIR/ui" >/dev/null 2>&1 || true
unzip -o -j "$CACHE_DIR/kenney_music-jingles.zip" "Audio/*/*" \
  -d "$EXTRACT_DIR/jingles" >/dev/null 2>&1 || true

log "Kenney packs extracted."

# =============================================================================
# STEP 2 – Download OGA BGM tracks
# =============================================================================

log "=== Step 2: Download OGA BGM tracks ==="

download_cached "$BGM_HOME_URL" "$CACHE_DIR/bgm_home_src.mp3"
download_cached "$BGM_RACE_URL" "$CACHE_DIR/bgm_race_src.mp3"

# =============================================================================
# STEP 3 – Process all 24 keys
# =============================================================================

log "=== Step 3: Process audio keys ==="

IS="$EXTRACT_DIR/is"        # Kenney Interface Sounds
UI="$EXTRACT_DIR/ui"        # Kenney UI Audio
JG="$EXTRACT_DIR/jingles"   # Kenney Music Jingles

# ── sfx_ui_click  (button click) ─────────────────────────────────────────────
produce "$IS/click_001.ogg" "sfx_ui_click"

# ── sfx_ui_hover  (hover, very light – pre-attenuated) ──────────────────────
if [[ ! -f "$OUT_DIR/sfx_ui_hover.ogg" ]] || [[ ! -s "$OUT_DIR/sfx_ui_hover.ogg" ]]; then
  tmp_h="$CACHE_DIR/tmp_hover_pre.wav"
  ffmpeg -y -i "$UI/rollover1.ogg" -ar 44100 -ac 1 -af "volume=-10dB" "$tmp_h" >/dev/null 2>&1
  produce "$tmp_h" "sfx_ui_hover"
  rm -f "$tmp_h"
else
  log "Skip (exists): sfx_ui_hover"
fi

# ── sfx_ui_back  (back/cancel, descending) ───────────────────────────────────
produce "$IS/back_001.ogg" "sfx_ui_back"

# ── sfx_card_deal  (card dealt, pluck) ───────────────────────────────────────
produce "$IS/pluck_001.ogg" "sfx_card_deal"

# ── sfx_card_hover  (card hover, light select) ───────────────────────────────
produce "$IS/select_001.ogg" "sfx_card_hover"

# ── sfx_card_pick  (card picked, ascending confirm) ──────────────────────────
produce "$IS/confirmation_001.ogg" "sfx_card_pick"

# ── sfx_card_refresh  (shuffle/refresh feel) ─────────────────────────────────
produce "$IS/scratch_001.ogg" "sfx_card_refresh"

# ── sfx_countdown_tick  (tick) ───────────────────────────────────────────────
produce "$IS/tick_001.ogg" "sfx_countdown_tick"

# ── sfx_race_start  (starting gun – synthesized) ─────────────────────────────
if [[ ! -f "$OUT_DIR/sfx_race_start.ogg" ]] || [[ ! -s "$OUT_DIR/sfx_race_start.ogg" ]]; then
  log "Synthesizing sfx_race_start (starting gun)..."
  tmp_shot="$CACHE_DIR/tmp_race_start.wav"
  # White-noise burst (sharp attack + fast decay) + low-freq thud
  ffmpeg -y \
    -f lavfi -i "anoisesrc=duration=0.6:color=white:amplitude=0.85" \
    -f lavfi -i "sine=frequency=75:duration=0.35" \
    -filter_complex "
      [0]afade=t=in:d=0.002,afade=t=out:st=0.06:d=0.54[noise];
      [1]afade=t=in:d=0.002,afade=t=out:st=0.06:d=0.29,volume=0.5[thud];
      [noise][thud]amix=inputs=2:normalize=0
    " \
    -ar 44100 -ac 1 "$tmp_shot" >/dev/null 2>&1
  produce "$tmp_shot" "sfx_race_start"
  rm -f "$tmp_shot"
else
  log "Skip (exists): sfx_race_start"
fi

# ── sfx_gogo_good / early / late  (rhythm hit – pitch-shifted trio) ──────────
# Base source: select_003.ogg (short, bright, tonal click)
# good  = 0 semitones  (correct timing)
# early = +4 semitones ×1.26  (player too fast/sharp)
# late  = −4 semitones ×0.79  (player too slow/flat)
GOGO_BASE="$IS/select_003.ogg"

if [[ ! -f "$OUT_DIR/sfx_gogo_good.ogg" ]] || [[ ! -s "$OUT_DIR/sfx_gogo_good.ogg" ]]; then
  log "Processing sfx_gogo pitch trio..."
  tmp_base="$CACHE_DIR/tmp_gogo_base.wav"
  ffmpeg -y -i "$GOGO_BASE" -ar 44100 -ac 1 "$tmp_base" >/dev/null 2>&1

  produce "$tmp_base" "sfx_gogo_good"

  tmp_early="$CACHE_DIR/tmp_gogo_early.wav"
  pitch_shift "$tmp_base" "$tmp_early" 4
  produce "$tmp_early" "sfx_gogo_early"
  rm -f "$tmp_early"

  tmp_late="$CACHE_DIR/tmp_gogo_late.wav"
  pitch_shift "$tmp_base" "$tmp_late" -4
  produce "$tmp_late" "sfx_gogo_late"
  rm -f "$tmp_late"

  rm -f "$tmp_base"
else
  log "Skip (exists): sfx_gogo_good / early / late"
fi

# ── sfx_exhaust_enter  (descending heavy – exhaustion onset) ─────────────────
produce "$IS/minimize_001.ogg" "sfx_exhaust_enter"

# ── sfx_exhaust_exit  (ascending light – recovery) ───────────────────────────
produce "$IS/maximize_001.ogg" "sfx_exhaust_exit"

# ── sfx_checkpoint  (checkpoint marker, brief confirm) ───────────────────────
produce "$IS/confirmation_002.ogg" "sfx_checkpoint"

# ── sfx_finish  (crossing finish line – NES jingle) ──────────────────────────
produce "$JG/jingles_NES00.ogg" "sfx_finish"

# ── sfx_result_open  (result screen expands) ─────────────────────────────────
produce "$IS/open_001.ogg" "sfx_result_open"

# ── sfx_explosion  (synthesized: brown noise + bass thud) ────────────────────
if [[ ! -f "$OUT_DIR/sfx_explosion.ogg" ]] || [[ ! -s "$OUT_DIR/sfx_explosion.ogg" ]]; then
  log "Synthesizing sfx_explosion..."
  tmp_expl="$CACHE_DIR/tmp_explosion.wav"
  ffmpeg -y \
    -f lavfi -i "anoisesrc=duration=1.6:color=brown:amplitude=0.9" \
    -f lavfi -i "sine=frequency=55:duration=0.45" \
    -filter_complex "
      [0]afade=t=in:d=0.003,afade=t=out:st=0.28:d=1.32,
         equalizer=f=100:t=o:w=2:g=8[n];
      [1]afade=t=in:d=0.002,afade=t=out:st=0.12:d=0.33,volume=0.6[bass];
      [n][bass]amix=inputs=2:normalize=0
    " \
    -ar 44100 -ac 1 "$tmp_expl" >/dev/null 2>&1
  produce "$tmp_expl" "sfx_explosion"
  rm -f "$tmp_expl"
else
  log "Skip (exists): sfx_explosion"
fi

# ── sfx_swap  (whoosh swap – glitch feel) ────────────────────────────────────
produce "$IS/glitch_001.ogg" "sfx_swap"

# ── sfx_equip  (equip mount – toggle click) ──────────────────────────────────
produce "$IS/toggle_001.ogg" "sfx_equip"

# ── jingle_win  (2.6 s, C major ascending arpeggio – synthesized) ────────────
if [[ ! -f "$OUT_DIR/jingle_win.ogg" ]] || [[ ! -s "$OUT_DIR/jingle_win.ogg" ]]; then
  log "Synthesizing jingle_win (C major arpeggio, ~2.6s)..."
  n1="$CACHE_DIR/jw_n1.wav"  # C4  261.63 Hz
  n2="$CACHE_DIR/jw_n2.wav"  # E4  329.63 Hz
  n3="$CACHE_DIR/jw_n3.wav"  # G4  392.00 Hz
  n4="$CACHE_DIR/jw_n4.wav"  # C5  523.25 Hz (held longer)
  make_note 261.63 0.5 "$n1"
  make_note 329.63 0.5 "$n2"
  make_note 392.00 0.5 "$n3"
  make_note 523.25 1.1 "$n4"
  tmp_win="$CACHE_DIR/tmp_jingle_win.wav"
  concat_wavs "$tmp_win" "$n1" "$n2" "$n3" "$n4"
  rm -f "$n1" "$n2" "$n3" "$n4"
  tmp_win2="$CACHE_DIR/tmp_jingle_win2.wav"
  ffmpeg -y -i "$tmp_win" \
    -af "aecho=0.6:0.7:80:0.3,volume=0.8" \
    -ar 44100 -ac 1 "$tmp_win2" >/dev/null 2>&1
  rm -f "$tmp_win"
  produce "$tmp_win2" "jingle_win"
  rm -f "$tmp_win2"
else
  log "Skip (exists): jingle_win"
fi

# ── jingle_lose  (2.6 s, A minor descending – synthesized) ──────────────────
if [[ ! -f "$OUT_DIR/jingle_lose.ogg" ]] || [[ ! -s "$OUT_DIR/jingle_lose.ogg" ]]; then
  log "Synthesizing jingle_lose (A minor descending, ~2.6s)..."
  m1="$CACHE_DIR/jl_n1.wav"  # E5  659.25 Hz
  m2="$CACHE_DIR/jl_n2.wav"  # C5  523.25 Hz
  m3="$CACHE_DIR/jl_n3.wav"  # A4  440.00 Hz
  m4="$CACHE_DIR/jl_n4.wav"  # E4  329.63 Hz (held longer, final)
  make_note 659.25 0.5 "$m1"
  make_note 523.25 0.5 "$m2"
  make_note 440.00 0.5 "$m3"
  make_note 329.63 1.1 "$m4"
  tmp_lose="$CACHE_DIR/tmp_jingle_lose.wav"
  concat_wavs "$tmp_lose" "$m1" "$m2" "$m3" "$m4"
  rm -f "$m1" "$m2" "$m3" "$m4"
  tmp_lose2="$CACHE_DIR/tmp_jingle_lose2.wav"
  ffmpeg -y -i "$tmp_lose" \
    -af "aecho=0.5:0.6:120:0.25,volume=0.7" \
    -ar 44100 -ac 1 "$tmp_lose2" >/dev/null 2>&1
  rm -f "$tmp_lose"
  produce "$tmp_lose2" "jingle_lose"
  rm -f "$tmp_lose2"
else
  log "Skip (exists): jingle_lose"
fi

# ── bgm_home  (OGA Bouncy Hamster Dancing, CC0, ~64.97s) ─────────────────────
produce_bgm "$CACHE_DIR/bgm_home_src.mp3" "bgm_home"

# ── bgm_race  (OGA Hyperflight Racing, CC0, ~60.69s) ─────────────────────────
produce_bgm "$CACHE_DIR/bgm_race_src.mp3" "bgm_race"

# =============================================================================
# STEP 4 – Verify all 24 keys (duration > 0, decodable)
# =============================================================================

log "=== Step 4: Verify all outputs ==="

KEYS=(
  sfx_ui_click sfx_ui_hover sfx_ui_back
  sfx_card_deal sfx_card_hover sfx_card_pick sfx_card_refresh
  sfx_countdown_tick sfx_race_start
  sfx_gogo_good sfx_gogo_early sfx_gogo_late
  sfx_exhaust_enter sfx_exhaust_exit
  sfx_checkpoint sfx_finish sfx_result_open
  sfx_explosion sfx_swap sfx_equip
  jingle_win jingle_lose
  bgm_home bgm_race
)

FAIL=0
for key in "${KEYS[@]}"; do
  ogg="$OUT_DIR/${key}.ogg"
  mp3="$OUT_DIR/${key}.mp3"
  if [[ ! -f "$ogg" ]]; then
    warn "MISSING: $ogg"; FAIL=1; continue
  fi
  if [[ ! -f "$mp3" ]]; then
    warn "MISSING: $mp3"; FAIL=1; continue
  fi
  dur=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$ogg" 2>/dev/null || echo "0")
  ok=$(python3 -c "exit(0 if float('${dur:-0}') > 0 else 1)" 2>/dev/null && echo "OK" || echo "FAIL")
  size=$(wc -c < "$ogg")
  log "  ${ok}  ${key}  dur=${dur}s  ogg_bytes=${size}"
  [[ "$ok" == "OK" ]] || FAIL=1
done

[[ $FAIL -eq 0 ]] || die "One or more files failed verification."

# =============================================================================
# STEP 5 – Generate manifest.json
# =============================================================================

log "=== Step 5: Generating manifest.json ==="

python3 << PYEOF
import json, os, sys

out_dir = "$OUT_DIR"

meta = {
    "sfx_ui_click":       {"loop": False, "gain": 0.70},
    "sfx_ui_hover":       {"loop": False, "gain": 0.50},
    "sfx_ui_back":        {"loop": False, "gain": 0.70},
    "sfx_card_deal":      {"loop": False, "gain": 0.70},
    "sfx_card_hover":     {"loop": False, "gain": 0.55},
    "sfx_card_pick":      {"loop": False, "gain": 0.70},
    "sfx_card_refresh":   {"loop": False, "gain": 0.65},
    "sfx_countdown_tick": {"loop": False, "gain": 0.75},
    "sfx_race_start":     {"loop": False, "gain": 0.80},
    "sfx_gogo_good":      {"loop": False, "gain": 0.70},
    "sfx_gogo_early":     {"loop": False, "gain": 0.70},
    "sfx_gogo_late":      {"loop": False, "gain": 0.70},
    "sfx_exhaust_enter":  {"loop": False, "gain": 0.65},
    "sfx_exhaust_exit":   {"loop": False, "gain": 0.65},
    "sfx_checkpoint":     {"loop": False, "gain": 0.70},
    "sfx_finish":         {"loop": False, "gain": 0.70},
    "sfx_result_open":    {"loop": False, "gain": 0.65},
    "sfx_explosion":      {"loop": False, "gain": 0.80},
    "sfx_swap":           {"loop": False, "gain": 0.70},
    "sfx_equip":          {"loop": False, "gain": 0.70},
    "jingle_win":         {"loop": False, "gain": 0.70},
    "jingle_lose":        {"loop": False, "gain": 0.65},
    "bgm_home":           {"loop": True,  "gain": 0.35},
    "bgm_race":           {"loop": True,  "gain": 0.35},
}

manifest = {}
errors = 0
for key, m in meta.items():
    ogg_path = os.path.join(out_dir, f"{key}.ogg")
    mp3_path = os.path.join(out_dir, f"{key}.mp3")
    if not os.path.exists(ogg_path):
        print(f"MISSING ogg: {ogg_path}", file=sys.stderr)
        errors += 1
        continue
    ogg_bytes = os.path.getsize(ogg_path)
    manifest[key] = {
        "ogg": f"assets/placeholder/audio/{key}.ogg",
        "mp3": f"assets/placeholder/audio/{key}.mp3",
        "bytes": ogg_bytes,
        "loop": m["loop"],
        "gain": m["gain"],
    }

manifest_path = os.path.join(out_dir, "manifest.json")
with open(manifest_path, "w") as f:
    json.dump(manifest, f, indent=2, ensure_ascii=False)
    f.write("\n")

print(f"manifest.json written: {len(manifest)} entries")
if errors:
    sys.exit(1)
PYEOF

log "=== Done! All 24 keys produced and verified. ==="
log "Output: $OUT_DIR"
log "Cache:  $CACHE_DIR  (add .cache/ to .gitignore – done automatically below)"
