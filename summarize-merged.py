#!/usr/bin/env python3
"""
Consolidate the per-deployment parity reports into one table.

Reads output/merged/*.json (written by run-merged-parity.sh) and prints, per
deployment and entity, the columns the validation asks for:

  subgraph rows | envio rows | fields differing at all | >0.1% | >1%

plus the coverage facts a reader needs to know whether to trust a clean row:
whether the field comparison was truncated by --deep-limit, and how many of the
differences are BigDecimal rounding rather than quantity.
"""
import json
import sys
from pathlib import Path

OUT = Path(__file__).parent / "output" / "merged"

# Display order: smallest/cleanest first, the two Linea giants last.
ORDER = [
    ("analytics-239", "analytics", 239, "cl-analytics-tac/v1.0.1"),
    ("farm-239", "farm", 239, "farms-tac/v1.0.0"),
    ("helper-59144", "helper", 59144, "lynex-helper/0.0.2"),
    ("helper-9745", "helper", 9745, "ionex-helper/0.3"),
    ("helper-4663", "helper", 4663, "orvex-helper/1.0.1"),
    ("helper-1776", "helper", 1776, "pumex-helper/v0.0.2 (Ormi)"),
    ("v1-59144", "v1", 59144, "lynex-v1/1.0.4"),
    ("v1-4663", "v1", 4663, "v1-orvex/1.0.0"),
]


def load(name):
    p = OUT / f"{name}.json"
    if not p.exists():
        return None
    return json.loads(p.read_text())


def main():
    consolidated = {}
    for name, indexer, chain, subgraph in ORDER:
        d = load(name)
        if d is None:
            print(f"!! MISSING REPORT: {name}", file=sys.stderr)
            continue

        rows = []
        for entity, v in sorted(d["entities"].items()):
            f = v["fieldDiffs"]
            rows.append(
                {
                    "entity": entity,
                    "subgraphRows": v["subgraphCount"],
                    "envioRows": v["hyperindexCount"],
                    "missingInEnvio": len(v["missingInHyperindex"]),
                    "extraInEnvio": len(v["missingInSubgraph"]),
                    "compared": v["comparedCount"],
                    "truncated": v["comparisonTruncated"],
                    "diffAny": f["differingAtAll"],
                    "diffOverTenth": f["overTenthPercent"],
                    "diffOverOne": f["overOnePercent"],
                    "diffUlp": f["ulp"],
                    "diffNonNumeric": f["nonNumeric"],
                    "maxPercent": f["maxPercent"],
                    "byField": f["byField"],
                    "examples": v["fieldMismatchExamples"][:20],
                }
            )

        consolidated[name] = {
            "indexer": indexer,
            "chain": chain,
            "subgraph": subgraph,
            "entities": rows,
            "totals": {
                "subgraphRows": sum(r["subgraphRows"] for r in rows),
                "envioRows": sum(r["envioRows"] for r in rows),
                "missingInEnvio": sum(r["missingInEnvio"] for r in rows),
                "extraInEnvio": sum(r["extraInEnvio"] for r in rows),
                "compared": sum(r["compared"] for r in rows),
                "diffAny": sum(r["diffAny"] for r in rows),
                "diffOverTenth": sum(r["diffOverTenth"] for r in rows),
                "diffOverOne": sum(r["diffOverOne"] for r in rows),
                "diffUlp": sum(r["diffUlp"] for r in rows),
                "diffNonNumeric": sum(r["diffNonNumeric"] for r in rows),
                "anyTruncated": any(r["truncated"] for r in rows),
            },
        }

        t = consolidated[name]["totals"]
        print(f"\n{'='*100}")
        print(f"{indexer}/{chain}   {subgraph}")
        print(f"{'='*100}")
        print(
            f"{'entity':<34}{'sg':>9}{'envio':>9}{'miss':>7}{'extra':>7}"
            f"{'cmp':>9}{'any':>7}{'>0.1%':>7}{'>1%':>6}{'ulp':>7}  trunc"
        )
        for r in rows:
            print(
                f"{r['entity']:<34}{r['subgraphRows']:>9}{r['envioRows']:>9}"
                f"{r['missingInEnvio']:>7}{r['extraInEnvio']:>7}{r['compared']:>9}"
                f"{r['diffAny']:>7}{r['diffOverTenth']:>7}{r['diffOverOne']:>6}"
                f"{r['diffUlp']:>7}  {'YES' if r['truncated'] else ''}"
            )
        print(
            f"{'TOTAL':<34}{t['subgraphRows']:>9}{t['envioRows']:>9}"
            f"{t['missingInEnvio']:>7}{t['extraInEnvio']:>7}{t['compared']:>9}"
            f"{t['diffAny']:>7}{t['diffOverTenth']:>7}{t['diffOverOne']:>6}{t['diffUlp']:>7}"
        )

    (OUT / "consolidated.json").write_text(json.dumps(consolidated, indent=1))
    print(f"\nWrote {OUT/'consolidated.json'}")


if __name__ == "__main__":
    main()
