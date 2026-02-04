# GitHub Pages Setup for LFS Images

## The Problem

If images show as "broken thumbnails" or don't load in the game, it means GitHub Pages is serving **Git LFS pointer files** instead of **actual image files**.

When you view an image URL in your browser (e.g., `https://vschetinger.github.io/lennings/levels/GlassBeadGame/images/A1012.2.png`), you'll see either:
- ❌ **Text content** starting with `version https://git-lfs.github.com/spec/v1` (LFS pointer - WRONG)
- ✅ **An actual PNG image** (correct)

## The Solution

**GitHub Pages must serve from the `gh-pages` branch, NOT from `main` or `master`.**

### Step-by-Step Fix

1. Go to your repository on GitHub: `https://github.com/<username>/<repo-name>`

2. Click **Settings** (top menu)

3. Click **Pages** (left sidebar)

4. Under **"Build and deployment"** section:
   - **Source:** Select **"Deploy from a branch"**
   - **Branch:** Select **"gh-pages"** (NOT main/master)
   - **Folder:** Select **"/ (root)"**

5. Click **Save**

6. Wait 1-2 minutes for GitHub to rebuild the site

7. **Test it:** Open an image URL in your browser:
   ```
   https://<username>.github.io/<repo-name>/levels/GlassBeadGame/images/A1012.2.png
   ```
   
   You should see a real PNG image, not text content.

## Why This Works

- The `main` branch stores images using **Git LFS** (Large File Storage) to keep the repository size manageable
- Git LFS stores actual images on GitHub's LFS servers and puts small "pointer files" in the Git repository
- When GitHub Pages serves from `main`, it serves these pointer files (text), not the actual images
- The workflow (`.github/workflows/pages.yml`) automatically:
  1. Pulls the real LFS images from storage
  2. Copies them to a `gh-pages` branch as regular files
  3. GitHub Pages then serves these regular files correctly

## Verification

After changing the Pages configuration:

1. **Check an image URL directly:**
   - Visit: `https://<username>.github.io/<repo-name>/levels/GlassBeadGame/images/A1012.2.png`
   - You should see an actual image, not text

2. **Check the game:**
   - Visit: `https://<username>.github.io/<repo-name>/play.html`
   - Click "Start Game"
   - Images should load as levels

3. **Check browser console** (F12 → Console tab):
   - Should NOT see 404 errors for image files
   - Should NOT see CORS errors

## Troubleshooting

### Images still show as text/broken
- **Cause:** Pages is still serving from main/master branch
- **Fix:** Double-check Pages settings, ensure gh-pages branch is selected
- **Wait:** After changing, wait 2-3 minutes for GitHub to update

### No gh-pages branch exists
- **Cause:** The workflow hasn't run yet
- **Fix:** Push any change to main branch to trigger the workflow
- **Check:** Go to Actions tab to see if workflow ran successfully

### Workflow fails
- **Check:** Go to Actions tab → Click latest "Deploy to GitHub Pages" workflow
- **Look for:** Error messages in the logs
- **Common issues:** 
  - LFS quota exceeded (free accounts have 1GB/month bandwidth)
  - Git LFS not properly configured

## Current Status

The workflow is already configured and has been running successfully:
- Latest deployment: Check the Actions tab for recent "Deploy to GitHub Pages" runs
- The `gh-pages` branch exists and contains all 1,282 images as regular files
- All you need to do is **change the Pages source from main to gh-pages**
