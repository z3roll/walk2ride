"""
Q1: Station Shelter Exposure Score
===================================
Three factors per MRT station (400m radius):
  1. Shelter ratio  = (covered_footpath + bridge) / (footpath + bridge)
  2. Avg rainfall   = nearest NEA weather station annual average (mm)
  3. Avg passenger volume = LTA DataMall daily tap-in + tap-out

Exposure = (1 - shelter_ratio) × rainfall_norm × passenger_volume
"""

import json
import warnings
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

# ── paths ─────────────────────────────────────────────────────────────
BASE = Path(__file__).resolve().parent.parent
DATASET = BASE / "dataset" / "2026" / "03" / "Static_ 2026_03" / "GEOSPATIAL"
Q1 = Path(__file__).resolve().parent
OUT = Q1 / "data"
DETAIL = OUT / "station_details"
DETAIL.mkdir(parents=True, exist_ok=True)

RAINFALL_JSON = Q1 / "data" / "rainfall" / "sg_rainfall_summary.json"
PAX_DIR = Q1 / "data" / "passenger_volume"

CRS_WGS = "EPSG:4326"
CRS_SVY = "EPSG:3414"
RADIUS = 400          # metres


# ── helpers ───────────────────────────────────────────────────────────
def _load_shp(name: str) -> gpd.GeoDataFrame:
    # Search recursively for shapefile folder/files
    matches = list(DATASET.glob(f"{name}*"))
    if not matches:
        matches = list(DATASET.glob(f"**/{name}*"))
    folder = [m for m in matches if m.is_dir()][0]
    shp = list(folder.rglob("*.shp"))[0]
    try:
        gdf = gpd.read_file(shp, engine="pyogrio")
    except Exception:
        gdf = gpd.read_file(shp, engine="fiona")
    gdf = gdf[gdf.geometry.notna()]
    gdf["geometry"] = gdf["geometry"].make_valid()
    return gdf.to_crs(CRS_SVY)


# ── 1. load spatial data ─────────────────────────────────────────────
def load_spatial():
    print("Loading spatial data …")
    d = {}
    d["stations_poly"] = _load_shp("TrainStation")
    d["covered"] = _load_shp("CoveredLinkWay")
    d["bridge"] = _load_shp("PedestrainOverheadbridge")
    d["footpath"] = _load_shp("Footpath")
    for k, v in d.items():
        print(f"  {k}: {len(v)}")
    return d


# ── 2. load rainfall ─────────────────────────────────────────────────
def load_rainfall() -> list[dict]:
    if not RAINFALL_JSON.exists():
        print("  rainfall data not found – using island avg")
        return []
    with open(RAINFALL_JSON) as f:
        ws = json.load(f).get("stations", [])
    print(f"  {len(ws)} weather stations loaded")
    return ws


def nearest_rainfall(lat: float, lng: float, ws: list[dict]) -> tuple[float, str]:
    if not ws:
        return 2370.0, "island_avg"
    best = min(ws, key=lambda s: (lat - s["lat"])**2 + (lng - s["lon"])**2)
    return best["annual_avg_rainfall_mm"], best["station_name"]


# ── 3. load passenger volume ─────────────────────────────────────────
def load_pax() -> dict[str, float]:
    m: dict[str, float] = {}
    if not PAX_DIR.exists():
        return m
    for p in PAX_DIR.glob("station_daily_avg.*"):
        if p.suffix == ".json":
            with open(p) as f:
                raw = json.load(f)
            for k, v in raw.items():
                m[k.strip().upper()] = float(v)
        elif p.suffix == ".csv":
            df = pd.read_csv(p)
            for _, row in df.iterrows():
                name_val = str(row.iloc[0]).strip().upper()
                vol_val = float(row.iloc[1])
                if name_val and name_val not in m:
                    m[name_val] = vol_val
    print(f"  passenger volume: {len(m)} stations")
    return m


