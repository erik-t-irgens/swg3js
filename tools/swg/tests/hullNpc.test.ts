// Any garage ship hull stood as an NPC ship (src/space/hullNpc.ts, the owner's request of 2026-10-19): the side and
// tier refused or taken, the type of ours made from a hull's fields, the taunt table the converter's own rule gives,
// the fit choice (a tier chassis's fit where the hull's family has one, the stock fit otherwise) and the tier asked kept,
// the console's routing, the layout `standHull` stands a group by (apart, clear of the point, every member within its
// own draw distance and its own leash), and the reach a big hull stands out by past a fitted one's sphere, which the
// pilots' sight and gun reach are measured with; then the same over the real ships pack when it is there
// (SWG3JS_PACKS, else assets-private), ids and counts only; and the text pins that the NPC tab and the console both
// reach the one manager method with the side and tier asked, which lays its group out by `hullLayout` and builds
// through the typed ships' path.
//
// Run: node tools/swg/tests/hullNpc.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  HULL_FITTED_RADIUS, HULL_NPC_TUNE, HULL_TIERS, NPC_SIDES, hullAhead, hullChassisOf, hullFamilyOf, hullLayout, hullNameOf, hullNpcPlan, hullRadiusOf, hullSize, hullSpread, hullWords,
  npcShipRoute, npcSideOf, npcTierOf, reachBeyond, slotOf, tauntTableFor, tuneHullNpc, typesOnHull, type HullLayout, type HullLayoutBase, type HullLike,
} from '../../../src/space/hullNpc.ts';
import type { NpcFaction, NpcTypeDef } from '../../../src/space/combatData.ts';
import { PILOT_SKILL, formationPoint } from '../../../src/space/pilot.ts';
import { pickLoadout, seeded } from '../../../src/space/loadout.ts';
import { FACTION_FORMATION, GROUPS } from '../../../src/space/roster.ts';
import type { ComponentDef, FitDef } from '../../../src/vehicles/shipFit.ts';
import { tauntTableOf } from '../npcships.mjs';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const note = (what: string) => console.log(`note ${what}`);
const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const mainSrc = read('src/main.ts');
const uiSrc = read('src/ui/npcUi.ts');
const shipsSrc = read('src/space/npcShips.ts');
const brainSrc = read('src/space/npcBrain.ts');
const contactsSrc = read('src/space/contacts.ts');

// ---------------------------------------------------------------- the side and the tier

ok(NPC_SIDES.join(',') === 'imperial,rebel,blacksun,pirate,neutral' && NPC_SIDES.every((s) => npcSideOf(s) === s), 'the five sides are taken as spelled');
ok(['player', 'Imperial', 'pirates', '', ' neutral', null, undefined, 3, {}, ['rebel']].every((x) => npcSideOf(x) === null), "the player's own side and anything else are refused");
ok([1, 2, 5, 6, 10].every((t) => npcTierOf(t) === t) && HULL_TIERS.least === 1 && HULL_TIERS.most === 10, 'a whole tier from 1 to 10 is taken');
ok([0, 11, -1, 2.5, NaN, Infinity, '3', null, undefined].every((x) => npcTierOf(x) === null), 'a tier outside 1 to 10, a fraction or a string is refused');

// ---------------------------------------------------------------- the taunt table is the converter's own rule

{
  const families = ['tiefighter', 'xwing', 'hutt_light_s01', 'hutt_turret_ship', 'yt1300', 'corvette', 'blacksun_light_s01', 'z95', 'hutt'];
  let n = 0;
  let same = true;
  for (const side of NPC_SIDES) for (const family of families) for (let tier = 1; tier <= 10; tier++) {
    n++;
    if (tauntTableFor(side, family, tier) !== tauntTableOf(side, family, tier)) same = false;
  }
  ok(same, `the taunt table is the one the converter gives a type of that side, family and tier (${n} cases)`);
}

// ---------------------------------------------------------------- a hull's own fields

const typ = (family: string, tier: number, hull: string, chassisFit = true, extra: Partial<NpcTypeDef> = {}): NpcTypeDef => {
  const s = /^(.+)_(s\d+)$/.exec(family);
  return { id: `${family}_tier${tier}`, name: `TEST ${family}`, family, base: s ? s[1] : family, style: s ? s[2] : null, tier, hull, chassis: chassisFit ? `${family}_tier${tier}` : `nofit_${family}_tier${tier}`, faction: 'rebel', taunts: 'rebel', ...extra };
};
const fitted = (c: string) => !c.startsWith('nofit_');
const hull = (id: string, extra: Partial<HullLike> = {}): HullLike => ({ id, label: `${id.replace(/_/g, ' ')} (fighter)`, fit: { chassis: `player_${id}` }, chassis: `player_${id}`, template: `object/ship/player/shared_player_${id}.iff`, bounds: { min: [-4, -2, -7], max: [4, 2, 7] }, ...extra });

