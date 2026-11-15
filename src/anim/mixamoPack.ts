// The imported clips in the running game: the pack fetched once (`public/anims/mixamo/`, written by `tools/anim/`),
// its clips fitted to each skeleton that asks and kept, so every rig of one skeleton plays the same clip objects.
//
// A skeleton's clips are fitted when its first rig is loaded, inside that load and off the frame, with a breath
// between clips; a rig is never shown before its clips are in (`CharacterRig`'s loader awaits them, bounded). Only
// the clips the index marks `use` are fetched at start; any other is fetched and fitted when the console asks.
//
// The game is exactly what it was without the pack: `localStorage['swg.mixamo'] = '0'` at load fetches nothing, a
// build that does not carry the pack asks for nothing, and every use of a clip asks the rig whether it has it first.
//
// What changes a fit afterwards (a trim moved, an alignment flipped from the console) is written into the very
// arrays the clips' tracks hold: three reads a track's values afresh each frame, so every rig playing the clip shows
// the change at its next frame and nothing is rebuilt.

import * as THREE from 'three';
import { ANIM_TUNE, watchTrims, type TrimId } from './animTune.ts';
import { fitClip, planFit, skeletonKey, type FitPlan, type FitReport, type FitRow, type FittedClip, type TargetSkeleton } from './fit.ts';
import { ALIGN_SHIPPED, type AlignFlags } from './mixamoMap.ts';
import { clipName, clipSlug, decodeMxa, readPackIndex, type ClipData, type PackClipRow, type PackIndex } from './mxaFile.ts';

/** Where the pack is, under `public/`. */
export const PACK_DIR = 'anims/mixamo/';
export const PACK_INDEX = `${PACK_DIR}index.json`;
/** `localStorage` key: '0' leaves the pack unfetched, and the game is the one before it. */
export const PACK_SWITCH = 'swg.mixamo';
/**
 * Two foot marks nearer than this are one footstep, seconds: both feet of a landing come down inside a frame or two of
 * each other, and two step sounds begun in one frame are one sound twice as loud. A walk's or a run's steps are a
 * quarter of a second or more apart and are never folded.
 */
export const FOOT_FOLD = 0.05;

/** What the pack needs of the world around it; the node tests hand it a folder on disk. */
export interface PackIo {
  /** The master switch as it stood at load. */
  enabled(): boolean;
  /** The index's text, or null where there is none to be had (not in the build, a 404, a page handed back). */
  index(): Promise<string | null>;
  /** One clip file's bytes, or null. `hash` is the index's own, for an address no cache can serve stale. */
  clip(file: string, hash: string): Promise<ArrayBuffer | null>;
  /** A pause between clips, so fitting never holds a frame. */
  breath(): Promise<void>;
  now(): number;
}

export type PackState = 'off' | 'idle' | 'loading' | 'ready' | 'absent' | 'failed';

/** One skeleton's fit. */
interface SkeletonFit {
  key: string;
  /** Who first asked (a species id), for the report. */
  label: string;
  target: TargetSkeleton;
  plan: FitPlan;
  /** By clip id. */
  clips: Map<string, { clip: THREE.AnimationClip; fitted: FittedClip }>;
  /** The `use` clips, once fitted: what every rig of this skeleton is handed. */
  ready: Promise<THREE.AnimationClip[]> | null;
  /** How long the fits took, and the longest one clip took, milliseconds. */
  ms: number;
  longest: number;
}

/** A fitted clip as a three.js clip: its arrays are the tracks' own, so writing into them is writing into the clip. */
export function toThreeClip(name: string, fitted: FittedClip): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  for (let i = 0; i < fitted.joints.length; i++) {
    const track = new THREE.QuaternionKeyframeTrack(`${fitted.joints[i]}.quaternion`, fitted.times, fitted.rotations[i]);
    // three keeps a typed array handed to a track as it is; were that ever to change, the in-place refit would write
    // into arrays nothing plays, so the track's own array is taken back as the fit's.
    fitted.rotations[i] = track.values as Float32Array;
    tracks.push(track);
  }
  if (fitted.rootJoint) {
    const track = new THREE.VectorKeyframeTrack(`${fitted.rootJoint}.position`, fitted.times, fitted.rootPosition);
    fitted.rootPosition = track.values as Float32Array;
    tracks.push(track);
  }
  return new THREE.AnimationClip(name, fitted.duration, tracks);
}

export class MixamoPack {
  private readonly io: PackIo;
  private status: PackState = 'idle';
  private why = '';
  private index: PackIndex | null = null;
  private readonly rows = new Map<string, PackClipRow>();
  private readonly data = new Map<string, ClipData>();
  private readonly fetching = new Map<string, Promise<ClipData | null>>();
  private readonly fits = new Map<string, SkeletonFit>();
  private loading: Promise<void> | null = null;
  private readonly align: AlignFlags = { ...ALIGN_SHIPPED };
  /** Clip files that could not be had, by id, with why. */
  private readonly lost = new Map<string, string>();

