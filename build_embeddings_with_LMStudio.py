#!/usr/bin/env python3
"""
build_embeddings_with_lmstudio.py

GENERAL IDEA
------------
This script is a *generic embedding pipeline* that talks to an LM Studio
server (or any OpenAI-compatible embedding endpoint) and produces a JSON
file whose structure is compatible with the `motifs.json` used in the
GBG practice app.

You can copy this file into *any* project, configure a few constants
or CLI flags, and use it to:

1. Read a corpus of items from a JSON file.
2. For each item, send its text to an embedding model running in LM Studio.
3. Collect all embedding vectors.
4. Optionally merge these vectors into a "motif-style" JSON structure
   (objects that have an `embedding: number[]` field).

The output motifs-style file can be dropped into:
- `src/data/motifs.json` in this GBG app, or
- any other app that expects a similar shape: list of objects, each with
  an `id` and an `embedding` array of floats.

This script intentionally mirrors the style of your existing
`scripts/translate_motifs.py` (requests, LM Studio base URL, etc.),
but uses the **/v1/embeddings** endpoint instead of `/v1/chat/completions`.
"""

import argparse
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import requests


# =============================================================================
# CONFIGURATION DEFAULTS
# =============================================================================

# Default LM Studio URL for the embeddings endpoint.
# Adjust if your LM Studio server runs elsewhere or under a reverse proxy.
LM_STUDIO_EMBEDDINGS_URL = "http://localhost:1234/v1/embeddings"

# Default model name. In LM Studio, this should be the *embedding model*
# you have loaded (e.g., "text-embedding-3-large" or a local embedding model).
DEFAULT_EMBEDDING_MODEL = "text-embedding-3-large"

# Default input field names.
# - Every item in the input JSON array should at least have `id`
#   and one text field (by default `text`).
# - If you're working directly with motif-like objects, you can instead
#   set TEXT_FIELD to "name" or "description" or combine fields yourself.
DEFAULT_ID_FIELD = "id"
DEFAULT_TEXT_FIELD = "text"

# Safety defaults for rate limiting and robustness.
DEFAULT_REQUEST_TIMEOUT = 60.0  # seconds
DEFAULT_DELAY_BETWEEN_REQUESTS = 0.1  # seconds; small pause to avoid spamming LM Studio


# =============================================================================
# DATA CLASSES (for clarity, not strictly necessary)
# =============================================================================

@dataclass
class CorpusItem:
    """
    Minimal representation of a corpus item we want to embed.

    Required:
    - id: stable identifier (e.g., motif ID, document ID).
    - text: the text passed to the embedding model.

    extra: arbitrary extra metadata; preserved when generating motifs-style output.
    """
    id: str
    text: str
    extra: Dict[str, Any]


@dataclass
class EmbeddedItem:
    """
    Result of embedding a CorpusItem.

    - id: same as CorpusItem.id
    - embedding: list of floats (the vector returned by the embedding model)
    - dim: embedding dimension (len(embedding))
    """
    id: str
    embedding: List[float]
    dim: int


# =============================================================================
# LM STUDIO / OPENAI-COMPATIBLE EMBEDDING CLIENT
# =============================================================================

