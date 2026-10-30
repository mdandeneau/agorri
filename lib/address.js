// Address check: is this a real address inside the town? Uses the U.S. Census Bureau's public geocoder, with OpenStreetMap as a backup.
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

// Backup source when the Census geocoder is down: OpenStreetMap's Nominatim (free; at most one request a second, which a
// town-sized site never approaches). Only an exact match counts: the result must carry a house number and sit in the town.
export const STATE_NAMES = { NH: 'New Hampshire', ME: 'Maine', MA: 'Massachusetts', VT: 'Vermont' };
export function osmUrl(address, town, state) {
  const a = /,/.test(address) || /\b\d{5}\b/.test(address) ? address : `${address}, ${town}, ${state}`;
  return 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=3&countrycodes=us&q=' + encodeURIComponent(a);
}
export function osmInTown(list, town, state) {
  const hits = (Array.isArray(list) ? list : []).filter(x => x && x.address && x.address.house_number && x.address.road);
  if (!hits.length) return { ok: false, reason: 'not_found' };
  const stateName = (STATE_NAMES[state] || state || '').toLowerCase();
  const placeOf = a => a.city || a.town || a.village || a.municipality || a.hamlet || '';
  for (const x of hits) {
    const a = x.address;
    if (base(placeOf(a)) === base(town) && (!stateName || String(a.state || '').toLowerCase() === stateName)) {
      return { ok: true, matched: `${a.house_number} ${a.road}, ${placeOf(a)}, ${state}${a.postcode ? ', ' + a.postcode : ''}`.toUpperCase(), place: placeOf(a), source: 'osm' };
    }
  }
  const a = hits[0].address;
  return { ok: false, reason: 'outside', matched: '', place: placeOf(a) };
}
