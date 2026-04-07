"""
Add first_seen dates to covered_linkways and overhead_bridges in details.json.

For each segment in each station's detail, find the earliest dataset snapshot
where a matching geometry exists (using spatial index + buffer matching).
"""

import json
import os
import re
import tempfile
import warnings
import zipfile
from pathlib import Path

import geopandas as gpd
from shapely.geometry import LineString
from shapely.strtree import STRtree

warnings.filterwarnings("ignore")

BASE = Path(__file__).resolve().parent.parent
DATASET_DIR = BASE / "dataset"
DETAILS_JSON = BASE / "data" / "details.json"

# Buffer tolerance for matching (degrees, ~10m)
MATCH_TOL = 10.0 / 111320


def find_shp_in_dir(directory: str) -> str | None:
    for root, _, files in os.walk(directory):
        for f in files:
            if f.endswith(".shp"):
                return os.path.join(root, f)
    return None


def read_shapefile(path: str) -> gpd.GeoDataFrame | None:
    if path.endswith(".zip"):
        with tempfile.TemporaryDirectory() as td:
            with zipfile.ZipFile(path) as z:
                z.extractall(td)
            shp_path = find_shp_in_dir(td)
            if shp_path:
                return gpd.read_file(shp_path).to_crs(epsg=4326)
        return None
    else:
        return gpd.read_file(path).to_crs(epsg=4326)


def extract_date_label(file_path: str) -> str:
    path_str = str(file_path)
    month_map = {
        "Jan": "01", "Feb": "02", "Mar": "03", "Apr": "04",
        "May": "05", "Jun": "06", "Jul": "07", "Aug": "08",
        "Sep": "09", "Oct": "10", "Nov": "11", "Dec": "12",
    }
    m = re.search(r"_([A-Za-z]{3})(\d{4})", os.path.basename(path_str))
    if m:
        return f"{m.group(2)}-{month_map.get(m.group(1), '01')}"
    matches = re.findall(r"Static_\s*(\d{4})_(\d{2})", path_str)
    if matches:
        year, mon = matches[-1]
        return f"{year}-{mon}"
    m = re.search(r"/(\d{4})/(\d{2})/", path_str)
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    try:
        with zipfile.ZipFile(path_str) as z:
            for name in z.namelist():
                m2 = re.search(r"_([A-Za-z]{3})(\d{4})", name)
                if m2:
                    return f"{m2.group(2)}-{month_map.get(m2.group(1), '01')}"
    except Exception:
        pass
    if "2025.08" in path_str:
        return "2025-08"
    return "unknown"


def collect_files_by_date() -> dict[str, dict[str, list[str]]]:
    """Collect file paths grouped by date."""
    by_date: dict[str, dict[str, list[str]]] = {}

    for root, _, files in os.walk(DATASET_DIR):
        for f in files:
            fl = f.lower()
            full = os.path.join(root, f)
            if fl.endswith(".zip") and "coveredlink" in fl:
                date = extract_date_label(full)
                by_date.setdefault(date, {"linkway": [], "bridge": []})
                by_date[date]["linkway"].append(full)
            elif fl.endswith(".zip") and ("pedestr" in fl or "overhead" in fl):
                date = extract_date_label(full)
                by_date.setdefault(date, {"linkway": [], "bridge": []})
                by_date[date]["bridge"].append(full)

    # 2025.08 unzipped shapefiles
    lw = DATASET_DIR / "2025.08" / "CoveredLinkWay_Aug2025" / "CoveredLinkWay.shp"
    br = DATASET_DIR / "2025.08" / "PedestrainOverheadbridge_UnderPass_Aug2025" / "PedestrainOverheadbridge.shp"
    if lw.exists():
        by_date.setdefault("2025-08", {"linkway": [], "bridge": []})
        by_date["2025-08"]["linkway"].append(str(lw))
    if br.exists():
        by_date.setdefault("2025-08", {"linkway": [], "bridge": []})
        by_date["2025-08"]["bridge"].append(str(br))

    return by_date


