"""
Recompute per-planning-area linkway counts using ALL linkways in the polygon
(not just those within MRT station buffers). Also tag each linkway with the
earliest snapshot it appears in, so we can split "legacy" vs "recent" builds.

Output: data/area_all_linkways.json
"""

import json
import os
import tempfile
import warnings
import zipfile
from pathlib import Path

import geopandas as gpd
from shapely.strtree import STRtree

warnings.filterwarnings("ignore")

BASE = Path(__file__).resolve().parent.parent
POLYS = BASE / "data" / "raw" / "planning_area_boundaries.geojson"
OUT = BASE / "data" / "area_all_linkways.json"

# Snapshots in chronological order — earliest first
SNAPSHOTS = [
    ("2019-01", "dataset/2019/01/GEOSPATIAL/CoveredLinkWay.zip"),
    ("2020-01", "dataset/2020/01/GEOSPATIAL/CoveredLinkWay.zip"),
    ("2021-01", "dataset/2021/01/Static_ 2021_01/GEOSPATIAL/CoveredLinkWay.zip"),
    ("2022-01", "dataset/2022/01/Static_ 2022_01/GEOSPATIAL/CoveredLinkWay.zip"),
    ("2023-01", "dataset/2022/10/Static_ 2023_01/GEOSPATIAL/CoveredLinkWay.zip"),
    ("2023-07", "dataset/2023/03/Static_ 2023_07/GEOSPATIAL/CoveredLinkWay.zip"),
    ("2024-11", "dataset/2023/07/Static_ 2024_11/GEOSPATIAL/CoveredLinkWay_Nov2024.zip"),
    ("2025-05", "dataset/2025/05/Static_ 2025_05/GEOSPATIAL/CoveredLinkWay_Apr2025.zip"),
    ("2025-08", "dataset/2025.08/CoveredLinkWay_Aug2025/CoveredLinkWay.shp"),
    ("2026-03", "dataset/2026/03/Static_ 2026_03/GEOSPATIAL/CoveredLinkWay_Mar2026/CoveredLinkWay_Mar2026/CoveredLinkWay.shp"),
]

# Hausdorff-distance tolerance (degrees) — roughly 8 m
MATCH_TOL = 8.0 / 111320


def read_shp_from_path(path: str) -> gpd.GeoDataFrame:
    full = str(BASE / path)
    if full.endswith(".zip"):
        with tempfile.TemporaryDirectory() as td:
            with zipfile.ZipFile(full) as z:
                z.extractall(td)
            for root, _, files in os.walk(td):
                for f in files:
                    if f.endswith(".shp"):
                        return gpd.read_file(os.path.join(root, f)).to_crs("EPSG:4326")
        raise FileNotFoundError(f"No .shp inside {full}")
    return gpd.read_file(full).to_crs("EPSG:4326")


def main():
    # 1. Load all snapshots, build spatial indexes for historical ones
    print("Loading snapshots ...")
    snapshot_trees = []
    for date, path in SNAPSHOTS:
        gdf = read_shp_from_path(path)
        geoms = [g for g in gdf.geometry if g is not None and not g.is_empty]
        tree = STRtree(geoms) if geoms else None
        snapshot_trees.append((date, tree, geoms))
        print(f"  [{date}] {len(geoms)} features")

    # Latest snapshot is what we attribute years to
    latest_date, _, latest_geoms = snapshot_trees[-1]
    print(f"\nAttributing first_seen for {len(latest_geoms)} features in {latest_date}")

    # 2. For each feature in latest, find earliest snapshot with matching geometry
    first_seen = []
    for i, geom in enumerate(latest_geoms):
        buf = geom.buffer(MATCH_TOL)
        found = latest_date
        for date, tree, _ in snapshot_trees[:-1]:  # skip latest
            if tree is None:
                continue
            candidates = tree.query(buf)
            matched = False
            for idx in candidates:
                cand = tree.geometries[idx]
                if geom.hausdorff_distance(cand) < MATCH_TOL * 3:
                    matched = True
                    break
            if matched:
                found = date
                break
        first_seen.append(found)
        if (i + 1) % 500 == 0:
            print(f"  matched {i+1}/{len(latest_geoms)}")

    # 3. Spatial join to planning area
    print("\nSpatial join to planning areas ...")
    polys = gpd.read_file(POLYS).to_crs("EPSG:4326")
    pts = gpd.GeoDataFrame(
        {"first_seen": first_seen},
        geometry=[g.representative_point() for g in latest_geoms],
        crs="EPSG:4326",
    )
    joined = gpd.sjoin(
        pts, polys[["PLN_AREA_N", "geometry"]], how="left", predicate="within"
    )
    print(f"  Matched to an area: {joined.PLN_AREA_N.notna().sum()} / {len(joined)}")

    # 4. Aggregate per planning area
    print("\nAggregating per planning area ...")
    # Era buckets
    def era_of(d: str) -> str:
        if d <= "2019-01":
            return "pre2019"   # baseline / legacy
        if d <= "2022-12":
            return "y2019_2022"
        if d <= "2024-12":
            return "y2023_2024"
        return "y2025_plus"

    joined["era"] = joined["first_seen"].map(era_of)

    by_area = {}
    for area, group in joined.groupby("PLN_AREA_N"):
        total = len(group)
        by_era = group["era"].value_counts().to_dict()
        by_area[area] = {
            "name": area,
            "n_total_blocks": int(total),
            "lw_pre2019": int(by_era.get("pre2019", 0)),
            "lw_2019_2022": int(by_era.get("y2019_2022", 0)),
            "lw_2023_2024": int(by_era.get("y2023_2024", 0)),
            "lw_2025_plus": int(by_era.get("y2025_plus", 0)),
        }
        by_area[area]["lw_post2019"] = (
            by_area[area]["lw_2019_2022"]
            + by_area[area]["lw_2023_2024"]
            + by_area[area]["lw_2025_plus"]
        )

    # 5. Write out
    out = sorted(by_area.values(), key=lambda x: -x["n_total_blocks"])
    with open(OUT, "w") as f:
        json.dump(out, f, indent=2)
    print(f"\nWrote {OUT}")
    print(f"Total areas with linkways: {len(out)}")
    print(f"Grand total linkways:      {sum(a['n_total_blocks'] for a in out)}")
    print(f"\nTop 15 areas:")
    print(f"  {'Area':<22} {'Total':>6} {'pre2019':>8} {'19-22':>6} {'23-24':>6} {'25+':>5}")
    for a in out[:15]:
        print(
            f"  {a['name']:<22} {a['n_total_blocks']:>6} "
            f"{a['lw_pre2019']:>8} {a['lw_2019_2022']:>6} "
            f"{a['lw_2023_2024']:>6} {a['lw_2025_plus']:>5}"
        )


if __name__ == "__main__":
    main()
