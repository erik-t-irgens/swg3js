// One conversion, planned: where the two installs are, and what may run beside what.
//
// Nothing here converts anything and nothing here holds a list of conversions. What is to be run
// comes from the converter's own `status --json`, which is the only truth about what is missing;
// this module answers the two questions `status` does not: where the client and Jedi Academy are
// on this machine, and which of the steps it asked for may run at the same time.
//
// The order is the converter's, not ours. Every dependency below was read out of the converter or
// out of what it writes, and the reading is named beside it; anything that could not be read that
// way is treated as dependent and said so, because a step run too early does not fail -- it writes
// a pack that is quietly wrong and is found hours later, or not at all. Two rules do the work:
//
//   `needs`  the commands whose output this one reads. A name that is no step of this run is taken
//            as already done, since `status` asks only for the work that is left.
//   `locks`  the folders it writes. Two steps never run while they hold the same lock, which is the
//            whole of the "may these run together" question: the converter keeps no state between
//            runs but the files it writes, so two steps that write one folder are the only pair
//            that can tread on each other.
//
// A command this file has never heard of runs alone, waits for nothing and is waited for by
// nothing: an unknown step is the one place a guess would be expensive.
//
// Two smaller rules sit beside those. A pair of runs of one command where one does everything the
// other does is folded into the wider one (`foldSupersets`, which today is the sound bank and
// nothing else), since the dedup keys on the arguments and cannot see a superset. And `--only` is
// applied to the finished plan rather than on the way in, so that a dependency it takes out can be
// told from one `status` never asked for and said out loud: the first is work this run is leaving
// undone on purpose, and the step in front of it will be quietly short of whatever it wrote.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkJka, checkSwg } from '../launcher/checks.mjs';
import { labelOf } from '../launcher/plan.mjs';

/** Bumped when the shape of a planned step changes in a way a caller must know about. */
export const PLAN_FORMAT = 1;

const GB = 1024 ** 3;

/**
 * Our numbers, none of them the converter's. They do two jobs: put the longest pole first, and keep
 * the machine from being asked for more memory than it has. The second is the one that has to be
 * right in the safe direction, because the two mistakes are not the same size: a figure that is too
 * high only holds a step back until there is room for it, while a figure that is too low starts it
 * anyway and oversubscribes the machine, which is the one thing this half of the model exists to
 * stop. So every figure below is either a real measurement or is deliberately above every real
 * measurement, and which of the two it is is written beside it (`measured` in the table).
 *
 * The measurements were taken by running the command itself against the owner's own archives into a
 * scratch folder, one step at a time on an otherwise idle machine, with the child's peak working
 * set watched at 5 Hz. They are one machine's and one run's, which is why the table budgets a step
 * about a third above what it was seen to hold.
 */
export const COST = {
  /** Mounting the retail archives, before a step converts anything: measured, 200 archives, 1.8 s. */
  MOUNT_SECONDS: 2,
  /** What that mount holds: measured, 292 MB of a 315 MB peak for a step that does almost nothing. */
  MOUNT_BYTES: 0.31 * GB,
  /**
   * What a step nobody has run under a stopwatch is budgeted at. It is above the largest figure any
   * measured step was seen to hold (`species`, 2,015 MB), so an unmeasured step can never be the
   * one that oversubscribes the machine; `npm run test:converter` fails if a measurement ever comes
   * in above it, which is the reminder to measure the rest rather than to raise this.
   */
  UNMEASURED_BYTES: 2.6 * GB,
  /** What a command this file has never heard of is assumed to want; it runs alone in any case. */
  UNKNOWN_SECONDS: 600,
  UNKNOWN_BYTES: 2.6 * GB,
};

/**
 * What each command writes, what it reads of what another command wrote, and roughly what it costs.
 *
 *   order     where it stands in the list, which is the converter's own order (README, "Converting
 *             your own SWG install") wherever the dependencies leave it alone, and never disagrees
 *             with them: the list is printed in an order it could really be run in
 *   lock      the folder it owns; `pack` and `zone` stand in for one per planet and one per zone
 *   needs     the commands whose output it reads; the reading itself is named in the comments
 *   seconds   the whole command, the mount not counted (`costOf` adds it); `each` is one planet or
 *             zone of an `all` run, likewise without the mount
 *   bytes     what one child of it is budgeted to hold at its peak
 *   measured  what was really run and what it really cost, or absent for a step nobody has run
 *
 * Every step below has been run against the owner's own archives and watched: the `measured` field
 * is what it really cost, and `bytes` is that with about a third on top, since a peak seen once is
 * not a ceiling. A step added later that nobody has run carries no `measured` and is budgeted at
 * `COST.UNMEASURED_BYTES`, which the test holds above every figure here.
 */
