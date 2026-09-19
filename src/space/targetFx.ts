// The game's own targeting effects on the ship the pilot has picked: the select effect played once
// on it when it is picked (the enemy's when it is hostile), and the bracket that stands on it while
// it is targeted (friendly or enemy), both from ship_target_appearance.iff as the ships pack converted
// them. The bracket is placed at the table's scale, 1 in every retail row: a placement's scale spreads
// an effect's emitters but does not size its quads, so it is placed as authored.
import * as THREE from 'three';
import type { EffectHandle, ParticleEffects } from '../world/particles';
import type { Vehicle } from '../vehicles/vehicle';
import type { CombatData } from './combatData';

/** Play the table's deselect effect when a target is let go (a lightning splash in the retail row, so off). */
export const PLAY_DEACTIVATE = false;
/** Stand the bracket on the target (off drops it, if it reads wrong in the game). */
export const SHOW_BRACKET = true;

const ONE = new THREE.Vector3(1, 1, 1);

export class TargetFx {
  private target: Vehicle | null = null;
  private hostile = false;
  /** Whether the combat file was there at the last select: a target picked before it landed is placed again once it does. */
  private hadData = false;
  private bracket: EffectHandle | null = null;
  /** The one matrix every placement and move is made with. */
  private readonly m = new THREE.Matrix4();

  constructor(private readonly shipFx: ParticleEffects) {}

  /** The target changed (or its standing did): the select effect once on the new one, the bracket moved to it. Null lets go. */
  select(v: Vehicle | null, hostile: boolean, data: CombatData | null): void {
    if (v === this.target && hostile === this.hostile && !!data === this.hadData) return;
    this.hadData = !!data;
    const was = this.target;
    this.removeBracket();
    if (!v && was && PLAY_DEACTIVATE && data?.file.target.deactivate && was.group.parent) {
      this.shipFx.place(data.file.target.deactivate, this.placeOn(was), false, true);
    }
    this.target = v;
    this.hostile = hostile;
    if (!v || !data) return;
    const t = data.file.target;
    const chassis = v.def?.fit?.chassis ?? v.def?.chassis ?? '';
    const over = chassis ? t.overrides[chassis] : undefined;
    const activate = hostile ? (t.activateEnemy ?? t.activate) : t.activate;
    if (activate) this.shipFx.place(activate, this.placeOn(v), false, true);
    if (!SHOW_BRACKET) return;
    const bracket = hostile ? (over?.enemy !== undefined ? over.enemy : t.enemy) : over?.friendly !== undefined ? over.friendly : t.friendly;
    if (bracket) this.bracket = this.shipFx.place(bracket, this.placeOn(v), false, false);
  }

  /** Once a frame: the bracket follows its ship; a ship that has gone takes it with it. Allocates nothing. */
  update(): void {
    const v = this.target;
    if (!v) return;
    if (!v.group.parent) {
      this.clear();
      return;
    }
    if (this.bracket) this.shipFx.move(this.bracket, this.placeOn(v));
  }

  /** Nothing targeted (the world left, the pilot got out). */
  clear(): void {
    this.removeBracket();
    this.target = null;
    this.hostile = false;
  }

  /** What the console says of it. */
  describe(): { target: string | null; hostile: boolean; bracket: boolean } {
    return { target: this.target?.spec.id ?? null, hostile: this.hostile, bracket: !!this.bracket };
  }

  private placeOn(v: Vehicle): THREE.Matrix4 {
    return this.m.compose(v.pos, v.group.quaternion, ONE);
  }

  private removeBracket(): void {
    if (this.bracket) this.shipFx.remove(this.bracket);
    this.bracket = null;
  }
}
