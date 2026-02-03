# Lennings

Lenia + Lemmings: a game where creatures eat pixels from the environment and you reconstruct motif images by “digesting” at the right time.

## Play

- **Local:** open `play.html` in a browser (or serve the folder with any static server).
- **GitHub Pages:** if this repo has Pages enabled (Settings → Pages → source: main branch), play at:
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

1. Push this repo to GitHub (e.g. `origin` on `main` or `master`).
2. In the repo: **Settings → Pages**.
3. Under “Build and deployment”, choose **Source: GitHub Actions** (or “Deploy from a branch” and pick `gh-pages` if you use the branch workflow).
4. The existing workflow (`.github/workflows/pages.yml`) publishes the repo root on push to `main`/`master`. After it runs, the site is at `https://<username>.github.io/<repo-name>/`.
5. Open **play.html** from that URL (e.g. `https://<username>.github.io/<repo-name>/play.html`).
