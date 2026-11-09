import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "ngsl-spoken-721.md"
CHUNKS = ROOT / "data" / "chunks"
N_CHUNKS = 6

row = re.compile(r"^\|\s*\*\*(.+?)\*\*\s*\|\s*(.+?)\s*\|\s*$")

entries = []
for line in SRC.read_text(encoding="utf-8").splitlines():
    if line.startswith("**SOURCE"):
        break
    m = row.match(line)
    if m:
        entries.append({"id": len(entries) + 1, "word": m.group(1), "def": m.group(2)})

assert len(entries) == 721, f"expected 721 entries, parsed {len(entries)}"
assert len({e["word"] for e in entries}) == 721, "duplicate words in source"

(ROOT / "data" / "source.json").write_text(json.dumps(entries, ensure_ascii=False, indent=1), encoding="utf-8")

size = -(-len(entries) // N_CHUNKS)
for i in range(N_CHUNKS):
    part = entries[i * size:(i + 1) * size]
    (CHUNKS / f"in-{i + 1:02d}.json").write_text(json.dumps(part, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"in-{i + 1:02d}.json  {len(part):3d} words  {part[0]['word']} .. {part[-1]['word']}")

sys.exit(0)
