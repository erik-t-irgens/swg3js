// His imported looks for the game's dev server alone (the GPU port's pass 2, wave 5, maker L; the design's 2.10 seam: "imported
// ones only where present, else the generated twin, else SWG's picture; read from imports-private/ or his imported folder by the
// dev server only"). The game's Vite hangs it (`vite.config.ts`'s `privateSky`, `apply: 'serve'`), so no build and no release
// ever carries it or asks for it, and a build's page never names its address (`src/sky/look/privateSky.ts` is dead code there).
//
// Two answers, both read only, every one fresh from the disk:
//   GET /__dev/sky/private          his looks of imported pictures and the places that wear them, from his file of choices
//                                   (the space body viewer's `SBV_SAVE`, read in place), the private table of his meshes, halos
//                                   and rings (`SBV_LOOKS`, as the viewer reads it), and the names his imported folder holds
//                                   (`SBV_IMPORTED`): `{ from, looks, uses, meshes, halos, rings, files }`, or `{ why }` with none;
//   GET /__dev/sky/imported/<name>  one picture or mesh of that folder, by its plain name (no folder, no `..`).
// Nothing is written, moved or copied: the paths are the viewer's own (`viewer/server.mjs`'s `viewerPaths`, the process
// environment over the repo's `.env`, so a test points them at scratch copies).
//
// Dependency-free and pure of Vite, so node's test runs it as it stands (`tools/swg/tests/lookBodies.test.ts`).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { readPrivateLooks, viewerPaths } from '../../viewer/server.mjs';

const EXT = new Set(['.png', '.jpg', '.jpeg', '.fbx']);
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.fbx': 'application/octet-stream' };
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** The picture and mesh names a look wears (its layers' pictures, flow maps, meshes and its own mesh). */
export function namesOfLook(look) {
  const out = [];
  if (!isObj(look)) return out;
  if (typeof look.mesh === 'string' && look.mesh) out.push(look.mesh + '.fbx');
  for (const L of Object.values(isObj(look.layers) ? look.layers : {})) {
    if (!isObj(L) || L.on === false) continue;
    if (typeof L.tex === 'string' && L.tex) out.push(L.tex);
    if (typeof L.mesh === 'string' && L.mesh) out.push(L.mesh + '.fbx');
    if (isObj(L.flow) && L.flow.on && typeof L.flow.tex === 'string' && L.flow.tex) out.push(L.flow.tex);
  }
  return out;
}

/**
 * His imported looks as the game reads them in development: every place of his file of choices whose look is not a generated
 * one (a look of his pictures), with that look, the private table's meshes, halos and rings, and the files his folder holds.
 * `P` the viewer's paths. Pure of the network; reads only.
 */
export async function privateSkyOf(P) {
  let choices;
  try {
    choices = JSON.parse(await fsp.readFile(P.save, 'utf8'));
  } catch {
    return { why: `no file of choices at ${P.save}` };
  }
  let files = [];
  try {
    files = (await fsp.readdir(P.imported)).filter((n) => EXT.has(path.extname(n).toLowerCase()));
  } catch {
    return { why: `no imported folder at ${P.imported}` };
  }
  let table = null;
  try {
    table = await readPrivateLooks(P);
  } catch (e) {
    table = null;
    console.warn(`[sky] the private table of his looks could not be read: ${e.message}`);
  }
  const looksIn = isObj(choices.looks) ? choices.looks : {};
  const usesIn = isObj(choices.uses) ? choices.uses : {};
  const looks = {};
  const uses = {};
  for (const [place, id] of Object.entries(usesIn)) {
    if (typeof id !== 'string') continue;
    const look = looksIn[id] ?? table?.table?.parts?.[id];
    if (!isObj(look) || isObj(look.generated)) continue;
    looks[id] = look;
    uses[place] = id;
  }
  return {
    from: P.save,
    looks,
    uses,
    meshes: table?.table?.meshes ?? {},
    halos: table?.table?.halos ?? {},
    rings: table?.table?.rings ?? {},
    files,
  };
}

/** The middleware (`root` the repo's checkout, `env` the process environment over its `.env`). */
export function skyPrivateMiddleware(root, env) {
  const P = viewerPaths(env, root);
  return async (req, res, next) => {
    const url = String(req.url || '');
    if (!url.startsWith('/__dev/sky/')) return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      return res.end('read only');
    }
    res.setHeader('Cache-Control', 'no-store');
    if (url === '/__dev/sky/private' || url.startsWith('/__dev/sky/private?')) {
      const body = JSON.stringify(await privateSkyOf(P));
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(req.method === 'HEAD' ? undefined : body);
    }
    if (url.startsWith('/__dev/sky/imported/')) {
      let name = '';
      try {
        name = decodeURIComponent(url.slice('/__dev/sky/imported/'.length).split('?')[0]);
      } catch {
        name = '';
      }
      if (!name || name.includes('/') || name.includes('\\') || name.includes('..') || name.includes('\0') || !EXT.has(path.extname(name).toLowerCase())) {
        res.statusCode = 404;
        return res.end('not found');
      }
      let names = [];
      try {
        names = await fsp.readdir(P.imported);
      } catch {
        names = [];
      }
      if (!names.includes(name)) {
        res.statusCode = 404;
        return res.end('not found');
      }
      const file = path.join(P.imported, name);
      res.setHeader('Content-Type', TYPES[path.extname(name).toLowerCase()] || 'application/octet-stream');
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    }
    res.statusCode = 404;
    res.end('not found');
  };
}
