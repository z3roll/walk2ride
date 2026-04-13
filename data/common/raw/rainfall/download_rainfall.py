"""
Download historical daily rainfall data from weather.gov.sg for key stations
across Singapore, then compute monthly and annual averages per station.

Source: Meteorological Service Singapore (MSS) / NEA
URL pattern: https://www.weather.gov.sg/files/dailydata/DAILYDATA_{station}_{YYYYMM}.csv
"""

import io
import json
import time
from pathlib import Path

import pandas as pd
import requests

OUTPUT_DIR = Path("/Users/zerol/PhD/visual_project/q1/data/rainfall")

# Key stations distributed across Singapore's regions
# Selected to cover North, South, East, West, Central, and islands
STATIONS: dict[str, dict] = {
    "S24": {"name": "Changi", "lat": 1.3678, "lon": 103.9823, "region": "East"},
    "S25": {"name": "Seletar", "lat": 1.4114, "lon": 103.8627, "region": "North-Central"},
    "S80": {"name": "Sembawang", "lat": 1.4247, "lon": 103.8201, "region": "North"},
    "S23": {"name": "Tengah", "lat": 1.3858, "lon": 103.7119, "region": "West"},
    "S06": {"name": "Paya Lebar", "lat": 1.357, "lon": 103.904, "region": "Central-East"},
    "S50": {"name": "Clementi Road", "lat": 1.3318, "lon": 103.7762, "region": "West-Central"},
    "S60": {"name": "Sentosa", "lat": 1.2504, "lon": 103.8275, "region": "South"},
    "S44": {"name": "Nanyang Avenue (NTU)", "lat": 1.3458, "lon": 103.6817, "region": "Far West"},
    "S109": {"name": "Ang Mo Kio Ave 5", "lat": 1.3793, "lon": 103.85, "region": "Central-North"},
    "S104": {"name": "Woodlands Ave 9", "lat": 1.4439, "lon": 103.7854, "region": "Far North"},
    "S29": {"name": "Pasir Ris Road", "lat": 1.3865, "lon": 103.9413, "region": "North-East"},
    "S107": {"name": "East Coast Park", "lat": 1.3133, "lon": 103.962, "region": "South-East"},
    "S115": {"name": "Tuas South Ave 3", "lat": 1.2938, "lon": 103.6184, "region": "Far South-West"},
    "S31": {"name": "Kampong Bahru Road", "lat": 1.2748, "lon": 103.8282, "region": "South-Central"},
    "S43": {"name": "Kim Chuan Road", "lat": 1.3406, "lon": 103.8882, "region": "Central-East"},
    "S71": {"name": "Kent Ridge Road (NUS)", "lat": 1.2923, "lon": 103.7815, "region": "South-West"},
    "S81": {"name": "Punggol Central", "lat": 1.4028, "lon": 103.9095, "region": "North-East"},
    "S84": {"name": "Tampines Ave 5", "lat": 1.3443, "lon": 103.9441, "region": "East"},
    "S88": {"name": "Toa Payoh North", "lat": 1.3417, "lon": 103.8515, "region": "Central"},
    "S40": {"name": "Mandai Lake Road", "lat": 1.4067, "lon": 103.7832, "region": "North-Central"},
}

# Years to download (recent 10-year period for robust averages)
YEARS = range(2015, 2025)
MONTHS = range(1, 13)

