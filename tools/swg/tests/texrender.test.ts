// A synthetic texture-renderer blueprint: a 4x4 base texture drawn over the whole destination by
// a shader whose effect multiplies the texture by a palette colour, written through the real
// writers and rendered in software. Checks palette parsing, vertex buffers, the fixed-function
// stage emulation, customization values and the baked-shader path.
import { form, chunk, W, encode } from './iffWriter.ts';
import { parseIff } from '../iff.mjs';
import { bakeShader, loadShader, parseBlueprint, parsePalette, renderBlueprint, renderContext, shaderNeedsBake } from '../texrender.mjs';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`);
  if (!ok) failures++;
};
import { isForm } from '../iff.mjs';
/** A parsed IFF tree as writer nodes, to embed an encoded file inside another form. */
const toNode = (n: any): any => (isForm(n) ? form(n.type, ...n.children.map(toNode)) : chunk(n.tag, new Uint8Array(n.data)));
const parseIffBack = (buf: Buffer) => toNode(parseIff(buf));
const tag = (s: string) => ((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) >>> 0;
const MAIN = tag('MAIN');

// --- files -----------------------------------------------------------------------------------
const files = new Map<string, Buffer>();
const vfs = { has: (p: string) => files.has(p.toLowerCase()), read: (p: string) => files.get(p.toLowerCase())! };
const put = (path: string, data: Uint8Array) => files.set(path.toLowerCase(), Buffer.from(data));

// 4x4 uncompressed 32-bit TGA: left half grey 128, right half white, alpha 255.
{
  const w = 4, h = 4;
  const tga = new W().u8(0).u8(0).u8(2).u16(0).u16(0).u8(0).u16(0).u16(0).u16(w).u16(h).u8(32).u8(0x28);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = x < 2 ? 128 : 255;
    tga.u8(v).u8(v).u8(v).u8(255); // BGRA
  }
  put('texture/base.tga', tga.bytes());
}

// palette: entry 0 red, entry 1 blue
{
  const pal = new W();
  const body = new W().u8(0).u8(3).u16(2).u8(255).u8(0).u8(0).u8(0).u8(0).u8(0).u8(255).u8(0).bytes();
  for (const ch of 'RIFF') pal.u8(ch.charCodeAt(0));
  pal.u32(4 + 8 + body.length);
  for (const ch of 'PAL data') pal.u8(ch.charCodeAt(0));
  pal.u32(body.length);
  put('palette/test.pal', new Uint8Array([...pal.bytes(), ...body]));
}
const palette = parsePalette(vfs.read('palette/test.pal'));
check('palette entries', palette.length === 2 && palette[0][0] === 255 && palette[1][2] === 255, JSON.stringify(palette));

// effect: one fixed-function pass, one stage: colour = texture * tfactor, alpha = texture
{
  const passData = new W().i8(1).i8(0).i8(0).u8(0).u8(1).u8(1).i8(3) // stages, shade, fog, dither, z, zwrite, zcompare
    .u8(0).i8(0).i8(1).i8(0) // alpha blend off
    .u8(0).u32(MAIN).i8(7).u8(15) // alpha test off, ref tag, func, write mask
    .u32(MAIN) // texture factor tag
    .u8(0).u32(0).i8(7).i8(0).i8(0).i8(0).u32(0).u32(0); // stencil
  const stage = new W().u8(3).u8(4).u8(0).u8(0).u8(5).u8(0).u8(0).u8(0).u8(0).u8(0) // colour: modulate(texture, tfactor)
    .u8(1).u8(4).u8(0).u8(0).u8(0).u8(0).u8(0) // alpha: select texture
    .u8(0).u32(MAIN).u32(MAIN).u8(0);
  const eff = form('EFCT', form('0001', chunk('DATA', new W().i8(1).u8(0).bytes()),
    form('IMPL', form('0005', chunk('SCAP', new W().i32(0).bytes()), chunk('DATA', new W().i8(1).u32(tag('MAIN')).u8(1).u8(0).bytes()),
      form('PASS', form('0005', chunk('DATA', passData.bytes()), form('PFFP', chunk('DATA', new W().u8(0).bytes())), form('STAG', chunk('0001', stage.bytes()))))))));
  put('effect/test.eff', encode(eff));
}

// shader: MAIN texture placeholder (filled by the blueprint), texture factor white
const shaderForm = (placeholder: boolean) => form('SSHT', form('0001',
  form('TXMS', form('TXM ', form('0001', chunk('DATA', new W().u32(MAIN).u8(placeholder ? 1 : 0).u8(0).u8(0).u8(0).u8(0).u8(0).u8(0).bytes()), chunk('NAME', new W().str('texture/base.tga').bytes())))),
  form('TCSS', chunk('0000', new W().u32(MAIN).u8(0).bytes())),
  form('TFNS', chunk('0000', new W().u32(MAIN).u32(0xffffffff).bytes())),
  chunk('NAME', new W().str('effect/test.eff').bytes())));
put('shader/test.sht', encode(shaderForm(true)));

// blueprint: full-screen quad, base texture into MAIN, palette colour into the texture factor
{
  const vb = new W().u32(1 | (1 << 8) | (1 << 12)).i32(4);
  const verts = new W();
  for (const [x, y] of [[0, 0], [1, 0], [1, 1], [0, 1]]) verts.f32(x).f32(y).f32(0).f32(x).f32(y);
  const btrt = form('BTRT', form('0002',
    chunk('INFO', new W().u32(0).bytes()),
    chunk('DEST', new W().i32(4).i32(4).u32(1).u32(0).bytes()),
    form('SHTM', chunk('INFO', new W().i32(1).bytes()), chunk('NAME', new W().str('shader/test.sht').bytes())),
    form('TXTS', chunk('INFO', new W().i32(1).str('texture/base.tga').bytes())),
    form('VBS ', chunk('INFO', new W().i32(1).bytes()), form('VTXA', form('0002', chunk('INFO', vb.bytes()), chunk('DATA', verts.bytes())))),
    form('IBS ', chunk('INFO', new W().i32(1).bytes()), chunk('IDAT', new W().i32(6).u16(0).u16(1).u16(2).u16(0).u16(2).u16(3).bytes())),
    form('CAM ', chunk('PCAM', new W().f32(1).bytes())),
    form('RCMS', chunk('INFO', new W().i32(2).bytes()),
      chunk('CFBC', new W().i32(1).u32(0xff000000).i32(0).f32(1).i32(0).u32(0).bytes()),
      form('SRSC', chunk('INFO', new W().i32(0).i32(1).bytes()), chunk('RTLI', new W().i32(0).i32(0).i32(0).i32(4).i32(0).i32(2).bytes()))),
    form('PCMS', chunk('INFO', new W().i32(1).bytes()),
      form('PCMD', form('TOPS', chunk('INFO', new W().i32(2).bytes()),
        chunk('SSTC', new W().i32(0).u32(MAIN).i32(0).bytes()),
        chunk('STFP', new W().i16(0).u32(MAIN).str('palette/test.pal').str('/shared_owner/skin').i8(0).bytes()))))));
  put('appearance/test.trt', encode(btrt));
}

const bp = parseBlueprint(parseIff(vfs.read('appearance/test.trt')));
check('blueprint parsed', bp.width === 4 && bp.vertexBuffers[0].length === 4 && bp.indexBuffers[0].length === 6 && bp.commands.length === 2 && bp.prepare.length === 2, JSON.stringify({ w: bp.width, vb: bp.vertexBuffers[0].length, cmds: bp.commands.length, prep: bp.prepare.length }));
check('blueprint variables', bp.variables.length === 1 && bp.variables[0].name === '/shared_owner/skin' && bp.variables[0].kind === 'palette');
check('vertex uv', bp.vertexBuffers[0][2].uv[0][0] === 1 && bp.vertexBuffers[0][2].uv[0][1] === 1);

const px = (img: { rgba: Uint8Array; width: number }, x: number, y: number) => [...img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];
{
  const img = renderBlueprint(vfs, bp, renderContext());
  check('render size', img.width === 4 && img.height === 4 && img.missing.length === 0 && img.unsupported.length === 0, JSON.stringify(img.missing.concat(img.unsupported)));
  const left = px(img, 0, 0), right = px(img, 3, 3);
  check('default palette colour (red) modulates the grey half', left[0] === 128 && left[1] === 0 && left[2] === 0 && left[3] === 255, JSON.stringify(left));
  check('and the white half', right[0] === 255 && right[1] === 0 && right[2] === 0, JSON.stringify(right));
}
{
  const img = renderBlueprint(vfs, bp, renderContext(new Map([['skin', 1]])));
  const p = px(img, 3, 0);
  check('customization value picks palette entry 1 (blue), by short name', p[0] === 0 && p[2] === 255, JSON.stringify(p));
}

// A customizable mesh shader: base shader with a real texture, palette default 1 → baked blue tint.
{
  const cshd = form('CSHD', form('0001', shaderForm(false),
    form('TFAC', chunk('PAL ', new W().str('/private/hair').u8(1).u32(MAIN).str('palette/test.pal').i32(1).bytes()))));
  put('shader/hair.sht', encode(cshd));
  const ctx = renderContext();
  const shader = loadShader(vfs, 'shader/hair.sht', ctx);
  check('customizable shader loads', !!shader && shader.variables.length === 1 && shader.textures.has('MAIN') && shaderNeedsBake(shader), shader ? JSON.stringify(shader.variables) : 'null');
  const baked = bakeShader(shader);
  const p = baked ? px(baked, 0, 0) : null;
  check('baked shader is the texture times palette entry 1', !!p && p[0] === 0 && p[1] === 0 && p[2] === 128 && p[3] === 255, JSON.stringify(p));
}

// A shader carrying its effect inline, as blueprint shaders do.
{
  const inline = form('SSHT', form('0001',
    parseIffBack(vfs.read('effect/test.eff')),
    form('TXMS', form('TXM ', form('0001', chunk('DATA', new W().u32(MAIN).u8(0).u8(0).u8(0).u8(0).u8(0).u8(0).u8(0).bytes()), chunk('NAME', new W().str('texture/base.tga').bytes())))),
    form('TFNS', chunk('0000', new W().u32(MAIN).u32(0xff00ff00).bytes()))));
  put('shader/inline.sht', encode(inline));
  const shader = loadShader(vfs, 'shader/inline.sht', renderContext());
  check('inline effect parsed', !!shader && !!shader.effect && shader.effect.passes.length === 1 && shader.effectFile === '(inline effect)', shader ? JSON.stringify(shader.effectFile) : 'null');
  const baked = shader && shaderNeedsBake(shader) ? bakeShader(shader) : null;
  const p = baked ? px(baked, 3, 0) : null;
  check('inline effect bakes with its texture factor (green)', !!p && p[0] === 0 && p[1] === 255 && p[2] === 0, JSON.stringify(p));
}

if (failures) {
  console.error(`${failures} failed`);
  process.exit(1);
}
