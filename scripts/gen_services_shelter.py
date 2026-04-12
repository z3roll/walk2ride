"""
Generate services_shelter.json for Q2 visualization.

For each service POI (School, Healthcare, Commercial, HDB), compute the
shelter_ratio using spatial intersection of footpath lines with covered
linkway polygons, plus overhead bridge centerline estimates.

Usage:
    uv run --with geopandas,pyogrio,numpy,pandas,shapely scripts/gen_services_shelter.py
"""

from __future__ import annotations

import json
import logging
import warnings
from collections import Counter
from pathlib import Path
from typing import Any

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import MultiPolygon, Polygon
from shapely.ops import unary_union
from shapely.strtree import STRtree

warnings.filterwarnings("ignore")
logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger(__name__)

# ── paths ────────────────────────────────────────────────────────────────
BASE = Path(__file__).resolve().parent.parent
DATASET_GEO = BASE / "dataset" / "2026" / "03" / "Static_ 2026_03" / "GEOSPATIAL"
POI_DIR = BASE / "data" / "raw" / "poi"
HDB_PATH = BASE / "dataset" / "2025.08" / "HDBExistingBuilding.geojson"
PLANNING_AREA = BASE / "data" / "raw" / "planning_area_boundaries.geojson"
OUTPUT = BASE / "data" / "services_shelter.json"

CRS_WGS = "EPSG:4326"
CRS_SVY = "EPSG:3414"
RADIUS_POINT = 200  # metres for point POIs
RADIUS_POLY_EXTRA = 100  # extra buffer beyond enclosing circle for polygon POIs
LINKWAY_BUFFER = 3  # metres – slight misalignment tolerance
HDB_SAMPLE_SIZE = 2000
RANDOM_SEED = 42


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


def _load_geojson(path: Path, crs_target: str = CRS_SVY) -> gpd.GeoDataFrame:
    """Load a GeoJSON file and reproject."""
    gdf = gpd.read_file(path, engine="pyogrio")
    gdf = gdf[gdf.geometry.notna()].copy()
    return gdf.to_crs(crs_target)


# ── geometry helpers ─────────────────────────────────────────────────────
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


def _geom_length(gdf: gpd.GeoDataFrame) -> float:
    """Sum effective lengths: LineString → .length, Polygon → _poly_length."""
    total = 0.0
    for g in gdf.geometry:
        if g.geom_type in ("Polygon", "MultiPolygon"):
            total += _poly_length(g)
        else:
            total += g.length
    return total


def _extract_coords(geom: Any) -> list:
    """Recursively extract all coordinates from any geometry type."""
    if geom.is_empty:
        return []
    if geom.geom_type == "Point":
        return [geom.coords[0]]
    if geom.geom_type == "MultiPoint":
        return [p.coords[0] for p in geom.geoms]
    if geom.geom_type == "Polygon":
        return list(geom.exterior.coords)
    if geom.geom_type in ("MultiPolygon", "GeometryCollection", "MultiLineString"):
        coords: list = []
        for sub in geom.geoms:
            coords.extend(_extract_coords(sub))
        return coords
    if geom.geom_type == "LineString":
        return list(geom.coords)
    return []


def _enclosing_radius(geom: Any) -> float:
    """Return the radius of the minimum enclosing circle for a geometry."""
    centroid = geom.centroid
    if geom.geom_type == "Point":
        return 0.0
    coords = _extract_coords(geom)
    if not coords:
        return 0.0
    cx, cy = centroid.x, centroid.y
    dists = [np.sqrt((x - cx) ** 2 + (y - cy) ** 2) for x, y in coords]
    return max(dists) if dists else 0.0