{
  const types = [1, 2, 3, 4, 5].map((t) => typ('xwing', t, 'xwing'));
  const x = hull('xwing');
  const plan = hullNpcPlan(x, 'imperial', 3, types, fitted);
  const t = plan.type;
  ok(plan.fit === 'tier' && plan.from?.id === 'xwing_tier3' && t.chassis === 'xwing_tier3', "a hull whose family has a tier fit takes the tier's own chassis");
  ok(t.faction === 'imperial' && t.tier === 3 && t.hull === 'xwing' && t.family === 'xwing' && t.base === 'xwing' && t.style === null && t.standIn === true, 'the type of ours carries the side and tier asked and the hull\'s own family');
  ok(t.name === 'TEST xwing' && t.taunts === 'imperial' && t.template === 'object/ship/player/shared_player_xwing.iff' && t.id === 'xwing_as_imperial_tier3', 'its name is the game\'s for a type on the hull, its taunt table the side\'s');
  ok(!types.some((g) => g.id === t.id), 'its id is none of the game\'s types');
  const high = hullNpcPlan(x, 'pirate', 8, types, fitted);
  ok(high.fit === 'tier' && high.from?.tier === 5 && high.type.tier === 8, 'a tier past the family\'s top takes its nearest tier\'s chassis and keeps the tier asked');
  ok(hullNpcPlan(x, 'neutral', 1, types, fitted).type.taunts === 'generic_low', "tiers 1 and 2 read the side's _low table");
  // The tier asked is the tier the type carries, at every tier, so `stand` hands it to pickLoadout, the stats and the
  // pilot's skill, each of which reads it through the ladder (tierLadder.test.ts holds the ladder itself).
  let kept = true;
  for (const side of NPC_SIDES) for (let tier = 1; tier <= 10; tier++) if (hullNpcPlan(x, side, tier, types, fitted).type.tier !== tier) kept = false;
  ok(kept, 'the type of ours carries the tier asked, 1 to 10, whatever tiers the family has');
}
{
  // Ranking: the hull's own family first, then its style-less base, then another drawn on it; the nearest tier within the best.
  const types = [typ('hutt_light_s02', 1, 'hutt_light_s02'), typ('hutt_light_s02', 5, 'hutt_light_s02'), typ('scyk_s02', 6, 'hutt_light_s02'), typ('scyk_s02', 8, 'hutt_light_s02')];
  const h = hull('hutt_light_s02');
  ok(hullNpcPlan(h, 'pirate', 8, types, fitted).from?.id === 'hutt_light_s02_tier5', "a hull's own family wins over another drawn on it, even at a tier only the other has");
  ok(hullNpcPlan(h, 'pirate', 8, types, fitted).type.taunts === 'hutt', 'a pirate on a Hutt family reads the hutt table');
  const turret = hull('hutt_turret_ship');
  const krayt = [typ('krayt', 6, 'hutt_turret_ship'), typ('krayt', 9, 'hutt_turret_ship')];
  const k = hullNpcPlan(turret, 'blacksun', 2, krayt, fitted);
  ok(k.fit === 'tier' && k.from?.id === 'krayt_tier6' && hullNameOf(turret, krayt) === 'TEST krayt', 'a hull whose only types are another family takes theirs, nearest tier, and their name');
  // The other family sorts first by name and ties on tier, so only the rank can choose the base.
  const droid = hull('droid_fighter_s01');
  const dtypes = [typ('aaa_s01', 2, 'droid_fighter_s01'), typ('droid_fighter', 2, 'droid_fighter_s01')];
  ok(hullNpcPlan(droid, 'neutral', 2, dtypes, fitted).from?.family === 'droid_fighter', 'a styled hull whose types are its style-less base takes those before another family');
  const tie = [typ('tie', 1, 'tie'), typ('tie', 4, 'tie'), typ('tie', 2, 'tie')];
  ok(hullNpcPlan(hull('tie'), 'imperial', 3, tie, fitted).from?.id === 'tie_tier2', 'on a tie in distance the lower tier is taken, as spawnFamily picks');
  ok(typesOnHull(hull('tie'), [...tie, { ...typ('tie', 3, 'tie'), standIn: true }]).length === 3, 'a type of ours is never one drawn on the hull');
}
{
  // Stock: no type on the hull, or none with a tier fit.
  const yt = hull('yt1300', { label: 'yt1300 (freighter)', fit: { chassis: 'player_yt1300' } });
  const plan = hullNpcPlan(yt, 'pirate', 3, [], fitted);
  ok(plan.fit === 'stock' && plan.from === null && plan.type.chassis === 'player_yt1300' && plan.type.name === 'yt1300', 'a hull no NPC type draws flies its stock fit on its own chassis, named in the garage\'s words');
  ok(plan.type.taunts === 'generic' && plan.type.family === 'yt1300', 'a pirate on a hull that is no Hutt\'s reads the generic table');
  const deco = hull('yt1300_decorated_01', { fit: { chassis: 'player_yt1300' } });
  ok(hullFamilyOf(deco) === 'yt1300' && hullNpcPlan(deco, 'rebel', 4, [], fitted).type.chassis === 'player_yt1300', "the decorated YT-1300's family and chassis are the YT-1300's");
  const corv = hull('corellian_corvette', { label: 'corellian corvette (gunship)', fit: { chassis: 'player_corvette' } });
  ok(hullFamilyOf(corv) === 'corvette' && hullWords(corv) === 'corellian corvette', "the corvette's family is its chassis's less player_, its words the garage's less the class");
  const unfit = [typ('xwing', 1, 'xwing', false), typ('xwing', 2, 'xwing', false)];
  ok(hullNpcPlan(hull('xwing'), 'rebel', 1, unfit, fitted).fit === 'stock', 'a family whose chassis has no tier fit leaves the hull its stock fit');
  ok(hullChassisOf({ id: 'q', label: 'q' }) === 'player_q' && hullChassisOf({ id: 'q', label: 'q', chassis: 'player_r' }) === 'player_r', 'a hull with no fit flies its manifest chassis, else the player row named after it');
}

// ---------------------------------------------------------------- the console's routing

{
  const none = { type: false, family: false };
  ok(npcShipRoute('tiefighter_tier1', {}, { type: true, family: false }).to === 'type' && npcShipRoute('xwing', { tier: 3, count: 3 }, { type: false, family: true }).to === 'type', 'with no side named a type or family name stands the game\'s own types, as it always did');
  const x = npcShipRoute('xwing', { faction: 'imperial', tier: 8 }, { type: false, family: true });
  ok(x.to === 'hull' && x.hull === 'xwing' && x.side === 'imperial' && x.tier === 8 && x.count === 1 && x.ahead === 700 && x.named, 'a side named asks for the hull even where a family has its name, alone and 700 m ahead unless said');
  const yt = npcShipRoute('yt1300', {}, none);
  ok(yt.to === 'hull' && yt.side === 'neutral' && yt.tier === 1 && yt.count === 1 && !yt.named, 'a name no type or family has is a hull, neutral at tier 1 unless said, asked of the garage first');
  const p = npcShipRoute('yt1300', { faction: 'pirate', tier: 3, count: 3, distance: 400 }, none);
  ok(p.to === 'hull' && p.side === 'pirate' && p.tier === 3 && p.count === 3 && p.ahead === 400, 'the side, the tier, a patrol of three and the distance asked are what it hands on');
  const odd = npcShipRoute('yt1300', { faction: 'player', tier: 0, count: 2, distance: NaN }, none);
  ok(odd.to === 'hull' && odd.side === 'player' && odd.tier === 0 && odd.count === 1 && odd.ahead === 700, 'a side or tier standHull refuses is handed on as typed for its words; a count but 3 is one, a distance no number 700 m');
}

