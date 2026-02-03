# Glass Bead Game level pack

Motif beads from the Thompson Motif Index of Folk Literature. Levels are driven by a single manifest; no per-image JSON.

**MVP:** Three motifs are included (zenarnie, mandalaw, height_shade-3). Open `play.html` and click "Start Game" to play; levels are chosen at random. To add the full motif dataset, drop all images into `images/` and run `node levels/GlassBeadGame/generate-manifest.js` from the repo root.

## Layout

- **dataset.json** – Manifest: `name`, `description`, `ssimThreshold`, and `motifs[]`.
- **images/** – All level images. Filenames must match `motif.image` in the manifest.

## dataset.json format

```json
{
  "name": "Glass Bead Game",
  "description": "Motif beads from the Thompson Motif Index of Folk Literature",
  "ssimThreshold": 0.5,
  "motifs": [
    { "id": "zenarnie", "name": "Arnie", "image": "zenarnie.jpg" },
    { "id": "mandalaw", "name": "Mandala", "image": "mandalaw.jpeg" }
  ]
}
```

- **motifs[]** – One entry per level.  
  - **id** – Unique level id (defaults from filename if omitted).  
  - **name** – Display name in the game.  
  - **image** – Filename under `images/` (e.g. `zenarnie.jpg`).  

Optional later: **embedding**, per-motif **ssimThreshold**, **spawnCenter**, **spawnCount**, etc.

## Adding many motifs

1. Put all images in `levels/GlassBeadGame/images/`.
2. Build or extend `motifs` in `dataset.json`: one `{ "id", "name", "image" }` per file (id can be derived from the image filename). Embeddings and extra fields can be added to each motif when needed.

## Pushing images to GitHub (large dataset)

If the image folder is too large to push in one commit (~100MB+), use the batch script from the repo root:

```bash
bash levels/GlassBeadGame/push-images-in-batches.sh
```

It adds images in batches of 50, commits and pushes each batch so you stay under GitHub’s push size limits. Adjust `BATCH_SIZE` in the script if needed.
