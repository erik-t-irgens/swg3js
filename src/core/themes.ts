// The interface's colour themes (the interface rewrite's second wave, item 11): the Colours switch on the Interface page.
//
// Every colour on the screen is one of the eighteen named colours (`palette.ts`, declared on `:root` in `src/style.css`),
// so a theme is just another eighteen values, in `PALETTE_NAMES` order. These are the forty-two of the owner's examples
// page (its `THEMES` table, values and order as they stand; the page's own words about each are not carried), the first
// of them, Default, being the palette exactly as `src/style.css` declares it. `themes.test.ts` holds every theme to the
// examples page's check (its words read on dark and bright backdrops, ready, caution and danger stay apart, a ship's
// four layers stay apart, and the bars' colours turn where they should), and Default to the palette.
//
// A theme is put on by writing its eighteen as custom properties on the page's root (`applyTheme`), which outranks the
// stylesheet's own `:root` declarations, so every `var(--…)` on the page -- the display, the menus, the loading screen's
// words and line, every panel -- takes it at once without a reload; Default takes them off again, so the stylesheet's
// own values stand. The palette is then read again (`initPalette`), which the overlay's strokes read live, and whoever
// keeps a copy of a colour of their own (the hull flash, the space map's materials, a name over another player's head)
// hears of it (`paletteChanged`). Nothing here runs in a frame.
import { initPalette, PALETTE_NAMES, paletteChanged } from './palette.ts';

/** The examples page's groups, in its order, with the words the Interface page's list names them by. */
export const THEME_GROUPS = [
  { id: 'proposed', label: 'Proposed' },
  { id: 'draft', label: 'First drafts' },
  { id: 'factions', label: 'Eras and factions' },
  { id: 'places', label: 'Places' },
  { id: 'tech', label: 'Ships and technology' },
  { id: 'force', label: 'The Force' },
] as const;

export type ThemeGroup = (typeof THEME_GROUPS)[number]['id'];

/** One theme: its word in the settings, its name on the page, its group, and its eighteen values in `PALETTE_NAMES` order. */
export interface HudTheme {
  readonly id: string;
  readonly name: string;
  readonly group: ThemeGroup;
  readonly v: readonly string[];
}

/** The theme the settings start on: the palette as it stands. */
export const DEFAULT_THEME = 'default';

