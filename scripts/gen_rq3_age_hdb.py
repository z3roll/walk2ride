"""
Generate data/rq3_age_hdb.json — per-planning-area data combining:
  - mean HDB construction year (from area_chart2_400m.json)
  - residential HDB count + linkway length (from area_chart1_400m.json)
  - 2025 resident population age distribution (from respopagesex2025.csv)

Output fields per area:
  name, year_mean, n_hdb_400m, lw_length_m, lw_per_hdb,
  total_pop, n_0_9, n_10_19, n_20_39, n_40_64, n_65plus,
  pct_0_9, pct_10_19, pct_20_39, pct_40_64, pct_65plus
"""

from __future__ import annotations

import csv
import json
from collections import defaultdict
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
POP_CSV = BASE / "data" / "raw" / "respopagesex2025.csv"
CHART1 = BASE / "data" / "area_chart1_400m.json"
CHART2 = BASE / "data" / "area_chart2_400m.json"
OUT = BASE / "data" / "rq3_age_hdb.json"


def main() -> None:
    # Load area chart data
    chart1 = json.load(open(CHART1))
    chart2 = json.load(open(CHART2))

    hdb_by_name = {a["name"]: a for a in chart1["areas"]}
    yr_by_name = {a["name"]: a["year_mean"] for a in chart2}

    # Load population by planning area & age
    pa_ages: dict[str, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    with open(POP_CSV) as f:
        for row in csv.DictReader(f):
            pa_raw = row["PA"].strip()
            try:
                age_n = 90 if row["Age"] == "90_and_Over" else int(row["Age"])
                pop_n = int(row["Pop"])
            except ValueError:
                continue
            pa_ages[pa_raw.upper()][age_n] += pop_n

    def bucket(pa_upper: str, lo: int, hi: int) -> int:
        return sum(v for k, v in pa_ages.get(pa_upper, {}).items() if lo <= k <= hi)

    def total(pa_upper: str) -> int:
        return sum(pa_ages.get(pa_upper, {}).values())

    rows = []
    for pa, hdb in hdb_by_name.items():
        year_mean = yr_by_name.get(pa)
        if year_mean is None:
            continue
        if hdb["n_hdb_400m"] < 5 or hdb["lw_length_m"] <= 0:
            continue
        pa_key = pa.upper()
        tot = total(pa_key)
        if tot == 0:
            continue
        n_0_9 = bucket(pa_key, 0, 9)
        n_10_19 = bucket(pa_key, 10, 19)
        n_20_39 = bucket(pa_key, 20, 39)
        n_40_64 = bucket(pa_key, 40, 64)
        n_65plus = bucket(pa_key, 65, 120)
        rows.append({
            "name": pa,
            "year_mean": year_mean,
            "n_hdb_400m": hdb["n_hdb_400m"],
            "n_stations": hdb.get("n_stations", 0),
            "lw_length_m": hdb["lw_length_m"],
            "lw_per_hdb": round(hdb["lw_length_m"] / hdb["n_hdb_400m"], 1),
            "total_pop": tot,
            "n_0_9": n_0_9,
            "n_10_19": n_10_19,
            "n_20_39": n_20_39,
            "n_40_64": n_40_64,
            "n_65plus": n_65plus,
            "pct_0_9": round(n_0_9 / tot, 4),
            "pct_10_19": round(n_10_19 / tot, 4),
            "pct_20_39": round(n_20_39 / tot, 4),
            "pct_40_64": round(n_40_64 / tot, 4),
            "pct_65plus": round(n_65plus / tot, 4),
        })

    rows.sort(key=lambda r: r["year_mean"])

    OUT.write_text(json.dumps(rows, indent=2))
    print(f"Wrote {OUT} — {len(rows)} areas")
    print(f"{'Area':<22} {'YrMean':>7} {'HDB':>5} {'LW(m)':>7} "
          f"{'LW/HDB':>7} {'0-9%':>6} {'20-39%':>7} {'65+%':>6}")
    print("-" * 80)
    for r in rows:
        print(f"{r['name']:<22} {r['year_mean']:>7.1f} {r['n_hdb_400m']:>5} "
              f"{r['lw_length_m']:>7.0f} {r['lw_per_hdb']:>7.1f} "
              f"{r['pct_0_9']*100:>5.1f}% {r['pct_20_39']*100:>6.1f}% "
              f"{r['pct_65plus']*100:>5.1f}%")


if __name__ == "__main__":
    main()
