// The gallery world's exhibits: a label over every placed house, vehicle and weapon, and a grid
// of player models each looping one animation with its name over it, from both games, sorted
// by category. The models come from the gallery pack's animation files and are cloned per
// exhibit only while the player is near, so the grid can hold thousands of clips.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { markActor } from './portalRender';

export interface GalleryClip {
  name: string;
  /** The joints a clip drives when it moves only part of the skeleton; layered over the idle. */
  joints?: string[];
  speed?: number;
  loop?: boolean;
  fps?: number;
  frames?: number;
}
export interface GalleryIndex {
  sections: { id: string; title: string; z: number; depth: number; items: { label: string; template: string; model: string; x: number; y: number; z: number; radius: number; height?: number }[] }[];
  anims: { origin?: { x: number; z: number }; swg?: { file: string; categories: { category: string; clips: GalleryClip[] }[] }; jka?: { file: string; categories: { category: string; clips: GalleryClip[] }[] } };
}

/** One mannequin's slot on the grid. */
interface Slot {
  source: 'swg' | 'jka';
  clip: GalleryClip;
  category: string;
  x: number;
  z: number;
  label: THREE.Sprite;
  live: { root: THREE.Object3D; mixer: THREE.AnimationMixer } | null;
}

/** Feet apart on the grid (6 ft), rows apart, and the gap between categories, in metres. */
const SPACING = 1.83;
const ROW = 3;
const PER_ROW = 24;
const CATEGORY_GAP = 6;
/**
 * Mannequins wake within this range of the player and sleep beyond the larger one: a few metres,
 * so only the handful around you animate and the rest of the grid is labels. `__debug.gallery(r)`
 * widens it.
 */
export const RANGE = { wake: 3, sleepMargin: 1.5 };
const MAX_LIVE = 360;

