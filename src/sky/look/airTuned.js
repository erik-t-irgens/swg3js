// The air tuned per body (the atmosphere brief's wave A, its critic): for each generated twin (by preset id) and each
// placeholder (by its id), the air numbers that differ from its recipe's start (airProfile.js's airStartFor). Each was
// found by measurement on the stage (the lit disc from orbit at noon, CIELAB) against what the body was made to look
// like (his imported picture for a twin of a disc picture, else the colour the Painted form drew, which looks run 2
// matched), held within what reads as real air for its kind (a living world's clear air between half and twice
// Earth's, its haze no nearer than 20 km; a desert's, a volcanic world's and a gas giant's their own), preferring more
// clear air while the colour stays near; then looked at. A body whose painted air was not an Earth-like blue takes that
// colour as its air's own (skyColour). Table defaults only: none of his saved looks reads this. Pure data.

/** Twins, by preset id. */
export const TWIN_AIR = {
  'w3-naboo': {visibilityKm: 50}, // Naboo (twin of his imported Naboo) (living): ΔE 5.0 to its target
  'twin-tatooine': {skyStrength: 0.49, visibilityKm: 155, skyColour: '#ffe4c4'}, // Tatooine (twin of his Tatooine circle) (desert): ΔE 4.9 to its target
  'twin-jakku': {visibilityKm: 99, skyColour: '#ffd8b0'}, // Jakku (twin of his Jakku circle) (desert): ΔE 6.8 to its target
  // (wave B, its critic: the map twins' bakes are matched to his albedo maps, as dark as a sea, so a strong air washed
  // their discs into blue or grey fog balls; each given a lighter air and its surface layer's live brightness and colour
  // strength (TWIN_SURFACE) toward the Painted form's lightness with his map's colour, the bake untouched)
  'twin-jakku-map': {skyStrength: 0.5, visibilityKm: 155, skyColour: '#ffd8b0'}, // (wave B, its critic: was 1.5) // Jakku (twin of his Jakku map) (desert): ΔE 6.7 to its target
  'twin-kessel': {skyStrength: 0.42, visibilityKm: 235, skyColour: '#ffd090'}, // Kessel (twin of his Kessel circle) (desert): ΔE 5.3 to its target
  // (wave B, the air builder: half Earth's clear air, its warm dust doing the rest, with its grade below: ΔE 1.3)
  'twin-geonosis': {skyStrength: 0.5, visibilityKm: 63, skyColour: '#ffb070'}, // Geonosis (twin of his Geonosis circle) (desert): ΔE 11.0 to its target
  'twin-hoth': {skyStrength: 2, visibilityKm: 32, skyColour: '#c8dcff'}, // Hoth (twin of his Hoth circle) (ice): ΔE 4.2 to its target
  'twin-starkiller': {skyStrength: 1.19, visibilityKm: 32}, // Starkiller Base (twin of his circle) (ice): ΔE 5.1 to its target
  'twin-crait': {skyStrength: 1.68, visibilityKm: 94, skyColour: '#dce8ff'}, // Crait (twin of his Crait circle) (flats): ΔE 5.1 to its target
  'twin-endor-giant': {skyStrength: 0.48, skyColour: '#bcd8ff'}, // Endor's gas giant (twin of his picture) (gasgiant): ΔE 5.0 to its target
  'twin-bespin': {skyStrength: 0.14, visibilityKm: 1000, skyColour: '#ffc890'}, // Bespin (twin of his Bespin circle) (gasgiant): ΔE 7.8 to its target
  'twin-bespin-map': {skyStrength: 0.08, visibilityKm: 1000, skyColour: '#ffc890'}, // Bespin (twin of his Bespin map) (gasgiant): ΔE 5.0 to its target
  'twin-yavin-prime': {skyStrength: 0.13, visibilityKm: 1000, skyColour: '#ff9a70'}, // Yavin Prime (twin of his painted Yavin Prime) (gasgiant): ΔE 5.0 to its target
  // (wave B, the parts builder: re-graded with its grey cloud deck; a clearer, greyer air, so the deck is grey and not a blue fog ball: ΔE 1.4)
  'twin-resurgent': {skyStrength: 0.8, visibilityKm: 60, skyColour: '#b4bccc'}, // The Resurgent's planet (twin of his picture) (volcanic): ΔE 23.2 to its target; then by eye: the nearest colour (5 km of haze) was a featureless fog ball, so a moderate haze is kept and the colour left to wave B
  // (wave B, the air builder: its lava under a dark, absorbing grey-brown ash, its haze's own colour, where its red air lay
  // as a pink fog; a thin, near-neutral clear air above it. Chosen by eye among five, the disc L 26 against his map's 20)
  // (wave B, its critic: the ash a little thinner, 45 km, so the lava's red reads through it as on his map)
  'twin-sullust': {skyStrength: 0.4, skyColour: '#a8b4cc', visibilityKm: 45, hazeHeightKm: 3, hazeAlbedo: 0.35, hazeColour: '#b89880'}, // Sullust (twin of his Sullust map) (volcanic)
  // (wave B, the parts builder: its green is now its own great region, so a thinner air, no green fog over it)
  // (wave B, the air builder: and a dark grey ash over it, as Sullust's, a little clearer so its dark green ground shows)
  // (wave B, its critic: 60 km, so its great green region reads through the ash)
  'twin-pillio-dead': {skyStrength: 0.35, skyColour: '#a8b0b8', visibilityKm: 60, hazeHeightKm: 3, hazeAlbedo: 0.3, hazeColour: '#a09888'}, // Pillio, dead (twin of his map) (volcanic)
  'twin-kashyyyk': {skyStrength: 0.5, visibilityKm: 590}, // Kashyyyk (twin of his Kashyyyk circle) (living): ΔE 9.3 to its target
  'twin-endor': {skyStrength: 2, visibilityKm: 20}, // Endor (twin of his Endor circle) (living): ΔE 8.8 to its target
  'twin-yavin4': {skyStrength: 0.5, visibilityKm: 240}, // Yavin 4 (twin of his Yavin 4 circle) (living): ΔE 7.7 to its target
  'twin-felucia': {skyStrength: 0.5, visibilityKm: 62, skyColour: '#c0e8c8'}, // Felucia (twin of his Felucia circle) (living): ΔE 5.4 to its target
  'twin-dqar': {skyStrength: 1.41, visibilityKm: 50, skyColour: '#c8e0c8'}, // D'Qar (twin of his D'Qar circle) (living): ΔE 5.0 to its target
  'twin-takodana': {skyStrength: 2, visibilityKm: 39}, // Takodana (twin of his Takodana circle) (living): ΔE 10.5 to its target
  'twin-paintball': {skyStrength: 0.5, visibilityKm: 20}, // The test world "Paintball" (twin of his circle) (living): ΔE 11.4 to its target
  'twin-ryloth': {skyStrength: 1.19, visibilityKm: 63, skyColour: '#e8dcc8'}, // Ryloth (twin of his Ryloth circle) (living): ΔE 7.7 to its target
  'twin-scarif': {skyStrength: 1.41, visibilityKm: 245}, // Scarif (twin of his Scarif circle) (living): ΔE 11.7 to its target
  'twin-kamino': {skyStrength: 1.2, visibilityKm: 100}, // (wave B, its critic: 1.2, was 2, with more cloud) // Kamino (twin of his Kamino circle) (living): ΔE 13.2 to its target
  'twin-kamino-map': {skyStrength: 1, visibilityKm: 100}, // (wave B, its critic: was 2 over 64 km) // Kamino (twin of his Kamino map) (living): ΔE 4.8 to its target
  'twin-rori': {skyStrength: 2, visibilityKm: 240, skyColour: '#60c0e0'}, // Rori from space (twin of his Rori picture) (living): ΔE 9.3 to its target
  'twin-fondor': {skyStrength: 2, skyColour: '#a890ff'}, // Fondor (twin of his Fondor circle) (living): ΔE 5.3 to its target
  'twin-athulla': {skyStrength: 0.6, visibilityKm: 590}, // Athulla (twin of his Athulla map) (living): ΔE 11.1 to its target
  'twin-pillio': {skyStrength: 1, visibilityKm: 80}, // (wave B, its critic: was 1.41 over 20 km) // Pillio, alive (twin of his map) (living): ΔE 3.6 to its target
  'twin-planet': {skyStrength: 1, visibilityKm: 80}, // (wave B, its critic: was 2 over 20 km) // The generic green planet (twin of his map) (living): ΔE 9.4 to its target
  'twin-vardos': {skyStrength: 0.8, visibilityKm: 590, skyColour: '#c89080'}, // Vardos, alive (twin of his map) (living): ΔE 6.0 to its target
  'twin-vardos-dead': {skyStrength: 0.8, visibilityKm: 98, skyColour: '#c08060'}, // (wave B, its critic: was 1.13) // Vardos, dead (twin of his map) (living): ΔE 4.6 to its target
  'twin-rori-ground': {skyStrength: 1, skyColour: '#7fe0ff'}, // (wave B, its critic: was 1.7) // Rori from the ground (twin of his Kamino map as he wears it) (living): ΔE 4.9 to its target
  'twin-nur': {skyStrength: 0.59, visibilityKm: 80, skyColour: '#a8c4e8'}, // (wave B, its critic: 80 km, was 20) // Nur (twin of his Kamino map as he wears it) (living): ΔE 4.8 to its target
  'twin-dantooine': {skyStrength: 0.5, visibilityKm: 20, skyColour: '#e0d4ec'}, // Dantooine (twin of his Ryloth circle as he wears it) (living): ΔE 32.8 to its target
  'twin-yavin-prime-map': {skyStrength: 0.05, visibilityKm: 1000, skyColour: '#ffb080'}, // Yavin Prime (twin of his Bespin map as he wears it) (gasgiant): ΔE 7.3 to its target
};

