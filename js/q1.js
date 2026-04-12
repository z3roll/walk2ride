/* ═══════════════════════════════════════════════════════════════════
   Q1 — Scatter chart + Map view (demand-supply mismatch)
   ═══════════════════════════════════════════════════════════════════ */

let chart = null, corrChart = null, map = null;
let filterMin = 0, filterMax = 1;
let currentHighlight = null;

const CASE_STUDIES = {
  well_served: ['BOON LAY MRT STATION','ANG MO KIO MRT STATION','CLEMENTI MRT STATION','SENGKANG MRT STATION'],
  high_mismatch: ['ORCHARD MRT STATION','PAYA LEBAR MRT STATION','CITY HALL MRT STATION','DHOBY GHAUT MRT STATION','BAYFRONT MRT STATION'],
  over_provisioned: ['FERNVALE LRT STATION','COMPASSVALE LRT STATION','TAMPINES WEST MRT STATION','SENJA LRT STATION'],
};

function onDualFilter() {
  const minEl = document.getElementById('filter-min');
  const maxEl = document.getElementById('filter-max');
  let lo = +minEl.value, hi = +maxEl.value;
  if (lo > hi) { minEl.value = hi; lo = hi; }
  filterMin = lo / 100; filterMax = hi / 100;
  document.getElementById('filter-label').textContent = filterMin.toFixed(2) + ' \u2013 ' + filterMax.toFixed(2);
  document.getElementById('filter-track').style.left = lo + '%';
  document.getElementById('filter-track').style.width = (hi - lo) + '%';
  renderChart(currentHighlight);
  const visible = DATA.filter(s => s.mismatch_norm >= filterMin && s.mismatch_norm <= filterMax).length;
  document.getElementById('filter-count').textContent = visible + ' / ' + DATA.length;
}

