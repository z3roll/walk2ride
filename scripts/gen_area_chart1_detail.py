"""
Generate data/area_chart1_detail.json — per-area detail for the Q2 Chart 1
click-through map view.

For each planning area that has stations + residential HDBs, writes:
  - stations          : list of {name, lat, lng} for stations in that area
  - buffer_geom       : GeoJSON geometry (Polygon or MultiPolygon) in WGS84
                        representing the union of 400m circles around all
                        stations in the area.
  - buffer_bbox       : [minLng, minLat, maxLng, maxLat] for map fitting
  - hdb               : list of {blk, year, lng, lat} for residential HDB
                        blocks whose centroid is inside the buffer.
  - linkways          : list of polygon outer rings (WGS84) for every
                        CoveredLinkWay feature whose rep. point is inside
                        the buffer.
  - bridges           : same, for PedestrainOverheadbridge_UnderPass.
  - footpaths         : list of LineString coordinate arrays (WGS84) for
                        every Footpath feature that touches the buffer
                        (bbox intersect then geometry intersect).

All geometry is pre-filtered server-side so the client just draws what
it receives without any area_infra.json dependency.
"""

from __future__ import annotations

import csv
import json
import warnings
from pathlib import Path

import geopandas as gpd
from shapely.geometry import Point, mapping
from shapely.ops import unary_union

warnings.filterwarnings("ignore")

BASE = Path(__file__).resolve().parent.parent
HDB_JSON = BASE / "data" / "hdb_buildings.json"
HDB_CSV = BASE / "data" / "raw" / "HDBPropertyInformation.csv"
STATIONS_JSON = BASE / "data" / "stations.json"
POLYS = BASE / "data" / "raw" / "planning_area_boundaries.geojson"
GEO = BASE / "dataset" / "2026" / "03" / "Static_ 2026_03" / "GEOSPATIAL"
LINKWAY_SHP = GEO / "CoveredLinkWay_Mar2026" / "CoveredLinkWay_Mar2026" / "CoveredLinkWay.shp"
BRIDGE_SHP = (
    GEO
    / "PedestrainOverheadbridge_UnderPass_Mar2026"
    / "PedestrainOverheadbridge_UnderPass_Mar2026"
    / "PedestrainOverheadbridge.shp"
)
FOOTPATH_SHP = GEO / "Footpath_Mar2026" / "Footpath_Mar2026" / "Footpath.shp"
OUT = BASE / "data" / "area_chart1_detail.json"

CRS_METRIC = "EPSG:3414"
CRS_WGS = "EPSG:4326"
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


def round_coords(geom):
    """Round coordinates in a GeoJSON geometry dict to 6 decimals for compactness."""
    def r(x):
        return round(float(x), 6)

    g = mapping(geom) if not isinstance(geom, dict) else geom
    gt = g["type"]
    c = g["coordinates"]
    if gt == "Polygon":
        g["coordinates"] = [[[r(x), r(y)] for x, y in ring] for ring in c]
    elif gt == "MultiPolygon":
        g["coordinates"] = [
            [[[r(x), r(y)] for x, y in ring] for ring in poly] for poly in c
        ]
    return g


def polygon_outer_ring(geom) -> list[list[list[float]]]:
    """Return a list of outer rings (compact [[lng,lat],...]) for a (Multi)Polygon."""
    rings: list[list[list[float]]] = []
    if geom is None or geom.is_empty:
        return rings
    if geom.geom_type == "MultiPolygon":
        for p in geom.geoms:
            rings.extend(polygon_outer_ring(p))
        return rings
    if geom.geom_type != "Polygon":
        return rings
    ring = [[round(x, 6), round(y, 6)] for x, y in geom.exterior.coords]
    if len(ring) >= 4:
        rings.append(ring)
    return rings


def line_coords(geom) -> list[list[list[float]]]:
    """Return a list of LineString coord arrays for a (Multi)LineString."""
    out: list[list[list[float]]] = []
    if geom is None or geom.is_empty:
        return out
    if geom.geom_type == "MultiLineString":
        for ls in geom.geoms:
            coords = [[round(x, 6), round(y, 6)] for x, y in ls.coords]
            if len(coords) >= 2:
                out.append(coords)
        return out
    if geom.geom_type == "LineString":
        coords = [[round(x, 6), round(y, 6)] for x, y in geom.coords]
        if len(coords) >= 2:
            out.append(coords)
    return out


