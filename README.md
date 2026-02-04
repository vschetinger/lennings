# Lennings

Lenia + Lemmings: a game where creatures eat pixels from the environment and you reconstruct motif images by “digesting” at the right time.

## Play

- **Local:** open `play.html` in a browser (or serve the folder with any static server).
- **GitHub Pages:** if this repo has Pages enabled (Settings → Pages → source: **gh-pages branch**), play at:
  - **https://&lt;username&gt;.github.io/&lt;repo-name&gt;/play.html**

## How to play (basics)

- **Goal:** Reach the SSIM target (e.g. 0.7) with one of your 3 digests per level.
- **D** — Digest: use current eaten pixels to form one reconstruction. Each digest uses those pixels once (they’re locked for the rest of the level).
- **R** — Respawn: new random spawn and colors (15s cooldown). Resets digests for this level.
- **W** — Burst: short speed and attraction boost (25s cooldown).
- **?** (bottom-left) — Open the in-game help.

## Tech

- Particle Lenia simulation (WebGL), level pack from `levels/GlassBeadGame` (dataset + images).
- Reconstruction via mosaic assignment (worker); SSIM for win condition.

## Deploy to GitHub Pages

**⚠️ IMPORTANT:** If images show as "broken thumbnails" or don't load, see [GITHUB_PAGES_SETUP.md](GITHUB_PAGES_SETUP.md) for the fix.

### Quick Setup

1. Push this repo to GitHub (e.g. `origin` on `main` or `master`).
2. The workflow (`.github/workflows/pages.yml`) will automatically run and deploy to the `gh-pages` branch.
3. In your repo: **Settings → Pages**.
4. Under "Build and deployment":
   - **Source:** Select **"Deploy from a branch"**
   - **Branch:** Select **"gh-pages"** (NOT main or master) 
   - **Folder:** Select **"/ (root)"**
5. Save and wait 1-2 minutes.
6. Visit `https://<username>.github.io/<repo-name>/play.html`

**Why gh-pages?** The main branch uses Git LFS for images (pointer files), but GitHub Pages needs actual image files. The workflow automatically pulls LFS images and deploys them as regular files to gh-pages.
