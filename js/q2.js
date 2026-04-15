/* ═══════════════════════════════════════════════════════════════════
   Q2 — HDB Coverage Tracking: Does HDB count predict shelter evenly?
   ═══════════════════════════════════════════════════════════════════ */

let q2Chart = null;
let q2TimelineChart = null;

// Two-family palette with a hard split at year 2000:
//   y <  2000 → red shades   (deep red 1965 → light red 1999)
//   y >= 2000 → green shades (light green 2000 → deep green 2012)
function q2YearColor(y) {
  function interp(c1, c2, t) {
    const parse = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
    const [r1,g1,b1] = parse(c1);
    const [r2,g2,b2] = parse(c2);
    const r = Math.round(r1 + (r2-r1)*t);
    const g = Math.round(g1 + (g2-g1)*t);
    const b = Math.round(b1 + (b2-b1)*t);
    return `rgb(${r},${g},${b})`;
  }
  if (y < 2000) {
    const t = Math.max(0, Math.min(1, (y - 1965) / (1999 - 1965)));
    return interp('#b71c1c', '#ef9a9a', t);   // deep red → light red
  }
  const t = Math.max(0, Math.min(1, (y - 2000) / (2012 - 2000)));
  return interp('#a5d6a7', '#1b5e20', t);     // light green → deep green
}

const TYPE_COLORS = {
  School: '#ffeb3b',
  Healthcare: '#ef6c00',
  HDB: '#4fc3f7',
  Commercial: '#ce93d8',
};

const TYPE_ORDER = ['School', 'Healthcare', 'HDB', 'Commercial'];

// Era colors for timeline chart
const ERA_COLORS = {
  pre2020:   '#616161',  // grey: legacy
  y2020_2022:'#81c784',  // light green: interim
  y2023_plus:'#4fc3f7',  // blue: recent push
};

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
   CHART 1 (top): Scatter — residential HDB count vs covered linkway
   length per planning area, both restricted to within 400m of MRT/LRT
   stations in that area. Overlaid with a least-squares regression line
   (dashed orange). Points coloured by mean HDB construction year using
   a red (old) → green (new) visualMap.
   ═══════════════════════════════════════════════════════════════════ */