export const STEP_FACTS = {
  // The planets. Every one of these writes into the planet packs and gates on a pack being there
  // already (`existsSync(join(<out>, planet, 'manifest.json'))`, cli.mjs's terrain, sky and water
  // cases; maps reads `layout.json`; pois reads `layout.json` for the centre the pack was built
  // around and invents another when it is not there), so each of them waits for the snapshot.
  // The planet figures were measured on tatooine, which is a middling planet; corellia and naboo
  // place more. `seconds` is that times the eighteen planets with something over for the bigger ones.
  snapshot: { order: 10, lock: 'pack', needs: [], seconds: 900, each: 33, bytes: 0.8 * GB, measured: 'tatooine: 34.8 s, 597 MB' },
  terrain: { order: 11, lock: 'pack', needs: ['snapshot'], seconds: 30, each: 1, bytes: 0.5 * GB, measured: 'tatooine: 2.8 s, 330 MB' },
  sky: { order: 12, lock: 'pack', needs: ['snapshot'], seconds: 30, each: 1, bytes: 0.5 * GB, measured: 'tatooine: 2.4 s, 293 MB' },
  water: { order: 13, lock: 'pack', needs: ['snapshot'], seconds: 30, each: 1, bytes: 0.5 * GB, measured: 'tatooine: 2.4 s, 325 MB' },
  pois: { order: 14, lock: 'pack', needs: ['snapshot'], seconds: 30, each: 1, bytes: 0.5 * GB, measured: 'tatooine: 2.2 s, 308 MB' },
  flora: { order: 15, lock: 'pack', needs: ['snapshot'], seconds: 60, each: 2, bytes: 0.5 * GB, measured: 'tatooine: 2.4 s, 323 MB' },
  // maps reads each pack's own terrain.trn for how wide the ground is and falls back to 16384 m
  // when it cannot be read, which is a wrong map nothing would ever ask about again: it waits for
  // whoever writes that file (the snapshot writes it, and terrain writes it again).
  maps: { order: 16, lock: 'pack', locks: ['galaxy'], needs: ['snapshot', 'terrain'], seconds: 20, bytes: 0.5 * GB, measured: 'one pack in place: 2.2 s, 310 MB' },

  // The wardrobes. Each run writes one folder of its own (`join(<out>, 'wardrobe', speciesId)`, and
  // the id is a function of --template and --gender alone), so the four the converter asks for are
  // the one large piece of work that runs four ways at once. They stand first because the
  // character's own index waits for them, not because the converter's list has them there: the
  // README runs them later and then says to run the species again after.
  wardrobe: { order: 20, lock: 'wardrobe', needs: [], seconds: 90, bytes: 1.25 * GB, measured: 'human_male, 1,340 items: 81.8 s, 943 MB' },
  // The creatures and the character. `parts` and `species` both write characters/index.json, and
  // that index names each species' wardrobe folder from what is on disk when it is written
  // (writeSpeciesIndex in cli.mjs), so both wait for the wardrobes: a species indexed before its
  // wardrobe was converted carries no wardrobe and nothing ever asks again.
  creatures: { order: 21, lock: 'creatures', needs: [], seconds: 20, bytes: 0.5 * GB, measured: '18.0 s, 391 MB, 118 MB written' },
  player: { order: 22, lock: 'player', needs: [], seconds: 15, bytes: 1.9 * GB, measured: '8.4 s, 1,454 MB, a 215 MB rig' },
  parts: { order: 23, lock: 'characters', needs: ['player', 'wardrobe'], seconds: 15, bytes: 1.8 * GB, measured: '8.0 s, 1,357 MB' },
  // clips-save reads the player pack's own GLB and manifest; clips-apply writes the parts rig.
  'clips-save': { order: 24, lock: 'player', needs: ['player'], seconds: 5, bytes: 0.45 * GB, measured: '486 clips out: 0.5 s, 332 MB' },
  'clips-apply': { order: 25, lock: 'characters', needs: ['clips-save', 'parts'], seconds: 5, bytes: 1.05 * GB, measured: '486 clips onto the parts rig: 1.3 s, 806 MB' },
  species: { order: 26, lock: 'characters', needs: ['parts', 'clips-apply', 'wardrobe'], seconds: 150, bytes: 2.6 * GB, measured: 'every playable species: 118.4 s, 2,015 MB, 199 MB written' },
  loading: { order: 27, lock: 'loading', needs: [], seconds: 5, bytes: 0.4 * GB, measured: '2.4 s, 315 MB, 10 pictures' },
  // The mobiles read characters/index.json and every wardrobe's wardrobe.json to dress their NPCs.
  // The catalogue over all 5,067 entries is built whatever the run converts, so what was measured on
  // a 150-entry run is the whole of the standing cost and only the unit in hand moves on top of it.
  mobiles: { order: 28, lock: 'mobiles', needs: ['species', 'wardrobe'], seconds: 600, bytes: 1 * GB, measured: '150 of 5,067 entries (60 models, 34 packs): 26.6 s, 540 MB' },
  weapons: { order: 29, lock: 'weapons', needs: [], seconds: 10, bytes: 0.5 * GB, measured: '6.9 s, 342 MB' },
  // The ships hang an astromech from the mobiles pack's own model and leave the droid out when that
  // file is not there (buildDroids' `hasModel`), which is a garage that quietly has no droids.
  ships: { order: 30, lock: 'ships', needs: ['mobiles'], seconds: 100, bytes: 0.75 * GB, measured: '84.5 s, 559 MB, 280 MB written' },
  space: { order: 31, lock: 'zone', needs: [], seconds: 30, each: 2, bytes: 0.6 * GB, measured: 'every zone: 19.5 s, 461 MB, 374 MB written' },
  // The made-up system writes a folder of its own that no other command touches.
  sandbox: { order: 32, lock: 'sandbox', needs: [], seconds: 5, bytes: 0.4 * GB, measured: '2.6 s, 321 MB' },
  gallery: { order: 33, lock: 'gallery', needs: [], seconds: 120, bytes: 2.3 * GB, measured: '94.5 s, 1,767 MB' },
  // The sounds join the ships pack by id (`join(<out>, 'ships', 'manifest.json')`), write each
  // planet's own placed sounds into its pack (and pass a planet over when it has none), and are
  // checked afterwards against the species packs' clip lists, which is what makes `status` ask for
  // a species and then the sounds again when the two have drifted apart.
  // The bank is 865 MB of samples copied as they are, which is why it is quick for its size; the
  // planets' places on top of it were measured with one pack in place and are the part of the
  // figure below that is reasoned rather than watched.
  sounds: { order: 34, lock: 'sounds', needs: ['ships', 'species', 'parts', 'clips-apply', 'player', 'snapshot'], seconds: 120, bytes: 0.7 * GB, measured: 'the bank: 7.6 s, 425 MB, 865 MB written; with one planet\'s places: 5.4 s, 510 MB' },
};