# ── shelter ratio ────────────────────────────────────────────────────────
def compute_shelter_ratio(
    buf_geom: Any,
    fp: gpd.GeoDataFrame,
    cl: gpd.GeoDataFrame,
    br: gpd.GeoDataFrame,
    fp_sindex: STRtree,
    cl_sindex: STRtree,
    br_sindex: STRtree,
    fp_geoms: np.ndarray,
    cl_geoms: np.ndarray,
    br_geoms: np.ndarray,
) -> float:
    """Compute shelter ratio for a single buffer geometry.

    1. Clip footpath to buffer → footpath_length
    2. Clip covered linkway to buffer, buffer by 3m, intersect with footpath
       → covered_footpath_length
    3. Bridge centerline length added to both numerator and denominator
    4. ratio = (covered_footpath + bridge) / (footpath + bridge)
    """
    # Find candidate footpath geometries via spatial index
    fp_candidates = fp_sindex.query(buf_geom)
    if len(fp_candidates) == 0:
        return 0.0

    # Clip footpath lines to buffer
    fp_clipped_parts = []
    for idx in fp_candidates:
        g = fp_geoms[idx]
        inter = g.intersection(buf_geom)
        if not inter.is_empty:
            fp_clipped_parts.append(inter)
    if not fp_clipped_parts:
        return 0.0

    fp_len = sum(g.length for g in fp_clipped_parts)
    if fp_len == 0:
        return 0.0

    # Covered footpath = footpath segments under covered linkway
    covered_fp = 0.0
    cl_candidates = cl_sindex.query(buf_geom)
    if len(cl_candidates) > 0:
        cl_parts = []
        for idx in cl_candidates:
            g = cl_geoms[idx]
            inter = g.intersection(buf_geom)
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
    br_candidates = br_sindex.query(buf_geom)
    if len(br_candidates) > 0:
        for idx in br_candidates:
            g = br_geoms[idx]
            inter = g.intersection(buf_geom)
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


# ── POI loading ──────────────────────────────────────────────────────────
_SCHOOL_KEYWORDS = [
    "school", "academy", "institute", "institut", "university", "college",
    "polytechnic", "kindergarten", "preschool", "pre-school", "childcare",
    "child care", "nursery", "montessori", "primary", "secondary", "junior",
    "faculty", "madrasah", "seminary", "convent", "sparkletots", "skool",
    "learning centre", "learning center", "education centre", "language centre",
    "ite college", "nus ", "ntu ", "smu ", "sutd", "sit ", "sim global",
    "suss", "insead", "essec", "curtin", "mdis", "kaplan", "lasalle", "nafa",
    "shatec", "awwa", "minds", "moe ", "ministry of education",
    "dyslexia", "julia gabriel", "maple bear", "mulberry",
]
_SCHOOL_BLACKLIST = [
    "driving centre", "driving center", "dive centre", "dive company",
    "safety driving", "blk ", "block ", "admin building", "class room",
    "mortuary", "engineers", "gallery", "art zone", "art zillions",
    "french toast", "casablanca", "culinary", "studio", "hokkien huay kuan",
    "examinations", "big bubble", "brenner", "aeroviation",
]


def load_schools() -> gpd.GeoDataFrame:
    """Load schools, keep only named features that look like real schools."""
    gdf = _load_geojson(POI_DIR / "schools.geojson")
    gdf = gdf[gdf["name"].notna() & (gdf["name"] != "")].copy()

    def is_school(name: str) -> bool:
        n = name.lower()
        if any(k in n for k in _SCHOOL_BLACKLIST):
            return False
        if any(k in n for k in _SCHOOL_KEYWORDS):
            return True
        return False

    before = len(gdf)
    gdf = gdf[gdf["name"].apply(is_school)].copy()
    gdf["service_type"] = "School"
    log.info("  Schools: %d (filtered %d non-school entries)", len(gdf), before - len(gdf))
    return gdf[["name", "service_type", "geometry"]]


_HEALTH_BLACKLIST = [
    "mortuary", "first aid station", "beauty", "slimming", "spa ",
    "mary chia",
]


