# 8 Bit Pool // 8 Ball Pool, but for nerds

Turn-based 2D neon 8-bit **8-Ball Pool** built with **Nuxt 4** (`ssr: false`, static SPA) for programmers, math & physics education, and LLM AI opponents.

## Features
- **Cartesian Coordinate Table (`[0..254] × [0..127] cm`)**: Origin `(0, 0)` at bottom-left ball-center corner, with pockets positioned outside playable bounds (`-2.86 cm` / `256.86 cm` / `129.86 cm`).
- **Input-Only Controls**: Enter Turn 1 / Ball-in-Hand cue `(X, Y)`, rotation `θ` (degrees), punching force power (Newtons), and cue hit-point spin `(X, Y)` with a capped short trajectory preview.
- **Real-World Rigid-Body Physics (`240 Hz`)**: Cue contact impulse `J = 0.5 · F · Δt`, sliding-to-rolling friction torque (follow & draw), sidespin cushion English, squirt/miscue limits, and WPA 8-Ball rules.
- **Hidden Real-World Parameters & Extensible Modes**: Pre-configured for standard real-world physics (`tableFriction`, `ballWeightKg`, `stickTipRadiusMm`, `maxPowerN`, `trajectoryPreviewLengthCm`) with a mode registry (`window.POOL_GAME`) for future custom modes.
- **2P Human or LLM AI Opponent**: Connect **OpenAI / OpenAI-compatible** or **Google Gemini** endpoints (or use the built-in **Offline Geometry Bot**). Sends full table/ball/pocket/wall/group/history JSON each turn and accepts structured JSON shot replies.
- **Browser Storage History**: Persists every turn action array and before/after board snapshots in `localStorage` for revisiting or JSON export.

## Commands

```bash
npm install
npm run dev       # Local dev server
npm run test      # Run physics, rules & AI JSON tests
npm run generate  # Generate static site into .output/public
```
