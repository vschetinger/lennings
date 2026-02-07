# Embedding pipelines and compatibility

This document describes how motif and tale embeddings are produced in **particle-lenia-web** and **gbg-miro-app**, and why semantic similarity between texts and motifs can look weak or inconsistent.

## Summary

| Source | File | Dimension | Origin |
|--------|------|-----------|--------|
| particle-lenia-web **motifs** (current) | `levels/GlassBeadGame/gbg-motifs.lmstudio.json` | **768** | LM Studio via `scripts/regenerate_motif_embeddings_lmstudio.py`; same model as tales; tarot/I-Ching assignment via `reassign_motif_tarot_iching.py` |
| particle-lenia-web **motifs** (legacy) | `levels/GlassBeadGame/gbg-motifs.json` | **128** | Legacy; fallback if lmstudio file missing |
| particle-lenia-web **tarot** | `datasets/tarot_embeddings_lmstudio.json` | **768** | LM Studio via `scripts/embed_tarot_iching_lmstudio.py`; source: `datasets/tarot/tarot-images.json` (Kaggle tarot-json) |
| particle-lenia-web **I-Ching** | `datasets/iching_embeddings_lmstudio.json` | **768** | LM Studio via `scripts/embed_tarot_iching_lmstudio.py`; source: `datasets/iching-wilhelm-dataset` (Wilhelm/Baynes) |
| particle-lenia-web **tales** | `datasets/aft_motifs.json` | **768** | LM Studio via `build_embeddings_with_LMStudio.py` (model-dependent) |
| gbg-miro-app **motifs** | `src/data/motifs.json` (after `load_embeddings.py`) | **128** | `portable_dataset/data/pocket_embeddings.bin` (1265 × 128 float32) |

**Current setup:** The game engine loads `gbg-motifs.lmstudio.json` first (768-d, same space as tales). If that file is missing, it falls back to `gbg-motifs.json` (128-d). With the LM Studio file, tale–motif cosine similarity is in one embedding space and is semantically meaningful.

---

## particle-lenia-web

### Tale embeddings (aft_motifs.json)

- **Script:** `build_embeddings_with_LMStudio.py`
- **Input:** Corpus JSON with `id` and a text field (e.g. tale `name` + `description`).
- **API:** `POST` to LM Studio `/v1/embeddings` (OpenAI-compatible).
- **Default model:** `text-embedding-3-large` (configurable; actual dimension depends on the model loaded in LM Studio).
- **Observed dimension:** 768 for current `datasets/aft_motifs.json` (likely a smaller model or different config).
- **Output:** JSON array of objects with `id`, `embedding` (float array). Merged into motif-style JSON (e.g. `datasets/aft_motifs.json`) for use in the app.

No compression step in this repo; embeddings are stored as full float arrays in JSON.

### Motif embeddings (gbg-motifs.lmstudio.json, current)

- **File:** `levels/GlassBeadGame/gbg-motifs.lmstudio.json` (game engine loads this first; fallback: `gbg-motifs.json`).
- **Content:** Same structure as gbg-motifs (id, name, description, embedding, tarot_index, iching_*, etc.) plus **provenance fields**: `embedding_model` (e.g. `"text-embedding-3-large"`) and `embedding_dim` (e.g. 768).
- **Dimension:** 768 (same as tales when using the same LM Studio model).
- **Origin:** Regenerated with `scripts/regenerate_motif_embeddings_lmstudio.py`, which calls LM Studio `/v1/embeddings` on motif name + description and writes a new file (never overwrites `gbg-motifs.json`).

### Motif embeddings (gbg-motifs.json, legacy)

- **File:** `levels/GlassBeadGame/gbg-motifs.json` — used as fallback if `gbg-motifs.lmstudio.json` is not found.
- **Dimension:** 128 (legacy pipeline; tale–motif similarity is not meaningful when using this file).

### Tarot and I-Ching (full-text embeddings and motif assignment)

