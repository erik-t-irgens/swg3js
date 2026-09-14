// A tab strip for the panels that share a key: the inventory on I (wardrobe, weapons) and the
// spawner on B (garage, NPCs). Each panel draws the strip in its header with its own tab lit and
// hands a click on another tab to the game, which swaps the panels.

export interface TabDef {
  id: string;
  label: string;
}

/** The strip's markup, with `current` lit. */
export function tabStrip(tabs: TabDef[], current: string): string {
  return `<div class="tabs">${tabs.map((t) => `<button class="tab${t.id === current ? ' on' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}</div>`;
}

/** Wire the strip inside `root`: a click on a tab that is not the current one calls `onPick`. */
export function wireTabs(root: HTMLElement, current: string, onPick: (id: string) => void): void {
  for (const b of root.querySelectorAll<HTMLButtonElement>('.tabs .tab')) {
    b.addEventListener('click', () => {
      const id = b.dataset.tab!;
      if (id !== current) onPick(id);
    });
  }
}

export const INVENTORY_TABS: TabDef[] = [
  { id: 'wardrobe', label: 'Wardrobe' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'weapons', label: 'Weapons' },
];

export const SPAWNER_TABS: TabDef[] = [
  { id: 'garage', label: 'Garage' },
  { id: 'npcs', label: 'NPCs' },
];
