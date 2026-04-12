/* ═══════════════════════════════════════════════════════════════════
   COMMON — shared data, utilities, and data loading
   ═══════════════════════════════════════════════════════════════════ */

let DATA = [];
const DETAILS = {};
window.SERVICES = [];

function shortName(s) {
  return s.replace(' MRT STATION', '').replace(' LRT STATION', '');
}

function norm(arr) {
  const mn = Math.min(...arr), mx = Math.max(...arr), r = mx - mn || 1;
  return arr.map(v => (v - mn) / r);
}

function computeScores(data) {
  const pvN = norm(data.map(d => d.passenger_volume));
  const rfN = norm(data.map(d => d.rainfall_mm));
  const srN = norm(data.map(d => d.shelter_ratio));
  data.forEach((d, i) => {
    d.demand = 0.6 * pvN[i] + 0.4 * rfN[i];
    d.supply = srN[i];
    d.mismatch = d.demand * (1 - d.supply);
    d.pv_norm = pvN[i]; d.rf_norm = rfN[i]; d.sr_norm = srN[i];
  });
  const msN = norm(data.map(d => d.mismatch));
  data.forEach((d, i) => { d.mismatch_norm = msN[i]; });
}

function mismatchColor(t) {
  const stops = [[0,[76,175,80]],[0.3,[205,220,57]],[0.55,[255,235,59]],[0.75,[255,152,0]],[1,[239,83,80]]];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t <= stops[i+1][0]) {
      const p = (t - stops[i][0]) / (stops[i+1][0] - stops[i][0]);
      const c = stops[i][1].map((v,j) => Math.round(v + (stops[i+1][1][j] - v) * p));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return 'rgb(239,83,80)';
}