def call_lmstudio_embedding(
    text: str,
    model: str,
    api_url: str,
    timeout: float = DEFAULT_REQUEST_TIMEOUT,
) -> List[float]:
    """
    Call an OpenAI-compatible /v1/embeddings endpoint (LM Studio).

    IMPORTANT ASSUMPTIONS:
    ----------------------
    - LM Studio is running with an embedding model.
    - It exposes a POST /v1/embeddings endpoint with OpenAI-style payload:
        {
          "model": "your-embedding-model-name",
          "input": "some text"
        }
    - The response looks like:
        {
          "data": [
            {
              "embedding": [0.1, 0.2, ...]
            }
          ],
          ...
        }

    If your LM Studio setup differs, adjust this function only.
    Everything else in the pipeline remains the same.
    """
    payload = {
        "model": model,
        "input": text,
    }

    try:
        resp = requests.post(api_url, json=payload, timeout=timeout)
        resp.raise_for_status()
        data = resp.json()

        # Very defensive parsing – we don't want to crash just because of a
        # slightly different shape; instead, we'll surface a clear error.
        if not isinstance(data, dict) or "data" not in data:
            raise ValueError(f"Unexpected embeddings response format: {data!r}")

        entries = data["data"]
        if not isinstance(entries, list) or len(entries) == 0:
            raise ValueError(f"No embedding entries returned: {data!r}")

        first = entries[0]
        if "embedding" not in first:
            raise ValueError(f"No 'embedding' field in first entry: {first!r}")

        embedding = first["embedding"]
        if not isinstance(embedding, list):
            raise ValueError(f"Embedding is not a list: {type(embedding)}")

        # Ensure floats; some implementations may return decimals or strings.
        # We coerce everything to float for downstream code.
        return [float(x) for x in embedding]

    except requests.exceptions.RequestException as e:
        # Network / timeout / connection error.
        raise RuntimeError(f"Error calling LM Studio embeddings API: {e}") from e


# =============================================================================
# CORPUS LOADING AND PREPROCESSING
# =============================================================================

def load_corpus(
    path: Path,
    id_field: str = DEFAULT_ID_FIELD,
    text_field: str = DEFAULT_TEXT_FIELD,
) -> List[CorpusItem]:
    """
    Load a corpus from a JSON file.

    EXPECTED INPUT SHAPE
    --------------------
    The input JSON MUST be a list/array. Each element should be an object
    with at least:

        {
          "<id_field>": "some-id",
          "<text_field>": "Some text to embed",
          ... (any extra fields)
        }

    Examples:
    ---------
    1) Simple corpus:

        [
          { "id": "doc1", "text": "Hello world" },
          { "id": "doc2", "text": "Another document" }
        ]

    2) Motif-like corpus (you might use name+description as text):

        [
          {
            "id": "A50.1",
            "name": "Creation Of Angels And Devils",
            "description": "Some description...",
            "chapter": "",
            ...
          }
        ]

       In this case, you could either:
       - Precompute a combined "text" field before calling this script, OR
       - Change `text_field` to "name", or write a custom loader that
         concatenates name+description for you (see comments below).
    """
    with path.open("r", encoding="utf-8") as f:
        raw = json.load(f)

    if not isinstance(raw, list):
        raise ValueError(f"Expected a JSON array in {path}, got {type(raw).__name__}")

    items: List[CorpusItem] = []
    for idx, obj in enumerate(raw):
        if not isinstance(obj, dict):
            raise ValueError(
                f"Element at index {idx} in {path} is not an object: {type(obj).__name__}"
            )

        if id_field not in obj:
            raise ValueError(f"Missing id field '{id_field}' in element {idx}: {obj!r}")
        if text_field not in obj:
            raise ValueError(
                f"Missing text field '{text_field}' in element {idx}: {obj!r}\n"
                "Either:\n"
                "  - Add that field to your input JSON, or\n"
                "  - Change --text-field to point at the field you want to embed."
            )

        item_id = str(obj[id_field])

        text_value = obj[text_field]
        if not isinstance(text_value, str):
            # Be permissive: convert non-string to str rather than failing outright.
            text_value = str(text_value)

        # extra = all other fields except the id and text fields,
        # so we preserve metadata when building motifs-style output.
        extra: Dict[str, Any] = {
            k: v for k, v in obj.items() if k not in (id_field, text_field)
        }

        items.append(CorpusItem(id=item_id, text=text_value, extra=extra))

    return items


# =============================================================================
# EMBEDDING PIPELINE
# =============================================================================