function renderChart(highlightGroup) {
  currentHighlight = highlightGroup;
  if (!chart) chart = echarts.init(document.getElementById('chart'), 'dark');
  const d = DATA;
  const rainMin = Math.min(...d.map(x=>x.rainfall_mm)), rainMax = Math.max(...d.map(x=>x.rainfall_mm)), rainRange = rainMax - rainMin || 1;
  const highlightSet = highlightGroup ? new Set(CASE_STUDIES[highlightGroup] || []) : null;

  const seriesData = d.map(s => {
    const rainNorm = (s.rainfall_mm - rainMin) / rainRange;
    const size = 8 + rainNorm * 20;
    const isH = highlightSet ? highlightSet.has(s.station) : false;
    const isD = highlightSet && !isH;
    const isFiltered = s.mismatch_norm < filterMin || s.mismatch_norm > filterMax;
    return {
      value: [s.passenger_volume, s.shelter_ratio * 100],
      symbolSize: isFiltered ? size * 0.7 : (isD ? size * 0.7 : size),
      name: shortName(s.station),
      itemStyle: { color: mismatchColor(s.mismatch_norm), opacity: isFiltered ? 0.12 : (isD ? 0.12 : 0.82), borderColor: isH ? '#fff' : 'transparent', borderWidth: isH ? 2 : 0 },
      label: { show: isH && !isFiltered, formatter: shortName(s.station), position: 'top', fontSize: 13, fontWeight: 700, color: '#fff', distance: 12, textBorderColor: '#000', textBorderWidth: 3, backgroundColor: 'rgba(30,34,43,0.85)', padding: [4, 8], borderRadius: 4 },
      _raw: s, _filtered: isFiltered,
    };
  });

  const xVals = d.map(s=>s.passenger_volume).sort((a,b)=>a-b);
  const yVals = d.map(s=>s.shelter_ratio*100).sort((a,b)=>a-b);
  const xMed = xVals[Math.floor(xVals.length/2)], yMed = yVals[Math.floor(yVals.length/2)];

  chart.setOption({
    backgroundColor: '#0f1117',
    animation: true, animationDuration: 600,
    grid: { left: 70, right: 40, top: 50, bottom: 60 },
    title: {
      text: highlightGroup
        ? {well_served:'Case A: HDB Precinct Hubs', high_mismatch:'Case B: CBD Stations — Demand Without HDB', over_provisioned:'Case C: HDB-Embedded LRT — HDB Without Demand'}[highlightGroup]

        : 'Shelter Coverage vs Station Factors — All ' + d.length + ' MRT/LRT Stations',
      left:16, top:12, textStyle:{fontSize:13,fontWeight:600,color:'#ddd'},
    },
    tooltip: {
      trigger:'item', backgroundColor:'#1e222bf0', borderColor:'#3a3f4a', textStyle:{color:'#e8eaed',fontSize:12},
      formatter: p => {
        if (p.data._filtered) return null;
        const s = p.data._raw;
        return `<b style="font-size:13px">${shortName(s.station)}</b><br/>
          <span style="color:${mismatchColor(s.mismatch_norm)};">&#9679;</span> Mismatch: <b>${s.mismatch_norm.toFixed(2)}</b><br/>
          Ridership: <b>${s.passenger_volume.toLocaleString()}</b> pax/day<br/>
          Shelter: <b>${(s.shelter_ratio*100).toFixed(1)}%</b><br/>
          Rainfall: <b>${Math.round(s.rainfall_mm).toLocaleString()}</b> mm/yr<br/>
          <span style="color:#555;font-size:10px;">Click to view on map →</span>`;
      },
    },
    xAxis: { name:'Daily Ridership (pax/day)', nameLocation:'middle', nameGap:36, nameTextStyle:{fontSize:12,color:'#888'}, type:'value', max:150000,
      axisLabel:{formatter:v=>v>=1000?(v/1000).toFixed(0)+'K':v,color:'#666',fontSize:10}, splitLine:{lineStyle:{color:'#1c2029'}}, axisLine:{lineStyle:{color:'#2a2f3a'}} },
    yAxis: { name:'Shelter Coverage (%)', nameLocation:'middle', nameGap:48, nameTextStyle:{fontSize:12,color:'#888'}, type:'value', max:80,
      axisLabel:{formatter:v=>v+'%',color:'#666',fontSize:10}, splitLine:{lineStyle:{color:'#1c2029'}}, axisLine:{lineStyle:{color:'#2a2f3a'}} },
    series: [{
      type:'scatter', data:seriesData,
      emphasis:{ itemStyle:{borderColor:'#fff',borderWidth:2.5} },
      markLine:{ silent:true, lineStyle:{color:'rgba(255,255,255,0.08)',type:'dashed',width:1}, data:[{xAxis:xMed},{yAxis:yMed}], label:{show:false}, symbol:'none' },
      markArea:{ silent:true, data:[
        [{xAxis:xMed,yAxis:yMed,itemStyle:{color:'rgba(76,175,80,0.08)'}},{xAxis:150000,yAxis:80}],
        [{xAxis:xMed,yAxis:0,itemStyle:{color:'rgba(239,83,80,0.09)'}},{xAxis:150000,yAxis:yMed}],
        [{xAxis:0,yAxis:yMed,itemStyle:{color:'rgba(79,195,247,0.06)'}},{xAxis:xMed,yAxis:80}],
        [{xAxis:0,yAxis:0,itemStyle:{color:'rgba(255,255,255,0.04)'}},{xAxis:xMed,yAxis:yMed}],
      ], label:{show:false} },
    }],
    graphic: [
      {type:'text',right:55,top:68,style:{text:'Well-served',fill:'rgba(76,175,80,0.55)',fontSize:15,fontWeight:700}},
      {type:'text',right:55,bottom:70,style:{text:'Demand–Supply\nMismatch Zone',fill:'rgba(239,83,80,0.55)',fontSize:15,fontWeight:700,lineHeight:20}},
      {type:'text',left:80,top:68,style:{text:'Over-provisioned?',fill:'rgba(79,195,247,0.5)',fontSize:15,fontWeight:700}},
      {type:'text',left:80,bottom:70,style:{text:'Low priority',fill:'rgba(255,255,255,0.22)',fontSize:14,fontWeight:600}},
    ],
    dataZoom:[{type:'inside',xAxisIndex:0},{type:'inside',yAxisIndex:0}],
  }, true);

  chart.off('click');
  chart.on('click', params => {
    if (params.data && params.data._raw) openMapView(params.data._raw.station);
  });
}

