"""
Generate aggregated analysis data for the RQ1-RQ2-RQ3 narrative.

Outputs data/analysis.json with:
- station_correlation: per-station values used in RQ1 correlation chart
- correlations: pre-computed Pearson correlation coefficients
- area_stats: per-planning-area aggregation for RQ2/RQ3
"""

import csv
import json
import math
from collections import defaultdict
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
STATIONS = BASE / "data" / "stations.json"
DETAILS = BASE / "data" / "details.json"
AREAS = BASE / "data" / "rq3_planning_areas.json"
HDB_CSV = BASE / "data" / "raw" / "HDBPropertyInformation.csv"
HDB_BUILDINGS = BASE / "data" / "hdb_buildings.json"
OUT = BASE / "data" / "analysis.json"

STATION_BUFFER_M = 400


# HDB official town codes (bldg_contract_town) → Planning Area name (upper)
TOWN_CODE_TO_PA = {
    "AMK": "ANG MO KIO",     "BB": "BUKIT BATOK",    "BD": "BEDOK",
    "BH": "BISHAN",          "BM": "BUKIT MERAH",    "BP": "BUKIT PANJANG",
    "BT": "BUKIT TIMAH",     "CCK": "CHOA CHU KANG", "CL": "CLEMENTI",
    "CT": "DOWNTOWN CORE",   "GL": "GEYLANG",        "HG": "HOUGANG",
    "JE": "JURONG EAST",     "JW": "JURONG WEST",    "KWN": "KALLANG",
    "MP": "MARINE PARADE",   "PG": "PUNGGOL",        "PRC": "PASIR RIS",
    "QT": "QUEENSTOWN",      "SB": "SEMBAWANG",      "SGN": "SERANGOON",
    "SK": "SENGKANG",        "TAP": "TAMPINES",      "TG": "TENGAH",
    "TP": "TOA PAYOH",       "WL": "WOODLANDS",      "YS": "YISHUN",
}


def load_hdb_stats() -> dict[str, dict]:
    """Parse HDB CSV → per-planning-area construction statistics.

    Returns: {planning_area_upper: {
        'n_blocks': int,
        'n_units': int,            # total dwelling units (better weighting)
        'year_min': int,           # earliest block = when area was established
        'year_median': int,        # median year (unit-weighted)
        'pct_pre1990': float,      # fraction of units built before 1990
        'pct_post2010': float,     # fraction of units built 2010+
        'year_weighted_mean': float,
    }}
    """
    by_pa: dict[str, list[tuple[int, int]]] = defaultdict(list)  # (year, units)
    with open(HDB_CSV) as f:
        reader = csv.DictReader(f)
        for row in reader:
            code = row.get("bldg_contract_town", "").strip()
            pa = TOWN_CODE_TO_PA.get(code)
            if not pa:
                continue
            try:
                year = int(row["year_completed"])
                units = int(row.get("total_dwelling_units", 0) or 0)
            except ValueError:
                continue
            # Residential only — skip pure commercial/carpark blocks
            if row.get("residential", "").upper() != "Y":
                continue
            by_pa[pa].append((year, units))

    stats: dict[str, dict] = {}
    for pa, lst in by_pa.items():
        if not lst:
            continue
        years = [y for y, _ in lst]
        total_units = sum(u for _, u in lst) or len(lst)

        # Unit-weighted median: flatten years by unit count
        # (approximation: sort by year, walk until cumulative units = total/2)
        lst_sorted = sorted(lst, key=lambda x: x[0])
        cum = 0
        med_year = lst_sorted[0][0]
        half = total_units / 2
        for y, u in lst_sorted:
            cum += u
            if cum >= half:
                med_year = y
                break

        # Weighted mean
        w_sum = sum(y * (u or 1) for y, u in lst)
        w_div = sum((u or 1) for _, u in lst)
        w_mean = w_sum / w_div if w_div else 0

        # Pre-1990 / post-2010 unit shares
        pre1990_units = sum(u for y, u in lst if y < 1990)
        post2010_units = sum(u for y, u in lst if y >= 2010)
        tot = sum(u for _, u in lst) or 1

        stats[pa] = {
            "n_blocks": len(lst),
            "n_units": total_units,
            "year_min": min(years),
            "year_median": med_year,
            "year_weighted_mean": round(w_mean, 1),
            "pct_pre1990": round(pre1990_units / tot, 3),
            "pct_post2010": round(post2010_units / tot, 3),
        }
    return stats