def embed_corpus_items(
    items: Sequence[CorpusItem],
    model: str,
    api_url: str,
    delay: float = DEFAULT_DELAY_BETWEEN_REQUESTS,
) -> List[EmbeddedItem]:
    """
    Embed each CorpusItem's text via LM Studio.

    This implementation is intentionally simple and robust:
    - Processes items *sequentially* (one request per item).
    - Prints progress to stdout (so a human / another AI can monitor).
    - Sleeps `delay` seconds between requests to avoid overloading LM Studio.

    For small/medium datasets (hundreds to a few thousand items) this is fine.
    For very large datasets, you could:
      - Increase batch size by using the "input" field as a list of strings,
      - Or parallelize calls (but be gentle with your local GPU).
    """
    results: List[EmbeddedItem] = []

    total = len(items)
    if total == 0:
        print("No items to embed. Exiting.")
        return results

    print(f"Embedding {total} items with model '{model}' via {api_url}...")

    for idx, item in enumerate(items):
        # Informational progress line.
        print(f"[{idx + 1}/{total}] Embedding id={item.id!r} ...", end=" ", flush=True)

        try:
            vec = call_lmstudio_embedding(
                text=item.text,
                model=model,
                api_url=api_url,
            )
        except Exception as e:
            # On error, we surface it and either:
            #  - skip the item, or
            #  - exit early, depending on your preference.
            # For now, we *exit* to avoid silently missing embeddings.
            print("ERROR")
            raise RuntimeError(f"Failed to embed item {item.id!r}: {e}") from e

        dim = len(vec)
        results.append(EmbeddedItem(id=item.id, embedding=vec, dim=dim))

        print(f"OK (dim={dim})")

        if idx < total - 1 and delay > 0:
            time.sleep(delay)

    print(f"Completed embeddings for {len(results)} items.")
    return results


# =============================================================================
# OUTPUT GENERATION
# =============================================================================

def write_embeddings_json(
    embedded_items: Sequence[EmbeddedItem],
    path: Path,
) -> None:
    """
    Write a standalone embeddings JSON file.

    OUTPUT SHAPE
    ------------
    [
      {
        "id": "item-id-1",
        "dim": 128,
        "embedding": [0.1, 0.2, ...]
      },
      ...
    ]

    This is useful for debugging, re-use, or importing into other tools.
    """
    data = [
        {"id": e.id, "dim": e.dim, "embedding": e.embedding}
        for e in embedded_items
    ]

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"Wrote standalone embeddings JSON: {path}")


def merge_embeddings_into_motifs(
    base_motifs_path: Path,
    embedded_items: Sequence[EmbeddedItem],
    output_path: Path,
    id_field: str = DEFAULT_ID_FIELD,
    embedding_field: str = "embedding",
) -> None:
    """
    Merge embeddings into an existing motifs-style JSON file.

    This function is the bridge to the *exact* structure used in the GBG app.

    EXPECTED BASE FILE SHAPE
    ------------------------
    - JSON array of objects, each object has at least:
        { "<id_field>": "some-id", ... }
    - It may already have an `embedding` field; this function will overwrite it.

    WHAT IT DOES
    ------------
    - Loads the base motifs JSON.
    - Builds a dictionary: id -> embedding vector.
    - For each motif in base, if there is a matching id in the embeddings,
      sets motif[embedding_field] = that vector.
    - Writes the updated list to `output_path`.

    EXAMPLE
    -------
    For the GBG app, you can do:

        python build_embeddings_with_lmstudio.py \
          --input-corpus path/to/my_corpus.json \
          --embeddings-json dist/my_corpus_embeddings.json \
          --base-motifs src/data/motifs.json \
          --output-motifs src/data/motifs_with_new_embeddings.json
    """
    with base_motifs_path.open("r", encoding="utf-8") as f:
        base = json.load(f)

    if not isinstance(base, list):
        raise ValueError(
            f"Expected an array in base motifs file {base_motifs_path}, "
            f"got {type(base).__name__}"
        )

    # Build a lookup from id -> embedding.
    emb_by_id: Dict[str, List[float]] = {e.id: e.embedding for e in embedded_items}

    missing_count = 0
    updated_count = 0

    for obj in base:
        if not isinstance(obj, dict):
            continue

        if id_field not in obj:
            continue

        mid = str(obj[id_field])
        vec = emb_by_id.get(mid)
        if vec is None:
            missing_count += 1
            continue

        obj[embedding_field] = vec
        updated_count += 1

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(base, f, ensure_ascii=False, indent=2)

    print(
        f"Merged embeddings into motifs: {updated_count} updated, "
        f"{missing_count} motifs had no matching embedding id."
    )
    print(f"Wrote updated motifs-style JSON: {output_path}")


