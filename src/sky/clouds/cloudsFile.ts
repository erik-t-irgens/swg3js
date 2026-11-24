// The clouds file (`public/sky/clouds.json`, version 1): the layers the owner set for a world, read at every loading screen
// (pass 3, wave 1, the shape and its reader; wave 4 adds the viewer's Clouds tab and its Save to game, which writes it).
// Nothing in this wave writes the file. Pure: no three, no DOM, no fetch (the runtime hands the text in).
//
// The shape:
//
//   {
//     "version": 1,
//     "worlds": {
//       "<planet or pack id>": {
//         "layers": [
//           { "name": "Low deck", "cover": [0.3, 0.5, 0.6, 0.4, 0.2] },
//           { "name": "Low deck 2", "types": ["cumulus", "nimbostratus"], "shares": [1, [0, 0, 0.3, 0.7, 0.9]], "base": 1500 },
//           { "name": "my high veil", "types": ["cirrostratus"], "base": 9000 }
//         ]
//       }
//     }
//   }
//
// Only what he set is written: a world named in the file has the file's layers in the file's order, in place of its
// starting stack; each layer's missing fields come from the starting layer of the same name, else from its first type's
// starts (`cleanLayer`); a share is one number (every level) or five (one a weather level). Values are clamped for safety only (`CLOUD_CLAMP`); a field that is not a layer's is noted and
// left; a layer past `CLOUD_LAYER_MAX` is noted and left; a file of a later version is refused whole, in words, and the
// starting stacks stand. His values win over the starts wherever he set one; SWG's are never read.
import { CLOUD_LAYER_MAX, cleanLayer, type CloudLayer } from './cloudLayers.ts';

/** The version this reader reads. A file of a later one is refused whole. */
export const CLOUDS_FILE_VERSION = 1;

/** The fields a saved layer may hold (anything else is noted and left). */
const LAYER_FIELDS = new Set(['name', 'on', 'types', 'type', 'shares', 'levelShares', 'mixScale', 'base', 'thickness', 'cover', 'density', 'cellSize', 'drift', 'turn', 'diurnal', 'edge', 'seed']);

/** The file as read: each world's raw layers (by lower-cased id), what was noted, and why it was refused if it was. */
export interface CloudsFileRead {
  worlds: Map<string, Record<string, unknown>[]>;
  notes: string[];
  refused: string | null;
}

/** An empty read (no file, or a file refused): the starting stacks stand everywhere. */
export function emptyCloudsFile(refused: string | null = null): CloudsFileRead {
  return { worlds: new Map(), notes: [], refused };
}

/** The file's parsed JSON read into worlds' layers; never throws. */
export function readCloudsFile(raw: unknown): CloudsFileRead {
  if (raw === null || raw === undefined) return emptyCloudsFile();
  if (typeof raw !== 'object' || Array.isArray(raw)) return emptyCloudsFile('the clouds file is not an object');
  const r = raw as Record<string, unknown>;
  const v = r.version;
  if (typeof v !== 'number' || !Number.isFinite(v)) return emptyCloudsFile('the clouds file names no version');
  if (v > CLOUDS_FILE_VERSION) return emptyCloudsFile(`the clouds file is version ${v}; this build reads version ${CLOUDS_FILE_VERSION} and leaves a later one whole`);
  if (v < 1) return emptyCloudsFile(`the clouds file's version ${v} is not one this build knows`);
  const out = emptyCloudsFile();
  for (const k of Object.keys(r)) if (k !== 'version' && k !== 'worlds') out.notes.push(`"${k}" is not part of the clouds file and was left`);
  const worlds = r.worlds;
  if (worlds === undefined) return out;
  if (typeof worlds !== 'object' || worlds === null || Array.isArray(worlds)) {
    out.notes.push('"worlds" is not an object; no world was read');
    return out;
  }
  for (const [id, w] of Object.entries(worlds as Record<string, unknown>)) {
    if (!w || typeof w !== 'object' || Array.isArray(w)) {
      out.notes.push(`${id}: not an object; left`);
      continue;
    }
    const wr = w as Record<string, unknown>;
    for (const k of Object.keys(wr)) if (k !== 'layers') out.notes.push(`${id}: "${k}" is not part of a world's entry and was left`);
    if (!Array.isArray(wr.layers)) {
      out.notes.push(`${id}: no "layers" list; left`);
      continue;
    }
    const layers: Record<string, unknown>[] = [];
    wr.layers.forEach((l: unknown, i: number) => {
      if (!l || typeof l !== 'object' || Array.isArray(l)) {
        out.notes.push(`${id}: layer ${i} is not an object; left`);
        return;
      }
      if (layers.length >= CLOUD_LAYER_MAX) {
        out.notes.push(`${id}: layer ${i} is past the ${CLOUD_LAYER_MAX} a world holds; left`);
        return;
      }
      const lr = l as Record<string, unknown>;
      for (const k of Object.keys(lr)) if (!LAYER_FIELDS.has(k)) out.notes.push(`${id}: layer ${i}'s "${k}" is not a layer's field and was left`);
      layers.push(lr);
    });
    out.worlds.set(id.toLowerCase(), layers);
  }
  return out;
}

/**
 * A world's stack: the file's layers for the first of `ids` it names (each made whole from the start of the same name, or
 * its type's), else the starts as they are. Notes are added to `notes`. Fresh records.
 */
export function stackFromFile(file: CloudsFileRead, ids: readonly (string | null | undefined)[], start: readonly CloudLayer[], notes?: string[]): { layers: CloudLayer[]; from: string | null } {
  for (const id of ids) {
    if (!id) continue;
    const raw = file.worlds.get(id.toLowerCase());
    if (!raw) continue;
    const layers: CloudLayer[] = [];
    for (const lr of raw) {
      const name = typeof lr.name === 'string' ? lr.name : null;
      const from = name ? (start.find((s) => s.name === name) ?? null) : null;
      layers.push(cleanLayer(lr, from, notes));
    }
    return { layers, from: id.toLowerCase() };
  }
  return { layers: start.map((l) => cleanLayer(l, l)), from: null };
}
