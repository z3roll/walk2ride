"""
Join HDB Property Information (year_completed) with HDB Existing Building
(geometry), producing a GeoJSON with every block's location AND construction
year.

Join strategy:
1. Load geojson (geometry, BLK_NO, POSTAL_COD).
2. Spatial join centroids with planning area polygons → each block gets its
   planning area name.
3. Map planning area → HDB town code (reverse of TOWN_CODE_TO_PA).
4. Join CSV by (town_code, blk_no). For ambiguous (town, blk) pairs pick the
   earliest year (more conservative; these are usually sub-blocks of a
   SERS rebuild and we want to track the "community origin").
5. Save as data/hdb_buildings.geojson with year_completed + bldg_contract_town
   attached to every feature.
"""

import csv
import json
import warnings
from collections import defaultdict
from pathlib import Path

import geopandas as gpd
from shapely.geometry import Point

warnings.filterwarnings("ignore")

BASE = Path(__file__).resolve().parent.parent
HDB_GEOJSON = BASE / "dataset" / "2025.08" / "HDBExistingBuilding.geojson"
HDB_CSV = BASE / "data" / "raw" / "HDBPropertyInformation.csv"
PLANNING_POLYS = BASE / "data" / "raw" / "planning_area_boundaries.geojson"
OUT = BASE / "data" / "hdb_buildings.json"

# HDB official town codes (bldg_contract_town) → Planning Area name (upper).
# Reversed below for PA → town_code lookup.
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
PA_TO_TOWN_CODE = {v: k for k, v in TOWN_CODE_TO_PA.items()}


def load_csv_index() -> dict[tuple[str, str], dict]:
    """Build (town_code, blk_no) → row dict. For duplicates keep earliest year."""
    idx: dict[tuple[str, str], dict] = {}
    with open(HDB_CSV) as f:
        for r in csv.DictReader(f):
            try:
                year = int(r["year_completed"])
            except ValueError:
                continue
            key = (r["bldg_contract_town"].strip(), r["blk_no"].strip())
            existing = idx.get(key)
            if existing and int(existing["year_completed"]) <= year:
                continue
            idx[key] = r
    return idx


def main():
    print("Loading HDB geojson ...")
    gdf = gpd.read_file(HDB_GEOJSON).to_crs("EPSG:4326")
    print(f"  {len(gdf)} blocks")

    print("Loading planning area polygons ...")
    pa_gdf = gpd.read_file(PLANNING_POLYS).to_crs("EPSG:4326")
    pa_gdf = pa_gdf[["PLN_AREA_N", "geometry"]]

    print("Spatial joining centroids → planning area ...")
    # Use representative_point to avoid null centroids
    cent = gdf.copy()
    cent["geometry"] = cent.geometry.representative_point()
    joined = gpd.sjoin(cent, pa_gdf, how="left", predicate="within")
    # Attach planning area and town code back to original
    gdf["planning_area"] = joined["PLN_AREA_N"].values
    gdf["town_code"] = gdf["planning_area"].map(
        lambda p: PA_TO_TOWN_CODE.get(str(p).upper()) if p else None
    )

    matched_pa = gdf["planning_area"].notna().sum()
    matched_town = gdf["town_code"].notna().sum()
    print(f"  Blocks with planning area: {matched_pa}/{len(gdf)}")
    print(f"  Blocks with HDB town code: {matched_town}/{len(gdf)}")

    print("Loading CSV year_completed index ...")
    csv_idx = load_csv_index()
    print(f"  {len(csv_idx)} unique (town, blk_no) keys")

    print("Joining ...")
    years = []
    streets = []
    match_count = 0
    for _, row in gdf.iterrows():
        tc = row["town_code"]
        blk = str(row["BLK_NO"]).strip()
        rec = csv_idx.get((tc, blk)) if tc else None
        if rec:
            years.append(int(rec["year_completed"]))
            streets.append(rec["street"])
            match_count += 1
        else:
            years.append(None)
            streets.append(None)
    gdf["year_completed"] = years
    gdf["street"] = streets
    print(f"  Matched year_completed for {match_count}/{len(gdf)} blocks "
          f"({match_count/len(gdf)*100:.1f}%)")

    # Reduce to centroid representation — no polygon needed downstream.
    # Frontend and scripts only need (lng, lat, year, planning_area).
    import math
    records = []
    for _, row in gdf.iterrows():
        c = row.geometry.representative_point()
        yr = row["year_completed"]
        if yr is None or (isinstance(yr, float) and math.isnan(yr)):
            yr_out = None
        else:
            yr_out = int(yr)
        records.append({
            "blk_no": str(row["BLK_NO"]).strip(),
            "postal_code": str(row["POSTAL_COD"]).strip(),
            "planning_area": row["planning_area"] if row["planning_area"] else None,
            "town_code": row["town_code"] if row["town_code"] else None,
            "year_completed": yr_out,
            "lng": round(c.x, 6),
            "lat": round(c.y, 6),
        })

    print(f"Writing {OUT} ...")
    with open(OUT, "w") as f:
        json.dump(records, f, separators=(",", ":"))
    size_mb = OUT.stat().st_size / (1024 * 1024)
    print(f"Done. {len(records)} features, {size_mb:.2f} MB")

    # Stats
    from collections import Counter
    yr_buckets = Counter(
        (int(r["year_completed"]) // 10) * 10 if r["year_completed"] else "unknown"
        for r in records
    )
    print("\nYear distribution of matched blocks:")
    for k in sorted([x for x in yr_buckets if x != "unknown"]):
        print(f"  {k}s: {yr_buckets[k]}")
    print(f"  unknown: {yr_buckets.get('unknown', 0)}")


if __name__ == "__main__":
    main()
