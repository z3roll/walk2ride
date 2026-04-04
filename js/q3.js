/* ═══════════════════════════════════════════════════════════════════
   Q3 — Vulnerable Populations vs Shelter Coverage by Planning Area
   ═══════════════════════════════════════════════════════════════════ */

let q3Map = null;
let q3Markers = [];
let q3SelectedArea = null;
let q3Data = [];

/* ── Constants ── */
const Q3_MAX_ELLIPSE_RADIUS = 40; // px max semi-axis
const Q3_MIN_ELLIPSE_RADIUS = 6;  // px min semi-axis

/* ── Helpers ── */
function q3Mean(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

function q3TitleCase(s) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function q3ShelterColorRGBA(ratio, alpha) {
  const rgb = shelterColor(ratio);
  const m = rgb.match(/\d+/g);
  if (!m) return `rgba(128,128,128,${alpha})`;
  return `rgba(${m[0]},${m[1]},${m[2]},${alpha})`;
}

/* ── Auto-detect case studies ── */
function q3FindCaseStudies(data) {
  if (!data.length) return { caseA: null, caseB: null, caseC: null };

  const maxVuln = Math.max(...data.map(d => d.vulnerable_ratio));
  const minVuln = Math.min(...data.map(d => d.vulnerable_ratio));
  const vulnRange = maxVuln - minVuln || 1;
  const maxShelter = Math.max(...data.map(d => d.shelter_ratio));
  const minShelter = Math.min(...data.map(d => d.shelter_ratio));
  const shelterRange = maxShelter - minShelter || 1;

  const scored = data.map(d => {
    const vulnNorm = (d.vulnerable_ratio - minVuln) / vulnRange;
    const shelterNorm = (d.shelter_ratio - minShelter) / shelterRange;
    return {
      ...d,
      vulnNorm,
      shelterNorm,
      // Case A: high vulnerable + low shelter → positive case (needs attention)
      scoreA: vulnNorm * (1 - shelterNorm),
      // Case B: low vulnerable + low shelter → negative case (e.g., CBD)
      scoreB: (1 - vulnNorm) * (1 - shelterNorm),
      // Case C: high vulnerable + high shelter → negative case (good coverage despite vuln)
      scoreC: vulnNorm * shelterNorm,
    };
  });

  const caseA = scored.reduce((best, d) => d.scoreA > best.scoreA ? d : best, scored[0]);
  const caseB = scored.reduce((best, d) => d.scoreB > best.scoreB ? d : best, scored[0]);
  const caseC = scored.reduce((best, d) => d.scoreC > best.scoreC ? d : best, scored[0]);

  return { caseA, caseB, caseC };
}

/* ═══════════════════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════════════════ */
function q3Init() {
  q3Data = window.RQ3_DATA || [];
  if (!q3Data.length) return;

  renderQ3Sidebar();
  setTimeout(initQ3Map, 50);
}

function q3Show() {
  if (q3Map) q3Map.resize();
}

/* ═══════════════════════════════════════════════════════════════════
   MAP
   ═══════════════════════════════════════════════════════════════════ */
function initQ3Map() {
  const container = document.getElementById('q3-map');
  if (!container) return;

  if (q3Map) { q3Map.remove(); q3Map = null; }

  q3Map = new maplibregl.Map({
    container: 'q3-map',
    style: {
      version: 8,
      sources: {
        'osm-dark': {
          type: 'raster',
          tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'],
          tileSize: 256,
          attribution: '&copy; OpenStreetMap &copy; CARTO',
        },
      },
      layers: [{ id: 'base', type: 'raster', source: 'osm-dark' }],
    },
    center: [103.82, 1.35],
    zoom: 11,
    maxZoom: 16,
    minZoom: 10,
  });

  q3Map.on('load', () => {
    addQ3Choropleth();
    addQ3Ellipses();
    addQ3Legend();
  });
}

/* ── Choropleth layer (planning area polygons colored by shelter ratio) ── */
function addQ3Choropleth() {
  const regions = window.REGIONS;
  if (!regions || !q3Data.length) return;

  // Build lookup: area name → shelter ratio
  const shelterLookup = {};
  q3Data.forEach(d => {
    shelterLookup[d.name.toUpperCase()] = d.shelter_ratio;
  });

  // Color each feature
  const coloredFeatures = regions.features.map(f => {
    const areaName = (f.properties.PLN_AREA_N || '').toUpperCase();
    const ratio = shelterLookup[areaName];
    const color = ratio !== undefined ? shelterColor(ratio) : 'rgba(40,44,52,0.5)';
    return {
      ...f,
      properties: {
        ...f.properties,
        _shelterColor: color,
        _hasShelterData: ratio !== undefined ? 1 : 0,
        _shelterRatio: ratio !== undefined ? ratio : -1,
      },
    };
  });

  const geojson = { type: 'FeatureCollection', features: coloredFeatures };

  q3Map.addSource('q3-regions', { type: 'geojson', data: geojson });

  // Fill layer
  q3Map.addLayer({
    id: 'q3-fill',
    type: 'fill',
    source: 'q3-regions',
    paint: {
      'fill-color': ['get', '_shelterColor'],
      'fill-opacity': ['case', ['==', ['get', '_hasShelterData'], 1], 0.35, 0.05],
    },
  });

  // Border layer
  q3Map.addLayer({
    id: 'q3-border',
    type: 'line',
    source: 'q3-regions',
    paint: {
      'line-color': '#556',
      'line-width': 1,
      'line-opacity': 0.6,
    },
  });

  // Highlight layer (for selected area)
  q3Map.addLayer({
    id: 'q3-highlight',
    type: 'line',
    source: 'q3-regions',
    paint: {
      'line-color': '#4fc3f7',
      'line-width': 3,
      'line-opacity': 0,
    },
  });

  // Click interaction
  q3Map.on('click', 'q3-fill', (e) => {
    if (!e.features || !e.features.length) return;
    const feature = e.features[0];
    const areaName = (feature.properties.PLN_AREA_N || '').toUpperCase();
    const areaData = q3Data.find(d => d.name.toUpperCase() === areaName);
    if (areaData) q3SelectArea(areaData);
  });

  q3Map.on('mouseenter', 'q3-fill', () => {
    q3Map.getCanvas().style.cursor = 'pointer';
  });
  q3Map.on('mouseleave', 'q3-fill', () => {
    q3Map.getCanvas().style.cursor = '';
  });
}

/* ── Ellipse markers ── */
function addQ3Ellipses() {
  if (!q3Data.length) return;

  // Clear existing markers
  q3Markers.forEach(m => m.remove());
  q3Markers = [];

  // Find max ratios for scaling
  const maxElderly = Math.max(...q3Data.map(d => d.elderly_ratio));
  const maxChildren = Math.max(...q3Data.map(d => d.children_ratio));

  q3Data.forEach(d => {
    const rx = Q3_MIN_ELLIPSE_RADIUS + (d.elderly_ratio / (maxElderly || 1)) * (Q3_MAX_ELLIPSE_RADIUS - Q3_MIN_ELLIPSE_RADIUS);
    const ry = Q3_MIN_ELLIPSE_RADIUS + (d.children_ratio / (maxChildren || 1)) * (Q3_MAX_ELLIPSE_RADIUS - Q3_MIN_ELLIPSE_RADIUS);

    const fillColor = q3ShelterColorRGBA(d.shelter_ratio, 0.25);
    const strokeColor = 'rgba(255,255,255,0.7)';

    const svgW = Math.ceil(rx * 2 + 4);
    const svgH = Math.ceil(ry * 2 + 4);
    const cx = svgW / 2;
    const cy = svgH / 2;

    const svg = `<svg width="${svgW}" height="${svgH}" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"
        fill="${fillColor}" stroke="${strokeColor}" stroke-width="1.5"/>
    </svg>`;

    const el = document.createElement('div');
    el.innerHTML = svg;
    el.style.cursor = 'pointer';
    el.title = `${q3TitleCase(d.name)}\nElderly: ${(d.elderly_ratio * 100).toFixed(1)}%\nChildren: ${(d.children_ratio * 100).toFixed(1)}%\nShelter: ${(d.shelter_ratio * 100).toFixed(1)}%`;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      q3SelectArea(d);
    });

    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([d.centroid_lng, d.centroid_lat])
      .addTo(q3Map);

    q3Markers.push(marker);
  });
}