def main() -> None:
    # Residential HDB
    residential = load_residential_keys()
    hdb_all = json.load(open(HDB_JSON))
    hdb = [
        b
        for b in hdb_all
        if b.get("year_completed") is not None
        and b.get("town_code")
        and (b["town_code"], b["blk_no"]) in residential
    ]
    print(f"Residential HDB: {len(hdb):,}")

    # HDB as GeoDataFrame in metric CRS (for buffer membership check)
    hdb_gdf = gpd.GeoDataFrame(
        [
            {
                "blk": b["blk_no"],
                "year": b["year_completed"],
                "lng": round(b["lng"], 6),
                "lat": round(b["lat"], 6),
            }
            for b in hdb
        ],
        geometry=[Point(b["lng"], b["lat"]) for b in hdb],
        crs=CRS_WGS,
    ).to_crs(CRS_METRIC)

    # Planning polygons (for station→area sjoin)
    polys = gpd.read_file(POLYS).to_crs(CRS_METRIC)

    # Stations — exclude depots
    stations = [
        s
        for s in json.load(open(STATIONS_JSON))
        if "DEPOT" not in s["station"]
    ]
    sta_gdf = gpd.GeoDataFrame(
        [{"name": s["station"], "lat": s["lat"], "lng": s["lng"]} for s in stations],
        geometry=[Point(s["lng"], s["lat"]) for s in stations],
        crs=CRS_WGS,
    ).to_crs(CRS_METRIC)
    sta_joined = gpd.sjoin(
        sta_gdf,
        polys[["PLN_AREA_N", "geometry"]],
        how="left",
        predicate="within",
    )

    # Load infra layers once
    print("Loading linkway / bridge / footpath shapefiles ...")
    lw_gdf = gpd.read_file(LINKWAY_SHP).to_crs(CRS_METRIC)
    br_gdf = gpd.read_file(BRIDGE_SHP).to_crs(CRS_METRIC)
    fp_gdf = gpd.read_file(FOOTPATH_SHP).to_crs(CRS_METRIC)
    print(f"  linkway: {len(lw_gdf):,}, bridge: {len(br_gdf):,}, footpath: {len(fp_gdf):,}")

    lw_gdf["_rp"] = lw_gdf.geometry.representative_point()
    br_gdf["_rp"] = br_gdf.geometry.representative_point()
    # Footpath sindex for fast bbox query
    fp_sindex = fp_gdf.sindex

    areas = {}
    for pa_name, group in sta_joined.groupby("PLN_AREA_N"):
        sta_in_area = group[group["name"].notna()]
        if len(sta_in_area) == 0:
            continue

        # Buffer union (metric) → reproject back to WGS84 for map rendering
        buf_metric = unary_union(
            [g.buffer(STATION_BUFFER) for g in sta_in_area.geometry]
        )
        buf_wgs_gdf = gpd.GeoSeries([buf_metric], crs=CRS_METRIC).to_crs(CRS_WGS)
        buf_wgs = buf_wgs_gdf.iloc[0]
        buf_geojson = round_coords(buf_wgs)

        # HDB within buffer (in metric CRS for accurate point-in-poly)
        hdb_mask = hdb_gdf.geometry.within(buf_metric)
        hdb_in = hdb_gdf[hdb_mask]

        hdb_list = [
            {
                "blk": row["blk"],
                "year": int(row["year"]),
                "lng": row["lng"],
                "lat": row["lat"],
            }
            for _, row in hdb_in.iterrows()
        ]

        # Linkways whose representative point lies inside the buffer
        lw_mask = lw_gdf["_rp"].within(buf_metric)
        lw_in = lw_gdf[lw_mask]
        lw_wgs = lw_in.to_crs(CRS_WGS)
        linkways = []
        for g in lw_wgs.geometry:
            linkways.extend(polygon_outer_ring(g))

        br_mask = br_gdf["_rp"].within(buf_metric)
        br_in = br_gdf[br_mask]
        br_wgs = br_in.to_crs(CRS_WGS)
        bridges = []
        for g in br_wgs.geometry:
            bridges.extend(polygon_outer_ring(g))

        # Footpaths touching the buffer (bbox candidates → exact intersect)
        cand_idx = list(fp_sindex.query(buf_metric, predicate="intersects"))
        fp_cand = fp_gdf.iloc[cand_idx]
        fp_hit = fp_cand[fp_cand.geometry.intersects(buf_metric)]
        fp_wgs = fp_hit.to_crs(CRS_WGS)
        footpaths = []
        for g in fp_wgs.geometry:
            footpaths.extend(line_coords(g))

        # Station list (lat/lng in WGS84) — sort by name for stable order
        station_list = [
            {"name": row["name"], "lat": row["lat"], "lng": row["lng"]}
            for _, row in sta_in_area.sort_values("name").iterrows()
        ]

        minx, miny, maxx, maxy = buf_wgs.bounds
        areas[pa_name] = {
            "stations": station_list,
            "n_stations": len(station_list),
            "n_hdb_400m": len(hdb_list),
            "n_linkways": len(linkways),
            "n_bridges": len(bridges),
            "n_footpaths": len(footpaths),
            "buffer_geom": buf_geojson,
            "buffer_bbox": [
                round(minx, 6),
                round(miny, 6),
                round(maxx, 6),
                round(maxy, 6),
            ],
            "hdb": hdb_list,
            "linkways": linkways,
            "bridges": bridges,
            "footpaths": footpaths,
        }
        print(
            f"  {pa_name:<22} stations={len(station_list)} hdb={len(hdb_list)} "
            f"lw={len(linkways)} br={len(bridges)} fp={len(footpaths)}"
        )

    OUT.write_text(json.dumps(areas, separators=(",", ":")))
    size_mb = OUT.stat().st_size / (1024 * 1024)
    print(f"\nWrote {OUT} — {size_mb:.1f} MB, {len(areas)} areas")


if __name__ == "__main__":
    main()