- **Tarot text source:** [Kaggle: tarot-json (lsind18)](https://www.kaggle.com/datasets/lsind18/tarot-json/). Data in repo: `datasets/tarot/tarot-images.json` (78 cards: name, keywords, fortune_telling, meanings.light/shadow, Archetype, Elemental, etc.).
- **I-Ching text source:** [adamblvck/iching-wilhelm-dataset](https://github.com/adamblvck/iching-wilhelm-dataset) (Wilhelm/Baynes translation). Data in repo: `datasets/iching-wilhelm-dataset/data/iching_wilhelm_translation.csv` (64 hexagrams: judgment, image, symbolic, lines).
- **Embedding:** `scripts/embed_tarot_iching_lmstudio.py` builds one text per tarot card and per hexagram, calls LM Studio `/v1/embeddings` with the **same model** as motifs (e.g. `text-embedding-3-large`), and writes:
  - `datasets/tarot_embeddings_lmstudio.json` (78 items, 768-d)
  - `datasets/iching_embeddings_lmstudio.json` (64 items, 768-d)
- **Re-assignment:** `scripts/reassign_motif_tarot_iching.py` loads motifs, tarot embeddings, and I-Ching embeddings; for each motif computes **nearest tarot** and **nearest I-Ching** by **cosine similarity in 768-d**; writes `tarot_index`, `tarot_similarity`, `iching_hexagram_number`, `iching_hexagram_chinese` (pinyin), `iching_hexagram_english`, `iching_similarity` into `levels/GlassBeadGame/gbg-motifs.lmstudio.json`. So motif–tarot and motif–I-Ching links are in the same embedding space as motif–motif and tale–motif.

### Tarot and I-Ching as app resources (display / “specialness”)

For the app to **show** tarot and I-Ching content (and later add “specialness”), use the **resource JSONs** — no embedding or reassignment needed.

- **Script:** `python scripts/prepare_tarot_iching_resources.py` (run once, or after updating the source data).
- **Output:**
  - `datasets/tarot_cards.json` — array of 78 cards: `{ index, name, number, arcana, suit, img, keywords, fortune_telling, meanings, Archetype, Elemental, ... }`. Look up by `index` (matches motif `tarot_index` 0–77).
  - `datasets/iching_hexagrams.json` — array of 64 hexagrams: `{ hex, english, pinyin, chinese, symbolic, judgment: { text, comments }, image: { text, comments }, lines: [{ line, text, comments }, ...] }`. Look up by `hex` (matches motif `iching_hexagram_number` 1–64).

Use these two files as the canonical “tarot resource” and “iching resource” in the app (e.g. fetch once at load, then index by `tarot_index` / `iching_hexagram_number` when displaying motif metadata).

---

## gbg-miro-app

### Motif embeddings

- **Binary:** `portable_dataset/data/pocket_embeddings.bin`
  - 1265 embeddings, 128 dimensions each, float32.
  - Layout: consecutive 128 × 4-byte floats per embedding (no header).
- **Script:** `load_embeddings.py`
  - Reads the binary and assigns embeddings to motifs **by index** (first embedding → first motif in `src/data/motifs.json`, etc.).
  - Writes updated `src/data/motifs.json` with an `embedding` array on each motif.
- **Usage:** `src/utils/embeddings.ts` / `embeddingIndex.ts` use these 128-d vectors for similarity/search.

The **origin of `pocket_embeddings.bin`** (which model, which tool produced the 128-d vectors) is not documented in the snippets we saw; it is likely a compressed or distilled embedding model (e.g. “pocket” = small 128-d) used for size/speed in the app.

### Tales / AFT-like data in gbg-miro-app

- **Script:** `scripts/build_aft_like_motifs.py` builds **tale-like** motif JSON (e.g. from AFT data) using an LM Studio embeddings API and produces motif-style objects with `embedding` arrays.
- **Dimension:** Depends on the model (e.g. `text-embedding-ada-002` or whatever is configured); for **maximum compatibility** the script comments say to use the **same embedding model** for both motifs and the new corpus. In gbg-miro-app, if tales are embedded with LM Studio and motifs come from `pocket_embeddings.bin`, dimensions and spaces can differ unless a single model is used for both.

---

## Recommendations

1. **Unify model and dimension for tale–motif similarity**
   - **Option A:** Re-embed **motifs** with the same LM Studio model (and same text convention) used for tales, then replace `embedding` in `gbg-motifs.json` and use the new dimension everywhere (e.g. 768 or 1536). Then tale–motif cosine similarity is in one space.
   - **Option B:** Re-embed **tales** with whatever pipeline produced the 128-d motif vectors (if you have that pipeline and can run it on tale text). Then both are 128-d in the same space.
   - **Option C:** Use a single embedding model in both apps (same API, same model name, same dimension) for any cross-set comparison.

2. **Statistics script**
   - `scripts/tale_motif_similarity_stats.py` loads motifs and tales, reports dimensions, and computes cosine similarity statistics (per-tale max, per-motif max, histogram, top pairs). If dimensions differ, it truncates to the minimum and warns that the result is misleading. Run it to confirm dimensions and to inspect similarity distributions after you align embeddings.

3. **Browser / game-engine**
   - Ensure the embedding dimension used at runtime (e.g. in `embedding-space.js` or wherever similarity is computed) matches the dimension of both motif and tale embeddings and that both are from the same model. Avoid mixing 128-d motif and 768-d tale vectors without a proper projection or re-embedding.

---

## Provenance (embedding_model, embedding_dim)

Motif and tale objects can include:

- **embedding_model** (string): Identifier of the model that produced the vector (e.g. `text-embedding-nomic-embed-text-v1.5@q4_k_m` or `text-embedding-3-large`). Enough to re-run the same model on the same text to reproduce the embedding.
- **embedding_dim** (number): Dimension of the embedding vector (e.g. 768). Useful for validation and for choosing compatible datasets.

`gbg-motifs.lmstudio.json` is generated with these fields set. Adding them to tale datasets (e.g. aft_motifs.json) is optional but recommended for consistency.

## Quick reference

- **Tale–motif stats:**  
  `python scripts/tale_motif_similarity_stats.py`  
  Optional: `--top-csv out.csv` to export top pairs. Use `--motifs levels/GlassBeadGame/gbg-motifs.lmstudio.json` for 768-d motifs.
- **Motif embedding regeneration (particle-lenia-web):**  
  `python scripts/regenerate_motif_embeddings_lmstudio.py` → writes `levels/GlassBeadGame/gbg-motifs.lmstudio.json` (never overwrites gbg-motifs.json).
- **Tarot + I-Ching embeddings (particle-lenia-web):**  
  `python scripts/embed_tarot_iching_lmstudio.py` → `datasets/tarot_embeddings_lmstudio.json`, `datasets/iching_embeddings_lmstudio.json` (768-d, same model as motifs). Then `python scripts/reassign_motif_tarot_iching.py` → updates motif→tarot and motif→I-Ching in `gbg-motifs.lmstudio.json` by cosine similarity.
- **Tale embedding generation (particle-lenia-web):**  
  `build_embeddings_with_LMStudio.py` → LM Studio `/v1/embeddings` → e.g. `datasets/aft_motifs.json`.
- **Motif embedding source (gbg-miro-app):**  
  `portable_dataset/data/pocket_embeddings.bin` (128-d) → `load_embeddings.py` → `src/data/motifs.json`.