// ---------------------------------------------------------------- the reach a big hull stands out by

{
  // A Star Destroyer's box, as the pack writes it (its larger corner first), and a fighter's.
  const sd = { r: 2587 / 2, hx: 1437 / 2, hy: 647 / 2, hz: 2587 / 2 };
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  ok(reachBeyond(15, 3, 2, 15, 0, 0, 1) === 0 && reachBeyond(HULL_FITTED_RADIUS, 9, 9, 17, 1, 1, 1) === 0 && reachBeyond(8, 4, 2, 7, 0, 0, 0) === 0, 'a hull no bigger than a fitted one stands out nought whichever way, so a typed ship\'s sight and reach are what they were');
  ok(near(reachBeyond(sd.r, sd.hx, sd.hy, sd.hz, 0, 0, -3), sd.hz - HULL_FITTED_RADIUS) && near(reachBeyond(sd.r, sd.hx, sd.hy, sd.hz, 0, 5, 0), sd.hy - HULL_FITTED_RADIUS) && near(reachBeyond(sd.r, sd.hx, sd.hy, sd.hz, -2, 0, 0), sd.hx - HULL_FITTED_RADIUS), 'a Star Destroyer stands out its length off its bow, its height over its deck and its width off its side, less a fitted hull\'s');
  ok(near(reachBeyond(sd.r, sd.hx, sd.hy, sd.hz, 1, 1, 1), sd.r - HULL_FITTED_RADIUS) && near(reachBeyond(sd.r, sd.hx, sd.hy, sd.hz, 0, 0, 0), sd.r - HULL_FITTED_RADIUS), 'never past its own sphere, which a direction of nought takes whole');
  // The break-off keeps the two spheres apart (`breakRange` half and both radii); measured from the middles a hull
  // longer than its gun's range is never in reach there, measured as the pilot measures now it is, off the bow.
  let reaches = true;
  for (const skill of Object.values(PILOT_SKILL)) {
    const brk = skill.breakRange * 0.5 + sd.r + 8;
    if (!(brk <= 512 + reachBeyond(sd.r, sd.hx, sd.hy, sd.hz, 0, 0, 1))) reaches = false;
    if (!(brk <= 1024 + reachBeyond(sd.r, sd.hx, sd.hy, sd.hz, 0, 0, 1))) reaches = false;
    if (brk <= 512 || brk <= 1024) reaches = false;
  }
  ok(reaches, "a fighter's guns (512 m) reach a Star Destroyer off its bow, and its own (1024 m) a fighter, from where the break-off holds them, which measured from the middles they never did");
}

// ---------------------------------------------------------------- the layout standHull stands a group by

// The manager's own numbers, read off its source and pinned to the base it hands `hullLayout`.
const num = (src: string, re: RegExp): number => Number(re.exec(src)?.[1] ?? NaN);
const BASE: HullLayoutBase = {
  hide: num(shipsSrc, /export const HIDE_BEYOND = (\d+);/),
  leash: num(brainSrc, /export const LEASH = (\d+);/),
  routeOut: num(shipsSrc, /const ROUTE_OUT = \[\d+, (\d+)\] as const;/),
  routeRise: num(shipsSrc, /const ROUTE_RISE = (\d+);/),
  above: num(shipsSrc, /const HAND_ABOVE = (\d+);/),
};
ok(Object.values(BASE).every((v) => Number.isFinite(v) && v > 0) && /const LAYOUT_BASE: HullLayoutBase = \{ hide: HIDE_BEYOND, leash: LEASH, routeOut: ROUTE_OUT\[1\], routeRise: ROUTE_RISE, above: HAND_ABOVE \};/.test(shipsSrc), `the layout is worked out from the manager's own numbers (${JSON.stringify(BASE)})`);

