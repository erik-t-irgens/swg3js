// A building put down in play beside the eye has its rooms compiled with its shell before the portal renderer may draw
// them (`LayoutStreamer.addToTier`, `buildInterior`'s `hold`): traced in the browser on a fresh profile, every gallery
// house the world editor put down on Monument held one frame 300 to 400 ms on a link, each wait a room's own material
// (`getProgramInfoLog` in three's first use, under the portal renderer's draw), because the rooms were made the moment
// the house stood and drawn through its doors and windows before their compile, asked for and never awaited, was done.
// Here, on the real streamer: while the compile is held the rooms are in the scene hidden and out of the portal
// renderer's list (`interior`), and handed to the compile with the shell; once it answers they are the building's rooms;
// a building taken up while they compile takes them with it; and with no compile step at all the rooms are made at once,
// as before.
import assert from 'node:assert/strict';

const { THREE, makeStreamer, gatePrepare } = await import('./streamHarness.ts');

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

type H = Awaited<ReturnType<typeof makeStreamer>>;

/** The streamer with the hall's loaded model carrying a doorway, so its rooms are a portal building's (drawn per room). */
async function withPortals(): Promise<H> {
  const h = await makeStreamer();
  const hall = await h.gallery.model('hall');
  // The hall's doorway in its +Z wall, between its shell (0) and its room (1), as a loaded portal building carries one.
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  (hall as { portals: unknown[] }).portals = [{ verts: [V(-1, 0, 10), V(1, 0, 10), V(1, 2, 10), V(-1, 2, 10)], indices: [0, 1, 2, 0, 2, 3], links: [{ from: 0, to: 1 }] }];
  // The player beside where the hall will stand, so its rooms are wanted at once.
  await h.settle({ x: 0, z: 0 }, 3);
  return h;
}
const stand = (h: H, key: string, x: number, z: number) => h.stream.standPermanent({ key, model: 'hall', x, y: 0, z, q: [0, 0, 0, 1], inside: false, solid: true }, h.gallery as never);
const buildingOf = (h: H, key: string) => h.stream.buildingOf(key) as { interior: THREE.Mesh[]; interiorHeld?: { meshes: THREE.Mesh[]; cells: number[] }; interiorCell?: Int16Array; interiorBuilt: boolean } | null;

{
  const h = await withPortals();
  const gate = gatePrepare(h.stream);
  const asked: THREE.Object3D[][] = [];
  const inner = h.stream.prepare!;
  h.stream.prepare = (roots: THREE.Object3D[]) => {
    asked.push(roots);
    return inner(roots);
  };
  gate.arm();
  const a = stand(h, 'place/hall-1', 6, 4);
  let b = null as ReturnType<typeof buildingOf>;
  for (let i = 0; i < 50 && !gate.held; i++) await new Promise((r) => setTimeout(r, 0));
  b = buildingOf(h, 'place/hall-1');
  ok(gate.held && !!b, 'a hall stood beside the player waits on its compile');
  ok(!!b && b.interior.length === 0 && !!b.interiorHeld && b.interiorHeld.meshes.length > 0, `while it compiles its rooms are held out of the portal renderer's list (${b?.interiorHeld?.meshes.length ?? 0} held, ${b?.interior.length ?? -1} in the list)`);
  ok(!!b?.interiorHeld && b.interiorHeld.meshes.every((m) => m.parent === h.scene && !m.visible), 'in the scene, hidden, to be compiled');
  ok(!!b?.interiorHeld && asked.length === 1 && b.interiorHeld.meshes.every((m) => asked[0].includes(m)), 'and handed to the compile with the shell, in one call');
  gate.open();
  await a?.built;
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  b = buildingOf(h, 'place/hall-1');
  ok(!!b && b.interior.length > 0 && !b.interiorHeld && b.interiorCell?.length === b.interior.length, `once it answers they are the building's rooms, each with its room (${b?.interior.length})`);
  ok(asked.length === 1, 'and nothing compiles them a second time');
}

{
  // Taken up while its rooms compile: they go with it, and the compile's answer brings nothing back.
  const h = await withPortals();
  const gate = gatePrepare(h.stream);
  gate.arm();
  const a = stand(h, 'place/hall-2', 6, 4);
  for (let i = 0; i < 50 && !gate.held; i++) await new Promise((r) => setTimeout(r, 0));
  const held = buildingOf(h, 'place/hall-2')?.interiorHeld?.meshes ?? [];
  ok(held.length > 0, 'a second hall holds its rooms while it compiles');
  h.stream.unplace('place/hall-2');
  ok(held.every((m) => m.parent === null), 'taken up meanwhile, its held rooms leave the scene with it');
  gate.open();
  await a?.built;
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  ok(held.every((m) => m.parent === null) && !h.stream.buildingOf('place/hall-2'), 'and the compile answering brings nothing back');
}

{
  // With no compile step (a world with none), the rooms are made at once, as they always were.
  const h = await withPortals();
  h.stream.prepare = undefined;
  const a = stand(h, 'place/hall-3', 6, 4);
  await a?.built;
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  const b = buildingOf(h, 'place/hall-3');
  ok(!!b && b.interior.length > 0 && !b.interiorHeld, 'with no compile step a hall beside the player has its rooms at once, as before');
}

console.log(`\n${checks} checks passed`);
