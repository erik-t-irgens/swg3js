// Reading lore.js for the page: each place's body as the Star Wars stories have it (its name, what it
// is, what it orbits, how it should look, and how sure we are), and a line for each system. Nothing
// about lore is ever saved in the file of choices; lore.js is only read. Pure: node can test it.
//
// lore.js exports LORE = { version: 1, bodies: { "<place id>": { name, kind, orbits, lore, look,
// continuity, confidence, why, sources: [{ title, url }] } }, systems: { "<system>": "one line" } }.
// A missing file, a missing place, a missing field: each simply shows nothing.

const TEXT_FIELDS = ['name', 'kind', 'orbits', 'lore', 'look', 'continuity', 'confidence', 'why'];
const MAX_TEXT = 4000;

const str = (v) => (typeof v === 'string' ? v.trim().slice(0, MAX_TEXT) : '');

/** A source's link, only when it is a plain web address (never script or a local file). */
export function safeUrl(u) {
  if (typeof u !== 'string') return '';
  try {
    const url = new URL(u.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}

function cleanEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const e = {};
  for (const k of TEXT_FIELDS) e[k] = str(raw[k]);
  e.sources = [];
  for (const s of Array.isArray(raw.sources) ? raw.sources : []) {
    if (!s || typeof s !== 'object') continue;
    const url = safeUrl(s.url);
    const title = str(s.title) || (url ? new URL(url).hostname : '');
    if (title || url) e.sources.push({ title, url });
  }
  return e.name || e.lore || e.look ? e : null;
}

const key = (s) => String(s || '').trim().toLowerCase().replace(/^space_/, '').replace(/\bsystem\b/g, '').replace(/[^a-z0-9]+/g, '');

/** The lore module's LORE, checked: { sample, bodies: Map(place id -> entry), systems: Map(key -> line) }, or null. */
export function cleanLore(raw) {
  if (!raw || typeof raw !== 'object' || !raw.bodies || typeof raw.bodies !== 'object' || Array.isArray(raw.bodies)) return null;
  const bodies = new Map();
  for (const [id, v] of Object.entries(raw.bodies)) {
    const e = cleanEntry(v);
    if (e) bodies.set(id, e);
  }
  // A system's key is its name, and may end with the zones it covers in brackets ("Tatoo system
  // (tatooine, space_tatooine)"): the name and each of those zones then all reach its line.
  const systems = new Map();
  if (raw.systems && typeof raw.systems === 'object' && !Array.isArray(raw.systems)) {
    for (const [full, line] of Object.entries(raw.systems)) {
      const l = str(line);
      if (!l) continue;
      const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(String(full));
      const name = (m ? m[1] : String(full)).trim() || String(full).trim();
      const keys = [name, ...(m ? m[2].split(',') : [])].map(key).filter(Boolean);
      for (const k of keys) if (!systems.has(k)) systems.set(k, { name, line: l });
    }
  }
  return { version: +raw.version || 1, sample: raw.sample === true, bodies, systems };
}

/** A place's lore, or null. */
export const loreFor = (L, placeId) => (L && L.bodies.get(placeId)) || null;

/**
 * The line for a place's system: the systems' names are matched loosely (case, "space_", "system" and
 * punctuation set aside) against the names the place goes by: its zone, its world's name, its sky's title.
 */
export function systemFor(L, names) {
  if (!L || !L.systems.size) return null;
  for (const n of names) {
    const hit = L.systems.get(key(n));
    if (hit) return hit;
  }
  return null;
}

/** Whether a continuity says the thing is ours: our own choice, from no Star Wars source. */
export const isOurs = (continuity) => /\bours\b/i.test(continuity || '');

/** "moon · orbits Naboo" from an entry's kind and orbits; an orbit that is our own choice ("ours: Talus") says so. */
export function kindLine(e) {
  const kind = e.kind ? e.kind : '';
  let orbits = '';
  if (e.orbits) {
    const o = e.orbits.replace(/^orbits\s+/i, '');
    if (/^ours\.?$/i.test(o)) orbits = 'what it orbits is our choice';
    else if (/^ours\s*:\s*/i.test(o)) orbits = `orbits ${o.replace(/^ours\s*:\s*/i, '')} (our choice)`;
    else orbits = `orbits ${o}`;
  }
  return [kind, orbits].filter(Boolean).join(' · ');
}

/** A lore text in pieces, its **bold** marks apart: [{ text, bold }]. The page draws each as plain text, never as HTML. */
export function boldParts(s) {
  const out = [];
  String(s || '').split(/\*\*(.+?)\*\*/g).forEach((text, i) => { if (text) out.push({ text, bold: i % 2 === 1 }); });
  return out;
}

/** What the place lists search in: the lore's name, kind and what it orbits. */
export const searchText = (e) => (e ? `${e.name} ${e.kind} ${e.orbits}` : '');