// Which commands carry the planet (or the zone) as their second argument and the output folder as
// their third, and which take the output folder second and write every pack there is. `maps` is the
// second kind: `maps <swg-dir> <out-dir>` writes a map into every planet pack it finds.
/** The commands whose second argument is a planet (or `all`). */
const PER_PLANET = new Set(['snapshot', 'terrain', 'sky', 'water', 'pois', 'flora']);
/** The same for a space zone. */
const PER_ZONE = new Set(['space']);

/** The planet or zone a step names, or `all` for a command that writes every one of them. */
function scopeOf(command, args) {
  return PER_PLANET.has(command) || PER_ZONE.has(command) ? args?.[2] ?? 'all' : 'all';
}

/** Every planet pack, or every zone, as one lock; a step that holds it holds each of them too. */
const ALL_PACKS = 'pack:*';
const ALL_ZONES = 'zone:*';

// ---------------------------------------------------------------------------------------------
// Where the installs are.

/** The usual places a client install is found, tried in this order and every one of them checked. */
export const USUAL_SWG = [
  'C:\\Program Files (x86)\\StarWarsGalaxies',
  'C:\\Program Files\\StarWarsGalaxies',
  'C:\\Program Files (x86)\\Sony\\Star Wars Galaxies',
  'C:\\Program Files (x86)\\Sony Online Entertainment\\StarWarsGalaxies',
  'C:\\Program Files (x86)\\StarWarsGalaxiesLegends',
  'C:\\Program Files (x86)\\SWGLegends',
  'C:\\SWGLegends',
  'C:\\SWG',
  'C:\\Games\\SWG',
  'D:\\SWG',
];

/** The usual places Jedi Academy is found. Its GameData folder, or the base folder inside it. */
export const USUAL_JKA = [
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Jedi Academy\\GameData',
  'C:\\Program Files\\Steam\\steamapps\\common\\Jedi Academy\\GameData',
  'C:\\Program Files (x86)\\LucasArts\\Star Wars Jedi Knight Jedi Academy\\GameData',
  'C:\\GOG Games\\Star Wars Jedi Knight - Jedi Academy\\GameData',
  'C:\\Program Files (x86)\\GOG Galaxy\\Games\\Star Wars Jedi Knight - Jedi Academy\\GameData',
];

/** The registry keys Windows keeps its installed games in: the uninstall lists and each game's own. */
export const REGISTRY_KEYS = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\WOW6432Node\\Sony Online Entertainment',
  'HKLM\\SOFTWARE\\Sony Online Entertainment',
  'HKCU\\SOFTWARE\\Sony Online Entertainment',
  'HKLM\\SOFTWARE\\WOW6432Node\\LucasArts',
  'HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games',
  'HKLM\\SOFTWARE\\GOG.com\\Games',
];

/** Which of those records is which game: the words a display name or a key carries. */
const SWG_WORDS = /star\s*wars\s*galaxies|starwarsgalaxies|\bswg\b/i;
const JKA_WORDS = /jedi\s*(knight[^a-z]*)?academy|jediacademy/i;

/**
 * `reg query <key> /s`'s output as records: one per key, with the values it printed. Written as a
 * parser of its own so the test can drive it with a captured dump rather than with a registry, and
 * so a line the tool prints in another Windows' words costs the record and not the run.
 */
export function parseRegistryDump(text) {
  const records = [];
  let current = null;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (/^(HKEY_|HKLM|HKCU|HKCR|HKU)/i.test(line.trim())) {
      current = { key: line.trim(), values: Object.create(null) };
      records.push(current);
      continue;
    }
    // A value line is four spaces, the name, the type and the data, each run of spaces between
    // them; the data itself may hold spaces, so only the first two runs are split on. A value that
    // is there and empty prints as the name and the type with nothing after them, and is kept as
    // the empty string: "this record has an InstallLocation" and "this record names a folder" are
    // two different things, and only the second is worth anything.
    const m = /^\s+(.+?)\s{2,}REG_[A-Z_]+(?:\s{2,}(.*))?$/.exec(line);
    if (m && current) current.values[m[1].trim()] = (m[2] ?? '').trim();
  }
  return records;
}

/**
 * The value names that carry a game's own folder. Steam's own is `SteamPath`, and it writes it with
 * forward slashes and in lower case. One list, read once: a record gives up its folder when one of
 * these holds a folder, and the uninstaller below is the fallback for a record where none does.
 */
const INSTALL_VALUES = /^(InstallLocation|InstallDir|InstallPath|InstallFolder|ProductPath|SteamPath|path)$/i;

