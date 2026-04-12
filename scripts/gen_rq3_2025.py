"""
Generate rq3_planning_areas.json using 2025 population data.

Input: data/raw/respopagesex2025.csv (SingStat 2025 resident population
by Planning Area + Subzone + single-year age + sex)
Output: data/rq3_planning_areas.json with per-area demographics and
shelter ratio.
"""

import csv
import json
from collections import defaultdict
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
CSV_PATH = BASE / "data" / "raw" / "respopagesex2025.csv"
OUT_PATH = BASE / "data" / "rq3_planning_areas.json"
OLD_PATH = BASE / "data" / "rq3_planning_areas.json"

# Preserve shelter_ratio, centroid_lat, centroid_lng from old file if present
EXISTING = {}
if OLD_PATH.exists():
    try:
        with open(OLD_PATH) as f:
            old = json.load(f)
        if isinstance(old, list):
            EXISTING = {a["name"].upper(): a for a in old}
    except Exception:
        pass


def aggregate_by_pa(path: Path) -> dict[str, dict]:
    """Aggregate CSV rows into per-PA age-bucket totals."""
    agg: dict[str, dict] = {}
    with open(path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            pa = row["PA"].strip().upper()
            age_raw = row["Age"].strip()
            if age_raw == "90_and_Over":
                age = 90
            else:
                age = int(age_raw)
            pop = int(row["Pop"])
            if pa not in agg:
                agg[pa] = {
                    "total": 0,
                    "children_0_14": 0,      # 0-14
                    "youth_15_24": 0,        # 15-24
                    "working_25_64": 0,      # 25-64
                    "elderly_65_74": 0,      # 65-74 (young seniors)
                    "elderly_75plus": 0,     # 75+ (frail seniors)
                }
            d = agg[pa]
            d["total"] += pop
            if age <= 14:
                d["children_0_14"] += pop
            elif age <= 24:
                d["youth_15_24"] += pop
            elif age <= 64:
                d["working_25_64"] += pop
            elif age <= 74:
                d["elderly_65_74"] += pop
            else:
                d["elderly_75plus"] += pop
    return agg


def main():
    agg = aggregate_by_pa(CSV_PATH)

    results = []
    for pa_upper, d in sorted(agg.items()):
        total = d["total"]
        if total < 100:
            continue
        elderly = d["elderly_65_74"] + d["elderly_75plus"]
        children = d["children_0_14"]

        rec = {
            "name": pa_upper,
            "total_population": total,
            "children_count": children,
            "youth_count": d["youth_15_24"],
            "working_count": d["working_25_64"],
            "elderly_65_74_count": d["elderly_65_74"],
            "elderly_75plus_count": d["elderly_75plus"],
            "elderly_count": elderly,
            "children_ratio": round(children / total, 4),
            "youth_ratio": round(d["youth_15_24"] / total, 4),
            "elderly_ratio": round(elderly / total, 4),
            "elderly_75plus_ratio": round(d["elderly_75plus"] / total, 4),
            "vulnerable_ratio": round((children + elderly) / total, 4),
        }

        # Carry over shelter_ratio and centroid from old file if available
        old = EXISTING.get(pa_upper)
        if old:
            rec["shelter_ratio"] = old.get("shelter_ratio", 0)
            rec["centroid_lat"] = old.get("centroid_lat")
            rec["centroid_lng"] = old.get("centroid_lng")

        results.append(rec)

    with open(OUT_PATH, "w") as f:
        json.dump(results, f, indent=2)

    print(f"Wrote {len(results)} planning areas to {OUT_PATH}")
    total_pop = sum(r["total_population"] for r in results)
    print(f"Total population: {total_pop:,}")
    # Top 5 oldest areas
    oldest = sorted(results, key=lambda r: r["elderly_ratio"], reverse=True)[:5]
    print("\nTop 5 oldest planning areas (2025):")
    for r in oldest:
        print(f"  {r['name']:<22} elderly {r['elderly_ratio']*100:.1f}% "
              f"(75+: {r['elderly_75plus_ratio']*100:.1f}%)  pop {r['total_population']:,}")
    youngest = sorted(results, key=lambda r: r["elderly_ratio"])[:5]
    print("\nTop 5 youngest planning areas (2025):")
    for r in youngest:
        print(f"  {r['name']:<22} elderly {r['elderly_ratio']*100:.1f}% "
              f"children {r['children_ratio']*100:.1f}%  pop {r['total_population']:,}")


if __name__ == "__main__":
    main()
