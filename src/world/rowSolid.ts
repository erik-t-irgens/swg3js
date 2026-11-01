// Whether a permanent placement row stands solid (Map-maker II's fifth wave moved the rule here, word for word, out of
// `permanent.ts`, `ambient/fillers.ts` and `seatProps.ts`): the game stands its colliders by it and the walk grid's bake
// (`tools/swg/navgrid.mjs`) rasterises a world's solid rows by it, so the grid and the world agree on what a body walks
// round. A seat and a table are told by their template's name, as the seats of ours always were.
//
// Pure, and imports nothing: the release's own source list carries it (`tools/launcher/pack.mjs`, `SOURCE_FILES`), since
// the shipped bake names it. Rule for this file (node runs it with type stripping): no enum, no namespace, no constructor
// parameter properties.

/** Whether a template is something a body sits on: a chair, a stool, a couch, a sofa, a bench, a seat (and not a table, a lamp or a pilot's). */
export function isSeat(template: string): boolean {
  const name = template.slice(template.lastIndexOf('/') + 1).toLowerCase();
  return /chair|stool|couch|sofa|bench|seat/.test(name) && !/table|lamp|pilot/.test(name);
}

/** Whether a template is a table (and not a lamp, a hologram or a terminal standing on one). */
export function isTableTemplate(template: string): boolean {
  const name = template.slice(template.lastIndexOf('/') + 1).toLowerCase();
  return /table|tbl/.test(name) && !/lamp|holo|terminal/.test(name);
}

/**
 * Whether a row stands solid: its own word where it says one, else solid -- except a props row whose thing is a
 * seat or a table (`furniture`, asked of the thing's template), which is passable (`dressingStandOf`'s rule, and
 * the one the editor's Solid shows and turns, so the two can never disagree).
 */
export function standsSolid(row: { solid?: boolean; pack: string }, furniture: boolean): boolean {
  return row.solid ?? (row.pack === 'props' ? !furniture : true);
}