function renderQ2HdbScatter() {
  const chart1 = window.AREA_CHART1;
  if (!chart1) return;

  // Pull mean HDB year (400m) from Chart 2 data so every point can be coloured
  const chart2 = window.AREA_CHART2 || [];
  const ymeanByName = {};
  chart2.forEach(c => { ymeanByName[c.name] = c.year_mean; });

  // Source of truth: area_chart1_400m.json (400m-from-station, residential HDB)
  const areas = Object.values(chart1)
    .filter(b => b.n_hdb_400m >= 5 && b.lw_length_m > 0)
    .map(b => ({
      name: b.name,
      display: b.name.charAt(0) + b.name.slice(1).toLowerCase(),
      n_hdb_400m: b.n_hdb_400m,
      lw_length_m: b.lw_length_m,
      n_lw_400m: b.n_lw_400m,
      n_stations: b.n_stations,
      year_mean: ymeanByName[b.name] || null,
      _raw: b,
    }));

  if (!q2Chart) q2Chart = echarts.init(document.getElementById('q2-chart'), 'dark');

  function pearson(xs, ys) {
    const n = xs.length;
    if (n < 2) return 0;
    const mx = xs.reduce((s, v) => s + v, 0) / n;
    const my = ys.reduce((s, v) => s + v, 0) / n;
    let num = 0, dx2 = 0, dy2 = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - mx, dy = ys[i] - my;
      num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
    }
    return (dx2 === 0 || dy2 === 0) ? 0 : num / Math.sqrt(dx2 * dy2);
  }
  const xs = areas.map(a => a.n_hdb_400m);
  const ys = areas.map(a => a.lw_length_m);
  const rArea = pearson(xs, ys);

  // Least-squares linear regression: y = slope*x + intercept
  function linreg(xs, ys) {
    const n = xs.length;
    const mx = xs.reduce((s, v) => s + v, 0) / n;
    const my = ys.reduce((s, v) => s + v, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      den += (xs[i] - mx) ** 2;
    }
    const slope = den === 0 ? 0 : num / den;
    const intercept = my - slope * mx;
    return { slope, intercept };
  }
  const { slope, intercept } = linreg(xs, ys);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  // Draw the fitted line slightly past the data range on both sides
  const xPad = (xMax - xMin) * 0.03;
  const fitX0 = Math.max(0, xMin - xPad);
  const fitX1 = xMax + xPad;
  const regressionLine = [
    [+fitX0.toFixed(2), +(slope * fitX0 + intercept).toFixed(2)],
    [+fitX1.toFixed(2), +(slope * fitX1 + intercept).toFixed(2)],
  ];

  // Uniform dot colour (year colouring reserved for Chart 2)
  const seriesData = areas.map(a => ({
    name: a.display,
    value: [a.n_hdb_400m, a.lw_length_m],
    itemStyle: { color: '#4fc3f7', borderColor: '#fff', borderWidth: 0.6, opacity: 0.85 },
    _raw: a,
  }));

  // Label the top-6 areas by HDB count to anchor the view
  const sortedByHdb = [...seriesData].sort((a, b) => b.value[0] - a.value[0]);
  const labelSet = new Set(sortedByHdb.slice(0, 6).map(d => d.name));
  seriesData.forEach(d => {
    if (labelSet.has(d.name)) {
      d.label = {
        show: true,
        formatter: d.name,
        position: 'top',
        fontSize: 10,
        color: '#fff',
        fontWeight: 600,
        textBorderColor: '#000',
        textBorderWidth: 2,
      };
    }
  });

  q2Chart.setOption({
    backgroundColor: '#0f1117',
    animation: true,
    animationDuration: 700,
    title: {
      text: 'Number of Residential HDBs vs Covered Linkway Length',
      left: 16, top: 10,
      textStyle: { fontSize: 13, fontWeight: 600, color: '#ddd' },
    },
    grid: { left: 70, right: 40, top: 60, bottom: 50 },
    tooltip: {
      trigger: 'item',
      backgroundColor: '#1e222bf0',
      borderColor: '#3a3f4a',
      textStyle: { color: '#e8eaed', fontSize: 12 },
      formatter: p => {
        if (!p.data || !p.data._raw) return '';
        const a = p.data._raw;
        const disp = a.name.charAt(0) + a.name.slice(1).toLowerCase();
        const yrTxt = a.year_mean ? `<span style="color:#888;">HDB mean year:</span> <b>${a.year_mean.toFixed(1)}</b><br/>` : '';
        // Full-area data from AREA_CHART2
        const c2 = (window.AREA_CHART2 || []).find(x => x.name === a.name);
        const hdbFull = c2 ? (c2.n_hdb_full || c2.n_hdb_400m) : '—';
        const lwFull = c2 ? (c2.lw_length_full || c2.lw_length_m) : 0;
        return `<b style="font-size:13px;">${disp}</b><br/>
          ${yrTxt}
          <span style="color:#888;">Stations:</span> <b>${a.n_stations}</b><br/>
          <div style="margin-top:4px;border-top:1px solid #333;padding-top:4px;">
          <span style="color:#aaa;font-weight:600;">Within 400m of MRT/LRT</span><br/>
          <span style="color:#888;">HDB:</span> <b>${a.n_hdb_400m}</b>
          <span style="color:#888;margin-left:8px;">Linkway:</span> <b>${(a.lw_length_m/1000).toFixed(2)} km</b> <span style="color:#666;">(${a.n_lw_400m} seg)</span></div>
          <div style="margin-top:4px;border-top:1px solid #333;padding-top:4px;">
          <span style="color:#aaa;font-weight:600;">Full area</span><br/>
          <span style="color:#888;">HDB:</span> <b>${hdbFull}</b>
          <span style="color:#888;margin-left:8px;">Linkway:</span> <b>${(lwFull/1000).toFixed(2)} km</b></div>`;
      },
    },
    xAxis: {
      name: 'Number of Residential HDBs (within 400m of MRT/LRT)',
      nameLocation: 'middle',
      nameGap: 30,
      nameTextStyle: { fontSize: 11, color: '#888' },
      type: 'value',
      axisLabel: { color: '#888', fontSize: 10 },
      splitLine: { lineStyle: { color: '#1c2029' } },
      axisLine: { lineStyle: { color: '#2a2f3a' } },
    },
    yAxis: {
      name: 'Covered Linkway Length within 400m (m)',
      nameLocation: 'middle',
      nameGap: 48,
      nameTextStyle: { fontSize: 11, color: '#888' },
      type: 'value',
      axisLabel: { color: '#888', fontSize: 10 },
      splitLine: { lineStyle: { color: '#1c2029' } },
      axisLine: { lineStyle: { color: '#2a2f3a' } },
    },
    series: [
      {
        name: 'Regression',
        type: 'line',
        data: regressionLine,
        showSymbol: false,
        silent: true,
        z: 1,
        lineStyle: {
          color: '#ff9800',
          width: 2,
          type: 'dashed',
          opacity: 0.85,
        },
        tooltip: { show: false },
      },
      {
        name: 'Area',
        type: 'scatter',
        symbolSize: 14,
        data: seriesData,
        z: 2,
        emphasis: { itemStyle: { borderColor: '#fff', borderWidth: 2 } },
      },
    ],
  }, true);

  q2Chart.off('click');
  q2Chart.on('click', params => {
    if (params.data && params.data._raw) {
      openQ2Map(params.data._raw.name);
    }
  });
}

// Map HDB median construction year to color — red = oldest, blue = newest
function medianYearColor(year) {
  if (year <= 1980) return '#ef5350';  // deep red
  if (year <= 1988) return '#ff9800';  // orange
  if (year <= 1995) return '#ffeb3b';  // yellow
  if (year <= 2002) return '#81c784';  // light green
  return '#4fc3f7';                     // blue: newest (2003+)
}

/* ═══════════════════════════════════════════════════════════════════
   CHART 2 (bottom): Linkway length per residential HDB — area-level,
   sorted old → new by mean HDB construction year.
   Y = lw_length_m / n_hdb_400m — metres of covered linkway per
       residential HDB block inside the area's 400m MRT/LRT buffer.
   Bars coloured by mean HDB year (red old → green new), so the palette
   lines up with Chart 1's visualMap scheme.
   ═══════════════════════════════════════════════════════════════════ */
let q2Chart2Mode = 'linkway'; // 'linkway', 'boxplot', or 'population'

