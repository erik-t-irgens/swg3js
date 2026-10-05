// What a customization colour is called on the appearance page.
//
// The label used to be the variable's own name with its prefix stripped, so the head's eyes read
// "Color 2": the game numbers most of its colour variables and keeps the meaning in the palette the
// shader reads them from (`palette/pc_eye_hum.pal` for the eyes, measured on the human head's
// `index_color_2`). So a palette variable is named, in the game's own words, by what it says itself
// where it says anything (`index_color_skin`, `index_color_facial_hair`), else by its palette's
// family (an eye palette is "Eye Color", a hair palette "Hair Color"), else -- a garment's general
// cloth or leather palette, which says nothing about which part of the garment it colours -- by the
// texture it tints: MAIN is the main colour and HUEB the second, which is how the client's own
// two-colour shaders lay them out.
//
// This is the fallback the fix round asked for, made with what the customizer already carries and no
// conversion. The game's own table (`customization_data.iff`, with `ui_cust.stf`'s words) says the
// same for the bodies and also says which variables it never offered, and belongs to the Creator and
// dye pass.
//
// Pure, so a node test can read the real packs through it.

/** What a palette variable carries that its label is made from. */
export interface LabelInput {
  /** The variable's name, with or without its `/private/` path. */
  name: string;
  /** The palette it is read from, as a recipe names it (`palette/pc_eye_hum.pal`), where known. */
  palette?: string;
  /** The texture slot it tints (`MAIN`, `HUEB`), where known. */
  tag?: string;
}

/** The words a variable's own name says, where it says any, keyed on what follows `index_color_`. */
const NAMED: Record<string, string> = {
  skin: 'Skin Color',
  hair: 'Hair Color',
  eye: 'Eye Color',
  eyes: 'Eye Color',
  facial_hair: 'Facial Hair Color',
  eyebrow: 'Eyebrow Color',
  lips: 'Lip Color',
  eyeshadow: 'Eye Shadow Color',
  tattoo: 'Tattoo Color',
  tat: 'Tattoo Color',
  pattern: 'Pattern Color',
  patterns: 'Pattern Color',
  // Ours: the dye a piece the game gave no colour takes (tools/swg/dye.mjs, `/private/index_color_dye`).
  dye: 'Dye',
};

/** A palette's own file name, without its folder or `.pal`. */
export function paletteStem(palette: string | undefined): string {
  return (palette ?? '').replace(/^.*\//, '').replace(/\.pal$/i, '').toLowerCase();
}

/**
 * What a palette's family is called, or null for a palette that says nothing about what it colours
 * (a garment's cloth, leather or metal, a uniform's colours).
 */
export function paletteFamily(palette: string | undefined): string | null {
  const p = paletteStem(palette);
  if (!p) return null;
  if (/(^|_)eyes?(_|$)/.test(p)) return 'Eye Color';
  if (/(^|_)lips(_|$)/.test(p)) return 'Lip Color';
  if (/(^|_)tat(_|$)/.test(p)) return 'Tattoo Color';
  if (/(^|_)horns?(_|$)/.test(p)) return 'Horn Color';
  if (/_tips$/.test(p)) return 'Tip Color';
  if (/_spots?$/.test(p)) return 'Spot Color';
  if (/(^|_)hair(_|$)/.test(p)) return 'Hair Color';
  // The Wookiee's skin palette colours fur, and the game calls it that.
  if (/^pc_skin_wke/.test(p)) return 'Fur Color';
  if (/(^|_)skin(_|$)/.test(p)) return 'Skin Color';
  return null;
}

/** What a texture slot's tint is called, for a palette that says nothing about what it colours. */
export function tagLabel(tag: string | undefined): string | null {
  const t = (tag ?? '').replace(/^bp:/, '').toUpperCase();
  if (t === 'MAIN') return 'Main Color';
  if (t === 'HUEB') return 'Second Color';
  return null;
}

/** "index_color_2" reads as "Color 2", "blend_jaw" as "Jaw": what every label was before this. */
export function plainLabel(name: string): string {
  const short = name.replace(/^.*\//, '');
  const s = short.replace(/^(blend|index|private)_/, '').replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * A palette variable's label: its own words, its palette's family, the slot it tints, or -- for a
 * variable with none of those -- its name tidied, as before.
 */
export function variableLabel(v: LabelInput): string {
  const short = v.name.replace(/^.*\//, '');
  const own = /^index_color_(.+)$/.exec(short)?.[1] ?? '';
  // A word of its own, not a number (`index_color_skin_1` is still the skin).
  const word = own.replace(/_\d+$/, '');
  if (word && !/^\d+$/.test(word) && NAMED[word]) return NAMED[word];
  return paletteFamily(v.palette) ?? tagLabel(v.tag) ?? plainLabel(short);
}

/**
 * Labels for a list of rows that are shown together (one section of the page), with a second of the
 * same name numbered rather than shown twice: a Wookiee's two fur colours are "Fur Color" and
 * "Fur Color 2", in the order the rows came.
 */
export function distinctLabels(rows: readonly LabelInput[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = variableLabel(r);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} ${n}`;
  });
}