# ── 4. aggregate station polygons → station points ──────────────────
def build_stations(stations_poly: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    stations_poly = stations_poly.copy()
    stations_poly["station"] = stations_poly["STN_NAM_DE"].str.strip().str.upper()
    rows = []
    for name, grp in stations_poly.groupby("station"):
        rows.append({
            "station": name,
            "geometry": grp.geometry.unary_union.centroid,
            "n_exits": 0,  # exit count not available from polygon data
        })
    gdf = gpd.GeoDataFrame(rows, crs=CRS_SVY)
    print(f"  {len(gdf)} stations")
    return gdf


# ── 5. shelter ratio ─────────────────────────────────────────────────
def _poly_length(geom) -> float:
    """Estimate centerline length of a narrow polygon (walkway/bridge).

    For a rectangle L×W: perimeter=2L+2W, area=L×W.
    Solve for L: L = (perimeter + sqrt(perimeter² - 16×area)) / 4.
    """
    if geom.is_empty:
        return 0.0
    if geom.geom_type == "MultiPolygon":
        return sum(_poly_length(p) for p in geom.geoms)
    perim = geom.length
    area = geom.area
    disc = perim ** 2 - 16 * area
    if disc < 0:
        return np.sqrt(area)
    return (perim + np.sqrt(disc)) / 4


def _geom_length(gdf) -> float:
    """Sum effective lengths: LineString uses .length, Polygon uses _poly_length."""
    total = 0.0
    for g in gdf.geometry:
        if g.geom_type in ("Polygon", "MultiPolygon"):
            total += _poly_length(g)
        else:
            total += g.length
    return total


def shelter_ratio(buf, fp, cl, br) -> tuple[float, float, float]:
    """Return (ratio, covered_len, total_walkable_len).

    Coverage is measured by spatial intersection:
    - Covered linkway polygons are buffered slightly and intersected with
      footpath lines → only footpath segments actually under a linkway count.
    - Overhead bridges are fully sheltered paths, so their centerline length
      is added to both numerator (covered) and denominator (total walkable).
    """
    fp_c = fp.clip(buf)
    if fp_c.empty:
        return 0.0, 0.0, 0.0
    fp_len = fp_c.geometry.length.sum()
    if fp_len == 0:
        return 0.0, 0.0, 0.0

    # Covered footpath = footpath segments that intersect covered linkway polygons
    covered_fp = 0.0
    cl_c = cl.clip(buf)
    if not cl_c.empty:
        cl_union = cl_c.geometry.union_all()
        # Buffer by 3m to account for slight misalignment between layers
        cl_zone = cl_union.buffer(3)
        covered_fp = fp_c.geometry.intersection(cl_zone).length.sum()
    # Cap at actual footpath length (intersection can't exceed original)
    covered_fp = min(covered_fp, fp_len)

    # Bridge centerline length → added to both numerator and denominator
    bridge_len = 0.0
    br_c = br.clip(buf)
    if not br_c.empty:
        bridge_len = _geom_length(br_c)

    total = fp_len + bridge_len
    covered = covered_fp + bridge_len
    return covered / total, covered, total


# ── 6. extract geometry for detail view ──────────────────────────────
def extract_geo(stn_geom, sp):
    buf = stn_geom.buffer(RADIUS)
    def to_coords(gdf, tol=2.0):
        if gdf.empty:
            return []
        gdf_w = gdf.to_crs(CRS_WGS)
        out = []
        for g in gdf_w.geometry:
            s = g.simplify(tol / 111000)
            if s.is_empty:
                continue
            if s.geom_type == "LineString":
                out.append([[round(c[0], 6), round(c[1], 6)] for c in s.coords])
            elif s.geom_type == "MultiLineString":
                for ln in s.geoms:
                    out.append([[round(c[0], 6), round(c[1], 6)] for c in ln.coords])
            elif s.geom_type in ("Polygon", "MultiPolygon"):
                polys = [s] if s.geom_type == "Polygon" else list(s.geoms)
                for p in polys:
                    out.append([[round(c[0], 6), round(c[1], 6)] for c in p.exterior.coords])
        return out
    return {
        "footpaths": to_coords(sp["footpath"].clip(buf), 3.0),
        "covered_linkways": to_coords(sp["covered"].clip(buf)),
        "overhead_bridges": to_coords(sp["bridge"].clip(buf)),
    }


# ── 7. main ──────────────────────────────────────────────────────────
def main():
    sp = load_spatial()
    ws = load_rainfall()
    pax = load_pax()
    stations = build_stations(sp["stations_poly"])

    print(f"\nProcessing {len(stations)} stations (radius={RADIUS}m) …")
    results = []

    for i, (_, stn) in enumerate(stations.iterrows()):
        name = stn["station"]
        buf = stn.geometry.buffer(RADIUS)
        pt_wgs = gpd.GeoSeries([stn.geometry], crs=CRS_SVY).to_crs(CRS_WGS).iloc[0]
        lat, lng = round(pt_wgs.y, 6), round(pt_wgs.x, 6)

        sr, cov_len, tot_len = shelter_ratio(buf, sp["footpath"], sp["covered"], sp["bridge"])
        rain, ws_name = nearest_rainfall(lat, lng, ws)

        # passenger volume: try exact match, then try without "MRT STATION"/"LRT STATION"
        pv = pax.get(name, 0)
        if pv == 0:
            short = name.replace(" MRT STATION", "").replace(" LRT STATION", "")
            pv = pax.get(short, 0)
        if pv == 0:
            pv = 500  # floor for unmapped stations

        results.append({
            "station": name,
            "lat": lat,
            "lng": lng,
            "n_exits": stn["n_exits"],
            "shelter_ratio": round(sr, 4),
            "covered_length_m": round(cov_len, 1),
            "footpath_length_m": round(tot_len, 1),
            "rainfall_mm": round(rain, 1),
            "weather_station": ws_name,
            "passenger_volume": round(pv),
        })

        # station detail file
        geo = extract_geo(stn.geometry, sp)
        detail = {**results[-1], "geometry": geo}
        dp = DETAIL / f"{name.replace(' ', '_').replace('/', '_')}.json"
        with open(dp, "w") as f:
            json.dump(detail, f)

        if (i + 1) % 20 == 0 or i == 0:
            print(f"  [{i+1}/{len(stations)}] {name}  sr={sr:.2f}  rain={rain:.0f}  pax={pv:.0f}")

    # ── exposure score ──
    rains = [r["rainfall_mm"] for r in results]
    r_min, r_max = min(rains), max(rains)
    r_range = r_max - r_min or 1.0

    raws = []
    for r in results:
        rw = 0.5 + 0.5 * (r["rainfall_mm"] - r_min) / r_range   # [0.5, 1.0]
        raw = (1 - r["shelter_ratio"]) * rw * r["passenger_volume"]
        raws.append(raw)

    sorted_raws = sorted(raws)
    n = len(sorted_raws)
    for r, raw in zip(results, raws):
        r["exposure_score"] = round(sorted_raws.index(raw) / max(n - 1, 1), 4)

    results.sort(key=lambda x: x["exposure_score"], reverse=True)

    with open(OUT / "stations.json", "w") as f:
        json.dump(results, f, indent=2)

    # update detail files with score
    for r in results:
        dp = DETAIL / f"{r['station'].replace(' ', '_').replace('/', '_')}.json"
        if dp.exists():
            with open(dp) as f:
                d = json.load(f)
            d["exposure_score"] = r["exposure_score"]
            with open(dp, "w") as f:
                json.dump(d, f)

    print(f"\nSaved {len(results)} stations to {OUT / 'stations.json'}")
    print(f"\n{'Rank':<5} {'Station':<30} {'Score':<7} {'Shelter':<8} {'Rain':<8} {'Pax/day':<10}")
    for i, r in enumerate(results[:15]):
        print(f"{i+1:<5} {r['station']:<30} {r['exposure_score']:<7.3f} "
              f"{r['shelter_ratio']:<8.3f} {r['rainfall_mm']:<8.0f} {r['passenger_volume']:<10,.0f}")


if __name__ == "__main__":
    main()
