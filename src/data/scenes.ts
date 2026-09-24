// The places the character creator and the selection screen stand a character in: where the figure
// stands, where the camera stands, and at what hour.
//
// **Every one of these is the owner's own choice, made by eye and captured in the running game**
// with `__debug.capture`. Nothing here was read out of the archives and nothing here is the
// client's: a coordinate is where somebody decided to stand, and the composition -- how far behind
// the shoulder, how much sky, which way the light falls -- is the whole of the authorship. They
// live in the repo for the same reason `src/data/galaxy.ts` does, because without them the game
// cannot be built by anybody, and unlike a converted pack they are a handful of numbers a person
// typed by standing somewhere and liking the view.
//
// **Most of these are the same place at a different hour.** The 67 captures are 15 places and 17
// compositions, and at 13 of those places the stand and the camera are identical to the centimetre
// across every hour of it -- so a place is one camera and a list of hours, and turning the time of
// day in the creator moves the world's own clock rather than picking a different place. The two
// places that are not
// one composition are recorded rather than tidied away: Theed has a second standing spot of its
// own, and the earliest Lars Homestead capture sits a few centimetres from the other three.
//
// The hours are the game's own clock, 0 to 24, and they are **not** evenly spread: the owner chose
// them by looking. A run of five between six and ten in the morning and nothing at all between
// fifteen and seventeen is what a sky that is worth seeing really looks like on these worlds.

import type { ScenePose, SceneShot } from '../world/sceneCapture.ts';

/**
 * Every capture, in the order they were taken, exactly as the game wrote them. Nothing is
 * collapsed or rounded here: `sceneSpots` groups them itself, so a capture that turns out to
 * differ from its neighbours by a few centimetres is kept rather than silently folded into them.
 */
