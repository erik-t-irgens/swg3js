// The viewer's first module (the GPU port's pass 2, wave 4): the owner's private table of looks read from the viewer's
// server (`/private/looks.json`: the meshes, halos and rings of his imports and the looks he made of his pictures, never
// shipped; none on a machine without his imports) and handed to the shipped `looks.js` before the page itself loads, so
// every module reads the tables whole from its first line; then the page (`app.js`, the old viewer's own).
import { usePrivateLooks } from '../src/sky/look/looks.js';

try {
  const r = await fetch('/private/looks.json', { cache: 'no-store' });
  if (r.status === 200) {
    const t = await r.json();
    if (usePrivateLooks(t, t.from)) console.log(`[viewer] his looks' private table: ${Object.keys(t.parts).length} looks, from ${t.from}`);
    else console.warn('[viewer] his looks\' private table is not a table of looks: none used');
  } else console.log('[viewer] no private table of his looks: his looks are his file\'s, each of his pictures not here its generated twin');
} catch (e) {
  console.warn('[viewer] his looks\' private table could not be read: ' + e.message);
}
await import('./app.js');