def build_motifs_direct_from_corpus(
    corpus_items: Sequence[CorpusItem],
    embedded_items: Sequence[EmbeddedItem],
    output_path: Path,
    id_field: str = DEFAULT_ID_FIELD,
    name_field: str = "name",
    text_as: str = "description",
    embedding_field: str = "embedding",
) -> None:
    """
    (Alternative) Build a motifs-style JSON directly from the corpus + embeddings,
    without needing an existing base motifs file.

    This is handy for *new* projects where you don't already have motifs.json.

    LOGIC
    -----
    - We pair CorpusItem.extra + EmbeddedItem.embedding by `id`.
    - We construct a new object per id:
        {
          "id": "...",
          "name": extra.get(name_field, item.id),
          "<text_as>": item.text,
          "<embedding_field>": embedding list,
          ... (any other fields from extra)
        }
    - Write an array of these objects to `output_path`.

    For the GBG app:
    - The original motifs.json has many fields (chapter, level, tarot_index, etc.).
      If your corpus has similar metadata, you can embed it in CorpusItem.extra
      and it will carry over here.
    """
    emb_by_id: Dict[str, EmbeddedItem] = {e.id: e for e in embedded_items}
    results: List[Dict[str, Any]] = []

    for item in corpus_items:
        emb = emb_by_id.get(item.id)
        if emb is None:
            # If there's no embedding for this id, we skip it.
            continue

        # Start with all extra metadata.
        obj: Dict[str, Any] = dict(item.extra)

        # Set id.
        obj[id_field] = item.id

        # Use a "name" field if available in extra; otherwise fall back to id.
        if name_field not in obj:
            obj[name_field] = item.id

        # Optionally store the original text under a field such as "description".
        # If you don't want this, you can set text_as=None or adjust as needed.
        if text_as:
            obj[text_as] = item.text

        # Finally, attach the embedding vector.
        obj[embedding_field] = emb.embedding

        results.append(obj)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print(
        f"Built new motifs-style JSON directly from corpus: "
        f"{len(results)} items written to {output_path}"
    )


# =============================================================================
# CLI / MAIN
# =============================================================================

