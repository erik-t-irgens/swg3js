// The old tutorial's people and things, stood in the rooms of its hall.
//
// The server built the hall for each new player in code and stood the tutorial's people in its rooms by name
// (Core3's `screenplays/tutorial/tutorial.lua`, read into the reference by `readTutorial`): every place is in the hall's
// own frame, beside the name of the room it stands in. This game stands the hall as a permanent placement row of ours
// (`public/placements/world/tutorial.json`), so a place here is carried out of the hall's frame through that row's
// place and turn (`TUTORIAL_HALL`, which a node test holds to the row), and the room's name is turned into the hall
// model's own room number through the gallery's manifest, which is where the hall's model comes from.
//
// The people go into the tutorial pack's `spawns.json` as rows of the standing people's own shape (`packRow`, through a
// room per name: `tutorialRooms`); the things into its `fittings.json` as building children (`childInWorld`'s shape).
// Node 22, no dependencies.

import { createHash } from 'node:crypto';

/**
 * Where this game stands the old tutorial's hall: the template, the model and the place and turn of the permanent row
 * `tutorial_newbie_hall` in `public/placements/world/tutorial.json`, in the raw frame (a row's own). Ours; the node test
 * reads the row and fails if the two part, since a hall moved in the editor would leave its people where it stood.
 */
export const TUTORIAL_HALL = { template: 'object/building/general/shared_newbie_hall.iff', model: 'thm_newbie_hall', x: 0, y: 3.5, z: 0, yaw: 0 };

/** The hall model's rooms by name (`r1` to `r14`), from its manifest entry's cells. */
export function hallRoomIndex(cells) {
  const out = new Map();
  for (const c of cells ?? []) if (c && c.index > 0 && typeof c.name === 'string') out.set(c.name.trim().toLowerCase(), c.index);
  return out;
}

/** The hall's turn as the standing people's rooms carry one (`intoRoom`'s `q`, w, x, y, z): a yaw about the upright. */
function hallQuat(yaw) {
  return [Math.cos(yaw / 2), 0, Math.sin(yaw / 2), 0];
}

/**
 * The tutorial's people as raw rows for `packRow`, and the rooms they stand in: a room per room of the hall, keyed by
 * the room's own number (a row's `cell`, which only has to be truthy and match), whose place and turn are the hall's.
 * A person in a room the hall has no number for is counted (`noRoom`) rather than stood somewhere wrong.
 */
export function tutorialCrew(tutorial, cells, hall = TUTORIAL_HALL) {
  const index = hallRoomIndex(cells);
  const rooms = new Map();
  const rows = [];
  let noRoom = 0;
  for (const [n, m] of (tutorial?.mobiles ?? []).entries()) {
    const cell = index.get(String(m.room).toLowerCase()) ?? 0;
    if (!cell) {
      noRoom++;
      continue;
    }
    if (!rooms.has(cell)) rooms.set(cell, { cellIndex: cell, q: hallQuat(hall.yaw), pos: [hall.x, hall.y, hall.z] });
    const key = createHash('sha1').update(`tutorial|${m.room}|${m.name}|${m.x}|${m.y}|${m.z}|${n}`).digest('hex').slice(0, 12);
    rows.push({ key, who: m.name, x: m.x, y: m.y, z: m.z, heading: m.heading, cell, respawn: m.respawn, gated: false, where: 'tutorial', from: 'call' });
  }
  return { rows, rooms, noRoom };
}

/**
 * The tutorial's things as fitting rows: building children of the hall in the room each names, in the hall's own frame
 * (`childInWorld` carries them over), each with the model its template is drawn with (`modelOf`, null for none, which is
 * counted). The hall's place is the raw frame's, as a snapshot building's is.
 */
export function tutorialFittingRows(tutorial, cells, modelOf, hall = TUTORIAL_HALL) {
  const index = hallRoomIndex(cells);
  const rows = [];
  let lost = 0;
  for (const o of tutorial?.objects ?? []) {
    const cell = index.get(String(o.room).toLowerCase()) ?? 0;
    const model = modelOf(o.template);
    if (!cell || !model) {
      lost++;
      continue;
    }
    rows.push({ template: o.template, model, building: hall.template, at: null, cell, x: o.x, y: o.y, z: o.z, yaw: o.yaw, bx: hall.x, by: hall.y, bz: hall.z, byaw: hall.yaw });
  }
  return { rows, lost };
}