  constructor(io: PackIo) {
    this.io = io;
    watchTrims((ids) => this.restrip(ids));
  }

  get state(): PackState {
    return this.status;
  }

  /** The index, once read. */
  get packIndex(): PackIndex | null {
    return this.index;
  }

  /**
   * Fetch the index and the clips the game uses, once. Never rejects: a pack that is not there, or cannot be read,
   * leaves the game as it was and says why in the report.
   */
  load(): Promise<void> {
    if (this.loading) return this.loading;
    if (!this.io.enabled()) {
      this.status = 'off';
      this.why = `switched off (localStorage['${PACK_SWITCH}'] = '0')`;
      this.loading = Promise.resolve();
      return this.loading;
    }
    this.status = 'loading';
    this.loading = (async () => {
      try {
        const text = await this.io.index();
        if (text === null) {
          this.status = 'absent';
          this.why = 'no pack here (the build does not carry one, or the folder has none)';
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          this.status = 'absent';
          this.why = 'the index is not JSON (a page handed back for a file that is not there)';
          return;
        }
        const index = readPackIndex(parsed);
        if (typeof index === 'string') {
          this.status = 'failed';
          this.why = index;
          console.warn(`imported animations: ${index}`);
          return;
        }
        this.index = index;
        for (const row of index.clips) this.rows.set(row.id, row);
        await Promise.all(index.clips.filter((c) => c.use).map((c) => this.clipData(c.id)));
        this.status = 'ready';
      } catch (err) {
        this.status = 'failed';
        this.why = err instanceof Error ? err.message : String(err);
        console.warn('imported animations: the pack could not be loaded', err);
      }
    })();
    return this.loading;
  }

  /** One clip's samples, fetched once. Null (and said in the report) when the file is not to be had or does not match its row. */
  private clipData(id: string): Promise<ClipData | null> {
    const have = this.data.get(id);
    if (have) return Promise.resolve(have);
    let p = this.fetching.get(id);
    if (!p) {
      const row = this.rows.get(id);
      if (!row || !this.index) return Promise.resolve(null);
      const bones = this.index.bones.length;
      p = this.io
        .clip(row.file, row.hash)
        .then((bytes) => {
          if (!bytes) throw new Error('its file is not there');
          const clip = decodeMxa(bytes);
          if (clip.bones !== bones || clip.frames !== row.frames) throw new Error(`its file holds ${clip.frames} frames of ${clip.bones} bones, and the index says ${row.frames} of ${bones}`);
          this.data.set(id, clip);
          this.lost.delete(id);
          return clip;
        })
        .catch((err) => {
          this.lost.set(id, err instanceof Error ? err.message : String(err));
          this.fetching.delete(id);
          return null;
        });
      this.fetching.set(id, p);
    }
    return p;
  }

  /** What a clip is fitted with: the trim the tune has for it (the console moves those), else the index's; whether it loops; its level. */
  private rowFor(id: string): FitRow {
    const row = this.rows.get(id)!;
    const tuned = (ANIM_TUNE.trim as Record<string, number | undefined>)[id];
    return { trimStart: Math.min(tuned ?? row.trimStart, row.duration * 0.98), loop: row.loop, level: row.level };
  }

  /** Why there is no clip to be had, in words, or null while the pack is in: the switch, a build without it, a pack that would not read. */
  unavailable(): string | null {
    switch (this.status) {
      case 'ready':
        return null;
      case 'off':
        return `the imported animations are switched off (localStorage['${PACK_SWITCH}'] = '0'): set it to '1' and reload`;
      case 'absent':
        return 'this build carries no imported animations (public/anims/mixamo is not in it)';
      case 'failed':
        return `the imported animations could not be read: ${this.why}`;
      default:
        return 'the imported animations are still loading';
    }
  }

  private fitFor(target: TargetSkeleton, label: string): SkeletonFit | null {
    if (!this.index) return null;
    const key = skeletonKey(target);
    let fit = this.fits.get(key);
    if (!fit) {
      fit = { key, label, target, plan: planFit(this.index.bones, target, this.align), clips: new Map(), ready: null, ms: 0, longest: 0 };
      this.fits.set(key, fit);
      const r = fit.plan.report;
      if (r.missing.length) console.info(`imported animations: ${label}'s skeleton has not got ${r.missing.join(', ')}; they keep their rest`);
      if (r.toes < 0.7) console.warn(`imported animations: ${label}'s toes point another way than its hips say it faces (${r.toes.toFixed(2)}); its clips may face wrong`);
    }
    return fit;
  }

