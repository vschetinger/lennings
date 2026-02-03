#!/bin/bash
# Add level images in small batches and push each batch to avoid GitHub push size limits.
# Only adds files not yet tracked (safe to re-run; will continue from where you left off).
# Run from repo root: bash levels/GlassBeadGame/push-images-in-batches.sh
#
# If you still get HTTP 400 / disconnect, try: git config http.postBuffer 524288000
# Then re-run this script (it will skip already-pushed images).

set -e
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"
IMAGES_DIR="levels/GlassBeadGame/images"
BATCH_SIZE=5

if [ ! -d "$IMAGES_DIR" ]; then
  echo "No $IMAGES_DIR directory."
  exit 1
fi

# List only untracked image files (sorted), so we can resume after partial runs
list=$(mktemp)
git ls-files --others --exclude-standard "$IMAGES_DIR" | grep -E '\.(png|jpe?g)$' | sort > "$list"
total=$(wc -l < "$list" | tr -d ' ')

if [ "$total" -eq 0 ]; then
  echo "No untracked images in $IMAGES_DIR. Nothing to do."
  rm -f "$list"
  exit 0
fi

batches=$(( (total + BATCH_SIZE - 1) / BATCH_SIZE ))
echo "Found $total untracked images. Will add and push in $batches batches of up to $BATCH_SIZE."

batch_num=1
start=1
while [ $start -le "$total" ]; do
  end=$((start + BATCH_SIZE - 1))
  [ $end -gt "$total" ] && end=$total
  echo "--- Batch $batch_num/$batches (files $start–$end of $total untracked) ---"
  added=0
  sed -n "${start},${end}p" "$list" | while IFS= read -r f; do
    [ -f "$f" ] && git add "$f" && added=$((added + 1))
  done
  # Count what was actually staged (subshell can't update outer added)
  staged=$(git diff --cached --name-only | wc -l | tr -d ' ')
  if [ "$staged" -eq 0 ]; then
    echo "Nothing to commit (maybe already pushed?). Skipping batch $batch_num."
  else
    git commit -m "Level images: batch $batch_num of $batches"
    git push origin main
  fi
  start=$((end + 1))
  batch_num=$((batch_num + 1))
done

rm -f "$list"
echo "Done."
tracked=$(git ls-files "$IMAGES_DIR" | wc -l | tr -d ' ')
echo "Total images now tracked: $tracked"
