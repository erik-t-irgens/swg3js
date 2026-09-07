// Classify archives against retail client inventories so private builds convert
// only SOE-origin data and skip a server project's own custom archives.
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, readdirSync, statSync } from 'node:fs';
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

/** Stream a file through MD5 and SHA-256 at once, without loading it into memory. */
function hashes(path) {
  return new Promise((resolve, reject) => {
    const md5 = createHash('md5');
    const sha256 = createHash('sha256');
    createReadStream(path, { highWaterMark: 4 * 1024 * 1024 })
      .on('data', (chunk) => {
        md5.update(chunk);
        sha256.update(chunk);
      })
      .on('error', reject)
      .on('end', () => resolve({ md5: md5.digest('hex'), sha256: sha256.digest('hex') }));
  });
}

function classify(file, size, h) {
  const key = file.toLowerCase();
  let verdict = 'unknown: not a retail archive (project custom content, or modified)';
  let set = null;
  for (const s of Object.keys(RETAIL_SETS)) {
    const e = manifest[s][key];
    if (!e) continue;
    const hashOk = (e.md5 && e.md5 === h.md5) || (e.sha256 && e.sha256 === h.sha256);
    if (hashOk) return { set: s, verdict: `retail, hash verified: ${RETAIL_SETS[s]}` };
    if (e.size === size && !e.md5 && !e.sha256) return { set: s, verdict: `retail by name and size: ${RETAIL_SETS[s]}` };
    verdict = `retail name, but hash differs from ${RETAIL_SETS[s]} (modified, or a different capture)`;
  }
  return { set, verdict };
}

/**
 * Classify every archive in a directory, hashing each one. Calls `onResult`
 * as each file finishes so long runs show progress.
 */
export async function classifyDirectory(dir, onResult = () => {}) {
  const files = readdirSync(dir).filter((x) => /\.(tre|toc)$/i.test(x)).sort();
  const out = [];
  let done = 0;
  for (const f of files) {
    const path = join(dir, f);
    const size = statSync(path).size;
    const h = await hashes(path);
    const result = { file: f, size, md5: h.md5, ...classify(f, size, h) };
    out.push(result);
    onResult(result, ++done, files.length);
  }
  return out;
}