  private fitOne(fit: SkeletonFit, id: string, clip: ClipData): THREE.AnimationClip {
    const t = this.io.now();
    const had = fit.clips.get(id);
    const fitted = fitClip(fit.plan, clip, this.rowFor(id), had?.fitted);
    const made = had ?? { clip: toThreeClip(clipName(id), fitted), fitted };
    if (!had) fit.clips.set(id, made);
    const ms = this.io.now() - t;
    fit.ms += ms;
    fit.longest = Math.max(fit.longest, ms);
    return made.clip;
  }

  /**
   * The clips the game uses, fitted to a skeleton: the same clip objects for every caller of one skeleton. Empty
   * when there is no pack, the switch is off, or the skeleton has nothing the map drives.
   */
  async clipsFor(target: TargetSkeleton, label: string): Promise<THREE.AnimationClip[]> {
    await this.load();
    if (this.status !== 'ready' || !this.index) return [];
    const fit = this.fitFor(target, label);
    if (!fit || !fit.plan.driven.length || fit.plan.root < 0) return [];
    fit.ready ??= (async () => {
      const out: THREE.AnimationClip[] = [];
      for (const row of this.index!.clips) {
        if (!row.use) continue;
        const clip = this.data.get(row.id);
        if (!clip) continue;
        out.push(this.fitOne(fit, row.id, clip));
        await this.io.breath();
      }
      return out;
    })();
    return fit.ready;
  }

  /** One clip by id for a skeleton, fetched and fitted if need be (the console's). A string says why not. */
  async clipFor(id: string, target: TargetSkeleton, label: string): Promise<THREE.AnimationClip | string> {
    await this.load();
    if (this.status !== 'ready' || !this.index) return this.unavailable() ?? 'no imported animations';
    if (!this.rows.has(id)) return `no imported clip ${id}`;
    const fit = this.fitFor(target, label);
    if (!fit || !fit.plan.driven.length || fit.plan.root < 0) return 'this skeleton has none of the joints the imported clips drive';
    const had = fit.clips.get(id);
    if (had) return had.clip;
    const clip = await this.clipData(id);
    if (!clip) return `${id}: ${this.lost.get(id) ?? 'its file could not be read'}`;
    return this.fitOne(fit, id, clip);
  }

  /**
   * The ids that match a word, for the console: the id itself first, then every id holding it. The word is made an id
   * the way the importer makes one of a file's name, so a clip answers to the name its file has (`Hard Landing`,
   * `Hard Landing.fbx`, `Walking (1)`) as well as to its id and to the game's name for it (`mx_hard_landing`).
   */
  matching(word: string): string[] {
    const w = clipSlug(word.trim().replace(/\.fbx$/i, '')).replace(/^mx_/, '');
    if (!w) return [];
    const ids = [...this.rows.keys()];
    return ids.includes(w) ? [w] : ids.filter((id) => id.includes(w));
  }

  /** A clip's index row. */
  row(id: string): PackClipRow | null {
    return this.rows.get(id) ?? null;
  }

  /** Which groups beside the limbs have their rest poses lined up. */
  get alignment(): AlignFlags {
    return { ...this.align };
  }

  /**
   * Flip rest alignment groups and fit every skeleton's clips again in place: what is playing shows it at its next
   * frame. The console's, for comparing the pelvis with and without the old rule. Answers how many clips were refitted;
   * with `words`, anything asked that is no group, or no switch, is said there and sets nothing.
   */
  setAlign(flags: Partial<AlignFlags>, words?: string[]): number {
    let moved = false;
    const groups = ['torso', 'feet', 'clavicles'] as const;
    for (const [k, v] of Object.entries(flags as Record<string, unknown>)) {
      if (!(groups as readonly string[]).includes(k)) words?.push(`no alignment group ${k} (torso, feet, clavicles; the limbs are always lined up)`);
      else if (typeof v !== 'boolean') words?.push(`${k} takes true or false`);
    }
    for (const k of groups) {
      const v = flags[k];
      if (typeof v === 'boolean' && this.align[k] !== v) {
        this.align[k] = v;
        moved = true;
      }
    }
    if (!moved || !this.index) return 0;
    let n = 0;
    for (const fit of this.fits.values()) {
      fit.plan = planFit(this.index.bones, fit.target, this.align);
      for (const [id] of fit.clips) {
        const clip = this.data.get(id);
        if (!clip) continue;
        this.fitOne(fit, id, clip);
        n++;
      }
    }
    return n;
  }

  /** A trim moved: the clips it anchors are fitted again in place, for every skeleton. */
  private restrip(ids: readonly TrimId[]): void {
    for (const fit of this.fits.values()) {
      for (const id of ids) {
        const clip = this.data.get(id);
        if (clip && fit.clips.has(id)) this.fitOne(fit, id, clip);
      }
    }
  }