function renderSidebar() {
  const d = DATA;
  const avgSr = d.reduce((s,x)=>s+x.shelter_ratio,0)/d.length;
  const highMismatch = d.filter(x=>x.mismatch_norm>0.7).length;

  document.getElementById('sidebar-content').innerHTML = `
    <div class="stats-row">
      <div class="stat-card" style="flex:0.7;"><div class="label">Stations</div><div class="value" style="color:var(--accent);">${d.length}</div></div>
      <div class="stat-card"><div class="label">Avg Shelter</div><div class="value" style="color:${avgSr<0.2?'var(--orange)':'var(--green)'};">${(avgSr*100).toFixed(1)}%</div></div>
      <div class="stat-card"><div class="label">High Mismatch</div><div class="value" style="color:var(--red);">${highMismatch}</div><div class="detail">score &gt; 0.7</div></div>
    </div>
    <div class="view-tabs">
      <button class="view-tab active" data-view="overview" onclick="switchView('overview')">Overview</button>
      <button class="view-tab" data-view="well_served" onclick="switchView('well_served')">Case A</button>
      <button class="view-tab" data-view="high_mismatch" onclick="switchView('high_mismatch')">Case B</button>
      <button class="view-tab" data-view="over_provisioned" onclick="switchView('over_provisioned')">Case C</button>
    </div>
    <div id="view-overview">
      <div class="narrative">
        <div class="section-tag"><div class="dot" style="background:var(--accent);"></div>The Puzzle</div>
        Across <strong>${d.length} MRT/LRT stations</strong>, the scatter plot above shows <strong>no clear pattern</strong> between ridership, rainfall, and shelter coverage. Avg shelter coverage within 400m is only <strong>${(avgSr*100).toFixed(1)}%</strong>. Singapore's busiest stations often have shelter below 15%, while sleepy LRT stops exceed 40%.<br><br>
        <em style="color:var(--muted);">If demand doesn't drive it, what does?</em>
      </div>
      <div class="narrative">
        <div class="section-tag"><div class="dot" style="background:#4fc3f7;"></div>Correlation Analysis</div>
        To answer that, we tested every plausible explanatory factor against shelter coverage (see bar chart below).
        <br><br>
        <strong>The result is striking</strong>:
        <ul style="margin:6px 0 6px 16px;padding:0;">
          <li><span style="color:#4fc3f7;">HDB count</span> — the dominant predictor (<b>r &asymp; +0.49</b>)</li>
          <li>Ridership, rainfall — both weak (r &lt; 0.33)</li>
          <li>Schools, healthcare — essentially no relationship</li>
          <li>Commercial buildings — slightly negative</li>
        </ul>
      </div>
      <div class="insight">
        <strong>Q1 Finding:</strong> Shelter coverage is not a response to commuter demand or rain exposure — it tracks <strong>HDB new town infrastructure</strong>. Shelter appears to be a byproduct of HDB precinct planning rather than a transit amenity.
      </div>
      <div class="narrative" style="border-color:#4fc3f7;">
        <div class="section-tag"><div class="dot" style="background:#4fc3f7;"></div>&rarr; Transition to Q2</div>
        If shelter follows HDB, is every HDB-rich area served <em>equally</em>? Q2 zooms out to the 26 planning areas and asks whether the age of the HDB stock — old estates vs new BTO towns — changes how much covered linkway each residential block actually gets.
      </div>
    </div>
    <div id="view-well_served" style="display:none;">
      <div class="narrative">
        <div class="section-tag"><div class="dot" style="background:var(--green);"></div>Case A: HDB Precinct Hubs</div>
        <span class="station-tag green" onclick="openMapView('BOON LAY MRT STATION')">Boon Lay</span>
        <span class="station-tag green" onclick="openMapView('ANG MO KIO MRT STATION')">Ang Mo Kio</span>
        <span class="station-tag green" onclick="openMapView('CLEMENTI MRT STATION')">Clementi</span>
        <span class="station-tag green" onclick="openMapView('SENGKANG MRT STATION')">Sengkang</span><br><br>
        These stations sit in the <strong>upper-right</strong> of the scatter — high ridership, high shelter. Opening any of their 400m maps reveals the same thing: <strong>dozens of HDB blocks</strong> packed around the station, threaded by a dense covered linkway network.
        <br><br>
        This is the pattern the correlation chart captures with <b>r &asymp; +0.49</b> for HDB count — where HDB is dense, shelter is dense.
      </div>
      <div class="insight"><strong>Reading the map:</strong><br>
        <b>Boon Lay</b> (55% shelter, 92K pax) — surrounded by Jurong West HDB estate + Jurong Point mall.<br>
        <b>Ang Mo Kio</b> (54%, 81K pax) — station exits open into HDB void decks, linkways threading through the precinct.<br>
        <b>Clementi</b> (43%, 91K pax) — embedded in one of Singapore's oldest HDB new towns.<br>
        <b>Sengkang</b> (50%, 84K pax) — LRT + covered linkway system built as part of the HDB masterplan.
        <br><br>
        <em style="color:var(--muted);">Role in the analysis: baseline — shows what "HDB count &rarr; shelter" looks like when the rule holds.</em>
      </div>
    </div>
    <div id="view-high_mismatch" style="display:none;">
      <div class="narrative">
        <div class="section-tag"><div class="dot" style="background:var(--red);"></div>Case B: CBD Stations — Demand Without HDB</div>
        <span class="station-tag red" onclick="openMapView('ORCHARD MRT STATION')">Orchard</span>
        <span class="station-tag red" onclick="openMapView('PAYA LEBAR MRT STATION')">Paya Lebar</span>
        <span class="station-tag red" onclick="openMapView('CITY HALL MRT STATION')">City Hall</span>
        <span class="station-tag red" onclick="openMapView('DHOBY GHAUT MRT STATION')">Dhoby Ghaut</span>
        <span class="station-tag red" onclick="openMapView('BAYFRONT MRT STATION')">Bayfront</span><br><br>
        These are Singapore's <strong>busiest stations</strong>, yet shelter coverage is below 13%. If shelter tracked commuter demand, they should be at the top of every list — but they're not.
        <br><br>
        Opening their 400m maps reveals the common cause: <strong>almost zero HDB blocks nearby</strong>. They sit in the CBD / commercial core, dominated by private office towers and malls. The correlation chart already told us ridership only reaches <b>r = +0.26</b>; these cases show why — demand alone cannot summon shelter where there is no HDB precinct to anchor it.
      </div>
      <div class="insight"><strong>Reading the map:</strong><br>
        <b>Orchard</b> (11%, 125K pax) — Singapore's shopping belt. Pedestrians rely on mall-to-mall underground links; surface shelter is sparse.<br>
        <b>Paya Lebar</b> (5%, 86K pax) — fragmented commercial/old shophouse mix; limited HDB nearby.<br>
        <b>City Hall / Dhoby Ghaut</b> (9% / 6%) — colonial civic district; no HDB on the landmass.<br>
        <b>Bayfront</b> (7%, 72K pax) — Marina Bay reclaimed land, no HDB at all.
        <br><br>
        <em style="color:var(--muted);">Role in the analysis: counter-example &#8544; &mdash; high demand + no HDB = no shelter. Directly falsifies "shelter follows demand".</em>
      </div>
    </div>
    <div id="view-over_provisioned" style="display:none;">
      <div class="narrative">
        <div class="section-tag"><div class="dot" style="background:var(--accent);"></div>Case C: HDB-Embedded LRT — HDB Without Demand</div>
        <span class="station-tag blue" onclick="openMapView('FERNVALE LRT STATION')">Fernvale</span>
        <span class="station-tag blue" onclick="openMapView('COMPASSVALE LRT STATION')">Compassvale</span>
        <span class="station-tag blue" onclick="openMapView('TAMPINES WEST MRT STATION')">Tampines West</span>
        <span class="station-tag blue" onclick="openMapView('SENJA LRT STATION')">Senja</span><br><br>
        These LRT stations carry only <strong>2K&ndash;17K pax/day</strong> — a fraction of Case B's CBD stations — yet their shelter coverage is <strong>29&ndash;41%</strong>, comparable to the busiest HDB hubs.
        <br><br>
        A natural guess was "shelter is compensating for schools and elderly facilities here." But the correlation chart already rules that out: <b>School Count r = +0.03</b>, <b>Healthcare Count r = +0.14</b> — essentially no relationship. Both hypotheses fail.
        <br><br>
        Opening the maps gives the real answer: each of these stations is <strong>completely surrounded by HDB blocks</strong>. They're LRT / light-rail stops <em>inside</em> HDB estates, not major transit hubs. The HDB-count rule predicts exactly this outcome — low demand doesn't matter when the station is already embedded in a dense HDB precinct.
      </div>
      <div class="insight"><strong>Reading the map:</strong><br>
        <b>Fernvale</b> (41%, 14K pax) — Sengkang LRT inside a dense HDB cluster.<br>
        <b>Compassvale</b> (38%, 8K pax) — another Sengkang LRT stop in the same HDB network.<br>
        <b>Tampines West</b> (36%, 17K pax) — inside Tampines HDB estate.<br>
        <b>Senja</b> (39%, 2.5K pax) — Bukit Panjang LRT, HDB blocks within metres of the platform.
        <br><br>
        <em style="color:var(--muted);">Role in the analysis: counter-example &#8545; &mdash; low demand + many HDB = shelter stays high. Also falsifies the "schools/elderly compensate" hypothesis.</em>
      </div>
    </div>
  `;
}

