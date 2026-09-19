# CC0 Placeholder Audio – Ponygogogo

All files under `art-src/placeholder/audio/` are CC0 (public domain). 母版在 `art-src/`；上线产物由 `scripts/build-web-assets.py` 重编码到 `public/assets/placeholder/audio/`（Opus 80k / MP3 96k）。

Run `scripts/fetch-audio.sh` from the project root to reproduce every file.
The script is idempotent: existing files are skipped. Raw source ZIPs are
cached in `.cache/audio/` (gitignored).

## Codec note

The installed `ffmpeg` (8.1.1, Homebrew) is built without `--enable-libvorbis`.
The `.ogg` files therefore use the **Opus** codec (libopus, Ogg/Opus container),
which is equally browser-compatible and superior in quality. File extensions
remain `.ogg`; no game-engine changes are needed.

---

## sfx_gogo pitch trio – design rationale

`sfx_gogo_good / early / late` are derived from the same source file
(`kenney_interface-sounds / Audio / select_003.ogg`) via ffmpeg `asetrate`:

| Key | Pitch | Multiplier | Semitones | Meaning |
|---|---|---|---|---|
| sfx_gogo_good | Normal | ×1.00 | 0 | Correct timing |
| sfx_gogo_early | Higher | ×1.26 | +4 | Player hit too early (sharp) |
| sfx_gogo_late | Lower | ×0.79 | −4 | Player hit too late (flat) |

The duration of each variant changes proportionally (shorter = higher pitch,
longer = lower pitch) because `asetrate` resamples at a different playback
rate.

---

## File listing

| Key | Source package | Original filename | License | Method | Duration |
|---|---|---|---|---|---|
| sfx_ui_click | Kenney Interface Sounds 1.0 | Audio/click_001.ogg | CC0 | peak-normalize → Opus | 0.10 s |
| sfx_ui_hover | Kenney UI Audio | Audio/rollover1.ogg | CC0 | −10 dB pre-att + peak-normalize → Opus | 0.23 s |
| sfx_ui_back | Kenney Interface Sounds 1.0 | Audio/back_001.ogg | CC0 | peak-normalize → Opus | 0.07 s |
| sfx_card_deal | Kenney Interface Sounds 1.0 | Audio/pluck_001.ogg | CC0 | peak-normalize → Opus | 0.11 s |
| sfx_card_hover | Kenney Interface Sounds 1.0 | Audio/select_001.ogg | CC0 | peak-normalize → Opus | 0.05 s |
| sfx_card_pick | Kenney Interface Sounds 1.0 | Audio/confirmation_001.ogg | CC0 | peak-normalize → Opus | 0.30 s |
| sfx_card_refresh | Kenney Interface Sounds 1.0 | Audio/scratch_001.ogg | CC0 | peak-normalize → Opus | 0.15 s |
| sfx_countdown_tick | Kenney Interface Sounds 1.0 | Audio/tick_001.ogg | CC0 | peak-normalize → Opus | 0.05 s |
| sfx_race_start | synthesized | — | CC0 | white-noise burst (fade 0.002→0.06s) + 75 Hz sine thud; ffmpeg anoisesrc | 0.61 s |
| sfx_gogo_good | Kenney Interface Sounds 1.0 | Audio/select_003.ogg | CC0 | peak-normalize → Opus (×1.00) | 0.39 s |
| sfx_gogo_early | Kenney Interface Sounds 1.0 | Audio/select_003.ogg | CC0 | asetrate ×1.26 (+4 st) → peak-normalize → Opus | 0.31 s |
| sfx_gogo_late | Kenney Interface Sounds 1.0 | Audio/select_003.ogg | CC0 | asetrate ×0.79 (−4 st) → peak-normalize → Opus | 0.49 s |
| sfx_exhaust_enter | Kenney Interface Sounds 1.0 | Audio/minimize_001.ogg | CC0 | peak-normalize → Opus | 0.26 s |
| sfx_exhaust_exit | Kenney Interface Sounds 1.0 | Audio/maximize_001.ogg | CC0 | peak-normalize → Opus | 0.26 s |
| sfx_checkpoint | Kenney Interface Sounds 1.0 | Audio/confirmation_002.ogg | CC0 | peak-normalize → Opus | 0.55 s |
| sfx_finish | Kenney Music Jingles | Audio/8-Bit jingles/jingles_NES00.ogg | CC0 | peak-normalize → Opus | 1.76 s |
| sfx_result_open | Kenney Interface Sounds 1.0 | Audio/open_001.ogg | CC0 | peak-normalize → Opus | 0.15 s |
| sfx_explosion | synthesized | — | CC0 | brown noise + 55 Hz sine; bass-boost EQ; ffmpeg anoisesrc | 1.61 s |
| sfx_swap | Kenney Interface Sounds 1.0 | Audio/glitch_001.ogg | CC0 | peak-normalize → Opus | 0.02 s |
| sfx_equip | Kenney Interface Sounds 1.0 | Audio/toggle_001.ogg | CC0 | peak-normalize → Opus | 0.14 s |
| jingle_win | synthesized | — | CC0 | C major arpeggio (C4→E4→G4→C5, 4×sine notes concat, aecho) | 2.69 s |
| jingle_lose | synthesized | — | CC0 | A minor descent (E5→C5→A4→E4, 4×sine notes concat, aecho) | 2.73 s |
| bgm_home | OpenGameArt: Bouncy Hamster Dancing | AlexBouncyMaster.mp3 | CC0 | silence-trim + volume 0.7 → Opus 128k | 64.95 s |
| bgm_race | OpenGameArt: Hyperflight Racing | 2012_november_fakeAwake04 back to A minor.mp3 | CC0 | silence-trim + volume 0.7 → Opus 128k | 60.69 s |

