// A sky in parts (the race drawer's fourth wave, DESIGN.md §5c, the owner's "change parts of the sky"): a converted sky laid
// over with the parts a world of yours takes from other worlds' skies, each on its own -- its colours (the dome's gradient,
// the colour ramp the light, clear colour and fog are read from, the fog's band, the skybox, the stars), its cloud layers (or
// none), and its bodies (the suns and moons, each a picture out of any converted sky, placed by elevation and azimuth and
// sized). The weather's families stay the base sky's own (their kinds and beds); which may fall and how often is the world
// row's (`ourWorlds.ts`). Worked out on the sky's data before `SwgSky` is made from it, behind the loading screen, so nothing
// is built in play and the scene's light count never moves: every body is a sprite, and the light still comes from the first
// sun's path, the day cycle's.
//
// A file named by a part taken from another pack is re-rooted into that pack's folder (`../<pack>/`), which the base pack's
// own `url` resolves, as a guest pack's files are. Pure: node runs it with type stripping for the tests.

import type { SkyBlock, SkyData } from './sky.ts';

/** A body the sky's data names, the shape `SkyData` keeps it in. */
type Body = NonNullable<SkyData['sun']>;

/** A converted sky a part is taken from, and the prefix its files are re-rooted by ('' for the base pack's own). */
export interface SkySource {
  data: SkyData;
  prefix: string;
}

/** A body picked out of a sky (`<pack>/<sun|sun2|moon|moon2|c<n>>`) and where and how big it stands. */
export interface BodyPick {
  pic: string;
  el: number;
  az: number;
  size: number;
}

/** The parts a world takes: each null where it keeps the base sky's own. */
export interface SkyParts {
  colours: SkySource | null;
  clouds: SkySource | 'none' | null;
  /**
   * The suns and moons, with each pack's sky they name; null where it keeps the base's own bodies, and either list null where
   * it keeps the base's own suns or moons. Given at all, the base's own fixed bodies give way to these.
   */
  bodies: { suns: BodyPick[] | null; moons: BodyPick[] | null; skies: ReadonlyMap<string, SkySource> } | null;
}

/** The prefix a pack's files take from the base pack's folder: none for the base's own. */
export function prefixFor(basePack: string, pack: string): string {
  return pack === basePack ? '' : `../${pack}/`;
}

function re(file: string | null | undefined, prefix: string): string | null {
  return file ? `${prefix}${file}` : null;
}

function reFaces<T extends { faces: string[] } | null | undefined>(c: T, prefix: string): T {
  if (!c || !prefix) return c;
  return { ...c, faces: c.faces.map((f) => (f ? `${prefix}${f}` : f)) } as T;
}

function reImage<T extends { file: string } | null | undefined>(i: T, prefix: string): T {
  if (!i || !prefix) return i;
  return { ...i, file: `${prefix}${i.file}` } as T;
}

/** The block of `from` a base block takes a part from: the first of the same weather level, else its first. */
export function matchBlock(from: readonly SkyBlock[], b: SkyBlock): SkyBlock | null {
  return from.find((x) => x.weatherIndex === b.weatherIndex) ?? from[0] ?? null;
}

/** A body named by a pick's picture out of its sky, re-rooted, or null for a sky or body that has none. */
export function bodyOf(pic: string, skies: ReadonlyMap<string, SkySource>): Body | null {
  const slash = pic.indexOf('/');
  const pack = pic.slice(0, slash);
  const which = pic.slice(slash + 1);
  const s = skies.get(pack);
  if (!s) return null;
  const d = s.data;
  const b = which === 'sun' ? d.sun : which === 'sun2' ? d.supplementalSun : which === 'moon' ? d.moon : which === 'moon2' ? d.supplementalMoon : /^c\d+$/.test(which) ? d.celestials[Number(which.slice(1))] : null;
  if (!b) return null;
  return { shader: b.shader, size: b.size, glowShader: b.glowShader, glowSize: b.glowSize, image: reImage(b.image, s.prefix), glowImage: reImage(b.glowImage, s.prefix) };
}

/** A body at a pick's size: its glow grown with it, so the disc keeps its halo. */
function sized(b: Body, size: number): Body {
  const k = b.size > 0 ? size / b.size : 1;
  return { ...b, size, glowSize: b.glowSize * k };
}

/**
 * The base sky with the parts laid over it, and in words what could not be taken (a body a sky has not got). The base is
 * never written: every block a part touches is a copy.
 */
