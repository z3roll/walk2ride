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
    const bw = Math.max(1.5, std(vals) * 0.4 || 2);
    const kdePoints = kde(vals, bw, 60);
    const maxD = Math.max(...kdePoints.map(p => p[1]));
    maxDensityGlobal.push(maxD);
    kdeResults[cat] = { kde: kdePoints, vals, maxD };
  });

  const globalMaxD = Math.max(...maxDensityGlobal, 0.001);
  const violinHalfWidth = 0.38; // in category index units

  // Custom violin series
  series.push({
    type: 'custom',
    renderItem: function(params, api) {
      const catIdx = params.dataIndex;
      const cat = categories[catIdx];
      const info = kdeResults[cat];
      if (!info || !info.kde.length) return;

      const normalizer = info.maxD || globalMaxD;
      const points = [];
      // Right side
      for (let i = 0; i < info.kde.length; i++) {
        const [y, d] = info.kde[i];
        const normD = (d / normalizer) * violinHalfWidth;
        const px = api.coord([catIdx + normD, y]);
        points.push(px);
      }
      // Left side (mirror)
      for (let i = info.kde.length - 1; i >= 0; i--) {
        const [y, d] = info.kde[i];
        const normD = (d / normalizer) * violinHalfWidth;
        const px = api.coord([catIdx - normD, y]);
        points.push(px);
      }

      return {
        type: 'polygon',
        shape: { points },
        style: {
          fill: colors[cat] || '#888',
          opacity: 0.25,
          stroke: colors[cat] || '#888',
          lineWidth: 1.5,
          opacity: 0.35,
        },
      };
    },
    data: categories.map((_, i) => [i]),
    z: 1,
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
        const leftPx = api.coord([catIdx - 0.12, q1]);
        const rightPx = api.coord([catIdx + 0.12, q3]);
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
        const left = api.coord([catIdx - 0.15, med]);
        const right = api.coord([catIdx + 0.15, med]);
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
      data: [[catIdx, m]],
      symbol: 'diamond',
      symbolSize: 10,
      itemStyle: { color: '#fff', borderColor: color, borderWidth: 2 },
      z: 5,
      silent: true,
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
        itemStyle: { color: color, opacity: 0.35 },
      };
    });
    series.push({
      type: 'scatter',
      data: scatterData,
      symbolSize: 3,
      z: 2,
      silent: true,
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
      axisLabel: { color: '#888', fontSize: 12, fontWeight: 600 },
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

  // Build school colors (all yellow-ish)
  const schoolColors = {};
  topSchoolAreas.forEach(a => { schoolColors[a] = '#ffeb3b'; });
  const healthColors = {};
  topHealthAreas.forEach(a => { healthColors[a] = '#ef6c00'; });

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
        mapped[a.charAt(0) + a.slice(1).toLowerCase()] = '#ffeb3b';
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
        mapped[a.charAt(0) + a.slice(1).toLowerCase()] = '#ef6c00';
      });
      return mapped;
    })(),
    'Healthcare — Shelter Ratio by Planning Area (Top 8)'
  );

  // Store for toggling
  window._q2RegionalSchoolOpt = schoolOpt;
  window._q2RegionalHealthOpt = healthOpt;

  q2RegionalChart.setOption(schoolOpt, true);
}

function q2SwitchRegional(type) {
  document.querySelectorAll('.q2-regional-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.rtype === type);
  });
  if (!q2RegionalChart) return;
  if (type === 'school' && window._q2RegionalSchoolOpt) {
    q2RegionalChart.setOption(window._q2RegionalSchoolOpt, true);
  } else if (type === 'health' && window._q2RegionalHealthOpt) {
    q2RegionalChart.setOption(window._q2RegionalHealthOpt, true);
  }
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
  // Re-render into the container since it may have been hidden
  if (q2CurrentTab === 'overview') {
    if (q2Chart) {
      q2Chart.resize();
    } else {
      renderQ2Chart();
    }
  } else {
    if (q2RegionalChart) {
      q2RegionalChart.resize();
    } else {
      renderQ2Regional();
    }
  }
}
