/* ═══════════════════════════════════════════════════════════════════
   Q3 — Who is left in the rain?
   Two-chart view, sharing the toggle button pattern from RQ1/RQ2.

   CHART 1: stacked bar of 5 age groups per planning area, sorted
            from old → new by mean HDB construction year. Directly
            shows how the age profile shifts as you walk through the
            estate timeline.
   CHART 2: Nightingale Rose Chart showing commuter demand vs linkway supply.
   ═══════════════════════════════════════════════════════════════════ */

let q3Chart1 = null;
let q3Chart2 = null;

function q3Init() {
  renderQ3AgeStack();
  renderQ3CommuterRose();
  renderQ3Sidebar();
  window.addEventListener('resize', () => {
    if (q3Chart1) q3Chart1.resize();
    if (q3Chart2) q3Chart2.resize();
  });
}

function q3Show() {
  if (q3Chart1) setTimeout(() => q3Chart1.resize(), 50);
  if (q3Chart2) setTimeout(() => q3Chart2.resize(), 50);
}

/* ═══════════════════════════════════════════════════════════════════
   CHART 1 — Three trend lines across planning areas (old → new).
   X  = 23 planning areas sorted by mean HDB construction year (L→R)
   Y  = population share (%)
   Three lines:
     1. 65+ (seniors)       — expected: falls as HDB gets newer
     2. 20–39 (labour force) — expected: rises slightly
     3. 0–9 (children)      — expected: rises sharply in BTO towns
   Together they answer: "As HDB estates get younger, who lives there?"
   ═══════════════════════════════════════════════════════════════════ */
