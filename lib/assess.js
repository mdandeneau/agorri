// Turns a typed or Census-matched street address into what town assessing databases search on:
// the house number and the street name without its suffix ("12 Maple Street, Portsmouth NH" -> num "12", core "MAPLE", street "MAPLE ST").
const SUFFIX = { STREET: 'ST', ST: 'ST', AVENUE: 'AVE', AVE: 'AVE', AV: 'AVE', ROAD: 'RD', RD: 'RD', DRIVE: 'DR', DR: 'DR', LANE: 'LN', LN: 'LN', COURT: 'CT', CT: 'CT', PLACE: 'PL', PL: 'PL', TERRACE: 'TER', TER: 'TER', TERR: 'TER', CIRCLE: 'CIR', CIR: 'CIR', BOULEVARD: 'BLVD', BLVD: 'BLVD', WAY: 'WAY', HIGHWAY: 'HWY', HWY: 'HWY', PARKWAY: 'PKWY', PKWY: 'PKWY', SQUARE: 'SQ', SQ: 'SQ', EXTENSION: 'EXT', EXT: 'EXT', ALLEY: 'ALY', ROW: 'ROW', PATH: 'PATH', TRAIL: 'TRL', TRL: 'TRL', POINT: 'PT', PT: 'PT', HILL: 'HL' };
const UNIT = /\s+(?:APT|APARTMENT|UNIT|STE|SUITE|#|NO\.?)\s*[A-Z0-9-]*$/;
export function normStreet(raw, town) {
  let s = String(raw || '').toUpperCase().split(',')[0].replace(/[.]/g, '').replace(/\s+/g, ' ').trim();
  s = s.replace(/\s+\d{5}(-\d{4})?$/, '').replace(/\s+(NH|NEW HAMPSHIRE)$/, '').trim();
  if (town) s = s.replace(new RegExp('\\s+' + String(town).toUpperCase() + '$'), '').trim();
  s = s.replace(UNIT, '').replace(/\s+#\s*[A-Z0-9-]+$/, '').trim();
  const m = s.match(/^(\d+)[A-Z]?(?:-\d+[A-Z]?)?\s+(.+)$/);
  if (!m) return null;
  const words = m[2].split(' ').filter(Boolean);
  if (!words.length) return null;
  const last = words[words.length - 1];
  const suf = words.length > 1 && SUFFIX[last] ? SUFFIX[last] : null;
  const name = suf ? words.slice(0, -1) : words;
  const core = name.join(' ').replace(/[^A-Z0-9 '-]/g, '').trim();
  if (!core) return null;
  return { num: m[1], core, street: suf ? core + ' ' + suf : core };
}
// Does an assessor's location ("307B AMHERST ST", "255-269 AMHERST ST") match this address?
export function sameStreet(loc, a) {
  const L = String(loc || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const esc = a.core.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('^' + a.num + '[A-Z]?(-\\d+[A-Z]?)?\\s+' + esc + '(\\s|$)').test(L);
}
// Expands a leading direction ("E MAIN ST" -> "EAST MAIN ST") so names match databases that spell it out.
const DIRS = { N: 'NORTH', S: 'SOUTH', E: 'EAST', W: 'WEST' };
export function expandDir(core) { const m = String(core || '').match(/^([NSEW]) (.+)$/); return m ? DIRS[m[1]] + ' ' + m[2] : String(core || ''); }
