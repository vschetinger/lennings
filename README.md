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

**Step-by-step SSH Key Setup:**

1. **Generate an SSH key** (if you don't have one):
   ```bash
   ssh-keygen -t ed25519 -C "your_email@example.com"
   ```
   - Press Enter to accept the default file location (`~/.ssh/id_ed25519`)
   - Optionally, enter a passphrase for extra security (or press Enter for no passphrase)

2. **Display your public key**:
   ```bash
   # On macOS/Linux:
   cat ~/.ssh/id_ed25519.pub
   
   # On Windows (PowerShell):
   type $env:USERPROFILE\.ssh\id_ed25519.pub
   
   # On Windows (Git Bash):
   cat ~/.ssh/id_ed25519.pub
   ```
   This will show your public key (starts with `ssh-ed25519`). Copy the entire output.

3. **Add the SSH key to GitHub**:
   - Go to [GitHub.com](https://github.com) and sign in
   - Click your profile picture (top-right) → **Settings**
   - In the left sidebar, click **SSH and GPG keys**
   - Click the green **New SSH key** button
   - **Title**: Enter a descriptive name (e.g., "My MacBook" or "Work Laptop")
   - **Key**: Paste the entire public key you copied in step 2
   - Click **Add SSH key**
   - Confirm with your GitHub password if prompted

4. **Test your SSH connection**:
   ```bash
   ssh -T git@github.com
   ```
   You should see: `Hi <username>! You've successfully authenticated...`

**Alternative:** If you prefer copying the key directly to clipboard:
- **macOS**: `pbcopy < ~/.ssh/id_ed25519.pub`
- **Linux** (with xclip): `xclip -selection clipboard < ~/.ssh/id_ed25519.pub`
- **Windows** (PowerShell): `Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub | Set-Clipboard`

For more details, see [GitHub's SSH documentation](https://docs.github.com/en/authentication/connecting-to-github-with-ssh).

### Troubleshooting Push Issues

**HTTP 400 error when pushing:**
- This often occurs with large files or Git LFS content over HTTPS
- **Solution:** Switch to SSH (see [Setup SSH](#setup-ssh) above)
- Make sure you have Git LFS installed: `git lfs install`

**"Everything up-to-date" but push failed:**
- The push may have partially succeeded
- Check your branch status: `git status`
- Try pushing with verbose output: `git push -v origin <branch-name>`
