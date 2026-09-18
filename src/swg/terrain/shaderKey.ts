// The one spelling of a water shader's name. The terrain writes it as a template path
// ("shader\\wter_spec.sht"), the converter keys water.json by it, and the game looks its
// entry up with it, so all three must reduce a name exactly the same way.
// No imports: the converter (plain node), the game (Vite) and the node tests all read this file.

/**
 * A shader template name as a terrain or a shader writes it, reduced to the key water.json uses:
 * no folder, no ".sht", lower case ("shader\\Wter_Spec.sht" -> "wter_spec").
 */
export function shaderKey(name: string): string {
  const base = (name ?? '').replace(/\\/g, '/').split('/').pop() ?? '';
  return base.replace(/\.sht$/i, '').trim().toLowerCase();
}
