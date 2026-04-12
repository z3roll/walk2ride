"""
Compute shelter_ratio for every RESIDENTIAL HDB block within 400m of an MRT/LRT
station, using the same length-based formula as RQ1/gen_services_shelter.py.

Output: data/hdb_shelter_400m.json — list of
  {blk, planning_area, year_completed, lat, lng, shelter_ratio}

This is the raw block-level data for RQ2 Chart 2 (shelter_ratio by HDB era).
"""

from __future__ import annotations

import csv
import json
import warnings
from pathlib import Path

import geopandas as gpd
import numpy as np
from shapely.geometry import Point
from shapely.ops import unary_union
from shapely.strtree import STRtree

warnings.filterwarnings("ignore")

BASE = Path(__file__).resolve().parent.parent
GEO = BASE / "dataset" / "2026" / "03" / "Static_ 2026_03" / "GEOSPATIAL"
OUT = BASE / "data" / "hdb_shelter_400m.json"

CRS = "EPSG:3414"
LINKWAY_BUFFER = 3  # metres — same as gen_services_shelter.py
RADIUS = 200        # metres — same as gen_services_shelter.py for point POIs
STATION_BUFFER = 400


def compute_shelter_ratio(buf_geom, fp_g, cl_g, br_g, fp_t, cl_t, br_t) -> float:
    fp_cand = fp_t.query(buf_geom)
    if len(fp_cand) == 0:
        return 0.0
    fp_parts = []
    for i in fp_cand:
        inter = fp_g[i].intersection(buf_geom)
        if not inter.is_empty:
            fp_parts.append(inter)
    if not fp_parts:
        return 0.0
    fp_len = sum(g.length for g in fp_parts)
    if fp_len == 0:
        return 0.0

    # Covered footpath length
    covered_fp = 0.0
    cl_cand = cl_t.query(buf_geom)
    if len(cl_cand) > 0:
        cl_parts = []
        for i in cl_cand:
            inter = cl_g[i].intersection(buf_geom)
            if not inter.is_empty:
                cl_parts.append(inter)
        if cl_parts:
            cl_zone = unary_union(cl_parts).buffer(LINKWAY_BUFFER)
            for fp_part in fp_parts:
                inter = fp_part.intersection(cl_zone)
                if not inter.is_empty:
                    covered_fp += inter.length
    covered_fp = min(covered_fp, fp_len)

    # Bridge length added to both sides
    bridge_len = 0.0
    br_cand = br_t.query(buf_geom)
    if len(br_cand) > 0:
        for i in br_cand:
            inter = br_g[i].intersection(buf_geom)
            if not inter.is_empty:
                if inter.geom_type in ("Polygon", "MultiPolygon"):
                    perim = inter.length
                    area = inter.area
                    disc = perim ** 2 - 16 * area
                    bridge_len += (
                        np.sqrt(area) if disc < 0 else (perim + np.sqrt(disc)) / 4
                    )
                else:
                    bridge_len += inter.length

    total = fp_len + bridge_len
    covered = covered_fp + bridge_len
    if total == 0:
        return 0.0
    return round(covered / total, 4)


def main():
    # Residential filter
    residential = set()
    with open(BASE / "data" / "raw" / "HDBPropertyInformation.csv") as f:
        for r in csv.DictReader(f):
            if r.get("residential", "").upper() == "Y":
                residential.add(
                    (r["bldg_contract_town"].strip(), r["blk_no"].strip())
                )
    print(f"Residential CSV keys: {len(residential):,}")

    hdb_all = json.load(open(BASE / "data" / "hdb_buildings.json"))
    hdb = [
        b for b in hdb_all
        if b.get("year_completed") is not None
        and b.get("town_code")
        and (b["town_code"], b["blk_no"]) in residential
    ]
    print(f"Residential HDB with year: {len(hdb):,}")

    hdb_gdf = gpd.GeoDataFrame(
        [{
            "blk": b["blk_no"],
            "pa": b["planning_area"],
            "year": b["year_completed"],
            "lng": b["lng"],
            "lat": b["lat"],
        } for b in hdb],
        geometry=[Point(b["lng"], b["lat"]) for b in hdb],
        crs="EPSG:4326",
    ).to_crs(CRS)

    # Station buffer
    stations = [
        s for s in json.load(open(BASE / "data" / "stations.json"))
        if "DEPOT" not in s["station"]
    ]
    sta = gpd.GeoDataFrame(
        geometry=[Point(s["lng"], s["lat"]) for s in stations],
        crs="EPSG:4326",
    ).to_crs(CRS)
    buf_union = sta.geometry.buffer(STATION_BUFFER).unary_union

    mask = hdb_gdf.geometry.within(buf_union)
    hdb_near = hdb_gdf[mask].copy().reset_index(drop=True)
    print(f"Residential HDB within 400m of MRT/LRT: {len(hdb_near):,}")

    # Load infra layers
    fp = gpd.read_file(
        GEO / "Footpath_Mar2026" / "Footpath_Mar2026" / "Footpath.shp",
        engine="pyogrio",
    ).to_crs(CRS)
    cl = gpd.read_file(
        GEO / "CoveredLinkWay_Mar2026" / "CoveredLinkWay_Mar2026" / "CoveredLinkWay.shp",
        engine="pyogrio",
    ).to_crs(CRS)
    br = gpd.read_file(
        GEO
        / "PedestrainOverheadbridge_UnderPass_Mar2026"
        / "PedestrainOverheadbridge_UnderPass_Mar2026"
        / "PedestrainOverheadbridge.shp",
        engine="pyogrio",
    ).to_crs(CRS)
    print(f"Footpath: {len(fp):,} | CoveredLinkWay: {len(cl):,} | Bridge: {len(br):,}")

    fp_g = fp.geometry.values
    cl_g = cl.geometry.values
    br_g = br.geometry.values
    fp_t = STRtree(fp_g)
    cl_t = STRtree(cl_g)
    br_t = STRtree(br_g)

    # Compute shelter_ratio per HDB block (use 200m buffer around the block centroid)
    print("\nComputing shelter_ratio per block ...")
    records = []
    n = len(hdb_near)
    for i, row in hdb_near.iterrows():
        buf = row.geometry.buffer(RADIUS)
        ratio = compute_shelter_ratio(buf, fp_g, cl_g, br_g, fp_t, cl_t, br_t)
        records.append({
            "blk": row["blk"],
            "planning_area": row["pa"],
            "year_completed": int(row["year"]),
            "lat": round(row["lat"], 6),
            "lng": round(row["lng"], 6),
            "shelter_ratio": ratio,
        })
        if (i + 1) % 200 == 0:
            print(f"  {i+1}/{n}")

    OUT.write_text(json.dumps(records, separators=(",", ":")))
    print(f"\nWrote {OUT} — {len(records)} records")


if __name__ == "__main__":
    main()