/**
 * Every folder a set of registry records names for a game, in the order the records came.
 *
 * What decides whether a record gave up a folder is what was **accepted**, never which value names
 * it happened to carry: an `InstallLocation` that is there but empty is common in Windows' own
 * uninstall entries, and the uninstaller's own folder is the fallback written for exactly that case.
 *
 * `onUnreadable` is told about a name that came back with characters in it that could not be read
 * (see `queryRegistry`). Such a name is not tried as a folder: "that folder is not there" is the
 * wrong thing to say to somebody whose folder is there and merely spelled with a letter the tool
 * printing it could not manage.
 */
export function pathsFromRecords(records, words, onUnreadable = null) {
  const out = [];
  const add = (p) => {
    const path = String(p ?? '').trim().replace(/^"(.*)"$/, '$1').replace(/[\\/]+$/, '');
    if (!path) return false;
    if (path.includes('�')) {
      if (onUnreadable) onUnreadable(path);
      return false;
    }
    if (!/^[A-Za-z]:[\\/]/.test(path)) return false;
    if (!out.includes(path)) out.push(path);
    return true;
  };
  for (const record of records ?? []) {
    const values = record.values ?? {};
    const named = words.test(record.key ?? '') || words.test(values.DisplayName ?? '') || words.test(values.gameName ?? '') || words.test(values.ProductName ?? '');
    if (!named) continue;
    let took = false;
    for (const [name, value] of Object.entries(values)) {
      if (!INSTALL_VALUES.test(name)) continue;
      if (add(value)) took = true;
    }
    // An uninstaller's own path is the last resort: the folder it stands in is usually the install.
    if (took) continue;
    const exe = values.UninstallString ?? values.DisplayIcon ?? '';
    const m = /^"?([A-Za-z]:[\\/][^"]*)[\\/][^\\/"]+\.exe/i.exec(exe);
    if (m) add(m[1]);
  }
  return out;
}

/** The Steam library folders in `libraryfolders.vdf`, which is where a Steam game is on another disk. */
export function steamLibraries(vdfText) {
  const out = [];
  for (const m of String(vdfText ?? '').matchAll(/"path"\s+"([^"]+)"/g)) {
    const path = m[1].replace(/\\\\/g, '\\').replace(/[\\/]+$/, '');
    if (path && !out.includes(path)) out.push(path);
  }
  return out;
}

/** The folders under a Steam library that Jedi Academy is installed into. */
const STEAM_JKA = ['Jedi Academy', 'Star Wars Jedi Knight - Jedi Academy', 'STAR WARS Jedi Knight - Jedi Academy'];

