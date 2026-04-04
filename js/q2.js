/* ═══════════════════════════════════════════════════════════════════
   Q2 — Violin plots: Service connectivity & shelter ratio analysis
   ═══════════════════════════════════════════════════════════════════ */

let q2Chart = null;
let q2RegionalChart = null;
let q2CurrentTab = 'overview';

const TYPE_COLORS = {
  School: '#ffeb3b',
  Healthcare: '#ef6c00',
  HDB: '#4fc3f7',
  Commercial: '#ce93d8',
};

const TYPE_ORDER = ['School', 'Healthcare', 'HDB', 'Commercial'];

/* ── KDE (Gaussian kernel) ── */
function kde(data, bandwidth, nPoints) {
  if (!data.length) return [];
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min;
  if (range === 0) return [[min, 1]];
  const step = range / nPoints;
  const points = [];
  for (let x = min; x <= max + step * 0.5; x += step) {
    let density = 0;
    for (const d of data) {
      density += Math.exp(-0.5 * ((x - d) / bandwidth) ** 2);
    }
    density /= (data.length * bandwidth * Math.sqrt(2 * Math.PI));
    points.push([x, density]);
  }
  return points;
}

/* ── Stats helpers ── */
function mean(arr) { return arr.reduce((s, v) => s + v, 0) / arr.length; }
function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function std(arr) {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}
function quantile(arr, q) {
  const sorted = [...arr].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN VIOLIN PLOT (by service type)
   ═══════════════════════════════════════════════════════════════════ */
function buildViolinOption(categories, dataByCategory, colors, title) {
  const series = [];
  const maxDensityGlobal = [];

  // Precompute KDE for each category
  const kdeResults = {};
  categories.forEach(cat => {
    const vals = (dataByCategory[cat] || []).map(d => d.shelter_ratio * 100);
    if (!vals.length) { kdeResults[cat] = { kde: [], vals }; return; }
    const bw = Math.max(2, std(vals) * 0.6 || 3);
    const kdePoints = kde(vals, bw, 60);
    const maxD = Math.max(...kdePoints.map(p => p[1]));
    maxDensityGlobal.push(maxD);
    kdeResults[cat] = { kde: kdePoints, vals, maxD };
  });

  const globalMaxD = Math.max(...maxDensityGlobal, 0.001);
  const violinMaxPx = 45; // max half-width in pixels

  // Custom violin series — one per category for correct pixel mapping
  categories.forEach((cat, catIdx) => {
    const info = kdeResults[cat];
    if (!info || !info.kde.length) return;

    series.push({
      type: 'custom',
      renderItem: function(params, api) {
        // Get the center x pixel for this category
        const centerPx = api.coord([catIdx, 0]);
        const cx = centerPx[0];

        const normalizer = globalMaxD;
        const points = [];
        // Right side
        for (let i = 0; i < info.kde.length; i++) {
          const [y, d] = info.kde[i];
          const widthPx = (d / normalizer) * violinMaxPx;
          const yPx = api.coord([0, y])[1];
          points.push([cx + widthPx, yPx]);
        }
        // Left side (mirror)
        for (let i = info.kde.length - 1; i >= 0; i--) {
          const [y, d] = info.kde[i];
          const widthPx = (d / normalizer) * violinMaxPx;
          const yPx = api.coord([0, y])[1];
          points.push([cx - widthPx, yPx]);
        }

        return {
          type: 'polygon',
          shape: { points },
          style: {
            fill: colors[cat] || '#888',
            opacity: 0.3,
            stroke: colors[cat] || '#888',
            lineWidth: 1.5,
          },
        };
      },
      data: [[catIdx, 0]],
      z: 1,
    });
  });

  // Boxplot-like elements (median line, Q1-Q3 box)
  categories.forEach((cat, catIdx) => {
    const vals = kdeResults[cat].vals;
    if (!vals.length) return;
    const q1 = quantile(vals, 0.25);
    const q3 = quantile(vals, 0.75);
    const med = median(vals);
    const m = mean(vals);
    const color = colors[cat] || '#888';

    // IQR box
    series.push({
      type: 'custom',
      renderItem: function(params, api) {
        const center = api.coord([catIdx, q1]);
        const topPx = api.coord([catIdx, q3]);
        const leftPx = [center[0] - 12, center[1]];
        const rightPx = [center[0] + 12, topPx[1]];
        return {
          type: 'rect',
          shape: {
            x: leftPx[0],
            y: rightPx[1],
            width: rightPx[0] - leftPx[0],
            height: leftPx[1] - rightPx[1],
          },
          style: {
            fill: 'transparent',
            stroke: color,
            lineWidth: 2,
            opacity: 0.7,
          },
        };
      },
      data: [[catIdx]],
      z: 3,
    });

    // Median line
    series.push({
      type: 'custom',
      renderItem: function(params, api) {
        const center = api.coord([catIdx, med]);
        const left = [center[0] - 16, center[1]];
        const right = [center[0] + 16, center[1]];
        return {
          type: 'line',
          shape: { x1: left[0], y1: left[1], x2: right[0], y2: right[1] },
          style: { stroke: '#fff', lineWidth: 2.5 },
        };
      },
      data: [[catIdx]],
      z: 4,
    });

    // Mean marker
    series.push({
      type: 'scatter',
      data: [{ value: [catIdx, m], _catIdx: catIdx }],
      symbol: 'diamond',
      symbolSize: 10,
      itemStyle: { color: '#fff', borderColor: color, borderWidth: 2 },
      z: 5,
    });
  });

  // Jittered scatter points
  categories.forEach((cat, catIdx) => {
    const vals = kdeResults[cat].vals;
    if (!vals.length) return;
    const color = colors[cat] || '#888';
    const scatterData = vals.map(v => {
      const jitter = (Math.random() - 0.5) * 0.28;
      return {
        value: [catIdx + jitter, v],
        _catIdx: catIdx,
        itemStyle: { color: color, opacity: 0.35 },
      };
    });
    series.push({
      type: 'scatter',
      data: scatterData,
      symbolSize: 3,
      z: 2,
    });
  });

  return {
    backgroundColor: '#0f1117',
    animation: true,
    animationDuration: 600,
    title: {
      text: title,
      left: 'center',
      top: 12,
      textStyle: { fontSize: 14, fontWeight: 600, color: '#ccc' },
    },
    grid: { left: 70, right: 40, top: 55, bottom: 60 },
    tooltip: {
      trigger: 'item',
      backgroundColor: '#1e222bf0',
      borderColor: '#3a3f4a',
      textStyle: { color: '#e8eaed', fontSize: 12 },
      formatter: function(p) {
        if (p.seriesType === 'scatter' && p.data && p.data.value) {
          const ci = Math.round(p.data.value[0]);
          const cat = categories[ci] || '';
          return `<b>${cat}</b><br>Shelter ratio: <b>${p.data.value[1].toFixed(1)}%</b>`;
        }
        return '';
      },
    },
    xAxis: {
      type: 'category',
      data: categories,
      axisLabel: { color: '#888', fontSize: 10, fontWeight: 600, interval: 0 },
      axisLine: { lineStyle: { color: '#2a2f3a' } },
      splitLine: { show: false },
    },
    yAxis: {
      name: 'Shelter Ratio (%)',
      nameLocation: 'middle',
      nameGap: 48,
      nameTextStyle: { fontSize: 12, color: '#888' },
      type: 'value',
      axisLabel: { formatter: v => v + '%', color: '#666', fontSize: 10 },
      splitLine: { lineStyle: { color: '#1c2029' } },
      axisLine: { lineStyle: { color: '#2a2f3a' } },
    },
    series,
  };
}

/* ═══════════════════════════════════════════════════════════════════
   RENDER MAIN Q2 CHART
   ═══════════════════════════════════════════════════════════════════ */
function renderQ2Chart() {
  const services = window.SERVICES;
  if (!services || !services.length) return;

  const byType = {};
  TYPE_ORDER.forEach(t => { byType[t] = []; });
  services.forEach(s => {
    if (byType[s.type]) byType[s.type].push(s);
  });

  if (!q2Chart) q2Chart = echarts.init(document.getElementById('q2-chart'), 'dark');
  q2Chart.setOption(
    buildViolinOption(TYPE_ORDER, byType, TYPE_COLORS,
      'Shelter Ratio Distribution by Service Type — ' + services.length + ' Services'),
    true
  );
}

/* ═══════════════════════════════════════════════════════════════════
   RENDER REGIONAL BREAKDOWN
   ═══════════════════════════════════════════════════════════════════ */
function renderQ2Regional() {
  const services = window.SERVICES;
  if (!services || !services.length) return;

  // Schools by planning area (top 8)
  const schoolsByArea = {};
  const healthByArea = {};
  services.forEach(s => {
    if (s.type === 'School') {
      if (!schoolsByArea[s.planning_area]) schoolsByArea[s.planning_area] = [];
      schoolsByArea[s.planning_area].push(s);
    }
    if (s.type === 'Healthcare') {
      if (!healthByArea[s.planning_area]) healthByArea[s.planning_area] = [];
      healthByArea[s.planning_area].push(s);
    }
  });

  const topSchoolAreas = Object.entries(schoolsByArea)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 8)
    .map(e => e[0]);

  const topHealthAreas = Object.entries(healthByArea)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 8)
    .map(e => e[0]);

  // Distinct colors per area
  const AREA_PALETTE = ['#4fc3f7','#ffeb3b','#ef6c00','#ce93d8','#4caf50','#ff7043','#26c6da','#ec407a'];
  const schoolColors = {};
  topSchoolAreas.forEach((a, i) => { schoolColors[a] = AREA_PALETTE[i % AREA_PALETTE.length]; });
  const healthColors = {};
  topHealthAreas.forEach((a, i) => { healthColors[a] = AREA_PALETTE[i % AREA_PALETTE.length]; });

  if (!q2RegionalChart) q2RegionalChart = echarts.init(document.getElementById('q2-chart'), 'dark');

  // Combine into one chart with two y-axis groups using a split layout
  // We will render them stacked vertically via two grids
  const schoolData = {};
  topSchoolAreas.forEach(a => { schoolData[a] = schoolsByArea[a]; });
  const healthData = {};
  topHealthAreas.forEach(a => { healthData[a] = healthByArea[a]; });

  // Use a single chart with togglable sub-views: render schools first
  const schoolOpt = buildViolinOption(
    topSchoolAreas.map(a => a.charAt(0) + a.slice(1).toLowerCase()),
    (() => {
      const mapped = {};
      topSchoolAreas.forEach(a => {
        mapped[a.charAt(0) + a.slice(1).toLowerCase()] = schoolsByArea[a];
      });
      return mapped;
    })(),
    (() => {
      const mapped = {};
      topSchoolAreas.forEach(a => {
        mapped[a.charAt(0) + a.slice(1).toLowerCase()] = schoolColors[a];
      });
      return mapped;
    })(),
    'Schools — Shelter Ratio by Planning Area (Top 8)'
  );

  const healthOpt = buildViolinOption(
    topHealthAreas.map(a => a.charAt(0) + a.slice(1).toLowerCase()),
    (() => {
      const mapped = {};
      topHealthAreas.forEach(a => {
        mapped[a.charAt(0) + a.slice(1).toLowerCase()] = healthByArea[a];
      });
      return mapped;
    })(),
    (() => {
      const mapped = {};
      topHealthAreas.forEach(a => {
        mapped[a.charAt(0) + a.slice(1).toLowerCase()] = healthColors[a];
      });
      return mapped;
    })(),
    'Healthcare — Shelter Ratio by Planning Area (Top 8)'
  );

  // Store for toggling + area name mapping
  window._q2RegionalSchoolOpt = schoolOpt;
  window._q2RegionalHealthOpt = healthOpt;
  window._q2RegionalSchoolAreas = topSchoolAreas;
  window._q2RegionalHealthAreas = topHealthAreas;
  window._q2RegionalCurrentType = 'school';

  q2RegionalChart.setOption(schoolOpt, true);
  setupQ2RegionalClick();
}

