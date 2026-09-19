// Which star lights a space zone, checked without a browser: the direction convention the sky's
// sprites and the lights share, how the star sprites gather into stars, that our brightness rule
// agrees with the lens flare's own ranking (so the light and the flare can never disagree), that a
// close pair folds into a companion while a distant one does not, that the ground sky a space
// zone's environment file carries is never built, and that a planet's depth stand-in keeps the
// same disc on the sky while writing, everywhere on the screen, a depth behind the planet itself
// and in front of the distance the god rays call open sky.
//
// Every list here is made up. The last section reads the owner's converted zones when they are
// there and prints only a pass or a fail: no value out of a pack is written down anywhere.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { rankStarGroups, type StarSpriteLike } from '../../../src/core/fx/flareMath.ts';
import {
  COMPANION_DEGREES,
  SPACE_SKY_TUNE,
  degreesApart,
  environmentBodies,
  pickSuns,
  skyDistanceFor,
  spaceBodyStandIn,
  standInViewDepth,
  starGroups,
  starQuadTurn,
  sunDirection,
  tuneSpaceSky,
  type SunStarSprite,
} from '../../../src/space/suns.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

const star = (shader: string, size: number, yaw: number, pitch: number): SunStarSprite => ({ shader: `shader/${shader}.sht`, size, yaw, pitch, hasImage: true });
/** The same sprite as the lens flare's own ranking takes it, so the two can be compared on one list. */
const asFlare = (s: SunStarSprite): StarSpriteLike => ({ shader: s.shader, size: s.size, yaw: s.yaw, pitch: s.pitch, image: s.hasImage ? {} : null });

// --- 1. the direction convention ---

{
  const ahead = sunDirection(0, 0);
  ok(near(ahead.x, 0, 1e-9) && near(ahead.y, 0, 1e-9) && near(ahead.z, -1, 1e-9), 'yaw 0, pitch 0 looks down -Z, as the sky places its sprites');
  const right = sunDirection(90, 0);
  ok(near(right.x, 1, 1e-9) && near(right.z, 0, 1e-9), 'yaw 90 turns towards +X');
  const up = sunDirection(0, 90);
  ok(near(up.y, 1, 1e-9), 'pitch 90 points straight up');
  const d = sunDirection(37, -12);
  ok(near(Math.hypot(d.x, d.y, d.z), 1, 1e-9), 'every direction is unit length');
  ok(near(degreesApart(0, 0, 0, 30), 30, 1e-6) && near(degreesApart(10, 0, 20, 0), 10, 1e-6), 'the angle between two places is read in degrees');
  ok(near(degreesApart(-1, -1, 1, -1), 2, 0.01), 'a pair two degrees apart in yaw measures two degrees apart');
}

// --- 2. gathering sprites into stars ---

{
  const sprites = [
    star('cels_star_back', 0.75, -1, -1),
    star('starglow_radial', 0.5, -1, -1),
    star('cels_star_back', 0.4, 1, -1),
    star('starglow_radial', 0.05, 1, -1),
    { ...star('starglow', 0.9, 40, 40), hasImage: false },
    star('cels_star_back', 0.3, -30, 20),
  ];
  const groups = starGroups(sprites);
  ok(groups.length === 3, 'sprites sharing a yaw and a pitch are one star, and one with no picture is not a star at all');
  ok(groups[0].yaw === -1 && near(groups[0].score, 0.5 + 0.25 * 0.75, 1e-9), 'a star scores its glow plus a quarter of its disc, brightest first');
  ok(groups.some((g) => g.yaw === -30 && g.glowSize === 0 && g.discSize === 0.3), 'a bare disc with no glow is still a star');
  const shuffled = starGroups([...sprites].reverse());
  ok(shuffled.map((g) => `${g.yaw}|${g.pitch}`).join() === groups.map((g) => `${g.yaw}|${g.pitch}`).join(), 'the order never depends on the order the file lists them in');
}

// --- 3. the sun, and the two rules ---

const lights = [{ yaw: -135, pitch: -45 }, { yaw: -18, pitch: 3 }];