---

## Sources

### Kenney Interface Sounds 1.0
- **URL**: <https://kenney.nl/assets/interface-sounds>
- **Download**: `https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip`
- **License**: CC0 1.0 Universal (<http://creativecommons.org/publicdomain/zero/1.0/>)
- **Files used**: back_001, click_001, confirmation_001, confirmation_002, glitch_001, maximize_001, minimize_001, open_001, pluck_001, scratch_001, select_001, select_003, tick_001, toggle_001

### Kenney UI Audio
- **URL**: <https://kenney.nl/assets/ui-audio>
- **Download**: `https://kenney.nl/media/pages/assets/ui-audio/490d233f68-1677590494/kenney_ui-audio.zip`
- **License**: CC0 1.0 Universal (<http://creativecommons.org/publicdomain/zero/1.0/>)
- **Files used**: rollover1 (as sfx_ui_hover base, pre-attenuated −10 dB)

### Kenney Music Jingles
- **URL**: <https://kenney.nl/assets/music-jingles>
- **Download**: `https://kenney.nl/media/pages/assets/music-jingles/f37e530b9e-1677590399/kenney_music-jingles.zip`
- **License**: CC0 1.0 Universal (<http://creativecommons.org/publicdomain/zero/1.0/>)
- **Files used**: Audio/8-Bit jingles/jingles_NES00.ogg (as sfx_finish)

### OpenGameArt – Bouncy Hamster Dancing (bgm_home)
- **Page**: <https://opengameart.org/content/bouncy-hamster-dancing-menu-music>
- **Author**: cynicmusic
- **Download**: `https://opengameart.org/sites/default/files/AlexBouncyMaster.mp3`
- **License**: CC0 1.0 Universal (confirmed on OGA page)
- **Original duration**: 64.97 s

### OpenGameArt – Hyperflight Racing (bgm_race)
- **Page**: <https://opengameart.org/content/hyperflight-racing>
- **Author**: cynicmusic
- **Download**: `https://opengameart.org/sites/default/files/2012_november_fakeAwake04%20back%20to%20A%20minor.mp3`
- **License**: CC0 1.0 Universal (confirmed on OGA page)
- **Original duration**: 60.69 s

### Synthesized audio (sfx_race_start, sfx_explosion, jingle_win, jingle_lose)
- **Generator**: ffmpeg lavfi (`anoisesrc`, `sine`, `aecho`, `concat` filters)
- **License**: CC0 (original work, dedicated to public domain)
- **Notes**:
  - `sfx_race_start`: white-noise burst (0–60 ms sharp attack, 60–600 ms exponential decay) + 75 Hz sine thud
  - `sfx_explosion`: brown-noise burst (0–280 ms sharp, 280–1600 ms decay) + 55 Hz bass sine + EQ bass-boost at 100 Hz
  - `jingle_win`: four-note C major arpeggio (C4 261.63 Hz → E4 329.63 Hz → G4 392.00 Hz → C5 523.25 Hz), each with 15 ms attack / 100 ms release envelope, concatenated, then `aecho` for warmth
  - `jingle_lose`: four-note A minor descent (E5 659.25 Hz → C5 523.25 Hz → A4 440.00 Hz → E4 329.63 Hz), same envelope, concatenated, then `aecho`
