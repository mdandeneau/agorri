// Address check: is this a real address inside the town? Uses the U.S. Census Bureau's public geocoder.
// Used by /api/verify on agorri.com and by the page in the preview.
export const STATE_FIPS = { NH: '33', ME: '23', MA: '25', VT: '50' };

export function censusUrl(address, town, state) {
  const a = /,/.test(address) || /\b\d{5}\b/.test(address) ? address : `${address}, ${town}, ${state}`;
  return 'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?address=' + encodeURIComponent(a) +
    '&benchmark=Public_AR_Current&vintage=Current_Current&layers=' + encodeURIComponent('County Subdivisions,Incorporated Places') + '&format=json';
}

const base = s => String(s || '').toLowerCase().replace(/\s+(city|town|township|cdp)$/i, '').trim();

// Returns {ok, matched, place, reason}. ok is true only when the matched address falls inside the town's boundary.
export function addressInTown(json, town, state) {
  const matches = (json && json.result && json.result.addressMatches) || [];
  if (!matches.length) return { ok: false, reason: 'not_found' };
  const fips = STATE_FIPS[state] || null;
  for (const m of matches) {
    const g = m.geographies || {};
    const areas = [].concat(g['County Subdivisions'] || [], g['Incorporated Places'] || []);
    const hit = areas.find(a => (base(a.BASENAME) === base(town) || base(a.NAME) === base(town)) && (!fips || String(a.STATE) === fips));
    if (hit) return { ok: true, matched: m.matchedAddress, place: hit.NAME || hit.BASENAME };
  }
  const first = matches[0], g = first.geographies || {};
  const where = ((g['County Subdivisions'] || [])[0] || (g['Incorporated Places'] || [])[0] || {});
  return { ok: false, reason: 'outside', matched: first.matchedAddress, place: where.NAME || where.BASENAME || '' };
}