/** A text label as a sprite: white on a dark pill, sized in metres. */
export function makeLabel(text: string, height = 0.3, bold = false): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = `${bold ? 'bold ' : ''}40px sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 32;
  canvas.width = Math.max(64, w);
  canvas.height = 56;
  ctx.font = font;
  ctx.fillStyle = 'rgba(10, 14, 20, 0.72)';
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, 14);
  ctx.fill();
  ctx.fillStyle = bold ? '#ffd27a' : '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 16, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
  sprite.scale.set((height * canvas.width) / canvas.height, height, 1);
  sprite.frustumCulled = true;
  return sprite;
}

export class Gallery {
  readonly group = new THREE.Group();
  private readonly slots: Slot[] = [];
  private readonly models = new Map<'swg' | 'jka', { scene: THREE.Group; clips: Map<string, THREE.AnimationClip> } | 'loading' | 'failed'>();
  private index: GalleryIndex | null = null;
  private live = 0;
  private readonly heightAt: (x: number, z: number) => number;
  /** How the layout's SWG coordinates map into the world: mirrored in x about the centre. */
  private readonly center: { x: number; z: number };

  constructor(private readonly scene: THREE.Scene, private readonly baseUrl: string, center: { x: number; z: number }, heightAt: (x: number, z: number) => number) {
    this.center = center;
    this.heightAt = heightAt;
    scene.add(this.group);
    markActor(this.group);
  }

  /** Read gallery.json and stand every label; the mannequins wake as the player nears them. */
  async load(): Promise<GalleryIndex | null> {
    try {
      const res = await fetch(`${this.baseUrl}gallery.json`);
      if (!res.ok) return null;
      this.index = (await res.json()) as GalleryIndex;
    } catch (err) {
      console.warn('gallery: no gallery.json', err);
      return null;
    }
    const idx = this.index;
    for (const s of idx.sections) {
      const head = makeLabel(s.title, 1.2, true);
      const gx = this.gx(0);
      const gz = this.gz(s.z);
      head.position.set(gx - 4, this.heightAt(gx, gz) + 4, gz - 4);
      this.group.add(head);
      for (const it of s.items) {
        const label = makeLabel(it.label, 0.35);
        const x = this.gx(it.x);
        const z = this.gz(it.z);
        label.position.set(x, this.heightAt(x, z) + it.y + (it.height ?? 2) + 0.6, z);
        this.group.add(label);
      }
    }
    // The animation grid: category by category, a row of labels over the slots.
    const origin = idx.anims.origin ?? { x: 0, z: 0 };
    let z = origin.z;
    for (const source of ['swg', 'jka'] as const) {
      const set = idx.anims[source];
      if (!set) continue;
      const title = makeLabel(source === 'swg' ? 'Star Wars Galaxies animations' : 'Jedi Academy animations', 1.4, true);
      const tx = this.gx(origin.x);
      const tz = this.gz(z);
      title.position.set(tx, this.heightAt(tx, tz) + 4.5, tz - 2);
      this.group.add(title);
      z += 4;
      for (const cat of set.categories) {
        const head = makeLabel(`${cat.category} (${cat.clips.length})`, 0.8, true);
        const hx = this.gx(origin.x);
        const hz = this.gz(z);
        head.position.set(hx, this.heightAt(hx, hz) + 3.2, hz - 1.2);
        this.group.add(head);
        cat.clips.forEach((clip, i) => {
          const sx = origin.x + (i % PER_ROW) * SPACING;
          const sz = z + Math.floor(i / PER_ROW) * ROW;
          const x = this.gx(sx);
          const gz = this.gz(sz);
          const label = makeLabel(clip.name, 0.22);
          label.position.set(x, this.heightAt(x, gz) + 2.25, gz);
          this.group.add(label);
          this.slots.push({ source, clip, category: cat.category, x, z: gz, label, live: null });
        });
        z += Math.ceil(cat.clips.length / PER_ROW) * ROW + CATEGORY_GAP;
      }
    }
    console.info(`gallery: ${idx.sections.reduce((n, s) => n + s.items.length, 0)} exhibits in ${idx.sections.length} sections, ${this.slots.length} animation slots`);
    return idx;
  }

  private gx(x: number): number {
    return -(x - this.center.x);
  }

  private gz(z: number): number {
    return z - this.center.z;
  }

  /** Wake the mannequins near the player, put distant ones to sleep, and advance the live ones. */
  update(dt: number, playerPos: THREE.Vector3): void {
    if (!this.slots.length) return;
    for (const s of this.slots) {
      const d = Math.hypot(s.x - playerPos.x, s.z - playerPos.z);
      if (s.live) {
        if (d > RANGE.wake + RANGE.sleepMargin) this.sleep(s);
        else s.live.mixer.update(dt);
      } else if (d < RANGE.wake && this.live < MAX_LIVE) this.wake(s);
    }
  }

  private wake(s: Slot): void {
    const model = this.models.get(s.source);
    if (model === 'failed') return;
    if (!model) {
      this.models.set(s.source, 'loading');
      const file = this.index?.anims[s.source]?.file;
      if (!file) {
        this.models.set(s.source, 'failed');
        return;
      }
      new GLTFLoader()
        .loadAsync(`${this.baseUrl}${file}`)
        .then((gltf) => {
          gltf.scene.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.isMesh) {
              m.castShadow = true;
              m.frustumCulled = false;
            }
          });
          this.models.set(s.source, { scene: gltf.scene, clips: new Map(gltf.animations.map((a) => [a.name, a])) });
          console.info(`gallery: ${s.source} animation model loaded with ${gltf.animations.length} clips`);
        })
        .catch((err) => {
          console.warn(`gallery: ${s.source} animation model failed`, err);
          this.models.set(s.source, 'failed');
        });
      return;
    }
    if (model === 'loading') return;
    const clip = model.clips.get(s.clip.name);
    if (!clip) return;
    const root = cloneSkeleton(model.scene);
    root.position.set(s.x, this.heightAt(s.x, s.z), s.z);
    root.rotation.y = Math.PI;
    this.group.add(root);
    markActor(root);
    const mixer = new THREE.AnimationMixer(root);
    if (s.clip.joints?.length) {
      // Part of the skeleton only (a shot on the arms, a face): the idle underneath, the clip's own joints over it.
      const idle = model.clips.get('idle') ?? [...model.clips.values()].find((c) => /^loop_stand|^idle|^loop_standing/.test(c.name));
      if (idle) mixer.clipAction(idle).setLoop(THREE.LoopRepeat, Infinity).play();
      const own = new Set(s.clip.joints);
      const layer = new THREE.AnimationClip(`layer:${clip.name}`, clip.duration, clip.tracks.filter((t) => own.has(THREE.PropertyBinding.parseTrackName(t.name).nodeName ?? '')));
      mixer.clipAction(layer).setLoop(THREE.LoopRepeat, Infinity).play();
    } else {
      const action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity).play();
    }
    // Spread the phases so a row does not march in step.
    mixer.update(Math.random() * clip.duration);
    s.live = { root, mixer };
    this.live++;
  }

  private sleep(s: Slot): void {
    if (!s.live) return;
    s.live.mixer.stopAllAction();
    this.group.remove(s.live.root);
    s.live = null;
    this.live--;
  }

  /** What is awake, for the console. */
  status(): { slots: number; live: number; range: number; models: Record<string, string> } {
    return { slots: this.slots.length, live: this.live, range: RANGE.wake, models: Object.fromEntries([...this.models.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : 'loaded'])) };
  }

  /** The slot nearest a point: its clip and where it stands. */
  nearest(pos: THREE.Vector3): { source: string; clip: string; category: string; distance: number } | null {
    let best: Slot | null = null;
    let bestD = Infinity;
    for (const s of this.slots) {
      const d = Math.hypot(s.x - pos.x, s.z - pos.z);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best ? { source: best.source, clip: best.clip.name, category: best.category, distance: Number(bestD.toFixed(1)) } : null;
  }

  dispose(): void {
    for (const s of this.slots) this.sleep(s);
    this.slots.length = 0;
    this.group.traverse((o) => {
      const sp = o as THREE.Sprite;
      if (sp.isSprite) {
        sp.material.map?.dispose();
        sp.material.dispose();
      }
    });
    this.scene.remove(this.group);
    this.group.clear();
  }
}
