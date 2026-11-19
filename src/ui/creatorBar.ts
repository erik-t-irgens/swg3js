// The bar under the character creator: the name, the world to start on, and the button that
// makes the character. The creator itself is the appearance panel at full size above it, and that
// panel is the whole of making a character -- there is no step 2. Clothes, weapons, skills and the
// backpack are what a character does once it exists and has a record to write to, so the creator
// shows none of them (the tab strip is hidden in `.creation`). `onTab` and `setStep` are kept
// because the wardrobe panel can still be shown here by hand.
//
// There is no class to choose (the port's pass 1, the owner's word): a character is made with the
// Jedi kit (`App.finishCreation`), and C still switches the kit for testing until the progression
// replaces the classes.
import { PLANETS } from '../data/planets';

export class CreatorBar {
  readonly root: HTMLElement;
  onCreate: (name: string, planet: string) => void = () => {};
  onBack: () => void = () => {};
  onTab: (id: 'appearance' | 'wardrobe') => void = () => {};

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'creator-bar';
    this.root.className = 'hidden';
    const worlds = PLANETS.filter((p) => p.id !== 'gallery' && !p.space && !p.instances && !p.extra);
    this.root.innerHTML = `
      <button class="back">← Characters</button>
      <label>Name<input class="name" type="text" maxlength="24" placeholder="Character name" autocomplete="off" spellcheck="false" /></label>
      <label>Starts on <select class="planet">${worlds.map((p) => `<option value="${p.id}">${p.name} — ${p.tagline}</option>`).join('')}</select></label>
      <button class="create">Create character</button>
      <span class="note"></span>`;
    parent.appendChild(this.root);
    this.root.querySelector('.back')!.addEventListener('click', () => this.onBack());
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.step')) {
      b.addEventListener('click', () => this.onTab(b.dataset.step as 'appearance' | 'wardrobe'));
    }
    this.root.querySelector('.create')!.addEventListener('click', () => {
      const name = this.name.value.trim();
      if (!name) {
        this.note('Give the character a name first.');
        this.name.focus();
        return;
      }
      this.onCreate(name, this.root.querySelector<HTMLSelectElement>('.planet')!.value);
    });
    this.name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.root.querySelector<HTMLButtonElement>('.create')!.click();
    });
  }

  private get name(): HTMLInputElement {
    return this.root.querySelector<HTMLInputElement>('.name')!;
  }

  /** Light the step whose panel is showing. */
  setStep(id: 'appearance' | 'wardrobe'): void {
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.step')) b.classList.toggle('on', b.dataset.step === id);
  }

  note(text: string): void {
    this.root.querySelector<HTMLElement>('.note')!.textContent = text;
  }

  show(): void {
    this.name.value = '';
    this.note('');
    this.root.classList.remove('hidden');
    this.setStep('appearance');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }
}
