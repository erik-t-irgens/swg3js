// The props pack, as the game reads it: every prop and every piece of furniture the converter wrote.
//
// Eight and a half thousand things in under three thousand models. It is fetched once for the
// session, like the mobiles catalogue, and for the same reason: it is a six-megabyte file and every
// panel and every placement reads the same one.
//
// **The one thing to know about it is that a thing and a model are not the same.** Dozens of props
// share an appearance -- every colour of a chair, every world's copy of a crate -- so the pack lists
// 8,596 things over 2,894 models and the model is loaded once however many of its things are stood.
// That is also why a placement stores the **thing's** id: a chair put down is that chair, and the
// model it happens to be drawn with is the pack's business.
//
// Nothing here touches three beyond loading a model, and nothing here places anything.

import type * as THREE from 'three';
import { AssetPack, type PackManifest } from './assetPack.ts';

/** The pack shape this reads. Written by the converter's `props` command. */
export const PROPS_PACK_VERSION = 1;

/** One prop: a thing in the game, drawn with one of the pack's models. */
export interface PropDef {
  id: string;
  template: string;
  /** The two folders below `object/`, which is how the panel groups them. */
  group: string;
  model: string;
  file: string;
  bounds: { min: number[]; max: number[] } | null;
  size: { w: number; h: number; d: number };
  name?: string | null;
  description?: string | null;
  icon?: string | null;
}

/** One of the pack's models, which is what a prop is drawn with. Several props share one. */
interface PropModel {
  id: string;
  file: string;
  bounds?: { min: number[]; max: number[] } | null;
  triangles?: number;
  appearance?: string;
  /** A brazier's fire, a fountain's spray, a chimney's smoke: parts of the appearance, placed with it. */
  effects?: { file: string; id: string; transform?: number[]; cell?: number }[];
}

interface PropsManifest {
  version: number;
  props: PropDef[];
  models: PropModel[];
}

/**
 * Every prop the pack carries, fetched once for the session.
 *
 * A game with no props pack has an empty one rather than a null: every caller then reads nought
 * props and offers nothing, which is exactly what the game was before the pack existed.
 */
export class PropCatalogue {
  private manifest: PropsManifest | null = null;
  private pending: Promise<PropCatalogue> | null = null;
  private readonly byId = new Map<string, PropDef>();
  /**
   * The same models as an ordinary pack, which is how a prop is really stood.
   *
   * Everything a placed thing wants -- instancing, colliders, the shadow cascades, the portal
   * renderer's set, the compile queue, the indoor layer -- lives in the streamer and the streamer
   * takes a pack. So the panel reads the catalogue and the placement reads this, and they are the
   * same file read two ways.
   *
   * It is minted per world and let go with it (`release`), exactly as the gallery pack behind a
   * house is: its materials joined that world's cascades and the portal renderer's set when they
   * were prepared, and nothing but a dispose takes them out again. The catalogue itself -- the
   * seven-megabyte list the panel reads -- is fetched once and kept.
   */
  private assets: AssetPack | null = null;
  /** The pack shape, worked out once when the catalogue lands and reused by every world's copy. */
  private packManifest: PackManifest | null = null;
  /** Why the pack is not here, for the console. */
  note = '';

  constructor(private readonly baseUrl: string) {}

  get dir(): string {
    return `${this.baseUrl}assets-private/props/`;
  }

  /** Whether the pack has landed. Everything reads this rather than waiting, as the mobiles' does. */
  get loaded(): boolean {
    return !!this.manifest;
  }

  get all(): readonly PropDef[] {
    return this.manifest?.props ?? [];
  }

  find(id: string): PropDef | null {
    return this.byId.get(id) ?? null;
  }

  /** The groups the pack has, each with how many things are in it, most first. */
  groups(): { id: string; label: string; count: number }[] {
    const by = new Map<string, number>();
    for (const p of this.all) by.set(p.group, (by.get(p.group) ?? 0) + 1);
    return [...by]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([id, count]) => ({ id, label: groupLabel(id), count }));
  }

  /** Fetched once. Asked for again while in flight, it is the same promise. */
  load(): Promise<PropCatalogue> {
    if (this.pending) return this.pending;
    this.pending = (async () => {
      try {
        const res = await fetch(`${this.dir}manifest.json`);
        if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) {
          this.note = "no props pack: npm run swg -- props '@SWG' assets-private --retail-only";
          return this;
        }
        const m = (await res.json()) as PropsManifest;
        if (m?.version !== PROPS_PACK_VERSION || !Array.isArray(m.props)) {
          this.note = 'the props pack is an older shape than this build reads: run the props command again';
          return this;
        }
        this.manifest = m;
        for (const p of m.props) this.byId.set(p.id, p);
        const layout = (m.models ?? []).map((d) => ({
          id: d.id,
          file: d.file,
          bounds: d.bounds ?? { min: [0, 0, 0], max: [0, 0, 0] },
          triangles: d.triangles ?? 0,
          ...(d.appearance ? { appearance: d.appearance } : {}),
          // A prop's own fire, spray or smoke. The streamer places these wherever it stands the
          // model, by the same lines that serve the snapshot's own braziers.
          ...(d.effects?.length ? { effects: d.effects } : {}),
        }));
        this.packManifest = { planet: 'props', categories: { layout } };
      } catch (err) {
        this.note = `the props pack would not load: ${err instanceof Error ? err.message : String(err)}`;
      }
      return this;
    })();
    return this.pending;
  }

  /** A prop's picture, or null. */
  iconUrl(p: { icon?: string | null }): string | null {
    return p.icon ? `${this.dir}${p.icon}` : null;
  }

  /** The pack the streamer stands a prop out of, minted on first use in a world. */
  get pack(): AssetPack | null {
    if (!this.assets && this.packManifest) this.assets = AssetPack.from(this.packManifest, this.dir);
    return this.assets;
  }

  /**
   * Let this world's copy of the pack go.
   *
   * Called where a world is left, as the gallery pack behind a house is. The catalogue survives:
   * the next world mints a fresh pack from the same list with nothing fetched but the models it
   * really stands.
   */
  release(): void {
    this.assets?.dispose();
    this.assets = null;
  }

  /**
   * A copy of a prop's model, for the ghost in a player's hand.
   *
   * One load per **model**, not per prop, and the pack's own cache is what does the keeping, so the
   * ghost and the thing that is finally stood are the same file read once.
   */
  async model(def: PropDef): Promise<THREE.Group> {
    // Through the getter, never the field: the field is null until something asks, and `release`
    // empties it on every arrival. Read directly it threw "the props pack has not loaded" for every
    // prop in a panel that was plainly full of them, since nothing had happened to mint one yet.
    const pack = this.pack;
    if (!pack) throw new Error(this.note || 'the props pack has not loaded');
    const loaded = await pack.model(def.model);
    return loaded.scene.clone();
  }
}

/** `tangible/furniture` reads as "Furniture"; `static/structure` as "Structures". */
export function groupLabel(group: string): string {
  const tail = group.split('/').pop() ?? group;
  const words = tail.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