// (the atmosphere brief's wave B, the air builder) Under real air a body's colour is its ground's seen through the air,
// so the grade that matched his picture under the painted haze (looks run 2) left the twins pale and lilac under
// Scattered. Each body's colour grade re-tuned under its own Scattered air (the lit disc from orbit at noon, CIELAB)
// toward his picture (a twin of a disc picture) or the colour its Painted form drew (a placeholder); where a grade dial
// stood at its range's end and the colour was still short, its surface layer's own live brightness or colour strength
// over the bake (`*_SURFACE`). Only the numbers that differ from the body's own. Table defaults only, as above.

// (A hue turn of over 40 degrees was found for three placeholders and not kept: it turns a whole world's colours round.)

/** Twins' grade (generate.js's GRADE_DIALS), by preset id. */
export const TWIN_GRADE = {
  'twin-kamino': {gradeLightness: 2, gradeContrast: 1.37}, // ΔE 13.1 to 5.1 (his picture); (wave B, its critic, with its air, clouds and surface: to 2.1)
  'twin-takodana': {gradeStrength: 1.485, gradeLightness: 2, gradeHue: -10.361}, // ΔE 10.6 to 1.2
  'twin-endor': {gradeStrength: 0.52, gradeLightness: 1.617}, // ΔE 8.7 to 4.9
  'twin-kashyyyk': {gradeStrength: 0.832, gradeLightness: 1.862, gradeHue: 15.82}, // ΔE 9.4 to 0.8
  'twin-geonosis': {gradeStrength: 1.361, gradeLightness: 1.294, gradeHue: -16.238}, // ΔE 11.2 to 1.3 (with its air below)
  'twin-paintball': {gradeLightness: 2}, // ΔE 5.7 to 4.2
  'twin-tatooine': {gradeStrength: 1.41, gradeLightness: 1.435, gradeHue: 11.505}, // ΔE 4.7 to 0.5
  'twin-jakku': {gradeStrength: 1.603, gradeLightness: 1.191}, // ΔE 6.6 to 5.8
  'twin-hoth': {gradeStrength: 1.513, gradeLightness: 0.999}, // ΔE 4.1 to 3.3
  'twin-crait': {gradeLightness: 1.046, gradeHue: -22.481}, // ΔE 5.0 to 1.4
  'twin-bespin': {gradeStrength: 1.354, gradeLightness: 1.131, gradeHue: -18.659, gradeContrast: 0.949}, // ΔE 7.9 to 2.4; (wave B, its critic: bands a little softer, to 1.5)
  'twin-yavin-prime': {gradeStrength: 1.005, gradeLightness: 1.008}, // ΔE 4.8 to 3.1
  // (a hue turn of 29 degrees took it to 3.1 but turned its jungle teal: by eye, the grade without the turn)
  'twin-yavin4': {gradeStrength: 1.49, gradeLightness: 2}, // ΔE 7.5 to 6.9
  'twin-felucia': {gradeStrength: 0.778, gradeLightness: 1.394}, // ΔE 5.3 to 1.5
  'twin-dqar': {gradeStrength: 0.778, gradeLightness: 1.494}, // ΔE 4.9 to 1.2
  'twin-ryloth': {gradeStrength: 1.356, gradeLightness: 1.801, gradeHue: -11.211}, // ΔE 5.5 to 2.6
  'twin-rori': {gradeStrength: 0.968, gradeLightness: 1.926, gradeHue: -3.003}, // ΔE 9.2 to 1.0
  'twin-fondor': {gradeStrength: 1.229, gradeLightness: 1.579}, // ΔE 2.2 to 1.1
};
/** Twins' surface layer (bright, sat), by preset id. */
export const TWIN_SURFACE = {
  // (wave B, its critic: re-fitted under the air as it now stands, the old number then the new where it moved)
  'twin-kamino': {bright: 1.574, sat: 0.881}, // ΔE 13.1 to 5.1 (its grade at both ends); its critic, with more cloud under a lighter air: to 2.1
  'twin-kashyyyk': {bright: 1.266}, // ΔE 9.4 to 0.8
  'twin-paintball': {bright: 1.077}, // ΔE 5.7 to 4.2
  'w3-naboo': {bright: 1.029, sat: 1.325}, // ΔE 4.0 to 2.9; its critic: to 2.6
  'twin-starkiller': {sat: 1.179}, // ΔE 3.0 to 0.9
  'twin-crait': {sat: 2.5}, // ΔE 5.0 to 1.4 (salt white: its little colour doubled)
  'twin-endor-giant': {bright: 1.042, sat: 1.379, hue: 7.9}, // ΔE 5.0 to 4.1; its critic: to 0.5
  'twin-ryloth': {bright: 1.146, sat: 1.45}, // ΔE 5.5 to 2.6
  'twin-rori': {bright: 1.483}, // ΔE 9.2 to 1.0
  // (wave B, its critic) his picture's colour strength, the air builder's grade left as it was
  'twin-hoth': {bright: 1.056, sat: 1.34}, // ΔE 3.3 to 1.6
  'twin-scarif': {bright: 1.027, sat: 1.148}, // ΔE 3.5 to 0.7 (0.3 with its islands gathered, generate.js)
  'twin-fondor-moon-4': {bright: 0.934}, // ΔE 6.3 to 4.7
  'twin-bespin': {bright: 1.008, sat: 1.019}, // with its softer bands: ΔE 2.4 to 1.5
  // (wave B, its critic) the map twins, under their lighter air (TWIN_AIR): ΔE to the Painted form's lightness with his
  // map's colour, before (the air builder's) and after
  'twin-jakku-map': {bright: 1.606, sat: 1.046}, // 13.9 to 5.1
  'twin-kamino-map': {bright: 1.243, sat: 1.206}, // 7.3 to 3.6
  'twin-athulla': {bright: 1.45, sat: 2}, // to its Painted colour 11.0 to 9.7, his map's green showing (hue 232 to 158; his 146)
  'twin-pillio': {bright: 1.59, sat: 1.537}, // to its Painted colour 3.5 to 1.8 (his map's own teal is buried under any air)
  'twin-planet': {bright: 1.498, sat: 2.5}, // 29.8 to 4.2
  'twin-vardos': {bright: 1.138, sat: 1.511}, // 12.9 to 2.7
  'twin-vardos-dead': {bright: 1.079, sat: 0.99}, // 4.3 to 2.6
  'twin-sullust': {bright: 1.434, sat: 1.321}, // 6.4 to 1.5 (its lava's red through the ash)
  'twin-pillio-dead': {bright: 1.471, sat: 2.5}, // 7.9 to 5.2 (its great green region through the ash)
  'twin-rori-ground': {bright: 0.738, sat: 1.105}, // to its Painted colour 4.7 to 3.5
  'twin-nur': {bright: 0.731, sat: 0.723}, // to its Painted colour 4.7 to 1.5
  'twin-bespin-map': {bright: 1.092, sat: 1.148}, // 12.8 to 4.9
  'twin-yavin-prime-map': {bright: 1.045, sat: 1.146}, // to its Painted colour 4.8 to 4.5
};
/** Placeholders' grade, by placeholder id. */
export const PLACEHOLDER_GRADE = {
  'ph:domir-dathomir': {gradeStrength: 1.627, gradeLightness: 2, gradeHue: -0.46}, // ΔE 10.5 to 1.0 (its Painted colour)
  'ph:brightjewel-ordmantell': {gradeStrength: 1.898, gradeLightness: 1.173, gradeHue: 7.135}, // ΔE 9.3 to 0.5 (with its air below)
  'ph:yavin-y8': {gradeStrength: 1.271, gradeLightness: 1.112}, // ΔE 10.1 to 9.4
  'ph:corell-drall': {gradeStrength: 1.063, gradeLightness: 1.247, gradeHue: 37.391}, // ΔE 9.4 to 0.6
  'ph:tatoo-ohann': {gradeStrength: 1.003, gradeLightness: 1.058}, // ΔE 4.8 to 0.7
  'ph:tatoo-adriana': {gradeStrength: 0.99, gradeLightness: 1.046}, // ΔE 4.8 to 0.6
  'ph:naboo-ohma': {gradeStrength: 1.984, gradeLightness: 1.208}, // ΔE 6.1 to 1.6
  'ph:corell-corellia': {gradeStrength: 1.97, gradeLightness: 1.567}, // ΔE 4.3 to 3.7
  'ph:corell-talon': {gradeStrength: 0.935, gradeLightness: 1.078, gradeHue: 17.199}, // ΔE 6.1 to 0.4
  'ph:dina-dantooine': {gradeStrength: 1.27, gradeLightness: 1.135}, // ΔE 5.7 to 2.0
  'ph:yavin-fiddanl': {gradeStrength: 1.005, gradeLightness: 1.039}, // ΔE 4.5 to 1.8
  'ph:yavin-y13': {gradeStrength: 0.979, gradeLightness: 1.088}, // ΔE 7.2 to 1.5
  'ph:karthakk-lok': {gradeStrength: 1.477, gradeLightness: 1.304}, // ΔE 4.8 to 1.8
  'ph:karthakk-maramere': {gradeStrength: 2, gradeLightness: 1.208}, // ΔE 6.9 to 5.5
  'ph:karthakk-nodkartha': {gradeStrength: 1.3, gradeLightness: 1.051}, // ΔE 4.8 to 2.2
  'ph:kashyyyk-wasskah': {gradeStrength: 2, gradeLightness: 1.138, gradeWash: 0.605, gradeWashColour: '#abb6c1'}, // ΔE 5.4 to 4.4
  'ph:kashyyyk-alaris': {gradeStrength: 1.168, gradeLightness: 1.028}, // ΔE 4.5 to 0.6
  'ph:kashyyyk-alarisprime': {gradeStrength: 2, gradeLightness: 1.342, gradeWash: 0.372, gradeWashColour: '#a6b1ba'}, // ΔE 7.2 to 5.8
  'ph:mustafar-mustafar': {gradeStrength: 1.338, gradeLightness: 1.502}, // ΔE 4.8 to 1.0
  'ph:mustafar-jestefad': {gradeStrength: 0.77, gradeLightness: 1.442}, // ΔE 4.8 to 1.1
  'ph:mustafar-lefrani': {gradeStrength: 1.581, gradeLightness: 1.045}, // ΔE 2.9 to 0.5
  'ph:tive-taanab': {gradeStrength: 1.184, gradeLightness: 1.256, gradeWashColour: '#948b90'}, // ΔE 10.8 to 0.9
  'ph:brightjewel-quantxi': {gradeStrength: 1.214, gradeLightness: 1.252, gradeHue: 37.288}, // ΔE 8.9 to 1.7
};
/** Placeholders' surface layer, by placeholder id. */
export const PLACEHOLDER_SURFACE = {
  'ph:domir-dathomir': {bright: 1.09}, // ΔE 10.5 to 1.0
  'ph:brightjewel-ordmantell': {sat: 1.104}, // ΔE 9.3 to 0.5
  'ph:karthakk-maramere': {sat: 1.557}, // ΔE 6.9 to 5.5
  'ph:kashyyyk-wasskah': {sat: 2.368}, // ΔE 5.4 to 4.4
};

