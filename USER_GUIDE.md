# Synapsis — TMR Study App · User Guide

A Targeted Memory Reactivation (TMR) study tool: learn facts during the day, replay their paired tones during sleep, and test what stuck in the morning. Runs on Windows (.exe) and any modern browser. **All data stays on your machine** — items, cues, and logs live in `localStorage`; nothing is uploaded, and the app never records audio.

> The "estimated alignment" panel is a **simulation** built from population sleep-cycle averages and your plan settings. It is not a measurement of your sleep — no sensors are involved.

## Quick Start

1. **Add items** — type a fact, press **add** (or Enter). Each item gets its own persistent cue tone (♪1…♪10); the tone stays with the item across restarts.
2. **Learn** — select an item, press **learn**: the cue plays 7× (pairings to criterion, Rudoy 2009). Do this for every item while you actually study the material.
3. **Night sound** — press **play** on pink noise while studying. It repeats every 5 minutes at a quiet level.
4. **Overnight TMR** — at bedtime press **start TMR**:
   - 60-min silent lead-in (you fall asleep),
   - cues then fire round-robin over your learned items, each as its real paired tone,
   - 10 min on / 8 min off blocks, capped at 40 min of *cueing* time (the lead-in doesn't count),
   - validation mode (settings) cues only ~50% of items — the uncued ones are your controls.
5. **Morning recall** — the Morning recall panel replays last night's cues one by one; mark *remember* / *gone*. Answers are saved locally per date.

## Hotkeys (Desktop)

- **Ctrl+Shift+S** — play the selected item's cue
- **Ctrl+Shift+A** — toggle auto-cue every 5 minutes (wake mode)

## How the cueing schedule works

```
bedtime ──60 min silence──► cues every 12s in 10/8 blocks ──40 min cap──► silence till morning
```

- The cap counts **cueing time only** — OFF-block minutes don't consume it.
- Gaps between cues stay ≥ 5 s to respect the spindle refractory period.
- Volume is capped low on purpose; loud cues cause arousals that *reverse* the benefit.

## Key principles (from the TMR literature)

- **Learn first**: TMR amplifies memories you already encoded — never cue unlearned material.
- **Low volume**: quiet beats loud; if it wakes you, it hurt you.
- **Sparse cues**: fewer, well-spaced cues beat a dense stream.
- **Same sound, same tone**: the cue must match what was played while awake — that's why each item owns its tone permanently.

## Settings (gear icon ⚙)

- **Voice mode**: tone only (default, recommended) or tone + spoken text
- **Validation mode**: randomly skips 50% of items so you can compare cued-vs-uncued recall in the morning
- **Clear data**: wipes all stored items and logs

## Data & privacy

- Items + settings: `localStorage` (`tmr-items`, `tmr-settings`).
- Last night's log + daily recall answers: `localStorage` (`tmr-last-night`, `tmr-recall-YYYY-MM-DD`).
- **Clear data** in settings wipes everything.
- No network calls, no telemetry, no microphone recording. The mic-gate option uses the mic only as an on-device level detector to pause cueing; no audio is stored or transmitted.

## Running from source

```powershell
npm install
npm start          # Electron desktop app
```

The `www/` folder is the whole app — opening `www/index.html` in a plain browser gives you the full experience except the overnight scheduler (which needs the Electron main process for reliable background timers).