BASE_URL = "https://www.weather.gov.sg/files/dailydata/DAILYDATA_{station}_{year}{month:02d}.csv"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/csv,text/html,application/xhtml+xml,*/*",
    "Referer": "http://www.weather.gov.sg/climate-historical-daily/",
}


def download_station_data(station_code: str) -> pd.DataFrame | None:
    """Download all available monthly CSVs for a station and return combined DataFrame."""
    frames: list[pd.DataFrame] = []
    failures = 0

    for year in YEARS:
        for month in MONTHS:
            url = BASE_URL.format(station=station_code, year=year, month=month)
            try:
                resp = requests.get(url, headers=HEADERS, timeout=15)
                if resp.status_code == 200 and "Station" in resp.text[:100]:
                    text = resp.text
                    df = pd.read_csv(io.StringIO(text), encoding="utf-8-sig")
                    frames.append(df)
                    failures = 0
                else:
                    failures += 1
            except requests.RequestException:
                failures += 1

            # Be polite to the server
            time.sleep(0.15)

            # If too many consecutive failures, this station may not have data for this period
            if failures > 6:
                break
        if failures > 6:
            break

    if not frames:
        return None

    combined = pd.concat(frames, ignore_index=True)
    return combined


def compute_monthly_averages(df: pd.DataFrame) -> pd.DataFrame:
    """Compute average monthly rainfall from daily data."""
    # Column name for daily rainfall varies; find it
    rain_col = [c for c in df.columns if "rainfall" in c.lower() and "total" in c.lower()]
    if not rain_col:
        rain_col = [c for c in df.columns if "rainfall" in c.lower()]
    if not rain_col:
        return pd.DataFrame()

    rain_col_name = rain_col[0]
    df = df.copy()
    df[rain_col_name] = pd.to_numeric(df[rain_col_name], errors="coerce")

    year_col = [c for c in df.columns if "year" in c.lower()][0]
    month_col = [c for c in df.columns if "month" in c.lower()][0]

    # Sum daily rainfall per year-month, then average across years
    monthly_totals = df.groupby([year_col, month_col])[rain_col_name].sum().reset_index()
    monthly_totals.columns = ["year", "month", "monthly_total_mm"]

    monthly_avg = monthly_totals.groupby("month")["monthly_total_mm"].agg(
        ["mean", "std", "count"]
    ).reset_index()
    monthly_avg.columns = ["month", "avg_monthly_rainfall_mm", "std_mm", "n_years"]

    return monthly_avg


def main() -> None:
    all_station_monthly: list[dict] = []
    station_annual: list[dict] = []
    raw_frames: list[pd.DataFrame] = []

    print(f"Downloading rainfall data for {len(STATIONS)} stations, {len(list(YEARS))} years each...")
    print("This may take a few minutes.\n")

    for code, info in STATIONS.items():
        print(f"  [{code}] {info['name']} ({info['region']})...", end=" ", flush=True)
        df = download_station_data(code)

        if df is None or df.empty:
            print("NO DATA")
            continue

        monthly_avg = compute_monthly_averages(df)
        if monthly_avg.empty:
            print("PARSE ERROR")
            continue

        annual_avg = monthly_avg["avg_monthly_rainfall_mm"].sum()
        print(f"{annual_avg:.0f} mm/year")

        # Store monthly data
        for _, row in monthly_avg.iterrows():
            all_station_monthly.append({
                "station_code": code,
                "station_name": info["name"],
                "region": info["region"],
                "lat": info["lat"],
                "lon": info["lon"],
                "month": int(row["month"]),
                "avg_monthly_rainfall_mm": round(float(row["avg_monthly_rainfall_mm"]), 1),
                "std_mm": round(float(row["std_mm"]), 1),
                "n_years": int(row["n_years"]),
            })

        # Store annual summary
        station_annual.append({
            "station_code": code,
            "station_name": info["name"],
            "region": info["region"],
            "lat": info["lat"],
            "lon": info["lon"],
            "annual_avg_rainfall_mm": round(annual_avg, 1),
        })

        # Keep raw data
        df_raw = df.copy()
        df_raw["station_code"] = code
        df_raw["station_name"] = info["name"]
        df_raw["region"] = info["region"]
        raw_frames.append(df_raw)

    # Save monthly averages by station
    if all_station_monthly:
        monthly_df = pd.DataFrame(all_station_monthly)
        monthly_path = OUTPUT_DIR / "sg_station_monthly_rainfall.csv"
        monthly_df.to_csv(monthly_path, index=False)
        print(f"\nSaved monthly averages: {monthly_path}")

    # Save annual summary by station
    if station_annual:
        annual_df = pd.DataFrame(station_annual)
        annual_path = OUTPUT_DIR / "sg_station_annual_rainfall.csv"
        annual_df.to_csv(annual_path, index=False)
        print(f"Saved annual summary:   {annual_path}")

        # Also save as JSON for easy consumption
        summary = {
            "source": "Meteorological Service Singapore (MSS) / NEA",
            "url": "http://www.weather.gov.sg/climate-historical-daily/",
            "reference_period": "2015-2024 (10 years)",
            "island_wide_avg_mm": round(annual_df["annual_avg_rainfall_mm"].mean(), 1),
            "note": "Per-station annual averages computed from daily data",
            "stations": station_annual,
        }
        json_path = OUTPUT_DIR / "sg_rainfall_summary.json"
        with open(json_path, "w") as f:
            json.dump(summary, f, indent=2)
        print(f"Saved JSON summary:     {json_path}")

    # Save raw daily data
    if raw_frames:
        raw_df = pd.concat(raw_frames, ignore_index=True)
        raw_path = OUTPUT_DIR / "sg_station_daily_rainfall_raw.csv"
        raw_df.to_csv(raw_path, index=False)
        print(f"Saved raw daily data:   {raw_path}")

    # Also save the NEA official climatological normals (1991-2020)
    nea_normals = {
        "source": "Meteorological Service Singapore - Climate of Singapore",
        "url": "http://www.weather.gov.sg/climate-climate-of-singapore/",
        "reference_period": "1991-2020",
        "station": "Changi Climate Station",
        "annual_avg_mm": 2113.3,
        "monthly_avg_mm": {
            "1": 221.6, "2": 105.1, "3": 151.7, "4": 164.3,
            "5": 164.3, "6": 135.3, "7": 146.6, "8": 146.9,
            "9": 124.9, "10": 168.3, "11": 252.3, "12": 331.9,
        },
        "rain_days_per_year": 171,
        "note": "Official climatological normals from Changi Climate Station. Rainfall is higher over central and western parts of Singapore and decreases towards the east.",
    }
    nea_path = OUTPUT_DIR / "sg_nea_climate_normals.json"
    with open(nea_path, "w") as f:
        json.dump(nea_normals, f, indent=2)
    print(f"Saved NEA normals:      {nea_path}")

    print("\nDone!")


if __name__ == "__main__":
    main()
