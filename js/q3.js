/* ═══════════════════════════════════════════════════════════════════
   Q3 — Vulnerable Populations vs Shelter Coverage by Planning Area
   ═══════════════════════════════════════════════════════════════════ */

let q3Map = null;
let q3Markers = [];
let q3SelectedArea = null;
let q3Data = [];

/* ── Constants ── */
const Q3_MAX_CIRCLE_RADIUS = 32; // px
const Q3_MIN_CIRCLE_RADIUS = 6;  // px

/* ── Helpers ── */
function q3Mean(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

function q3TitleCase(s) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/* Reuse mismatchColor from common.js: green(0) → yellow → orange → red(1) */
function q3UrgencyColor(urgency) {
  return mismatchColor(Math.max(0, Math.min(1, urgency)));
}

/* Compute normalized urgency score for a data point */
let _q3UrgencyCache = null;
function q3ComputeUrgencies() {
  if (_q3UrgencyCache) return _q3UrgencyCache;
  const vulns = q3Data.map(d => d.vulnerable_ratio);
  const shelters = q3Data.map(d => d.shelter_ratio);
  const minV = Math.min(...vulns), maxV = Math.max(...vulns), rangeV = maxV - minV || 1;
  const minS = Math.min(...shelters), maxS = Math.max(...shelters), rangeS = maxS - minS || 1;
  _q3UrgencyCache = {};
  q3Data.forEach(d => {
    const vn = (d.vulnerable_ratio - minV) / rangeV;
    const sn = (d.shelter_ratio - minS) / rangeS;
    _q3UrgencyCache[d.name] = vn * (1 - sn);  // high vuln + low shelter = high urgency
  });
  return _q3UrgencyCache;
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
    addQ3Legend();
  });
}

/* ── Choropleth layer (planning area polygons colored by shelter ratio) ── */
function addQ3Choropleth() {
  const regions = window.REGIONS;
  if (!regions || !q3Data.length) return;

  // Build lookup
  const dataLookup = {};
  q3Data.forEach(d => { dataLookup[d.name.toUpperCase()] = d; });

  const coloredFeatures = regions.features.map(f => {
    const areaName = (f.properties.PLN_AREA_N || '').toUpperCase();
    const hasData = areaName in dataLookup ? 1 : 0;
    return { ...f, properties: { ...f.properties, _hasData: hasData } };
  });

  const geojson = { type: 'FeatureCollection', features: coloredFeatures };
  q3Map.addSource('q3-regions', { type: 'geojson', data: geojson });

  // Fill layer colored by urgency
  const urgencies = q3ComputeUrgencies();
  const coloredFeatures2 = geojson.features.map(f => {
    const areaName = (f.properties.PLN_AREA_N || '').toUpperCase();
    const d = dataLookup[areaName];
    const color = d ? q3UrgencyColor(urgencies[d.name] || 0) : '#1a1f2a';
    return { ...f, properties: { ...f.properties, _urgencyColor: color } };
  });
  q3Map.getSource('q3-regions').setData({ type: 'FeatureCollection', features: coloredFeatures2 });

  q3Map.addLayer({
    id: 'q3-fill',
    type: 'fill',
    source: 'q3-regions',
    paint: {
      'fill-color': ['get', '_urgencyColor'],
      'fill-opacity': ['case', ['==', ['get', '_hasData'], 1], 0.6, 0.05],
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

/* ── Proportional circle markers: size=vuln count, color=urgency ── */
function addQ3Circles() {
  if (!q3Data.length) return;

  q3Markers.forEach(m => m.remove());
  q3Markers = [];

  const urgencies = q3ComputeUrgencies();
  const vulnCounts = q3Data.map(d => d.elderly_count + d.children_count);
  const maxVuln = Math.max(...vulnCounts);

  q3Data.forEach(d => {
    const vulnCount = d.elderly_count + d.children_count;
    const r = Q3_MIN_CIRCLE_RADIUS + Math.sqrt(vulnCount / (maxVuln || 1)) * (Q3_MAX_CIRCLE_RADIUS - Q3_MIN_CIRCLE_RADIUS);
    const urgency = urgencies[d.name] || 0;
    const fillColor = q3UrgencyRGBA(urgency, 0.55);
    const strokeColor = q3UrgencyRGBA(urgency, 0.9);

    const svgSize = Math.ceil(r * 2 + 4);
    const cx = svgSize / 2;

    const svg = `<svg width="${svgSize}" height="${svgSize}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${cx}" cy="${cx}" r="${r}"
        fill="${fillColor}" stroke="${strokeColor}" stroke-width="1.5"/>
    </svg>`;

    const el = document.createElement('div');
    el.innerHTML = svg;
    el.style.cursor = 'pointer';
    el.title = `${q3TitleCase(d.name)}\nUrgency: ${(urgency * 100).toFixed(0)}%\nVulnerable: ${vulnCount.toLocaleString()} (${(d.vulnerable_ratio * 100).toFixed(1)}%)\nShelter: ${(d.shelter_ratio * 100).toFixed(1)}%`;
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
    <div style="margin-bottom:6px;">
      <div style="font-size:10px;color:var(--muted);margin-bottom:4px;">Area Color = Improvement Urgency</div>
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="font-size:10px;color:${q3UrgencyColor(0)};">Low</span>
        <div style="flex:1;height:10px;border-radius:5px;background:linear-gradient(to right, ${[0,0.25,0.5,0.75,1].map(t => q3UrgencyColor(t)).join(', ')});"></div>
        <span style="font-size:10px;color:${q3UrgencyColor(1)};">Critical</span>
      </div>
      <div style="font-size:9px;color:var(--muted);margin-top:3px;">High Vulnerability × Low Shelter = Red</div>
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
      <div class="value" style="color:${q3UrgencyColor(0.6)};">${avgShelter.toFixed(1)}%</div>
    </div>
    <div class="stat-card">
      <div class="label">Avg Vulnerable</div>
      <div class="value" style="color:#ce93d8;">${avgVuln.toFixed(1)}%</div>
    </div>
  </div>`;

  // Overall analysis
  html += `<div class="narrative">
    <div class="section-tag"><span class="dot" style="background:var(--accent);"></span> Overall Analysis</div>
    <p>Each planning area is colored by <strong>improvement urgency</strong> — combining vulnerable population ratio with shelter deficit. <strong>Red</strong> = high vulnerability × low shelter (needs priority investment). <strong>Teal</strong> = lower urgency.</p>
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
      <div style="font-size:10px;color:var(--muted);">Shelter<br><strong style="color:${q3UrgencyColor(q3ComputeUrgencies()[area.name] || 0)};font-size:13px;">${(area.shelter_ratio * 100).toFixed(1)}%</strong></div>
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
        <div class="value" style="color:${q3UrgencyColor(q3ComputeUrgencies()[d.name] || 0)};">${(d.shelter_ratio * 100).toFixed(1)}%</div>
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
