#!/usr/bin/env python3
"""
Embed Tarot and I-Ching texts via LM Studio (768-d) and write JSON files.
Uses same endpoint/model as motif embeddings so dimensions match.

Sources:
- Tarot: datasets/tarot/tarot-images.json (Kaggle tarot-json)
- I-Ching: datasets/iching-wilhelm-dataset/data/iching_wilhelm_translation.csv (Wilhelm/Baynes)

Usage:
  python scripts/embed_tarot_iching_lmstudio.py
  python scripts/embed_tarot_iching_lmstudio.py --dry-run
  python scripts/embed_tarot_iching_lmstudio.py --tarot-only
  python scripts/embed_tarot_iching_lmstudio.py --iching-only

Output:
  datasets/tarot_embeddings_lmstudio.json
  datasets/iching_embeddings_lmstudio.json
"""

import argparse
import csv
import json
import sys
import time
from pathlib import Path

import requests

LM_STUDIO_EMBEDDINGS_URL = "http://localhost:1234/v1/embeddings"
DEFAULT_EMBEDDING_MODEL = "text-embedding-3-large"
DEFAULT_REQUEST_TIMEOUT = 60.0
DEFAULT_DELAY_BETWEEN_REQUESTS = 0.1

REPO_ROOT = Path(__file__).resolve().parent.parent
TAROT_JSON = REPO_ROOT / "datasets/tarot/tarot-images.json"
ICHING_CSV = REPO_ROOT / "datasets/iching-wilhelm-dataset/data/iching_wilhelm_translation.csv"
TAROT_OUT = REPO_ROOT / "datasets/tarot_embeddings_lmstudio.json"
ICHING_OUT = REPO_ROOT / "datasets/iching_embeddings_lmstudio.json"


def call_lmstudio_embedding(
    text: str,
    model: str,
    api_url: str,
    timeout: float = DEFAULT_REQUEST_TIMEOUT,
) -> list[float]:
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


def text_for_tarot_card(card: dict) -> str:
    """Build one embeddable string from tarot card fields."""
    parts = []
    if card.get("name"):
        parts.append(str(card["name"]))
    if card.get("arcana"):
        parts.append(f"Arcana: {card['arcana']}")
    if card.get("keywords"):
        kw = card["keywords"]
        parts.append("Keywords: " + (", ".join(kw) if isinstance(kw, list) else str(kw)))
    if card.get("fortune_telling"):
        ft = card["fortune_telling"]
        parts.append("Fortune: " + (" ".join(ft) if isinstance(ft, list) else str(ft)))
    meanings = card.get("meanings") or {}
    if meanings.get("light"):
        parts.append("Light: " + " ".join(meanings["light"]))
    if meanings.get("shadow"):
        parts.append("Shadow: " + " ".join(meanings["shadow"]))
    for key in ("Archetype", "Elemental", "Mythical/Spiritual", "Numerology", "Hebrew Alphabet"):
        if card.get(key):
            parts.append(f"{key}: {card[key]}")
    q = card.get("Questions to Ask")
    if q and isinstance(q, list):
        parts.append("Questions: " + " ".join(q))
    return " ".join(parts).strip() or card.get("name") or ""