const len = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z);
/** The leader faces back toward the point, so in its own frame the point stands at (0, 0, reach): each member's distance from it. */
const fromPoint = (lay: HullLayout, i: number) => len(lay.slots[i][0], lay.slots[i][1], lay.slots[i][2] - lay.reach);
/** Half a box's diagonal, measured here on its own (the hull's sphere the layout must keep apart and clear). */
const sphereOf = (b: HullLike['bounds']): number => (b ? len(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2 : 0);
/**
 * What can go wrong with a layout of a hull whose sphere is `r`: a radius other than the hull's, members in each other,
 * one over the point, one past its draw distance at the stand or on its route, one past its leash.
 */
function faults(lay: HullLayout, r: number, apartToo: boolean): string[] {
  const out: string[] = [];
  if (Math.abs(lay.radius - r) > 1e-9) out.push(`laid out for a radius of ${lay.radius} where the hull's is ${r}`);
  let most = 0;
  for (let i = 0; i < lay.slots.length; i++) {
    const d = fromPoint(lay, i);
    most = Math.max(most, len(lay.slots[i][0], lay.slots[i][1], lay.slots[i][2]));
    if (d - r < HULL_NPC_TUNE.aheadClear - 1e-6) out.push(`member ${i} within ${HULL_NPC_TUNE.aheadClear} m of the point`);
    if (d > lay.drawReach) out.push(`member ${i} stood ${Math.round(d)} m off, past its draw distance ${Math.round(lay.drawReach)}`);
    if (apartToo) for (let j = i + 1; j < lay.slots.length; j++) {
      const s = lay.slots[i];
      const t = lay.slots[j];
      if (len(s[0] - t[0], s[1] - t[1], s[2] - t[2]) < 2 * r) out.push(`members ${i} and ${j} in each other`);
    }
  }
  const roams = r + BASE.routeOut + BASE.routeRise + most;
  if (lay.reach + roams > lay.drawReach) out.push('a member on its leader\'s route can go past its draw distance');
  if (roams > lay.leash) out.push(`a member in its own slot on its leader's route (${Math.round(roams)} m from home) is past its leash ${Math.round(lay.leash)}`);
  return out;
}
const box = (w: number, h: number, l: number): HullLike['bounds'] => ({ min: [w / 2, h / 2, l / 2], max: [-w / 2, -h / 2, -l / 2] });

{
  const arrow = [[0, 0, 0], [-25, 25, 25], [25, 25, -25]];
  const claw = [[0, 0, 0], [-50, 50, 25], [50, 5, 25]];
  ok(hullRadiusOf({ min: [4, 2, 7], max: [-4, -2, -7] }) === hullRadiusOf({ min: [-4, -2, -7], max: [4, 2, 7] }) && hullRadiusOf(null) === 0, "a box's radius is the same whichever corner it writes first; none is 0");
  ok(hullSpread(8) === 1 && hullSpread(17) === 1 && Math.abs(hullSpread(34) - 2) < 1e-12 && hullSize(8) === 1 && hullSize(34) === 2, 'a fighter keeps the table\'s slots; a hull twice the fitted radius has them twice as far apart and is twice a fitted hull\'s size');
  ok(hullAhead(8, 1, arrow, 3, 700) === 700 && hullAhead(8, 1, arrow, 1, 700) === 700 && hullAhead(8, 1, arrow, 3, 400) === 400 && hullAhead(8, 1, arrow, 1, 100) === 100, 'a fighter is stood where it is asked, 700 m or 400 m or 100 m, as a typed one is');
  ok(hullAhead(141, hullSpread(141), arrow, 1, 100) === 141 + HULL_NPC_TUNE.aheadClear && hullAhead(141, hullSpread(141), arrow, 3, 700) === 700, "a corvette asked nearer than its own radius is stood out past it; at 700 m a patrol of three needs nothing more");
  // One rule for a slot, the manager's and its wingmen's: the table's row spread, or past the rows 40 m a step.
  const s = [0, 0, 0];
  ok(slotOf(arrow, 1, 1, s).join(',') === '-25,25,25' && slotOf(arrow, 2, 3, s).join(',') === '75,75,-75' && slotOf([], 1, 1, s).join(',') === '40,0,-40' && slotOf([], 2, 2, s).join(',') === '-80,0,-160', 'a slot is its table row times the spread, else past the rows behind and to either side');
  const fighter = hullLayout(box(8, 4, 14), arrow, 3, 700, BASE);
  ok(fighter.spread === 1 && fighter.reach === 700 && fighter.above === BASE.above && fighter.drawReach === BASE.hide && fighter.leash === BASE.leash && fighter.slots.map((x) => x.join(',')).join(' ') === arrow.map((x) => x.join(',')).join(' '), 'a fighter-sized hull is laid out, drawn and leashed exactly as a typed group is');
  const corvette = hullLayout(box(82, 50, 266), arrow, 3, 700, BASE);
  const sdArrow = hullLayout(box(1437, 647, 2587), arrow, 3, 700, BASE);
  const sdClaw = hullLayout(box(1437, 647, 2587), claw, 3, 700, BASE);
  const sdOne = hullLayout(box(1437, 647, 2587), claw, 1, 700, BASE);
  const rC = sphereOf(box(82, 50, 266));
  const rS = sphereOf(box(1437, 647, 2587));
  const all = [faults(corvette, rC, true), faults(sdArrow, rS, true), faults(sdClaw, rS, true), faults(sdOne, rS, true)].flat();
  ok(all.length === 0, `three corvettes and three Star Destroyers stand apart, clear of the point, within their own draw distance and their leash, alone or in a patrol (${Math.round(corvette.reach)}, ${Math.round(sdArrow.reach)} and ${Math.round(sdOne.reach)} m ahead; a Star Destroyer drawn to ${Math.round(sdOne.drawReach / 1000)} km)${all.length ? `: ${all.join('; ')}` : ''}`);
  // The leader faces back toward the point (`lookAlong`), so a member's distance from it is its slot less (0, 0, reach)
  // in the leader's frame whichever way the view looked: placed by the game's own formationPoint, it is.
  let same = true;
  for (const dir of [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0.3, -0.5).normalize(), new THREE.Vector3(-0.2, -0.9, 0.1).normalize()]) {
    const from = new THREE.Vector3(120, -40, 3000);
    const lead = from.clone().addScaledVector(dir, sdClaw.reach);
    const t = from.clone().sub(lead).normalize();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.asin(THREE.MathUtils.clamp(-t.y, -1, 1)), Math.atan2(t.x, t.z), 0, 'YXZ'));
    for (let i = 0; i < 3; i++) {
      const at = formationPoint(lead, q, new THREE.Vector3().fromArray(sdClaw.slots[i]), new THREE.Vector3());
      if (Math.abs(at.distanceTo(from) - fromPoint(sdClaw, i)) > 1e-6) same = false;
    }
  }
  ok(same, 'a member placed by formationPoint about a leader facing the point stands as far from it as the layout says, whichever way the view looked');
  const kept = { ...HULL_NPC_TUNE };
  tuneHullNpc({ slotFits: 0, aheadClear: -5, nonsense: 3 } as Partial<typeof HULL_NPC_TUNE>);
  ok(HULL_NPC_TUNE.slotFits === 1 && HULL_NPC_TUNE.aheadClear === 0 && !('nonsense' in HULL_NPC_TUNE), 'the knob clamps and refuses a name it does not hold');
  tuneHullNpc(kept);
  ok(HULL_NPC_TUNE.slotFits === kept.slotFits && HULL_NPC_TUNE.aheadClear === kept.aheadClear && HULL_NPC_TUNE.slotFits === HULL_FITTED_RADIUS, 'and puts the table back');
}

// ---------------------------------------------------------------- the real ships pack