def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    """
    Set up the command-line interface.

    Typical usage patterns:

    1) Just generate embeddings JSON (no motifs merging yet):

        python build_embeddings_with_lmstudio.py \
          --input-corpus scripts/my_corpus.json \
          --embeddings-json dist/my_corpus_embeddings.json

    2) Generate embeddings AND merge into an existing motifs.json:

        python build_embeddings_with_lmstudio.py \
          --input-corpus scripts/motif_texts.json \
          --embeddings-json dist/motif_embeddings.json \
          --base-motifs src/data/motifs.json \
          --output-motifs src/data/motifs_with_embeddings.json

       Then you can replace `src/data/motifs.json` in the GBG app with
       `motifs_with_embeddings.json`.

    3) Generate embeddings AND create a brand-new motifs-style JSON:

        python build_embeddings_with_lmstudio.py \
          --input-corpus scripts/my_corpus.json \
          --embeddings-json dist/my_corpus_embeddings.json \
          --direct-motifs dist/my_corpus_motifs.json
    """
    p = argparse.ArgumentParser(
        description="Generate embeddings via LM Studio and package into motifs-style JSON."
    )

    # Core inputs/outputs.
    p.add_argument(
        "--input-corpus",
        type=str,
        required=True,
        help="Path to input corpus JSON (array of objects with id + text).",
    )
    p.add_argument(
        "--embeddings-json",
        type=str,
        required=True,
        help="Where to write standalone embeddings JSON.",
    )

    # Optional: merge into existing motifs.json.
    p.add_argument(
        "--base-motifs",
        type=str,
        help="Existing motifs-style JSON to merge embeddings into (optional).",
    )
    p.add_argument(
        "--output-motifs",
        type=str,
        help="Path to write merged motifs-style JSON (used with --base-motifs).",
    )

    # Optional: build motifs-style JSON directly from corpus + embeddings.
    p.add_argument(
        "--direct-motifs",
        type=str,
        help=(
            "If set, build a new motifs-style JSON directly from the corpus + "
            "embeddings and write it here."
        ),
    )

    # Fields in the input JSON.
    p.add_argument(
        "--id-field",
        type=str,
        default=DEFAULT_ID_FIELD,
        help=f"Field name used for IDs in input corpus (default: {DEFAULT_ID_FIELD!r})",
    )
    p.add_argument(
        "--text-field",
        type=str,
        default=DEFAULT_TEXT_FIELD,
        help=f"Field name containing the text to embed (default: {DEFAULT_TEXT_FIELD!r})",
    )

    # LM Studio / model configuration.
    p.add_argument(
        "--lmstudio-url",
        type=str,
        default=LM_STUDIO_EMBEDDINGS_URL,
        help=f"LM Studio embeddings endpoint URL (default: {LM_STUDIO_EMBEDDINGS_URL})",
    )
    p.add_argument(
        "--model",
        type=str,
        default=DEFAULT_EMBEDDING_MODEL,
        help=f"Embedding model name (default: {DEFAULT_EMBEDDING_MODEL!r})",
    )
    p.add_argument(
        "--delay",
        type=float,
        default=DEFAULT_DELAY_BETWEEN_REQUESTS,
        help="Delay (in seconds) between embedding requests (default: 0.1).",
    )

    return p.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> None:
    args = parse_args(argv)

    corpus_path = Path(args.input_corpus)
    emb_path = Path(args.embeddings_json)

    # Load corpus.
    print(f"Loading corpus from {corpus_path} "
          f"(id_field={args.id_field!r}, text_field={args.text_field!r})")
    corpus_items = load_corpus(
        corpus_path,
        id_field=args.id_field,
        text_field=args.text_field,
    )

    # Embed all items.
    embedded_items = embed_corpus_items(
        corpus_items,
        model=args.model,
        api_url=args.lmstudio_url,
        delay=args.delay,
    )

    # Write standalone embeddings JSON.
    write_embeddings_json(embedded_items, emb_path)

    # Optionally, merge into existing motifs.json.
    if args.base_motifs and args.output_motifs:
        base_path = Path(args.base_motifs)
        out_motifs_path = Path(args.output_motifs)
        merge_embeddings_into_motifs(
            base_motifs_path=base_path,
            embedded_items=embedded_items,
            output_path=out_motifs_path,
        )
    elif args.base_motifs or args.output_motifs:
        print(
            "WARNING: --base-motifs and --output-motifs must both be provided "
            "for merging; ignoring partial configuration."
        )

    # Optionally, build motifs-style JSON directly from corpus + embeddings.
    if args.direct_motifs:
        direct_path = Path(args.direct_motifs)
        build_motifs_direct_from_corpus(
            corpus_items=corpus_items,
            embedded_items=embedded_items,
            output_path=direct_path,
        )


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrupted by user.", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"\nFATAL ERROR: {e}", file=sys.stderr)
        sys.exit(1)