export const SCENE_SHOTS: readonly SceneShot[] = [
  // ---- Naboo: the Theed overlook, and one alternative standing spot -------------------------
  { name: 'theed-overlook-earlymorning', pack: 'naboo', place: null, space: false, stand: { x: 11801.72, y: 11.69, z: -2074.46, heading: 90.3 }, camera: { x: 11805.22, y: 13.37, z: -2074.35, look: { x: 11801.34, y: 13.17, z: -2074.48 }, fov: 62 }, hour: 7.26, ship: { x: 11798.91, y: 12.13, z: -2085.54, heading: 6.7 } },
  { name: 'theed-overlook-midmorning', pack: 'naboo', place: null, space: false, stand: { x: 11801.72, y: 11.69, z: -2074.46, heading: 90.3 }, camera: { x: 11805.22, y: 13.37, z: -2074.35, look: { x: 11801.34, y: 13.17, z: -2074.48 }, fov: 62 }, hour: 7.91, ship: { x: 11798.91, y: 12.13, z: -2085.54, heading: 6.7 } },
  { name: 'theed-overlook-latemorning', pack: 'naboo', place: null, space: false, stand: { x: 11801.72, y: 11.69, z: -2074.46, heading: 90.3 }, camera: { x: 11805.22, y: 13.37, z: -2074.35, look: { x: 11801.34, y: 13.17, z: -2074.48 }, fov: 62 }, hour: 9.73, ship: { x: 11798.91, y: 12.13, z: -2085.54, heading: 6.7 } },
  { name: 'theed-overlook-midday', pack: 'naboo', place: null, space: false, stand: { x: 11801.72, y: 11.69, z: -2074.46, heading: 90.3 }, camera: { x: 11805.22, y: 13.37, z: -2074.35, look: { x: 11801.34, y: 13.17, z: -2074.48 }, fov: 62 }, hour: 15.19, ship: { x: 11798.91, y: 12.13, z: -2085.54, heading: 6.7 } },
  { name: 'theed-overlook-afternoon', pack: 'naboo', place: null, space: false, stand: { x: 11801.72, y: 11.69, z: -2074.46, heading: 90.3 }, camera: { x: 11805.22, y: 13.37, z: -2074.35, look: { x: 11801.34, y: 13.17, z: -2074.48 }, fov: 62 }, hour: 19.2, ship: { x: 11798.91, y: 12.13, z: -2085.54, heading: 6.7 } },
  // The owner's own note on this one: a second standing spot, and an hour they kept as an example
  // of light that does *not* work. Kept for exactly that -- it is the control.
  { name: 'theed-overlook-secondarystandingspotnoship-timeofdaybadexample', pack: 'naboo', place: null, space: false, stand: { x: 11793.88, y: 11.17, z: -2073.25, heading: 107 }, camera: { x: 11796.85, y: 12.95, z: -2073.62, look: { x: 11793.41, y: 12.63, z: -2073.19 }, fov: 62 }, hour: 21.86, ship: null },

  // ---- Tatooine: the Lars Homestead ---------------------------------------------------------
  { name: 'lars-homestead-morning', pack: 'tatooine', place: 'Lars Homestead', space: false, stand: { x: 1194.37, y: 0.04, z: -1929.16, heading: 311.4 }, camera: { x: 1192.17, y: 1.84, z: -1927.49, look: { x: 1194.78, y: 1.48, z: -1929.48 }, fov: 62 }, hour: 8.52, ship: null },
  { name: 'lars-homestead-midday', pack: 'tatooine', place: 'Lars Homestead', space: false, stand: { x: 1194.37, y: 0.04, z: -1929.16, heading: 311.4 }, camera: { x: 1192.04, y: 1.36, z: -1927.65, look: { x: 1194.62, y: 1.56, z: -1929.32 }, fov: 62 }, hour: 11.96, ship: null },
  { name: 'lars-homestead-afternoon', pack: 'tatooine', place: 'Lars Homestead', space: false, stand: { x: 1194.37, y: 0.04, z: -1929.16, heading: 311.4 }, camera: { x: 1192.04, y: 1.36, z: -1927.65, look: { x: 1194.62, y: 1.56, z: -1929.32 }, fov: 62 }, hour: 20.91, ship: null },
  { name: 'lars-homestead-sunseticonic', pack: 'tatooine', place: 'Lars Homestead', space: false, stand: { x: 1194.37, y: 0.04, z: -1929.16, heading: 311.4 }, camera: { x: 1192.04, y: 1.36, z: -1927.65, look: { x: 1194.62, y: 1.56, z: -1929.32 }, fov: 62 }, hour: 22.22, ship: null },

  // ---- Tatooine: the palace, looking out over the bones -------------------------------------
  { name: 'jabbapalace-morning', pack: 'tatooine', place: 'Long Spine Bones', space: false, stand: { x: 3454.63, y: 36.02, z: -2092.11, heading: 281.5 }, camera: { x: 3451.69, y: 37.68, z: -2091.49, look: { x: 3455.04, y: 37.49, z: -2092.2 }, fov: 62 }, hour: 7.08, ship: null },
  { name: 'jabbapalace-latemorning', pack: 'tatooine', place: 'Long Spine Bones', space: false, stand: { x: 3454.63, y: 36.02, z: -2092.11, heading: 281.5 }, camera: { x: 3451.69, y: 37.68, z: -2091.49, look: { x: 3455.04, y: 37.49, z: -2092.2 }, fov: 62 }, hour: 9.69, ship: null },
  { name: 'jabbapalace-midday', pack: 'tatooine', place: 'Long Spine Bones', space: false, stand: { x: 3454.63, y: 36.02, z: -2092.11, heading: 281.5 }, camera: { x: 3451.69, y: 37.68, z: -2091.49, look: { x: 3455.04, y: 37.49, z: -2092.2 }, fov: 62 }, hour: 13.05, ship: null },
  { name: 'jabbapalace-earlyafternoon', pack: 'tatooine', place: 'Long Spine Bones', space: false, stand: { x: 3454.63, y: 36.02, z: -2092.11, heading: 281.5 }, camera: { x: 3451.69, y: 37.68, z: -2091.49, look: { x: 3455.04, y: 37.49, z: -2092.2 }, fov: 62 }, hour: 20.72, ship: null },
  { name: 'jabbapalace-eve', pack: 'tatooine', place: 'Long Spine Bones', space: false, stand: { x: 3454.63, y: 36.02, z: -2092.11, heading: 281.5 }, camera: { x: 3451.69, y: 37.68, z: -2091.49, look: { x: 3455.04, y: 37.49, z: -2092.2 }, fov: 62 }, hour: 22.1, ship: null },

  // ---- Corellia: Tyrena ---------------------------------------------------------------------
  { name: 'tyrena-morning', pack: 'corellia', place: null, space: false, stand: { x: 4732.58, y: 3.62, z: 2022.24, heading: 264.1 }, camera: { x: 4729.35, y: 5.09, z: 2021.91, look: { x: 4732.89, y: 5.12, z: 2022.27 }, fov: 62 }, hour: 6.63, ship: null },
  { name: 'tyrena-latemorning', pack: 'corellia', place: null, space: false, stand: { x: 4732.58, y: 3.62, z: 2022.24, heading: 264.1 }, camera: { x: 4729.35, y: 5.09, z: 2021.91, look: { x: 4732.89, y: 5.12, z: 2022.27 }, fov: 62 }, hour: 7.14, ship: null },
  { name: 'tyrena-midday', pack: 'corellia', place: null, space: false, stand: { x: 4732.58, y: 3.62, z: 2022.24, heading: 264.1 }, camera: { x: 4729.35, y: 5.09, z: 2021.91, look: { x: 4732.89, y: 5.12, z: 2022.27 }, fov: 62 }, hour: 10.93, ship: null },
  { name: 'tyrena-afternoon', pack: 'corellia', place: null, space: false, stand: { x: 4732.58, y: 3.62, z: 2022.24, heading: 264.1 }, camera: { x: 4729.35, y: 5.09, z: 2021.91, look: { x: 4732.89, y: 5.12, z: 2022.27 }, fov: 62 }, hour: 19.78, ship: null },
  { name: 'tyrena-lateafternoon', pack: 'corellia', place: null, space: false, stand: { x: 4732.58, y: 3.62, z: 2022.24, heading: 264.1 }, camera: { x: 4729.35, y: 5.09, z: 2021.91, look: { x: 4732.89, y: 5.12, z: 2022.27 }, fov: 62 }, hour: 21.24, ship: null },
  { name: 'tyrena-sunset', pack: 'corellia', place: null, space: false, stand: { x: 4732.58, y: 3.62, z: 2022.24, heading: 264.1 }, camera: { x: 4729.35, y: 5.09, z: 2021.91, look: { x: 4732.89, y: 5.12, z: 2022.27 }, fov: 62 }, hour: 22.03, ship: null },

  // ---- Corellia: the Agrilat swamp, with the city behind it ---------------------------------
  { name: 'agrilatswamp-sunrise', pack: 'corellia', place: 'Agrilat Swamp', space: false, stand: { x: -622.04, y: 48.57, z: 9199.39, heading: 122.2 }, camera: { x: -619.22, y: 50.34, z: 9197.82, look: { x: -622.43, y: 50.03, z: 9199.6 }, fov: 62 }, hour: 6.57, ship: null },
  { name: 'agrilatswamp-midmorning', pack: 'corellia', place: 'Agrilat Swamp', space: false, stand: { x: -622.04, y: 48.57, z: 9199.39, heading: 122.2 }, camera: { x: -619.22, y: 50.34, z: 9197.82, look: { x: -622.43, y: 50.03, z: 9199.6 }, fov: 62 }, hour: 7.67, ship: null },
  { name: 'agrilatswamp-midday', pack: 'corellia', place: 'Agrilat Swamp', space: false, stand: { x: -622.04, y: 48.57, z: 9199.39, heading: 122.2 }, camera: { x: -619.22, y: 50.34, z: 9197.82, look: { x: -622.43, y: 50.03, z: 9199.6 }, fov: 62 }, hour: 11.25, ship: null },
  { name: 'agrilatswamp-afternoon', pack: 'corellia', place: 'Agrilat Swamp', space: false, stand: { x: -622.04, y: 48.57, z: 9199.39, heading: 122.2 }, camera: { x: -619.22, y: 50.34, z: 9197.82, look: { x: -622.43, y: 50.03, z: 9199.6 }, fov: 62 }, hour: 16.93, ship: null },
  { name: 'agrilatswamp-sunset', pack: 'corellia', place: 'Agrilat Swamp', space: false, stand: { x: -622.04, y: 48.57, z: 9199.39, heading: 122.2 }, camera: { x: -619.22, y: 50.34, z: 9197.82, look: { x: -622.43, y: 50.03, z: 9199.6 }, fov: 62 }, hour: 20.37, ship: null },

  // ---- Rori: the swamp by the Gungan camp ---------------------------------------------------
  { name: 'rori-swamp-sunrise', pack: 'rori', place: 'Gungan Camp', space: false, stand: { x: 5711.44, y: 75.59, z: 9675.64, heading: 251.9 }, camera: { x: 5708.87, y: 77.37, z: 9674.59, look: { x: 5711.9, y: 77.04, z: 9675.83 }, fov: 62 }, hour: 6.08, ship: null },
  { name: 'rori-swamp-sunriselater', pack: 'rori', place: 'Gungan Camp', space: false, stand: { x: 5711.44, y: 75.59, z: 9675.64, heading: 251.9 }, camera: { x: 5708.87, y: 77.37, z: 9674.59, look: { x: 5711.9, y: 77.04, z: 9675.83 }, fov: 62 }, hour: 6.53, ship: null },
  { name: 'rori-swamp-morning', pack: 'rori', place: 'Gungan Camp', space: false, stand: { x: 5711.44, y: 75.59, z: 9675.64, heading: 251.9 }, camera: { x: 5708.87, y: 77.37, z: 9674.59, look: { x: 5711.9, y: 77.04, z: 9675.83 }, fov: 62 }, hour: 7.3, ship: null },
  { name: 'rori-swamp-latemorning', pack: 'rori', place: 'Gungan Camp', space: false, stand: { x: 5711.44, y: 75.59, z: 9675.64, heading: 251.9 }, camera: { x: 5708.87, y: 77.37, z: 9674.59, look: { x: 5711.9, y: 77.04, z: 9675.83 }, fov: 62 }, hour: 8.12, ship: null },
  { name: 'rori-swamp-midday', pack: 'rori', place: 'Gungan Camp', space: false, stand: { x: 5711.44, y: 75.59, z: 9675.64, heading: 251.9 }, camera: { x: 5708.87, y: 77.37, z: 9674.59, look: { x: 5711.9, y: 77.04, z: 9675.83 }, fov: 62 }, hour: 10.86, ship: null },
  { name: 'rori-swamp-afternoon', pack: 'rori', place: 'Gungan Camp', space: false, stand: { x: 5711.44, y: 75.59, z: 9675.64, heading: 251.9 }, camera: { x: 5708.87, y: 77.37, z: 9674.59, look: { x: 5711.9, y: 77.04, z: 9675.83 }, fov: 62 }, hour: 18.4, ship: null },
  { name: 'rori-swamp-afternoon-late', pack: 'rori', place: 'Gungan Camp', space: false, stand: { x: 5711.44, y: 75.59, z: 9675.64, heading: 251.9 }, camera: { x: 5708.87, y: 77.37, z: 9674.59, look: { x: 5711.9, y: 77.04, z: 9675.83 }, fov: 62 }, hour: 20.14, ship: null },
  { name: 'rori-swamp-sunsetbeautiful', pack: 'rori', place: 'Gungan Camp', space: false, stand: { x: 5711.44, y: 75.59, z: 9675.64, heading: 251.9 }, camera: { x: 5708.87, y: 77.37, z: 9674.59, look: { x: 5711.9, y: 77.04, z: 9675.83 }, fov: 62 }, hour: 21.15, ship: null },

  // ---- Lok: the stronghold starport ---------------------------------------------------------
  { name: 'lok-nyms-sunrise', pack: 'lok', place: "Nym's Stronghold Starport", space: false, stand: { x: 29.26, y: 1.32, z: -62.77, heading: 308.6 }, camera: { x: 26.9, y: 2.82, z: -60.9, look: { x: 29.53, y: 2.82, z: -62.99 }, fov: 62 }, hour: 6.61, ship: null },
  { name: 'lok-nyms-morning', pack: 'lok', place: "Nym's Stronghold Starport", space: false, stand: { x: 29.26, y: 1.32, z: -62.77, heading: 308.6 }, camera: { x: 26.9, y: 2.82, z: -60.9, look: { x: 29.53, y: 2.82, z: -62.99 }, fov: 62 }, hour: 7.4, ship: null },
  { name: 'lok-nyms-midday', pack: 'lok', place: "Nym's Stronghold Starport", space: false, stand: { x: 29.26, y: 1.32, z: -62.77, heading: 308.6 }, camera: { x: 26.9, y: 2.82, z: -60.9, look: { x: 29.53, y: 2.82, z: -62.99 }, fov: 62 }, hour: 11.68, ship: null },
  { name: 'lok-nyms-afternoon', pack: 'lok', place: "Nym's Stronghold Starport", space: false, stand: { x: 29.26, y: 1.32, z: -62.77, heading: 308.6 }, camera: { x: 26.9, y: 2.82, z: -60.9, look: { x: 29.53, y: 2.82, z: -62.99 }, fov: 62 }, hour: 17.89, ship: null },
  { name: 'lok-nyms-sunset', pack: 'lok', place: "Nym's Stronghold Starport", space: false, stand: { x: 29.26, y: 1.32, z: -62.77, heading: 308.6 }, camera: { x: 26.9, y: 2.82, z: -60.9, look: { x: 29.53, y: 2.82, z: -62.99 }, fov: 62 }, hour: 21.14, ship: null },

  // ---- Mustafar: the one hour that works there ----------------------------------------------
  { name: 'mustafar', pack: 'mustafar', place: 'Mensix Mining Facility', space: false, stand: { x: -2903.78, y: 225.01, z: -4409.28, heading: 75.7 }, camera: { x: -2900.94, y: 226.48, z: -4408.32, look: { x: -2904.11, y: 226.51, z: -4409.39 }, fov: 62 }, hour: 13.5, ship: null },

  // ---- Endor: the tree village --------------------------------------------------------------
  { name: 'endor-treevillage-sunrise', pack: 'endor', place: 'Ewok Tree Village', space: false, stand: { x: -5469.35, y: 20.95, z: -3890.58, heading: 53.9 }, camera: { x: -5467.28, y: 22.49, z: -3889.06, look: { x: -5469.7, y: 22.45, z: -3890.83 }, fov: 62 }, hour: 7.63, ship: null },
  { name: 'endor-treevillage-morning', pack: 'endor', place: 'Ewok Tree Village', space: false, stand: { x: -5469.35, y: 20.95, z: -3890.58, heading: 53.9 }, camera: { x: -5467.28, y: 22.49, z: -3889.06, look: { x: -5469.7, y: 22.45, z: -3890.83 }, fov: 62 }, hour: 9.05, ship: null },
  { name: 'endor-treevillage-midday', pack: 'endor', place: 'Ewok Tree Village', space: false, stand: { x: -5469.35, y: 20.95, z: -3890.58, heading: 53.9 }, camera: { x: -5467.28, y: 22.49, z: -3889.06, look: { x: -5469.7, y: 22.45, z: -3890.83 }, fov: 62 }, hour: 11.98, ship: null },
  { name: 'endor-treevillage-afternoon', pack: 'endor', place: 'Ewok Tree Village', space: false, stand: { x: -5469.35, y: 20.95, z: -3890.58, heading: 53.9 }, camera: { x: -5467.28, y: 22.49, z: -3889.06, look: { x: -5469.7, y: 22.45, z: -3890.83 }, fov: 62 }, hour: 17.71, ship: null },
  { name: 'endor-treevillage-sunset', pack: 'endor', place: 'Ewok Tree Village', space: false, stand: { x: -5469.35, y: 20.95, z: -3890.58, heading: 53.9 }, camera: { x: -5467.28, y: 22.49, z: -3889.06, look: { x: -5469.7, y: 22.45, z: -3890.83 }, fov: 62 }, hour: 20.23, ship: null },

  // ---- Endor: the lake village --------------------------------------------------------------
  { name: 'endor-lakevillage-sunrise', pack: 'endor', place: 'Ewok Lake Village', space: false, stand: { x: -327.06, y: 0.72, z: -6563.38, heading: 67.2 }, camera: { x: -324.87, y: 2.28, z: -6562.45, look: { x: -327.48, y: 2.21, z: -6563.56 }, fov: 62 }, hour: 6.92, ship: null },
  { name: 'endor-lakevillage-morning', pack: 'endor', place: 'Ewok Lake Village', space: false, stand: { x: -327.06, y: 0.72, z: -6563.38, heading: 67.2 }, camera: { x: -324.87, y: 2.28, z: -6562.45, look: { x: -327.48, y: 2.21, z: -6563.56 }, fov: 62 }, hour: 8.54, ship: null },
  { name: 'endor-lakevillage-midday', pack: 'endor', place: 'Ewok Lake Village', space: false, stand: { x: -327.06, y: 0.72, z: -6563.38, heading: 67.2 }, camera: { x: -324.87, y: 2.28, z: -6562.45, look: { x: -327.48, y: 2.21, z: -6563.56 }, fov: 62 }, hour: 13.24, ship: null },
  { name: 'endor-lakevillage-afternoon', pack: 'endor', place: 'Ewok Lake Village', space: false, stand: { x: -327.06, y: 0.72, z: -6563.38, heading: 67.2 }, camera: { x: -324.87, y: 2.28, z: -6562.45, look: { x: -327.48, y: 2.21, z: -6563.56 }, fov: 62 }, hour: 17.69, ship: null },
  { name: 'endor-lakevillage-sunset', pack: 'endor', place: 'Ewok Lake Village', space: false, stand: { x: -327.06, y: 0.72, z: -6563.38, heading: 67.2 }, camera: { x: -324.87, y: 2.28, z: -6562.45, look: { x: -327.48, y: 2.21, z: -6563.56 }, fov: 62 }, hour: 19.61, ship: null },

  // ---- Talus: the shuttleport ---------------------------------------------------------------
  { name: 'talus-dearic-sunrise', pack: 'talus', place: 'Shuttleport (1273, -3072)', space: false, stand: { x: -1028.57, y: 10.07, z: 209.73, heading: 283.4 }, camera: { x: -1031.28, y: 11.68, z: 210.35, look: { x: -1028.15, y: 11.55, z: 209.63 }, fov: 62 }, hour: 7.17, ship: null },
  { name: 'talus-dearic-morning', pack: 'talus', place: 'Shuttleport (1273, -3072)', space: false, stand: { x: -1028.57, y: 10.07, z: 209.73, heading: 283.4 }, camera: { x: -1031.28, y: 11.68, z: 210.35, look: { x: -1028.15, y: 11.55, z: 209.63 }, fov: 62 }, hour: 10.27, ship: null },
  { name: 'talus-dearic-midday', pack: 'talus', place: 'Shuttleport (1273, -3072)', space: false, stand: { x: -1028.57, y: 10.07, z: 209.73, heading: 283.4 }, camera: { x: -1031.28, y: 11.68, z: 210.35, look: { x: -1028.15, y: 11.55, z: 209.63 }, fov: 62 }, hour: 14.26, ship: null },
  { name: 'talus-dearic-afternoon', pack: 'talus', place: 'Shuttleport (1273, -3072)', space: false, stand: { x: -1028.57, y: 10.07, z: 209.73, heading: 283.4 }, camera: { x: -1031.28, y: 11.68, z: 210.35, look: { x: -1028.15, y: 11.55, z: 209.63 }, fov: 62 }, hour: 19.5, ship: null },
  { name: 'talus-dearic-sunset', pack: 'talus', place: 'Shuttleport (1273, -3072)', space: false, stand: { x: -1028.57, y: 10.07, z: 209.73, heading: 283.4 }, camera: { x: -1031.28, y: 11.68, z: 210.35, look: { x: -1028.15, y: 11.55, z: 209.63 }, fov: 62 }, hour: 22.22, ship: null },

  // ---- Yavin 4: the one hour --------------------------------------------------------------
  { name: 'yavin4-only', pack: 'yavin4', place: 'Blueleaf Temple', space: false, stand: { x: 4730.19, y: 102.21, z: 4184.79, heading: 300.5 }, camera: { x: 4727.85, y: 103.62, z: 4186.28, look: { x: 4730.48, y: 103.72, z: 4184.61 }, fov: 62 }, hour: 19.65, ship: null },

  // ---- Dathomir: the stronghold -------------------------------------------------------------
  { name: 'dathomir-sunrise', pack: 'dathomir', place: 'Nightsister Stronghold', space: false, stand: { x: 3889.72, y: 123.94, z: 1570.46, heading: 282 }, camera: { x: 3886.55, y: 125.47, z: 1571.13, look: { x: 3890.05, y: 125.44, z: 1570.38 }, fov: 62 }, hour: 6.71, ship: null },
  { name: 'dathomir-morning', pack: 'dathomir', place: 'Nightsister Stronghold', space: false, stand: { x: 3889.72, y: 123.94, z: 1570.46, heading: 282 }, camera: { x: 3886.55, y: 125.47, z: 1571.13, look: { x: 3890.05, y: 125.44, z: 1570.38 }, fov: 62 }, hour: 9.6, ship: null },
  { name: 'dathomir-midday', pack: 'dathomir', place: 'Nightsister Stronghold', space: false, stand: { x: 3889.72, y: 123.94, z: 1570.46, heading: 282 }, camera: { x: 3886.55, y: 125.47, z: 1571.13, look: { x: 3890.05, y: 125.44, z: 1570.38 }, fov: 62 }, hour: 12.9, ship: null },
  { name: 'dathomir-afternoon', pack: 'dathomir', place: 'Nightsister Stronghold', space: false, stand: { x: 3889.72, y: 123.94, z: 1570.46, heading: 282 }, camera: { x: 3886.55, y: 125.47, z: 1571.13, look: { x: 3890.05, y: 125.44, z: 1570.38 }, fov: 62 }, hour: 18.17, ship: null },
  { name: 'dathomir-sunset', pack: 'dathomir', place: 'Nightsister Stronghold', space: false, stand: { x: 3889.72, y: 123.94, z: 1570.46, heading: 282 }, camera: { x: 3886.55, y: 125.47, z: 1571.13, look: { x: 3890.05, y: 125.44, z: 1570.38 }, fov: 62 }, hour: 21.58, ship: null },

  // ---- Dantooine: the temple ----------------------------------------------------------------
  { name: 'dantooine-temple-sunrise', pack: 'dantooine', place: 'Jedi Temple', space: false, stand: { x: -8456.81, y: 8.04, z: 7591.91, heading: 298.4 }, camera: { x: -8459.24, y: 9.63, z: 7593.25, look: { x: -8456.44, y: 9.53, z: 7591.7 }, fov: 62 }, hour: 7.73, ship: null },
  { name: 'dantooine-temple-morning', pack: 'dantooine', place: 'Jedi Temple', space: false, stand: { x: -8456.81, y: 8.04, z: 7591.91, heading: 298.4 }, camera: { x: -8459.24, y: 9.63, z: 7593.25, look: { x: -8456.44, y: 9.53, z: 7591.7 }, fov: 62 }, hour: 10.45, ship: null },
  { name: 'dantooine-temple-midday', pack: 'dantooine', place: 'Jedi Temple', space: false, stand: { x: -8456.81, y: 8.04, z: 7591.91, heading: 298.4 }, camera: { x: -8459.24, y: 9.63, z: 7593.25, look: { x: -8456.44, y: 9.53, z: 7591.7 }, fov: 62 }, hour: 12.84, ship: null },
  { name: 'dantooine-temple-afternoon', pack: 'dantooine', place: 'Jedi Temple', space: false, stand: { x: -8456.81, y: 8.04, z: 7591.91, heading: 298.4 }, camera: { x: -8459.24, y: 9.63, z: 7593.25, look: { x: -8456.44, y: 9.53, z: 7591.7 }, fov: 62 }, hour: 19.21, ship: null },
  { name: 'dantooine-temple-sunset', pack: 'dantooine', place: 'Jedi Temple', space: false, stand: { x: -8456.81, y: 8.04, z: 7591.91, heading: 298.4 }, camera: { x: -8459.24, y: 9.63, z: 7593.25, look: { x: -8456.44, y: 9.53, z: 7591.7 }, fov: 62 }, hour: 21.37, ship: null },

  // ---- Kashyyyk: the starport ---------------------------------------------------------------
  { name: 'kashyyyk-only', pack: 'kashyyyk_main', place: 'Kachirho Starport', space: false, stand: { x: -53.88, y: 44.35, z: -35.85, heading: 158.3 }, camera: { x: -53.06, y: 45.89, z: -37.9, look: { x: -54.06, y: 45.85, z: -35.4 }, fov: 62 }, hour: 17.4, ship: null },
];

