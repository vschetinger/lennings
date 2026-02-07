#!/usr/bin/env python3
"""
Regenerate motif embeddings via LM Studio and write to a NEW file (never overwrites
gbg-motifs.json). Adds embedding_model and embedding_dim to each motif for provenance.

Usage:
  python scripts/regenerate_motif_embeddings_lmstudio.py
  python scripts/regenerate_motif_embeddings_lmstudio.py --dry-run
  python scripts/regenerate_motif_embeddings_lmstudio.py --limit 5

Output: levels/GlassBeadGame/gbg-motifs.lmstudio.json (in-place update of embedding
        + new fields; all other keys e.g. tarot, iching preserved).
"""

import argparse
import json
import sys
import time
from pathlib import Path

import requests

# Same defaults as build_embeddings_with_LMStudio.py
LM_STUDIO_EMBEDDINGS_URL = "http://localhost:1234/v1/embeddings"
DEFAULT_EMBEDDING_MODEL = "text-embedding-3-large"
DEFAULT_REQUEST_TIMEOUT = 60.0
DEFAULT_DELAY_BETWEEN_REQUESTS = 0.1

# Paths relative to repo root (script is in particle-lenia-web/scripts/)
REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MOTIFS_PATH = REPO_ROOT / "levels/GlassBeadGame/gbg-motifs.json"
DEFAULT_OUTPUT_PATH = REPO_ROOT / "levels/GlassBeadGame/gbg-motifs.lmstudio.json"


def call_lmstudio_embedding(
    text: str,
    model: str,
    api_url: str,
    timeout: float = DEFAULT_REQUEST_TIMEOUT,
) -> list[float]:
    """Call LM Studio /v1/embeddings; return list of floats."""
    if not text or not text.strip():
        raise ValueError("Refusing to embed empty text")
    payload = {"model": model, "input": text.strip()}
    resp = requests.post(api_url, json=payload, timeout=timeout)
    resp.raise_for_status()
    data = resp.json()
    if not isinstance(data, dict) or "data" not in data:
        raise ValueError(f"Unexpected embeddings response format: {data!r}")
    entries = data["data"]
    if not isinstance(entries, list) or len(entries) == 0:
        raise ValueError(f"No embedding entries returned: {data!r}")
    emb = entries[0].get("embedding")
    if not isinstance(emb, list):
        raise ValueError(f"Embedding is not a list: {type(emb)}")
    return [float(x) for x in emb]


def text_for_motif(motif: dict) -> str:
    """Build text to embed from motif name + description."""
    name = (motif.get("name") or "").strip()
    desc = (motif.get("description") or "").strip()
    if not name and not desc:
        return ""
    if not desc:
        return name
    return f"{name}. {desc}"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Regenerate motif embeddings via LM Studio; write to a new file."
    )
    parser.add_argument(
        "--motifs",
        type=Path,
        default=DEFAULT_MOTIFS_PATH,
        help="Path to gbg-motifs.json",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT_PATH,
        help="Output path (default: gbg-motifs.lmstudio.json in same folder as motifs)",
    )
    parser.add_argument(
        "--model",
        type=str,
        default=DEFAULT_EMBEDDING_MODEL,
        help="LM Studio embedding model name",
    )
    parser.add_argument(
        "--api-url",
        type=str,
        default=LM_STUDIO_EMBEDDINGS_URL,
        help="LM Studio /v1/embeddings URL",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=DEFAULT_DELAY_BETWEEN_REQUESTS,
        help="Seconds between API calls",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only process first 2 motifs, call API, print dim; do not write",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        metavar="N",
        help="Process only first N motifs (for testing)",
    )
    args = parser.parse_args()

    if not args.motifs.is_file():
        print(f"ERROR: Motifs file not found: {args.motifs}", file=sys.stderr)
        sys.exit(1)

    with args.motifs.open("r", encoding="utf-8") as f:
        motifs = json.load(f)
    if not isinstance(motifs, list):
        print("ERROR: Expected a JSON array of motifs", file=sys.stderr)
        sys.exit(1)

    total = len(motifs)
    if args.limit is not None:
        total = min(total, args.limit)
    if args.dry_run:
        total = min(2, total)

    print(f"Loaded {len(motifs)} motifs from {args.motifs}")
    print(f"Will process {total} motifs; model={args.model!r}")
    if args.dry_run:
        print("DRY RUN: only first 2, no file written")
    else:
        print(f"Output: {args.output}")
    print()

    # Process in place on a copy so we don't mutate the original list items until we're sure
    out_list = [dict(m) for m in motifs[:total]]

    for idx, motif in enumerate(out_list):
        mid = motif.get("id") or f"index-{idx}"
        text = text_for_motif(motif)
        if not text:
            print(f"[{idx + 1}/{total}] id={mid!r} SKIP (no name/description)")
            continue
        try:
            vec = call_lmstudio_embedding(
                text=text,
                model=args.model,
                api_url=args.api_url,
            )
        except Exception as e:
            print(f"[{idx + 1}/{total}] id={mid!r} ERROR: {e}", file=sys.stderr)
            raise
        dim = len(vec)
        motif["embedding"] = vec
        motif["embedding_model"] = args.model
        motif["embedding_dim"] = dim
        print(f"[{idx + 1}/{total}] id={mid!r} OK (dim={dim})")
        if idx < total - 1 and args.delay > 0:
            time.sleep(args.delay)

    if args.dry_run:
        print("\nDry run done. No file written.")
        return

    # If we processed a subset, merge back with the rest so output has same length as input
    if args.limit is not None and args.limit < len(motifs):
        out_list = out_list + motifs[args.limit:]
        print(f"\nMerged {len(out_list) - args.limit} unprocessed motifs (unchanged) into output.")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as f:
        json.dump(out_list, f, ensure_ascii=False, indent=2)
    print(f"\nWrote {len(out_list)} motifs to {args.output}")


if __name__ == "__main__":
    main()
