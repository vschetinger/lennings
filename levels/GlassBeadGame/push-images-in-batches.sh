#!/bin/bash
# Add level images in small batches and push each batch to avoid GitHub push size limits.
# Run from repo root: bash levels/GlassBeadGame/push-images-in-batches.sh

set -e
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"
IMAGES_DIR="levels/GlassBeadGame/images"
BATCH_SIZE=50

if [ ! -d "$IMAGES_DIR" ]; then
  echo "No $IMAGES_DIR directory."
  exit 1
fi

# List all image files, sorted
list=$(mktemp)
find "$IMAGES_DIR" -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' \) | sort > "$list"
total=$(wc -l < "$list")
batches=$(( (total + BATCH_SIZE - 1) / BATCH_SIZE ))
echo "Found $total images. Pushing in $batches batches of up to $BATCH_SIZE."

batch_num=1
start=1
while [ $start -le "$total" ]; do
  end=$((start + BATCH_SIZE - 1))
  [ $end -gt "$total" ] && end=$total
  echo "--- Batch $batch_num/$batches (files $start–$end) ---"
  sed -n "${start},${end}p" "$list" | while IFS= read -r f; do
    git add "$f"
  done
  git commit -m "Level images: batch $batch_num of $batches"
  git push origin main
  start=$((end + 1))
  batch_num=$((batch_num + 1))
done

rm -f "$list"
echo "Done. All $total images pushed."
