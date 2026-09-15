// A ship's client data (clientdata/ship/*.cdf, FORM CLDF) and its cockpit (cockpit/*.iff, FORM CPIT).
//
// The client data names what hangs on the hull beyond its own mesh: the wings (separate objects,
// each a template of its own), an "engine on" appearance shown while the drive runs, thruster
// particles at named hardpoints, contrails at wingtips, the smoke and fire of each damage band,
// and the effect played when the ship is destroyed. The cockpit file names the frame drawn
// around the pilot in first person, with the view's zoom steps and offsets.
//
//   FORM CLDF > FORM 0000 >
//     FORM WING: DATA (template cstring, float open angle in degrees, float seconds to open, open sound cstring),
//                PSOR (6 floats: the hinge's position, then yaw, pitch and roll in degrees; the wing turns about the hinge's Z)
//     FORM ONOF: INFO (int32 on/off), APPR (appearance cstring), HARD (hardpoint cstring)
//     FORM VTHR: INFO (float, the damage share it starts at), HOBJ* (particle cstring + hardpoint cstring), VSND
//     FORM CONT > FORM 0000 > INFO (hardpoint cstring, name cstring, byte, appearance cstring)
//     FORM DAMA: INFO (float from, float to, effect cstring), APPR (particle cstring), PSOR (6 floats) | HARD (hardpoint cstring), ASND (sound cstring)
//     FORM GLOW: INFO (slot cstring, hardpoint cstring, shader cstring, shader cstring, floats)
//     FORM INTS: INFO (name cstring, sound cstring, ...)
//     FORM DSTR: INFO (effect cstring)
//   FORM CPIT > FORM 0000 > FRAM (appearance cstring), ZOOM (floats), FRST (float), 3OFF (3 floats), 1OFF (3 floats)
import { childrenOf, find, isForm, readCString } from './iff.mjs';

const floats = (buf, offset, n) => {
  const out = [];
  for (let i = 0; i < n && offset + i * 4 + 4 <= buf.length; i++) out.push(buf.readFloatLE(offset + i * 4));
  return out;
};

const strings = (buf, offset = 0) => {
  const out = [];
  let at = offset;
  while (at < buf.length) {
    const { value, next } = readCString(buf, at);
    out.push(value);
    at = next;
  }
  return out;
};

