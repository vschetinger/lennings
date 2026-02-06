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

1. Push this repo to GitHub (e.g. `origin` on `main` or `master`). **Recommended:** Use SSH for pushing (see [Setup SSH](#setup-ssh) below).
2. In the repo: **Settings → Pages**.
3. Under “Build and deployment”, choose **Source: GitHub Actions** (or “Deploy from a branch” and pick `gh-pages` if you use the branch workflow).
4. The existing workflow (`.github/workflows/pages.yml`) publishes the repo root on push to `main`/`master`. After it runs, the site is at `https://<username>.github.io/<repo-name>/`.
5. Open **play.html** from that URL (e.g. `https://<username>.github.io/<repo-name>/play.html`).

### Setup SSH

If you encounter push errors (like HTTP 400), switch your remote to SSH:

```bash
# Switch from HTTPS to SSH
git remote set-url origin git@github.com:<username>/<repo-name>.git

# Verify the change
git remote -v
```

**Prerequisites:**
- [Generate an SSH key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/generating-a-new-ssh-key-and-adding-it-to-the-ssh-agent) if you don't have one
- [Add your SSH key to GitHub](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/adding-a-new-ssh-key-to-your-github-account)

### Troubleshooting Push Issues

**HTTP 400 error when pushing:**
- This often occurs with large files or Git LFS content over HTTPS
- **Solution:** Switch to SSH (see [Setup SSH](#setup-ssh) above)
- Make sure you have Git LFS installed: `git lfs install`

**"Everything up-to-date" but push failed:**
- The push may have partially succeeded
- Check your branch status: `git status`
- Try pushing with verbose output: `git push -v origin <branch-name>`