/**
 * Where the ship stands in each place, keyed by the shot's own key.
 *
 * A table apart from the captures above, and it is worth saying why. The owner parked a ship in
 * shot at **every** place, but the capture asked `nearestVehicle` for it -- the test for what the
 * player could climb into, 3.6 m from the hull's skin -- so sixty-six of the sixty-seven recorded
 * nothing, and only Theed got through because that test subtracts the hull's radius and a big hull
 * has enough of one to cover the difference. The capture now asks what is in front of the camera
 * instead, but the shots already taken cannot be mended after the fact: the ship was somewhere and
 * nothing wrote it down.
 *
 * Rather than have the owner stand in sixty-seven places again for a field that is the same at
 * every hour of one place, `__debug.captureShip('<key>')` records one line here per place. A key
 * with no row simply has no ship, which is what every place has today.
 */
export const SCENE_SHIPS: Readonly<Record<string, ScenePose>> = {
  'theed-overlook': { x: 11789.62, y: 12.41, z: -2092.28, heading: 43.3 },
  'lars-homestead': { x: 1215.26, y: 0.06, z: -1969.68, heading: 308.5 },
  // The owner's own call: the second Lars composition stands 20 cm from the first, so one ship
  // suits both and they asked for it rather than walking out there twice.
  'lars-homestead-2': { x: 1215.26, y: 0.06, z: -1969.68, heading: 308.5 },
  jabbapalace: { x: 3503.71, y: 32.14, z: -2074.63, heading: 273 },
  tyrena: { x: 4787.59, y: 0.54, z: 2005.39, heading: 297.1 },
  agrilatswamp: { x: -625.02, y: 48.98, z: 9223.16, heading: 170.4 },
  'rori-swamp': { x: 5769.26, y: 76.13, z: 9658.79, heading: 292.2 },
  'lok-nyms': { x: 68.06, y: 1.7, z: -60.61, heading: 323.1 },
  mustafar: { x: -2952.6, y: 230.11, z: -4443.24, heading: 45.3 },
  'endor-treevillage': { x: -5508.48, y: 20.05, z: -3890.22, heading: 92.1 },
  'endor-lakevillage': { x: -346.26, y: 0.7, z: -6562.74, heading: 139.7 },
  'talus-dearic': { x: -995.06, y: 10.07, z: 169.31, heading: 350 },
  yavin4: { x: 4806.28, y: 84.81, z: 4172.15, heading: 270 },
  dathomir: { x: 3930.61, y: 127.58, z: 1578.69, heading: 236.3 },
  'dantooine-temple': { x: -8413.89, y: 9.04, z: 7581.4, heading: 261.3 },
  kashyyyk: { x: -43.84, y: 44.06, z: -15.81, heading: 201.5 },
  // Sixteen of the seventeen. The one with no row is the owner's control shot, whose own name says
  // it has no ship in it, so its absence here is the record agreeing with itself.
};