/* ── Legend ── */
function addQ3Legend() {
  const legendEl = document.getElementById('q3-map-legend');
  if (!legendEl) return;

  legendEl.innerHTML = `
    <div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);font-weight:700;margin-bottom:10px;">Legend</div>
    <div style="margin-bottom:10px;">
      <div style="font-size:10px;color:var(--muted);margin-bottom:4px;">Polygon Color = Shelter Ratio</div>
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="font-size:10px;color:#ef5350;">Low</span>
        <div style="flex:1;height:8px;border-radius:4px;background:linear-gradient(to right, rgb(239,83,80), rgb(255,152,0), rgb(255,235,59), rgb(76,175,80));"></div>
        <span style="font-size:10px;color:#4caf50;">High</span>
      </div>
    </div>
    <div style="height:1px;background:var(--border);margin:8px 0;"></div>
    <div style="margin-bottom:6px;">
      <div style="font-size:10px;color:var(--muted);margin-bottom:6px;">Ellipse Shape</div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <svg width="36" height="20"><ellipse cx="18" cy="10" rx="16" ry="6" fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.7)" stroke-width="1"/></svg>
        <span style="font-size:10px;">Width = Elderly ratio</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <svg width="36" height="28"><ellipse cx="18" cy="14" rx="8" ry="12" fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.7)" stroke-width="1"/></svg>
        <span style="font-size:10px;">Height = Children ratio</span>
      </div>
      <div style="font-size:9px;color:var(--muted);margin-top:2px;">Larger ellipse = more vulnerable population</div>
    </div>
  `;
}

