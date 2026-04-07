"""
Add HDB and Commercial POIs to each station's pois in details.json.
Filters services_shelter.json entries within 400m of each station.
"""

import json
import math
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
DETAILS = BASE / "data" / "details.json"
SERVICES = BASE / "data" / "services_shelter.json"

RADIUS = 400  # metres


def haversine(lat1, lng1, lat2, lng2):
    R = 6371000
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def main():
    with open(DETAILS) as f:
        details = json.load(f)
    with open(SERVICES) as f:
        services = json.load(f)

    hdb_svcs = [s for s in services if s["type"] == "HDB"]
    comm_svcs = [s for s in services if s["type"] == "Commercial"]
    print(f"HDB: {len(hdb_svcs)}, Commercial: {len(comm_svcs)}")

    total = len(details)
    for idx, (station, det) in enumerate(details.items()):
        slat, slng = det["lat"], det["lng"]

        hdb_nearby = []
        for s in hdb_svcs:
            if haversine(slat, slng, s["lat"], s["lng"]) <= RADIUS:
                hdb_nearby.append({"name": s["name"], "lat": s["lat"], "lng": s["lng"], "subtype": "HDB"})

        comm_nearby = []
        for s in comm_svcs:
            if haversine(slat, slng, s["lat"], s["lng"]) <= RADIUS:
                comm_nearby.append({"name": s["name"], "lat": s["lat"], "lng": s["lng"], "subtype": "Commercial"})

        pois = det.get("pois", {})
        pois["hdb"] = hdb_nearby
        pois["commercial"] = comm_nearby
        det["pois"] = pois

        if (idx + 1) % 50 == 0 or idx == 0:
            print(f"  [{idx+1}/{total}] {station}  hdb={len(hdb_nearby)} comm={len(comm_nearby)}")

    with open(DETAILS, "w") as f:
        json.dump(details, f)
    print("Done.")


if __name__ == "__main__":
    main()
