#!/usr/bin/env node
/**
 * Generate dataset.json motifs from all files in images/
 * Usage: node generate-manifest.js
 * Run from repo root: node levels/GlassBeadGame/generate-manifest.js
 * Or from this folder: node generate-manifest.js (will look for ./images)
 *
 * Reads existing dataset.json, keeps name/ssimThreshold, replaces motifs
 * with one entry per file in images/ (id and name from filename without extension).
 */

const fs = require('fs');
const path = require('path');

const IMAGES_DIR = path.join(__dirname, 'images');
const DATASET_PATH = path.join(__dirname, 'dataset.json');

const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);

function main() {
  if (!fs.existsSync(IMAGES_DIR)) {
    console.error('images/ folder not found at', IMAGES_DIR);
    process.exit(1);
  }

  const files = fs.readdirSync(IMAGES_DIR);
  const motifs = files
    .filter((f) => imageExtensions.has(path.extname(f).toLowerCase()))
    .map((f) => {
      const id = path.basename(f, path.extname(f));
      const name = id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      return { id, name, image: f };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  let dataset = { name: 'Glass Bead Game', description: 'Motif beads from the Thompson Motif Index of Folk Literature', ssimThreshold: 0.7, motifs: [] };
  if (fs.existsSync(DATASET_PATH)) {
    dataset = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf8'));
  }
  dataset.motifs = motifs;
  fs.writeFileSync(DATASET_PATH, JSON.stringify(dataset, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${motifs.length} motifs to dataset.json`);
}

main();
