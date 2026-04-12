"""
Generate rq3_planning_areas.json for RQ3 visualization.

For each planning area: shelter ratio (from LTA infrastructure shapefiles),
elderly/children/vulnerable population ratios (from Census 2020), and centroid
coordinates (from planning area boundary polygons).

Usage:
    uv run --with geopandas,pyogrio,numpy,pandas,shapely scripts/gen_rq3.py
"""

from __future__ import annotations

import json
import logging
import re
import warnings
from pathlib import Path
from typing import Any

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.ops import unary_union
from shapely.strtree import STRtree

warnings.filterwarnings("ignore")
logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger(__name__)

# ── paths ────────────────────────────────────────────────────────────────
BASE = Path(__file__).resolve().parent.parent
DATASET_GEO = BASE / "dataset" / "2026" / "03" / "Static_ 2026_03" / "GEOSPATIAL"
CENSUS_CSV = BASE / "data" / "raw" / "census2020_planning_area_age.csv"
PLANNING_AREA = BASE / "data" / "raw" / "planning_area_boundaries.geojson"
OUTPUT = BASE / "data" / "rq3_planning_areas.json"

CRS_WGS = "EPSG:4326"
CRS_SVY = "EPSG:3414"
LINKWAY_BUFFER = 3  # metres – misalignment tolerance
MIN_POPULATION = 1000


# ── load helpers ─────────────────────────────────────────────────────────
def _load_shp(name: str) -> gpd.GeoDataFrame:
    """Load a shapefile from the LTA GEOSPATIAL folder by prefix name."""
    matches = list(DATASET_GEO.glob(f"{name}*"))
    if not matches:
        matches = list(DATASET_GEO.glob(f"**/{name}*"))
    folders = [m for m in matches if m.is_dir()]
    if not folders:
        raise FileNotFoundError(f"No folder matching '{name}' in {DATASET_GEO}")
    shp = list(folders[0].rglob("*.shp"))[0]
    try:
        gdf = gpd.read_file(shp, engine="pyogrio")
    except Exception:
        gdf = gpd.read_file(shp, engine="fiona")
    gdf = gdf[gdf.geometry.notna()].copy()
    gdf["geometry"] = gdf["geometry"].make_valid()
    return gdf.to_crs(CRS_SVY)


def _poly_length(geom: Any) -> float:
    """Estimate centerline length of a narrow polygon (walkway/bridge).

    For a rectangle L*W: perimeter = 2L+2W, area = L*W.
    Solve for L: L = (perimeter + sqrt(perimeter^2 - 16*area)) / 4.
    """
    if geom.is_empty:
        return 0.0
    if geom.geom_type == "MultiPolygon":
        return sum(_poly_length(p) for p in geom.geoms)
    perim = geom.length
    area = geom.area
    disc = perim**2 - 16 * area
    if disc < 0:
        return np.sqrt(area)
    return (perim + np.sqrt(disc)) / 4


# ── census loading ───────────────────────────────────────────────────────
CHILDREN_COLS = ["Total_0_4", "Total_5_9", "Total_10_14"]
ELDERLY_COLS = [
    "Total_65_69",
    "Total_70_74",
    "Total_75_79",
    "Total_80_84",
    "Total_85_89",
    "Total_90andOver",
]


def _parse_int(val: Any) -> int:
    """Parse a census cell: '-' or empty → 0, otherwise int."""
    if pd.isna(val):
        return 0
    s = str(val).strip().replace(",", "")
    if s in ("-", ""):
        return 0
    return int(s)


def load_census() -> dict[str, dict[str, Any]]:
    """Load Census 2020 planning area age data.

    Returns mapping: UPPER_NAME -> {total_population, elderly_count, children_count}.
    """
    df = pd.read_csv(CENSUS_CSV, dtype=str)

    # Keep only rows matching "XXX - Total" (planning area totals)
    mask = df["Number"].str.strip().str.endswith("- Total")
    df = df[mask].copy()

    # Skip the first row which is the national "Total" line
    # (already filtered out because it's just "Total", not "XXX - Total")

    result: dict[str, dict[str, Any]] = {}
    for _, row in df.iterrows():
        raw_name = str(row["Number"]).strip()
        # "Ang Mo Kio - Total" -> "ANG MO KIO"
        name = re.sub(r"\s*-\s*Total$", "", raw_name).strip().upper()

        total_pop = _parse_int(row["Total_Total"])
        if total_pop < MIN_POPULATION:
            continue

        children = sum(_parse_int(row[c]) for c in CHILDREN_COLS)
        elderly = sum(_parse_int(row[c]) for c in ELDERLY_COLS)

        result[name] = {
            "total_population": total_pop,
            "elderly_count": elderly,
            "children_count": children,
        }

    return result