export function mixSky(base: SkyData, parts: SkyParts): { data: SkyData; said: string[] } {
  const said: string[] = [];
  const out: SkyData = { ...base, blocks: base.blocks.map((b) => ({ ...b })) };
  const c = parts.colours;
  if (c) {
    for (const b of out.blocks) {
      const x = matchBlock(c.data.blocks, b);
      if (!x) continue;
      b.gradientSky = re(x.gradientSky, c.prefix);
      b.ramp = x.ramp;
      b.fog = { ...x.fog };
      b.dayEnvironment = reFaces(x.dayEnvironment, c.prefix);
      b.nightEnvironment = reFaces(x.nightEnvironment, c.prefix);
    }
    out.skybox = c.data.skybox ? { ...(c.data.skybox.cube !== undefined ? { cube: reFaces(c.data.skybox.cube, c.prefix) } : {}), ...(c.data.skybox.sides ? { sides: Object.fromEntries(Object.entries(c.data.skybox.sides).map(([k, v]) => [k, re(v, c.prefix)])) } : {}) } : null;
    out.stars = c.data.stars;
    out.nightSky = c.data.nightSky ? { ...c.data.nightSky, image: reImage(c.data.nightSky.image, c.prefix) } : null;
    out.dayNightSplit = c.data.dayNightSplit;
  }
  const cl = parts.clouds;
  if (cl === 'none') {
    for (const b of out.blocks) {
      b.cloudBottom = null;
      b.cloudTop = null;
    }
  } else if (cl) {
    for (const b of out.blocks) {
      const y = matchBlock(cl.data.blocks, b);
      b.cloudBottom = y?.cloudBottom ? { ...y.cloudBottom, file: `${cl.prefix}${y.cloudBottom.file}` } : null;
      b.cloudTop = y?.cloudTop ? { ...y.cloudTop, file: `${cl.prefix}${y.cloudTop.file}` } : null;
    }
  }
  const bodies = parts.bodies;
  if (bodies) {
    const pick = (p: BodyPick): Body | null => {
      const b = bodyOf(p.pic, bodies.skies);
      if (!b) said.push(`${p.pic} is no body of a sky this world can read`);
      return b ? sized(b, p.size) : null;
    };
    // The first sun rides the light (the day cycle's), the first moon the night's; every other body stands fixed where it is
    // placed, as the converted skies' own extra bodies do (yaw from north clockwise, pitch over the horizon, both degrees).
    const fixed: Body[] = [];
    for (const list of [bodies.suns, bodies.moons]) {
      if (!list) continue;
      const got = list.map(pick);
      list.slice(1).forEach((p, i) => {
        const b = got[i + 1];
        if (b) fixed.push({ ...b, yaw: p.az, pitch: p.el, cycleTime: 0 });
      });
      // Where the first sun and moon stand is the light's path, never the sky's data: the first sun's elevation and azimuth
      // are the planet's (`planetOfWorld`, `day.configure`), and the first moon rides the night's light, so its own are not
      // asked for (the New world window offers none).
      if (list === bodies.suns) {
        out.sun = got[0] ?? null;
        out.supplementalSun = null;
      } else {
        out.moon = got[0] ?? null;
        out.supplementalMoon = null;
      }
    }
    out.celestials = fixed;
  }
  return { data: out, said };
}

/** What a world of yours' sky asks to be read, part by part (`skyAsks`): each pack, or `none`, or null for the base's own. */
export interface SkyAsks {
  colours: string | null;
  clouds: string | 'none' | null;
  /** The bodies' skies to read (the base pack first, then each picture's in order, each once) and the bodies themselves. */
  bodies: { packs: string[]; suns: BodyPick[] | null; moons: BodyPick[] | null } | null;
}

/**
 * Which skies a world of yours' sky in parts reads over the sky it draws (`basePack`'s), or null where it asks nothing and the
 * sky is drawn exactly as before. A part named for the base pack itself is the base's own. Blank cloud layers are the
 * colours' own (the row's word and the New world window's): on a copy whose colours come from another pack, that pack's
 * clouds, where the base is the source's sky and its clouds would otherwise stand.
 */
export function skyAsks(s: { colours?: string; clouds?: string; suns?: BodyPick[]; moons?: BodyPick[] } | null | undefined, basePack: string): SkyAsks | null {
  if (!s) return null;
  const colours = s.colours && s.colours !== basePack ? s.colours : null;
  const clouds = s.clouds === 'none' ? 'none' : s.clouds !== undefined ? (s.clouds !== basePack ? s.clouds : null) : colours;
  let bodies: SkyAsks['bodies'] = null;
  if (s.suns || s.moons) {
    const packs = [basePack];
    for (const b of [...(s.suns ?? []), ...(s.moons ?? [])]) {
      const pack = b.pic.slice(0, b.pic.indexOf('/'));
      if (pack && !packs.includes(pack)) packs.push(pack);
    }
    bodies = { packs, suns: s.suns ?? null, moons: s.moons ?? null };
  }
  return colours || clouds || bodies ? { colours, clouds, bodies } : null;
}

/** Every body picture a converted sky offers (`<pack>/<which>`), for the New world window's pickers. */
export function bodiesOf(pack: string, d: SkyData): { pic: string; kind: 'sun' | 'moon' | 'body'; file: string | null }[] {
  const out: { pic: string; kind: 'sun' | 'moon' | 'body'; file: string | null }[] = [];
  if (d.sun) out.push({ pic: `${pack}/sun`, kind: 'sun', file: d.sun.image?.file ?? null });
  if (d.supplementalSun) out.push({ pic: `${pack}/sun2`, kind: 'sun', file: d.supplementalSun.image?.file ?? null });
  if (d.moon) out.push({ pic: `${pack}/moon`, kind: 'moon', file: d.moon.image?.file ?? null });
  if (d.supplementalMoon) out.push({ pic: `${pack}/moon2`, kind: 'moon', file: d.supplementalMoon.image?.file ?? null });
  d.celestials.forEach((c, i) => out.push({ pic: `${pack}/c${i}`, kind: 'body', file: c.image?.file ?? null }));
  return out;
}
