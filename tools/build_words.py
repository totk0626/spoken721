import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHUNKS = ROOT / "data" / "chunks"
OUT = ROOT / "words.js"

POS = {"noun", "verb", "adjective", "adverb", "pronoun", "preposition", "conjunction",
       "determiner", "article", "modal", "interjection", "number"}


def text(v, limit):
    return isinstance(v, str) and v.strip() == v and 0 < len(v) <= limit


def problems(src, out):
    errs = []
    if not isinstance(out, list):
        return ["top level is not a JSON array"]
    if len(out) != len(src):
        errs.append(f"{len(out)} entries, expected {len(src)}")
    for s, e in zip(src, out):
        tag = f"#{s['id']} {s['word']}"
        if not isinstance(e, dict):
            errs.append(f"{tag}: entry is not an object")
            continue
        if e.get("id") != s["id"] or e.get("word") != s["word"]:
            errs.append(f"{tag}: id/word mismatch, got #{e.get('id')} {e.get('word')}")
        extra = set(e) - {"id", "word", "pos", "phrases", "ex"}
        if extra:
            errs.append(f"{tag}: unknown keys {sorted(extra)}")
        groups = e.get("pos")
        if not isinstance(groups, list) or not 1 <= len(groups) <= 3:
            errs.append(f"{tag}: pos must have 1-3 groups")
            groups = []
        seen = set()
        for g in groups:
            if g.get("p") not in POS:
                errs.append(f"{tag}: bad part of speech {g.get('p')!r}")
            if g.get("p") in seen:
                errs.append(f"{tag}: part of speech {g.get('p')} repeated")
            seen.add(g.get("p"))
            senses = g.get("senses")
            if not isinstance(senses, list) or not 1 <= len(senses) <= 3:
                errs.append(f"{tag}: {g.get('p')} must have 1-3 senses")
                continue
            for sn in senses:
                if not text(sn.get("ko"), 30):
                    errs.append(f"{tag}: bad ko {sn.get('ko')!r}")
                if not text(sn.get("en"), 160) or sn["en"].endswith("."):
                    errs.append(f"{tag}: bad en {sn.get('en')!r}")
        phrases = e.get("phrases")
        if not isinstance(phrases, list) or len(phrases) > 3:
            errs.append(f"{tag}: phrases must be a list of 0-3")
            phrases = []
        for ph in phrases:
            if not text(ph.get("t"), 60) or not text(ph.get("ko"), 40):
                errs.append(f"{tag}: bad phrase {ph!r}")
        ex = e.get("ex")
        if not isinstance(ex, dict) or not text(ex.get("en"), 120) or not text(ex.get("ko"), 80):
            errs.append(f"{tag}: bad example {ex!r}")
    return errs


def apply_sense_additions(words):
    path = ROOT / "data" / "sense-additions.json"
    if not path.exists():
        return 0, []
    by_id = {w["id"]: w for w in words}
    errs = []
    adds = json.loads(path.read_text(encoding="utf-8"))
    for a in adds:
        w = by_id.get(a.get("id"))
        tag = f"add #{a.get('id')} {a.get('word')}"
        if not w or w["w"] != a.get("word"):
            errs.append(f"{tag}: id/word not found")
            continue
        if a.get("p") not in POS:
            errs.append(f"{tag}: bad part of speech {a.get('p')!r}")
            continue
        if not text(a.get("ko"), 30) or not text(a.get("en"), 160) or a["en"].endswith("."):
            errs.append(f"{tag}: bad ko/en")
            continue
        if not text(a.get("why"), 200):
            errs.append(f"{tag}: missing why")
        if any(s["ko"] == a["ko"] for g in w["pos"] for s in g["senses"]):
            errs.append(f"{tag}: duplicates an existing sense")
            continue
        group = next((g for g in w["pos"] if g["p"] == a["p"]), None)
        if group is None:
            group = {"p": a["p"], "senses": []}
            w["pos"].append(group)
        group["senses"].append({"ko": a["ko"], "en": a["en"]})
    return len(adds), errs


def load(n):
    src = json.loads((CHUNKS / f"in-{n}.json").read_text(encoding="utf-8"))
    path = CHUNKS / f"out-{n}.json"
    if not path.exists():
        return src, None, [f"out-{n}.json missing"]
    try:
        out = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as err:
        return src, None, [f"out-{n}.json is not valid JSON: {err}"]
    return src, out, problems(src, out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", metavar="NN", help="validate one chunk only")
    args = ap.parse_args()

    if args.check:
        _, _, errs = load(f"{int(args.check):02d}")
        print("\n".join(errs[:60]) if errs else "OK")
        sys.exit(1 if errs else 0)

    words, failed = [], False
    for path in sorted(CHUNKS.glob("in-*.json")):
        n = path.stem.split("-")[1]
        src, out, errs = load(n)
        if errs:
            failed = True
            print(f"chunk {n}: {len(errs)} problems")
            print("  " + "\n  ".join(errs[:20]))
            continue
        for s, e in zip(src, out):
            words.append({"id": s["id"], "w": s["word"], "def": s["def"], "pos": e["pos"],
                          "ph": e["phrases"], "ex": e["ex"]})
    if failed:
        sys.exit(1)

    assert [w["id"] for w in words] == list(range(1, 722)), "ids are not 1..721 in order"
    n_adds, errs = apply_sense_additions(words)
    if errs:
        print("sense-additions.json problems:\n  " + "\n  ".join(errs))
        sys.exit(1)
    OUT.write_text("window.WORDS = " + json.dumps(words, ensure_ascii=False, separators=(",", ":")) + ";\n",
                   encoding="utf-8")
    senses = sum(len(g["senses"]) for w in words for g in w["pos"])
    phrases = sum(len(w["ph"]) for w in words)
    multi = sum(1 for w in words if len(w["pos"]) > 1)
    print(f"wrote {OUT.name}: {len(words)} words, {senses} senses, {phrases} phrases, "
          f"{multi} words with 2+ parts of speech, {n_adds} added senses, {OUT.stat().st_size // 1024} KB")


main()