/** The client data of a ship or of one of its components, as plain lists. */
export function parseClientData(root) {
  if (!isForm(root) || root.type !== 'CLDF') throw new Error(`not client data: ${root.type ?? root.tag}`);
  const version = root.children.find(isForm) ?? root;
  const out = { wings: [], onOff: [], thrusters: [], contrails: [], damage: [], glows: [], sounds: [], destroyed: null };
  for (const form of version.children) {
    if (!isForm(form)) continue;
    switch (form.type) {
      case 'WING': {
        const data = find(form, 'DATA');
        const psor = find(form, 'PSOR');
        if (!data) break;
        // The wing's template, how far it opens (degrees) and how long that takes (seconds), then
        // the sound of it opening. The wing is a static mesh modelled in the hull's frame: the
        // client turns the whole object about the hinge in PSOR, between closed and open.
        const { value: template, next } = readCString(data.data, 0);
        const angle = data.data.length >= next + 4 ? data.data.readFloatLE(next) : 0;
        const time = data.data.length >= next + 8 ? data.data.readFloatLE(next + 4) : 0;
        const sounds = data.data.length > next + 8 ? strings(data.data, next + 8).filter(Boolean).map((s) => s.replace(/^@+/, '')) : [];
        out.wings.push({ template: template.replace(/\\/g, '/'), angle, time, sounds, hinge: psor ? floats(psor.data, 0, 6) : null });
        break;
      }
      case 'ONOF': {
        const appr = find(form, 'APPR');
        const hard = find(form, 'HARD');
        if (appr) out.onOff.push({ appearance: readCString(appr.data).value.replace(/\\/g, '/'), hardpoint: hard ? readCString(hard.data).value : '' });
        break;
      }
      case 'VTHR': {
        const info = find(form, 'INFO');
        const from = info && info.data.length >= 4 ? info.data.readFloatLE(0) : 0;
        for (const hobj of childrenOf(form, 'HOBJ')) {
          const [particle, hardpoint] = strings(hobj.data);
          if (particle) out.thrusters.push({ particle: particle.replace(/\\/g, '/'), hardpoint: hardpoint ?? '', from });
        }
        break;
      }
      case 'CONT': {
        const inner = form.children.find(isForm) ?? form;
        const info = find(inner, 'INFO');
        if (!info) break;
        const [hardpoint, name] = strings(info.data);
        const rest = strings(info.data).slice(2).find((s) => /appearance\//i.test(s)) ?? '';
        out.contrails.push({ hardpoint: hardpoint || name, name, appearance: rest.replace(/\\/g, '/') });
        break;
      }
      case 'DAMA': {
        const info = find(form, 'INFO');
        const appr = find(form, 'APPR');
        const psor = find(form, 'PSOR');
        const hard = find(form, 'HARD');
        const asnd = find(form, 'ASND');
        if (!info || info.data.length < 8) break;
        const effect = info.data.length > 9 ? readCString(info.data, 8).value : '';
        const appearance = appr ? readCString(appr.data).value : '';
        if (!appearance && !effect) break;
        out.damage.push({ from: info.data.readFloatLE(0), to: info.data.readFloatLE(4), effect: effect.replace(/\\/g, '/'), appearance: appearance.replace(/\\/g, '/'), hardpoint: hard ? readCString(hard.data).value : null, transform: psor ? floats(psor.data, 0, 6) : null, sound: asnd ? readCString(asnd.data).value : '' });
        break;
      }
      case 'GLOW': {
        const info = find(form, 'INFO');
        if (!info) break;
        const [slot, hardpoint, shader, shaderNoZ] = strings(info.data);
        const at = [slot, hardpoint, shader, shaderNoZ].reduce((n, s) => n + s.length + 1, 0);
        out.glows.push({ slot, hardpoint, shader, shaderNoZ, values: floats(info.data, at, Math.floor((info.data.length - at) / 4)) });
        break;
      }
      case 'INTS': {
        const info = find(form, 'INFO');
        if (info) {
          const [name, sound] = strings(info.data);
          out.sounds.push({ name, sound });
        }
        break;
      }
      case 'ENGS':
        for (const ints of childrenOf(form, 'INTS')) {
          const info = find(ints, 'INFO');
          if (info) {
            const [name, sound] = strings(info.data);
            out.sounds.push({ name, sound });
          }
        }
        break;
      case 'DSTR': {
        const info = find(form, 'INFO');
        if (info) out.destroyed = readCString(info.data).value.replace(/\\/g, '/');
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/**
 * A client effect (clienteffect/*.cef, FORM CLEF): what the game plays for an event (a gun firing,
 * a bolt striking armour). Its chunks name a particle effect, a sound and force feedback; only
 * the particle effects and sounds are read, as lists, whatever the chunk layout.
 */
export function parseClientEffect(root) {
  if (!isForm(root) || root.type !== 'CLEF') throw new Error(`not a client effect: ${root.type ?? root.tag}`);
  const out = { particles: [], sounds: [] };
  const walk = (node) => {
    if (isForm(node)) {
      for (const c of node.children) walk(c);
      return;
    }
    for (const s of strings(node.data)) {
      const p = s.replace(/\\/g, '/').replace(/^\//, '');
      if (/\.prt$/i.test(p)) out.particles.push(p);
      else if (/\.snd$/i.test(p)) out.sounds.push(p);
    }
  };
  walk(root);
  return out;
}

/** A cockpit file: the frame's appearance, the zoom steps, and the view offsets. */
export function parseCockpit(root) {
  if (!isForm(root) || root.type !== 'CPIT') throw new Error(`not a cockpit: ${root.type ?? root.tag}`);
  const version = root.children.find(isForm) ?? root;
  const fram = find(version, 'FRAM');
  const zoom = find(version, 'ZOOM');
  const frst = find(version, 'FRST');
  const off3 = find(version, '3OFF');
  const off1 = find(version, '1OFF');
  return {
    appearance: fram ? readCString(fram.data).value.replace(/\\/g, '/') : null,
    zoom: zoom ? floats(zoom.data, 0, Math.floor(zoom.data.length / 4)) : [],
    first: frst && frst.data.length >= 4 ? frst.data.readFloatLE(0) : null,
    thirdOffset: off3 ? floats(off3.data, 0, 3) : [0, 0, 0],
    firstOffset: off1 ? floats(off1.data, 0, 3) : [0, 0, 0],
  };
}
