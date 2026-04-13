"""
Generate data/area_chart1_400m.json for Q2 Chart 1.

Each record is one planning area with:
  - name
  - n_stations          — count of MRT/LRT stations inside that area
  - n_hdb_400m          — count of RESIDENTIAL HDB blocks whose centroid is
                          within 400m of any station in that area
  - lw_length_m         — total estimated centerline length of all covered
                          linkway polygons whose representative point is
                          within 400m of any station in that area
  - n_lw_400m           — polygon feature count (kept for reference)
  - correlation field notes the area-level Pearson r for reference.

This is the data source for RQ2 Chart 1 (scatter: HDB vs linkway length).
"""

from __future__ import annotations

import csv
import json
import warnings
from pathlib import Path

import geopandas as gpd
import math
import numpy as np
from shapely.geometry import Point
from shapely.ops import unary_union


def centerline_length(geom) -> float:
    """Estimate the centerline length of a narrow rectangular polygon.

    For a rectangle L*W: perimeter = 2L+2W, area = L*W →
    L = (perimeter + sqrt(perimeter^2 - 16*area)) / 4.
    Falls back to sqrt(area) when the discriminant is negative.
    """
    if geom.is_empty:
        return 0.0
    if geom.geom_type == "MultiPolygon":
        return float(sum(centerline_length(p) for p in geom.geoms))
    p = geom.length
    a = geom.area
    disc = p ** 2 - 16 * a
    if disc < 0:
        return float(np.sqrt(a))
    return float((p + np.sqrt(disc)) / 4)

warnings.filterwarnings("ignore")

BASE = Path(__file__).resolve().parent.parent
HDB_JSON = BASE / "data" / "hdb_buildings.json"
HDB_CSV = BASE / "data" / "raw" / "HDBPropertyInformation.csv"
STATIONS_JSON = BASE / "data" / "stations.json"
POLYS = BASE / "data" / "raw" / "planning_area_boundaries.geojson"
LINKWAY_SHP = (
    BASE
    / "dataset"
    / "2026"
    / "03"
    / "Static_ 2026_03"
    / "GEOSPATIAL"
    / "CoveredLinkWay_Mar2026"
    / "CoveredLinkWay_Mar2026"
    / "CoveredLinkWay.shp"
)
OUT = BASE / "data" / "area_chart1_400m.json"

CRS = "EPSG:3414"
STATION_BUFFER = 400


def load_residential_keys() -> set[tuple[str, str]]:
    keys: set[tuple[str, str]] = set()
    with open(HDB_CSV) as f:
        for r in csv.DictReader(f):
            if r.get("residential", "").upper() == "Y":
                keys.add(
                    (r["bldg_contract_town"].strip(), r["blk_no"].strip())
                )
    return keys


def pearson(xs, ys) -> float:
    n = len(xs)
    if n < 2:
        return 0.0
    mx = sum(xs) / n
    my = sum(ys) / n
    num = sum((xs[i] - mx) * (ys[i] - my) for i in range(n))
    dx2 = sum((xs[i] - mx) ** 2 for i in range(n))
    dy2 = sum((ys[i] - my) ** 2 for i in range(n))
    if dx2 == 0 or dy2 == 0:
        return 0.0
    return num / math.sqrt(dx2 * dy2)


def main() -> None:
    # Residential HDB
    residential = load_residential_keys()
    print(f"Residential keys: {len(residential):,}")
    hdb_all = json.load(open(HDB_JSON))
    hdb = [
        b
        for b in hdb_all
        if b.get("year_completed") is not None
        and b.get("town_code")
        and (b["town_code"], b["blk_no"]) in residential
    ]
    print(f"Residential HDB blocks: {len(hdb):,}")

    hdb_gdf = gpd.GeoDataFrame(
        [{"pa": b["planning_area"]} for b in hdb],
        geometry=[Point(b["lng"], b["lat"]) for b in hdb],
        crs="EPSG:4326",
    ).to_crs(CRS)

    # Planning polygons
    polys = gpd.read_file(POLYS).to_crs(CRS)

    # Stations — exclude depots, classify by planning area it lies inside
    stations = [
        s
        for s in json.load(open(STATIONS_JSON))
        if "DEPOT" not in s["station"]
    ]
    sta_gdf = gpd.GeoDataFrame(
        [{"name": s["station"]} for s in stations],
        geometry=[Point(s["lng"], s["lat"]) for s in stations],
        crs="EPSG:4326",
    ).to_crs(CRS)
    sta_joined = gpd.sjoin(
        sta_gdf, polys[["PLN_AREA_N", "geometry"]], how="left", predicate="within"
    )

    # Linkway — precompute centerline length for each polygon
    lw = gpd.read_file(LINKWAY_SHP).to_crs(CRS)
    lw["cline_m"] = lw.geometry.apply(centerline_length)
    lw_rp = lw.geometry.representative_point()

    # Index planning-area polygons by name for clipping
    pa_poly = dict(zip(polys["PLN_AREA_N"], polys.geometry))

    rows = []
    for pa_name, group in sta_joined.groupby("PLN_AREA_N"):
        sta_in_area = group[group["name"].notna()]
        if len(sta_in_area) == 0:
            continue
        buf = unary_union([g.buffer(STATION_BUFFER) for g in sta_in_area.geometry])
        # Clip buffer to planning area boundary to avoid counting
        # linkways from neighbouring areas
        if pa_name in pa_poly:
            buf = buf.intersection(pa_poly[pa_name])
        n_hdb = int(hdb_gdf.geometry.within(buf).sum())
        in_buf = lw_rp.within(buf)
        n_lw = int(in_buf.sum())
        lw_len = float(lw.loc[in_buf, "cline_m"].sum())
        rows.append(
            {
                "name": pa_name,
                "n_stations": int(len(sta_in_area)),
                "n_hdb_400m": n_hdb,
                "n_lw_400m": n_lw,
                "lw_length_m": round(lw_len, 1),
            }
        )

    rows.sort(key=lambda r: -r["n_hdb_400m"])

    # Pearson on areas with meaningful HDB presence (>= 5) — same filter as current q2.js
    filt = [r for r in rows if r["n_hdb_400m"] >= 5 and r["lw_length_m"] > 0]
    xs = [r["n_hdb_400m"] for r in filt]
    ys = [r["lw_length_m"] for r in filt]
    r_val = pearson(xs, ys)

    out = {
        "areas": rows,
        "pearson_r": round(r_val, 4),
        "n_areas_filtered": len(filt),
        "filter": "n_hdb_400m >= 5 and lw_length_m > 0",
    }
    OUT.write_text(json.dumps(out, indent=2))
    print(f"\nWrote {OUT}")
    print(f"r(HDB_400m vs lw_length_m) = {r_val:+.4f} over {len(filt)} areas")
    print()
    print(
        f"{'Area':<22} {'HDB_400m':>9} {'LW_len_m':>10} "
        f"{'LW_count':>9} {'Stations':>9}"
    )
    print("-" * 65)
    for r in rows:
        print(
            f"{r['name']:<22} {r['n_hdb_400m']:>9} {r['lw_length_m']:>10.0f} "
            f"{r['n_lw_400m']:>9} {r['n_stations']:>9}"
        )


if __name__ == "__main__":
    main()
