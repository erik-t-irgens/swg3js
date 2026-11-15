// A source file made here, for the importer's tests: a skeleton and one take written as FBX text (the ASCII form
// three's own FBXLoader reads), every number of it chosen by the test, so the reader and the importer are run on a
// file whose answers are known by arithmetic. Nothing of it is anybody's animation: the tests write it into a
// temporary folder and delete it.
//
// The loader's text reader is strict about its tabs (a node's lines are indented one tab a level) and takes a model's
// rest pose from its `Lcl Translation` and `Lcl Rotation` properties, a take's keys from `KeyTime` (in the format's
// own ticks) and `KeyValueFloat` on three curves an animated property, and who animates whom from `Connections`.

/** A bone as the file has it: its name without the source's prefix, its parent, where it rests under its parent (centimetres), and its rest turn there (Euler degrees). */
export interface FbxBone {
  name: string;
  parent: string | null;
  local: [number, number, number];
  rest?: [number, number, number];
}

export interface FbxTake {
  /** How many keys, at `fps` a second from nought. */
  keys: number;
  fps?: number;
  /**
   * A bone's local turn at a key, Euler degrees in the format's default order (about X, then Y, then Z, each about the
   * parent's fixed axes: the turn is Rz * Ry * Rx); null for a bone the take does not turn (it gets no curves).
   */
  turn(bone: string, key: number): [number, number, number] | null;
  /** The first bone's place under its parent at a key, centimetres; none for a take that does not move it. */
  move?(key: number): [number, number, number];
}

/** The format's ticks in a second. */
const TICKS = 46186158000;

/**
 * The file's text. `order` lists the bones' objects in another order than `bones` (the source's own files list one
 * skeleton more than one way); the connections are the same either way.
 */
export function fbxText(bones: readonly FbxBone[], take: FbxTake, { prefix = 'mixamorig:', order }: { prefix?: string; order?: readonly string[] } = {}): string {
  const fps = take.fps ?? 60;
  const id = new Map(bones.map((b, i) => [b.name, 1001 + i]));
  const listed = order ? order.map((n) => bones.find((b) => b.name === n)!) : [...bones];
  const out: string[] = [];
  const num = (v: number) => (Object.is(v, -0) ? '0' : String(Number(v.toFixed(6))));
  out.push('; FBX 7.4.0 project file', 'FBXHeaderExtension:  {', '\tFBXHeaderVersion: 1003', '\tFBXVersion: 7400', '}', 'Objects:  {');
  for (const b of listed) {
    out.push(`\tModel: ${id.get(b.name)}, "Model::${prefix}${b.name}", "LimbNode" {`, '\t\tVersion: 232', '\t\tProperties70:  {');
    out.push(`\t\t\tP: "Lcl Translation", "Lcl Translation", "", "A",${b.local.map(num).join(',')}`);
    out.push(`\t\t\tP: "Lcl Rotation", "Lcl Rotation", "", "A",${(b.rest ?? [0, 0, 0]).map(num).join(',')}`);
    out.push('\t\t}', '\t}');
  }
  out.push('\tAnimationStack: 5001, "AnimStack::mixamo.com", "" {', '\t}', '\tAnimationLayer: 5002, "AnimLayer::BaseLayer", "" {', '\t}');
  const links: string[] = [];
  for (const b of bones) links.push(`\tC: "OO",${id.get(b.name)},${b.parent === null ? 0 : id.get(b.parent)}`);
  links.push('\tC: "OO",5002,5001');
  const times = Array.from({ length: take.keys }, (_, k) => String(Math.round((k * TICKS) / fps))).join(',');
  let node = 6000, curve = 7000;
  const animate = (bone: string, kind: 'T' | 'R', property: string, values: (k: number) => [number, number, number]) => {
    const n = ++node;
    out.push(`\tAnimationCurveNode: ${n}, "AnimCurveNode::${kind}", "" {`, '\t}');
    links.push(`\tC: "OO",${n},5002`, `\tC: "OP",${n},${id.get(bone)}, "${property}"`);
    ['X', 'Y', 'Z'].forEach((axis, a) => {
      const c = ++curve;
      out.push(`\tAnimationCurve: ${c}, "AnimCurve::", "" {`, '\t\tDefault: 0', '\t\tKeyVer: 4008');
      out.push(`\t\tKeyTime: *${take.keys} {`, `\t\t\ta: ${times}`, '\t\t}');
      out.push(`\t\tKeyValueFloat: *${take.keys} {`, `\t\t\ta: ${Array.from({ length: take.keys }, (_, k) => num(values(k)[a])).join(',')}`, '\t\t}', '\t}');
      links.push(`\tC: "OP",${c},${n}, "d|${axis}"`);
    });
  };
  if (take.move) animate(bones[0].name, 'T', 'Lcl Translation', take.move);
  for (const b of bones) {
    if (take.turn(b.name, 0) === null) continue;
    animate(b.name, 'R', 'Lcl Rotation', (k) => take.turn(b.name, k)!);
  }
  out.push('}', 'Connections:  {', ...links, '}', '');
  return out.join('\n');
}

/** A skeleton of world rest places (metres, no rest turns) as the file's bones: each under its parent, in centimetres. */
export function fbxBonesOf(rows: readonly { name: string; parent: number; rest: readonly [number, number, number] }[]): FbxBone[] {
  return rows.map((r) => {
    const p = r.parent < 0 ? [0, 0, 0] : rows[r.parent].rest;
    return { name: r.name, parent: r.parent < 0 ? null : rows[r.parent].name, local: [(r.rest[0] - p[0]) * 100, (r.rest[1] - p[1]) * 100, (r.rest[2] - p[2]) * 100] };
  });
}
