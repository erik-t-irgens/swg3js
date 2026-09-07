// Minimal EA-IFF reader for SWG data, usable in the browser and in Node.
// Layout: "FORM" + big-endian size + type tag + children; chunks: tag + big-endian size + payload.
// Payload values are little-endian.

export interface IffChunk {
  form: false;
  tag: string;
  data: Uint8Array;
}

export interface IffForm {
  form: true;
  tag: 'FORM';
  type: string;
  children: IffNode[];
}

export type IffNode = IffChunk | IffForm;

function tagAt(bytes: Uint8Array, o: number): string {
  return String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
}

function parseRange(bytes: Uint8Array, start: number, end: number): IffNode[] {
  const nodes: IffNode[] = [];
  let o = start;
  while (o + 8 <= end) {
    const tag = tagAt(bytes, o);
    const size = ((bytes[o + 4] << 24) | (bytes[o + 5] << 16) | (bytes[o + 6] << 8) | bytes[o + 7]) >>> 0;
    const dataStart = o + 8;
    const dataEnd = Math.min(dataStart + size, end);
    if (tag === 'FORM') {
      nodes.push({ form: true, tag, type: tagAt(bytes, dataStart), children: parseRange(bytes, dataStart + 4, dataEnd) });
    } else {
      nodes.push({ form: false, tag, data: bytes.subarray(dataStart, dataEnd) });
    }
    o = dataStart + size;
  }
  return nodes;
}

/** Parse every root-level node (SWG layer files store several root FORMs back to back). */
export function parseIffRoots(bytes: Uint8Array): IffNode[] {
  return parseRange(bytes, 0, bytes.length);
}

export function parseIff(bytes: Uint8Array): IffForm {
  const roots = parseIffRoots(bytes);
  const first = roots[0];
  if (!first || !first.form) throw new Error('IFF: no root FORM');
  return first;
}

export function isForm(node: IffNode): node is IffForm {
  return node.form;
}

export function nameOf(node: IffNode): string {
  return node.form ? node.type : node.tag;
}

export function childrenOf(node: IffForm, name: string): IffNode[] {
  return node.children.filter((c) => nameOf(c) === name);
}

export function formChild(node: IffForm, name: string): IffForm | undefined {
  return node.children.find((c): c is IffForm => c.form && c.type === name);
}

export function chunkChild(node: IffForm, name: string): IffChunk | undefined {
  return node.children.find((c): c is IffChunk => !c.form && c.tag === name);
}

/** Sequential little-endian reader over a chunk payload, mirroring Iff::read_*. */
export class ChunkReader {
  private readonly view: DataView;
  readonly bytes: Uint8Array;
  offset = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  int32(): number {
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }

  uint32(): number {
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  float(): number {
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return v;
  }

  uint8(): number {
    return this.bytes[this.offset++];
  }

  bool8(): boolean {
    return this.uint8() !== 0;
  }

  string(): string {
    let end = this.offset;
    while (end < this.bytes.length && this.bytes[end] !== 0) end++;
    let s = '';
    for (let i = this.offset; i < end; i++) s += String.fromCharCode(this.bytes[i]);
    this.offset = end + 1;
    return s;
  }

  vector(): { x: number; y: number; z: number } {
    return { x: this.float(), y: this.float(), z: this.float() };
  }
}
