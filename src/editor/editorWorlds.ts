// The world editor's worlds of yours (the race drawer's fourth wave, DESIGN.md §5c): a New world made from every choice the
// owner asked for (its size, its starter terrain, the converted pack whose ground pictures it borrows, its sky in parts, its
// suns and moons, its weather, its water's colour, its gravity, its arrival, its name), a Copy of the world standing (its
// terrain and buildings and nothing else), and every world of yours to go to, edit or take out. Drawn as the Tools tab's
// sections (the window's own fields and buttons, `EditorSection`), every write one row of the shared worlds file through the
// editing's batch (`putRows`, the `worlds` kind): one action, one undo. A world written while you stand in it takes its new
// ground, sky and water at its next arrival (Save and go travels there again).
//
// The dev server's alone: reached only through the editor's one dynamic import, as everything of `src/editor/` is.

import { PLANETS, packIdOf, type PlanetDef } from '../data/planets.ts';
import { NEW_WORLD_DOME, TERRAIN_PRESETS, copySourcePack } from '../data/ourWorlds.ts';
import { WORLDS_LIMITS, isWorldId, mintWorldId, readWorldRow, type WorldBody, type WorldRow } from '../world/editFiles/worldsFile.ts';
import type { EditorSection } from '../ui/editorWindow.ts';
import type { RowChange } from './undo.ts';

/** What the worlds' sections need of the editor and the game. */
export interface WorldsHost {
  putRows(label: string, changes: RowChange[]): Promise<string>;
  /** The worlds of yours as the page holds them (the file's rows, as last landed). */
  rows(): readonly WorldRow[];
  /** The world standing, and its zone. */
  planet(): PlanetDef;
  zone(): string | undefined;
  /** The raw place, the ground's height and the heading where the camera stands: what an arrival is set to. */
  here(): { x: number; z: number; y: number; heading: number } | null;
  travel(id: string): void;
  say(words: string): void;
  /** Every converted sky's bodies, in words (`<pack>: sun, moon, ...`), once read. */
  skiesNote(): string;
}

/** A body a new world starts with (ours): one sun high in the south-east and one moon, both out of the colours' own sky. */
const START_SUN: WorldBody = { pic: 'tatooine/sun', el: 50, az: 135, size: 0.3 };
const START_MOON: WorldBody = { pic: 'tatooine/moon', el: 40, az: 300, size: 0.2 };

/** The worlds' sections and their acts. */
export class EditorWorlds {
  /** The row being made or edited, as it reads now, and whether it is new to the file. */
  draft: Record<string, unknown> | null = null;
  private fresh = false;
  private readonly host: WorldsHost;
  /** The last thing said, for the console. */
  last = '';

  constructor(host: WorldsHost) {
    this.host = host;
  }

  /** A draft opened as it stands (the console's `make`): new to the file, or the row of its id it replaces. */
  openDraft(d: Record<string, unknown>, fresh: boolean): void {
    this.draft = JSON.parse(JSON.stringify(d)) as Record<string, unknown>;
    this.fresh = fresh;
    if (typeof this.draft.id !== 'string') {
      const taken = new Set(PLANETS.map((p) => p.id));
      for (const r of this.host.rows()) taken.add(r.id);
      this.draft.id = mintWorldId(typeof d.name === 'string' && d.name ? d.name : 'world', taken);
    }
  }

  /** Why the world standing cannot be copied, or null: a copy is a ground world of the game's with a pack. */
  copyRefusal(planet: PlanetDef = this.host.planet()): string | null {
    if (planet.ours) return `${planet.name} is a world of yours: copy the world it came from instead`;
    if (planet.space) return 'a space zone has no terrain to copy';
    if (planet.instances) return 'the world of copies is no one world to copy';
    if (planet.pack === false) return `${planet.name} has no pack of its own: start a new world on its raster instead`;
    return null;
  }

  /** A new world's draft: every choice at the design's starting value. */
  newDraft(name = 'Race map'): Record<string, unknown> {
    const taken = new Set(PLANETS.map((p) => p.id));
    for (const r of this.host.rows()) taken.add(r.id);
    return {
      id: mintWorldId(name, taken),
      kind: 'new',
      name,
      size: 8192,
      start: { kind: 'flat', height: 0 },
      sky: { colours: 'tatooine', suns: [{ ...START_SUN }], moons: [{ ...START_MOON }] },
      gravity: 20,
    };
  }