def load_healthcare() -> gpd.GeoDataFrame:
    """Load healthcare, exclude pharmacies and non-medical, keep only named."""
    gdf = _load_geojson(POI_DIR / "healthcare.geojson")
    gdf = gdf[gdf["amenity"] != "pharmacy"].copy()
    gdf = gdf[gdf["name"].notna() & (gdf["name"] != "")].copy()

    before = len(gdf)
    gdf = gdf[~gdf["name"].str.lower().apply(
        lambda n: any(k in n for k in _HEALTH_BLACKLIST)
    )].copy()
    gdf["service_type"] = "Healthcare"
    log.info("  Healthcare: %d (filtered %d non-medical entries)", len(gdf), before - len(gdf))
    return gdf[["name", "service_type", "geometry"]]


_COMMERCIAL_BLACKLIST = [
    "school", "kindergarten", "childcare", "clinic", "hospital",
    "church", "temple", "mosque", "synagogue",
]


def load_commercial() -> gpd.GeoDataFrame:
    """Load commercial, keep only named, remove misclassified."""
    gdf = _load_geojson(POI_DIR / "commercial.geojson")
    gdf = gdf[gdf["name"].notna() & (gdf["name"] != "")].copy()

    before = len(gdf)
    gdf = gdf[~gdf["name"].str.lower().apply(
        lambda n: any(k in n for k in _COMMERCIAL_BLACKLIST)
    )].copy()
    gdf["service_type"] = "Commercial"
    log.info("  Commercial: %d (filtered %d misclassified entries)", len(gdf), before - len(gdf))
    return gdf[["name", "service_type", "geometry"]]


def load_hdb() -> gpd.GeoDataFrame:
    """Load HDB buildings, sample 2000 randomly."""
    gdf = _load_geojson(HDB_PATH)
    rng = np.random.default_rng(RANDOM_SEED)
    indices = rng.choice(len(gdf), size=HDB_SAMPLE_SIZE, replace=False)
    gdf = gdf.iloc[indices].copy()
    gdf["name"] = "HDB " + gdf["BLK_NO"].astype(str)
    gdf["service_type"] = "HDB"
    log.info("  HDB (sampled): %d", len(gdf))
    return gdf[["name", "service_type", "geometry"]]


# ── deduplication: merge nearby POIs of same type ────────────────────────
MERGE_DISTANCE = 50  # metres

