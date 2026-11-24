// A loading screen's settle given up on once the screen has stood still too long (the GPU port's pass 2, wave 6: maker K's
// patch for the owner's Mac, whose screen of 23 November stood at 62% saying nothing; moved here by the wave's fixer from
// `main.ts`' `App.stillBound`, word for word, so a node test runs it as the game does). Looked at once a second on a timer,
// never in a frame.
import { LOADING_TUNE } from '../world/loadingTune.ts';

/** What the bound reads of the screen: how long it has stood still (0 while it moves or is gone) and what it waits for. */
export interface StillScreen {
  stillMs(): number;
  readonly waitingFor: string;
}

/**
 * A settle (`work`) waited for until it answers, or until the loading screen has stood still -- neither its words nor its
 * bar moving -- for `LOADING_TUNE.stepGiveUpMs`: then `say` is handed what the screen was waiting for and that it was given up
 * on (the game says it in the console and on the message line), and the arrival goes on with the world as it stands, the wait
 * finishing in play. Answers which came first.
 */
export async function stillBound(work: Promise<void>, screen: StillScreen, say: (line: string) => void): Promise<'done' | 'given up'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const still = new Promise<'still'>((resolve) => {
    const look = (): void => {
      if (screen.stillMs() >= LOADING_TUNE.stepGiveUpMs) resolve('still');
      else timer = setTimeout(look, 1000);
    };
    timer = setTimeout(look, 1000);
  });
  try {
    if ((await Promise.race([work.then(() => 'done' as const), still])) === 'done') return 'done';
    say(`loading: gave up waiting for ${screen.waitingFor} after ${Math.round(LOADING_TUNE.stepGiveUpMs / 1000)} s with nothing moving; it finishes in play`);
    work.catch((err) => console.warn('loading: the settle given up on failed after', err));
    return 'given up';
  } finally {
    clearTimeout(timer);
  }
}