def load_hdb_buildings() -> list[dict]:
    """Load hdb_buildings.json (13k blocks with year_completed + lat/lng)."""
    with open(HDB_BUILDINGS) as f:
        return json.load(f)


def station_hdb_stats(stn_lat: float, stn_lng: float,
                      hdb_buildings: list[dict],
                      radius_m: float = STATION_BUFFER_M) -> dict:
    """For one station, compute HDB statistics in the 400m buffer.

    Returns: {n_hdb, median_year, min_year, pct_pre1990, pct_post2010}.
    Uses flat-earth approximation (fine at Singapore scale).
    """
    cos_lat = math.cos(math.radians(stn_lat))
    # Rough lat/lng bounding box to pre-filter before precise distance
    deg_lat = radius_m / 111320
    deg_lng = radius_m / (111320 * cos_lat)
    lat_lo, lat_hi = stn_lat - deg_lat, stn_lat + deg_lat
    lng_lo, lng_hi = stn_lng - deg_lng, stn_lng + deg_lng
    r_sq = radius_m * radius_m

    years: list[int] = []
    n = 0
    for h in hdb_buildings:
        if h["lat"] < lat_lo or h["lat"] > lat_hi:
            continue
        if h["lng"] < lng_lo or h["lng"] > lng_hi:
            continue
        dx = (h["lng"] - stn_lng) * 111320 * cos_lat
        dy = (h["lat"] - stn_lat) * 111320
        if dx * dx + dy * dy > r_sq:
            continue
        n += 1
        if h.get("year_completed"):
            years.append(h["year_completed"])

    if not years:
        return {
            "n_hdb_real": n,
            "hdb_median_year": None,
            "hdb_min_year": None,
            "hdb_pct_pre1990": None,
            "hdb_pct_post2010": None,
        }
    years.sort()
    median_year = years[len(years) // 2]
    pre1990 = sum(1 for y in years if y < 1990)
    post2010 = sum(1 for y in years if y >= 2010)
    return {
        "n_hdb_real": n,
        "hdb_median_year": median_year,
        "hdb_min_year": years[0],
        "hdb_pct_pre1990": round(pre1990 / len(years), 3),
        "hdb_pct_post2010": round(post2010 / len(years), 3),
    }


def pearson(x: list[float], y: list[float]) -> float:
    n = len(x)
    if n < 2:
        return 0.0
    mx = sum(x) / n
    my = sum(y) / n
    cov = sum((a - mx) * (b - my) for a, b in zip(x, y))
    sx = math.sqrt(sum((a - mx) ** 2 for a in x))
    sy = math.sqrt(sum((b - my) ** 2 for b in y))
    if sx == 0 or sy == 0:
        return 0.0
    return cov / (sx * sy)


def find_area(lat: float, lng: float, areas: list[dict]) -> str | None:
    best, best_d = None, float("inf")
    for a in areas:
        if a.get("centroid_lat") is None or a.get("centroid_lng") is None:
            continue
        d = (lat - a["centroid_lat"]) ** 2 + (lng - a["centroid_lng"]) ** 2
        if d < best_d:
            best_d, best = d, a["name"]
    return best


def main():
    stations = json.load(open(STATIONS))
    details = json.load(open(DETAILS))
    areas = json.load(open(AREAS))
    area_map = {a["name"]: a for a in areas}
    hdb_stats = load_hdb_stats()
    print(f"Loaded HDB stats for {len(hdb_stats)} planning areas")

    hdb_buildings = load_hdb_buildings()
    print(f"Loaded {len(hdb_buildings)} HDB blocks for station-level lookup")

    # ── Station-level data for RQ1 correlation ──
    station_data = []
    for s in stations:
        det = details.get(s["station"], {})
        pois = det.get("pois", {})
        geo = det.get("geometry", {})
        hdb_info = station_hdb_stats(s["lat"], s["lng"], hdb_buildings)
        station_data.append({
            "station": s["station"],
            "shelter_ratio": s["shelter_ratio"],
            "passenger_volume": s["passenger_volume"],
            "rainfall_mm": s["rainfall_mm"],
            # Legacy counts from sampled POI set
            "n_hdb": len(pois.get("hdb", [])),
            "n_commercial": len(pois.get("commercial", [])),
            "n_schools": len(pois.get("schools", [])),
            "n_healthcare": len(pois.get("healthcare", [])),
            "n_linkways": len(geo.get("covered_linkways", [])),
            "n_footpaths": len(geo.get("footpaths", [])),
            # Real HDB age stats from full 13k register
            "n_hdb_real":       hdb_info["n_hdb_real"],
            "hdb_median_year":  hdb_info["hdb_median_year"],
            "hdb_min_year":     hdb_info["hdb_min_year"],
            "hdb_pct_pre1990":  hdb_info["hdb_pct_pre1990"],
            "hdb_pct_post2010": hdb_info["hdb_pct_post2010"],
        })

    # Compute correlations for RQ1 chart (station level).
    # Only factors that describe "what is around this station" — not HDB age,
    # which is RQ2's concern.
    sr = [s["shelter_ratio"] for s in station_data]
    factors = [
        ("HDB Count",        [s["n_hdb_real"]       for s in station_data]),
        ("Rainfall",         [s["rainfall_mm"]      for s in station_data]),
        ("Ridership",        [s["passenger_volume"] for s in station_data]),
        ("Healthcare Count", [s["n_healthcare"]     for s in station_data]),
        ("School Count",     [s["n_schools"]        for s in station_data]),
        ("Commercial Count", [s["n_commercial"]     for s in station_data]),
    ]
    correlations = [{"factor": name, "r": round(pearson(sr, vals), 3)}
                    for name, vals in factors]
    correlations.sort(key=lambda x: x["r"], reverse=True)

    # ── Area-level aggregation for RQ2/RQ3 ──
    area_stats = {}
    for a in areas:
        name = a["name"]
        hdb = hdb_stats.get(name, {})
        area_stats[name] = {
            "name": name,
            # HDB construction stats from real data
            "hdb_year_min": hdb.get("year_min"),
            "hdb_year_median": hdb.get("year_median"),
            "hdb_year_weighted_mean": hdb.get("year_weighted_mean"),
            "hdb_pct_pre1990": hdb.get("pct_pre1990", 0),
            "hdb_pct_post2010": hdb.get("pct_post2010", 0),
            "hdb_n_blocks": hdb.get("n_blocks", 0),
            "hdb_n_units": hdb.get("n_units", 0),
            # Backward-compat: approximate era from median (rounded down to decade)
            "era": (hdb.get("year_median") // 10 * 10) if hdb.get("year_median") else None,
            "total_population": a["total_population"],
            "elderly_ratio": a["elderly_ratio"],
            "elderly_75plus_ratio": a["elderly_75plus_ratio"],
            "children_ratio": a["children_ratio"],
            "elderly_count": a["elderly_count"],
            "shelter_ratio": a.get("shelter_ratio", 0),
            "centroid_lat": a.get("centroid_lat"),
            "centroid_lng": a.get("centroid_lng"),
            "n_hdb": 0,
            "n_stations": 0,
            "linkway_pre2020": 0,
            "linkway_2020_2022": 0,
            "linkway_2023_plus": 0,
            "linkway_unknown": 0,
            "linkway_total": 0,
        }

    # Walk stations, assign their nearby HDB and linkways to their planning area
    for s in stations:
        area = find_area(s["lat"], s["lng"], areas)
        if area not in area_stats:
            continue
        stat = area_stats[area]
        stat["n_stations"] += 1
        det = details.get(s["station"], {})
        pois = det.get("pois", {})
        geo = det.get("geometry", {})
        stat["n_hdb"] += len(pois.get("hdb", []))

        for m in geo.get("covered_linkways_meta", []):
            fs = m.get("first_seen", "Unknown")
            stat["linkway_total"] += 1
            if fs == "Unknown":
                stat["linkway_unknown"] += 1
            elif fs <= "2020-01":
                stat["linkway_pre2020"] += 1
            elif fs <= "2022-12":
                stat["linkway_2020_2022"] += 1
            else:
                stat["linkway_2023_plus"] += 1

    # Compute shelter correlation at area level
    area_list = [a for a in area_stats.values() if a["n_stations"] > 0 and a["total_population"] > 1000]

    # Correlations at area level (for RQ3) — only areas with HDB data
    area_list_hdb = [a for a in area_list if a.get("hdb_year_median")]
    elderly_ratios = [a["elderly_ratio"] for a in area_list_hdb]
    elderly_75 = [a["elderly_75plus_ratio"] for a in area_list_hdb]
    post_2020 = [a["linkway_2020_2022"] + a["linkway_2023_plus"] for a in area_list_hdb]
    post_2023 = [a["linkway_2023_plus"] for a in area_list_hdb]
    children = [a["children_ratio"] for a in area_list_hdb]
    hdb_median_year = [a["hdb_year_median"] for a in area_list_hdb]
    hdb_pct_pre1990 = [a["hdb_pct_pre1990"] for a in area_list_hdb]

    area_corr = [
        {"factor": "HDB median year vs Elderly ratio",
         "r": round(pearson(hdb_median_year, elderly_ratios), 3)},
        {"factor": "HDB % pre-1990 vs Elderly ratio",
         "r": round(pearson(hdb_pct_pre1990, elderly_ratios), 3)},
        {"factor": "HDB median year vs Post-2020 Linkways",
         "r": round(pearson(hdb_median_year, post_2020), 3)},
        {"factor": "Elderly Ratio vs Post-2020 Linkways",
         "r": round(pearson(elderly_ratios, post_2020), 3)},
        {"factor": "Elderly 75+ vs Post-2020 Linkways",
         "r": round(pearson(elderly_75, post_2020), 3)},
        {"factor": "Children Ratio vs Post-2020 Linkways",
         "r": round(pearson(children, post_2020), 3)},
    ]

    out = {
        "stations": station_data,
        "rq1_correlations": correlations,
        "area_stats": area_list,
        "rq3_area_correlations": area_corr,
    }

    with open(OUT, "w") as f:
        json.dump(out, f, indent=2)

    print(f"Wrote analysis data: {OUT}")
    print(f"  Stations: {len(station_data)}")
    print(f"  Areas: {len(area_list)}")
    print("\nRQ1 correlations (shelter vs factors):")
    for c in correlations:
        print(f"  {c['factor']:<20} r = {c['r']:+.3f}")
    print("\nRQ3 area-level correlations:")
    for c in area_corr:
        print(f"  {c['factor']:<44} r = {c['r']:+.3f}")

    print("\nHDB construction (top 10 areas by block count):")
    top_by_hdb = sorted([a for a in area_list if a.get("hdb_n_blocks")],
                        key=lambda a: a["hdb_n_blocks"], reverse=True)[:10]
    print(f"  {'Area':<17} {'Blocks':>7} {'MinYr':>6} {'Median':>7} {'pre90%':>7} "
          f"{'post10%':>8} {'Elder%':>7} {'Post20LW':>9}")
    for a in top_by_hdb:
        post = a["linkway_2020_2022"] + a["linkway_2023_plus"]
        print(f"  {a['name']:<17} {a['hdb_n_blocks']:>7} {a['hdb_year_min']:>6} "
              f"{a['hdb_year_median']:>7} {a['hdb_pct_pre1990']*100:>6.0f}% "
              f"{a['hdb_pct_post2010']*100:>7.0f}% {a['elderly_ratio']*100:>6.1f}% "
              f"{post:>9}")


if __name__ == "__main__":
    main()
