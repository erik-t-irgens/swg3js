// The page's own address, as the game keeps it (`App.updateUrl`): the switches a player typed stay exactly as typed,
// and the three the select screen took over are taken off.
//
// Until the port's pass 1 the game wrote `?planet=…&zone=…&class=…` over the whole address on every arrival and class
// switch, which also threw away every other switch on it (`?server=`, `?word=`, `?norevz`, `?lowfx=1`, …) after the
// first arrival, so a reload lost the server a friend's link had carried. The select screen now chooses the character
// and the character's record its world and its kit, so the three words say nothing: they are removed where present,
// and nothing else is touched -- not re-encoded, not reordered, not given an `=` it was typed without.
//
// Pure: no DOM, no `location`. Rule for this file (node runs it with type stripping): no enum, no namespace, no
// constructor parameter properties.

/** The switches the address no longer carries. Nothing reads them: `?class=` no longer picks the kit. */
export const DROPPED_SWITCHES: readonly string[] = ['planet', 'zone', 'class'];

/** A part's name as a browser reads it (`URLSearchParams`: `+` is a space, percent escapes decoded), or as typed when it will not decode. */
function nameOf(part: string): string {
  const eq = part.indexOf('=');
  const raw = (eq < 0 ? part : part.slice(0, eq)).replace(/\+/g, ' ');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * `search` (`location.search`, with or without its `?`) with every `planet`, `zone` and `class` part taken out and
 * every other part left exactly as it was typed, in its order; '' when nothing is left. An address with none of the
 * three comes back as it was given (with its `?`), so the caller can tell there is nothing to write.
 */
export function addressKept(search: string): string {
  const body = search.startsWith('?') ? search.slice(1) : search;
  if (!body) return '';
  const parts = body.split('&');
  const kept = parts.filter((part) => !DROPPED_SWITCHES.includes(nameOf(part)));
  if (kept.length === parts.length) return `?${body}`;
  const joined = kept.join('&');
  return joined ? `?${joined}` : '';
}