def load_iching_rows(path: Path) -> list[dict]:
    """Parse I-Ching CSV; return list of dicts with hex, english, pinyin, text (full)."""
    rows = []
    with path.open("r", encoding="utf-8") as f:
        reader = csv.reader(f, delimiter=";", quotechar='"')
        for row in reader:
            if len(row) < 13:
                continue
            hex_num = row[0].strip()
            english = (row[3] or "").strip()
            pinyin = (row[5] or "").strip()
            symbolic = (row[9] or "").strip()
            parts = [f"{english} ({pinyin}).", symbolic]
            for col in (row[10], row[11], row[12]):  # image, judgment, lines
                if not col:
                    continue
                try:
                    obj = json.loads(col.replace("'", '"'))
                    if isinstance(obj, dict):
                        if "text" in obj:
                            parts.append(obj["text"])
                        if "comments" in obj:
                            parts.append(obj["comments"])
                        for k in sorted(obj.keys(), key=lambda x: (x != "text", x != "comments", x)):
                            if k in ("text", "comments"):
                                continue
                            v = obj[k]
                            if isinstance(v, dict):
                                parts.append(v.get("text", ""))
                                parts.append(v.get("comments", ""))
                except json.JSONDecodeError:
                    parts.append(col[:2000])
            text = " ".join(p for p in parts if p).strip() or english
            rows.append({
                "hex": int(hex_num) if hex_num.isdigit() else hex_num,
                "english": english,
                "pinyin": pinyin,
                "text": text,
            })
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Embed Tarot and I-Ching via LM Studio.")
    parser.add_argument("--model", default=DEFAULT_EMBEDDING_MODEL, help="LM Studio embedding model")
    parser.add_argument("--api-url", default=LM_STUDIO_EMBEDDINGS_URL, help="LM Studio /v1/embeddings URL")
    parser.add_argument("--delay", type=float, default=DEFAULT_DELAY_BETWEEN_REQUESTS, help="Seconds between API calls")
    parser.add_argument("--dry-run", action="store_true", help="Only load data and print sample; do not call API or write")
    parser.add_argument("--tarot-only", action="store_true", help="Only embed tarot")
    parser.add_argument("--iching-only", action="store_true", help="Only embed I-Ching")
    args = parser.parse_args()

    embed_dim = None

    # --- Tarot ---
    if not args.iching_only:
        if not TAROT_JSON.is_file():
            print(f"ERROR: Tarot file not found: {TAROT_JSON}", file=sys.stderr)
            sys.exit(1)
        with TAROT_JSON.open("r", encoding="utf-8") as f:
            data = json.load(f)
        cards = data.get("cards") or []
        print(f"Tarot: loaded {len(cards)} cards from {TAROT_JSON}")
        if args.dry_run:
            if cards:
                t = text_for_tarot_card(cards[0])
                print(f"  Sample text (first card, {len(t)} chars): {t[:200]}...")
        else:
            out_list = []
            for idx, card in enumerate(cards):
                text = text_for_tarot_card(card)
                if not text:
                    print(f"  [{idx+1}/{len(cards)}] SKIP (no text)")
                    continue
                try:
                    vec = call_lmstudio_embedding(text=text, model=args.model, api_url=args.api_url)
                except Exception as e:
                    print(f"  [{idx+1}/{len(cards)}] ERROR: {e}", file=sys.stderr)
                    raise
                if embed_dim is None:
                    embed_dim = len(vec)
                out_list.append({
                    "index": idx,
                    "name": card.get("name"),
                    "number": card.get("number"),
                    "arcana": card.get("arcana"),
                    "suit": card.get("suit"),
                    "text_preview": text[:300],
                    "embedding": vec,
                })
                print(f"  [{idx+1}/{len(cards)}] {card.get('name', idx)} dim={len(vec)}")
                if idx < len(cards) - 1 and args.delay > 0:
                    time.sleep(args.delay)
            TAROT_OUT.parent.mkdir(parents=True, exist_ok=True)
            payload = {
                "embedding_model": args.model,
                "embedding_dim": embed_dim,
                "source": "datasets/tarot/tarot-images.json",
                "items": out_list,
            }
            with TAROT_OUT.open("w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
            print(f"  Wrote {TAROT_OUT}")

    # --- I-Ching ---
    if not args.tarot_only:
        if not ICHING_CSV.is_file():
            print(f"ERROR: I-Ching CSV not found: {ICHING_CSV}", file=sys.stderr)
            sys.exit(1)
        iching_rows = load_iching_rows(ICHING_CSV)
        print(f"I-Ching: loaded {len(iching_rows)} hexagrams from {ICHING_CSV}")
        if args.dry_run:
            if iching_rows:
                r = iching_rows[0]
                print(f"  Sample (hex {r['hex']}): {r['text'][:200]}...")
        else:
            out_list = []
            for idx, row in enumerate(iching_rows):
                text = row["text"]
                if not text:
                    print(f"  [{idx+1}/{len(iching_rows)}] hex {row['hex']} SKIP (no text)")
                    continue
                try:
                    vec = call_lmstudio_embedding(text=text, model=args.model, api_url=args.api_url)
                except Exception as e:
                    print(f"  [{idx+1}/{len(iching_rows)}] ERROR: {e}", file=sys.stderr)
                    raise
                if embed_dim is None:
                    embed_dim = len(vec)
                out_list.append({
                    "hex": row["hex"],
                    "english": row["english"],
                    "pinyin": row["pinyin"],
                    "text_preview": text[:300],
                    "embedding": vec,
                })
                print(f"  [{idx+1}/{len(iching_rows)}] hex {row['hex']} {row['english']} dim={len(vec)}")
                if idx < len(iching_rows) - 1 and args.delay > 0:
                    time.sleep(args.delay)
            ICHING_OUT.parent.mkdir(parents=True, exist_ok=True)
            payload = {
                "embedding_model": args.model,
                "embedding_dim": embed_dim,
                "source": "iching-wilhelm-dataset/data/iching_wilhelm_translation.csv",
                "items": out_list,
            }
            with ICHING_OUT.open("w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
            print(f"  Wrote {ICHING_OUT}")

    if args.dry_run:
        print("\nDry run done. No API calls, no files written.")


if __name__ == "__main__":
    main()
