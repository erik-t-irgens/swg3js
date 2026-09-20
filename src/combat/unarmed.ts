// Bare hands: the game's own brawling clips (unarmed_standing_ready_jab, _punch, _lead_uppercut
// and kin, the kicks among them) or, when the pack lacks them, Jedi Academy's two punches and its
// kicks. The left mouse punches, the right kicks; a hit lands part way into the clip, once per
// blow, on whatever the fist or foot reaches ahead of the chest. Both kits keep one of these and
// run it while their bare-hands toggle is on.
import * as THREE from 'three';
import { combatSounds } from '../audio/combatSounds';
import type { Hittable, KitContext } from './kit';
import { sweepCapsule } from './sweep';

/** Clips tried in order for a punch and for a kick: the game's first, then Jedi Academy's. */
const PUNCHES = ['unarmed_standing_ready_jab', 'unarmed_standing_ready_punch', 'unarmed_standing_ready_rear_punch', 'unarmed_standing_ready_lead_uppercut', 'unarmed_standing_ready_lead_handhook', 'unarmed_standing_ready_jab_double', 'unarmed_standing_ready_hammerfist', 'BOTH_MELEE1', 'BOTH_MELEE2'];
const KICKS = ['unarmed_standing_ready_lead_frontkick', 'unarmed_standing_ready_rear_roundhouse_kic', 'unarmed_standing_ready_lead_sidekick', 'unarmed_standing_ready_spn_roundhouse_kic', 'unarmed_standing_ready_rear_frontkick', 'BOTH_A7_KICK_F'];
/** How a blow hurts and shoves, and how far it reaches from the chest. */
export const BLOWS = {
  punch: { damage: 12, push: 3, reach: 1.6, radius: 0.4 },
  kick: { damage: 18, push: 8, reach: 1.9, radius: 0.45 },
};
/** A stand-in length for a blow when the rig has no clip for it. */
const FALLBACK_TIME = 0.55;

const a = new THREE.Vector3();
const b = new THREE.Vector3();

export class Unarmed {
  /** The blow under way: its clip's length, how far in it is, and whether its hit has landed. */
  private blow: { kind: 'punch' | 'kick'; duration: number; at: number; landed: boolean } | null = null;
  private next = { punch: 0, kick: 0 };
  private readonly hit = new Set<Hittable>();

  /** True while a blow is under way. */
  get busy(): boolean {
    return this.blow !== null;
  }

  /** Run the brawl for a frame: the buttons start blows, a blow lands part way through. */
  update(ctx: KitContext): void {
    const { dt, input, player, effects } = ctx;
    const onFoot = !player.mounted && !player.eva && !player.swimming;
    if (this.blow) {
      this.blow.at += dt;
      const t = this.blow.at / this.blow.duration;
      // The fist is out through the middle third of the clip.
      if (!this.blow.landed && t >= 0.3) {
        this.blow.landed = true;
        const spec = BLOWS[this.blow.kind];
        a.copy(player.pos).y += 1.1;
        b.set(a.x + Math.sin(player.heading) * spec.reach, a.y - (this.blow.kind === 'kick' ? 0.3 : 0), a.z + Math.cos(player.heading) * spec.reach);
        this.hit.clear();
        const n = sweepCapsule(ctx, a, b, spec.radius, spec.damage, this.hit, spec.push, 0xffd0a0);
        // Where the fist or the boot arrived, when it arrived on something.
        if (n) {
          combatSounds.melee(null, true, b.x, b.y, b.z);
          effects.flash(b, 0xffd0a0, 6, 5, 0.1);
        }
      }
      if (t >= 1) this.blow = null;
    }
    if (!onFoot || this.blow) return;
    const punch = input.pressedAction('attack') || input.held('attack');
    const kick = input.pressedAction('altAttack');
    if (!punch && !kick) return;
    this.start(ctx, kick ? 'kick' : 'punch');
  }

  /** Start a blow: the next clip of its kind the rig has, played whole-body over whatever the legs do. */
  private start(ctx: KitContext, kind: 'punch' | 'kick'): void {
    const rig = ctx.player.rig;
    const list = (kind === 'kick' ? KICKS : PUNCHES).filter((c) => rig?.has(c));
    let duration = FALLBACK_TIME;
    if (rig && list.length) {
      const clip = list[this.next[kind] % list.length];
      this.next[kind]++;
      const d = rig.clipDuration(clip);
      // Jedi Academy's punches are long clips with the blow early; the game's are the blow itself.
      duration = d ? Math.min(d, 1.1) : FALLBACK_TIME;
      rig.play(clip, { fadeIn: 0.06, upperOnly: kind === 'punch' && ctx.player.moving });
    }
    // The swing itself, from the melee table's bare-hands row, where the player stands.
    const at = ctx.player.worldPos;
    combatSounds.melee(null, false, at.x, at.y + 1.2, at.z);
    this.blow = { kind, duration, at: 0, landed: false };
  }

  /** A blow interrupted (the toggle off, a mount): forget it. */
  reset(): void {
    this.blow = null;
  }
}