const PACKS = process.env.SWG3JS_PACKS ?? fileURLToPath(new URL('../../../assets-private/', import.meta.url));
const json = (rel: string): any => {
  const f = join(PACKS, rel);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
};
const manifest = json('ships/manifest.json');
const combat = json('ships/combat.json');
const comps = json('ships/components.json');
if (!manifest || !combat) note(`no ships pack with a combat.json under ${PACKS}: the real hulls are not checked (npm run swg -- ships '@SWG' assets-private --retail-only)`);
else {
  const components: ComponentDef[] = comps?.components ?? [];
  const types: NpcTypeDef[] = combat.types;
  const hasTierFit = (c: string) => !!combat.chassis?.[c]?.fit;
  // The garage's own defs of the pack's ships (Garage.load): the label with its class, the fit only with components.
  const hulls: (HullLike & { fit: FitDef | null })[] = manifest.ships.map((sh: any) => ({ id: sh.id, label: `${sh.label} (${sh.class})`, template: sh.template, chassis: sh.chassis ?? null, fit: sh.fit && components.length ? sh.fit : null, bounds: sh.bounds ?? null }));
  // Whether a hull has a tier fit at all, worked out here on its own: a type drawn on it whose chassis has one.
  const hasTier = (h: HullLike): boolean => types.some((t) => t.hull === h.id && hasTierFit(t.chassis));
  let tierHulls = 0;
  let stockHulls = 0;
  const wrong: string[] = [];
  for (const h of hulls) {
    const any = hasTier(h);
    const own = types.some((t) => t.hull === h.id && t.family === hullFamilyOf(h) && hasTierFit(t.chassis));
    for (const side of NPC_SIDES) {
      for (let tier = 1; tier <= 10; tier++) {
        const p = hullNpcPlan(h, side as NpcFaction, tier, types, hasTierFit);
        const t = p.type;
        if (t.faction !== side || t.tier !== tier || t.hull !== h.id || !t.standIn || t.family !== hullChassisOf(h).replace(/^player_/, '')) wrong.push(`${h.id} ${side} ${tier}: fields`);
        if ((p.fit === 'tier') !== any) wrong.push(`${h.id} ${side} ${tier}: fit ${p.fit} where the pack ${any ? 'has' : 'has no'} tier fit`);
        if (p.fit === 'tier' && (!p.from || p.from.hull !== h.id || !hasTierFit(p.from.chassis) || t.chassis !== p.from.chassis)) wrong.push(`${h.id} ${side} ${tier}: the chassis is not a fitted one of the hull's`);
        if (own && p.from?.family !== hullFamilyOf(h)) wrong.push(`${h.id} ${side} ${tier}: not its own family's fit`);
        if (p.fit === 'stock' && t.chassis !== hullChassisOf(h)) wrong.push(`${h.id} ${side} ${tier}: stock on another chassis`);
        if (t.taunts !== tauntTableOf(side, t.family, tier) || !(t.taunts in combat.taunts)) wrong.push(`${h.id} ${side} ${tier}: taunts ${t.taunts}`);
      }
    }
    if (any) tierHulls++;
    else stockHulls++;
  }
  ok(wrong.length === 0, `every hull of the pack at every side and tier is planned on its own fields and the tier asked, its tier fit where its hull has one (${hulls.length} hulls, ${hulls.length * 50} plans)${wrong.length ? `: ${wrong.slice(0, 6).join('; ')}` : ''}`);
  ok(tierHulls > 0 && stockHulls > 0, `${tierHulls} hulls fly a tier chassis's fit, ${stockHulls} their stock fit`);
  if (!components.length) {
    note(`no components.json under ${PACKS}/ships: "every hull that flies its stock fit has one" and "the tier fit's parts are pickLoadout's" are not checked (a pack without it is built as its stock tree)`);
  } else {
    // A hull of the NPC-only path with no chassis row (the End of War's lancer, frigate and transport, the two GCW
    // stations) has no fit at all and flies the stock tree its client data hangs, as a pack without components.json does.
    ok(hulls.filter((h) => !hasTier(h) && h.chassis).every((h) => !!h.fit), 'every hull with a chassis that flies its stock fit has one, as a player gets it');
    // The tier fit is picked as a typed ship's is: every part a component of the pack in a slot of the fit.
    let picked = 0;
    let inFit = true;
    const names = new Set(components.map((c) => c.name));
    let sample = 0;
    for (const h of hulls.filter((x) => hasTier(x))) {
      sample++;
      for (const tier of [1, 3, 5, 8, 10]) {
        const p = hullNpcPlan(h, 'imperial', tier, types, hasTierFit);
        const fit = combat.chassis[p.type.chassis].fit as FitDef;
        const proj = (manifest.ships.find((s: any) => s.id === h.id)?.weapon?.projectile ?? null) as number | null;
        const got = pickLoadout(fit, components, p.type.tier, proj, seeded(11));
        const slots = new Set(fit.slots.map((s) => s.slot));
        for (const [slot, name] of Object.entries(got.components)) {
          picked++;
          if (!slots.has(slot) || !names.has(name as string)) inFit = false;
        }
      }
    }
    ok(inFit && picked > 0, `the tier fit's parts are pickLoadout's, every one a component of the pack in a slot of the fit (${picked} parts over ${sample} hulls at five tiers)`);
  }
  const by = (id: string) => hulls.find((h) => h.id === id);
  const xw = by('xwing');
  if (xw) {
    const p = hullNpcPlan(xw, 'imperial', 8, types, hasTierFit);
    ok(p.fit === 'tier' && p.from?.family === 'xwing' && p.type.taunts === 'imperial' && p.type.tier === 8, `an X-wing stood Imperial at tier 8 takes ${p.from?.id}'s chassis and the Imperial taunts, at tier 8`);
  }
  const yt = by('yt1300');
  if (yt) ok(hullNpcPlan(yt, 'pirate', 3, types, hasTierFit).fit === 'stock', 'a YT-1300 flies its stock fit (no NPC type draws it)');
  const corv = by('corellian_corvette');
  if (corv) ok(hullNpcPlan(corv, 'neutral', 1, types, hasTierFit).type.chassis === 'player_corvette', 'the corvette flies on its own chassis');
  // The hulls the zones' patrols fly (the rosters' families) are the fitted size: measured, laid out and drawn as they
  // always were. The NPC-only path's hulls (the gunboats, freighters, transports) are bigger, and a family on one is
  // laid out by its size wherever it is stood (`spawnFamily`, as `standHull`, below).
  const rosterFamilies = new Set(Object.values(GROUPS).flatMap((list) => list.flatMap((g) => g.families)));
  const patrolHulls = new Set(types.filter((t) => rosterFamilies.has(t.base) || rosterFamilies.has(t.family)).map((t) => t.hull));
  const bigPatrol = hulls.filter((h) => patrolHulls.has(h.id) && h.bounds && (hullRadiusOf(h.bounds) > HULL_FITTED_RADIUS || Math.max(Math.abs(h.bounds.max[0] - h.bounds.min[0]), Math.abs(h.bounds.max[2] - h.bounds.min[2])) / 2 > HULL_FITTED_RADIUS));
  ok(patrolHulls.size > 0 && bigPatrol.length === 0, `every hull the zones' patrols fly is no bigger than a fitted hull (${patrolHulls.size} hulls), so a patrol's group, its draw distance, its leash and its pilots' sight and reach are what they were${bigPatrol.length ? `: ${bigPatrol.map((h) => h.id).join(', ')}` : ''}`);
  const typedHulls = new Set(types.map((t) => t.hull));
  const bigTyped = hulls.filter((h) => typedHulls.has(h.id) && h.bounds && hullRadiusOf(h.bounds) > HULL_FITTED_RADIUS);
  note(`${bigTyped.length} hulls an NPC type of the game's flies are bigger than a fitted hull (the NPC-only path's: ${bigTyped.map((h) => h.id).slice(0, 8).join(', ')}${bigTyped.length > 8 ? ', ...' : ''}), laid out by their size`);
  // Every hull's lone ship and patrol of three, in each side's formation, in space and on a planet: apart, clear of the
  // point, every member within its draw distance and its leash; and within those two at the knob's ends as well.
  const bad: string[] = [];
  const keptTune = { ...HULL_NPC_TUNE };
  const ends: Partial<typeof HULL_NPC_TUNE>[] = [{}, { slotFits: 1 }, { slotFits: 500 }, { aheadClear: 0 }, { aheadClear: 20000 }, { slotFits: 1, aheadClear: 20000 }];
  for (const end of ends) {
    tuneHullNpc({ ...keptTune, ...end });
    for (const h of hulls) {
      for (const side of NPC_SIDES) {
        for (const flat of [false, true]) {
          const f = combat.formations?.[FACTION_FORMATION[side]];
          const rows = (flat ? f?.flat : f?.space) ?? [];
          for (const count of [1, 3]) {
            for (const ahead of [100, 700]) {
              const lay = hullLayout(h.bounds, rows, count, ahead, BASE);
              // Members apart only at the knob's own start: moving it down is asking them nearer.
              const f2 = faults(lay, sphereOf(h.bounds), Object.keys(end).length === 0);
              if (f2.length) bad.push(`${h.id} ${side}${flat ? ' flat' : ''} ×${count} ${JSON.stringify(end)}: ${f2[0]}`);
            }
          }
        }
      }
    }
  }
  tuneHullNpc(keptTune);
  ok(bad.length === 0, `every hull's lone ship and patrol of three, in each side's formation, stands apart and clear of the point, every member within its own draw distance and its leash, at the layout knob's start and its ends${bad.length ? `: ${bad.slice(0, 6).join('; ')}` : ` (${hulls.length} hulls)`}`);
  note(`the game's names for the hulls: ${hulls.filter((h) => hullNameOf(h, types) !== hullWords(h)).length} of ${hulls.length} have one from an NPC type drawn on them`);
}

