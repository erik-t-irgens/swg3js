// One decoded picture for every copy of the same image an imports folder's models embed (Map-maker II's tenth wave's folders).
//
// The import command bakes each model into a GLB of its own, and every GLB carries its own copy of each picture it wears:
// a set of walls cut from one kit embeds the kit's textures once per wall. Three's GLTFLoader keeps a texture cache per file
// only, so each copy was decoded into an ImageBitmap of its own, which three keeps as the texture's image for as long as the
// texture lives, and uploaded to the card as a texture of its own. Measured on the owner's Utapau (286 imported models over
// 3,782 rows): 1,881 pictures embedded, 478 of them distinct by their bytes; 11.0 GB of decoded bitmaps standing in the
// renderer after the arrival (13.3 GB with every model loaded), which with the same again on the card ran the tab out of
// memory as the view turned onto more of them. Here every picture of an imports pack is keyed by its bytes (a SHA-1 of the
// embedded file, its mime type beside it) and decoded once for the pack: each use is the shared picture's own clone, so it
// keeps its own sampler, colour space and name while sharing the one `Source` -- one ImageBitmap, and one upload for every
// use alike in its sampler (three keys its WebGL textures by source and parameters). A converted pack never registers this,
// and loads exactly as before.
import * as THREE from 'three';
import type { GLTFLoaderPlugin, GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** glTF's sampler numbers, as GLTFLoader reads them (WEBGL_FILTERS, WEBGL_WRAPPINGS). */
const FILTERS: Record<number, THREE.MagnificationTextureFilter | THREE.MinificationTextureFilter> = {
  9728: THREE.NearestFilter,
  9729: THREE.LinearFilter,
  9984: THREE.NearestMipmapNearestFilter,
  9985: THREE.LinearMipmapNearestFilter,
  9986: THREE.NearestMipmapLinearFilter,
  9987: THREE.LinearMipmapLinearFilter,
};
const WRAPS: Record<number, THREE.Wrapping> = { 33071: THREE.ClampToEdgeWrapping, 33648: THREE.MirroredRepeatWrapping, 10497: THREE.RepeatWrapping };

type TextureDef = { source?: number; sampler?: number; name?: string; extensions?: Record<string, unknown> };
type ImageDef = { bufferView?: number; uri?: string; mimeType?: string; name?: string };
type SamplerDef = { magFilter?: number; minFilter?: number; wrapS?: number; wrapT?: number };
type ParserJson = { textures?: TextureDef[]; images?: ImageDef[]; samplers?: SamplerDef[] };

/** A key for an image's bytes: SHA-1 where the page has the digest (any secure origin, and node), else two FNV-1a 32s and the length. */
async function digestOf(bytes: ArrayBuffer): Promise<string> {
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (subtle) {
    const h = new Uint8Array(await subtle.digest('SHA-1', bytes));
    let s = '';
    for (let i = 0; i < h.length; i++) s += h[i].toString(16).padStart(2, '0');
    return s;
  }
  const b = new Uint8Array(bytes);
  let a = 0x811c9dc5;
  let c = 0x01000193;
  for (let i = 0; i < b.length; i++) {
    a = Math.imul(a ^ b[i], 0x01000193);
    c = Math.imul(c ^ b[b.length - 1 - i], 0x811c9dc5);
  }
  return `${b.length}:${(a >>> 0).toString(16)}:${(c >>> 0).toString(16)}`;
}

/** The pack's one picture per distinct image, and what it has saved (`pictures`). */
export class SharedImages {
  private readonly byContent = new Map<string, Promise<THREE.Texture | null>>();
  /** Textures the pack's files asked for, pictures decoded for them, and the decoded bytes each kind came to (RGBA, no mips). */
  asked = 0;
  decoded = 0;
  askedBytes = 0;
  decodedBytes = 0;

  /** The GLTFLoader plugin for one file's parser: `loader.register((parser) => images.plugin(parser))`. */
  plugin(parser: GLTFParser): GLTFLoaderPlugin {
    return new SharedImagePlugin(parser, this);
  }

  /** What the sharing has done, for the console. */
  get pictures(): { asked: number; decoded: number; askedMB: number; decodedMB: number } {
    return { asked: this.asked, decoded: this.decoded, askedMB: Math.round(this.askedBytes / 1048576), decodedMB: Math.round(this.decodedBytes / 1048576) };
  }

  /** One file's texture: the shared picture of its image's bytes, cloned with this file's own sampler and name. */
  async texture(parser: GLTFParser, textureIndex: number, def: TextureDef, src: ImageDef): Promise<THREE.Texture | null> {
    const json = parser.json as ParserJson;
    const bytes = (await parser.getDependency('bufferView', src.bufferView!)) as ArrayBuffer;
    const key = `${src.mimeType ?? ''}:${await digestOf(bytes)}`;
    let base = this.byContent.get(key);
    const first = !base;
    if (!base) {
      base = parser.loadTextureImage(textureIndex, def.source!, parser.textureLoader) as Promise<THREE.Texture | null>;
      this.byContent.set(key, base);
    }
    const shared = await base;
    if (!shared) return null;
    const image = shared.image as { width?: number; height?: number } | null;
    const size = (image?.width ?? 0) * (image?.height ?? 0) * 4;
    this.asked++;
    this.askedBytes += size;
    if (first) {
      this.decoded++;
      this.decodedBytes += size;
    }
    // A clone shares the picture's Source. Cloning marks the source changed (Texture.copy sets needsUpdate), which would
    // upload the picture again into every WebGL texture already holding it the next time each is drawn -- a stall for every
    // model loaded later that shares it -- so the source's version is put back: the clone itself still uploads on its first
    // draw wherever its sampler makes a texture of its own.
    const version = shared.source.version;
    const own = shared.clone();
    own.source.version = version;
    const s = (json.samplers ?? [])[def.sampler ?? -1] ?? {};
    own.flipY = false;
    own.name = def.name || src.name || '';
    own.magFilter = (FILTERS[s.magFilter ?? -1] as THREE.MagnificationTextureFilter | undefined) ?? THREE.LinearFilter;
    own.minFilter = FILTERS[s.minFilter ?? -1] ?? THREE.LinearMipmapLinearFilter;
    own.wrapS = WRAPS[s.wrapS ?? -1] ?? THREE.RepeatWrapping;
    own.wrapT = WRAPS[s.wrapT ?? -1] ?? THREE.RepeatWrapping;
    own.generateMipmaps = own.minFilter !== THREE.NearestFilter && own.minFilter !== THREE.LinearFilter;
    parser.associations.set(own, { textures: textureIndex });
    return own;
  }
}

class SharedImagePlugin implements GLTFLoaderPlugin {
  readonly name = 'SWG_shared_images';
  private readonly parser: GLTFParser;
  private readonly share: SharedImages;

  constructor(parser: GLTFParser, share: SharedImages) {
    this.parser = parser;
    this.share = share;
  }

  /** An embedded image (a GLB's bufferView) is shared; anything else (a URI, an extension's own source) is three's. */
  loadTexture(textureIndex: number): Promise<THREE.Texture> | null {
    const json = this.parser.json as ParserJson;
    const def = json.textures?.[textureIndex];
    const src = def?.source !== undefined ? json.images?.[def.source] : undefined;
    if (!def || !src || src.bufferView === undefined || src.uri !== undefined) return null;
    // A picture that would not decode answers null, as three's own loadTextureImage does (its typing says otherwise).
    return this.share.texture(this.parser, textureIndex, def, src) as Promise<THREE.Texture>;
  }
}