{
  // A zone where the brightest glow and the largest disc are different stars (Naboo's shape).
  const sprites = [
    star('cels_star_back', 0.6, -40, 34),
    star('starglow', 0.5, -40, 34),
    star('cels_star_back', 1, -70, -35),
    star('starglow_radial', 0.25, -70, -35),
  ];
  const glow = pickSuns(sprites, lights, 'glow');
  const disc = pickSuns(sprites, lights, 'disc');
  ok(glow.sun?.yaw === -40 && glow.chosenBy === 'glow', 'the brightness rule lights the zone from the star that reads brightest');
  ok(disc.sun?.yaw === -70 && disc.chosenBy === 'disc', 'the disc rule lights it from the largest disc instead');
  ok(glow.companion === null && disc.companion === null, 'stars tens of degrees apart keep no company');
  const top = rankStarGroups(sprites.map(asFlare));
  ok(top[0].yaw === glow.sun?.yaw && top[0].pitch === glow.sun?.pitch, 'the brightness rule picks exactly the star the lens flare ranks first, so the light and the flare agree');
  ok(near(top[0].weight, glow.sun!.weight, 1e-9), 'and it carries the flare its own amplitude for that star');
  ok(glow.lightOffDegrees !== null && glow.lightOffDegrees > 10, "the zone's own first light points nowhere near the star chosen, which is why it is not used");
  // Under the disc rule the sun is not the brightest star in the sky, so the star beside it must
  // not be handed more amplitude than a sun's own: the flare reads these straight through.
  ok(disc.second?.yaw === -40, 'the disc rule leaves the brighter star to flare in the second slot');
  ok(disc.second!.weight <= 1 && disc.sun!.weight <= 1, 'and no star flares above a full amplitude, however the two are ranked');
}

{
  // A big bare disc with no glow beside a small blazing one: the flare draws a star from its glow,
  // so a sun it could not follow would leave the orbit lit and with nothing flaring in it.
  const sprites = [star('cels_star_back', 1, 20, 10), star('starglow', 0.3, -60, -20), star('cels_star_back', 0.2, -60, -20)];
  for (const rule of ['glow', 'disc'] as const) {
    const p = pickSuns(sprites, lights, rule);
    ok(p.sun?.yaw === -60 && p.sun.glowSize > 0, `the ${rule} rule lights the zone from a star the flare can draw, never from a bare disc`);
  }
  const bare = pickSuns([star('cels_star_back', 1, 20, 10), star('cels_star_back', 0.2, -60, -20)], lights, 'disc');
  ok(bare.sun?.yaw === 20, 'a zone of nothing but bare discs is still lit by the largest of them');
}

{
  // A close pair (two degrees, as one zone has) and a wide one.
  const pair = [star('cels_star_back', 0.75, -1, -1), star('starglow_radial', 0.5, -1, -1), star('cels_star_back', 0.4, 1, -1), star('starglow_radial', 0.05, 1, -1)];
  const p = pickSuns(pair, lights);
  ok(p.sun?.yaw === -1 && p.companion?.yaw === 1, 'a second star two degrees away is the sun\'s companion');
  ok(p.companion!.weight < p.sun!.weight && p.companion!.weight > 0, 'the companion flares in proportion to how bright it is beside the sun');
  ok(p.second === null, 'and it takes the second flare slot, so nothing else does');

  const five = [star('starglow', 0.75, -50, -5), star('starglow_radial', 0.5, -50, -5), star('cels_star_back', 0.3, -50, -10), star('starglow', 0.1, -50, -10)];
  ok(pickSuns(five, lights).companion?.pitch === -10, 'a pair five degrees apart is still a pair');

  const wide = [star('starglow', 0.75, -50, -5), star('starglow', 0.7, -50, -13)];
  const w = pickSuns(wide, lights);
  ok(degreesApart(-50, -5, -50, -13) > COMPANION_DEGREES && w.companion === null, 'eight degrees is too far apart to be one sun');
  ok(w.second?.pitch === -13, 'but a star nearly as bright still flares in the second slot, as it always did');

  const faint = [star('starglow', 0.75, -50, -5), star('starglow', 0.1, 40, 20)];
  ok(pickSuns(faint, lights).second === null, 'a faint star has no business flaring beside a sun');
}

{
  const none = pickSuns([], lights);
  ok(none.chosenBy === 'light' && none.sun === null, 'a zone with no star sprite keeps the light its file gives');
  const d = sunDirection(lights[0].yaw, lights[0].pitch);
  ok(near(none.dir.x, d.x, 1e-9) && near(none.dir.y, d.y, 1e-9) && near(none.dir.z, d.z, 1e-9), 'and the light comes from where that light points');
  const nothing = pickSuns([], []);
  ok(near(Math.hypot(nothing.dir.x, nothing.dir.y, nothing.dir.z), 1, 1e-9), 'a zone with neither a star nor a light is still lit from somewhere');
}

// --- 4. how a star stands in the sky ---