function switchView(view) {
  document.querySelectorAll('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  ['overview','well_served','high_mismatch','over_provisioned'].forEach(v => {
    const el = document.getElementById('view-'+v);
    if (el) el.style.display = v === view ? 'block' : 'none';
  });
  renderChart(view === 'overview' ? null : view);
}

/* ═══════════════════════════════════════════════════════════════════
   MAP VIEW
   ═══════════════════════════════════════════════════════════════════ */
function openMapView(stationName) {
  const detail = DETAILS[stationName];
  const summary = DATA.find(d => d.station === stationName);
  if (!detail || !summary) return;

  document.getElementById('chart-view').classList.remove('active');
  document.getElementById('map-view').classList.add('active');

  document.getElementById('map-station-name').textContent = shortName(stationName);
  document.getElementById('map-station-sub').textContent = `${stationName} · 400m radius analysis`;

  renderMapSidebar(detail, summary);

  const geo = detail.geometry || {};
  const pois = detail.pois || {};
  const nFp = (geo.footpaths||[]).length;
  const nCl = (geo.covered_linkways||[]).length;
  const nBr = (geo.overhead_bridges||[]).length;
  const nSch = (pois.schools||[]).length;
  const nHc = (pois.healthcare||[]).length;
  const nHdb = (pois.hdb||[]).length;
  const nComm = (pois.commercial||[]).length;
  const mc = mismatchColor(summary.mismatch_norm);
  document.getElementById('map-legend-float').innerHTML = `
    <div class="mleg-title">Legend</div>
    <div class="mleg-item"><div class="mleg-line" style="background:#bbb;height:3px;"></div> Footpath <span style="color:var(--muted);margin-left:auto;">${nFp} segments</span></div>
    <div class="mleg-item"><div class="mleg-line" style="background:#4caf50;height:5px;"></div> Covered Linkway / Bridge <span style="color:var(--muted);margin-left:auto;">${nCl + nBr} segments</span></div>
    <div class="mleg-divider"></div>
    <div class="mleg-item"><div class="mleg-dot" style="background:#ff5722;border:2px solid #fff;"></div> MRT / LRT Station</div>
    <div class="mleg-item"><div class="mleg-circle" style="border-color:${mc};"></div> 400m Radius</div>
    <div class="mleg-divider"></div>
    <div class="mleg-item"><div class="mleg-dot" style="background:#ffeb3b;border:1.5px solid #fff;"></div> School <span style="color:var(--muted);margin-left:auto;">${nSch}</span></div>
    <div class="mleg-item"><div class="mleg-dot" style="background:#ef6c00;border:1.5px solid #fff;"></div> Clinic / Hospital <span style="color:var(--muted);margin-left:auto;">${nHc}</span></div>
    <div class="mleg-item"><div class="mleg-dot" style="background:#26c6da;border:1.5px solid #fff;"></div> HDB <span style="color:var(--muted);margin-left:auto;">${nHdb}</span></div>
    <div class="mleg-item"><div class="mleg-dot" style="background:#ab47bc;border:1.5px solid #fff;"></div> Commercial <span style="color:var(--muted);margin-left:auto;">${nComm}</span></div>
  `;

  setTimeout(() => initMap(detail, summary), 50);
}

