// The Multiplayer page under Escape: what it is drawn from, and the markup it is drawn as.
//
// It is here rather than in `menu.ts` for the same reason the Interface page's knobs are in
// `hudPage.ts`: a node test can read this file without a browser, and `menu.ts` cannot be read without
// one. The page is the one part of this package that the sessions working on it cannot look at -- the
// tab they drive is hidden and never draws a frame -- so the next best thing is a test that builds the
// markup and checks that every name the wiring reaches for is in it. Each of those lookups ends in a
// `!` and would take the whole menu down, not merely lose a button, if the two ever drifted apart.
//
// Nothing here touches the document, and nothing here runs in a frame: the page is built when it is
// opened and not again until something on it is pressed.

/** One side's copy of a character, as the two are shown side by side when they have to be settled. */
export interface CharacterCopy {
  name: string;
  species: string;
  class: string;
  planet: string;
  zone: string;
  counter: number;
}

/** Everything the page is drawn from, read at the moment it is built so none of it can be stale. */
export interface MultiplayerView {
  url: string;
  word: string;
  status: string;
  mode: 'off' | 'waiting' | 'relay' | 'server';
  player: string;
  peers: readonly string[];
  ask: { character: string; browser: CharacterCopy; server: CharacterCopy } | null;
}

/**
 * Anything that came from another browser goes through this before it is written into the page. The
 * apostrophe is escaped as well as the quote: every insertion today is in a double-quoted attribute or
 * in text, but the next one written with single quotes would be a way in, and it costs nothing.
 */
export function escapeForPage(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** One copy of a character in a line, so the two can be read one above the other. */
export function copyLine(c: CharacterCopy): string {
  const where = c.zone ? `${c.planet} · ${c.zone}` : c.planet || 'nowhere';
  return `${c.name || 'someone'} · ${c.species || 'unknown'} · ${c.class || 'unknown'} · ${where} · ${c.counter} change${c.counter === 1 ? '' : 's'}`;
}

/** What the line under the address says about the kind of line this is. The words are ours. */
export const MODE_WORDS: Readonly<Record<'off' | 'waiting' | 'relay' | 'server', string>> = Object.freeze({
  off: 'not connected',
  waiting: 'waiting for the server to speak',
  relay: 'a relay: places and poses only, nothing kept',
  server: 'a server: it holds the world',
});

/**
 * Every element the page's wiring reaches for by name: the ones that are always there, and the two
 * that exist only while there is a character to settle. The test walks both lists.
 */
export const MULTIPLAYER_PARTS = Object.freeze({
  always: Object.freeze(['.server', '.word', '.connect', '.disconnect', '.net-status', '.player-id', '.key-note', '.copy-key', '.show-key', '.key-out-row', '.key-out', '.key-in', '.use-key', '.use-note']),
  asking: Object.freeze(['.keep-local', '.keep-server']),
});

/** The page itself: a pure function of what was read, so a test can build it without a browser. */
export function multiplayerMarkup(v: MultiplayerView): string {
  const esc = escapeForPage;
  const ask = v.ask;
  return `<h2>Multiplayer</h2>
        <p class="menu-hint">Everyone's place and pose goes to everyone else, and each player is shown as their own character where they stand, doing what they do, with their vehicle or ship under them. A server that holds the world as well keeps who you are and what your characters have; an older relay passes the words along and keeps nothing. Run one with <code>node server/relay.mjs</code> (port 8787) and give its address here; <code>?server=ws://host:8787</code> in the page's address does the same, and <code>?word=</code> carries the join word.</p>
        <div class="knob"><div class="knob-label">Server address<small>ws://host:8787, or wss:// behind a proxy with TLS</small></div><div class="knob-control"><input type="text" class="server" value="${esc(v.url)}" placeholder="ws://localhost:8787" spellcheck="false" /></div></div>
        <div class="knob"><div class="knob-label">Join word<small>The word the server was started with. Leave it empty for a server that asks for none.</small></div><div class="knob-control"><input type="text" class="word" value="${esc(v.word)}" placeholder="none" spellcheck="false" /></div></div>
        <div class="menu-actions"><button class="connect">Connect</button><button class="disconnect">Disconnect</button><span class="menu-hint net-status">${esc(v.status)} · ${MODE_WORDS[v.mode]}</span></div>
        ${ask ? `<h3>This character was played in two places</h3><p class="menu-hint">Both copies have changed the same number of times and they no longer say the same thing, so neither is plainly the newer. Choose which one stands; the other is let go. Answer nothing and the server's copy stands, with this browser keeping its own.</p>
        <div class="knob"><div class="knob-label">This browser<small>${esc(copyLine(ask.browser))}</small></div><div class="knob-control"><button class="keep-local">Keep this one</button></div></div>
        <div class="knob"><div class="knob-label">The server<small>${esc(copyLine(ask.server))}</small></div><div class="knob-control"><button class="keep-server">Keep this one</button></div></div>` : ''}
        <h3>Who you are <span>no accounts, no passwords</span></h3>
        <p class="menu-hint">This browser made itself a key the first time it ran, and that key is what a server knows you by. Copy it into another browser to be the same player there; keep a copy somewhere safe, because clearing this browser's data loses it. Anyone you give it to can be you.</p>
        <div class="knob"><div class="knob-label">Your name to a server<small>the front of your key's hash, which is all a server is told</small></div><div class="knob-control"><input type="text" class="player-id" value="${esc(v.player)}" readonly spellcheck="false" /></div></div>
        <div class="menu-actions"><button class="copy-key">Copy my key</button><button class="show-key">Show it</button><span class="menu-hint key-note"></span></div>
        <div class="knob key-out-row hidden"><div class="knob-label">Your key<small>write it down somewhere safe; it is the only copy</small></div><div class="knob-control"><input type="text" class="key-out" readonly spellcheck="false" /></div></div>
        <div class="knob"><div class="knob-label">Use a key<small>paste a key copied out of another browser; this browser becomes that player</small></div><div class="knob-control"><input type="text" class="key-in" placeholder="paste a key" spellcheck="false" /></div></div>
        <div class="menu-actions"><button class="use-key">Use this key</button><span class="menu-hint use-note"></span></div>
        <h3>Here <span>${v.peers.length} on this world</span></h3>${v.peers.length ? `<ul class="peer-list">${v.peers.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '<p class="menu-hint">Nobody else here.</p>'}`;
}