{
  // The same three lines three would do, as the check: a quad turned to face the camera, then rolled.
  const face = new THREE.Vector3(0, 0, 1);
  const check = (yaw: number, pitch: number, rollDeg: number) => {
    const d = sunDirection(yaw, pitch);
    const dir = new THREE.Vector3(d.x, d.y, d.z);
    const q = new THREE.Quaternion().setFromUnitVectors(face, dir.clone().negate());
    q.multiply(new THREE.Quaternion().setFromAxisAngle(face, (rollDeg * Math.PI) / 180));
    const ours = starQuadTurn(d, rollDeg);
    const mine = new THREE.Quaternion(ours[0], ours[1], ours[2], ours[3]);
    return { dir, three: q, mine };
  };
  for (const [yaw, pitch, roll] of [[0, 0, 0], [-21, -30, -71], [200, -10, 250], [40, 89, 5], [180, 0, 33]] as const) {
    const { dir, three: q, mine } = check(yaw, pitch, roll);
    ok(Math.abs(Math.abs(mine.dot(q)) - 1) < 1e-6, `a star at ${yaw}, ${pitch} stands exactly as three would turn it`);
    const normal = face.clone().applyQuaternion(mine);
    ok(near(normal.dot(dir), -1, 1e-6), `and its face looks straight back at the camera from ${yaw}, ${pitch}`);
  }
  // A body straight behind the camera's own -Z, where the turn from (0, 0, 1) is half a turn and has no one axis.
  const behind = starQuadTurn({ x: 0, y: 0, z: 1 }, 0);
  const n = face.clone().applyQuaternion(new THREE.Quaternion(behind[0], behind[1], behind[2], behind[3]));
  ok(near(n.z, -1, 1e-6), 'a star hanging the other way round still faces the camera, and is not left facing away');
  // The roll turns the quad about that same axis, which is what keeps a star's spikes still in the sky.
  const up = new THREE.Vector3(0, 1, 0);
  const a = starQuadTurn(sunDirection(0, 0), 0);
  const b = starQuadTurn(sunDirection(0, 0), 90);
  const ua = up.clone().applyQuaternion(new THREE.Quaternion(a[0], a[1], a[2], a[3]));
  const ub = up.clone().applyQuaternion(new THREE.Quaternion(b[0], b[1], b[2], b[3]));
  ok(near(ua.angleTo(ub), Math.PI / 2, 1e-6), 'the file\'s roll turns the star by that many degrees in the sky');
}

// --- 5. what stops the rays ---

{
  // The camera's own far plane and the distance the rays call sky over a planet. Standing for a
  // zone's bodies: one the size of a moon, one filling half the sky, one absurdly wider than it is
  // far away. The body itself hangs where the sky's pictures do, well inside the stand-in.
  const far = 9000;
  const bodyAt = 2600;
  const angle = (radius: number, distance: number) => Math.asin(Math.min(1, radius / distance));
  const raysSky = skyDistanceFor(true, far, 2500);
  const stand = spaceBodyStandIn(240, bodyAt);
  ok(near(stand.halfAngle, angle(240, bodyAt), 1e-9), 'a planet\'s depth stand-in covers exactly the angle the planet covers');
  ok(near(stand.distance, SPACE_SKY_TUNE.standInDistance, 1e-6), 'it stands where the tuned distance puts it, and takes nothing from the camera');
  ok(stand.distance > bodyAt && stand.distance < far, 'behind the body it stands for and inside the far plane, so it is drawn at all');
  // The whole of it, not only the point straight ahead: the depth buffer holds distance along the
  // camera's forward axis, so a stand-in far off that axis writes a shorter depth than it stands
  // at. Sixty degrees is past the corner of any screen this game is played on (a 60 degree vertical
  // field of view, whose half-diagonal reaches about 40 degrees on a very wide window).
  let lowest = Infinity;
  for (let deg = 0; deg <= 60; deg += 5) {
    const z = standInViewDepth(stand.distance, (deg * Math.PI) / 180);
    lowest = Math.min(lowest, z);
    assert.ok(z > bodyAt, `a stand-in ${deg} degrees off the view axis must not write depth in front of the body it stands for (${z.toFixed(0)} m)`);
    assert.ok(z < raysSky, `a stand-in ${deg} degrees off the view axis must still stop the rays (${z.toFixed(0)} m, sky at ${raysSky.toFixed(0)} m)`);
  }
  ok(lowest > bodyAt && lowest < raysSky, 'and it holds right across the screen, corner included: never in front of the body, never counted as open sky');
  // The widest body in the converted zones fills about 97 degrees of sky, three quarters of its own
  // distance away; the stand-in is a piece of a sphere, so its angle simply grows with it.
  const wide = spaceBodyStandIn(1950, bodyAt);
  ok(near(wide.halfAngle, angle(1950, bodyAt), 1e-9) && wide.distance === stand.distance, 'a body filling most of the sky stands at the same distance, only wider');
  const absurd = spaceBodyStandIn(5000, bodyAt);
  ok(near(absurd.halfAngle, Math.PI / 2, 1e-9), 'and a body wider than it is far away covers half the sky, not an impossible angle');
  const huge = spaceBodyStandIn(4000, 6000);
  ok(near(huge.distance, 10000, 1e-6), 'a body standing beyond the tuned distance pushes its own stand-in out past its far side');
  ok(near(skyDistanceFor(false, far, 2500), 2500, 1e-9), 'over a planet the rays keep their own sky distance');
  ok(raysSky > 6000 && raysSky < far, 'in space a station six kilometres off blocks the rays instead of shining through them');
  // The depth buffer's step out there, at 24 bits and a 0.05 m near plane: the band between the
  // stand-in and the sky must be many steps wide, or the two would quantise to the same depth.
  const step = (stand.distance * stand.distance * (1 / 16777216)) / 0.05;
  ok((raysSky - stand.distance) / step > 5, 'with room to spare in the depth buffer between a planet and the open sky behind it');
}