function backToChart() {
  document.getElementById('map-view').classList.remove('active');
  document.getElementById('chart-view').classList.add('active');
  if (map) { map.remove(); map = null; }
  chart.resize();
}

function renderMapSidebar(detail, summary) {
  const sr = summary.shelter_ratio;
  const pv = summary.passenger_volume;
  const rf = summary.rainfall_mm;
  const mc = mismatchColor(summary.mismatch_norm);

  const sorted = [...DATA].sort((a,b) => b.mismatch_norm - a.mismatch_norm);
  const rank = sorted.findIndex(d => d.station === summary.station) + 1;

  const geo = detail.geometry || {};
  const nFp = (geo.footpaths||[]).length;
  const nCl = (geo.covered_linkways||[]).length;
  const nBr = (geo.overhead_bridges||[]).length;
  const pois = detail.pois || {};
  const nSchools = (pois.schools||[]).length;
  const nElderly = (pois.elderly||[]).length;
  const nHealthcare = (pois.healthcare||[]).length;

  document.getElementById('map-sidebar-content').innerHTML = `
    <!-- Mismatch score -->
    <div class="score-section">
      <div class="title">Mismatch Score</div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
        <div style="font-size:36px;font-weight:800;color:${mc};">${summary.mismatch_norm.toFixed(2)}</div>
        <div>
          <div style="font-size:11px;color:var(--muted);">Rank #${rank} / ${DATA.length}</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px;">${summary.mismatch_norm > 0.7 ? 'High mismatch — needs investment' : summary.mismatch_norm > 0.4 ? 'Moderate mismatch' : 'Low mismatch — well-served'}</div>
        </div>
      </div>
    </div>

    <!-- Input metrics -->
    <div class="score-section">
      <div class="title">Input Metrics</div>
      <div class="metric-row">
        <span class="metric-label">Shelter Coverage</span>
        <div class="metric-bar-bg"><div class="metric-bar" style="width:${sr*100}%;background:${sr<0.15?'var(--red)':sr<0.3?'var(--orange)':'var(--green)'};"></div></div>
        <span class="metric-value">${(sr*100).toFixed(1)}%</span>
      </div>
      <div style="font-size:10px;color:var(--muted);margin:-2px 0 8px 12px;">
        Covered: ${detail.covered_length_m.toLocaleString()}m / Footpath: ${detail.footpath_length_m.toLocaleString()}m
      </div>
      <div class="metric-row">
        <span class="metric-label">Ridership</span>
        <div class="metric-bar-bg"><div class="metric-bar" style="width:${summary.pv_norm*100}%;background:var(--accent);"></div></div>
        <span class="metric-value">${pv.toLocaleString()}</span>
      </div>
      <div style="font-size:10px;color:var(--muted);margin:-2px 0 8px 12px;">pax/day (daily tap-in + tap-out)</div>
      <div class="metric-row">
        <span class="metric-label">Rainfall</span>
        <div class="metric-bar-bg"><div class="metric-bar" style="width:${summary.rf_norm*100}%;background:#42a5f5;"></div></div>
        <span class="metric-value">${Math.round(rf).toLocaleString()} mm</span>
      </div>
      <div style="font-size:10px;color:var(--muted);margin:-2px 0 8px 12px;">Annual avg · Station: ${detail.weather_station}</div>
    </div>

    <!-- Calculation -->
    <div class="score-section">
      <div class="title">Score Calculation</div>
      <div class="formula-box">
        <span class="label">Step 1: Demand</span><br>
        <span class="op">= 0.6 ×</span> <span class="val">ridership<sub>norm</sub></span> <span class="op">+ 0.4 ×</span> <span class="val">rainfall<sub>norm</sub></span><br>
        <span class="op">= 0.6 ×</span> <span class="val">${summary.pv_norm.toFixed(3)}</span> <span class="op">+ 0.4 ×</span> <span class="val">${summary.rf_norm.toFixed(3)}</span>
        <span class="op">=</span> <span class="val">${summary.demand.toFixed(3)}</span><br><br>
        <span class="label">Step 2: Supply gap</span><br>
        <span class="op">= 1 -</span> <span class="val">shelter<sub>norm</sub></span>
        <span class="op">= 1 -</span> <span class="val">${summary.sr_norm.toFixed(3)}</span>
        <span class="op">=</span> <span class="val">${(1-summary.sr_norm).toFixed(3)}</span><br><br>
        <span class="label">Step 3: Mismatch</span><br>
        <span class="op">= demand × supply_gap</span><br>
        <span class="op">=</span> <span class="val">${summary.demand.toFixed(3)}</span> <span class="op">×</span> <span class="val">${(1-summary.sr_norm).toFixed(3)}</span>
        <span class="op">=</span> <span class="result">${summary.mismatch.toFixed(3)}</span>
        <span class="label"> (normalized: ${summary.mismatch_norm.toFixed(2)})</span>
      </div>
    </div>

  `;
}