/** `<name>` out of the environment, else out of the `.env` beside package.json, as cli.mjs reads it. */
export function envValue(name, { env = process.env, envText = null } = {}) {
  if (env[name]) return { value: env[name], from: 'the environment' };
  const text = envText === null ? readEnvFile() : envText;
  if (!text) return null;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*?)\\s*$`).exec(line);
    if (!m) continue;
    let value = m[1];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (value) return { value, from: '.env' };
  }
  return null;
}

function readEnvFile() {
  try {
    const file = new URL('../../.env', import.meta.url);
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
  } catch {
    return '';
  }
}

/**
 * One `reg query`, with anything that goes wrong costing the records and never the run.
 *
 * `reg.exe` writes to a pipe in the console's own OEM code page and never in UTF-8, which was
 * measured here rather than assumed: a folder name carrying an a-ring, an e-acute and an o-slash,
 * written into a key of this file's own making, came back on this machine's code page 437 as the
 * single bytes 86 and 82 for the first two -- read as UTF-8 two replacement characters, read as
 * latin1 two control characters, and either way a name that no longer names a folder. Worse, a
 * letter the OEM page has not got is gone before anything here sees it: the o-slash came back as a
 * plain `o`, which reg itself had already best-fitted.
 *
 * So the query goes through `cmd` with the console put into UTF-8 first, which was measured on the
 * same value to bring all three letters back whole. Plain `reg` stays as the fallback for a machine
 * where that does not run, and what it cannot read is then dropped by name (`pathsFromRecords`)
 * rather than passed on looking like a folder that is not there.
 */
let registryRoute = 'try-cmd';

function queryRegistry(key) {
  // The keys are this file's own constants; one carrying a quote would end cmd's own string.
  if (!/^[A-Za-z0-9_\\ .()-]+$/.test(key)) return '';
  const spawnOptions = { encoding: null, timeout: 20000, maxBuffer: 64 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] };
  const attempt = (run) => {
    try {
      const buf = run();
      return buf && buf.length ? buf : null;
    } catch {
      return null;
    }
  };
  const viaCmd = () => execFileSync(process.env.ComSpec || 'cmd.exe', [`/d /s /c "chcp 65001>nul & reg query "${key}" /s"`], { ...spawnOptions, windowsVerbatimArguments: true });
  const direct = () => execFileSync('reg', ['query', key, '/s'], spawnOptions);
  if (registryRoute !== 'reg') {
    const buf = attempt(viaCmd);
    if (buf) {
      registryRoute = 'cmd';
      return buf.toString('utf8');
    }
    // A key that is simply not there answers nothing either way, so only an answer settles the route.
    if (registryRoute === 'cmd') return '';
  }
  const buf = attempt(direct);
  if (!buf) return '';
  registryRoute = 'reg';
  return buf.toString('utf8');
}

/**
 * Where both installs are, and what was looked at to say so. Nothing is ever taken on trust: every
 * candidate, wherever it came from, is handed to the launcher's own checks, which are the one copy
 * of what a client folder and a Jedi Academy folder have to hold. A folder named on the command
 * line that does not pass is an answer and not a hint: the search stops there rather than quietly
 * converting from somewhere else the caller never asked for.
 *
 * Everything it reads of the machine is a dependency, so the test drives the whole of it without a
 * registry, a Steam install or a .env.
 */
export function findInstalls({
  swg = null,
  jka = null,
  env = process.env,
  envText = null,
  platform = process.platform,
  registry = platform === 'win32' ? queryRegistry : () => '',
  readText = (p) => {
    try {
      return readFileSync(p, 'utf8');
    } catch {
      return '';
    }
  },
  usualSwg = USUAL_SWG,
  usualJka = USUAL_JKA,
  checks = { swg: checkSwg, jka: checkJka },
} = {}) {
  const searched = [];
  let records = null;
  const windowsRecords = () => {
    if (records) return records;
    records = [];
    for (const key of REGISTRY_KEYS) records.push(...parseRegistryDump(registry(key)));
    return records;
  };

  const tryPath = (path, check, from, out) => {
    const full = resolve(path);
    const answer = check(full);
    searched.push(`${from}: ${full} -- ${answer.ok ? 'yes' : answer.sentence}`);
    if (answer.ok) {
      out.ok = true;
      out.path = full;
      out.from = from;
      out.sentence = answer.sentence;
    }
    return answer;
  };

  const find = (given, name, check, usual, extra) => {
    const out = { ok: false, path: null, from: '', sentence: '' };
    if (given) {
      // Named outright: it is this folder or nothing, so whatever the check says is the answer.
      const full = resolve(given);
      const answer = check(full);
      searched.push(`named on the command line: ${full} -- ${answer.ok ? 'yes' : answer.sentence}`);
      return answer.ok ? { ok: true, path: full, from: 'named on the command line', sentence: answer.sentence } : { ok: false, path: null, from: '', sentence: answer.sentence };
    }
    // A folder somebody wrote down by hand is the one worth complaining about by name: when the
    // search comes to nothing, what it says is what was wrong with that folder rather than the
    // general "choose a folder", which would not tell them their .env is out of date.
    let wrote = null;
    const named = envValue(name, { env, envText });
    if (named) {
      const answer = tryPath(named.value, check, `${name} in ${named.from}`, out);
      if (answer.ok) return out;
      wrote = `${name} in ${named.from}: ${answer.sentence}`;
    }
    for (const path of extra()) if (tryPath(path, check, "Windows' own record of its installed games", out).ok) return out;
    for (const path of usual) if (tryPath(path, check, 'the usual place', out).ok) return out;
    return { ok: false, path: null, from: '', sentence: wrote ?? check('').sentence };
  };

  // A folder Windows' own record names in letters that could not be read is said plainly, once:
  // the name is not tried as a folder, so without this line the search would simply never mention
  // the one record that did name the game.
  const said = new Set();
  const unreadable = (path) => {
    if (said.has(path)) return;
    said.add(path);
    searched.push(`Windows' own record of its installed games: a folder whose name could not be read (${path}) -- name it on the command line or put it in .env`);
  };

  const swgExtra = () => {
    const out = [];
    for (const path of pathsFromRecords(windowsRecords(), SWG_WORDS, unreadable)) {
      out.push(path);
      // Some launchers record the folder above the one holding the archives.
      for (const below of ['SWG', 'StarWarsGalaxies', 'game', 'client']) out.push(join(path, below));
    }
    return out;
  };
  const jkaExtra = () => {
    const out = [];
    for (const path of pathsFromRecords(windowsRecords(), JKA_WORDS, unreadable)) {
      out.push(join(path, 'GameData'));
      out.push(path);
    }
    // Steam keeps where it is in the registry and where its other libraries are in a file of its own.
    const steam = pathsFromRecords(parseRegistryDump(registry('HKCU\\SOFTWARE\\Valve\\Steam')), /valve|steam/i, unreadable);
    const libraries = [...steam];
    for (const path of steam) for (const lib of steamLibraries(readText(join(path, 'steamapps', 'libraryfolders.vdf')))) if (!libraries.includes(lib)) libraries.push(lib);
    for (const lib of libraries) for (const folder of STEAM_JKA) out.push(join(lib, 'steamapps', 'common', folder, 'GameData'));
    return out;
  };

  return { format: PLAN_FORMAT, swg: find(swg, 'SWG', checks.swg, usualSwg, swgExtra), jka: find(jka, 'JKA', checks.jka, usualJka, jkaExtra), searched };
}

// ---------------------------------------------------------------------------------------------
// The plan.

/** A command's facts, or null for one this file has never heard of. */
export function factsFor(command) {
  return STEP_FACTS[command] ?? null;
}