/* ── Select area highlight ── */
function q3SelectArea(areaData) {
  q3SelectedArea = areaData;

  // Update map highlight
  if (q3Map && q3Map.getLayer('q3-highlight')) {
    q3Map.setPaintProperty('q3-highlight', 'line-opacity', [
      'case',
      ['==', ['upcase', ['get', 'PLN_AREA_N']], areaData.name.toUpperCase()],
      1, 0,
    ]);
  }

  // Update sidebar detail
  renderQ3AreaDetail(areaData);
}

/* ═══════════════════════════════════════════════════════════════════
   SIDEBAR
   ═══════════════════════════════════════════════════════════════════ */
function renderQ3Sidebar() {
  const container = document.getElementById('q3-sidebar-content');
  if (!container) return;

  const data = q3Data;
  if (!data.length) {
    container.innerHTML = '<div style="color:var(--muted);padding:20px;">No data loaded.</div>';
    return;
  }

  const totalAreas = data.length;
  const avgShelter = q3Mean(data.map(d => d.shelter_ratio)) * 100;
  const avgVuln = q3Mean(data.map(d => d.vulnerable_ratio)) * 100;

  const cases = q3FindCaseStudies(data);

  // Correlation analysis: do areas with higher vulnerable ratios tend to have lower shelter?
  const correlation = q3ComputeCorrelation(data);

  let html = '';

  // Stats cards
  html += `<div class="stats-row">
    <div class="stat-card">
      <div class="label">Planning Areas</div>
      <div class="value">${totalAreas}</div>
    </div>
    <div class="stat-card">
      <div class="label">Avg Shelter</div>
      <div class="value" style="color:${shelterColor(avgShelter / 100)};">${avgShelter.toFixed(1)}%</div>
    </div>
    <div class="stat-card">
      <div class="label">Avg Vulnerable</div>
      <div class="value" style="color:#ce93d8;">${avgVuln.toFixed(1)}%</div>
    </div>
  </div>`;

  // Overall analysis
  html += `<div class="narrative">
    <div class="section-tag"><span class="dot" style="background:var(--accent);"></span> Overall Analysis</div>
    <p>This view maps <strong>shelter coverage</strong> (polygon color) against <strong>vulnerable population composition</strong> (ellipse size) for each planning area.</p>
    <p style="margin-top:8px;">Correlation between vulnerable ratio and shelter ratio: <strong style="color:${correlation >= 0 ? 'var(--green)' : 'var(--red)'};">${correlation >= 0 ? '+' : ''}${correlation.toFixed(3)}</strong>
    ${correlation < -0.1
      ? ' — areas with more vulnerable residents tend to have <strong style="color:var(--red);">worse shelter coverage</strong>, suggesting systemic inequity.'
      : correlation > 0.1
        ? ' — areas with more vulnerable residents tend to have <strong style="color:var(--green);">better shelter coverage</strong>, suggesting shelter planning accounts for demographic needs.'
        : ' — no strong linear relationship between vulnerability and shelter coverage.'}
    </p>
  </div>`;

  // Case studies
  if (cases.caseA) {
    html += q3RenderCaseCard('A', 'High Vulnerability + Poor Shelter', cases.caseA,
      'var(--red)', 'This area has a large proportion of elderly and children but relatively low sheltered walkway coverage — a priority for infrastructure investment.',
      'Mature HDB estate with aging demographics');
  }
  if (cases.caseB) {
    html += q3RenderCaseCard('B', 'Low Vulnerability + Poor Shelter', cases.caseB,
      'var(--orange)', 'Low shelter ratio here is less concerning since the area has fewer vulnerable residents. Likely a commercial or industrial zone.',
      'CBD or industrial area');
  }
  if (cases.caseC) {
    html += q3RenderCaseCard('C', 'High Vulnerability + Good Shelter', cases.caseC,
      'var(--green)', 'Despite high vulnerability ratios, this area has adequate shelter coverage. This may reflect good planning, or that absolute population is small even if ratios are high.',
      'Well-planned residential area or small population');
  }

  // Click prompt
  html += `<div class="insight" id="q3-click-prompt">
    <strong>Click any planning area</strong> on the map to see detailed demographic and shelter statistics.
  </div>`;

  // Area detail section (populated on click)
  html += `<div id="q3-area-detail"></div>`;

  container.innerHTML = html;
}

