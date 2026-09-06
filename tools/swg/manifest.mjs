// Classify archives against retail client inventories so private builds convert
// only SOE-origin data and skip a server project's own custom archives.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const manifest = JSON.parse(readFileSync(new URL('./manifests/retail.json', import.meta.url), 'utf8'));

export const RETAIL_SETS = {
  preCU_14_1: 'retail pre-CU 14.1 (SWGEmu client set)',
  cu_publish_25: 'retail CU era (publish 25)',
  nge_final: 'retail NGE final (patch 58 / hotfix 59)',
};

/** Fast check by name and size only. */
export function isRetailByName(file, size) {
  const key = file.toLowerCase();
  for (const set of Object.keys(RETAIL_SETS)) {
    const entry = manifest[set][key];
    if (entry && (entry.size === undefined || entry.size === size)) return set;
  }
  return null;
}

function hashes(path) {
  const buf = readFileSync(path);
  return { md5: createHash('md5').update(buf).digest('hex'), sha256: createHash('sha256').update(buf).digest('hex') };
}

/** Full classification of every archive in a directory, hashing each one. */
export function classifyDirectory(dir) {
  const out = [];
  for (const f of readdirSync(dir).filter((x) => /\.(tre|toc)$/i.test(x)).sort()) {
    const path = join(dir, f);
    const size = statSync(path).size;
    const key = f.toLowerCase();
    const h = hashes(path);
    let verdict = 'unknown (not a retail archive: project custom content or modified)';
    let set = null;
    for (const s of Object.keys(RETAIL_SETS)) {
      const e = manifest[s][key];
      if (!e) continue;
      const hashOk = (e.md5 && e.md5 === h.md5) || (e.sha256 && e.sha256 === h.sha256);
      if (hashOk) { verdict = `retail, verified hash: ${RETAIL_SETS[s]}`; set = s; break; }
      if (e.size === size && !e.md5 && !e.sha256) { verdict = `retail by name and size: ${RETAIL_SETS[s]}`; set = s; break; }
      verdict = `retail name but hash differs from ${RETAIL_SETS[s]} (modified or different capture)`;
      set = null;
    }
    out.push({ file: f, size, set, verdict, md5: h.md5 });
  }
  return out;
}