// ---------------------------------------------------------------- the one way in, with the side and tier asked

{
  const calls = mainSrc.match(/mgr\.standHull\(/g)?.length ?? 0;
  const spawner = mainSrc.slice(mainSrc.indexOf('private shipSpawner(): ShipSpawner {'), mainSrc.indexOf('private crosshairBody()'));
  const consoleAt = mainSrc.indexOf('npcShip: async (');
  const consoleBody = mainSrc.slice(consoleAt, mainSrc.indexOf('shipCombat: (', consoleAt));
  ok(calls === 3 && spawner.includes('return mgr.standHull(hull, side, tier, count, from, dir);') && /spawnHull: async \(hull, side, tier, count\) => \{/.test(spawner), "the NPC tab's spawner hands the manager's standHull the hull, side, tier and count it was given");
  ok(spawner.includes('return mgr.standHull(e.hull, e.faction, END_OF_WAR_TUNE.tier, count, from, dir, undefined, { name: e.name, endOfWar: e.id });') && /spawnEndOfWar: async \(id, count\) => \{/.test(spawner), "the End of War's row hands standHull its hull, its own side, the tier of their own and its name and id");
  ok(
    consoleBody.includes('const route = npcShipRoute(what, opts, { type: !!type, family: data.typesOfFamily(what).length > 0 });') &&
      consoleBody.includes("if (route.to === 'hull') {") &&
      consoleBody.includes('return mgr.standHull(route.hull, route.side, route.tier, route.count, from, dir, route.ahead);'),
    "the console's npcShip routes by npcShipRoute and hands standHull the route's hull, side, tier, count and distance",
  );
  const uiOne = uiSrc.match(/deps\.ships\.spawnHull\(/g)?.length ?? 0;
  ok(
    uiOne === 1 &&
      uiSrc.includes('void deps.ships.spawnHull(hull, this.hullSide(hull), this.hullTier(hull), count).then(') &&
      uiSrc.includes('const hull = (d.hullOne ?? d.hullPatrol)!;') &&
      uiSrc.includes('const count: 1 | 3 = d.hullOne !== undefined ? 1 : 3;') &&
      uiSrc.includes('<button data-hull-one="${id}"') &&
      uiSrc.includes('<button data-hull-patrol="${id}"'),
    "the tab's one and patrol buttons hand the spawner the row's hull, its side, its tier and one or three",
  );
  ok(
    uiSrc.includes('<select class="ship-side" data-hull-side="${id}"') &&
      uiSrc.includes("querySelectorAll<HTMLSelectElement>('select[data-hull-side]')) if (el.dataset.hullSide === hull) return el.value;") &&
      uiSrc.includes('<select class="ship-tier" data-hull-tier="${id}"') &&
      uiSrc.includes("querySelectorAll<HTMLSelectElement>('select[data-hull-tier]')") &&
      uiSrc.includes('if (el.dataset.hullTier === hull) {'),
    "a hull row's side and tier are read off its own selects",
  );
  const standHull = shipsSrc.slice(shipsSrc.indexOf('async standHull('), shipsSrc.indexOf('async spawnType('));
  ok(
    standHull.includes('const faction = npcSideOf(side);') &&
      standHull.includes('const t = npcTierOf(tier);') &&
      standHull.includes('const plan = hullNpcPlan(hull, faction, t, data.file.types, (c) => !!data.chassis(c)?.fit, as);') &&
      standHull.includes('const g = this.newGroup(faction, null, true, this.makeRoute(lead, lay.radius, rng, lay.above), lead, lay);') &&
      standHull.includes('const r = await this.stand(plan.type, hull, at, q, g, rng);'),
    'standHull plans the hull for the side and tier asked, stands its group for that side and builds each ship as the plan\'s type',
  );
  ok(
    standHull.includes('const lay = hullLayout(hull.bounds, rows, count, Math.max(50, ahead), LAYOUT_BASE);') &&
      standHull.includes('const lead = this.raise(from.clone().addScaledVector(tmp, lay.reach), lay.above);') &&
      standHull.includes('formationPoint(lead, q, slotV.fromArray(lay.slots[i]), at);') &&
      standHull.includes('this.raise(at, lay.above);') &&
      !/hullSpread\(|hullAhead\(|hullRadiusOf\(/.test(standHull),
    'standHull stands its group where hullLayout says, by nothing worked out beside it',
  );
  // A big hull is refused, never stood, inside a ship already out or still being built: the places the layout gives are
  // asked of `standsInside` before any group is made, in the hull path (only for a hull bigger than a fitted one, as the
  // family path asks only with a big hull's layout) and in a big family's; what is asked about is `inTheWay`'s, the ships
  // out and every stand's places, which each stand holds from before its first wait until it is done, however it ends.
  {
    const family = shipsSrc.slice(shipsSrc.indexOf('async spawnFamily('), shipsSrc.indexOf('async standHull('));
    const hullAsk = 'const inside = lay.radius > HULL_FITTED_RADIUS ? this.standsInsideOut(places, lay.radius) : null;';
    const familyAsk = 'const inside = this.standsInsideOut(places, lay.radius);';
    const refused = /if \(inside\) return `a \$\{(plan\.)?type\.name\} would stand inside the \$\{inside\} already out there/;
    const before = (src: string, ask: string) => src.includes(ask) && src.indexOf(ask) < src.indexOf('const g = ') && refused.test(src);
    ok(before(standHull, hullAsk) && before(family, familyAsk) && family.indexOf('if (lay) {') < family.indexOf(familyAsk) && shipsSrc.includes('const j = standsInside(places, radius, out);'), "standHull (a hull bigger than a fitted one) and a big family's stand ask whether any place would stand inside a ship already out before a group is made, and refuse in words; a fighter is never asked");
    ok(shipsSrc.includes('const out = inTheWay(this.ships, this.coming);') && shipsSrc.includes('return j < 0 ? null : out[j].name;'), 'what a stand is asked about is every ship out and every stand still being built (inTheWay), named by the very list asked');
    // Held with nothing awaited between the ask and the hold, so no other stand can slip in between them.
    const holds = (src: string, ask: string, held: string, wait: string) => {
      const at = src.indexOf(held);
      const tryAt = src.indexOf('try {', at);
      return at > src.indexOf(ask) && !src.slice(src.indexOf(ask), at).includes('await') && at < src.indexOf(wait) && tryAt > at && tryAt < src.indexOf(wait) && /\} finally \{\s*this\.releasePlaces\(held\);\s*\}/.test(src.slice(tryAt));
    };
    ok(holds(standHull, hullAsk, 'const held = this.holdPlaces(places, lay.radius || HULL_FITTED_RADIUS, plan.type.name);', 'await this.stand(') && holds(family, familyAsk, 'const held = this.holdPlaces(places, lay ? lay.radius : (hullDef?.bounds ? hullRadiusOf(hullDef.bounds) : 0) || HULL_FITTED_RADIUS, type.name);', 'await this.spawnType('), 'each stand holds every place it was given straight after the ask and before it first waits, and lets them go in a finally however it ends');
  }
  const capAt = [...standHull.matchAll(/this\.capRefusal\(count\)/g)].map((m) => m.index ?? -1);
  const garageAt = standHull.indexOf('await this.deps.garage()');
  ok(capAt.length === 2 && garageAt > 0 && capAt[0] < garageAt && capAt[1] > garageAt && /this\.ships\.length \+ this\.pending \+ count <= NPC_SHIP_CAP/.test(shipsSrc), 'standHull counts against the cap before the garage is awaited, and again after it');
  ok((shipsSrc.match(/this\.deps\.spawnHull\(/g)?.length ?? 0) === 1 && (shipsSrc.match(/this\.stand\(/g)?.length ?? 0) === 2, 'the manager builds a typed ship and a hull through the one stand, which builds through spawnHull once');
  ok(
    shipsSrc.includes('const picked = chassis?.fit && fitDef === chassis.fit ? pickLoadout(chassis.fit, garage.components, type.tier,') &&
      shipsSrc.includes('const combat = this.deps.ships.adopt(v, { faction: type.faction as ShipFaction, type });'),
    "stand picks the parts at the type's tier and adopts the ship for the type's side: the tier and side asked reach the fit, the stats and the pilot",
  );
  ok(
    /return out\.fromArray\(slotOf\(rows, i, g\.spread, slotArr\)\);/.test(shipsSrc) && /slotV\.fromArray\(slotOf\(rows, this\.ship\.slot, this\.ship\.group\.spread, slotArr\)\);/.test(brainSrc),
    'a wingman holds its slot by the one rule the manager stood it by, spread as the manager laid it',
  );
  ok(
    shipsSrc.includes('if (s.type.family === family && !s.type.standIn) n++;') &&
      shipsSrc.includes('if (s.type.standIn && s.type.hull === hull && !s.type.endOfWar) n++;') &&
      shipsSrc.includes('if (s.type.endOfWar === id) n++;') &&
      mainSrc.includes('clear: (family) => this.world.npcShips?.clear(family ? (s) => s.type.family === family && !s.type.standIn : undefined) ?? 0,') &&
      mainSrc.includes('clearHull: (hull) => this.world.npcShips?.clear((s) => s.type.standIn === true && s.type.hull === hull && !s.type.endOfWar) ?? 0,') &&
      mainSrc.includes('clearEndOfWar: (id) => this.world.npcShips?.clear((s) => s.type.endOfWar === id) ?? 0,'),
    "a family's count and clear leave the hulls of ours to their own row, which counts and clears them by hull, and the End of War's to theirs, by id",
  );
  // A family on a hull bigger than a fighter is laid out by its size, by the one rule a hull stood for a side is.
  const spawnFamily = shipsSrc.slice(shipsSrc.indexOf('async spawnFamily('), shipsSrc.indexOf('async standHull('));
  ok(
    spawnFamily.includes('hullRadiusOf(hullDef.bounds) > HULL_FITTED_RADIUS ? hullLayout(hullDef.bounds, data.formation(FACTION_FORMATION[faction] ?? \'arrow\', !this.deps.space), count, Math.max(50, ahead), LAYOUT_BASE) : null') &&
      spawnFamily.includes('formationPoint(lead, q, slotV.fromArray(lay.slots[i]), at);') &&
      spawnFamily.includes('this.newGroup(faction, null, true, this.makeRoute(lead, lay.radius, rng, lay.above), lead, lay)') &&
      spawnFamily.includes('this.newGroup(faction, null, true, this.makeRoute(lead, 0, rng), lead)') &&
      spawnFamily.includes('formationPoint(lead, q, this.slotOffset(g, i, slotV), at);') &&
      spawnFamily.includes('const r = await this.spawnType(type.id, places[i], q, g, i, rng);'),
    "a family on a hull bigger than a fighter (the NPC-only path's) is stood where hullLayout says, and a fighter's family exactly as it always was",
  );
  // The End of War's row: its one and patrol buttons, its count and clear, and the garage hulls its readiness is asked
  // against, each a hand-over no behaviour test makes (`endOfWar.test.ts` runs the rows' rule on lists of its own).
  ok(
    uiSrc.includes('const id = (d.eowOne ?? d.eowPatrol)!;') &&
      uiSrc.includes('const count: 1 | 3 = d.eowOne !== undefined ? 1 : 3;') &&
      uiSrc.includes('void deps.ships.spawnEndOfWar(id, count).then(') &&
      uiSrc.includes('<button data-eow-one="${id}"') &&
      uiSrc.includes('<button data-eow-patrol="${id}"') &&
      uiSrc.includes("this.say(`${deps.ships.clearEndOfWar(d.eowClear)} taken away`);") &&
      uiSrc.includes("const n = ships.countEndOfWar?.(el.dataset.eowCount ?? '') ?? 0;"),
    "the End of War row's one and patrol buttons hand the spawner its id and one or three, and its count and clear are its own",
  );
  ok(
    mainSrc.includes('countEndOfWar: (id) => this.world.npcShips?.countEndOfWar(id) ?? 0,') &&
      mainSrc.includes("return { rows: endOfWarRows(list, g ? new Set(g.vehicles.filter((d) => d.source === 'ship').map((d) => d.id)) : null), tier: END_OF_WAR_TUNE.tier };") &&
      mainSrc.includes("const e = this.world.ships.data?.endOfWar().find((x) => x.id === id);"),
    "the game counts the End of War's ships by their own id, and asks their readiness against every ship hull of the garage, the NPC-only ones among them",
  );
  ok(
    shipsSrc.includes('const TYPED_SCALE: GroupScale = { spread: 1, drawReach: HIDE_BEYOND, leash: LEASH };') &&
      /scale: GroupScale = TYPED_SCALE\): NpcGroup/.test(shipsSrc) &&
      shipsSrc.includes('const far = s.group.drawReach;') &&
      shipsSrc.includes('const show = s.vehicle.pos.distanceToSquared(p) <= far * far;') &&
      brainSrc.includes('<= g.leash * g.leash;') &&
      brainSrc.includes('pos.distanceToSquared(home) > group.leash * group.leash') &&
      !/LEASH \* LEASH|HIDE_BEYOND \* HIDE_BEYOND/.test(shipsSrc + brainSrc),
    "a ship is hidden past its own group's draw distance and its pilot chases within its own group's leash (a typed group's HIDE_BEYOND and LEASH)",
  );
  ok(
    brainSrc.includes('if (dist > w.range + this.ship.contact.reachToward(target.pos) + (target instanceof ShipContact ? target.reachToward(pos) : 0)) return;') &&
      brainSrc.includes('const sees = range + me.reachToward(c.pos) + c.reachToward(me.pos);') &&
      brainSrc.includes('if (d2 < bestD && d2 < sees * sees) {') &&
      contactsSrc.includes('if (!(v.radius > HULL_FITTED_RADIUS)) return 0;') &&
      contactsSrc.includes('return reachBeyond(v.radius,'),
    "a pilot's gun reach and sight are measured from the part of each hull standing out past a fitted hull's sphere (nought for every typed hull)",
  );
}

console.log(`\n${passed} checks passed`);
