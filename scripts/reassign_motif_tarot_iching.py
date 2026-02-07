#!/usr/bin/env python3
"""
Re-assign motif -> nearest Tarot and nearest I-Ching by cosine similarity in 768-d.
Reads gbg-motifs.lmstudio.json, tarot_embeddings_lmstudio.json, iching_embeddings_lmstudio.json;
writes updated tarot_index, tarot_similarity, iching_hexagram_*, iching_similarity into motifs and saves.

Usage:
  python scripts/reassign_motif_tarot_iching.py
  python scripts/reassign_motif_tarot_iching.py --motifs path/to/motifs.json --output path/to/out.json
"""

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MOTIFS = REPO_ROOT / "levels/GlassBeadGame/gbg-motifs.lmstudio.json"
DEFAULT_TAROT = REPO_ROOT / "datasets/tarot_embeddings_lmstudio.json"
DEFAULT_ICHING = REPO_ROOT / "datasets/iching_embeddings_lmstudio.json"


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if len(a) != len(b):
        raise ValueError(f"Dimension mismatch: {len(a)} vs {len(b)}")
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def main() -> None:
    parser = argparse.ArgumentParser(description="Re-assign motif->tarot and motif->iching by embedding similarity.")
    parser.add_argument("--motifs", type=Path, default=DEFAULT_MOTIFS, help="Path to gbg-motifs.lmstudio.json")
    parser.add_argument("--tarot", type=Path, default=DEFAULT_TAROT, help="Path to tarot_embeddings_lmstudio.json")
    parser.add_argument("--iching", type=Path, default=DEFAULT_ICHING, help="Path to iching_embeddings_lmstudio.json")
    parser.add_argument("--output", type=Path, default=None, help="Output path (default: overwrite --motifs)")
    args = parser.parse_args()
    out_path = args.output or args.motifs

    for p, name in [(args.motifs, "motifs"), (args.tarot, "tarot"), (args.iching, "iching")]:
        if not p.is_file():
            print(f"ERROR: {name} file not found: {p}", file=sys.stderr)
            sys.exit(1)

    with args.motifs.open("r", encoding="utf-8") as f:
        motifs = json.load(f)
    with args.tarot.open("r", encoding="utf-8") as f:
        tarot_data = json.load(f)
    with args.iching.open("r", encoding="utf-8") as f:
        iching_data = json.load(f)

    tarot_items = tarot_data.get("items") or []
    iching_items = iching_data.get("items") or []
    if not tarot_items or not iching_items:
        print("ERROR: tarot or iching items list is empty", file=sys.stderr)
        sys.exit(1)

    print(f"Motifs: {len(motifs)}, Tarot: {len(tarot_items)}, I-Ching: {len(iching_items)}")

    updated = 0
    for idx, motif in enumerate(motifs):
        emb = motif.get("embedding")
        if not emb or not isinstance(emb, list):
            continue
        # Nearest tarot
        best_tarot_i = -1
        best_tarot_sim = -2.0
        for i, item in enumerate(tarot_items):
            sim = cosine_similarity(emb, item["embedding"])
            if sim > best_tarot_sim:
                best_tarot_sim = sim
                best_tarot_i = i
        # Nearest iching
        best_iching_i = -1
        best_iching_sim = -2.0
        for i, item in enumerate(iching_items):
            sim = cosine_similarity(emb, item["embedding"])
            if sim > best_iching_sim:
                best_iching_sim = sim
                best_iching_i = i

        if best_tarot_i >= 0 and best_iching_i >= 0:
            t = tarot_items[best_tarot_i]
            h = iching_items[best_iching_i]
            motif["tarot_index"] = t.get("index", best_tarot_i)
            motif["tarot_similarity"] = round(best_tarot_sim, 6)
            motif["iching_hexagram_number"] = h.get("hex", best_iching_i + 1)
            motif["iching_hexagram_chinese"] = h.get("pinyin", "")
            motif["iching_hexagram_english"] = h.get("english", "")
            motif["iching_similarity"] = round(best_iching_sim, 6)
            updated += 1
        if (idx + 1) % 200 == 0:
            print(f"  Processed {idx + 1}/{len(motifs)} motifs")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(motifs, f, ensure_ascii=False, indent=2)
    print(f"Updated {updated} motifs with tarot/iching. Wrote {out_path}")


if __name__ == "__main__":
    main()