function renderQ2Timeline() {
  const chart2 = window.AREA_CHART2 || [];
  const areas = chart2.filter(a =>
    a.year_mean && (a.n_hdb_full || a.n_hdb_400m) >= 50 &&
    (a.lw_length_full || a.lw_length_m) > 0 &&
    a.name !== 'YISHUN'
  ).sort((a, b) => a.year_mean - b.year_mean);
  if (!areas.length) return;

  if (!q2TimelineChart) q2TimelineChart = echarts.init(document.getElementById('q2-chart-timeline'), 'dark');

  // Add toggle button if not yet created
  const wrap = document.getElementById('q2-chart-timeline-wrap');
  if (wrap && !document.getElementById('q2-chart2-toggle')) {
    const btn = document.createElement('button');
    btn.id = 'q2-chart2-toggle';
    const modeOrder = ['linkway', 'boxplot', 'population'];
    const nextLabel = { linkway: 'HDB Year Distribution', boxplot: 'Population', population: 'Linkway per HDB' };
    btn.textContent = '▸ ' + nextLabel['linkway'];
    btn.style.cssText = 'position:absolute;top:8px;right:16px;z-index:10;padding:5px 14px;border-radius:6px;border:1px solid var(--border);background:var(--panel);color:var(--text);font-size:11px;font-weight:600;cursor:pointer;font-family:var(--font);';
    btn.onclick = () => {
      const idx = (modeOrder.indexOf(q2Chart2Mode) + 1) % modeOrder.length;
      q2Chart2Mode = modeOrder[idx];
      btn.textContent = '▸ ' + nextLabel[q2Chart2Mode];
      renderQ2Chart2Option(areas);
    };
    wrap.style.position = 'relative';
    wrap.appendChild(btn);
  }

  renderQ2Chart2Option(areas);
}