# ── shelter ratio per planning area ──────────────────────────────────────
def compute_pa_shelter_ratio(
    pa_geom: Any,
    fp_geoms: np.ndarray,
    cl_geoms: np.ndarray,
    br_geoms: np.ndarray,
    fp_sindex: STRtree,
    cl_sindex: STRtree,
    br_sindex: STRtree,
) -> float:
    """Compute shelter ratio for one planning area polygon.

    1. Clip footpath lines to boundary -> footpath_length
    2. Clip covered linkway to boundary, union, buffer 3m, intersect footpath
       -> covered_footpath_length
    3. Bridge centerline length added to both numerator and denominator
    4. ratio = (covered_footpath + bridge) / (footpath + bridge)
    """
    # Footpath
    fp_candidates = fp_sindex.query(pa_geom)
    if len(fp_candidates) == 0:
        return 0.0

    fp_clipped_parts: list[Any] = []
    for idx in fp_candidates:
        inter = fp_geoms[idx].intersection(pa_geom)
        if not inter.is_empty:
            fp_clipped_parts.append(inter)
    if not fp_clipped_parts:
        return 0.0

    fp_len = sum(g.length for g in fp_clipped_parts)
    if fp_len == 0:
        return 0.0

    # Covered footpath = footpath segments under covered linkway
    covered_fp = 0.0
    cl_candidates = cl_sindex.query(pa_geom)
    if len(cl_candidates) > 0:
        cl_parts: list[Any] = []
        for idx in cl_candidates:
            inter = cl_geoms[idx].intersection(pa_geom)
            if not inter.is_empty:
                cl_parts.append(inter)
        if cl_parts:
            cl_union = unary_union(cl_parts)
            cl_zone = cl_union.buffer(LINKWAY_BUFFER)
            for fp_part in fp_clipped_parts:
                inter = fp_part.intersection(cl_zone)
                if not inter.is_empty:
                    covered_fp += inter.length
    covered_fp = min(covered_fp, fp_len)

    # Bridge centerline length
    bridge_len = 0.0
    br_candidates = br_sindex.query(pa_geom)
    if len(br_candidates) > 0:
        for idx in br_candidates:
            inter = br_geoms[idx].intersection(pa_geom)
            if not inter.is_empty:
                if inter.geom_type in ("Polygon", "MultiPolygon"):
                    bridge_len += _poly_length(inter)
                else:
                    bridge_len += inter.length

    total = fp_len + bridge_len
    covered = covered_fp + bridge_len
    if total == 0:
        return 0.0
    return round(covered / total, 4)


# ── main ─────────────────────────────────────────────────────────────────
def main() -> None:
    log.info("=== Loading Census 2020 data ===")
    census = load_census()
    log.info("  Planning areas with pop >= %d: %d", MIN_POPULATION, len(census))

    log.info("\n=== Loading planning area boundaries ===")
    pa_gdf = gpd.read_file(PLANNING_AREA, engine="pyogrio")
    pa_gdf = pa_gdf[pa_gdf.geometry.notna()].copy()
    pa_svy = pa_gdf.to_crs(CRS_SVY)
    pa_wgs = pa_gdf.to_crs(CRS_WGS)
    log.info("  Boundary polygons: %d", len(pa_gdf))

    log.info("\n=== Loading infrastructure layers ===")
    fp = _load_shp("Footpath")
    log.info("  Footpath: %d features", len(fp))
    cl = _load_shp("CoveredLinkWay")
    log.info("  CoveredLinkWay: %d features", len(cl))
    br = _load_shp("PedestrainOverheadbridge")
    log.info("  PedestrainOverheadbridge: %d features", len(br))

    log.info("\nBuilding spatial indices ...")
    fp_geoms = fp.geometry.values
    cl_geoms = cl.geometry.values
    br_geoms = br.geometry.values
    fp_sindex = STRtree(fp_geoms)
    cl_sindex = STRtree(cl_geoms)
    br_sindex = STRtree(br_geoms)

    log.info("\n=== Computing per-planning-area metrics ===")
    records: list[dict[str, Any]] = []
    n = len(pa_svy)

    for i, (idx_svy, row_svy) in enumerate(pa_svy.iterrows()):
        pa_name: str = row_svy["PLN_AREA_N"]

        # Skip areas not in census (uninhabited / too small)
        if pa_name not in census:
            log.info("  [%d/%d] %s — skipped (not in census)", i + 1, n, pa_name)
            continue

        pop_data = census[pa_name]
        total_pop = pop_data["total_population"]
        elderly = pop_data["elderly_count"]
        children = pop_data["children_count"]
        vulnerable = elderly + children

        # Shelter ratio
        pa_geom_svy = row_svy.geometry
        shelter_ratio = compute_pa_shelter_ratio(
            pa_geom_svy,
            fp_geoms,
            cl_geoms,
            br_geoms,
            fp_sindex,
            cl_sindex,
            br_sindex,
        )

        # Centroid in WGS84
        row_wgs = pa_wgs.loc[idx_svy]
        centroid_wgs = row_wgs.geometry.centroid

        records.append(
            {
                "name": pa_name,
                "total_population": total_pop,
                "elderly_count": elderly,
                "children_count": children,
                "elderly_ratio": round(elderly / total_pop, 3),
                "children_ratio": round(children / total_pop, 3),
                "vulnerable_ratio": round(vulnerable / total_pop, 3),
                "shelter_ratio": shelter_ratio,
                "centroid_lat": round(centroid_wgs.y, 5),
                "centroid_lng": round(centroid_wgs.x, 5),
            }
        )

        log.info(
            "  [%d/%d] %s — pop=%d, shelter=%.3f, vuln=%.3f",
            i + 1,
            n,
            pa_name,
            total_pop,
            shelter_ratio,
            round(vulnerable / total_pop, 3),
        )

    # Sort by name for stable output
    records.sort(key=lambda r: r["name"])

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT, "w") as f:
        json.dump(records, f, indent=2, ensure_ascii=False)

    log.info("\n=== Done ===")
    log.info("Output: %s", OUTPUT)
    log.info("Total planning areas: %d", len(records))


if __name__ == "__main__":
    main()