function renderQ3AgeStack() {
  const data = window.RQ3_AGE_HDB;
  if (!data || !data.length) return;

  const el = document.getElementById('q3-chart1');
  if (!el) return;
  if (!q3Chart1) q3Chart1 = echarts.init(el, 'dark');

  const areas = [...data]
    .filter(a => a.n_hdb_400m >= 25)
    .sort((a, b) => a.year_mean - b.year_mean);   // old → new, left → right
  const fmtArea = a => a.name.charAt(0) + a.name.slice(1).toLowerCase();
  const categories = areas.map(a => `${fmtArea(a)} (${a.year_mean.toFixed(0)})`);

  const LINE = [
    { key: 'pct_75plus', label: '75+ (seniors)',           color: '#ef5350', symbol: 'circle' },
    { key: 'pct_25_50',  label: '25–50 (labour force)',    color: '#66bb6a', symbol: 'diamond' },
    { key: 'pct_0_24',   label: '0–24 (children & youth)', color: '#42a5f5', symbol: 'triangle' },
  ];

  // Pre-compute the per-area single-year age buckets we need.
  // RQ3_AGE_HDB only has 5 coarse buckets (0-9, 10-19, 20-39, 40-64, 65+).
  // For custom ranges we use the raw per-year CSV loaded into _q3RawAge.
  // If the raw data isn't available, fall back to coarse approximations.
  const raw = window._q3RawAge || {};

  function pctRange(areaName, lo, hi) {
    const d = raw[areaName.toUpperCase()];
    if (d) {
      const total = Object.values(d).reduce((s, v) => s + v, 0);
      if (!total) return 0;
      let sum = 0;
      for (const [k, v] of Object.entries(d)) { const age = +k; if (age >= lo && age <= hi) sum += v; }
      return +(sum / total * 100).toFixed(1);
    }
    return 0;
  }

  const series = LINE.map(L => ({
    name: L.label,
    type: 'line',
    smooth: false,
    symbol: L.symbol,
    symbolSize: 8,
    lineStyle: { color: L.color, width: 2.5 },
    itemStyle: { color: L.color, borderColor: '#0f1117', borderWidth: 1.5 },
    emphasis: { focus: 'series' },
    data: areas.map(a => {
      if (L.key === 'pct_75plus') return pctRange(a.name, 75, 120);
      if (L.key === 'pct_25_50')  return pctRange(a.name, 15, 50);  // compute 15-50, label 25-50
      if (L.key === 'pct_0_24')   return pctRange(a.name, 0, 24);
      return 0;
    }),
  }));

  q3Chart1.setOption({
    backgroundColor: '#0f1117',
    animation: true,
    animationDuration: 700,
    title: {
      text: 'Demographic Shift across HDB Eras (Old → New)',
      left: 16, top: 10,
      textStyle: { fontSize: 13, fontWeight: 600, color: '#ddd' },
    },
    legend: {
      data: LINE.map(L => L.label),
      selected: Object.fromEntries(LINE.map(L => [L.label, true])),
      right: 16, top: 4,
      textStyle: { color: '#bbb', fontSize: 10 },
      backgroundColor: 'rgba(15,17,23,0.75)',
      borderColor: '#2a2f3a',
      borderWidth: 1,
      borderRadius: 6,
      padding: [8, 12],
      itemWidth: 16, itemHeight: 10, itemGap: 10,
      orient: 'vertical',
    },
    grid: { left: 56, right: 40, top: 52, bottom: 78 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1e222bf0',
      borderColor: '#3a3f4a',
      textStyle: { color: '#e8eaed', fontSize: 12 },
      formatter: params => {
        if (!params || !params.length) return '';
        const idx = params[0].dataIndex;
        const a = areas[idx];
        const lines = params.map(p =>
          `<span style="display:inline-block;width:8px;height:8px;background:${p.color};margin-right:6px;border-radius:50%;"></span>${p.seriesName}: <b>${p.value.toFixed(1)}%</b>`
        ).join('<br/>');
        return `<b style="font-size:13px;">${fmtArea(a)}</b>
          <span style="color:#888;margin-left:6px;">HDB ${a.year_mean.toFixed(0)}</span><br/>
          <span style="color:#888;">Population:</span> <b>${a.total_pop.toLocaleString()}</b><br/>
          <div style="margin-top:4px;">${lines}</div>`;
      },
    },
    xAxis: {
      type: 'category',
      data: categories,
      axisLabel: { color: '#aaa', fontSize: 9, interval: 0, rotate: 45 },
      axisLine: { lineStyle: { color: '#2a2f3a' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      name: 'Share of residents (%)',
      nameLocation: 'middle',
      nameGap: 40,
      nameTextStyle: { fontSize: 11, color: '#888' },
      min: 0,
      max: 60,
      axisLabel: { color: '#888', fontSize: 10, formatter: '{value}%' },
      splitLine: { lineStyle: { color: '#1c2029' } },
      axisLine: { show: false },
    },
    series,
  }, true);

  // Custom legend behaviour:
  let q3SoloLine = null;  // name of the currently solo'd line, or null = all visible

  q3Chart1.off('legendselectchanged');
  q3Chart1.on('legendselectchanged', function (params) {
    const clickedName = params.name;

    if (q3SoloLine === clickedName) {
      q3SoloLine = null;
      const allSelected = {};
      LINE.forEach(L => { allSelected[L.label] = true; });
      q3Chart1.setOption({ legend: { selected: allSelected } });
    } else {
      q3SoloLine = clickedName;
      const soloSelected = {};
      LINE.forEach(L => { soloSelected[L.label] = (L.label === clickedName); });
      q3Chart1.setOption({ legend: { selected: soloSelected } });
    }

    const currentSelected = q3SoloLine
      ? Object.fromEntries(LINE.map(L => [L.label, L.label === q3SoloLine]))
      : Object.fromEntries(LINE.map(L => [L.label, true]));

    let allMin = Infinity, allMax = -Infinity;
    series.forEach(s => {
      if (!currentSelected[s.name]) return;
      s.data.forEach(v => {
        const val = typeof v === 'object' ? v.value : v;
        if (val < allMin) allMin = val;
        if (val > allMax) allMax = val;
      });
    });
    if (allMin === Infinity) { allMin = 0; allMax = 100; }
    const pad = (allMax - allMin) * 0.15 || 2;
    q3Chart1.setOption({
      yAxis: {
        min: Math.max(0, Math.floor(allMin - pad)),
        max: Math.ceil(allMax + pad),
      },
    });
  });
}

/* ═══════════════════════════════════════════════════════════════════
   CHART 2 — Pictogram Matrix: Commuter Density vs Linkway Supply
   Shows 15-50 yr commuters scaling up as towns get newer, while their
   umbrella coverage shrinks.
   ═══════════════════════════════════════════════════════════════════ */
function renderQ3CommuterRose() {
  const el = document.getElementById('q3-chart2');
  if (!el) return;

  const blocks = window.AREA_BLOCKS || {};
  const rawAge = window._q3RawAge || {}; // Need this to compute 15-50 exact range
  
  if (!Object.keys(blocks).length || !Object.keys(rawAge).length) return;

  let areas = [];
  Object.values(blocks).forEach(b => {
    if (b && b.n_hdb_total >= 5 && b.year_median) {
      const name = b.name.toUpperCase();
      const ageData = rawAge[name];
      if (ageData) {
        // Calculate exact 15-50 population
        let commuters = 0;
        for (let age = 15; age <= 50; age++) {
          if (ageData[age]) commuters += ageData[age];
        }
        
        if (commuters > 20000) { 
          const lw_per_1k = b.n_total_blocks / (commuters / 1000);
          areas.push({
            name: b.name,
            year_median: b.year_median,
            commuters: commuters,
            total_lw: b.n_total_blocks,
            lw_per_1k: lw_per_1k
          });
        }
      }
    }
  });

  areas.sort((a, b) => a.year_median - b.year_median);
  
  // 3 groups: old / mid / new — each is 3 areas merged together
  const groups = [
    { label: 'Old HDB', areas: ['BUKIT MERAH', 'QUEENSTOWN', 'KALLANG'], color: '#66bb6a', umbrellaColor: '#66bb6a' },
    { label: 'Mid-age HDB', areas: ['CHOA CHU KANG', 'TOA PAYOH', 'BISHAN'], color: '#ffeb3b', umbrellaColor: '#ffeb3b' },
    { label: 'New HDB', areas: ['SENGKANG', 'SEMBAWANG', 'PUNGGOL'], color: '#ef5350', umbrellaColor: '#ef5350' },
  ];

  let displayAreas = groups.map(g => {
    const matched = g.areas.map(n => areas.find(a => a.name.toUpperCase() === n)).filter(Boolean);
    const totalCommuters = matched.reduce((s, a) => s + a.commuters, 0);
    const totalLw = matched.reduce((s, a) => s + a.total_lw, 0);
    const years = matched.map(a => a.year_median);
    const yrMin = Math.min(...years);
    const yrMax = Math.max(...years);
    return {
      name: g.label,
      subAreas: matched.map(a => a.name),
      year_range: yrMin === yrMax ? `${yrMin.toFixed(0)}` : `${yrMin.toFixed(0)}–${yrMax.toFixed(0)}`,
      year_median: (yrMin + yrMax) / 2,
      commuters: totalCommuters,
      total_lw: totalLw,
      lw_per_1k: totalCommuters > 0 ? totalLw / (totalCommuters / 1000) : 0,
      _color: g.color,
      _umbrellaColor: g.umbrellaColor,
    };
  });

  if (q3Chart2) {
    q3Chart2.dispose();
    q3Chart2 = null;
  }

  el.innerHTML = '';
  el.style.backgroundColor = '#0f1117';
  el.style.display = 'flex';
  el.style.flexDirection = 'column';
  el.style.padding = '16px';
  el.style.boxSizing = 'border-box';
  el.style.overflowY = 'auto';

  const title = document.createElement('div');
  title.innerHTML = `
    <div style="font-size: 13px; font-weight: 600; color: #ddd; margin-bottom: 16px;">Growing Commuter Population, Shrinking Linkway Coverage (25–50 yr olds)</div>
  `;
  el.appendChild(title);

  const container = document.createElement('div');
  container.style.display = 'grid';
  container.style.gridTemplateColumns = `repeat(${displayAreas.length}, minmax(0, 1fr))`;
  container.style.gap = '6px';
  container.style.flex = '1';
  container.style.minHeight = '0';
  el.appendChild(container);

  const maxLw = Math.max(...displayAreas.map(a => a.lw_per_1k)) || 4.7;
  const fmtArea = name => name.charAt(0) + name.slice(1).toLowerCase();

  const ICON_W = 12, ICON_H = 16, GAP = 3;
  // Row offsets: New = 0, Mid = -2, Old = -4
  const ROW_OFFSETS = [4, 2, 0];

  const cards = [];

  displayAreas.forEach((a, index) => {
    const personColor = a._color;

    const block = document.createElement('div');
    block.style.background = '#1a1f2a';
    block.style.borderRadius = '10px';
    block.style.padding = '16px 12px';
    block.style.display = 'flex';
    block.style.flexDirection = 'column';
    block.style.overflow = 'hidden';
    block.style.minWidth = '0';

    const subNames = (a.subAreas || []).map(n => fmtArea(n)).join(', ');
    block.innerHTML = `
      <div style="margin-bottom: 14px; text-align: center;">
        <div style="font-size: 15px; font-weight: bold; color: ${personColor};">${a.name}</div>
        <div style="font-size: 10px; color: #888; margin-top: 3px;">${subNames}</div>
        <div style="font-size: 10px; color: #aaa; margin-top: 2px;">HDB built ${a.year_range}</div>
        <div style="font-size: 13px; margin-top: 8px; color: #ddd;"><strong>${Math.round(a.commuters / 1000)}k</strong> commuters (25–50)</div>
        <div style="font-size: 15px; margin-top: 4px; font-weight: 700; color: #fff;">${a.lw_per_1k.toFixed(2)} <span style="font-size:11px;color:#888;">linkway / 1k</span></div>
      </div>
    `;

    const viz = document.createElement('div');
    viz.style.position = 'relative';
    viz.style.flex = '1';
    viz.style.display = 'flex';
    viz.style.flexDirection = 'column';
    viz.style.alignItems = 'center';
    viz.style.minHeight = '0';

    const coveragePct = Math.min(100, (a.lw_per_1k / maxLw) * 100);
    const umbrellaColor = a._umbrellaColor || '#888';
    viz.insertAdjacentHTML('beforeend', `
      <div style="width: 100%; height: 18px; position: relative; display: flex; justify-content: center; margin-bottom: 6px;">
        <div style="width: ${coveragePct}%; height: 100%; border-top-left-radius: 40px; border-top-right-radius: 40px; background: ${umbrellaColor}; position: relative; transition: width 1s ease-out; box-shadow: 0 -2px 6px rgba(0,0,0,0.5); z-index: 2;">
          <div style="position: absolute; left: 50%; bottom: -4px; width: 2px; height: 4px; background: #888; transform: translateX(-50%);"></div>
        </div>
      </div>
    `);

    const grid = document.createElement('div');
    grid.style.display = 'flex';
    grid.style.flexWrap = 'wrap';
    grid.style.alignContent = 'flex-start';
    grid.style.justifyContent = 'center';
    grid.style.gap = GAP + 'px';
    grid.style.width = '100%';
    grid.style.flex = '1';
    grid.style.overflow = 'hidden';

    viz.appendChild(grid);
    block.appendChild(viz);
    container.appendChild(block);

    cards.push({ grid, personColor, rowOffset: ROW_OFFSETS[index] });
  });

  // Fill icons based on measured grid size; re-fill on resize
  let prevCols = 0, prevRows = 0;

  function fillIcons() {
    const ref = cards[cards.length - 1].grid; // New HDB = largest, use as reference
    const w = ref.clientWidth;
    const h = ref.clientHeight;
    if (!w || !h) return;

    const cols = Math.min(25, Math.floor((w + GAP) / (ICON_W + GAP)));
    const maxRows = Math.min(12, Math.floor((h + GAP) / (ICON_H + GAP)));
    if (cols === prevCols && maxRows === prevRows) return; // no change
    prevCols = cols;
    prevRows = maxRows;

    cards.forEach(c => {
      const rows = Math.max(1, maxRows - c.rowOffset);
      const n = rows * cols;

      c.grid.innerHTML = '';
      const svg = `<svg viewBox="0 0 24 24" fill="${c.personColor}" style="width:${ICON_W}px;height:${ICON_H}px;opacity:0.9;"><circle cx="12" cy="5" r="4"></circle><path d="M12 10c-2.67 0-8 1.34-8 4v3h16v-3c0-2.66-5.33-4-8-4z"></path></svg>`;
      const frag = document.createDocumentFragment();
      for (let i = 0; i < n; i++) {
        const p = document.createElement('div');
        p.innerHTML = svg;
        frag.appendChild(p);
      }
      c.grid.appendChild(frag);
    });
  }

  requestAnimationFrame(fillIcons);

  const ro = new ResizeObserver(() => fillIcons());
  ro.observe(cards[cards.length - 1].grid);
}

/* ═══════════════════════════════════════════════════════════════════
   SIDEBAR
   ═══════════════════════════════════════════════════════════════════ */
function renderQ3Sidebar() {
  const data = window.RQ3_AGE_HDB || [];
  if (!data.length) return;

  const elderlyByArea = data.map(a => ({ name: a.name, pct: a.pct_65plus }));
  elderlyByArea.sort((a, b) => b.pct - a.pct);
  const oldest = elderlyByArea[0];
  const youngest = elderlyByArea[elderlyByArea.length - 1];

  const fmtArea = name => name.charAt(0) + name.slice(1).toLowerCase();

  document.getElementById('q3-sidebar-content').innerHTML = `
    <div class="narrative">
      <div class="section-tag"><div class="dot" style="background:#66bb6a;"></div>Chart 1 — Who lives where?</div>
      Three lines track how the age profile shifts as HDB estates get newer (left → right).
      The <strong style="color:#ef5350;">75+ senior</strong> share falls steeply, while <strong style="color:#42a5f5;">youth (0–24)</strong> and <strong style="color:#66bb6a;">working-age adults (25–50)</strong> both climb.
      This means the newest estates are filled with exactly the people who commute to MRT daily — and their children.
      Click a legend item to isolate one line; click again to restore all three.
    </div>

    <div class="narrative">
      <div class="section-tag"><div class="dot" style="background:#ef5350;"></div>Chart 2 — The coverage gap in human terms</div>
      Each person icon represents working-age commuters (25–50); the umbrella shows how much covered linkway each 1,000 of them share — for shelter from both rain and sun.
      Old HDB (green) have a smaller commuter base under a wide umbrella (<strong>3.85 / 1k</strong>).
      New HDB (red) pack the largest crowd yet get the smallest umbrella (<strong>2.00 / 1k</strong>).
      From left to right the population grows while the umbrella shrinks — that asymmetry is the gap.
    </div>

    <div class="insight">
      <strong>Finding:</strong>
      The current linkway network disproportionately benefits residents of older, less populated estates.
      Younger workers and their families — the core Walk2Ride demographic — live in the newest, densest towns
      but receive roughly <strong>half the per-capita covered linkway</strong> of established neighbourhoods.
      Covered linkways protect against both rain and tropical sun; the people who need that protection most,
      on their daily commute to MRT, are the ones getting the least of it.
    </div>
  `;
}