function renderQ2Chart2Option(areas) {
  const fmtArea = a => a.name.charAt(0) + a.name.slice(1).toLowerCase();
  const categories = areas.map(fmtArea);
  const chart1 = window.AREA_CHART1 || {};

  if (q2Chart2Mode === 'boxplot') {
    // Boxplot: HDB construction year distribution per area
    const boxData = areas.map(a => a.year_box || [0,0,0,0,0]);

    q2TimelineChart.setOption({
      backgroundColor: '#0f1117',
      animation: true,
      animationDuration: 700,
      title: {
        text: 'HDB Construction Year Distribution — by Area (Old → New)',
        left: 16, top: 10,
        textStyle: { fontSize: 13, fontWeight: 600, color: '#ddd' },
      },
      legend: { show: false },
      graphic: [],
      grid: { left: 72, right: 40, top: 50, bottom: 82 },
      tooltip: {
        trigger: 'item',
        backgroundColor: '#1e222bf0',
        borderColor: '#3a3f4a',
        textStyle: { color: '#e8eaed', fontSize: 12 },
        formatter: p => {
          if (!p.data) return '';
          const idx = p.dataIndex;
          const a = areas[idx];
          const b = a.year_box || [];
          const hFull = a.n_hdb_full || a.n_hdb_400m;
          return `<b style="font-size:13px;">${fmtArea(a)}</b><br/>
            <span style="color:#888;">HDB blocks:</span> <b>${hFull}</b><br/>
            <div style="margin-top:4px;border-top:1px solid #333;padding-top:4px;">
            <span style="color:#888;">Min:</span> <b>${b[0]}</b><br/>
            <span style="color:#888;">Q1 (25%):</span> <b>${b[1]}</b><br/>
            <span style="color:#888;">Median:</span> <b style="color:#4fc3f7;">${b[2]}</b><br/>
            <span style="color:#888;">Q3 (75%):</span> <b>${b[3]}</b><br/>
            <span style="color:#888;">Max:</span> <b>${b[4]}</b></div>`;
        },
      },
      xAxis: {
        type: 'category',
        data: categories,
        axisLabel: { color: '#aaa', fontSize: 9, interval: 0, rotate: 45 },
        axisLine: { lineStyle: { color: '#2a2f3a' } },
        axisTick: { show: false },
      },
      yAxis: [{
        type: 'value',
        name: 'Construction Year',
        nameLocation: 'middle',
        nameGap: 50,
        nameTextStyle: { fontSize: 11, color: '#888' },
        min: 1935,
        max: 2030,
        axisLabel: { color: '#888', fontSize: 10 },
        splitLine: { lineStyle: { color: '#1c2029' } },
        axisLine: { show: false },
      }],
      series: [{
        name: 'HDB Year',
        type: 'boxplot',
        data: boxData,
        itemStyle: {
          color: 'rgba(79,195,247,0.15)',
          borderColor: '#4fc3f7',
          borderWidth: 1.5,
        },
        emphasis: {
          itemStyle: { borderColor: '#fff', borderWidth: 2 },
        },
      }],
    }, true);
    return;
  }

  if (q2Chart2Mode === 'population') {
    const popData = areas.map(a => ({
      value: (a.total_pop || 0) / 1000,
      itemStyle: { color: q2YearColor(a.year_mean), borderColor: '#0f1117', borderWidth: 0.5 },
    }));
    const lwData = areas.map(a => +((a.lw_length_full || a.lw_length_m) / 1000).toFixed(1));

    q2TimelineChart.setOption({
      backgroundColor: '#0f1117',
      animation: true,
      animationDuration: 700,
      title: {
        text: 'Population & Linkway Length — by HDB Era (Old → New)',
        left: 16, top: 10,
        textStyle: { fontSize: 13, fontWeight: 600, color: '#ddd' },
      },
      legend: {
        show: true,
        data: ['Population (k)', 'Linkway length (km)'],
        right: '45%', top: 48,
        padding: [0, 20, 0, 0],
        textStyle: { color: '#ffffff', fontSize: 11, fontWeight: 500 },
        icon: 'circle', itemWidth: 10, itemHeight: 10, itemGap: 20,
      },
      graphic: [{
        type: 'group', left: '55%', top: 50,
        children: [
          { type: 'text', left: 20, top: 4, style: { text: 'HDB Era:', fill: '#ffffff', fontSize: 11, fontWeight: 500 } },
          { type: 'text', left: 76, top: 5, style: { text: 'Old', fill: '#ffffff', fontSize: 10, fontWeight: 600 } },
          { type: 'rect', left: 100, top: 6, shape: { width: 120, height: 8, r: 4 },
            style: { fill: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0,
              colorStops: [{offset:0,color:'#b71c1c'},{offset:0.48,color:'#ef9a9a'},{offset:0.52,color:'#a5d6a7'},{offset:1,color:'#1b5e20'}]
            }, shadowBlur: 4, shadowColor: 'rgba(0,0,0,0.3)', shadowOffsetY: 2 }
          },
          { type: 'text', left: 226, top: 5, style: { text: 'New', fill: '#ffffff', fontSize: 10, fontWeight: 600 } },
        ],
      }],
      grid: { left: 72, right: 80, top: 86, bottom: 82 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: '#1e222bf0',
        borderColor: '#3a3f4a',
        textStyle: { color: '#e8eaed', fontSize: 12 },
        formatter: params => {
          if (!params || !params.length) return '';
          const idx = params[0].dataIndex;
          const a = areas[idx];
          const h = a.n_hdb_full || a.n_hdb_400m;
          const lw = a.lw_length_full || a.lw_length_m;
          const p = a.total_pop || 0;
          return `<b style="font-size:13px;">${fmtArea(a)}</b><br/>
            <span style="color:#888;">Mean HDB year:</span> <b>${a.year_mean.toFixed(0)}</b><br/>
            <div style="margin-top:4px;border-top:1px solid #333;padding-top:4px;">
            <span style="color:#888;">Population:</span> <b style="color:#4fc3f7;">${p.toLocaleString()}</b><br/>
            <span style="color:#888;">HDB blocks:</span> <b>${h}</b><br/>
            <span style="color:#888;">Linkway:</span> <b style="color:#ff8a65;">${(lw/1000).toFixed(1)} km</b></div>`;
        },
      },
      xAxis: {
        type: 'category',
        data: categories,
        axisLabel: { color: '#aaa', fontSize: 9, interval: 0, rotate: 45 },
        axisLine: { lineStyle: { color: '#2a2f3a' } },
        axisTick: { show: false },
      },
      yAxis: [
        { type: 'value', name: 'Population (thousands)', nameLocation: 'middle', nameGap: 50,
          nameTextStyle: { fontSize: 11, color: '#4fc3f7' },
          axisLabel: { color: '#4fc3f7', fontSize: 10 },
          splitLine: { lineStyle: { color: '#1c2029' } }, axisLine: { show: false } },
        { type: 'value', name: 'Linkway length (km)', nameLocation: 'middle', nameGap: 50,
          nameTextStyle: { fontSize: 11, color: '#ff8a65' },
          axisLabel: { color: '#ff8a65', fontSize: 10 },
          splitLine: { show: false }, axisLine: { show: false } },
      ],
      series: [
        { name: 'Population (k)', type: 'bar', barWidth: '62%', data: popData, yAxisIndex: 0,
          emphasis: { itemStyle: { borderColor: '#fff', borderWidth: 2 } } },
        { name: 'Linkway length (km)', type: 'line', data: lwData, yAxisIndex: 1,
          smooth: false, symbol: 'circle', symbolSize: 6,
          lineStyle: { color: '#ff8a65', width: 2.2 },
          itemStyle: { color: '#ff8a65', borderColor: '#0f1117', borderWidth: 1.5 } },
      ],
    }, true);
    return;
  }

  // Default: full-area linkway per HDB bar + per-1k-residents line
  const perHdbArr = areas.map(a => {
    const h = a.n_hdb_full || a.n_hdb_400m;
    const l = a.lw_length_full || a.lw_length_m;
    return +(l / h).toFixed(1);
  });
  const perKArr = areas.map(a => {
    const l = a.lw_length_full || a.lw_length_m;
    const p = a.total_pop || 0;
    return p > 0 ? +(l / (p / 1000)).toFixed(1) : 0;
  });
  const barData = perHdbArr.map((v, i) => ({
    value: v,
    itemStyle: { color: q2YearColor(areas[i].year_mean), borderColor: '#0f1117', borderWidth: 0.5 },
  }));

  q2TimelineChart.setOption({
    backgroundColor: '#0f1117',
    animation: true,
    animationDuration: 700,
    title: {
      text: 'Covered Linkway per HDB & per 1,000 Residents — by HDB Era (Old → New)',
      left: 16, top: 10,
      textStyle: { fontSize: 13, fontWeight: 600, color: '#ddd' },
    },
    legend: {
      show: true,
      data: ['Per HDB (m)', 'Per 1,000 residents (m)'],
      right: '45%', top: 48,
      padding: [0, 20, 0, 0],
      textStyle: { color: '#ffffff', fontSize: 11, fontWeight: 500 },
      icon: 'circle',
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 20,
    },
    graphic: [{
      type: 'group',
      left: '55%',
      top: 50,
      children: [
        { type: 'text', left: 20, top: 4, style: { text: 'HDB Era:', fill: '#ffffff', fontSize: 11, fontWeight: 500 } },
        { type: 'text', left: 76, top: 5, style: { text: 'Old', fill: '#ffffff', fontSize: 10, fontWeight: 600 } },
        {
          type: 'rect',
          left: 100,
          top: 6,
          shape: { width: 120, height: 8, r: 4 },
          style: {
            fill: {
              type: 'linear', x: 0, y: 0, x2: 1, y2: 0,
              colorStops: [
                {offset: 0, color: '#b71c1c'},
                {offset: 0.48, color: '#ef9a9a'},
                {offset: 0.52, color: '#a5d6a7'},
                {offset: 1, color: '#1b5e20'}
              ]
            },
            shadowBlur: 4,
            shadowColor: 'rgba(0,0,0,0.3)',
            shadowOffsetY: 2
          }
        },
        { type: 'text', left: 226, top: 5, style: { text: 'New', fill: '#ffffff', fontSize: 10, fontWeight: 600 } },
      ],
    }],
    grid: { left: 72, right: 80, top: 86, bottom: 82 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: '#1e222bf0',
      borderColor: '#3a3f4a',
      textStyle: { color: '#e8eaed', fontSize: 12 },
      formatter: params => {
        if (!params || !params.length) return '';
        const idx = params[0].dataIndex;
        const a = areas[idx];
        const c1 = chart1[a.name];
        const h400 = c1 ? c1.n_hdb_400m : 0;
        const l400 = c1 ? c1.lw_length_m : 0;
        const lFull = a.lw_length_full || a.lw_length_m;
        const p = a.total_pop || 0;
        const hFull = a.n_hdb_full || a.n_hdb_400m;
        return `<b style="font-size:13px;">${fmtArea(a)}</b><br/>
          <span style="color:#888;">Mean HDB year:</span> <b>${a.year_mean.toFixed(0)}</b>
          <span style="color:#888;margin-left:8px;">Population:</span> <b>${p.toLocaleString()}</b>
          <div style="margin-top:4px;border-top:1px solid #333;padding-top:4px;">
          <span style="color:#aaa;font-weight:600;">Full area</span><br/>
          <span style="color:#888;">HDB:</span> <b>${hFull}</b>
          <span style="color:#888;margin-left:8px;">Linkway:</span> <b>${(lFull/1000).toFixed(2)} km</b><br/>
          <span style="color:#888;">Per HDB:</span> <b style="color:#ffcc80;">${hFull > 0 ? (lFull/hFull).toFixed(1) : '—'} m</b>
          <span style="color:#888;margin-left:8px;">Per 1k residents:</span> <b style="color:#fdd835;">${p > 0 ? (lFull/(p/1000)).toFixed(1) : '—'} m</b></div>
          <div style="margin-top:4px;border-top:1px solid #333;padding-top:4px;">
          <span style="color:#aaa;font-weight:600;">Within 400m of MRT/LRT</span><br/>
          <span style="color:#888;">HDB:</span> <b>${h400}</b>
          <span style="color:#888;margin-left:8px;">Linkway:</span> <b>${(l400/1000).toFixed(2)} km</b></div>`;
      },
    },
    xAxis: {
      type: 'category',
      data: categories,
      axisLabel: { color: '#aaa', fontSize: 9, interval: 0, rotate: 45 },
      axisLine: { lineStyle: { color: '#2a2f3a' } },
      axisTick: { show: false },
    },
    yAxis: [
      {
        type: 'value',
        name: 'Per HDB (m)',
        nameLocation: 'middle',
        nameGap: 50,
        nameTextStyle: { fontSize: 11, color: '#888' },
        axisLabel: { color: '#888', fontSize: 10 },
        splitLine: { lineStyle: { color: '#1c2029' } },
        axisLine: { show: false },
      },
      {
        type: 'value',
        name: 'Per 1,000 residents (m)',
        nameLocation: 'middle',
        nameGap: 50,
        nameTextStyle: { fontSize: 11, color: '#fdd835' },
        axisLabel: { color: '#fdd835', fontSize: 10 },
        splitLine: { show: false },
        axisLine: { show: false },
      },
    ],
    series: [
      {
        name: 'Per HDB (m)',
        type: 'bar',
        barWidth: '62%',
        data: barData,
        yAxisIndex: 0,
        emphasis: { itemStyle: { borderColor: '#fff', borderWidth: 2 } },
      },
      {
        name: 'Per 1,000 residents (m)',
        type: 'line',
        data: perKArr,
        yAxisIndex: 1,
        smooth: false,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { color: '#fdd835', width: 2.2 },
        itemStyle: { color: '#fdd835', borderColor: '#0f1117', borderWidth: 1.5 },
      },
    ],
  }, true);
}