function shelterColor(ratio) {
  // 0=red, 0.15=orange, 0.3=yellow, 0.5+=green
  const stops = [[0,[239,83,80]],[0.1,[255,152,0]],[0.2,[255,235,59]],[0.35,[76,175,80]]];
  for (let i = 0; i < stops.length - 1; i++) {
    if (ratio <= stops[i+1][0]) {
      const p = (ratio - stops[i][0]) / (stops[i+1][0] - stops[i][0]);
      const c = stops[i][1].map((v,j) => Math.round(v + (stops[i+1][1][j] - v) * p));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return 'rgb(76,175,80)';
}

async function loadData() {
  const [stationsResp, detailsResp, servicesResp, regionsResp, rq3Resp, analysisResp, blocksResp, chart1Resp, chart1DetailResp, chart2Resp, hdbLwResp, rq3AgeResp, rq3AreasResp] = await Promise.all([
    fetch('data/stations.json'),
    fetch('data/details.json'),
    fetch('data/services_shelter.json'),
    fetch('data/regions.geojson'),
    fetch('data/rq3_planning_areas.json?v=2'),
    fetch('data/analysis.json?v=4'),
    fetch('data/area_blocks.json?v=1'),
    fetch('data/area_chart1_400m.json?v=2'),
    fetch('data/area_chart1_detail.json?v=1'),
    fetch('data/area_chart2_400m.json?v=1'),
    fetch('data/hdb_linkway_length_200m.json?v=1'),
    fetch('data/rq3_age_hdb.json?v=1'),
    fetch('data/rq3_planning_areas.json')
  ]);
  DATA = await stationsResp.json();
  Object.assign(DETAILS, await detailsResp.json());
  window.SERVICES = await servicesResp.json();
  window.REGIONS = await regionsResp.json();
  window.RQ3_DATA = await rq3Resp.json();
  window.ANALYSIS = await analysisResp.json();
  const blocks = await blocksResp.json();
  window.AREA_BLOCKS = {};
  blocks.forEach(b => { window.AREA_BLOCKS[b.name] = b; });
  // Q2 Chart 1 data — 400m MRT/LRT buffer, residential HDB, r = +0.67
  const chart1 = await chart1Resp.json();
  window.AREA_CHART1 = {};
  chart1.areas.forEach(a => { window.AREA_CHART1[a.name] = a; });
  window.AREA_CHART1_R = chart1.pearson_r;
  // Q2 Chart 1 click-through detail: per-area buffer polygon + HDB + stations
  window.AREA_CHART1_DETAIL = await chart1DetailResp.json();
  // Q2 Chart 2 data: per-area HDB year distribution × linkway length (400m)
  window.AREA_CHART2 = await chart2Resp.json();
  // Q2 Chart 2 per-block linkway length within 200m of each residential HDB
  window.HDB_LW_LEN = await hdbLwResp.json();
  // Q3 data: per-area age distribution + mean HDB year + linkway length
  window.RQ3_AGE_HDB = await rq3AgeResp.json();
  window.RQ3_AREAS = await rq3AreasResp.json();

  // Build per-area raw single-year age lookup from respopagesex CSV
  // (loaded inline via a small fetch so q3 can compute custom age ranges)
  try {
    const popResp = await fetch('data/raw/respopagesex2025.csv');
    const popText = await popResp.text();
    const rawAge = {};
    popText.split('\n').slice(1).forEach(line => {
      const cols = line.split(',');
      if (cols.length < 5) return;
      const pa = (cols[0] || '').trim().toUpperCase();
      const age = cols[2] === '90_and_Over' ? 90 : parseInt(cols[2]);
      const pop = parseInt(cols[4]);
      if (isNaN(age) || isNaN(pop)) return;
      if (!rawAge[pa]) rawAge[pa] = {};
      rawAge[pa][age] = (rawAge[pa][age] || 0) + pop;
    });
    window._q3RawAge = rawAge;
  } catch (e) { console.warn('Could not load raw age CSV for Q3:', e); }

  computeScores(DATA);
  if (typeof window.onDataLoaded === 'function') window.onDataLoaded();
}

window.AREA_INFRA = null;
async function loadAreaInfra() {
  if (window.AREA_INFRA && window.AREA_INFRA._hdb_polygons) return window.AREA_INFRA;
  const resp = await fetch('data/area_infra.json?v=2');
  window.AREA_INFRA = await resp.json();
  return window.AREA_INFRA;
}

loadData();

/* ── RQ1 correlation chart popup (click to show, click outside to dismiss) ── */
function openQ1CorrPopup(e) {
  const popup = document.getElementById('chart-corr-wrap');
  if (!popup) return;
  if (popup.classList.contains('open')) { closeQ1CorrPopup(); return; }
  popup.classList.add('open');

  const W = 640, H = 420;
  const margin = 12;
  const gap = 14;              // distance between cursor and popup edge
  const pageW = window.innerWidth;
  const pageH = window.innerHeight;
  const cx = (e && e.clientX !== undefined) ? e.clientX : pageW / 2;
  const cy = (e && e.clientY !== undefined) ? e.clientY : pageH / 2;
  // Default: popup appears to the LEFT of the cursor.
  // If there is not enough room on the left, flip to the right.
  let left = cx - W - gap;
  if (left < margin) left = Math.min(pageW - W - margin, cx + gap);
  // Vertically centre on the cursor, clamped to viewport.
  let top = cy - H / 2;
  top = Math.max(margin, Math.min(pageH - H - margin, top));
  popup.style.left = Math.max(margin, left) + 'px';
  popup.style.top  = top + 'px';

  setTimeout(() => {
    if (typeof corrChart !== 'undefined' && corrChart) corrChart.resize();
  }, 40);
  if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
}

function closeQ1CorrPopup() {
  const popup = document.getElementById('chart-corr-wrap');
  if (popup) popup.classList.remove('open');
}

// Click outside (or Escape) closes the popup
document.addEventListener('click', function (e) {
  const popup = document.getElementById('chart-corr-wrap');
  if (!popup || !popup.classList.contains('open')) return;
  if (popup.contains(e.target)) return;
  // Don't close if the click was the trigger button itself
  if (e.target.closest && e.target.closest('.ch-btn')) return;
  closeQ1CorrPopup();
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') closeQ1CorrPopup();
});

window.openQ1CorrPopup = openQ1CorrPopup;
window.closeQ1CorrPopup = closeQ1CorrPopup;

/* ── Per-RQ chart toggle (Chart 1 / Chart 2 switcher) ── */
function setChartMode(rq, mode) {
  const cfg = {
    q2: { areaId: 'q2-chart-area',
          c1: () => (typeof q2Chart !== 'undefined' ? q2Chart : null),
          c2: () => (typeof q2TimelineChart !== 'undefined' ? q2TimelineChart : null) },
    q3: { areaId: 'q3-chart-area',
          c1: () => (typeof q3Chart1 !== 'undefined' ? q3Chart1 : null),
          c2: () => (typeof q3Chart2 !== 'undefined' ? q3Chart2 : null) },
  }[rq];
  if (!cfg) return;
  const area = document.getElementById(cfg.areaId);
  if (!area) return;
  area.classList.remove('show-chart1', 'show-chart2');
  area.classList.add(mode === 1 ? 'show-chart1' : 'show-chart2');
  area.querySelectorAll('.ch-btn').forEach((btn, i) => {
    btn.classList.toggle('active', i + 1 === mode);
  });
  // Give the layout a tick, then resize the now-visible echarts instance
  setTimeout(() => {
    const chart = mode === 1 ? cfg.c1() : cfg.c2();
    if (chart) chart.resize();
  }, 60);
}
window.setChartMode = setChartMode;

/* ═══════════════════════════════════════════════════════════════════
   Resizable sidebar — drag handle logic
   ═══════════════════════════════════════════════════════════════════ */
(function() {
  document.querySelectorAll('.resize-handle').forEach(handle => {
    const targetId = handle.dataset.target;
    let dragging = false, startX = 0, startW = 0;

    handle.addEventListener('mousedown', e => {
      const sidebar = document.getElementById(targetId);
      if (!sidebar) return;
      dragging = true;
      startX = e.clientX;
      startW = sidebar.offsetWidth;
      handle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    function resizeAll() {
      if (typeof chart !== 'undefined' && chart) chart.resize();
      if (typeof corrChart !== 'undefined' && corrChart) corrChart.resize();
      if (typeof q2Chart !== 'undefined' && q2Chart) q2Chart.resize();
      if (typeof q2TimelineChart !== 'undefined' && q2TimelineChart) q2TimelineChart.resize();
      if (typeof q3Map !== 'undefined' && q3Map) q3Map.resize();
      if (typeof q3ScatterChart !== 'undefined' && q3ScatterChart) q3ScatterChart.resize();
    }

    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      const sidebar = document.getElementById(targetId);
      if (!sidebar) return;
      const delta = startX - e.clientX; // dragging left = wider sidebar
      const newW = Math.max(260, Math.min(700, startW + delta));
      sidebar.style.width = newW + 'px';
      resizeAll();
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      resizeAll();
    });
  });

  // Vertical resizer (horizontal split)
  document.querySelectorAll('.resize-handle-h').forEach(handle => {
    let dragging = false, startY = 0, startTopH = 0, startBotH = 0;
    const topPane = handle.previousElementSibling;
    const botPane = handle.nextElementSibling;

    handle.addEventListener('mousedown', e => {
      if (!topPane || !botPane) return;
      dragging = true;
      startY = e.clientY;
      startTopH = topPane.offsetHeight;
      startBotH = botPane.offsetHeight;
      handle.classList.add('dragging');
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    function resizeAll() {
      if (typeof chart !== 'undefined' && chart) chart.resize();
      if (typeof corrChart !== 'undefined' && corrChart) corrChart.resize();
      if (typeof q2Chart !== 'undefined' && q2Chart) q2Chart.resize();
      if (typeof q2TimelineChart !== 'undefined' && q2TimelineChart) q2TimelineChart.resize();
      if (typeof q3Chart1 !== 'undefined' && q3Chart1) q3Chart1.resize();
      if (typeof q3Chart2 !== 'undefined' && q3Chart2) q3Chart2.resize();
    }

    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      const delta = e.clientY - startY;
      const newTopH = Math.max(100, startTopH + delta);
      const newBotH = Math.max(100, startBotH - delta);
      
      // Update flex basis instead of absolute height for better fluid layout
      const totalH = startTopH + startBotH;
      topPane.style.flex = `0 0 ${(newTopH / totalH) * 100}%`;
      botPane.style.flex = `1 1 0`;
      resizeAll();
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      resizeAll();
    });
  });
})();
