#!/usr/bin/env python3
"""
Tale–motif similarity statistics

Loads motif embeddings (gbg-motifs.json) and tale embeddings (datasets/aft_motifs.json),
computes cosine similarity statistics to help debug semantic connection between
texts and motifs. Uses vectorized numpy; for very large corpora consider
sklearn.neighbors.BallTree with metric='cosine' to avoid O(n*m) full pairwise.

Usage:
  python scripts/tale_motif_similarity_stats.py
  python scripts/tale_motif_similarity_stats.py --top-csv out.csv
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Single pair cosine similarity."""
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    n = min(len(a), len(b))
    if n == 0:
        return float("nan")
    a, b = a[:n], b[:n]
    dot = np.dot(a, b)
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na == 0 or nb == 0:
        return float("nan")
    return float(dot / (na * nb))


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def main() -> None:
    parser = argparse.ArgumentParser(description="Tale–motif embedding similarity statistics")
    parser.add_argument(
        "--motifs",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "levels/GlassBeadGame/gbg-motifs.lmstudio.json",
        help="Path to motif JSON (default: gbg-motifs.lmstudio.json)",
    )
    parser.add_argument(
        "--tales",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "datasets/aft_motifs.json",
        help="Path to aft_motifs.json (tales)",
    )
    parser.add_argument(
        "--top-csv",
        type=Path,
        default=None,
        help="If set, write top-K tale–motif pairs to this CSV",
    )
    parser.add_argument(
        "--top-k",
        type=int,
        default=50,
        help="Number of top pairs to export (default 50)",
    )
    args = parser.parse_args()

    # Load motifs (with images = have level/resource)
    motifs_data = load_json(args.motifs)
    if not isinstance(motifs_data, list):
        print("ERROR: motifs JSON must be an array", file=sys.stderr)
        sys.exit(1)
    motifs = [m for m in motifs_data if m.get("embedding")]
    motif_ids = [m["id"] for m in motifs]
    motif_embeddings = np.array([m["embedding"] for m in motifs], dtype=float)
    dim_m = motif_embeddings.shape[1]

    # Load tales
    tales_data = load_json(args.tales)
    if not isinstance(tales_data, list):
        print("ERROR: tales JSON must be an array", file=sys.stderr)
        sys.exit(1)
    tales = [t for t in tales_data if t.get("embedding")]
    tale_ids = [t["id"] for t in tales]
    tale_names = [t.get("name") or t.get("id", "") for t in tales]
    tale_embeddings = np.array([t["embedding"] for t in tales], dtype=float)
    dim_t = tale_embeddings.shape[1]

    print("=== Embedding dimensions ===")
    print(f"Motifs: {len(motifs)} items, dim = {dim_m}")
    print(f"Tales:  {len(tales)} items, dim = {dim_t}")
    if dim_m != dim_t:
        print()
        print("WARNING: Dimension mismatch. Motifs and tales were likely embedded with different models.")
        print("Comparisons will use the first min(dim_m, dim_t) dimensions only and may be misleading.")
        use_dim = min(dim_m, dim_t)
        motif_embeddings = motif_embeddings[:, :use_dim]
        tale_embeddings = tale_embeddings[:, :use_dim]
        print(f"Using first {use_dim} dimensions for this run.")
    else:
        use_dim = dim_m
    print()

    # Normalize for cosine similarity (so dot product = cosine)
    def norm_rows(X: np.ndarray) -> np.ndarray:
        norms = np.linalg.norm(X, axis=1, keepdims=True)
        norms[norms == 0] = 1
        return X / norms

    M = norm_rows(motif_embeddings)
    T = norm_rows(tale_embeddings)

    # Full pairwise: T @ M.T -> (n_tales, n_motifs)
    sim_matrix = np.dot(T, M.T)
    assert sim_matrix.shape == (len(tales), len(motifs))

    # Per-tale: max similarity to any motif
    tale_max_sim = np.max(sim_matrix, axis=1)
    tale_argmax = np.argmax(sim_matrix, axis=1)
    # Per-motif: max similarity to any tale
    motif_max_sim = np.max(sim_matrix, axis=0)
    motif_argmax = np.argmax(sim_matrix, axis=0)

    print("=== Per-tale (max similarity to any motif) ===")
    print(f"  min   = {float(np.min(tale_max_sim)):.4f}")
    print(f"  max   = {float(np.max(tale_max_sim)):.4f}")
    print(f"  mean  = {float(np.mean(tale_max_sim)):.4f}")
    print(f"  median= {float(np.median(tale_max_sim)):.4f}")
    print(f"  std   = {float(np.std(tale_max_sim)):.4f}")
    print()

    print("=== Per-motif (max similarity to any tale) ===")
    print(f"  min   = {float(np.min(motif_max_sim)):.4f}")
    print(f"  max   = {float(np.max(motif_max_sim)):.4f}")
    print(f"  mean  = {float(np.mean(motif_max_sim)):.4f}")
    print(f"  median= {float(np.median(motif_max_sim)):.4f}")
    print(f"  std   = {float(np.std(motif_max_sim)):.4f}")
    print()

    # Histogram of per-tale max similarities
    print("=== Histogram (per-tale max similarity) ===")
    bins = np.linspace(-1, 1, 21)
    hist, _ = np.histogram(tale_max_sim, bins=bins)
    for i in range(len(bins) - 1):
        label = f"[{bins[i]:.2f}, {bins[i+1]:.2f})"
        print(f"  {label:15} {int(hist[i]):5} tales")
    print()

    # Top pairs (by similarity)
    flat_idx = np.argsort(sim_matrix.ravel())[::-1]
    top_k = min(args.top_k, len(flat_idx))
    rows = []
    for idx in flat_idx[:top_k]:
        t_idx = idx // len(motifs)
        m_idx = idx % len(motifs)
        s = float(sim_matrix[t_idx, m_idx])
        rows.append((tale_ids[t_idx], tale_names[t_idx][:60], motif_ids[m_idx], motifs[m_idx].get("name", "")[:60], s))

    print(f"=== Top {top_k} tale–motif pairs (by cosine similarity) ===")
    for tale_id, tale_name, motif_id, motif_name, sim in rows[:20]:
        print(f"  {sim:.4f}  tale={tale_id!r}  motif={motif_id!r}  ({tale_name[:40]}... / {motif_name[:40]}...)")
    if top_k > 20:
        print(f"  ... and {top_k - 20} more")
    print()

    if args.top_csv:
        args.top_csv.parent.mkdir(parents=True, exist_ok=True)
        with args.top_csv.open("w", encoding="utf-8") as f:
            f.write("tale_id,tale_name,motif_id,motif_name,cosine_similarity\n")
            for tale_id, tale_name, motif_id, motif_name, sim in rows:
                # Escape CSV
                tale_name_esc = tale_name.replace('"', '""')
                motif_name_esc = motif_name.replace('"', '""')
                f.write(f'"{tale_id}","{tale_name_esc}","{motif_id}","{motif_name_esc}",{sim:.6f}\n')
        print(f"Wrote top {top_k} pairs to {args.top_csv}")

    # Compatibility note
    if dim_m != dim_t:
        print()
        print("=== Embedding compatibility note ===")
        print("Motif and tale embeddings have different dimensions. For meaningful similarity,")
        print("both should be produced by the same embedding model (same API and dimensions).")
        print("See EMBEDDINGS.md in this repo (or the script docstring) for pipeline details.")


if __name__ == "__main__":
    main()