function q3RenderCaseCard(label, title, area, color, explanation, archetype) {
  const displayName = q3TitleCase(area.name);
  return `<div class="narrative" style="cursor:pointer;" onclick="q3SelectArea(q3Data.find(d=>d.name==='${area.name}'))">
    <div class="section-tag"><span class="dot" style="background:${color};"></span> Case ${label}: ${title}</div>
    <div style="margin-bottom:6px;">
      <span class="station-tag ${label === 'A' ? 'red' : label === 'B' ? 'blue' : 'green'}"
        style="font-size:11px;">${displayName}</span>
      <span style="font-size:10px;color:var(--muted);margin-left:6px;">${archetype}</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin:8px 0;">
      <div style="font-size:10px;color:var(--muted);">Shelter<br><strong style="color:${shelterColor(area.shelter_ratio)};font-size:13px;">${(area.shelter_ratio * 100).toFixed(1)}%</strong></div>
      <div style="font-size:10px;color:var(--muted);">Elderly<br><strong style="color:var(--text);font-size:13px;">${(area.elderly_ratio * 100).toFixed(1)}%</strong></div>
      <div style="font-size:10px;color:var(--muted);">Children<br><strong style="color:var(--text);font-size:13px;">${(area.children_ratio * 100).toFixed(1)}%</strong></div>
    </div>
    <p style="font-size:11px;color:#9fa8b8;">${explanation}</p>
  </div>`;
}