function setupQ2RegionalClick() {
  if (!q2RegionalChart) return;
  q2RegionalChart.off('click');
  q2RegionalChart.on('click', params => {
    let catIdx = -1;
    if (params.data && params.data._catIdx !== undefined) {
      catIdx = params.data._catIdx;
    } else if (params.data && params.data.value) {
      catIdx = Math.round(params.data.value[0]);
    }
    if (catIdx < 0) return;

    const isSchool = window._q2RegionalCurrentType === 'school';
    const areas = isSchool ? window._q2RegionalSchoolAreas : window._q2RegionalHealthAreas;
    const type = isSchool ? 'School' : 'Healthcare';
    if (catIdx < areas.length) {
      openQ2Map(areas[catIdx], type);
    }
  });
}

function q2SwitchRegional(type) {
  document.querySelectorAll('.q2-regional-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.rtype === type);
  });
  if (!q2RegionalChart) return;
  window._q2RegionalCurrentType = type;
  if (type === 'school' && window._q2RegionalSchoolOpt) {
    q2RegionalChart.setOption(window._q2RegionalSchoolOpt, true);
  } else if (type === 'health' && window._q2RegionalHealthOpt) {
    q2RegionalChart.setOption(window._q2RegionalHealthOpt, true);
  }
  setupQ2RegionalClick();
}