def dedup_nearby(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Merge features within MERGE_DISTANCE of each other.

    For each cluster, keep the name of the feature with the longest name
    (most descriptive) and union the geometries.
    """
    centroids = gdf.geometry.centroid
    tree = STRtree(centroids.values)
    used: set[int] = set()
    rows: list[dict] = []

    for i in range(len(gdf)):
        if i in used:
            continue
        pt = centroids.iloc[i]
        candidates = tree.query(pt.buffer(MERGE_DISTANCE))
        cluster = [i]
        for j in candidates:
            if j != i and j not in used:
                if centroids.iloc[j].distance(pt) <= MERGE_DISTANCE:
                    cluster.append(j)
        for j in cluster:
            used.add(j)
        # Pick the name with longest length (most descriptive)
        best = max(cluster, key=lambda idx: len(gdf.iloc[idx]["name"]))
        geom = unary_union([gdf.geometry.iloc[j] for j in cluster])
        rows.append({
            "name": gdf.iloc[best]["name"],
            "service_type": gdf.iloc[best]["service_type"],
            "geometry": geom,
        })

    result = gpd.GeoDataFrame(rows, crs=gdf.crs)
    if len(result) < len(gdf):
        log.info("    Dedup: %d → %d (merged %d)", len(gdf), len(result), len(gdf) - len(result))
    return result


# ── planning area assignment ─────────────────────────────────────────────
def assign_planning_area(
    services: gpd.GeoDataFrame,
) -> gpd.GeoDataFrame:
    """Spatial join to assign each service to a planning area."""
    pa = _load_geojson(PLANNING_AREA)
    pa = pa[["PLN_AREA_N", "geometry"]].rename(columns={"PLN_AREA_N": "planning_area"})

    # Use representative point for polygon POIs (sjoin needs consistent geometry)
    svc = services.copy()
    svc["_rep_point"] = svc.geometry.representative_point()
    svc_points = svc.set_geometry("_rep_point")

    joined = gpd.sjoin(svc_points, pa, how="left", predicate="within")
    # Drop duplicates from overlapping boundaries (keep first match)
    joined = joined[~joined.index.duplicated(keep="first")]
    joined = joined.set_geometry(services.geometry.name)
    joined["planning_area"] = joined["planning_area"].fillna("UNKNOWN")

    # Drop helper columns
    cols_to_drop = [c for c in ["_rep_point", "index_right"] if c in joined.columns]
    joined = joined.drop(columns=cols_to_drop)
    return joined


# ── main ─────────────────────────────────────────────────────────────────
def main() -> None:
    log.info("=== Loading infrastructure layers ===")
    fp = _load_shp("Footpath")
    log.info("  Footpath: %d features", len(fp))
    cl = _load_shp("CoveredLinkWay")
    log.info("  CoveredLinkWay: %d features", len(cl))
    br = _load_shp("PedestrainOverheadbridge")
    log.info("  PedestrainOverheadbridge: %d features", len(br))

    # Build spatial indices
    log.info("Building spatial indices ...")
    fp_geoms = fp.geometry.values
    cl_geoms = cl.geometry.values
    br_geoms = br.geometry.values
    fp_sindex = STRtree(fp_geoms)
    cl_sindex = STRtree(cl_geoms)
    br_sindex = STRtree(br_geoms)

    log.info("\n=== Loading service POIs ===")
    schools = dedup_nearby(load_schools())
    healthcare = dedup_nearby(load_healthcare())
    commercial = dedup_nearby(load_commercial())
    hdb = load_hdb()  # HDB blocks are already distinct buildings

    services = pd.concat([schools, healthcare, commercial, hdb], ignore_index=True)
    services = gpd.GeoDataFrame(services, crs=CRS_SVY)
    log.info("Total services: %d", len(services))

    log.info("\n=== Assigning planning areas ===")
    services = assign_planning_area(services)

    log.info("\n=== Computing shelter ratios ===")
    n = len(services)
    ratios: list[float] = []

    for i, (_, row) in enumerate(services.iterrows()):
        geom = row.geometry

        # Determine buffer radius (minimum RADIUS_POINT for small polygons)
        if geom.geom_type == "Point":
            buf_radius = RADIUS_POINT
        else:
            buf_radius = max(_enclosing_radius(geom) + RADIUS_POLY_EXTRA, RADIUS_POINT)

        centroid = geom.centroid
        buf_geom = centroid.buffer(buf_radius)

        ratio = compute_shelter_ratio(
            buf_geom,
            fp,
            cl,
            br,
            fp_sindex,
            cl_sindex,
            br_sindex,
            fp_geoms,
            cl_geoms,
            br_geoms,
        )
        ratios.append(ratio)

        if (i + 1) % 200 == 0 or (i + 1) == n:
            log.info("  Progress: %d / %d", i + 1, n)

    services["shelter_ratio"] = ratios

    # Convert to WGS84 for lat/lng output
    services_wgs = services.to_crs(CRS_WGS)
    services_wgs["lat"] = services_wgs.geometry.representative_point().y
    services_wgs["lng"] = services_wgs.geometry.representative_point().x

    # Round coordinates
    services_wgs["lat"] = services_wgs["lat"].round(5)
    services_wgs["lng"] = services_wgs["lng"].round(5)

    # Build output
    records: list[dict[str, Any]] = []
    for _, row in services_wgs.iterrows():
        records.append(
            {
                "name": row["name"],
                "type": row["service_type"],
                "shelter_ratio": row["shelter_ratio"],
                "planning_area": row["planning_area"],
                "lat": row["lat"],
                "lng": row["lng"],
            }
        )

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT, "w") as f:
        json.dump(records, f, ensure_ascii=False)
    log.info("\n=== Done ===")
    log.info("Output: %s", OUTPUT)
    log.info("Total records: %d", len(records))

    # Summary by type
    type_counts = Counter(r["type"] for r in records)
    for t, c in sorted(type_counts.items()):
        log.info("  %s: %d", t, c)


if __name__ == "__main__":
    main()