/** Placeholders, by placeholder id. */
export const PLACEHOLDER_AIR = {
  'ph:tatoo-ohann': {skyStrength: 0.4, visibilityKm: 1000, skyColour: '#ffe6c4'}, // Ohann (placeholder) (gasgiant): ΔE 5.0 to the Painted colour
  'ph:tatoo-adriana': {skyStrength: 0.05, visibilityKm: 405, skyColour: '#ffe0b8'}, // Adriana (placeholder) (gasgiant): ΔE 5.0 to the Painted colour
  'ph:naboo-ohma': {skyStrength: 2, visibilityKm: 39, skyColour: '#b8c4a0'}, // Ohma-D'un (placeholder) (living): ΔE 7.6 to the Painted colour
  'ph:corell-corellia': {skyStrength: 2}, // Corellia (placeholder) (living): ΔE 4.7 to the Painted colour
  'ph:corell-talon': {skyStrength: 0.5, visibilityKm: 590, skyColour: '#a8c4e8'}, // Gus Talon (placeholder) (living): ΔE 6.7 to the Painted colour
  'ph:corell-drall': {visibilityKm: 63}, // Drall (placeholder) (living): ΔE 10.2 to the Painted colour
  'ph:corell-selonia': {skyStrength: 2, skyColour: '#94d0e8'}, // Selonia (placeholder) (living): ΔE 7.0 to the Painted colour
  'ph:corell-tralus': {skyStrength: 2, visibilityKm: 20}, // Tralus (placeholder) (living): ΔE 6.5 to the Painted colour
  'ph:corell-talus': {skyStrength: 2}, // Talus (placeholder) (living): ΔE 5.0 to the Painted colour
  'ph:dina-dantooine': {skyStrength: 2, visibilityKm: 240}, // Dantooine (placeholder) (living): ΔE 6.0 to the Painted colour
  'ph:domir-dathomir': {skyStrength: 1.6, visibilityKm: 240, skyColour: '#ff9a7a'}, // Dathomir (placeholder) (living): ΔE 11.3 to the Painted colour
  'ph:endor-kefbir': {skyStrength: 2, skyColour: '#a8c4e8'}, // Kef Bir (placeholder) (living): ΔE 4.4 to the Painted colour
  'ph:yavin-fiddanl': {skyStrength: 0.3, visibilityKm: 370, skyColour: '#ffd8b0'}, // Fiddanl (placeholder) (desert): ΔE 4.9 to the Painted colour
  'ph:yavin-y8': {skyStrength: 2, visibilityKm: 245}, // Yavin 8 (placeholder) (living): ΔE 10.4 to the Painted colour
  'ph:yavin-y13': {skyStrength: 0.5, visibilityKm: 590, skyColour: '#ffe0b8'}, // Yavin 13 (placeholder) (living): ΔE 7.7 to the Painted colour
  'ph:karthakk-lok': {skyStrength: 0.3, visibilityKm: 910, skyColour: '#ffd0a0'}, // Lok (placeholder) (desert): ΔE 5.6 to the Painted colour
  'ph:karthakk-maramere': {skyStrength: 2, visibilityKm: 39}, // Maramere (placeholder) (living): ΔE 7.8 to the Painted colour
  'ph:karthakk-nodkartha': {skyStrength: 1.5, visibilityKm: 61, skyColour: '#e8dcc8'}, // Nod Kartha, ours (placeholder) (desert): ΔE 5.2 to the Painted colour
  'ph:kashyyyk-wasskah': {skyStrength: 2, visibilityKm: 20}, // Wasskah (placeholder) (living): ΔE 6.1 to the Painted colour
  'ph:kashyyyk-alaris': {skyStrength: 0.6, visibilityKm: 405, skyColour: '#f0e4c8'}, // Alaris (placeholder) (gasgiant): ΔE 4.6 to the Painted colour
  'ph:kashyyyk-alarisprime': {skyStrength: 1.41, visibilityKm: 20}, // Alaris Prime (placeholder) (living): ΔE 8.0 to the Painted colour
  'ph:mustafar-mustafar': {skyStrength: 0.2, visibilityKm: 1000, skyColour: '#c8502a'}, // Mustafar (placeholder) (molten): ΔE 4.8 to the Painted colour
  'ph:mustafar-jestefad': {skyStrength: 0.32, visibilityKm: 1000, skyColour: '#e8c8b0'}, // Jestefad (placeholder) (gasgiant): ΔE 5.1 to the Painted colour
  'ph:mustafar-lefrani': {skyStrength: 0.4, visibilityKm: 160, skyColour: '#c8ccd8'}, // Lefrani (placeholder) (gasgiant): ΔE 3.1 to the Painted colour
  'ph:tive-taanab': {skyStrength: 2}, // Taanab (placeholder) (living): ΔE 9.4 to the Painted colour
  // (wave B, the air builder: Earth's clear air and a clear day, with its grade: ΔE 0.5)
  'ph:brightjewel-ordmantell': {skyStrength: 1, visibilityKm: 240}, // Ord Mantell (placeholder) (living): ΔE 10.5 to the Painted colour
  'ph:brightjewel-quantxi': {skyStrength: 0.5, visibilityKm: 590}, // Quantxi, the junk moon (placeholder) (cityworld): ΔE 8.9 to the Painted colour
};
