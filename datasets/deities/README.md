# Deities dataset

Single bundled deity layer (Roman, Slavic, American pantheons) with a shared **namespace** (`deity`) and per-record **pantheon**.

## Schema

See [schema.json](schema.json): each record has `namespace: "deity"` and `pantheon: "roman" | "slavic" | "american"`.

## Pipeline

1. **Fetch per pantheon** into `corpus/<pantheon>.json`:
   ```bash
   python scripts/fetch_deities_wikidata.py --query roman -o datasets/deities/corpus/roman.json
   python scripts/fetch_deities_wikidata.py --query slavic -o datasets/deities/corpus/slavic.json
   python scripts/fetch_deities_wikidata.py --query american -o datasets/deities/corpus/american.json
   ```

2. **Merge** into one corpus:
   ```bash
   python scripts/merge_deity_corpora.py
   ```
   Writes `datasets/deities/corpus.json`.

3. **Embed** (LM Studio with embedding model loaded):
   ```bash
   python build_embeddings_with_LMStudio.py \
     --input-corpus datasets/deities/corpus.json \
     --embeddings-json datasets/deities/embeddings.json \
     --direct-motifs datasets/deities/deities.json
   ```

Result: `datasets/deities/deities.json` is loaded by the app as the single "deities" layer; the graph shows one "Nearest deity" row and the detail panel shows pantheon when available.

Old per-pantheon and flat files were moved to `datasets/deities/archive/`; you can delete that folder once the new pipeline has been run and you no longer need them.
