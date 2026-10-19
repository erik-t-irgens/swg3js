// The world states a server keeps: one world standing as one thing or another for everybody on the server --
// Restuss as the living launch city or as its ruins -- so every browser connected stands one Restuss.
//
// Each is a word of the admin's (`worldStateSet { key, value }`, refused unless the line is the admin's and the
// value is one its key allows), kept in `world.json` and the log as a record of its own (`worldState`), handed to
// every browser in the hail (`states`) and sent to everybody connected as `worldStates` when it changes. A browser
// takes it at its next arrival on that world (src/world/worldState.ts) and never in the middle of one. A browser
// built before this reads neither the hail's field nor the word and keeps its own setting, which is what every
// browser does against a server from before.
//
// The keys and their values are the browser's own table (`WORLD_STATES` in src/world/worldState.ts), held equal to
// this one by `worldStateRelay.test.ts`: the server may import nothing of `src/world/`. Pure and dependency-free.

/** Every world state a server keeps: its values and the one a world stands in until the admin says another. */
export const WORLD_STATES = {
  // Ruins by default, as every browser's own setting is [owner, 2026-10-19, the pass's design §10 Q1].
  restuss: { values: ['living', 'ruins'], default: 'ruins' },
};

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** Whether a key is one this server keeps and a value one it allows. */
export function allowedState(key, value) {
  return typeof key === 'string' && has(WORLD_STATES, key) && typeof value === 'string' && WORLD_STATES[key].values.includes(value);
}

/**
 * A cleaned copy of an admin's `worldStateSet` word, or why it is not one: `{ key, value }` with a key this server
 * keeps and a value that key allows. Who may say it is the relay's to ask; this only reads it.
 */
export function cleanWorldStateSet(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return { why: 'that word could not be read' };
  const key = typeof msg.key === 'string' ? msg.key.slice(0, 40) : '';
  if (!has(WORLD_STATES, key)) return { why: `there is no world state called ${key || 'that'} on this server` };
  const value = typeof msg.value === 'string' ? msg.value.slice(0, 40) : '';
  if (!WORLD_STATES[key].values.includes(value)) return { why: `${key} is ${WORLD_STATES[key].values.join(' or ')}, not ${value || 'nothing'}` };
  return { key, value };
}

/**
 * Apply one record to the world in memory, for the store (`applyChange`): a `worldState` record sets one key, the
 * same function running when the change is made and when the log is played back. Anything else is not this
 * module's, and a record naming a key or a value this server does not keep is refused rather than written in.
 */
export function applyWorldStates(data, rec) {
  if (!rec || rec.t !== 'worldState') return false;
  if (!allowedState(rec.key, rec.value)) return false;
  if (!data.worldStates || typeof data.worldStates !== 'object') data.worldStates = Object.create(null);
  data.worldStates[rec.key] = rec.value;
  return true;
}

export class WorldStates {
  /** @param {{ write?: (rec: object) => void }} options `write` puts a record through the store. */
  constructor({ write = () => {} } = {}) {
    this.write = write;
    /** What the store holds, read at `load` and kept as the admin changes it. */
    this.kept = Object.create(null);
  }

  /** Read what the world file and its log left, keeping only keys and values this server keeps. */
  load(data) {
    this.kept = Object.create(null);
    const was = data?.worldStates;
    if (!was || typeof was !== 'object') return;
    for (const key of Object.keys(WORLD_STATES)) if (allowedState(key, was[key])) this.kept[key] = was[key];
  }

  /** Every state this server keeps, each the admin's last word or its default: what the hail and the word carry. */
  hail() {
    const out = {};
    for (const key of Object.keys(WORLD_STATES)) out[key] = has(this.kept, key) ? this.kept[key] : WORLD_STATES[key].default;
    return out;
  }

  /**
   * The admin's word: `{ ok: true, states, changed }` where it was taken (`changed` false for a value it already had,
   * which is answered all the same and written nowhere), or `{ ok: false, why }`. Who may say it is the relay's.
   */
  set(msg) {
    const want = cleanWorldStateSet(msg);
    if (want.why) return { ok: false, why: want.why };
    const changed = this.hail()[want.key] !== want.value;
    if (changed) {
      this.kept[want.key] = want.value;
      this.write({ t: 'worldState', key: want.key, value: want.value });
    }
    return { ok: true, states: this.hail(), changed };
  }
}