{
  // What a sky builds of the environment file it carries beside its own.
  const groundSky = [{ sun: true }, null, { moon: true }, null, { picture: true }, { picture: true }];
  const inSpace = environmentBodies(true, groundSky);
  ok(!inSpace.build && inSpace.leftOut === 4, 'in space none of the environment file\'s bodies are built, and the ones there are counted');
  const onPlanet = environmentBodies(false, groundSky);
  ok(onPlanet.build && onPlanet.leftOut === 0, 'over a planet they are all built, as they always were');
  ok(environmentBodies(true, []).leftOut === 0, 'and an orbit whose file has none at all leaves none out');
}

{
  const before = { ...SPACE_SKY_TUNE };
  const pair = [star('starglow', 0.75, -50, -5), star('starglow', 0.7, -50, -13)];
  ok(pickSuns(pair, lights).companion === null && pickSuns(pair, lights).second !== null, 'eight degrees apart: no companion at the tuned six');
  tuneSpaceSky({ companionDegrees: 12 });
  ok(pickSuns(pair, lights).companion !== null, 'and a companion once the angle is widened live');
  tuneSpaceSky({ companionDegrees: before.companionDegrees });
  tuneSpaceSky({ skyShare: 5, standInDistance: 6000 });
  ok(SPACE_SKY_TUNE.skyShare < 1 && SPACE_SKY_TUNE.standInDistance === 6000, 'the live knobs are held inside the far plane, and the stand-in moves in metres');
  tuneSpaceSky({ standInDistance: 1 });
  ok(spaceBodyStandIn(240, 2600).distance > 2600, 'and a stand-in pulled in on top of the sky still stands behind the body it stands for');
  tuneSpaceSky(before);
  ok(SPACE_SKY_TUNE.skyShare === before.skyShare && SPACE_SKY_TUNE.standInDistance === before.standInDistance && SPACE_SKY_TUNE.companionDegrees === before.companionDegrees, 'and all of them go back where they were');
}

// --- 5. the owner's converted zones, when present ---

const packs = new URL('../../../assets-private/', import.meta.url);
const zones = existsSync(packs) ? readdirSync(packs).filter((d) => d.startsWith('space_') && existsSync(new URL(`${d}/sky.json`, packs))) : [];
if (!zones.length) console.log('skip  no converted space zones');
else {
  type Sky = { space?: { celestials: { shader: string; size: number; yaw: number; pitch: number; image: unknown }[]; lights: { yaw: number; pitch: number }[] } | null };
  let lit = 0;
  let paired = 0;
  let agreed = 0;
  for (const z of zones) {
    const sky = JSON.parse(readFileSync(new URL(`${z}/sky.json`, packs), 'utf8')) as Sky;
    const space = sky.space;
    if (!space) continue;
    const sprites: SunStarSprite[] = space.celestials.map((c) => ({ shader: c.shader, size: c.size, yaw: c.yaw, pitch: c.pitch, hasImage: !!c.image }));
    const pick = pickSuns(sprites, space.lights);
    ok(!!pick.sun && pick.chosenBy === 'glow', `${z} is lit by a star that is really in its sky`);
    if (pick.sun) lit++;
    if (pick.companion) paired++;
    const top = rankStarGroups(space.celestials as StarSpriteLike[]);
    if (top[0] && pick.sun && top[0].yaw === pick.sun.yaw && top[0].pitch === pick.sun.pitch) agreed++;
    const disc = pickSuns(sprites, space.lights, 'disc');
    ok(!!disc.sun, `${z} has a sun under the other rule too, so the two can be compared live`);
  }
  ok(agreed === lit, 'in every converted zone the sun is the star the lens flare follows');
  ok(paired >= 1, 'and at least one zone has a pair of suns close enough to flare together');
}

console.log(`\n${passed} checks passed`);
