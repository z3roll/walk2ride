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

async function loadData() {
  const [stationsResp, detailsResp, servicesResp] = await Promise.all([
    fetch('data/stations.json'),
    fetch('data/details.json'),
    fetch('data/services_shelter.json'),
  ]);
  DATA = await stationsResp.json();
  Object.assign(DETAILS, await detailsResp.json());
  window.SERVICES = await servicesResp.json();
  computeScores(DATA);
  if (typeof window.onDataLoaded === 'function') window.onDataLoaded();
}

loadData();