/* ═══════════════════════════════════════════════════════════════════
   SIDEBAR
   ═══════════════════════════════════════════════════════════════════ */
function renderQ2Sidebar() {
  const chart1 = window.AREA_CHART1 || {};
  const rows = Object.values(chart1).filter(b => b.n_hdb_400m >= 5 && b.lw_length_m > 0);

  // Recompute Pearson r between 400m HDB count and 400m linkway length
  const xs = rows.map(r => r.n_hdb_400m);
  const ys = rows.map(r => r.lw_length_m);
  const n = xs.length;
  let r = 0;
  if (n >= 2) {
    const mx = xs.reduce((s, v) => s + v, 0) / n;
    const my = ys.reduce((s, v) => s + v, 0) / n;
    let num = 0, dx2 = 0, dy2 = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - mx, dy = ys[i] - my;
      num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
    }
    r = (dx2 === 0 || dy2 === 0) ? 0 : num / Math.sqrt(dx2 * dy2);
  }
  const rFmt = (r >= 0 ? '+' : '') + r.toFixed(2);

  document.getElementById('q2-sidebar-content').innerHTML = `
    <div class="stats-row">
      <div class="stat-card">
        <div class="label">Areas</div>
        <div class="value" style="color:var(--accent);">${n}</div>
      </div>
      <div class="stat-card">
        <div class="label">r (HDB vs linkway)</div>
        <div class="value" style="color:var(--green);">${rFmt}</div>
      </div>
    </div>

    <div class="narrative">
      <div class="section-tag"><div class="dot" style="background:#4fc3f7;"></div>Chart 1 — Volume correlation</div>
      Scatter of residential HDB count vs covered linkway length, both within 400m of MRT/LRT stations.<br/>
      <b style="color:var(--green);">r = ${rFmt}</b> — at the area level, linkway length scales with HDB count, so the allocation appears fair.
    </div>

    <div class="narrative">
      <div class="section-tag"><div class="dot" style="background:#e53935;"></div>Chart 2 — Per HDB & per 1,000 residents</div>
      Bars show linkway length per HDB block; the yellow line shows linkway length per 1,000 residents.
      Areas sorted old → new. Old estates like Queenstown receive ~47 m per block; Punggol gets just ~8 m — a <strong>5–8× gap</strong>.
    </div>

    <div class="insight">
      <strong>Q2 Finding:</strong> The positive correlation in Chart 1 looks equitable, but hides two things:
      <strong>(1)</strong> population density — newer towns pack far more residents per block, so each person's share of covered linkway is even smaller;
      <strong>(2)</strong> infrastructure lag — new HDB estates and their linkway networks have not yet caught up with established ones.
      Per resident and per block, the newest BTO towns are systematically under-served in shelter from both rain and sun.
    </div>

    <div class="narrative" style="border-color:#4fc3f7;">
      <div class="section-tag"><div class="dot" style="background:#4fc3f7;"></div>&rarr; Q3</div>
      Who actually lives in these under-served new towns? Q3 brings in Singapore's 2025 census and reveals they are dominated by working-age commuters and young families — the very people who walk to MRT every day and need covered linkways the most.
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════════════
   INIT & SHOW
   ═══════════════════════════════════════════════════════════════════ */
function q2Init() {
  renderQ2Sidebar();
  renderQ2HdbScatter();
  renderQ2Timeline();
  window.addEventListener('resize', () => {
    if (q2Chart) q2Chart.resize();
    if (q2TimelineChart) q2TimelineChart.resize();
  });
}

function q2Show() {
  if (q2Chart) setTimeout(() => q2Chart.resize(), 50);
  if (q2TimelineChart) setTimeout(() => q2TimelineChart.resize(), 50);
}

/* ═══════════════════════════════════════════════════════════════════
   Q2 MAP VIEW — 400m Walk-to-MRT zone per planning area
   Shows: union of 400m buffers around every MRT/LRT station in the area,
          plus every residential HDB, covered linkway, bridge, and footpath
          that falls inside that union. Everything outside is hidden.
   Intended visual effect mirrors the Q1 station click-through.
   ═══════════════════════════════════════════════════════════════════ */
let q2Map = null;
let q2MapAreaName = '';

async function openQ2Map(areaName) {
  const detail = window.AREA_CHART1_DETAIL && window.AREA_CHART1_DETAIL[areaName];
  if (!detail) return;

  q2MapAreaName = areaName;

  document.getElementById('q2-chart-view').style.display = 'none';
  document.getElementById('q2-map-view').style.display = 'flex';

  const displayName = areaName.charAt(0) + areaName.slice(1).toLowerCase();
  document.getElementById('q2-map-area-name').textContent = displayName;
  document.getElementById('q2-map-area-sub').textContent =
    `${detail.n_stations} MRT/LRT stations · ${detail.n_hdb_400m} residential HDB blocks within 400m`;

  renderQ2MapSidebar(detail, areaName, displayName);
  renderQ2MapLegend();
  setTimeout(() => initQ2Map(detail, areaName), 50);
}

function q2BackToChart() {
  document.getElementById('q2-map-view').style.display = 'none';
  document.getElementById('q2-chart-view').style.display = 'flex';
  if (q2Map) { q2Map.remove(); q2Map = null; }
  if (q2Chart) q2Chart.resize(); else renderQ2HdbScatter();
  if (q2TimelineChart) q2TimelineChart.resize(); else renderQ2Timeline();
}

function renderQ2MapSidebar(detail, areaName, displayName) {
  const chart1 = window.AREA_CHART1 && window.AREA_CHART1[areaName];
  const lwLenKm = chart1 ? (chart1.lw_length_m / 1000) : 0;
  const lwSegments = chart1 ? chart1.n_lw_400m : 0;
  const nHdb = detail.n_hdb_400m;
  const nStations = detail.n_stations;

  document.getElementById('q2-map-sidebar-content').innerHTML = `
    <div class="stats-row">
      <div class="stat-card">
        <div class="label">Stations</div>
        <div class="value" style="color:#ff5722;">${nStations}</div>
        <div class="detail">MRT / LRT</div>
      </div>
      <div class="stat-card">
        <div class="label">Residential HDB</div>
        <div class="value" style="color:#26c6da;">${nHdb}</div>
        <div class="detail">blocks in 400m</div>
      </div>
      <div class="stat-card">
        <div class="label">Linkway</div>
        <div class="value" style="color:#4caf50;">${lwLenKm.toFixed(1)}<span style="font-size:14px;">km</span></div>
        <div class="detail">${lwSegments} segments</div>
      </div>
    </div>

    <div class="narrative">
      <div class="section-tag"><div class="dot" style="background:var(--accent);"></div>${displayName} — 400m walk-to-MRT zone</div>
      The shaded region is the union of 400m buffers around every MRT/LRT station in ${displayName}.
      Every residential HDB block (cyan dot), covered linkway (green), overhead bridge (green),
      and footpath (grey) shown here lies inside that zone. Nothing outside the buffer is drawn.
    </div>

    <div class="narrative" style="border-color:#4fc3f7;">
      <div class="section-tag"><div class="dot" style="background:#4fc3f7;"></div>How to read</div>
      Hover a linkway to see when it was first recorded.
      Hover an HDB dot to see its block number and completion year.
    </div>
  `;
}

function renderQ2MapLegend() {
  document.getElementById('q2-map-legend').innerHTML = `
    <div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);font-weight:700;margin-bottom:8px;">Legend</div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
      <div style="width:14px;height:10px;border:1.5px solid #8a8f9a;background:rgba(136,136,136,0.08);box-sizing:border-box;"></div>
      <span>Planning area boundary</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
      <div style="width:14px;height:14px;border-radius:50%;border:2px dashed #4fc3f7;background:rgba(79,195,247,0.10);box-sizing:border-box;"></div>
      <span>400m MRT/LRT buffer</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
      <div style="width:10px;height:10px;border-radius:50%;background:#ff5722;border:2px solid #fff;"></div>
      <span>MRT / LRT station</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
      <div style="width:10px;height:10px;border-radius:50%;background:#26c6da;border:1.5px solid #fff;"></div>
      <span>Residential HDB</span>
    </div>
    <div style="height:1px;background:var(--border);margin:6px 0;"></div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
      <div style="width:18px;height:2px;background:#bbb;border-radius:1px;"></div>
      <span>Footpath</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
      <div style="width:18px;height:3px;background:#4caf50;border-radius:2px;"></div>
      <span>Covered Linkway / Bridge</span>
    </div>
  `;
}

function initQ2Map(detail, areaName) {
  if (q2Map) { q2Map.remove(); q2Map = null; }

  const bbox = detail.buffer_bbox; // [minLng, minLat, maxLng, maxLat]
  const centerLng = (bbox[0] + bbox[2]) / 2;
  const centerLat = (bbox[1] + bbox[3]) / 2;

  q2Map = new maplibregl.Map({
    container: 'q2-map',
    style: { version: 8,
      sources: { carto: { type: 'raster', tiles: ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'], tileSize: 256, attribution: '&copy; CartoDB &copy; OSM' } },
      layers: [{ id: 'carto', type: 'raster', source: 'carto', paint: { 'raster-opacity': 0.85 } }]
    },
    center: [centerLng, centerLat], zoom: 13, maxZoom: 18,
  });

  function onReady() { try {
    // ── 0. Planning area boundary ───────────────────────────────────
    const regions = window.REGIONS;
    const areaFeature = regions && regions.features.find(f =>
      (f.properties.PLN_AREA_N || '').toUpperCase() === areaName.toUpperCase()
    );
    if (areaFeature) {
      q2Map.addSource('area-boundary', { type: 'geojson', data: areaFeature });
      q2Map.addLayer({
        id: 'area-fill', type: 'fill', source: 'area-boundary',
        paint: { 'fill-color': '#888', 'fill-opacity': 0.04 }
      });
      q2Map.addLayer({
        id: 'area-line', type: 'line', source: 'area-boundary',
        paint: { 'line-color': '#8a8f9a', 'line-width': 1.8, 'line-opacity': 0.7 }
      });
    }

    // ── 1. Buffer union polygon ─────────────────────────────────────
    q2Map.addSource('buffer', {
      type: 'geojson',
      data: { type: 'Feature', geometry: detail.buffer_geom, properties: {} }
    });
    q2Map.addLayer({
      id: 'buffer-fill', type: 'fill', source: 'buffer',
      paint: { 'fill-color': '#4fc3f7', 'fill-opacity': 0.08 }
    });
    q2Map.addLayer({
      id: 'buffer-line', type: 'line', source: 'buffer',
      paint: { 'line-color': '#4fc3f7', 'line-width': 2, 'line-dasharray': [4, 4], 'line-opacity': 0.6 }
    });

    const stations = detail.stations || [];

    // ── 2. Footpaths (LineString, pre-filtered server-side) ───────
    const footpaths = detail.footpaths || [];
    if (footpaths.length) {
      const fpGeo = { type: 'FeatureCollection', features: footpaths.map(coords => ({
        type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {}
      })) };
      q2Map.addSource('area-fp', { type: 'geojson', data: fpGeo });
      q2Map.addLayer({ id: 'area-fp', type: 'line', source: 'area-fp',
        paint: { 'line-color': '#bbb', 'line-width': 1.5, 'line-opacity': 0.5 } });
    }

    // ── 3. Covered linkways (Polygon rings, pre-filtered) ─────────
    const linkways = detail.linkways || [];
    if (linkways.length) {
      const clGeo = { type: 'FeatureCollection', features: linkways.map(ring => ({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: {}
      })) };
      q2Map.addSource('area-cl', { type: 'geojson', data: clGeo });
      q2Map.addLayer({
        id: 'area-cl-fill', type: 'fill', source: 'area-cl',
        paint: { 'fill-color': '#4caf50', 'fill-opacity': 0.75 }
      });
      q2Map.addLayer({
        id: 'area-cl-line', type: 'line', source: 'area-cl',
        paint: { 'line-color': '#4caf50', 'line-width': 1.2, 'line-opacity': 0.95 }
      });
      const clPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
      q2Map.on('mouseenter', 'area-cl-fill', e => {
        q2Map.getCanvas().style.cursor = 'pointer';
        clPopup.setLngLat(e.lngLat)
          .setHTML(`<div style="font-size:12px;"><b style="color:#4caf50;">Covered Linkway</b></div>`)
          .addTo(q2Map);
      });
      q2Map.on('mousemove', 'area-cl-fill', e => { clPopup.setLngLat(e.lngLat); });
      q2Map.on('mouseleave', 'area-cl-fill', () => { q2Map.getCanvas().style.cursor = ''; clPopup.remove(); });
    }

    // ── 4. Overhead bridges (Polygon rings, pre-filtered) ─────────
    const bridges = detail.bridges || [];
    if (bridges.length) {
      const brGeo = { type: 'FeatureCollection', features: bridges.map(ring => ({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: {}
      })) };
      q2Map.addSource('area-br', { type: 'geojson', data: brGeo });
      q2Map.addLayer({
        id: 'area-br-fill', type: 'fill', source: 'area-br',
        paint: { 'fill-color': '#4caf50', 'fill-opacity': 0.75 }
      });
      q2Map.addLayer({
        id: 'area-br-line', type: 'line', source: 'area-br',
        paint: { 'line-color': '#4caf50', 'line-width': 1.2, 'line-opacity': 0.95 }
      });
    }

    // ── 5. HDB points (already filtered server-side) ───────────────
    const hdbFeatures = (detail.hdb || []).map(h => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [h.lng, h.lat] },
      properties: { blk: h.blk, year: h.year }
    }));
    q2Map.addSource('hdb', { type: 'geojson', data: { type: 'FeatureCollection', features: hdbFeatures } });
    q2Map.addLayer({
      id: 'hdb-dot', type: 'circle', source: 'hdb',
      paint: { 'circle-radius': 5, 'circle-color': '#26c6da', 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff', 'circle-opacity': 0.85 }
    });
    const hdbPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
    q2Map.on('mouseenter', 'hdb-dot', e => {
      q2Map.getCanvas().style.cursor = 'pointer';
      const p = e.features[0].properties;
      hdbPopup.setLngLat(e.lngLat).setHTML(`<div style="font-size:12px;"><b style="color:#26c6da;">HDB Block ${p.blk}</b><br>Built: <b>${p.year}</b></div>`).addTo(q2Map);
    });
    q2Map.on('mousemove', 'hdb-dot', e => { hdbPopup.setLngLat(e.lngLat); });
    q2Map.on('mouseleave', 'hdb-dot', () => { q2Map.getCanvas().style.cursor = ''; hdbPopup.remove(); });

    // ── 6. Station markers + labels ────────────────────────────────
    const staFeatures = stations.map(s => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      properties: { name: shortName(s.name) }
    }));
    q2Map.addSource('stations-pt', { type: 'geojson', data: { type: 'FeatureCollection', features: staFeatures } });
    q2Map.addLayer({
      id: 'stations-pt', type: 'circle', source: 'stations-pt',
      paint: { 'circle-radius': 7, 'circle-color': '#ff5722', 'circle-stroke-width': 2.5, 'circle-stroke-color': '#fff' }
    });
    stations.forEach(s => {
      const el = document.createElement('div');
      el.style.cssText = 'color:#fff;font-size:11px;font-weight:700;text-shadow:0 0 4px #000,0 0 8px #000;pointer-events:none;white-space:nowrap;transform:translate(-50%,-100%);margin-top:-12px;';
      el.textContent = shortName(s.name);
      new maplibregl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(q2Map);
    });

    // ── 7. Fit to buffer bbox ──────────────────────────────────────
    const bounds = new maplibregl.LngLatBounds([bbox[0], bbox[1]], [bbox[2], bbox[3]]);
    q2Map.fitBounds(bounds, { padding: 50 });
  } catch (err) { console.error('Q2 map error:', err); } }

  if (q2Map.loaded()) onReady();
  else q2Map.on('load', onReady);
}

/* Legacy no-op kept for backward-compat with any lingering onclick handlers */
function q2ToggleZoomService() {}
