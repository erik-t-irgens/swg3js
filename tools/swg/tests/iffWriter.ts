// Tiny IFF writer for synthetic terrain test data.
export type Node = { form: string; children: Node[] } | { chunk: string; data: Uint8Array };
export const form = (type: string, ...children: Node[]): Node => ({ form: type, children });
export const chunk = (tag: string, data: Uint8Array): Node => ({ chunk: tag, data });
export class W {
  parts: number[] = [];
  i32(v: number) { const b = new DataView(new ArrayBuffer(4)); b.setInt32(0, v, true); this.parts.push(...new Uint8Array(b.buffer)); return this; }
  u32(v: number) { const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, v >>> 0, true); this.parts.push(...new Uint8Array(b.buffer)); return this; }
  f32(v: number) { const b = new DataView(new ArrayBuffer(4)); b.setFloat32(0, v, true); this.parts.push(...new Uint8Array(b.buffer)); return this; }
  u8(v: number) { this.parts.push(v & 255); return this; }
  i8(v: number) { this.parts.push(v & 255); return this; }
  i16(v: number) { const b = new DataView(new ArrayBuffer(2)); b.setInt16(0, v, true); this.parts.push(...new Uint8Array(b.buffer)); return this; }
  u16(v: number) { const b = new DataView(new ArrayBuffer(2)); b.setUint16(0, v, true); this.parts.push(...new Uint8Array(b.buffer)); return this; }
  str(s: string) { for (const ch of s) this.parts.push(ch.charCodeAt(0)); this.parts.push(0); return this; }
  bytes() { return new Uint8Array(this.parts); }
}
function tag4(s: string) { return [...s].map((c) => c.charCodeAt(0)); }
function be32(v: number) { return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]; }
export function encode(n: Node): Uint8Array {
  if ('chunk' in n) return new Uint8Array([...tag4(n.chunk), ...be32(n.data.length), ...n.data]);
  const body: number[] = [...tag4(n.form)];
  for (const c of n.children) body.push(...encode(c));
  return new Uint8Array([...tag4('FORM'), ...be32(body.length), ...body]);
}
export function encodeRoots(ns: Node[]): Uint8Array { const out: number[] = []; for (const n of ns) out.push(...encode(n)); return new Uint8Array(out); }
// helpers for layer items
export const ihdr = (name: string, active = 1) => form('IHDR', form('0001', chunk('DATA', new W().i32(active).str(name).bytes())));
export const mfrc = (seed: number, opts: Partial<{ bias: number; gain: number; oct: number; freq: number; amp: number; sx: number; sy: number; ox: number; oy: number; rule: number }> = {}) =>
  form('MFRC', form('0001', chunk('DATA', new W().u32(seed).i32(opts.bias !== undefined ? 1 : 0).f32(opts.bias ?? 0.5).i32(opts.gain !== undefined ? 1 : 0).f32(opts.gain ?? 0.7).i32(opts.oct ?? 2).f32(opts.freq ?? 4).f32(opts.amp ?? 0.5).f32(opts.sx ?? 0.01).f32(opts.sy ?? 0.01).f32(opts.ox ?? 0).f32(opts.oy ?? 0).i32(opts.rule ?? 0).bytes())));