/* ── Area detail (shown on click) ── */
function renderQ3AreaDetail(areaData) {
  const container = document.getElementById('q3-area-detail');
  if (!container) return;

  // Hide click prompt
  const prompt = document.getElementById('q3-click-prompt');
  if (prompt) prompt.style.display = 'none';

  const d = areaData;
  const displayName = q3TitleCase(d.name);
  const totalVuln = d.elderly_count + d.children_count;

  // Rank among all areas
  const shelterRank = q3Data.filter(x => x.shelter_ratio < d.shelter_ratio).length + 1;
  const vulnRank = q3Data.filter(x => x.vulnerable_ratio > d.vulnerable_ratio).length + 1;

  let html = `
    <div style="border-top:1px solid var(--border);margin:12px 0;"></div>
    <div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;color:var(--accent);font-weight:700;margin-bottom:10px;">Selected Area Detail</div>
    <div style="font-size:16px;font-weight:700;margin-bottom:4px;">${displayName}</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:14px;">Population: ${d.total_population.toLocaleString()}</div>

    <div class="stats-row" style="grid-template-columns:1fr 1fr;">
      <div class="stat-card">
        <div class="label">Shelter Ratio</div>
        <div class="value" style="color:${shelterColor(d.shelter_ratio)};">${(d.shelter_ratio * 100).toFixed(1)}%</div>
        <div class="detail">Rank: #${shelterRank} of ${q3Data.length}</div>
      </div>
      <div class="stat-card">
        <div class="label">Vulnerable Ratio</div>
        <div class="value" style="color:#ce93d8;">${(d.vulnerable_ratio * 100).toFixed(1)}%</div>
        <div class="detail">Rank: #${vulnRank} of ${q3Data.length}</div>
      </div>
    </div>

    <div class="score-section">
      <div class="title">Demographic Breakdown</div>
      <div class="metric-row">
        <span class="metric-label">Elderly (65+)</span>
        <div class="metric-bar-bg"><div class="metric-bar" style="width:${Math.min(d.elderly_ratio / 0.3 * 100, 100)}%;background:#ff9800;"></div></div>
        <span class="metric-value">${d.elderly_count.toLocaleString()}</span>
        <span style="font-size:10px;color:var(--muted);margin-left:4px;">(${(d.elderly_ratio * 100).toFixed(1)}%)</span>
      </div>
      <div class="metric-row">
        <span class="metric-label">Children (&lt;15)</span>
        <div class="metric-bar-bg"><div class="metric-bar" style="width:${Math.min(d.children_ratio / 0.2 * 100, 100)}%;background:#4fc3f7;"></div></div>
        <span class="metric-value">${d.children_count.toLocaleString()}</span>
        <span style="font-size:10px;color:var(--muted);margin-left:4px;">(${(d.children_ratio * 100).toFixed(1)}%)</span>
      </div>
      <div class="metric-row" style="border-color:var(--accent);">
        <span class="metric-label" style="font-weight:600;">Total Vulnerable</span>
        <div class="metric-bar-bg"><div class="metric-bar" style="width:${Math.min(d.vulnerable_ratio / 0.4 * 100, 100)}%;background:#ce93d8;"></div></div>
        <span class="metric-value" style="color:#ce93d8;">${totalVuln.toLocaleString()}</span>
        <span style="font-size:10px;color:var(--muted);margin-left:4px;">(${(d.vulnerable_ratio * 100).toFixed(1)}%)</span>
      </div>
    </div>

    <div class="insight">
      ${d.vulnerable_ratio > q3Mean(q3Data.map(x => x.vulnerable_ratio)) && d.shelter_ratio < q3Mean(q3Data.map(x => x.shelter_ratio))
        ? `<strong>Priority area:</strong> ${displayName} has above-average vulnerability (${(d.vulnerable_ratio * 100).toFixed(1)}%) but below-average shelter coverage (${(d.shelter_ratio * 100).toFixed(1)}%). This area would benefit from infrastructure investment.`
        : d.vulnerable_ratio > q3Mean(q3Data.map(x => x.vulnerable_ratio))
          ? `<strong>${displayName}</strong> has above-average vulnerability but adequate shelter. Continued maintenance of walkway infrastructure is recommended.`
          : d.shelter_ratio < q3Mean(q3Data.map(x => x.shelter_ratio))
            ? `<strong>${displayName}</strong> has below-average shelter coverage, but lower vulnerability reduces urgency. Shelter improvements would still benefit general commuters.`
            : `<strong>${displayName}</strong> has adequate shelter coverage relative to its demographic profile.`
      }
    </div>
  `;

  container.innerHTML = html;

  // Scroll to detail
  container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ── Pearson correlation helper ── */
function q3ComputeCorrelation(data) {
  const n = data.length;
  if (n < 3) return 0;

  const xs = data.map(d => d.vulnerable_ratio);
  const ys = data.map(d => d.shelter_ratio);
  const mx = q3Mean(xs);
  const my = q3Mean(ys);

  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }

  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : num / denom;
}