/** A spot: one composition, with every hour the owner captured of it. */
export interface SceneSpot {
  /** The name of its earliest capture with the hour's label taken off, which is how a spot is keyed. */
  key: string;
  pack: string;
  place: string | null;
  stand: SceneShot['stand'];
  camera: SceneShot['camera'];
  ship: SceneShot['ship'];
  /** Every hour captured here, in the order taken, with the name that hour was given. */
  hours: { name: string; hour: number }[];
}

/**
 * The captures gathered into spots: same world, same standing place and same camera to the
 * centimetre. **Grouped rather than declared**, so a capture that turns out to sit a few
 * centimetres from its neighbours becomes its own spot and says so, instead of being quietly
 * folded into one whose geometry it does not actually share.
 */
export function sceneSpots(shots: readonly SceneShot[] = SCENE_SHOTS): SceneSpot[] {
  const out: SceneSpot[] = [];
  const at = new Map<string, SceneSpot>();
  const taken = new Set<string>();
  for (const s of shots) {
    const c = s.camera;
    const k = [s.pack, s.stand.x, s.stand.y, s.stand.z, s.stand.heading, c.x, c.y, c.z, c.look.x, c.look.y, c.look.z, c.fov].join('|');
    let spot = at.get(k);
    if (!spot) {
      // The hour's own word comes off the first capture's name, which leaves what the owner called
      // the place. Two places can end up with the same word for it, so a key is taken once and the
      // next one that wants it counts up: a key is a file name later and must be its own.
      const base = s.name.replace(/-(sunrise|sunriselater|earlymorning|midmorning|morning|latemorning|midday|earlyafternoon|afternoon|lateafternoon|eve|sunset|only)\b.*$/i, '') || s.name;
      let key = base;
      for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
      taken.add(key);
      spot = { key, pack: s.pack, place: s.place, stand: s.stand, camera: c, ship: s.ship, hours: [] };
      at.set(k, spot);
      out.push(spot);
    }
    // A spot takes the first ship it is given: the owner parked one for the shot, not for the hour.
    if (!spot.ship && s.ship) spot.ship = s.ship;
    spot.hours.push({ name: s.name, hour: s.hour });
  }
  // The ships recorded per place win over anything a capture happened to catch, since a row here
  // was aimed at the shot while a captured one was whatever stood within arm's reach at the time.
  for (const spot of out) {
    const parked = SCENE_SHIPS[spot.key];
    if (parked) spot.ship = parked;
  }
  return out;
}
