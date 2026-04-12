"""
Add HDB and Commercial polygon boundaries to area_infra.json.
Same format as existing _school_polygons and _health_polygons:
  key = "Name_lat_lng" -> value = [[lng, lat], ...]
"""

import json
import warnings
from pathlib import Path

import geopandas as gpd
import numpy as np

warnings.filterwarnings("ignore")

BASE = Path(__file__).resolve().parent.parent
POI_DIR = BASE / "data" / "raw" / "poi"
HDB_PATH = BASE / "dataset" / "2025.08" / "HDBExistingBuilding.geojson"
AREA_INFRA = BASE / "data" / "area_infra.json"
SERVICES = BASE / "data" / "services_shelter.json"

CRS_WGS = "EPSG:4326"
HDB_SAMPLE_SIZE = 2000
RANDOM_SEED = 42


def extract_polygon_coords(geom) -> list[list[float]] | None:
    """Extract exterior ring coordinates from a Polygon/MultiPolygon."""
    if geom is None or geom.is_empty:
        return None
    if geom.geom_type == "MultiPolygon":
        geom = max(geom.geoms, key=lambda g: g.area)
    if geom.geom_type != "Polygon":
        return None
    coords = [[round(c[0], 6), round(c[1], 6)] for c in geom.exterior.coords]
    if len(coords) < 4:
        return None
    return coords


def main():
    print("Loading area_infra.json ...")
    with open(AREA_INFRA) as f:
        infra = json.load(f)

    # Load services to get the exact names used in the visualization
    print("Loading services_shelter.json ...")
    with open(SERVICES) as f:
        services = json.load(f)
    hdb_names = {s["name"] for s in services if s["type"] == "HDB"}
    comm_names = {s["name"] for s in services if s["type"] == "Commercial"}
    print(f"  HDB services: {len(hdb_names)}, Commercial services: {len(comm_names)}")

    # Load Commercial POIs
    print("Loading commercial.geojson ...")
    comm_gdf = gpd.read_file(POI_DIR / "commercial.geojson")
    comm_gdf = comm_gdf[comm_gdf["name"].notna() & (comm_gdf["name"] != "")].copy()
    comm_gdf = comm_gdf[comm_gdf.geometry.geom_type.isin(["Polygon", "MultiPolygon"])].copy()
    if comm_gdf.crs and comm_gdf.crs.to_epsg() != 4326:
        comm_gdf = comm_gdf.to_crs(CRS_WGS)

    comm_polys = {}
    for _, row in comm_gdf.iterrows():
        name = row["name"]
        if name not in comm_names:
            continue
        coords = extract_polygon_coords(row.geometry)
        if coords is None:
            continue
        centroid = row.geometry.centroid
        key = f"{name}_{round(centroid.y, 4)}_{round(centroid.x, 4)}"
        comm_polys[key] = coords
    print(f"  Commercial polygons: {len(comm_polys)}")

    # Load HDB POIs
    print("Loading HDB geojson ...")
    hdb_gdf = gpd.read_file(HDB_PATH)
    if hdb_gdf.crs and hdb_gdf.crs.to_epsg() != 4326:
        hdb_gdf = hdb_gdf.to_crs(CRS_WGS)

    # Reproduce the same sampling as gen_services_shelter.py
    rng = np.random.default_rng(RANDOM_SEED)
    indices = rng.choice(len(hdb_gdf), size=HDB_SAMPLE_SIZE, replace=False)
    hdb_gdf = hdb_gdf.iloc[indices].copy()
    hdb_gdf["name"] = "HDB " + hdb_gdf["BLK_NO"].astype(str)
    hdb_gdf = hdb_gdf[hdb_gdf.geometry.geom_type.isin(["Polygon", "MultiPolygon"])].copy()

    hdb_polys = {}
    for _, row in hdb_gdf.iterrows():
        name = row["name"]
        coords = extract_polygon_coords(row.geometry)
        if coords is None:
            continue
        centroid = row.geometry.centroid
        key = f"{name}_{round(centroid.y, 4)}_{round(centroid.x, 4)}"
        hdb_polys[key] = coords
    print(f"  HDB polygons: {len(hdb_polys)}")

    # Write back
    infra["_hdb_polygons"] = hdb_polys
    infra["_commercial_polygons"] = comm_polys

    print("Writing updated area_infra.json ...")
    with open(AREA_INFRA, "w") as f:
        json.dump(infra, f)
    print("Done.")


if __name__ == "__main__":
    main()