function initMap(detail, summary) {
  if (map) { map.remove(); map = null; }
  const lat = detail.lat, lng = detail.lng;

  map = new maplibregl.Map({
    container: 'map',
    style: { version: 8,
      sources: {
        carto: { type: 'raster', tiles: ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'], tileSize: 256, attribution: '&copy; CartoDB &copy; OSM' }
      },
      layers: [{
        id: 'carto', type: 'raster', source: 'carto',
        paint: { 'raster-opacity': 0.85 }
      }]
    },
    center: [lng, lat],
    zoom: 15.5,
    maxZoom: 18,
  });

  function onMapReady() { try {
    const geo = detail.geometry || {};

    const mc = mismatchColor(summary.mismatch_norm);
    const circleCoords = [];
    for (let i = 0; i <= 64; i++) {
      const angle = (i / 64) * Math.PI * 2;
      const dlat = (400 / 111320) * Math.cos(angle);
      const dlng = (400 / (111320 * Math.cos(lat * Math.PI / 180))) * Math.sin(angle);
      circleCoords.push([lng + dlng, lat + dlat]);
    }

    map.addSource('radius', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [circleCoords] } } });
    map.addLayer({ id: 'radius-fill', type: 'fill', source: 'radius', paint: { 'fill-color': mc, 'fill-opacity': 0.06 } });
    map.addLayer({ id: 'radius-line', type: 'line', source: 'radius', paint: { 'line-color': mc, 'line-width': 2, 'line-dasharray': [4, 4], 'line-opacity': 0.6 } });

    function segsToGeoJSON(segs) {
      return { type: 'FeatureCollection', features: segs.map(coords => ({
        type: 'Feature', geometry: { type: 'LineString', coordinates: coords.map(c => [c[0], c[1]]) }, properties: {}
      })) };
    }

    if (geo.footpaths && geo.footpaths.length) {
      map.addSource('footpaths', { type: 'geojson', data: segsToGeoJSON(geo.footpaths) });
      map.addLayer({ id: 'footpaths', type: 'line', source: 'footpaths', paint: { 'line-color': '#bbb', 'line-width': 3, 'line-opacity': 0.6 } });
    }

    const clMeta = geo.covered_linkways_meta || [];
    if (clMeta.length) {
      const clGeo = { type: 'FeatureCollection', features: clMeta.filter(s => s.coords && s.coords.length >= 2).map(s => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: s.coords.map(c => [c[0], c[1]]) },
        properties: { first_seen: s.first_seen || 'Unknown' }
      })) };
      map.addSource('covered', { type: 'geojson', data: clGeo });
      map.addLayer({ id: 'covered', type: 'line', source: 'covered', paint: { 'line-color': '#4caf50', 'line-width': 4, 'line-opacity': 0.85 } });
      const clPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
      map.on('mouseenter', 'covered', e => {
        map.getCanvas().style.cursor = 'pointer';
        const fs = e.features[0].properties.first_seen;
        const label = fs <= '2019-01' ? 'Built before 2019' : 'First recorded: ' + fs;
        clPopup.setLngLat(e.lngLat).setHTML(`<div style="font-size:12px;"><b style="color:#4caf50;">Covered Linkway</b><br>${label}</div>`).addTo(map);
      });
      map.on('mousemove', 'covered', e => { clPopup.setLngLat(e.lngLat); });
      map.on('mouseleave', 'covered', () => { map.getCanvas().style.cursor = ''; clPopup.remove(); });
    } else if (geo.covered_linkways && geo.covered_linkways.length) {
      map.addSource('covered', { type: 'geojson', data: segsToGeoJSON(geo.covered_linkways) });
      map.addLayer({ id: 'covered', type: 'line', source: 'covered', paint: { 'line-color': '#4caf50', 'line-width': 4, 'line-opacity': 0.85 } });
    }

    const brMeta = geo.overhead_bridges_meta || [];
    if (brMeta.length) {
      const brGeo = { type: 'FeatureCollection', features: brMeta.filter(s => s.coords && s.coords.length >= 2).map(s => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: s.coords.map(c => [c[0], c[1]]) },
        properties: { first_seen: s.first_seen || 'Unknown', type_desc: s.type_desc || 'Overhead Bridge' }
      })) };
      map.addSource('bridges', { type: 'geojson', data: brGeo });
      map.addLayer({ id: 'bridges', type: 'line', source: 'bridges', paint: { 'line-color': '#4caf50', 'line-width': 4, 'line-opacity': 0.85 } });
      const brPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
      map.on('mouseenter', 'bridges', e => {
        map.getCanvas().style.cursor = 'pointer';
        const p = e.features[0].properties;
        const label = p.first_seen <= '2019-01' ? 'Built before 2019' : 'First recorded: ' + p.first_seen;
        brPopup.setLngLat(e.lngLat).setHTML(`<div style="font-size:12px;"><b style="color:#4caf50;">${p.type_desc}</b><br>${label}</div>`).addTo(map);
      });
      map.on('mousemove', 'bridges', e => { brPopup.setLngLat(e.lngLat); });
      map.on('mouseleave', 'bridges', () => { map.getCanvas().style.cursor = ''; brPopup.remove(); });
    } else if (geo.overhead_bridges && geo.overhead_bridges.length) {
      map.addSource('bridges', { type: 'geojson', data: segsToGeoJSON(geo.overhead_bridges) });
      map.addLayer({ id: 'bridges', type: 'line', source: 'bridges', paint: { 'line-color': '#4caf50', 'line-width': 4, 'line-opacity': 0.85 } });
    }

    map.addSource('station-pt', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: {} } });
    map.addLayer({ id: 'station-pt', type: 'circle', source: 'station-pt', paint: { 'circle-radius': 8, 'circle-color': '#ff5722', 'circle-stroke-width': 3, 'circle-stroke-color': '#fff' } });
    // Station name as HTML marker (no glyph dependency)
    const labelEl = document.createElement('div');
    labelEl.style.cssText = 'color:#fff;font-size:13px;font-weight:700;text-shadow:0 0 4px #000,0 0 8px #000;pointer-events:none;white-space:nowrap;transform:translate(-50%,-100%);margin-top:-18px;';
    labelEl.textContent = shortName(summary.station);
    new maplibregl.Marker({ element: labelEl }).setLngLat([lng, lat]).addTo(map);

    const pois = detail.pois || {};
    const poiConfigs = [
      { key: 'schools',    color: '#ffeb3b', icon: '🏫', label: 'School' },
      { key: 'healthcare', color: '#ef6c00', icon: '⚕',  label: 'Healthcare' },
      { key: 'hdb',        color: '#26c6da', icon: '🏠', label: 'HDB' },
      { key: 'commercial', color: '#ab47bc', icon: '🏬', label: 'Commercial' },
    ];
    poiConfigs.forEach(cfg => {
      const items = pois[cfg.key] || [];
      if (!items.length) return;
      const geojson = { type: 'FeatureCollection', features: items.map(p => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: { name: p.name, poiType: cfg.label, subtype: p.subtype || '' }
      })) };
      map.addSource('poi-' + cfg.key, { type: 'geojson', data: geojson });
      map.addLayer({ id: 'poi-dot-' + cfg.key, type: 'circle', source: 'poi-' + cfg.key,
        paint: { 'circle-radius': 6, 'circle-color': cfg.color, 'circle-stroke-width': 2, 'circle-stroke-color': '#fff', 'circle-opacity': 0.9 } });
      // POI labels as HTML markers
      items.forEach(p => {
        const el = document.createElement('div');
        el.style.cssText = 'color:' + cfg.color + ';font-size:9px;font-weight:500;text-shadow:0 0 3px #000,0 0 6px #000;pointer-events:none;white-space:nowrap;transform:translateX(-50%);margin-top:6px;';
        el.textContent = p.subtype || cfg.label;
        new maplibregl.Marker({ element: el, anchor: 'top' }).setLngLat([p.lng, p.lat]).addTo(map);
      });
    });

    const poiPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
    poiConfigs.forEach(cfg => {
      const items = pois[cfg.key] || [];
      if (!items.length) return;
      map.on('mouseenter', 'poi-dot-' + cfg.key, e => {
        map.getCanvas().style.cursor = 'pointer';
        const props = e.features[0].properties;
        poiPopup.setLngLat(e.lngLat)
          .setHTML(`<div style="font-size:12px;"><b>${props.name}</b><br><span style="color:${cfg.color};">${props.subtype || cfg.label}</span></div>`)
          .addTo(map);
      });
      map.on('mousemove', 'poi-dot-' + cfg.key, e => { poiPopup.setLngLat(e.lngLat); });
      map.on('mouseleave', 'poi-dot-' + cfg.key, () => { map.getCanvas().style.cursor = ''; poiPopup.remove(); });
    });

    const stnPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
    map.on('mouseenter', 'station-pt', e => {
      map.getCanvas().style.cursor = 'pointer';
      const sr = summary.shelter_ratio;
      const mc2 = mismatchColor(summary.mismatch_norm);
      stnPopup.setLngLat([lng, lat])
        .setHTML(`<div style="font-size:12px;">
          <b style="font-size:14px;">${shortName(summary.station)}</b><br>
          <span style="color:${mc2};">\u25cf</span> Mismatch: <b>${summary.mismatch_norm.toFixed(2)}</b><br>
          Shelter: <b>${(sr*100).toFixed(1)}%</b><br>
          Ridership: <b>${summary.passenger_volume.toLocaleString()}</b> pax/day<br>
          Rainfall: <b>${Math.round(summary.rainfall_mm).toLocaleString()}</b> mm/yr</div>`)
        .addTo(map);
    });
    map.on('mouseleave', 'station-pt', () => { map.getCanvas().style.cursor = ''; stnPopup.remove(); });

    const bounds = new maplibregl.LngLatBounds();
    circleCoords.forEach(c => bounds.extend(c));
    map.fitBounds(bounds, { padding: 40 });
  } catch(err) { console.error('Map load error:', err); } }

  if (map.loaded()) { onMapReady(); }
  else { map.on('load', onMapReady); }
}