  /** A copy's draft of the world standing (its zone's pack where it has zones). */
  copyDraft(): Record<string, unknown> | string {
    const p = this.host.planet();
    const no = this.copyRefusal(p);
    if (no) return no;
    const of = packIdOf(p, this.host.zone());
    if (!copySourcePack(of)) return `${of} cannot be copied`;
    const taken = new Set(PLANETS.map((x) => x.id));
    for (const r of this.host.rows()) taken.add(r.id);
    const name = `${p.name} copy`;
    return { id: mintWorldId(name, taken), kind: 'copy', of, name };
  }

  /** The row a draft would write, or why it would write none (the shipped reader's own words). */
  rowOf(d: Record<string, unknown>): WorldRow | string {
    const unknown: string[] = [];
    const row = readWorldRow(d, unknown);
    if (typeof row === 'string') return row;
    if (unknown.length) return `it carries fields this build does not write: ${unknown.join(', ')}`;
    return row;
  }

  /** The draft written as one action (a new row, or the row it replaces), or why not. */
  async save(): Promise<string> {
    const d = this.draft;
    if (!d) return 'nothing to save';
    const row = this.rowOf(Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'at')));
    if (typeof row === 'string') return (this.last = `not saved: ${row}`);
    const before = this.host.rows().find((r) => r.id === row.id) ?? null;
    if (!before && !this.fresh) return (this.last = `not saved: ${row.id} is no longer in the file`);
    if (before && this.fresh) return (this.last = `not saved: ${row.id} is in the file already`);
    const said = await this.host.putRows(before ? `world ${row.name} changed` : `world ${row.name} made`, [{ file: 'worlds', id: row.id, before: before as unknown as RowChange['before'], after: row as unknown as RowChange['after'] }]);
    if (!written(said)) return (this.last = `not saved: ${said}`);
    this.fresh = false;
    this.draft = { ...row };
    return (this.last = `saved ${row.id} into public/placements/worlds/all.json: it reaches players once that file is committed and merged`);
  }

  /** A world of yours taken out of the file, as one action. */
  async remove(id: string): Promise<string> {
    const before = this.host.rows().find((r) => r.id === id) ?? null;
    if (!before) return (this.last = `${id} is no world of yours`);
    if (this.host.planet().id === id) return (this.last = `you stand on ${id}: go to another world before taking it out`);
    const said = await this.host.putRows(`world ${before.name} taken out`, [{ file: 'worlds', id, before: before as unknown as RowChange['before'], after: null }]);
    if (!written(said)) return (this.last = `not taken out: ${said}`);
    if (this.draft?.id === id) this.draft = null;
    return (this.last = `took ${id} out (its own edit files are left where they are)`);
  }

  /** A field of the draft set from the window (`worlds:f:<path>`), the value as typed. */
  setField(path: string, value: string): void {
    const d = this.draft;
    if (!d) return;
    try {
      this.setFieldIn(path, value);
    } finally {
      // What a field wrote that the row cannot carry is taken off again: a copy has its source's terrain and ground, and an
      // empty sky is none.
      if (d.kind === 'copy') {
        delete d.start;
        delete d.size;
        delete d.ground;
      }
      if (d.sky && typeof d.sky === 'object' && !Object.keys(d.sky as object).length) delete d.sky;
    }
  }

  private setFieldIn(path: string, value: string): void {
    const d = this.draft;
    if (!d) return;
    const num = Number(value);
    const colour = (v: string): number => parseInt(v.replace('#', ''), 16) || 0;
    const sky = (d.sky ??= {}) as Record<string, unknown>;
    const start = (d.start ??= { kind: 'flat', height: 0 }) as Record<string, unknown>;
    const bodies = (k: 'suns' | 'moons'): WorldBody[] => ((sky[k] as WorldBody[] | undefined) ?? (sky[k] = []) as WorldBody[]);
    const m = /^(suns|moons)\.(\d+)\.(pic|el|az|size)$/.exec(path);
    if (m) {
      const list = bodies(m[1] as 'suns' | 'moons');
      const b = list[Number(m[2])];
      if (!b) return;
      if (m[3] === 'pic') b.pic = value.trim();
      else (b as unknown as Record<string, number>)[m[3]] = num;
      return;
    }
    switch (path) {
      case 'name':
        d.name = value;
        return;
      case 'desc':
        if (value) d.desc = value;
        else delete d.desc;
        return;
      case 'listed':
        if (value === 'true') d.listed = true;
        else delete d.listed;
        return;
      case 'size':
        d.size = num;
        return;
      case 'start': {
        const v = value.trim();
        if (v === 'flat') d.start = { kind: 'flat', height: Number(start.height ?? start.base ?? 0) || 0 };
        else if (v.startsWith('raster:')) d.start = { kind: 'raster', of: v.slice('raster:'.length) };
        else if (TERRAIN_PRESETS[v]) d.start = { kind: 'noise', ...TERRAIN_PRESETS[v] };
        return;
      }
      case 'height':
        if (start.kind === 'flat') start.height = num;
        else if (start.kind === 'noise') start.base = num;
        return;
      case 'amplitude':
      case 'frequency':
      case 'octaves':
      case 'ridged':
      case 'flatten':
      case 'detail':
        if (start.kind === 'noise') start[path] = num;
        return;
      case 'groundPack':
      case 'groundBase':
      case 'groundRules': {
        const g = (d.ground ?? {}) as Record<string, unknown>;
        const k = path === 'groundPack' ? 'pack' : path === 'groundBase' ? 'base' : 'rules';
        if (value.trim()) g[k] = value.trim();
        else delete g[k];
        if (g.pack || g.base) d.ground = g;
        else delete d.ground;
        return;
      }
      case 'colours':
        if (value.trim() && value.trim() !== 'dome') sky.colours = value.trim();
        else delete sky.colours;
        return;
      case 'domeTop':
      case 'domeHorizon':
      case 'domeSun':
      case 'domeFog': {
        const dome = (sky.dome ??= { ...NEW_WORLD_DOME }) as Record<string, number>;
        dome[path.slice(4).toLowerCase()] = colour(value);
        return;
      }
      case 'clouds':
        if (value.trim()) sky.clouds = value.trim();
        else delete sky.clouds;
        return;
      case 'suns':
      case 'moons': {
        const n = Math.max(0, Math.min(path === 'suns' ? WORLDS_LIMITS.suns : WORLDS_LIMITS.moons, Math.round(num) || 0));
        const list = bodies(path);
        const seed = path === 'suns' ? START_SUN : START_MOON;
        while (list.length < n) list.push({ ...seed, az: (seed.az + 50 * list.length) % 360 });
        list.length = n;
        return;
      }
      case 'ownBodies':
        if (value === 'true') {
          delete sky.suns;
          delete sky.moons;
        } else {
          sky.suns = [{ ...START_SUN }];
          sky.moons = [{ ...START_MOON }];
        }
        return;
      case 'kind': {
        const w = (d.weather ??= {}) as Record<string, unknown>;
        if (['rain', 'dust', 'snow'].includes(value.trim())) w.kind = value.trim();
        else delete w.kind;
        if (!Object.keys(w).length) delete d.weather;
        return;
      }
      case 'climate': {
        const w = (d.weather ??= {}) as Record<string, unknown>;
        const list = value.split(/[\s,]+/).filter(Boolean).map(Number);
        if (list.length) w.climate = list;
        else delete w.climate;
        if (!Object.keys(w).length) delete d.weather;
        return;
      }
      case 'waterOwn':
        if (value === 'true') d.water = { color: 0x2f6f8a, opacity: 0.8 };
        else delete d.water;
        return;
      case 'waterColour':
        if (d.water) (d.water as Record<string, number>).color = colour(value);
        return;
      case 'waterOpacity':
        if (d.water) (d.water as Record<string, number>).opacity = num;
        return;
      case 'gravity':
        d.gravity = num;
        return;
    }
    if (!Object.keys(sky).length) delete d.sky;
  }

  /** Why "Arrival here" takes nothing now, or null: the draft must be the world standing, whose camera place it is. */
  arrivalRefusal(): string | null {
    const d = this.draft;
    if (!d) return 'no world is open';
    const here = this.host.planet();
    return here.id === d.id ? null : `the camera stands on ${here.name}, not on ${String(d.name ?? d.id)}: go there (Save and go) and set its arrival there`;
  }

  /** An act of the worlds' sections; false for an act that is none of theirs. */
  async act(act: string, value?: string): Promise<boolean> {
    if (!act.startsWith('worlds:')) return false;
    const a = act.slice('worlds:'.length);
    const h = this.host;
    if (a === 'new') {
      this.draft = this.newDraft();
      this.fresh = true;
    } else if (a === 'copy') {
      const d = this.copyDraft();
      if (typeof d === 'string') h.say((this.last = `cannot copy: ${d}`));
      else {
        this.draft = d;
        this.fresh = true;
      }
    } else if (a.startsWith('edit:')) {
      const r = h.rows().find((x) => x.id === a.slice(5));
      if (r) {
        this.draft = JSON.parse(JSON.stringify(r)) as Record<string, unknown>;
        this.fresh = false;
      }
    } else if (a.startsWith('go:')) h.travel(a.slice(3));
    else if (a.startsWith('delete:')) h.say(await this.remove(a.slice(7)));
    else if (a === 'cancel') this.draft = null;
    else if (a === 'arrival') {
      // The camera's place is the world standing's: only a draft of that very world takes it as its arrival.
      const no = this.arrivalRefusal();
      const p = no ? null : h.here();
      if (no) h.say((this.last = `no arrival set: ${no}`));
      else if (p && this.draft) this.draft.arrival = { x: Math.round(p.x * 100) / 100 + 0, z: Math.round(p.z * 100) / 100 + 0, y: Math.round(p.y * 100) / 100 + 0, heading: Math.round(p.heading * 1000) / 1000 + 0 };
    } else if (a === 'noArrival') {
      if (this.draft) delete this.draft.arrival;
    } else if (a === 'save' || a === 'saveGo') {
      const words = await this.save();
      h.say(words);
      const id = this.draft?.id;
      if (a === 'saveGo' && words.startsWith('saved') && typeof id === 'string') h.travel(id);
    } else if (a.startsWith('f:')) this.setField(a.slice(2), value ?? '');
    return true;
  }

  /** The Tools tab's sections: every world of yours, and the draft's every field while one is open. */
  sections(): EditorSection[] {
    const h = this.host;
    const here = h.planet();
    const rows = h.rows();
    const out: EditorSection[] = [
      {
        title: 'Worlds of yours',
        note: rows.length
          ? 'Worlds made here (public/placements/worlds/all.json): each one\'s edit files are its own. Go travels there; a world edited while you stand in it changes at its next arrival.'
          : 'None yet. A new world is a race map of its own; a copy is the world standing\'s terrain and buildings, and nothing else, to edit without touching it.',
        rows: rows.map((r) => ({
          words: `${r.name} (${r.id}, ${r.kind === 'copy' ? `a copy of ${r.of}` : 'new'})`,
          buttons: [
            { label: 'Go', act: `worlds:go:${r.id}`, off: here.id === r.id },
            { label: 'Edit', act: `worlds:edit:${r.id}` },
            { label: 'Delete', act: `worlds:delete:${r.id}`, danger: true, off: here.id === r.id },
          ],
        })),
        buttons: [
          { label: 'New world', act: 'worlds:new' },
          { label: 'Copy this world', act: 'worlds:copy', off: !!this.copyRefusal(here) },
        ],
      },
    ];
    const d = this.draft;
    if (!d) return out;
    const sky = (d.sky ?? {}) as Record<string, unknown>;
    const start = (d.start ?? {}) as Record<string, unknown>;
    const ground = (d.ground ?? {}) as Record<string, unknown>;
    const weather = (d.weather ?? {}) as Record<string, unknown>;
    const water = d.water as { color: number; opacity: number } | undefined;
    const hex = (n: unknown): string => `#${((typeof n === 'number' ? n : 0) >>> 0).toString(16).padStart(6, '0')}`;
    const f = (label: string, path: string, value: string | number | boolean, kind?: 'text' | 'number' | 'check' | 'colour') => ({ label, value, act: `worlds:f:${path}`, ...(kind ? { kind } : {}) });
    const isNew = d.kind === 'new';
    const startWord = start.kind === 'raster' ? `raster:${start.of}` : start.kind === 'noise' ? (Object.entries(TERRAIN_PRESETS).find(([, v]) => v.amplitude === start.amplitude && v.frequency === start.frequency)?.[0] ?? 'hills') : 'flat';
    const fields: NonNullable<EditorSection['fields']> = [f('Name', 'name', String(d.name ?? '')), f('Description', 'desc', String(d.desc ?? '')), f('Listed on the creator', 'listed', !!d.listed, 'check')];
    if (isNew) {
      fields.push(f('Size, m a side', 'size', Number(d.size ?? 8192), 'number'), f('Starter terrain', 'start', startWord), f(start.kind === 'noise' ? 'Base height' : 'Flat height', 'height', Number(start.kind === 'noise' ? start.base : start.height) || 0, 'number'));
      if (start.kind === 'noise') for (const k of ['amplitude', 'frequency', 'octaves', 'ridged', 'flatten', 'detail']) fields.push(f(k[0].toUpperCase() + k.slice(1), k, Number(start[k]) || 0, 'number'));
      fields.push(f('Ground pictures from (pack)', 'groundPack', String(ground.pack ?? '')), f('Base family', 'groundBase', String(ground.base ?? '')), f('Elevation rules from (world)', 'groundRules', String(ground.rules ?? '')));
    }
    fields.push(f('Sky colours from (pack, or dome)', 'colours', String(sky.colours ?? (isNew ? 'dome' : ''))));
    if (isNew && !sky.colours) {
      const dome = (sky.dome ?? NEW_WORLD_DOME) as Record<string, number>;
      fields.push(f('Dome top', 'domeTop', hex(dome.top), 'colour'), f('Dome horizon', 'domeHorizon', hex(dome.horizon), 'colour'), f('Sun colour', 'domeSun', hex(dome.sun), 'colour'), f('Fog colour', 'domeFog', hex(dome.fog), 'colour'));
    }
    fields.push(f('Cloud layers from (pack, none, or blank for the colours\')', 'clouds', String(sky.clouds ?? '')), f("The sky's own suns and moons", 'ownBodies', !sky.suns && !sky.moons, 'check'));
    if (sky.suns || sky.moons) {
      const suns = (sky.suns as WorldBody[] | undefined) ?? [];
      const moons = (sky.moons as WorldBody[] | undefined) ?? [];
      fields.push(f('Suns (0 to 3; the first is the light)', 'suns', suns.length, 'number'));
      suns.forEach((b, i) => fields.push(f(`Sun ${i + 1} picture`, `suns.${i}.pic`, b.pic), f(`Sun ${i + 1} elevation`, `suns.${i}.el`, b.el, 'number'), f(`Sun ${i + 1} azimuth`, `suns.${i}.az`, b.az, 'number'), f(`Sun ${i + 1} size`, `suns.${i}.size`, b.size, 'number')));
      fields.push(f('Moons (0 to 4)', 'moons', moons.length, 'number'));
      // The first moon rides the night's light (as the first sun the day's), so it is placed by the day and offers no elevation
      // or azimuth of its own; every other moon stands fixed where it is placed.
      moons.forEach((b, i) => fields.push(f(`Moon ${i + 1} picture`, `moons.${i}.pic`, b.pic), ...(i === 0 ? [] : [f(`Moon ${i + 1} elevation`, `moons.${i}.el`, b.el, 'number'), f(`Moon ${i + 1} azimuth`, `moons.${i}.az`, b.az, 'number')]), f(`Moon ${i + 1} size`, `moons.${i}.size`, b.size, 'number')));
    }
    // The weather is a converted sky's (its families' kinds and beds): the procedural dome has none, so its fields stand greyed.
    const noWeather = isNew && !sky.colours;
    const w = (label: string, path: string, value: string) => (noWeather ? { label: `${label}: needs a converted sky's colours`, value, act: null } : f(label, path, value));
    fields.push(w('Weather kind (rain, dust, snow, or blank)', 'kind', String(weather.kind ?? '')), w('Climate (weights a weather level)', 'climate', Array.isArray(weather.climate) ? (weather.climate as number[]).join(', ') : ''));
    fields.push(f('A water colour of its own', 'waterOwn', !!water, 'check'));
    if (water) fields.push(f('Water colour', 'waterColour', hex(water.color), 'colour'), f('Water opacity', 'waterOpacity', water.opacity, 'number'));
    fields.push(f('Gravity, m/s²', 'gravity', Number(d.gravity ?? here.gravity ?? 20), 'number'));
    const arrival = d.arrival as { x: number; z: number; y: number } | undefined;
    const row = this.rowOf(Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'at')));
    const cannot = typeof row === 'string' ? '' : skyCannotWords(row);
    out.push({
      title: d.kind === 'copy' ? `Copy of ${d.of}` : this.fresh ? 'New world' : `World ${d.name}`,
      note: [
        `${String(d.id)}: ${typeof row === 'string' ? `not yet saveable: ${row}` : 'saveable'}.`,
        d.kind === 'copy' ? 'A copy takes its source\'s terrain and buildings and nothing else: no people, creatures, lairs, travel, fittings, placed sounds, story rows or edit files.' : '',
        `Arrival: ${arrival ? `${arrival.x}, ${arrival.z} at ${arrival.y} m` : 'the flattest dry spot near the middle'}.`,
        `Starter terrain: flat, ${Object.keys(TERRAIN_PRESETS).join(', ')}, or raster:<world> (${PLANETS.filter((p) => p.dem && !p.dem.made && !p.ours).map((p) => p.id).join(', ')}). __debug.families('<pack>') lists a pack's families.`,
        cannot,
        h.skiesNote(),
      ].filter(Boolean).join(' '),
      fields,
      buttons: [
        { label: 'Arrival here', act: 'worlds:arrival', off: !!this.arrivalRefusal() },
        { label: 'No arrival', act: 'worlds:noArrival', off: !arrival },
        { label: 'Save', act: 'worlds:save', off: typeof row === 'string' },
        { label: 'Save and go', act: 'worlds:saveGo', off: typeof row === 'string' },
        { label: 'Close', act: 'worlds:cancel' },
      ],
    });
    return out;
  }
}

