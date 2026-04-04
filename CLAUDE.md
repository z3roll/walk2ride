# Project: Shelter Gap Visualization

## Testing Requirement (CRITICAL)

After ANY code change to this project, you MUST:
1. Start a local HTTP server (`python3 -m http.server` in the deploy directory)
2. Use the `web-access` skill to open the page in a browser and take a screenshot
3. Verify the page renders correctly — check for blank screens, broken layouts, missing charts
4. If issues are found, fix them and re-test until the page works
5. Only after visual confirmation should you commit and push to GitHub

**Never push broken code to GitHub.** Always test locally first via browser screenshot.

## Project Structure

```
deploy/
├── index.html          # Main shell: top nav (RQ1/RQ2) + content area
├── css/style.css       # All styles
├── js/
│   ├── common.js       # Data loading, shared utils
│   ├── q1.js           # RQ1: scatter chart + map view
│   └── q2.js           # RQ2: violin plots + regional analysis
└── data/
    ├── stations.json           # Q1: 204 MRT/LRT station metrics
    ├── details.json            # Q1: station geometry + POI (3.5MB)
    └── services_shelter.json   # Q2: 4252 service shelter ratios
```

## GitHub Pages

- Repo: https://github.com/z3roll/shelter-gap-viz
- URL: https://z3roll.github.io/shelter-gap-viz/
- Deploy: push to `main` branch, Pages auto-deploys

## Data Sources

- Shelter infrastructure: LTA 2026-03 shapefile (CoveredLinkWay, Footpath, OverheadBridge)
- Ridership: LTA DataMall 2025-11 / 2026-02
- Rainfall: NEA weather.gov.sg 2015-2024 daily data
- POI: OpenStreetMap via OSMnx (schools, healthcare, elderly, commercial)
- HDB: data.gov.sg HDB building geojson
