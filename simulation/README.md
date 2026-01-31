# Simulation

Headless parameter sweep and batch runs for Lennings. No rendering; same ParticleLenia core.

- **`/simulation`** – UI: default image zenarnie.jpg; load image, set spawn/steps, run single or sweep, view results. Play button per run opens replay with frame-by-frame controls.
- **`runner.js`** – API: `loadParameters`, `createContext`, `createLenia`, `runOne`, `runSweep`, `serializeRunConfig`, `parseRunConfig`. Use from other pages or scripts for batches, metrics, or other libraries.
- **`replay-player.js`** – Reusable replay player: `new ReplayPlayer(container, { onFrameChange: (index, frame) => {} })`. Methods: `setFrames(frames)`, `play()`, `pause()`, `stop()`, `goToFrame(i)`. Renders first/last, prev/next, play/pause, speed, frame slider. Host supplies canvas and render logic; player owns playback state and UI.

Future-friendly: extend runner options, add run modes in `simulation.js`, or reuse `ReplayPlayer` elsewhere.
