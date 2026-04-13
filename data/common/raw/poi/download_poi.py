"""Download Singapore POI datasets from OpenStreetMap via OSMnx."""

import os
import sys
import time
from pathlib import Path

import geopandas as gpd
import osmnx as ox

OUTPUT_DIR = Path("/Users/zerol/PhD/visual_project/q1/data/poi")
PLACE = "Singapore"


def download_and_save(
    name: str,
    tags: dict[str, list[str] | str],
) -> None:
    """Download POI features from OSM and save as GeoJSON."""
    output_path = OUTPUT_DIR / f"{name}.geojson"
    print(f"\n{'='*60}")
    print(f"Downloading: {name}")
    print(f"Tags: {tags}")
    print(f"{'='*60}")

    start = time.time()
    try:
        gdf = ox.features_from_place(PLACE, tags=tags)
        elapsed = time.time() - start
        print(f"Download completed in {elapsed:.1f}s")
    except Exception as e:
        print(f"ERROR downloading {name}: {e}")
        return

    # Keep only Point and Polygon geometries, convert Polygons to centroids
    # for a cleaner POI dataset
    if gdf.empty:
        print(f"WARNING: No features found for {name}")
        return

    # Save full geometries
    gdf.to_file(output_path, driver="GeoJSON")

    # Report stats
    file_size = output_path.stat().st_size
    size_str = (
        f"{file_size / 1024:.1f} KB"
        if file_size < 1024 * 1024
        else f"{file_size / (1024 * 1024):.1f} MB"
    )
    print(f"File: {output_path.name}")
    print(f"Features: {len(gdf)}")
    print(f"Geometry types: {gdf.geometry.geom_type.value_counts().to_dict()}")
    print(f"Columns ({len(gdf.columns)}): {list(gdf.columns[:15])}")
    if len(gdf.columns) > 15:
        print(f"  ... and {len(gdf.columns) - 15} more columns")
    print(f"File size: {size_str}")

    # Show a few sample names if available
    name_col = "name" if "name" in gdf.columns else None
    if name_col and gdf[name_col].notna().any():
        samples = gdf[name_col].dropna().head(5).tolist()
        print(f"Sample names: {samples}")


def main() -> None:
    print(f"Output directory: {OUTPUT_DIR}")
    print(f"OSMnx version: {ox.__version__}")

    # 1. Schools
    download_and_save(
        "schools",
        tags={"amenity": ["school", "university", "college"]},
    )

    # 2. Healthcare
    download_and_save(
        "healthcare",
        tags={"amenity": ["hospital", "clinic", "doctors", "dentist", "pharmacy"]},
    )

    # 3. Parks and green spaces
    download_and_save(
        "parks",
        tags={"leisure": ["park", "garden", "nature_reserve"]},
    )

    # 4. Commercial / Office buildings
    download_and_save(
        "commercial",
        tags={"building": ["commercial", "office", "retail"]},
    )

    # Summary
    print(f"\n{'='*60}")
    print("SUMMARY")
    print(f"{'='*60}")
    for f in sorted(OUTPUT_DIR.glob("*.geojson")):
        size = f.stat().st_size
        size_str = (
            f"{size / 1024:.1f} KB"
            if size < 1024 * 1024
            else f"{size / (1024 * 1024):.1f} MB"
        )
        gdf = gpd.read_file(f)
        print(f"  {f.name:<25s} {len(gdf):>6d} features   {size_str:>10s}")


if __name__ == "__main__":
    main()
