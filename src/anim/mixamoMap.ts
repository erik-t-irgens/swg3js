// The source skeleton's bones onto the game's joints, and which of them have their two rest poses lined up.
//
// The pack's bones carry the source's own names with its prefix taken off (`Hips`, `LeftUpLeg`). The game's biped is
// 53 joints: root > spine1 > spine2 > spine3 > neck > Head, the thighs hung off the root, a clavicle, an arm, a
// forearm, an extra ulna and a wrist a side, two joints each of thumb, index and ring finger, and the face. What the
// map does not name (the ulna, the face, the hand's hold point) keeps its rest pose.
//
// Pure data: the fitter, the node tests and the console read the same tables.

/** The source's bone for each of the game's joints it drives. */
export const SOURCE_TO_JOINT: Readonly<Record<string, string>> = {
  Hips: 'root', Spine: 'spine1', Spine1: 'spine2', Spine2: 'spine3', Neck: 'neck', Head: 'Head',
  LeftShoulder: 'lClav', LeftArm: 'lArm', LeftForeArm: 'lForeArm', LeftHand: 'lWrist',
  LeftHandThumb1: 'lThumb01', LeftHandThumb2: 'lThumb02', LeftHandIndex1: 'lIndex01', LeftHandIndex2: 'lIndex02', LeftHandRing1: 'lRing01', LeftHandRing2: 'lRing02',
  RightShoulder: 'rClav', RightArm: 'rArm', RightForeArm: 'rForeArm', RightHand: 'rWrist',
  RightHandThumb1: 'rThumb01', RightHandThumb2: 'rThumb02', RightHandIndex1: 'rIndex01', RightHandIndex2: 'rIndex02', RightHandRing1: 'rRing01', RightHandRing2: 'rRing02',
  LeftUpLeg: 'lThigh', LeftLeg: 'lShin', LeftFoot: 'lAnkle', LeftToeBase: 'lToe',
  RightUpLeg: 'rThigh', RightLeg: 'rShin', RightFoot: 'rAnkle', RightToeBase: 'rToe',
};

/** Each bone's next joint along its limb: the line a rest alignment is taken along. */
export const SOURCE_CHILD: Readonly<Record<string, string>> = {
  Hips: 'Spine', Spine: 'Spine1', Spine1: 'Spine2', Spine2: 'Neck', Neck: 'Head',
  LeftShoulder: 'LeftArm', LeftArm: 'LeftForeArm', LeftForeArm: 'LeftHand', LeftHand: 'LeftHandIndex1', LeftHandThumb1: 'LeftHandThumb2', LeftHandIndex1: 'LeftHandIndex2', LeftHandRing1: 'LeftHandRing2',
  RightShoulder: 'RightArm', RightArm: 'RightForeArm', RightForeArm: 'RightHand', RightHand: 'RightHandIndex1', RightHandThumb1: 'RightHandThumb2', RightHandIndex1: 'RightHandIndex2', RightHandRing1: 'RightHandRing2',
  LeftUpLeg: 'LeftLeg', LeftLeg: 'LeftFoot', LeftFoot: 'LeftToeBase',
  RightUpLeg: 'RightLeg', RightLeg: 'RightFoot', RightFoot: 'RightToeBase',
};

/**
 * The groups a rest alignment is switched by. A limb is lined up always: a source arm held out in a T lands as an arm
 * held out in a T whatever the game's own rest pose does with its arms. The other three are **not** lined up, and that
 * is the pelvis fix: both rest poses stand upright on flat feet, so a hips, a spine or a foot that takes only the
 * source's turn away from its own rest stays as upright and as flat as the source's is. Lining them up along their
 * next joint instead turned the hips 32 degrees back on the human male, whose root-to-spine line leans 33 degrees
 * forward where the source's stands at one: the hips tipped back, the belly pulled in.
 */
export type AlignGroup = 'limbs' | 'torso' | 'feet' | 'clavicles';

export const ALIGN_GROUP: Readonly<Record<string, AlignGroup>> = (() => {
  const out: Record<string, AlignGroup> = {};
  for (const bone of Object.keys(SOURCE_TO_JOINT)) {
    if (/^(Hips|Spine\d?|Neck|Head)$/.test(bone)) out[bone] = 'torso';
    else if (/Shoulder$/.test(bone)) out[bone] = 'clavicles';
    else if (/(Foot|ToeBase)$/.test(bone)) out[bone] = 'feet';
    else out[bone] = 'limbs';
  }
  return out;
})();

/** Which groups are lined up. The console flips the last three live (`__debug.anim({ align })`); limbs always are. */
export interface AlignFlags {
  torso: boolean;
  feet: boolean;
  clavicles: boolean;
}

/** What ships: only the limbs. */
export const ALIGN_SHIPPED: Readonly<AlignFlags> = Object.freeze({ torso: false, feet: false, clavicles: false });

/** Whether a bone's rest is lined up under these flags. */
export function aligns(bone: string, flags: AlignFlags): boolean {
  const g = ALIGN_GROUP[bone];
  return g === 'limbs' || (g !== undefined && flags[g]);
}
