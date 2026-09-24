// The captured backdrops themselves. Sixty-seven records typed in by hand out of a chat window is
// exactly the shape of data that rots without anybody noticing: a digit dropped in a coordinate
// makes a scene that still loads and simply looks at nothing.
//
// So this does not merely check the fields are there. It checks the **composition** is still a
// composition: the camera at a sane distance behind the figure, pointed the way the figure is
// facing, framed on the figure rather than off into the sky. Every one of the seventeen the owner
// captured holds that today, so anything that stops holding it is a typo and not a style.
import assert from 'node:assert/strict';
import { readSceneLine, sceneLine } from '../../../src/world/sceneCapture.ts';
import { SCENE_SHOTS, sceneSpots } from '../../../src/data/scenes.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

const DEG = 180 / Math.PI;
/** The game's own facing for a heading in degrees: 0 faces -Z and rises anticlockwise. */
function facing(headingDeg: number): { x: number; z: number } {
  const t = (headingDeg / DEG) * 1;
  return { x: -Math.sin(t), z: -Math.cos(t) };
}

{
  ok(SCENE_SHOTS.length === 67, `every capture the owner sent is here (${SCENE_SHOTS.length})`);
  const names = new Set(SCENE_SHOTS.map((s) => s.name));
  ok(names.size === SCENE_SHOTS.length, 'and no two share a name, which is what a bake keys a file on');
  const packs = new Set(SCENE_SHOTS.map((s) => s.pack));
  ok(packs.size === 12, `across twelve worlds (${[...packs].sort().join(', ')})`);
  ok(SCENE_SHOTS.every((s) => !s.space), 'none of them is a space scene, which is the one kind the owner could not compose');
}

{
  // The shape, through the very reader the capture writes for. A record that would be refused on
  // its way back in from a pasted line has no business being in the file either.
  const bad = SCENE_SHOTS.filter((s) => readSceneLine(sceneLine(s)) === null);
  ok(bad.length === 0, `every record reads back through the capture's own reader (${bad.map((b) => b.name).join(', ') || 'none refused'})`);
  const round = SCENE_SHOTS.filter((s) => JSON.stringify(readSceneLine(sceneLine(s))) !== JSON.stringify(s));
  ok(round.length === 0, 'and comes back field for field, so nothing here has a field the reader would quietly drop');
}

{
  // The hours. Not pinned to daylight -- that would be pinning the owner's taste -- but a number
  // outside the clock is a typo and there is no other way for one to get in.
  const off = SCENE_SHOTS.filter((s) => !(s.hour >= 0 && s.hour < 24));
  ok(off.length === 0, 'every hour is on the clock');
  const hours = SCENE_SHOTS.map((s) => s.hour);
  ok(Math.min(...hours) >= 6 && Math.max(...hours) <= 23, `and all of them are in the light (${Math.min(...hours)} to ${Math.max(...hours)}), which is the whole point of choosing them by eye`);
  const turns = SCENE_SHOTS.filter((s) => !(s.stand.heading >= 0 && s.stand.heading < 360));
  ok(turns.length === 0, 'and every heading is inside one turn');
}

{
  // The composition, which is the real check. A camera that has drifted off the figure, or ended
  // up in front of it, is a scene that looks wrong and still loads.
  const far: string[] = [];
  const wrongWay: string[] = [];
  const offFigure: string[] = [];
  for (const s of SCENE_SHOTS) {
    const c = s.camera;
    const d = Math.hypot(s.stand.x - c.x, s.stand.y - c.y, s.stand.z - c.z);
    if (!(d > 1 && d < 12)) far.push(`${s.name} ${d.toFixed(2)} m`);

    // The figure faces away from the camera: over the shoulder, which is how every one was taken.
    const f = facing(s.stand.heading);
    const toFigure = { x: s.stand.x - c.x, z: s.stand.z - c.z };
    if (f.x * toFigure.x + f.z * toFigure.z <= 0) wrongWay.push(s.name);

    // And the camera is really pointed at the figure, measured flat: the shot is framed at head
    // height rather than at the feet, so the up-and-down angle is a composition choice and only
    // the bearing says whether the camera is aimed at the person at all.
    const look = Math.atan2(c.look.x - c.x, c.look.z - c.z) * DEG;
    const at = Math.atan2(toFigure.x, toFigure.z) * DEG;
    const gap = Math.abs(((look - at + 540) % 360) - 180);
    if (!(gap < 6)) offFigure.push(`${s.name} ${gap.toFixed(1)} deg`);
  }
  ok(far.length === 0, `the camera stands a person's distance from the figure in every one (${far.join('; ') || 'all between 1 and 12 m'})`);
  ok(wrongWay.length === 0, `and behind it, with the figure facing away (${wrongWay.join(', ') || 'all over the shoulder'})`);
  ok(offFigure.length === 0, `and pointed at it within a few degrees flat (${offFigure.join('; ') || 'all within 6'})`);
}

{
  // The grouping, which is what makes the owner's time-of-day switcher cheap: one bake per
  // composition, the hour a parameter on it.
  const spots = sceneSpots();
  ok(spots.length === 17, `the captures gather into seventeen compositions (${spots.length})`);
  ok(spots.reduce((n, s) => n + s.hours.length, 0) === SCENE_SHOTS.length, 'losing none of them on the way');
  const keys = new Set(spots.map((s) => s.key));
  ok(keys.size === spots.length, 'every composition has a key of its own, counted up where two places wanted the same word');
  const many = spots.filter((s) => s.hours.length > 1);
  ok(many.length === 12, `and twelve of them hold more than one hour (${many.length}), which is the geometry a bake does once and re-lights`);
  ok(spots.filter((s) => s.hours.length === 1).length === 5, 'while five were captured at a single hour, which on four of those worlds is the only hour that looked right');
  const dupHours = spots.filter((s) => new Set(s.hours.map((h) => h.hour)).size !== s.hours.length);
  ok(dupHours.length === 0, 'with no composition captured twice at the same hour');

  // The ship, which only one composition has: the owner parked one for the selection screen there
  // and nowhere else, so anything that needs one must cope with almost every scene having none.
  const withShip = spots.filter((s) => s.ship);
  ok(withShip.length === 1 && withShip[0].pack === 'naboo', `exactly one composition has a ship parked in it (${withShip.map((s) => s.key).join(', ')})`);

  // A place named by the world, where the world knew one. Not every spot has one and that is fine;
  // what would not be fine is a name that came back empty rather than absent.
  const emptyPlace = spots.filter((s) => s.place !== null && !s.place.trim());
  ok(emptyPlace.length === 0, "and a spot the world could not name says null rather than an empty name");
}

console.log(`\n${passed} checks passed`);
