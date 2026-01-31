# Simulation

Headless parameter sweep and batch runs for Lennings. No rendering; same ParticleLenia core.

- **`/simulation`** – UI: default image zenarnie.jpg; load image, set spawn/steps, run single or sweep, view results. Play button per run opens replay with frame-by-frame controls.
- **`runner.js`** – API: `loadParameters`, `createContext`, `createLenia`, `runOne`, `runSweep`, `serializeRunConfig`, `parseRunConfig`. Use from other pages or scripts for batches, metrics, or other libraries.
- **`replay-player.js`** – Reusable replay player: `new ReplayPlayer(container, { onFrameChange: (index, frame) => {} })`. Methods: `setFrames(frames)`, `play()`, `pause()`, `stop()`, `goToFrame(i)`. Renders first/last, prev/next, play/pause, speed, frame slider. Host supplies canvas and render logic; player owns playback state and UI.

Future-friendly: extend runner options, add run modes in `simulation.js`, or reuse `ReplayPlayer` elsewhere.

## GitHub Pages (external access)

To serve the app (including this simulation page) from GitHub Pages:

1. **Create** `.github/workflows/pages.yml` in the **repo root** (the folder that contains `index.html` and the `simulation/` folder) with:

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main, master]
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: .
```

2. **Settings → Pages**: set “Deploy from a branch”, branch `gh-pages`, folder `/ (root)`.

3. After the first push to `main`/`master`, the workflow will publish to `gh-pages`. The site will be at `https://<username>.github.io/<repo>/`; the simulation is at `.../simulation/`.