/** The forty-two, in the examples page's order. */
export const THEMES: readonly HudTheme[] = Object.freeze([
  { id: 'default', name: 'Default', group: 'proposed', v: ['#7fd7ff', '#e8f1f8', '#9fb3c4', '#060a12', 'rgba(24, 38, 54, 0.7)', 'rgba(8, 14, 24, 0.62)', 'rgba(127, 215, 255, 0.18)', 'rgba(127, 215, 255, 0.28)', '#6adf7a', '#e2a33c', '#ff5a4a', '#ffb040', '#9fd8ff', '#ffb070', '#ff8a50', '#ffd27f', '#b8322a', '#2d7fd6'] },
  { id: 'colourblind', name: 'Colour-blind safe', group: 'proposed', v: ['#56b4e9', '#f2f2f2', '#a9b4be', '#05080c', 'rgba(22, 34, 46, 0.72)', 'rgba(6, 12, 20, 0.64)', 'rgba(86, 180, 233, 0.18)', 'rgba(86, 180, 233, 0.3)', '#009e73', '#f0e442', '#d55e00', '#e69f00', '#56b4e9', '#f0e442', '#d55e00', '#cc79a7', '#a04a00', '#0072b2'] },
  { id: 'contrast', name: 'High contrast', group: 'proposed', v: ['#00e5ff', '#ffffff', '#d0dae4', '#000000', 'rgba(0, 0, 0, 0.85)', 'rgba(0, 0, 0, 0.8)', 'rgba(255, 255, 255, 0.35)', 'rgba(255, 255, 255, 0.6)', '#39ff6a', '#ffd400', '#ff3b30', '#ff9f0a', '#7fe7ff', '#ffb347', '#ff6a2b', '#fff06a', '#a8140c', '#1f8fff'] },
  { id: 'amber', name: 'Amber', group: 'proposed', v: ['#ffb347', '#ffe2b8', '#c9a27a', '#120a03', 'rgba(48, 30, 12, 0.72)', 'rgba(20, 12, 4, 0.66)', 'rgba(255, 179, 71, 0.18)', 'rgba(255, 179, 71, 0.3)', '#d9e27a', '#ff9a2e', '#ff4a2a', '#ffd36b', '#ffe0a8', '#ffad5c', '#ff7a3a', '#ffd27f', '#9c2a12', '#b8681c'] },
  { id: 'imperial', name: 'Imperial', group: 'draft', v: ['#c9d3dc', '#f0f3f5', '#8e9aa5', '#07090b', 'rgba(34, 38, 43, 0.75)', 'rgba(12, 14, 17, 0.66)', 'rgba(201, 211, 220, 0.16)', 'rgba(201, 211, 220, 0.3)', '#4fd17a', '#f0b030', '#ff2e36', '#ff7a3a', '#a8c8e8', '#d8a070', '#e06040', '#e8d090', '#9e1a1a', '#1f4fa0'] },
  { id: 'rebellion', name: 'Rebellion', group: 'draft', v: ['#ff8a3d', '#f5ede2', '#b7a58f', '#0c0805', 'rgba(46, 34, 24, 0.72)', 'rgba(18, 12, 8, 0.64)', 'rgba(255, 138, 61, 0.18)', 'rgba(255, 138, 61, 0.3)', '#8fd45a', '#ffc44d', '#ff4a3a', '#ffd06a', '#8fd0ff', '#ffb070', '#ff7a40', '#ffe08a', '#a8301e', '#2f78c8'] },
  { id: 'gray', name: 'Gray', group: 'draft', v: ['#d6d9dc', '#eeeeee', '#9a9da0', '#0a0a0b', 'rgba(40, 41, 43, 0.72)', 'rgba(14, 14, 15, 0.64)', 'rgba(214, 217, 220, 0.16)', 'rgba(214, 217, 220, 0.28)', '#9fd0a6', '#d8b77a', '#e07a70', '#e8c08a', '#c4d4e0', '#d8b896', '#d49a80', '#e0d4a8', '#8a3a34', '#3d6aa8'] },
  { id: 'dusk', name: 'Dusk', group: 'draft', v: ['#c39bff', '#f1eaf8', '#a99bbd', '#0b0712', 'rgba(40, 28, 58, 0.72)', 'rgba(14, 9, 22, 0.64)', 'rgba(195, 155, 255, 0.18)', 'rgba(195, 155, 255, 0.3)', '#7fe0b0', '#ffb86b', '#ff5f7a', '#ff9a6b', '#b8c8ff', '#ffb38a', '#ff8a7a', '#ffd8a0', '#a8284a', '#6a48c8'] },
  { id: 'dawn', name: 'Dawn', group: 'draft', v: ['#ffd08a', '#fff5ea', '#c9b8a8', '#120c0a', 'rgba(52, 38, 32, 0.7)', 'rgba(22, 15, 12, 0.62)', 'rgba(255, 208, 138, 0.18)', 'rgba(255, 208, 138, 0.3)', '#9be08a', '#ffb35c', '#ff6a5a', '#ffc46b', '#a8d8ff', '#ffbe8f', '#ff9a70', '#ffe3a0', '#b23c32', '#d0607a'] },
  { id: 'crimson', name: 'Crimson Dawn', group: 'draft', v: ['#d9b46a', '#f3e9dc', '#a8958a', '#0a0505', 'rgba(42, 16, 18, 0.75)', 'rgba(16, 6, 7, 0.68)', 'rgba(217, 180, 106, 0.18)', 'rgba(217, 180, 106, 0.32)', '#b8d07a', '#e8a84a', '#ff3348', '#ffb85a', '#c8d8e8', '#e0a870', '#d05a3a', '#e8d08a', '#7a0f1c', '#9a1e30'] },
  { id: 'blacksun', name: 'Black Sun', group: 'draft', v: ['#c0c6cc', '#f4f6f8', '#7c8288', '#050506', 'rgba(30, 32, 35, 0.78)', 'rgba(10, 10, 12, 0.7)', 'rgba(192, 198, 204, 0.18)', 'rgba(192, 198, 204, 0.34)', '#a8d8b0', '#e0c080', '#e85a50', '#f0d8a0', '#d8e4ee', '#c8b8a0', '#c89078', '#e4dcc0', '#7a2a26', '#8a929a'] },
  { id: 'jedi', name: 'Jedi', group: 'draft', v: ['#8fd0ff', '#f4ecdf', '#b8a68e', '#0d0a07', 'rgba(52, 40, 28, 0.72)', 'rgba(20, 15, 10, 0.64)', 'rgba(143, 208, 255, 0.18)', 'rgba(143, 208, 255, 0.3)', '#7ee07a', '#f0c060', '#ff5a4a', '#ffd07a', '#b0e0ff', '#e0b080', '#e08a5a', '#f0d890', '#a83a2a', '#2f86d8'] },
  { id: 'sith', name: 'Sith', group: 'draft', v: ['#ff3d45', '#f0e6e6', '#9a8a8c', '#070304', 'rgba(36, 14, 16, 0.76)', 'rgba(12, 4, 5, 0.7)', 'rgba(255, 61, 69, 0.18)', 'rgba(255, 61, 69, 0.32)', '#9fc8a0', '#ffab40', '#ff7a45', '#ffb04a', '#c8c8d8', '#d89a7a', '#ff6a4a', '#e8c890', '#6e0d12', '#a01420'] },
  { id: 'republic', name: 'Republic', group: 'factions', v: ['#f2e4c4', '#fbfaf6', '#9eaac2', '#050813', 'rgba(22, 34, 70, 0.76)', 'rgba(8, 13, 32, 0.66)', 'rgba(242, 228, 196, 0.2)', 'rgba(214, 44, 66, 0.5)', '#6cd89a', '#f4c24a', '#ff5442', '#ffb24c', '#9cc4ff', '#f2c88e', '#ff8a64', '#fff0a0', '#b01e36', '#9e1832'] },
  { id: 'legion501', name: '501st', group: 'factions', v: ['#5a96ff', '#f6f8fa', '#a8b2be', '#05070b', 'rgba(34, 38, 46, 0.76)', 'rgba(11, 13, 17, 0.66)', 'rgba(246, 248, 250, 0.16)', 'rgba(90, 150, 255, 0.42)', '#6edc8e', '#f2c040', '#ff4d40', '#ffb84a', '#8cc6ff', '#e4e8ee', '#ff9466', '#ffe08a', '#b42a30', '#2349b2'] },
  { id: 'separatist', name: 'Separatist', group: 'factions', v: ['#d49a32', '#f1e6cc', '#8f9cac', '#06080c', 'rgba(42, 48, 60, 0.76)', 'rgba(14, 17, 24, 0.66)', 'rgba(212, 154, 50, 0.18)', 'rgba(138, 100, 214, 0.45)', '#72d692', '#f6d04a', '#ff4c3c', '#ffb04a', '#a8b4ff', '#e0c08c', '#ff8a5a', '#f0e6a8', '#a82a26', '#5e3caa'] },
  { id: 'mandalorian', name: 'Mandalorian', group: 'factions', v: ['#dcba86', '#e8edf0', '#a2abb2', '#080808', 'rgba(28, 28, 29, 0.8)', 'rgba(10, 10, 10, 0.7)', 'rgba(220, 186, 134, 0.18)', 'rgba(220, 186, 134, 0.3)', '#7fd28a', '#f2c24a', '#ff503c', '#ffb456', '#a8cce8', '#e0c08e', '#e8865a', '#f0e0a4', '#a83a22', '#4a6278'] },
  { id: 'hutt', name: 'Hutt Cartel', group: 'factions', v: ['#cac454', '#f2edd4', '#a9a67c', '#0a0b05', 'rgba(46, 46, 24, 0.78)', 'rgba(17, 17, 8, 0.68)', 'rgba(202, 196, 84, 0.18)', 'rgba(202, 196, 84, 0.32)', '#5ed6a6', '#f6c437', '#ff4a38', '#ff9a3a', '#a8ccd8', '#e8c070', '#ff8a50', '#e4e4a0', '#a8401a', '#a06414'] },
  { id: 'nightsisters', name: 'Nightsisters', group: 'factions', v: ['#aee08a', '#eef3e8', '#9fab9c', '#060705', 'rgba(24, 30, 22, 0.8)', 'rgba(9, 12, 9, 0.7)', 'rgba(174, 224, 138, 0.18)', 'rgba(190, 32, 48, 0.5)', '#46d0c4', '#f4c04a', '#ff3c4a', '#ffb050', '#9cd0e0', '#e8c08a', '#ff8460', '#dcec98', '#8a0e1e', '#a01426'] },
  { id: 'royalguard', name: 'Royal Guard', group: 'factions', v: ['#ff6e80', '#f6f2f2', '#a3a9b4', '#0a0204', 'rgba(88, 10, 24, 0.8)', 'rgba(28, 3, 9, 0.72)', 'rgba(255, 110, 128, 0.2)', 'rgba(255, 110, 128, 0.36)', '#8ed49c', '#ffcc40', '#ff8a3a', '#ffd88a', '#b8c4e8', '#e8b48c', '#ff7a5a', '#f0dca0', '#7e0a1a', '#9a0e26'] },
  { id: 'tatooine', name: 'Tatooine', group: 'places', v: ['#ffcf4a', '#f8efdc', '#cdbb96', '#090a10', 'rgba(30, 36, 58, 0.76)', 'rgba(10, 12, 24, 0.66)', 'rgba(255, 207, 74, 0.18)', 'rgba(255, 207, 74, 0.3)', '#96d86c', '#ff9a3c', '#ff4e3e', '#ffe49a', '#9cc0ff', '#e8b67c', '#ec7c4a', '#f4dc9c', '#b4452c', '#3c52c4'] },
  { id: 'hoth', name: 'Hoth', group: 'places', v: ['#e4f2ff', '#f6faff', '#a0b0c8', '#06080b', 'rgba(58, 68, 90, 0.82)', 'rgba(14, 18, 26, 0.68)', 'rgba(228, 242, 255, 0.16)', 'rgba(228, 242, 255, 0.3)', '#6edc9e', '#f0c24a', '#ff4c58', '#ff9c4a', '#a6d6ff', '#e2c49c', '#ff8466', '#f2e4a8', '#b8303e', '#88aaf0'] },
  { id: 'endor', name: 'Endor', group: 'places', v: ['#8ed468', '#eef0e0', '#c09a74', '#080906', 'rgba(20, 42, 26, 0.76)', 'rgba(8, 16, 10, 0.66)', 'rgba(142, 212, 104, 0.18)', 'rgba(142, 212, 104, 0.3)', '#5ee0c4', '#f2b640', '#ff5a40', '#ffc860', '#94d0f4', '#d8aa7a', '#e27a4a', '#ece08e', '#b04428', '#2a6a3a'] },
  { id: 'mustafar', name: 'Mustafar', group: 'places', v: ['#ff6a1c', '#f2e6de', '#aa9c96', '#0a0707', 'rgba(30, 26, 26, 0.8)', 'rgba(10, 8, 8, 0.7)', 'rgba(255, 106, 28, 0.2)', 'rgba(255, 106, 28, 0.34)', '#84dc8a', '#ffcc3a', '#ff2e5c', '#ffd870', '#9ad2ff', '#eab48a', '#ff8a5a', '#f2dc8a', '#a8280e', '#a03a0c'] },
  { id: 'coruscant', name: 'Coruscant Night', group: 'places', v: ['#ff5ce0', '#f2f0fc', '#9cb4d0', '#07050e', 'rgba(26, 18, 46, 0.78)', 'rgba(9, 6, 20, 0.68)', 'rgba(255, 92, 224, 0.18)', 'rgba(64, 228, 255, 0.34)', '#3cf0b4', '#ffd23c', '#ff4a3a', '#4ce6ff', '#7cdcff', '#d8a8ff', '#ff7a8a', '#ffe08a', '#c0204e', '#8a2ad8'] },
  { id: 'naboo', name: 'Naboo', group: 'places', v: ['#ecb43e', '#fcf6ea', '#c6bcaa', '#050b0c', 'rgba(16, 42, 46, 0.76)', 'rgba(6, 16, 18, 0.66)', 'rgba(236, 180, 62, 0.18)', 'rgba(236, 180, 62, 0.32)', '#5ee8c2', '#ff9a38', '#ff4a4a', '#ffdc78', '#8ef0e6', '#e8c08c', '#e8805c', '#f4e4b4', '#b03838', '#1e8a80'] },
  { id: 'dagobah', name: 'Dagobah', group: 'places', v: ['#ccc882', '#eceee4', '#a8aca4', '#090a07', 'rgba(40, 42, 36, 0.76)', 'rgba(12, 14, 10, 0.68)', 'rgba(204, 200, 130, 0.16)', 'rgba(204, 200, 130, 0.28)', '#6ed8a6', '#f0b444', '#ff5c48', '#ffc866', '#9cd0e4', '#d4b088', '#dc7c54', '#e4dc98', '#a24a30', '#646a2a'] },
  { id: 'cloudcity', name: 'Cloud City', group: 'places', v: ['#ff9ab4', '#fff6f4', '#d6b0a2', '#0e080a', 'rgba(50, 34, 48, 0.74)', 'rgba(18, 11, 16, 0.64)', 'rgba(255, 154, 180, 0.18)', 'rgba(255, 154, 180, 0.3)', '#7ce0b4', '#ffc44a', '#ff4a30', '#ffbc84', '#a8d4ff', '#ffc0a0', '#ff7a6a', '#ffe2a0', '#b8384a', '#8e3c7c'] },
  { id: 'kamino', name: 'Kamino', group: 'places', v: ['#66e4d8', '#f4f8f8', '#a6b0b4', '#06090a', 'rgba(40, 50, 54, 0.78)', 'rgba(12, 15, 17, 0.68)', 'rgba(102, 228, 216, 0.16)', 'rgba(102, 228, 216, 0.28)', '#96e070', '#f2c44a', '#ff5a5e', '#ffb060', '#b0ecff', '#e2c2a2', '#ff8a72', '#ece4a6', '#b03a4c', '#4a6a8a'] },
  { id: 'crait', name: 'Crait', group: 'places', v: ['#e8edf2', '#fbfaf8', '#b8b4b4', '#0b0606', 'rgba(58, 24, 18, 0.78)', 'rgba(20, 8, 6, 0.68)', 'rgba(232, 237, 242, 0.16)', 'rgba(232, 237, 242, 0.3)', '#7ee0a2', '#f4d03c', '#ff8a2c', '#ffeaa0', '#b4d8ff', '#e8bc98', '#ff6a4a', '#f2e2a8', '#c03a26', '#a8361e'] },
  { id: 'lothal', name: 'Lothal', group: 'places', v: ['#aaa6ff', '#f6f0dc', '#c8b878', '#0a0906', 'rgba(44, 40, 22, 0.76)', 'rgba(16, 14, 8, 0.66)', 'rgba(170, 166, 255, 0.18)', 'rgba(170, 166, 255, 0.3)', '#84dc7a', '#ffb444', '#ff5248', '#ffd060', '#a8c4ff', '#e6bc84', '#ee8058', '#eee08e', '#b0402e', '#5c3cb0'] },
  { id: 'exegol', name: 'Exegol', group: 'places', v: ['#a8bcff', '#eef0fa', '#8a88a8', '#030306', 'rgba(12, 12, 20, 0.86)', 'rgba(4, 4, 10, 0.8)', 'rgba(168, 188, 255, 0.16)', 'rgba(168, 188, 255, 0.32)', '#7cd8b0', '#e8c056', '#ff3e4e', '#d4b4ff', '#a4e0ff', '#d6b8a0', '#e07a6a', '#e4dca8', '#a01e34', '#4446b0'] },
  { id: 'falcon', name: 'Falcon Cockpit', group: 'tech', v: ['#ffc930', '#f3ead6', '#aaa18c', '#0c0b08', 'rgba(54, 50, 42, 0.74)', 'rgba(18, 16, 12, 0.66)', 'rgba(243, 234, 214, 0.18)', 'rgba(243, 234, 214, 0.3)', '#84d468', '#ffa22e', '#ff4e3c', '#ff8a3a', '#a6cbe6', '#e2b47e', '#d98a5c', '#ebdc9e', '#a8382a', '#80561c'] },
  { id: 'targeting', name: 'Targeting Computer', group: 'tech', v: ['#ff6a1a', '#ffe9da', '#b8927c', '#070302', 'rgba(14, 8, 5, 0.82)', 'rgba(6, 3, 2, 0.72)', 'rgba(255, 106, 26, 0.26)', 'rgba(255, 106, 26, 0.5)', '#6ae08a', '#ffd23a', '#ff1f4a', '#ffb040', '#a8ccf0', '#ffb27a', '#ff8350', '#ffe08a', '#a01a2a', '#8e2c0a'] },
  { id: 'tiecockpit', name: 'TIE Cockpit', group: 'tech', v: ['#7cf08a', '#e6ece7', '#959d99', '#070908', 'rgba(36, 40, 41, 0.78)', 'rgba(11, 13, 13, 0.68)', 'rgba(124, 240, 138, 0.16)', 'rgba(124, 240, 138, 0.28)', '#3fd8c4', '#e8c43e', '#ff4438', '#ffa040', '#a6cce8', '#d6b282', '#e07452', '#d4e08e', '#a02c24', '#1f6a34'] },
  { id: 'hologram', name: 'Hologram', group: 'tech', v: ['#5ef0f0', '#e2fbff', '#80b8c2', '#03080e', 'rgba(12, 40, 58, 0.66)', 'rgba(4, 16, 26, 0.6)', 'rgba(94, 240, 240, 0.2)', 'rgba(94, 240, 240, 0.34)', '#64e6a4', '#f2dc66', '#ff5a7c', '#ffb878', '#b2ecff', '#e8c49c', '#ee8c84', '#dcf0a2', '#b0304e', '#3646c8'] },
  { id: 'astromech', name: 'Astromech', group: 'tech', v: ['#e8b84a', '#f4f7fb', '#9ca9bd', '#04070f', 'rgba(22, 48, 104, 0.72)', 'rgba(6, 14, 34, 0.66)', 'rgba(232, 184, 74, 0.2)', 'rgba(232, 184, 74, 0.34)', '#5fd88a', '#ffdc52', '#ff4e42', '#ff9a3c', '#8fc8ff', '#e8b880', '#ff8a5a', '#f0dc90', '#b8302a', '#2a5ec8'] },
  { id: 'carbonite', name: 'Carbonite', group: 'tech', v: ['#c08a5c', '#e0e4e4', '#8c9599', '#070909', 'rgba(36, 42, 46, 0.78)', 'rgba(11, 14, 16, 0.68)', 'rgba(192, 138, 92, 0.18)', 'rgba(192, 138, 92, 0.32)', '#7fcf8a', '#dcb84c', '#ff5a48', '#ffa060', '#a8c4d8', '#d4aa82', '#cc7a5c', '#ddd0a0', '#a8441e', '#4e5458'] },
  { id: 'kyber', name: 'Kyber', group: 'force', v: ['#86a2ff', '#eaf0ff', '#96a6d0', '#04071a', 'rgba(18, 30, 74, 0.72)', 'rgba(6, 10, 32, 0.66)', 'rgba(134, 162, 255, 0.2)', 'rgba(134, 162, 255, 0.34)', '#4fe3a8', '#f4d65c', '#ff4d5e', '#ffb880', '#b4e0ff', '#e8c0a0', '#f08a80', '#e0e4a8', '#b0283c', '#6a30e6'] },
  { id: 'greyjedi', name: 'Grey Jedi', group: 'force', v: ['#d8c890', '#eeeeec', '#a0a09e', '#0a0a0a', 'rgba(46, 46, 45, 0.74)', 'rgba(15, 15, 15, 0.64)', 'rgba(216, 200, 144, 0.18)', 'rgba(216, 200, 144, 0.3)', '#6fd49a', '#e8c25a', '#f05a4e', '#f0a860', '#b8ccdc', '#d4b894', '#c89078', '#e0d8b0', '#94303c', '#6a5e3a'] },
  { id: 'vaapad', name: 'Vaapad', group: 'force', v: ['#c060ff', '#f8e8f6', '#b494b8', '#0c0410', 'rgba(48, 14, 52, 0.78)', 'rgba(18, 5, 20, 0.68)', 'rgba(192, 96, 255, 0.2)', 'rgba(192, 96, 255, 0.34)', '#6fe0a0', '#ffc850', '#ff4a5a', '#ffa050', '#b8c8ff', '#e8b090', '#f07a70', '#f0d8a0', '#b01e2e', '#7a1aa8'] },
  { id: 'darksaber', name: 'Darksaber', group: 'force', v: ['#f4f8ff', '#d4d8dc', '#8a8a88', '#030304', 'rgba(6, 7, 10, 0.84)', 'rgba(2, 2, 4, 0.76)', 'rgba(244, 248, 255, 0.22)', 'rgba(244, 248, 255, 0.5)', '#7ad8b0', '#e8d070', '#ff4a4a', '#ffd09a', '#a8c8f0', '#d8bc9c', '#d4907c', '#e4e0b8', '#9a2a2a', '#34447e'] },
]);

/** A theme by its word; a word that is none of them (an old or hand-edited store) is Default. */
export function themeById(id: string): HudTheme {
  for (let i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i];
  return THEMES[0];
}

/**
 * Put a theme on: its eighteen written on the root's own style (Default's taken off, so the stylesheet's stand), the
 * palette read again, and everyone keeping a copy told. Returns the word of the theme now on, which is Default for a
 * word that is none of them. `root` is the page's root unless a node test hands a stand-in. Not in a frame: once at
 * boot and once a switch.
 */
export function applyTheme(id: string, root?: Element | null): string {
  const el = root ?? (typeof document === 'undefined' ? null : document.documentElement);
  const theme = themeById(id);
  const style = (el as { style?: { setProperty?: (n: string, v: string) => void; removeProperty?: (n: string) => string } } | null)?.style;
  if (el && style && typeof style.setProperty === 'function' && typeof style.removeProperty === 'function') {
    for (let i = 0; i < PALETTE_NAMES.length; i++) {
      const name = `--${PALETTE_NAMES[i]}`;
      if (theme.id === DEFAULT_THEME) style.removeProperty(name);
      else style.setProperty(name, theme.v[i]);
    }
    initPalette(el);
  }
  paletteChanged();
  return theme.id;
}