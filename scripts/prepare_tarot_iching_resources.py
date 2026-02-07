#!/usr/bin/env python3
"""
Produce app-ready JSON resource files for Tarot and I-Ching.
No LM Studio or embeddings required — just reshapes existing data so the app
can load them as "tarot resource" and "iching resource" (e.g. for display and
future specialness).

Usage:
  python scripts/prepare_tarot_iching_resources.py

Output:
  datasets/tarot_cards.json   — array of 78 cards: { index, name, number, arcana, suit, img, keywords, fortune_telling, meanings, ... }
  datasets/iching_hexagrams.json — array of 64 hexagrams: { hex, english, pinyin, chinese, symbolic, judgment, image, lines }
"""

import csv
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TAROT_SRC = REPO_ROOT / "datasets/tarot/tarot-images.json"
ICHING_CSV = REPO_ROOT / "datasets/iching-wilhelm-dataset/data/iching_wilhelm_translation.csv"
TAROT_OUT = REPO_ROOT / "datasets/tarot_cards.json"
ICHING_OUT = REPO_ROOT / "datasets/iching_hexagrams.json"


def main() -> None:
    # --- Tarot: normalize to array with index ---
    if not TAROT_SRC.is_file():
        print(f"ERROR: Tarot source not found: {TAROT_SRC}", file=sys.stderr)
        sys.exit(1)
    with TAROT_SRC.open("r", encoding="utf-8") as f:
        data = json.load(f)
    cards = data.get("cards") or []
    out_cards = []
    for idx, c in enumerate(cards):
        out_cards.append({
            "index": idx,
            "name": c.get("name"),
            "number": c.get("number"),
            "arcana": c.get("arcana"),
            "suit": c.get("suit"),
            "img": c.get("img"),
            "keywords": c.get("keywords"),
            "fortune_telling": c.get("fortune_telling"),
            "meanings": c.get("meanings"),
            "Archetype": c.get("Archetype"),
            "Elemental": c.get("Elemental"),
            "Numerology": c.get("Numerology"),
            "Hebrew Alphabet": c.get("Hebrew Alphabet"),
            "Mythical/Spiritual": c.get("Mythical/Spiritual"),
            "Questions to Ask": c.get("Questions to Ask"),
        })
    TAROT_OUT.parent.mkdir(parents=True, exist_ok=True)
    with TAROT_OUT.open("w", encoding="utf-8") as f:
        json.dump(out_cards, f, ensure_ascii=False, indent=2)
    print(f"Wrote {len(out_cards)} tarot cards → {TAROT_OUT}")

    # --- I-Ching: parse CSV into array with hex, english, pinyin, judgment, image, lines ---
    if not ICHING_CSV.is_file():
        print(f"ERROR: I-Ching CSV not found: {ICHING_CSV}", file=sys.stderr)
        sys.exit(1)
    hexagrams = []
    with ICHING_CSV.open("r", encoding="utf-8") as f:
        reader = csv.reader(f, delimiter=";", quotechar='"')
        for row in reader:
            if len(row) < 13:
                continue
            hex_num = row[0].strip()
            chinese_char = (row[6] or "").strip()
            english = (row[3] or "").strip()
            pinyin = (row[5] or "").strip()
            symbolic = (row[9] or "").strip()

            def parse_json_field(col: str) -> dict | None:
                if not col:
                    return None
                try:
                    return json.loads(col.replace("'", '"'))
                except json.JSONDecodeError:
                    return None

            image_obj = parse_json_field(row[10])
            judgment_obj = parse_json_field(row[11])
            lines_obj = parse_json_field(row[12])

            judgment_text = (judgment_obj.get("text") or "") if isinstance(judgment_obj, dict) else ""
            judgment_comments = (judgment_obj.get("comments") or "") if isinstance(judgment_obj, dict) else ""
            image_text = (image_obj.get("text") or "") if isinstance(image_obj, dict) else ""
            image_comments = (image_obj.get("comments") or "") if isinstance(image_obj, dict) else ""

            lines_list = []
            if isinstance(lines_obj, dict):
                for k in sorted(lines_obj.keys(), key=lambda x: int(x) if x.isdigit() else 0):
                    v = lines_obj[k]
                    if isinstance(v, dict):
                        lines_list.append({
                            "line": int(k) if k.isdigit() else k,
                            "text": v.get("text", ""),
                            "comments": v.get("comments", ""),
                        })

            hexagrams.append({
                "hex": int(hex_num) if hex_num.isdigit() else hex_num,
                "english": english,
                "pinyin": pinyin,
                "chinese": chinese_char,
                "symbolic": symbolic,
                "judgment": { "text": judgment_text, "comments": judgment_comments },
                "image": { "text": image_text, "comments": image_comments },
                "lines": lines_list,
            })

    with ICHING_OUT.open("w", encoding="utf-8") as f:
        json.dump(hexagrams, f, ensure_ascii=False, indent=2)
    print(f"Wrote {len(hexagrams)} I-Ching hexagrams → {ICHING_OUT}")


if __name__ == "__main__":
    main()