/**
 * What a world's sky cannot take, in words: the procedural dome has no cloud sheets, no pictured bodies (it draws its own
 * sun discs by count) and no weather (the weather is a converted sky's families, their kinds and beds), so a cloud source, a
 * picture, a weather kind or a climate named under it is set aside until a converted sky's colours are chosen.
 */
export function skyCannotWords(row: WorldRow): string {
  const s = row.sky;
  if (row.kind === 'copy' || s?.colours) return '';
  const said: string[] = [];
  if (s?.clouds && s.clouds !== 'none') said.push('cloud layers');
  if ((s?.suns ?? []).length || (s?.moons ?? []).length) said.push('pictured suns and moons (it draws its own sun discs by count, and no moon)');
  if (row.weather?.kind || row.weather?.climate) said.push('weather (it is always clear)');
  return said.length ? `The procedural dome takes no ${said.join(' and no ')}: choose a converted sky's colours to have them.` : '';
}

/**
 * The heading an arrival is written with from the editor camera's yaw: the game's frame, a body facing `(sin h, cos h)`, the
 * camera's forward `(-sin yaw, -cos yaw)`, so the player arrives looking where the camera looked.
 */
export function arrivalHeadingOf(yaw: number): number {
  return Math.atan2(-Math.sin(yaw), -Math.cos(yaw));
}

/** Whether the editing's words for a write say it was written (`<label>: <n> rows written`); anything else is a refusal. */
export function written(said: string): boolean {
  return / rows? written$/.test(said);
}

/** Whether an act is the worlds' (`worlds:`). */
export function isWorldsAct(act: string): boolean {
  return act.startsWith('worlds:');
}

export { isWorldId };
