// Pictures the owner adds from the page: their kinds, their names made plain, what a file really is by
// its first bytes, and the record of each kept in the file of choices (`pictures: { <name>: { kind,
// added } }`). Pure: no page, no renderer, so node can test it as it stands.

// The viewer's own kinds, in the order the texture lists show them, each with the words the "Add a
// picture" window uses. The keys are the survey's kinds (textures.json), so an added picture is drawn
// exactly as a surveyed picture of that kind: wrapped or clamped, colour or data.
export const PICTURE_KINDS = [
  ['sprite-baked', 'a circle picture with the light painted in (a planet seen from space)'],
  ['colour-unlit', 'a sphere map: the whole surface laid flat, no light painted in (often twice as wide as tall)'],
  ['surface-tile', 'a surface tile that repeats'],
  ['clouds', 'clouds'],
  ['atmosphere', 'atmosphere: a glow, halo or rim picture'],
  ['normal', 'a normal map (the bumps, in blue-purple)'],
  ['mask', 'a mask: water or shine'],
  ['illumination', 'night lights or glowing parts'],
  ['flow', 'a flow map (moves clouds)'],
  ['rings', 'rings'],
  ['asteroids', 'asteroid belts'],
  ['moons-sheet', 'a night-sky sheet of moons'],
  ['fog-ramp', 'a colour or fog ramp'],
  // (the GPU port's pass 2, wave 4: Save to game) a still kept to measure against, never shipped whatever its mark
  ['still', 'a still from a film or a game, for reference only (never shipped with the game)'],
  ['other', 'something else'],
];
export const KIND_ORDER = PICTURE_KINDS.map(([k]) => k);
const KINDS = new Set(KIND_ORDER);
export const isKind = (k) => KINDS.has(k);

// The rule the server holds a new name to (serve.mjs): letters, digits, spaces, _ and -, starting and
// ending with a letter or digit, at most 100, then the extension; never a device name of Windows.
const BASE = /^[A-Za-z0-9](?:[A-Za-z0-9 _-]{0,98}[A-Za-z0-9])?$/;
const DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
export const MAX_PICTURE_BYTES = 64 * 1024 * 1024;
export const PICTURE_EXT = /\.(png|jpe?g)$/i;

/** Why a base name (without its extension) would be refused, or '' when it is fine. */
export function nameProblem(base) {
  if (!base) return 'Give it a name.';
  if (base.length > 100) return 'At most 100 letters.';
  if (!BASE.test(base)) return 'Letters, digits, spaces, _ and - only, starting and ending with a letter or digit.';
  if (DEVICE.test(base)) return `"${base}" is a name Windows keeps for itself: choose another.`;
  return '';
}

/** A file's name made plain: its extension dropped, accents taken off, anything else a space, tidied. */
export function plainName(fileName) {
  let s = String(fileName || '').replace(/\.[^.]*$/, '');
  s = s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/[^A-Za-z0-9 _-]+/g, ' ').replace(/\s+/g, ' ');
  s = s.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
  if (s.length > 100) s = s.slice(0, 100).replace(/[^A-Za-z0-9]+$/g, '');
  if (!s || DEVICE.test(s)) s = s ? s + ' picture' : 'picture';
  return s;
}

/** What the first bytes say a file is: 'png', 'jpeg', or null (the server checks the same way). */
export function sniffPicture(bytes) {
  const b = bytes;
  if (b.length >= 16 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
    && b[12] === 0x49 && b[13] === 0x48 && b[14] === 0x44 && b[15] === 0x52) return 'png';
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  return null;
}
export const extFor = (type) => (type === 'png' ? '.png' : '.jpg');
export const mimeFor = (type) => (type === 'png' ? 'image/png' : 'image/jpeg');

/** A first guess at a picture's kind, from words in its name, then its shape. The owner can change it. */
// a whole word of a name, where _ - . and spaces part words ("T_Rings_C" has "rings"; "Yavin Prime" has no "rim")
const word = (w) => new RegExp(`(^|[^a-z])(${w})([^a-z]|$)`);

export function guessKind(fileName, width, height) {
  const n = String(fileName || '').toLowerCase().replace(/\.[^.]*$/, '');
  if (/cloud/.test(n)) return 'clouds';
  if (/normal/.test(n) || word('n|nm|nrm').test(n)) return 'normal';
  if (/atmo|halo|glow/.test(n) || word('rim').test(n)) return 'atmosphere';
  if (word('rings?').test(n)) return 'rings';
  if (/asteroid/.test(n) || word('belts?').test(n)) return 'asteroids';
  if (/night|lights|illum|emissive/.test(n)) return 'illumination';
  if (word('flow').test(n)) return 'flow';
  if (/mask/.test(n) || word('spec|specular|water').test(n)) return 'mask';
  if (width > 0 && height > 0) {
    const r = width / height;
    if (Math.abs(r - 2) < 0.08) return 'colour-unlit';
    if (Math.abs(r - 1) < 0.02) return 'sprite-baked';
  }
  return 'other';
}

/**
 * The added pictures' records as the file of choices keeps them: a known kind and when it was added, and (the GPU port's
 * pass 2, wave 4) `ship: true` where the owner marked it "ship with the game" (Save to game copies it beside the game's
 * bodies file); unmarked, "only on my machine", the default and written as nothing, so a file without marks is as it was.
 * A still is never marked.
 */
export function cleanPictures(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [name, v] of Object.entries(raw)) {
    if (!PICTURE_EXT.test(name) || !v || typeof v !== 'object' || Array.isArray(v) || !isKind(v.kind)) continue;
    out[name] = { kind: v.kind, added: typeof v.added === 'string' ? v.added : '' };
    if (v.ship === true && shippable(v.kind)) out[name].ship = true;
  }
  return out;
}

/** (wave 4) Whether a picture of this kind may be marked to ship with the game: anything but a still. */
export const shippable = (kind) => isKind(kind) && kind !== 'still';

/** "1.4 MB", "820 KB". */
export function sizeWords(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return Math.max(1, Math.round(bytes / 1024)) + ' KB';
}