/* ═══════════════════════════════════════════════════════════════════
   RQ1 CORRELATION BAR CHART
   ═══════════════════════════════════════════════════════════════════ */
function renderCorrChart() {
  const container = document.getElementById('chart-corr');
  if (!container) return;
  if (!corrChart) corrChart = echarts.init(container, 'dark');
  const analysis = window.ANALYSIS;
  if (!analysis || !analysis.rq1_correlations) return;

  // Sort by |r| descending for bar ordering, then reverse for echarts (bars render bottom-up)
  const sorted = [...analysis.rq1_correlations].sort((a, b) => Math.abs(a.r) - Math.abs(b.r));
  const names = sorted.map(c => c.factor);
  const vals = sorted.map(c => c.r);

  // Color: strong positive = blue, weak = grey, negative = red
  function corrColor(r) {
    const abs = Math.abs(r);
    if (r > 0.35) return '#4fc3f7';    // strong +: blue
    if (r > 0.15) return '#81c784';    // moderate +: light green
    if (abs <= 0.15) return '#616161'; // weak / none: grey
    return '#ef5350';                   // negative: red
  }

  corrChart.setOption({
    backgroundColor: '#0f1117',
    animation: true,
    animationDuration: 700,
    title: {
      text: 'Correlation: Shelter Coverage vs Candidate Factors',
      left: 12, top: 6,
      textStyle: { fontSize: 12, fontWeight: 600, color: '#ddd' },
    },
    grid: { left: 140, right: 60, top: 50, bottom: 22 },
    tooltip: {
      trigger: 'item',
      backgroundColor: '#1e222bf0',
      borderColor: '#3a3f4a',
      textStyle: { color: '#e8eaed', fontSize: 11 },
      formatter: p => `<b>${p.name}</b><br/>Pearson r = <b style="color:${corrColor(p.value)};">${p.value >= 0 ? '+' : ''}${p.value.toFixed(3)}</b>`,
    },
    xAxis: {
      type: 'value',
      min: -0.5, max: 1.0,
      axisLabel: { color: '#888', fontSize: 10, formatter: v => v.toFixed(1) },
      splitLine: { lineStyle: { color: '#1c2029' } },
      axisLine: { lineStyle: { color: '#2a2f3a' } },
    },
    yAxis: {
      type: 'category',
      data: names,
      axisLabel: { color: '#ccc', fontSize: 11, fontWeight: 500 },
      axisLine: { lineStyle: { color: '#2a2f3a' } },
      axisTick: { show: false },
    },
    series: [{
      type: 'bar',
      data: vals.map(v => ({ value: v, itemStyle: { color: corrColor(v) } })),
      barWidth: '55%',
      label: {
        show: true,
        position: v => v.value >= 0 ? 'right' : 'left',
        formatter: p => (p.value >= 0 ? '+' : '') + p.value.toFixed(2),
        color: '#fff',
        fontSize: 10,
        fontWeight: 600,
      },
      markLine: {
        silent: true,
        symbol: 'none',
        lineStyle: { color: 'rgba(255,255,255,0.25)', type: 'dashed' },
        data: [{ xAxis: 0 }],
      },
    }],
  }, true);
}

/* ═══════════════════════════════════════════════════════════════════
   Q1 INIT — called when data is ready and Q1 is shown
   ═══════════════════════════════════════════════════════════════════ */
function q1Init() {
  renderSidebar();
  renderChart(null);
  renderCorrChart();
  window.addEventListener('resize', () => {
    if (chart) chart.resize();
    if (corrChart) corrChart.resize();
  });
}

function q1Show() {
  if (chart) setTimeout(() => chart.resize(), 50);
  if (corrChart) setTimeout(() => corrChart.resize(), 50);
}
