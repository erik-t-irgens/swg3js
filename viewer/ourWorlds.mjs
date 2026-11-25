// The owner's own worlds in the viewer (skies of his own worlds, 24 November): every world of his the game draws under a sky it
// borrows, so the System tab can stand one on a body of a system (a ground world like any other) and the air box can give it
// air of its own. Two kinds: the built-in worlds that declare no pack of their own and borrow a converted sky
// (`src/data/planets.ts`' `pack: false` with `borrowSky`, Monument among them), and the rows of his worlds file
// (`public/placements/worlds/all.json`, read only): a new world borrows its sky's colours (`sky.colours`), a copy its
// source's whole sky (`of`). Each is `{ id, name, lender }`, `lender` the converted sky it draws (null for the procedural dome).
//
// Pure (no fs, no page): the viewer's server reads the file and hands its text in (`ourWorldRows`), the page joins the
// built-in list (`ourWorldsOf`), and the node test runs both as they stand.

const ID = /^[a-z0-9_]{1,40}$/;

/** His worlds file's rows as the viewer lists them: `{ id, name, lender }`, rows with no id of his kind left out. */
export function ourWorldRows(text) {
  let file = null;
  try {
    file = JSON.parse(String(text || ''));
  } catch {
    // the worlds file is plain JSON as the editor writes it; one a hand made with comments is read with them taken out
    try {
      file = JSON.parse(String(text || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"\\])\/\/.*$/gm, '$1'));
    } catch {
      file = null;
    }
  }
  const out = [];
  for (const r of Array.isArray(file?.rows) ? file.rows : []) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !/^ours_[a-z0-9_]{1,35}$/.test(r.id)) continue;
    const pack = (v) => (typeof v === 'string' && ID.test(v) ? v : null);
    const lender = r.kind === 'copy' ? pack(r.of) : pack(r.sky?.colours);
    const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 60) : r.id;
    if (!out.some((x) => x.id === r.id)) out.push({ id: r.id, name, lender, kind: r.kind === 'copy' ? 'copy' : 'new' });
  }
  return out;
}

/**
 * Every world of his the viewer offers as a ground: the built-in worlds with no pack that borrow a sky (from the game's planet
 * list, `planets`), then his worlds file's rows (`rows`, `ourWorldRows`' answer), each once.
 */
export function ourWorldsOf(planets, rows) {
  const out = [];
  const list = Array.isArray(planets) ? planets : [];
  for (const p of list) {
    if (!p || p.pack !== false || typeof p.borrowSky !== 'string' || !ID.test(p.id) || out.some((x) => x.id === p.id)) continue;
    out.push({ id: p.id, name: String(p.name || p.id), lender: p.borrowSky, kind: 'built-in' });
  }
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !ID.test(r.id) || out.some((x) => x.id === r.id)) continue;
    // a copy's `of` names a world of the game's or one of its zones (`src/data/ourWorlds.ts`' `gameWorld`): the sky it draws is
    // that pack's, as the game loads it (a planet's id read as its first zone's pack, Kashyyyk's `kashyyyk_main`)
    const lender = r.kind === 'copy' ? sourcePackOf(list, r.lender) : r.lender ?? null;
    out.push({ id: r.id, name: String(r.name || r.id), lender, kind: r.kind || 'new' });
  }
  return out;
}

/** The pack a copy's `of` reads, as the game resolves it (a zone's pack first, then a planet's own first zone), else `of` itself. */
function sourcePackOf(planets, of) {
  if (typeof of !== 'string' || !of) return null;
  for (const p of planets) if (p && !p.ours && Array.isArray(p.zones) && p.zones.some((z) => z && z.pack === of)) return of;
  const p = planets.find((x) => x && !x.ours && x.id === of);
  if (p) return Array.isArray(p.zones) && p.zones.length && typeof p.zones[0].pack === 'string' ? p.zones[0].pack : p.id;
  return of;
}