/**
 * The wardrobe folder a run writes, which is the converter's own rule and not a rule of ours. It is
 * copied line for line from the wardrobe case in cli.mjs:
 *
 *   basename(template).replace(/^shared_/, '').replace(/\.[^.]+$/, '').replace(/_(male|female)$/, …)
 *
 * and the last step is the one that matters: the gender is put on by **replacing** a gender the
 * template's own name carries, never by being appended. A template whose name carries neither (an
 * id with no gender in it) therefore writes one folder for both genders, and two runs of it write
 * the same folder and must never run together. Spelled the other way round -- appending the gender
 * always -- those two runs would get two different locks and be declared free to run beside each
 * other, which is the one mistake in this file that could lose a conversion's work.
 *
 * Every wardrobe run `status` asks for today names a gendered template (`WARDROBE_RUNS` in
 * mobiles.mjs), so the difference is not reachable from `status` as it stands; the rule is the
 * converter's all the same.
 */
export function wardrobeFolder(args) {
  const option = (name) => {
    const hit = (args ?? []).find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const female = (option('gender') ?? 'male').toLowerCase().startsWith('f');
  const template = (option('template') ?? 'object/creature/player/shared_human_male.iff').replace(/\\/g, '/');
  return template
    .split('/')
    .pop()
    .replace(/^shared_/, '')
    .replace(/\.[^.]+$/, '')
    .replace(/_(male|female)$/, female ? '_female' : '_male');
}

/**
 * The folders a step writes, as lock names. A step that writes every planet pack holds `pack:*`,
 * which is spread over the packs this run names once the steps are all known.
 */
export function locksFor(command, args) {
  const facts = factsFor(command);
  if (!facts) return [];
  const locks = [...(facts.locks ?? [])];
  const where = scopeOf(command, args);
  if (facts.lock === 'pack') locks.push(!where || where === 'all' ? ALL_PACKS : `pack:${where}`);
  else if (facts.lock === 'zone') locks.push(!where || where === 'all' ? ALL_ZONES : `zone:${where}`);
  else if (command === 'wardrobe') locks.push(`wardrobe:${wardrobeFolder(args)}`);
  else locks.push(facts.lock);
  // A sounds run given a planet also writes that planet's own sounds into its pack.
  if (command === 'sounds') {
    const planet = (args ?? []).slice(3).find((a) => !a.startsWith('--'));
    if (planet) locks.push(planet === 'all' ? ALL_PACKS : `pack:${planet}`);
  }
  return [...new Set(locks)];
}

/**
 * Roughly how long a step is, from its command and whether it is one planet or all of them, and how
 * much memory to hold for it. A step whose memory nobody has measured is budgeted at
 * `COST.UNMEASURED_BYTES` whatever the table says, so an entry added later with a hopeful figure and
 * no measurement beside it cannot be the one that oversubscribes the machine.
 */
export function costOf(command, args) {
  const facts = factsFor(command);
  if (!facts) return { seconds: COST.UNKNOWN_SECONDS, bytes: COST.UNKNOWN_BYTES };
  const one = facts.each && scopeOf(command, args) !== 'all';
  const bytes = facts.measured ? facts.bytes : Math.max(facts.bytes, COST.UNMEASURED_BYTES);
  return { seconds: (one ? facts.each : facts.seconds) + COST.MOUNT_SECONDS, bytes: Math.max(bytes, COST.MOUNT_BYTES) };
}

/** `@SWG` and `@JKA`, whole or after an `=`, as the folders this machine has. */
function fill(arg, swg, jka) {
  return arg.replace(/(^|=)@(SWG|JKA)$/, (whole, before, name) => before + (name === 'SWG' ? swg : jka));
}

/**
 * What `status --json` asked for, as steps a runner can start: the folders filled in, `--retail-only`
 * on anything that reads the archives, `--jka=` on the commands that are better for it, and on each
 * step what it waits for, what it holds while it runs and roughly what it costs.
 *
 * A step that cannot run on this machine (one that needs Jedi Academy when there is none) is in
 * `steps` with `skip` saying why, and in `skipped` on its own as well. It is not work that failed
 * and not work that was done, so it is reported and never started: anything that hands these steps
 * to a runner takes `runnable(plan)`, or drops the ones carrying `skip` itself, as the driver does.
 *
 * A step carrying `missing` is one `--only` has left short: the commands it reads that `status` did
 * ask for and this run is not going to do. It still runs -- that is what `--only` means -- and the
 * plan's `notes` say what it will be missing.
 */
export function convertPlan(status, { swg = '', jka = '', out = '', only = null } = {}) {
  let steps = [];
  const notes = [];
  const byKey = new Map();
  const wanted = only && only.length ? new Set(only) : null;
  for (const s of status?.steps ?? []) {
    const raw = Array.isArray(s?.args) ? s.args.filter((a) => typeof a === 'string') : [];
    if (!raw.length) continue;
    const command = raw[0];
    const args = raw.map((a) => fill(a, swg, jka));
    if (s.jka === 'takes' && jka && !args.some((a) => a.startsWith('--jka='))) args.push(`--jka=${jka}`);
    if (swg && args.includes(swg) && !args.includes('--retail-only')) args.push('--retail-only');
    const key = args.join('\u0000');
    const facts = factsFor(command);
    const step = {
      key,
      command,
      args,
      label: labelOf(args),
      reason: typeof s.reason === 'string' ? s.reason : '',
      needs: facts ? [...facts.needs] : [],
      locks: locksFor(command, args),
      alone: !facts,
      cost: costOf(command, args),
      order: facts ? facts.order : 99,
    };
    if (s.jka === 'needs' && !jka) step.skip = 'it needs a Jedi Academy folder, and none was found';
    const had = byKey.get(key);
    if (had) {
      // The same step asked for twice (two reasons for one command): one step, both reasons.
      if (step.reason && had.reason !== step.reason) had.reason = `${had.reason}; ${step.reason}`;
      continue;
    }
    byKey.set(key, step);
    steps.push(step);
    if (!facts) notes.push(`${command} is a command this plan has never heard of, so it runs on its own with nothing beside it`);
  }
  steps.sort((a, b) => a.order - b.order);
  // Two runs of one command where one does everything the other does are one run. This is done
  // before `--only` so that the run left is the wider one whichever of the two was asked for.
  steps = foldSupersets(steps, notes);
  // `--only` comes last, on the whole plan rather than on the way in, because a dependency it takes
  // out is not the same thing as a dependency `status` never asked for: the second has been done
  // already, the first is work this run is deliberately leaving undone. Both wait for nothing here,
  // as they must -- `--only=ships` is a request to run the ships -- but the first is said out loud,
  // since a ships run with the mobiles left out converts a garage with no astromechs in it at all
  // and says nothing about it (`hasModel` in shipfit.mjs drops a droid whose model is not there).
  if (wanted) {
    // Only work that would really have been done counts as dropped: a step this machine cannot run
    // has its own sentence already, and saying `--only` took it out as well would be two reasons for
    // one absence.
    const dropped = new Set();
    for (const step of steps) if (!wanted.has(step.command) && !step.skip) dropped.add(step.command);
    steps = steps.filter((step) => wanted.has(step.command));
    for (const step of steps) {
      const missing = step.needs.filter((need) => dropped.has(need));
      if (!missing.length) continue;
      step.missing = missing;
      notes.push(`--only leaves out ${missing.join(' and ')}, which status asked for and ${step.command} reads: the ${step.command} run will be missing whatever ${missing.length === 1 ? 'it writes' : 'they write'}, and status will ask for ${step.command} again`);
    }
  }
  // `cost.seconds` is also `cost.memoryMb`'s neighbour for a caller that reads megabytes.
  for (const step of steps) step.cost.memoryMb = Math.round(step.cost.bytes / 1024 ** 2);
  // Only the steps that will really run take part in the order and the locks: a step left out waits
  // for nothing and holds nothing, so nothing is ever left waiting for work that will not be done.
  const will = steps.filter((s) => !s.skip);
  // A step that writes every planet pack also holds each of the packs this run names on its own,
  // so a whole-planet run and a one-planet run of the same folder can never overlap.
  spreadLocks(will, ALL_PACKS, 'pack:');
  spreadLocks(will, ALL_ZONES, 'zone:');
  const waits = waitsFor(will);
  for (const step of steps) step.after = waits.get(step.key) ?? [];
  const cycle = cycleIn(will, waits);
  if (cycle) notes.push(`these steps wait for each other and nothing would start: ${cycle.join(', ')}`);
  for (const step of steps) if (step.skip) notes.push(`${step.label} is left out: ${step.skip}`);
  return { format: PLAN_FORMAT, out, steps, skipped: steps.filter((s) => s.skip), notes: [...new Set(notes)], seconds: totalSeconds(will, waits) };
}

/** The steps of a plan that will really be run: everything but what this machine cannot do. */
export function runnable(plan) {
  return (plan?.steps ?? []).filter((s) => !s.skip);
}

/** How much of the conversion a `sounds` run's planet argument adds: all of them, one, or none. */
function soundsReach(planet) {
  return planet === 'all' ? 2 : planet ? 1 : 0;
}

/**
 * Two runs of one command where one does everything the other does, as one run.
 *
 * `sounds` is the only such pair the converter has, and `status` asks for both of it on any first
 * conversion: the bank on its own (`sound.need` and `shipSounds.need`, cli.mjs) and the bank with
 * each planet's placed sounds after it (`places.need`). The planet argument only ever *adds* to the
 * run -- the sounds case calls `convertSounds`, `convertClipEvents` and `convertShipSounds` whatever
 * it is given and only then `if (pos[3]) convertSoundPlaces(...)` -- so the second run is a strict
 * superset of the first and the bank is otherwise converted twice for nothing. The dedup above
 * cannot see it: it keys on the arguments, and these two differ by one of them.
 *
 * Folded only when the two agree on everything else, letter for letter: the same client folder, the
 * same output folder, the same flags. A run carrying `--only=` or `--no-samples` converts part of
 * the bank and is never folded either way, and neither is a run this machine cannot do, whose `skip`
 * is a sentence about that step and not about the one that would swallow it.
 */
function foldSupersets(steps, notes) {
  const out = [];
  const bySignature = new Map();
  for (const step of steps) {
    const foldable = step.command === 'sounds' && !step.skip && !step.args.some((a) => a.startsWith('--only=') || a === '--no-samples');
    if (!foldable) {
      out.push(step);
      continue;
    }
    const positional = step.args.filter((a) => !a.startsWith('--'));
    const flags = step.args.filter((a) => a.startsWith('--')).sort();
    const planet = positional[3] ?? '';
    const signature = [...positional.slice(0, 3), '\u0002', ...flags].join('\u0000');
    const had = bySignature.get(signature);
    if (!had) {
      bySignature.set(signature, { step, planet });
      out.push(step);
      continue;
    }
    const wider = soundsReach(planet) > soundsReach(had.planet);
    const keep = wider ? step : had.step;
    const drop = wider ? had.step : step;
    if (drop.reason && keep.reason !== drop.reason) keep.reason = keep.reason ? `${keep.reason}; ${drop.reason}` : drop.reason;
    // The wider run stands where the narrower one stood, so the order stays the converter's own.
    if (wider) {
      out[out.indexOf(had.step)] = step;
      bySignature.set(signature, { step, planet });
    }
    notes.push("the sound bank is converted once: the run that writes each planet's own placed sounds converts the whole bank as well");
  }
  return out;
}

/** Gives every holder of `all` the particular locks the rest of the run names. */
function spreadLocks(steps, all, prefix) {
  const particular = new Set();
  for (const step of steps) for (const lock of step.locks) if (lock.startsWith(prefix) && lock !== all) particular.add(lock);
  for (const step of steps) if (step.locks.includes(all)) step.locks = [...new Set([...step.locks, ...particular])];
}

/** Each step's `needs` as the keys of the steps in this run; a name nothing here answers is done. */
export function waitsFor(steps) {
  const byCommand = new Map();
  for (const step of steps) {
    if (!byCommand.has(step.command)) byCommand.set(step.command, []);
    byCommand.get(step.command).push(step.key);
  }
  const out = new Map();
  for (const step of steps) {
    const keys = new Set();
    for (const need of step.needs) for (const key of byCommand.get(need) ?? []) keys.add(key);
    keys.delete(step.key);
    out.set(step.key, [...keys]);
  }
  return out;
}

/** The names of the steps in a circle of waiting, or null: a plan that would never start anything. */
function cycleIn(steps, waits) {
  const by = new Map(steps.map((s) => [s.key, s]));
  const state = new Map();
  const stack = [];
  const walk = (key) => {
    if (state.get(key) === 'done') return null;
    if (state.get(key) === 'busy') return stack.slice(stack.indexOf(key)).map((k) => by.get(k)?.command ?? k);
    state.set(key, 'busy');
    stack.push(key);
    for (const next of waits.get(key) ?? []) {
      const found = walk(next);
      if (found) return found;
    }
    stack.pop();
    state.set(key, 'done');
    return null;
  };
  for (const step of steps) {
    const found = walk(step.key);
    if (found) return found;
  }
  return null;
}

/** The longest chain of work through the plan, which is the least time the whole of it can take. */
export function totalSeconds(steps, waits = waitsFor(steps)) {
  const by = new Map(steps.map((s) => [s.key, s]));
  const longest = new Map();
  const busy = new Set();
  const walk = (key) => {
    if (longest.has(key)) return longest.get(key);
    const step = by.get(key);
    if (!step) return 0;
    if (busy.has(key)) return step.cost.seconds;
    busy.add(key);
    let most = 0;
    for (const before of waits.get(key) ?? []) most = Math.max(most, walk(before));
    busy.delete(key);
    const total = most + step.cost.seconds;
    longest.set(key, total);
    return total;
  };
  let all = 0;
  for (const step of steps) all = Math.max(all, walk(step.key));
  return all;
}

/** A length of time in words, as the runner says it: 45 s, 12m 05s, 2h 10m. */
function words(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
}

/**
 * The plan in plain lines, which is what `--dry-run` prints: every step in the order it would be
 * started, what it waits for, what it holds while it runs and what it is thought to cost.
 */
export function planLines(plan) {
  const lines = [];
  const will = runnable(plan);
  const by = new Map(plan.steps.map((s) => [s.key, s]));
  lines.push(`${will.length} step${will.length === 1 ? '' : 's'} to run into ${plan.out || 'the converted content'}; at best ${words(plan.seconds)} of work end to end.`);
  for (const note of plan.notes) lines.push(`  note: ${note}`);
  let n = 0;
  for (const step of will) {
    n++;
    lines.push(`${String(n).padStart(3)}. ${step.label} -- about ${words(step.cost.seconds)}, ${Math.round(step.cost.bytes / 1024 ** 2)} MB`);
    lines.push(`     ${step.args.join(' ')}`);
    const after = tidyWaits((step.after ?? []).map((k) => by.get(k)));
    lines.push(`     ${after.length ? `waits for ${after.join(', ')}` : 'waits for nothing'}${step.alone ? '; runs on its own' : ''}${step.locks.length ? `; holds ${tidyLocks(step.locks).join(', ')}` : ''}`);
    if (step.reason) lines.push(`     why: ${step.reason}`);
  }
  for (const step of plan.skipped) lines.push(`     left out: ${step.label} -- ${step.skip}`);
  return lines;
}

/** What a step waits for, with four runs of one command said once rather than four times. */
function tidyWaits(steps) {
  const counts = new Map();
  for (const step of steps) {
    if (!step) continue;
    const had = counts.get(step.command);
    counts.set(step.command, { n: (had?.n ?? 0) + 1, label: had?.label ?? step.label });
  }
  return [...counts.values()].map(({ n, label }) => (n > 1 ? `${n} runs of ${label.replace(/\s*\(.*\)$/, '')}` : label));
}

/** The locks a step holds, with a spread `pack:*` shown as the one name rather than as eighteen. */
function tidyLocks(locks) {
  if (locks.includes(ALL_PACKS)) locks = locks.filter((l) => !l.startsWith('pack:') || l === ALL_PACKS);
  if (locks.includes(ALL_ZONES)) locks = locks.filter((l) => !l.startsWith('zone:') || l === ALL_ZONES);
  return locks;
}