def load_best_gdf(paths: list[str]) -> gpd.GeoDataFrame:
    """Load the shapefile with most features from a list of paths."""
    best = gpd.GeoDataFrame()
    for p in paths:
        try:
            gdf = read_shapefile(p)
            if gdf is not None and len(gdf) > len(best):
                best = gdf
        except Exception:
            pass
    return best


def build_spatial_index(gdf: gpd.GeoDataFrame) -> STRtree | None:
    """Build STRtree from valid geometries."""
    if gdf.empty:
        return None
    geoms = [g for g in gdf.geometry if g is not None and not g.is_empty]
    if not geoms:
        return None
    return STRtree(geoms)


def segment_matches(seg_line: LineString, tree: STRtree) -> bool:
    """Check if a segment has a matching geometry in the spatial index."""
    # Query geometries whose bounding box intersects the buffered segment
    buffered = seg_line.buffer(MATCH_TOL)
    candidates = tree.query(buffered)
    for idx in candidates:
        geom = tree.geometries[idx]
        if seg_line.hausdorff_distance(geom) < MATCH_TOL * 3:
            return True
    return False


def main():
    print("Loading details.json ...")
    with open(DETAILS_JSON) as f:
        details = json.load(f)

    print("Collecting snapshot files ...")
    files_by_date = collect_files_by_date()
    sorted_dates = sorted(d for d in files_by_date if d != "unknown")
    print(f"  Found {len(sorted_dates)} snapshots: {sorted_dates[0]} .. {sorted_dates[-1]}")

    # Load all snapshots and build spatial indexes
    print("Loading shapefiles and building spatial indexes ...")
    lw_indexes: list[tuple[str, STRtree | None]] = []
    br_indexes: list[tuple[str, STRtree | None]] = []

    for date in sorted_dates:
        info = files_by_date[date]
        lw_gdf = load_best_gdf(info["linkway"])
        br_gdf = load_best_gdf(info["bridge"])
        lw_idx = build_spatial_index(lw_gdf)
        br_idx = build_spatial_index(br_gdf)
        lw_indexes.append((date, lw_idx))
        br_indexes.append((date, br_idx))
        print(f"  [{date}] linkway={len(lw_gdf)} bridge={len(br_gdf)}")

    # Process each station
    total = len(details)
    stats = {"cl_total": 0, "cl_matched": 0, "br_total": 0, "br_matched": 0}

    for idx, (station, det) in enumerate(details.items()):
        geo = det.get("geometry", {})
        cl_coords_list = geo.get("covered_linkways", [])
        br_coords_list = geo.get("overhead_bridges", [])

        cl_meta = []
        for coords in cl_coords_list:
            if len(coords) < 2:
                continue
            seg = LineString(coords)
            first = "Unknown"
            for date, tree in lw_indexes:
                if tree is not None and segment_matches(seg, tree):
                    first = date
                    break
            cl_meta.append({"coords": coords, "first_seen": first})
            stats["cl_total"] += 1
            if first != "Unknown":
                stats["cl_matched"] += 1

        br_meta = []
        for coords in br_coords_list:
            if len(coords) < 2:
                continue
            seg = LineString(coords)
            first = "Unknown"
            for date, tree in br_indexes:
                if tree is not None and segment_matches(seg, tree):
                    first = date
                    break
            br_meta.append({"coords": coords, "first_seen": first})
            stats["br_total"] += 1
            if first != "Unknown":
                stats["br_matched"] += 1

        geo["covered_linkways_meta"] = cl_meta
        geo["overhead_bridges_meta"] = br_meta

        if (idx + 1) % 20 == 0 or idx == 0:
            print(f"  [{idx+1}/{total}] {station}  cl={len(cl_meta)} br={len(br_meta)}")

    print(f"\nMatch stats:")
    print(f"  Linkways: {stats['cl_matched']}/{stats['cl_total']} matched")
    print(f"  Bridges:  {stats['br_matched']}/{stats['br_total']} matched")

    print("Writing updated details.json ...")
    with open(DETAILS_JSON, "w") as f:
        json.dump(details, f)
    print("Done.")


if __name__ == "__main__":
    main()