/* ═══════════════════════════════════════════════════════════════════
   SIDEBAR
   ═══════════════════════════════════════════════════════════════════ */
function renderQ2Sidebar() {
  const services = window.SERVICES;
  if (!services || !services.length) return;

  const total = services.length;
  const avgRatio = mean(services.map(s => s.shelter_ratio)) * 100;
  const underserved = services.filter(s => s.shelter_ratio < 0.10).length;

  // Per-type stats
  const typeStats = {};
  TYPE_ORDER.forEach(t => {
    const items = services.filter(s => s.type === t);
    const ratios = items.map(s => s.shelter_ratio * 100);
    typeStats[t] = {
      count: items.length,
      mean: ratios.length ? mean(ratios) : 0,
      median: ratios.length ? median(ratios) : 0,
      std: ratios.length ? std(ratios) : 0,
    };
  });

  document.getElementById('q2-sidebar-content').innerHTML = `
    <div class="stats-row">
      <div class="stat-card"><div class="label">Services</div><div class="value" style="color:var(--accent);">${total.toLocaleString()}</div></div>
      <div class="stat-card"><div class="label">Avg Shelter</div><div class="value" style="color:${avgRatio<15?'var(--orange)':'var(--green)'};">${avgRatio.toFixed(1)}%</div></div>
      <div class="stat-card"><div class="label">Underserved</div><div class="value" style="color:var(--red);">${underserved}</div><div class="detail">ratio &lt; 10%</div></div>
    </div>

    <div class="view-tabs">
      <button class="view-tab active" data-q2tab="overview" onclick="q2SwitchTab('overview')">Overview</button>
      <button class="view-tab" data-q2tab="regional" onclick="q2SwitchTab('regional')">Regional</button>
    </div>

    <div id="q2-tab-overview">
      <div class="narrative">
        <div class="section-tag"><div class="dot" style="background:var(--accent);"></div>Per-Type Summary</div>
        ${TYPE_ORDER.map(t => {
          const s = typeStats[t];
          const color = TYPE_COLORS[t];
          return `<div style="margin-bottom:10px;">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:6px;vertical-align:middle;"></span>
            <strong>${t}</strong> (n=${s.count})<br>
            <span style="margin-left:16px;font-size:11px;color:var(--muted);">
              Mean: <b style="color:var(--text);">${s.mean.toFixed(1)}%</b> &nbsp;|&nbsp;
              Median: <b style="color:var(--text);">${s.median.toFixed(1)}%</b> &nbsp;|&nbsp;
              Std: <b style="color:var(--text);">${s.std.toFixed(1)}%</b>
            </span>
          </div>`;
        }).join('')}
      </div>

      <div class="narrative">
        <div class="section-tag"><div class="dot" style="background:var(--yellow);"></div>Key Patterns</div>
        <strong>Schools</strong> show the widest spread in shelter ratios — from near 0% to over 40%. This suggests highly uneven shelter investment across educational institutions, possibly driven by school age (newer schools benefit from updated building codes) and proximity to MRT stations.<br><br>
        <strong>Healthcare</strong> facilities cluster at the low end, with most clinics and hospitals having minimal sheltered walkway connectivity. This is concerning given the vulnerability of patients and elderly visitors.<br><br>
        <strong>HDB</strong> estates show moderate and relatively consistent shelter coverage, reflecting systematic government planning of covered linkways in public housing precincts.<br><br>
        <strong>Commercial</strong> areas display a bimodal pattern — malls and integrated developments tend to have high shelter, while standalone commercial buildings often have very low coverage.
      </div>

      <div class="insight">
        <strong>Key Finding:</strong> Schools and healthcare facilities — serving the most vulnerable populations (children and the sick/elderly) — do not consistently receive better shelter coverage than commercial areas. The mean shelter ratio for healthcare (${typeStats['Healthcare'].mean.toFixed(1)}%) is notably ${typeStats['Healthcare'].mean < typeStats['Commercial'].mean ? 'lower' : 'higher'} than commercial (${typeStats['Commercial'].mean.toFixed(1)}%), challenging the assumption that vulnerability drives shelter investment.
      </div>
    </div>

    <div id="q2-tab-regional" style="display:none;">
      <div class="view-tabs" style="margin-bottom:12px;">
        <button class="view-tab q2-regional-tab active" data-rtype="school" onclick="q2SwitchRegional('school')">Schools</button>
        <button class="view-tab q2-regional-tab" data-rtype="health" onclick="q2SwitchRegional('health')">Healthcare</button>
      </div>

      <div class="narrative">
        <div class="section-tag"><div class="dot" style="background:#ffeb3b;"></div>Regional Disparities</div>
        Shelter coverage varies dramatically across planning areas. Mature HDB towns like <strong>Tampines</strong>, <strong>Bedok</strong>, and <strong>Ang Mo Kio</strong> generally provide better sheltered connectivity to schools, while newer developments and CBD-adjacent areas lag behind.<br><br>
        Healthcare facilities in <strong>central areas</strong> often have lower shelter ratios despite higher patient volumes, mirroring the demand-supply mismatch pattern observed in RQ1 for transit stations.
      </div>

      <div class="insight">
        <strong>Geographic Equity:</strong> Planning areas with high concentrations of elderly residents do not systematically have better shelter coverage for healthcare facilities. This geographic mismatch suggests that shelter investment follows <em>building age and planning era</em> more than <em>demographic need</em>.
      </div>
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════════════
   TAB SWITCHING
   ═══════════════════════════════════════════════════════════════════ */
function q2SwitchTab(tab) {
  q2CurrentTab = tab;
  document.querySelectorAll('[data-q2tab]').forEach(t => {
    t.classList.toggle('active', t.dataset.q2tab === tab);
  });
  document.getElementById('q2-tab-overview').style.display = tab === 'overview' ? 'block' : 'none';
  document.getElementById('q2-tab-regional').style.display = tab === 'regional' ? 'block' : 'none';

  if (tab === 'overview') {
    // Dispose regional chart if exists, re-init main
    if (q2RegionalChart) { q2RegionalChart.dispose(); q2RegionalChart = null; }
    q2Chart = null;
    renderQ2Chart();
  } else {
    // Dispose main chart, render regional
    if (q2Chart) { q2Chart.dispose(); q2Chart = null; }
    q2RegionalChart = null;
    renderQ2Regional();
  }
}

/* ═══════════════════════════════════════════════════════════════════
   INIT & SHOW
   ═══════════════════════════════════════════════════════════════════ */
function q2Init() {
  renderQ2Sidebar();
  renderQ2Chart();
}

function q2Show() {
  if (q2CurrentTab === 'overview') {
    if (q2Chart) q2Chart.resize(); else renderQ2Chart();
  } else {
    if (q2RegionalChart) q2RegionalChart.resize(); else renderQ2Regional();
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Q2 MAP VIEW — Planning Area detail
   ═══════════════════════════════════════════════════════════════════ */
let q2Map = null;
let q2MapCurrentType = 'School'; // which service type to show

function openQ2Map(areaName, serviceType) {
  const services = window.SERVICES.filter(s =>
    s.planning_area.toLowerCase() === areaName.toLowerCase() &&
    s.type === serviceType
  );
  if (!services.length) return;

  q2MapCurrentType = serviceType;

  // Find area boundary
  const regions = window.REGIONS;
  const areaFeature = regions.features.find(f =>
    (f.properties.PLN_AREA_N || '').toLowerCase() === areaName.toLowerCase()
  );

  // Switch views
  document.getElementById('q2-chart-view').style.display = 'none';
  document.getElementById('q2-map-view').style.display = 'flex';

  // Header
  const displayName = areaName.charAt(0) + areaName.slice(1).toLowerCase();
  document.getElementById('q2-map-area-name').textContent = displayName;
  document.getElementById('q2-map-area-sub').textContent =
    `${services.length} ${serviceType} facilities · Shelter ratio analysis`;

  // Sidebar
  renderQ2MapSidebar(services, displayName, serviceType);

  // Legend
  renderQ2MapLegend(services, serviceType);

  // Init map
  setTimeout(() => initQ2Map(services, areaFeature, serviceType), 50);
}

function q2BackToChart() {
  document.getElementById('q2-map-view').style.display = 'none';
  document.getElementById('q2-chart-view').style.display = 'flex';
  if (q2Map) { q2Map.remove(); q2Map = null; }
  if (q2CurrentTab === 'overview') {
    if (q2Chart) q2Chart.resize(); else renderQ2Chart();
  } else {
    if (q2RegionalChart) q2RegionalChart.resize(); else renderQ2Regional();
  }
}

function renderQ2MapSidebar(services, areaName, serviceType) {
  const ratios = services.map(s => s.shelter_ratio * 100);
  const avg = mean(ratios);
  const med = median(ratios);
  const underserved = services.filter(s => s.shelter_ratio < 0.1).length;
  const sorted = [...services].sort((a, b) => a.shelter_ratio - b.shelter_ratio);

  document.getElementById('q2-map-sidebar-content').innerHTML = `
    <div class="stats-row">
      <div class="stat-card"><div class="label">${serviceType}s</div><div class="value" style="color:var(--accent);">${services.length}</div></div>
      <div class="stat-card"><div class="label">Avg Shelter</div><div class="value" style="color:${avg<15?'var(--orange)':'var(--green)'};">${avg.toFixed(1)}%</div></div>
      <div class="stat-card"><div class="label">Underserved</div><div class="value" style="color:var(--red);">${underserved}</div><div class="detail">ratio &lt; 10%</div></div>
    </div>

    <div class="narrative">
      <div class="section-tag"><div class="dot" style="background:var(--accent);"></div>${areaName} — ${serviceType} Coverage</div>
      Median shelter ratio is <strong>${med.toFixed(1)}%</strong>.
      ${underserved > 0 ? `<strong>${underserved}</strong> of ${services.length} facilities have coverage below 10%, indicating significant shelter gaps.` : 'All facilities have at least 10% coverage.'}
    </div>

    <div class="score-section">
      <div class="title">All ${serviceType} Facilities (sorted by shelter ratio)</div>
      ${sorted.map((s, i) => {
        const color = shelterColor(s.shelter_ratio);
        return `<div class="metric-row" style="cursor:default;">
          <span style="color:${color};font-size:14px;margin-right:6px;">●</span>
          <span class="metric-label" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${s.name}</span>
          <span class="metric-value" style="color:${color};">${(s.shelter_ratio * 100).toFixed(1)}%</span>
        </div>`;
      }).join('')}
    </div>
  `;
}

function renderQ2MapLegend(services, serviceType) {
  document.getElementById('q2-map-legend').innerHTML = `
    <div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);font-weight:700;margin-bottom:8px;">Legend</div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
      <span style="font-weight:500;">Shelter Ratio</span>
    </div>
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
      <span style="color:#ef5350;">Low</span>
      <div style="width:80px;height:8px;border-radius:4px;background:linear-gradient(to right,#ef5350,#ff9800,#ffeb3b,#4caf50);"></div>
      <span style="color:#4caf50;">High</span>
    </div>
    <div style="height:1px;background:var(--border);margin:8px 0;"></div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
      <div style="width:10px;height:10px;border-radius:50%;background:#888;border:2px solid #fff;"></div>
      ${serviceType} facility
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
      <div style="width:14px;height:14px;border-radius:50%;border:2px dashed var(--accent);box-sizing:border-box;"></div>
      Planning Area boundary
    </div>
  `;
}

function initQ2Map(services, areaFeature, serviceType) {
  if (q2Map) { q2Map.remove(); q2Map = null; }

  // Compute center from services
  const lats = services.map(s => s.lat);
  const lngs = services.map(s => s.lng);
  const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;

  q2Map = new maplibregl.Map({
    container: 'q2-map',
    style: { version: 8,
      sources: {
        carto: { type: 'raster', tiles: ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'], tileSize: 256, attribution: '&copy; CartoDB &copy; OSM' }
      },
      layers: [{ id: 'carto', type: 'raster', source: 'carto', paint: { 'raster-opacity': 0.85 } }]
    },
    center: [centerLng, centerLat],
    zoom: 13,
    maxZoom: 18,
  });

  function onReady() { try {
    // Planning area boundary
    if (areaFeature) {
      q2Map.addSource('area-boundary', { type: 'geojson', data: areaFeature });
      q2Map.addLayer({ id: 'area-fill', type: 'fill', source: 'area-boundary',
        paint: { 'fill-color': '#4fc3f7', 'fill-opacity': 0.05 } });
      q2Map.addLayer({ id: 'area-line', type: 'line', source: 'area-boundary',
        paint: { 'line-color': '#4fc3f7', 'line-width': 2, 'line-dasharray': [4, 4], 'line-opacity': 0.6 } });
    }

    // Service points colored by shelter ratio
    const geojson = { type: 'FeatureCollection', features: services.map(s => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      properties: { name: s.name, shelter_ratio: s.shelter_ratio, color: shelterColor(s.shelter_ratio) }
    })) };

    q2Map.addSource('services', { type: 'geojson', data: geojson });
    q2Map.addLayer({ id: 'services-dot', type: 'circle', source: 'services',
      paint: {
        'circle-radius': 7,
        'circle-color': ['get', 'color'],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#fff',
        'circle-opacity': 0.9,
      }
    });

    // Labels as HTML markers
    services.forEach(s => {
      const el = document.createElement('div');
      el.style.cssText = 'color:' + shelterColor(s.shelter_ratio) + ';font-size:9px;font-weight:500;text-shadow:0 0 3px #000,0 0 6px #000;pointer-events:none;white-space:nowrap;transform:translateX(-50%);margin-top:6px;';
      el.textContent = s.name.length > 25 ? s.name.substring(0, 23) + '…' : s.name;
      new maplibregl.Marker({ element: el, anchor: 'top' }).setLngLat([s.lng, s.lat]).addTo(q2Map);
    });

    // Hover popup
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
    q2Map.on('mouseenter', 'services-dot', e => {
      q2Map.getCanvas().style.cursor = 'pointer';
      const p = e.features[0].properties;
      popup.setLngLat(e.lngLat)
        .setHTML(`<div style="font-size:12px;"><b>${p.name}</b><br>Shelter ratio: <b style="color:${p.color};">${(p.shelter_ratio * 100).toFixed(1)}%</b></div>`)
        .addTo(q2Map);
    });
    q2Map.on('mousemove', 'services-dot', e => { popup.setLngLat(e.lngLat); });
    q2Map.on('mouseleave', 'services-dot', () => { q2Map.getCanvas().style.cursor = ''; popup.remove(); });

    // Fit to area or services
    if (areaFeature) {
      const coords = areaFeature.geometry.type === 'MultiPolygon'
        ? areaFeature.geometry.coordinates.flat(2)
        : areaFeature.geometry.coordinates.flat(1);
      const bounds = new maplibregl.LngLatBounds();
      coords.forEach(c => bounds.extend(c));
      q2Map.fitBounds(bounds, { padding: 50 });
    } else {
      const bounds = new maplibregl.LngLatBounds();
      services.forEach(s => bounds.extend([s.lng, s.lat]));
      q2Map.fitBounds(bounds, { padding: 50 });
    }
  } catch(err) { console.error('Q2 map error:', err); } }

  if (q2Map.loaded()) onReady();
  else q2Map.on('load', onReady);
}