  /**
   * Every clip's foot marks as the clip-event index takes them: by the game's clip name, each a fraction of the clip.
   * Marks nearer than `FOOT_FOLD` to the one before are that one's (both feet of a landing coming down together are
   * one footstep, at the first of them).
   */
  footEvents(): Record<string, { name: string; f: number }[]> {
    const out: Record<string, { name: string; f: number }[]> = {};
    for (const row of this.index?.clips ?? []) {
      const list: { name: string; f: number }[] = [];
      let last = -Infinity;
      for (const m of [...row.feet].sort((a, b) => a.t - b.t)) {
        if (m.t - last < FOOT_FOLD) continue;
        last = m.t;
        list.push({ name: 'event_footstep', f: Math.min(1, Math.max(0, m.t / row.duration)) });
      }
      if (list.length) out[clipName(row.id)] = list;
    }
    return out;
  }

  /** `__debug.anim()`'s account: the pack, what was fitted for which skeleton, and each fit's report. */
  report(): Record<string, unknown> {
    const n2 = (v: number) => Number(v.toFixed(2));
    const fits = [...this.fits.values()].map((f) => {
      const r: FitReport = f.plan.report;
      return {
        skeleton: f.label,
        key: f.key,
        joints: f.plan.joints.length,
        mapped: r.mapped,
        missing: r.missing,
        facingDeg: n2(r.facing),
        toesAgree: n2(r.toes),
        scale: Number(r.scale.toFixed(3)),
        standingRest: { leftFootM: Number(r.feet.left.toFixed(3)), rightFootM: Number(r.feet.right.toFixed(3)), hipsTiltDeg: n2(r.hipsTilt), spineTiltDeg: n2(r.spineTilt) },
        clips: [...f.clips.keys()].map(clipName),
        straysM: Object.fromEntries([...f.clips].filter(([, c]) => c.fitted.strays >= 0.02).map(([id, c]) => [clipName(id), Number(c.fitted.strays.toFixed(2))])),
        fitMs: n2(f.ms),
        longestClipMs: n2(f.longest),
      };
    });
    return {
      state: this.status,
      ...(this.why ? { why: this.why } : {}),
      clips: this.index?.clips.length ?? 0,
      used: this.index?.clips.filter((c) => c.use).map((c) => clipName(c.id)) ?? [],
      fetched: this.data.size,
      ...(this.lost.size ? { lost: Object.fromEntries(this.lost) } : {}),
      align: { limbs: true, ...this.align },
      fits,
    };
  }
}

/** A pause that lets a frame through: a message, never a timer, since a hidden tab holds timers back. */
function browserBreath(): Promise<void> {
  if (typeof MessageChannel === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(0);
  });
}

/** Whether the switch stood on at load: off only for a stored '0'. A page that refuses storage has it on. */
export function switchOn(read: () => string | null): boolean {
  try {
    return read() !== '0';
  } catch {
    return true;
  }
}

/** The little of an answer the page's way to the pack reads. */
export interface PackAnswer {
  ok: boolean;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  arrayBuffer?(): Promise<ArrayBuffer>;
}

/**
 * The page's own way to the pack, through the game's own asks of its public files (`fetchPublic` and
 * `fetchPublicBytes` in src/world/packFiles.ts, handed in so this file knows nothing of them): each answers null with
 * no request where the build's own list does not carry the file, and keeps every ask for `__debug.files()`. The index
 * is asked afresh, and a clip by an address its hash makes its own.
 */
export function browserIo(deps: {
  /** A public text file asked for by its path under `public/`; null where the build does not carry it. */
  text(path: string, init?: RequestInit): Promise<PackAnswer | null>;
  /** A public binary file asked for by its path, `query` on the request alone; null where the build does not carry it. */
  bytes(path: string, query: string): Promise<PackAnswer | null>;
}): PackIo {
  const on = switchOn(() => (typeof localStorage === 'undefined' ? null : localStorage.getItem(PACK_SWITCH)));
  return {
    enabled: () => on,
    index: async () => {
      const res = await deps.text(PACK_INDEX, { cache: 'no-store' });
      // A folder without the file answers with a miss, or with the page itself and a 200.
      if (!res || !res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
      return res.text();
    },
    clip: async (file, hash) => {
      const res = await deps.bytes(`${PACK_DIR}${file}`, `h=${encodeURIComponent(hash)}`);
      if (!res || !res.ok || (res.headers.get('content-type') ?? '').includes('html') || !res.arrayBuffer) return null;
      return res.arrayBuffer();
    },
    breath: browserBreath,
    now: () => performance.now(),
  };
}

let shared: MixamoPack | null = null;

/** The game's one pack. Made by the first caller's io (the page's); every later caller is handed the same one. */
export function mixamoPack(io?: PackIo): MixamoPack | null {
  if (!shared && io) shared = new MixamoPack(io);
  return shared;
}
