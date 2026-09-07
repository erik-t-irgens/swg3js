// Build an asset pack: convert the highest-detail mesh of every family matching a
// spec into GLBs and write a manifest the game loads from assets-private/<planet>/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Strip a LOD suffix so "foo_l2" and "foo" share the family "foo". */
export function familyOf(meshName) {
  return meshName.replace(/^appearance\/(mesh\/|component\/)?/, '').replace(/\.[a-z]+$/i, '').replace(/_l\d+$/, '');
}

function lodOf(meshName) {
  const m = /_l(\d+)\.msh$/.exec(meshName);
  return m ? parseInt(m[1], 10) : -1;
}

/** Choose one mesh per family: the lowest LOD number, else the plain name. */
export function selectFamilies(names, patterns, max) {
  const families = new Map();
  for (const name of names) {
    if (!name.startsWith('appearance/mesh/') || !name.endsWith('.msh')) continue;
    if (!patterns.some((p) => name.includes(p))) continue;
    const fam = familyOf(name);
    const lod = lodOf(name);
    const cur = families.get(fam);
    if (!cur || (lod >= 0 && (cur.lod < 0 || lod < cur.lod))) families.set(fam, { name, lod });
  }
  return [...families.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(0, max ?? Infinity).map(([id, v]) => ({ id, mesh: v.name }));
}

function boundsOf(mesh) {
  if (mesh.bounds) return mesh.bounds;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const g of mesh.groups) for (const p of g.primitives) {
    for (let i = 0; i < p.positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p.positions[i + k]);
        max[k] = Math.max(max[k], p.positions[i + k]);
      }
    }
  }
  return { min, max };
}

export function buildPack(vfs, spec, outDir, convert, log = console.log) {
  const names = vfs.list('appearance/mesh/');
  const manifest = { planet: spec.planet, generated: new Date().toISOString(), categories: {} };
  mkdirSync(outDir, { recursive: true });
  let ok = 0;
  let failed = 0;
  for (const [category, def] of Object.entries(spec.categories)) {
    const picks = selectFamilies(names, def.patterns, def.max);
    log(`${category}: ${picks.length} families matched`);
    const entries = [];
    for (const pick of picks) {
      const file = `${pick.id}.glb`;
      try {
        const r = convert(pick.mesh, join(outDir, file));
        const b = boundsOf(r.mesh);
        // Output is X-mirrored, so swap the X bounds.
        const bounds = r.flipX ? { min: [-b.max[0], b.min[1], b.min[2]], max: [-b.min[0], b.max[1], b.max[2]] } : b;
        entries.push({ id: pick.id, source: pick.mesh, file, bounds, triangles: r.tris, textured: r.textured, shaders: r.shaders.length });
        ok++;
        log(`  ${pick.id}: ${r.tris} tris, ${r.textured}/${r.shaders.length} textured`);
      } catch (err) {
        failed++;
        log(`  ${pick.id}: FAILED ${err.message}`);
      }
    }
    manifest.categories[category] = entries;
  }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  log(`pack written: ${ok} models, ${failed} failed -> ${join(outDir, 'manifest.json')}`);
  return manifest;
}
