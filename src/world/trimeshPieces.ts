// A huge mesh's collision, split into pieces the physics can build a few at a time (the Star
// Destroyer's 120k triangles take tens of milliseconds in one piece). Pure: no three, no Rapier; the
// node tests import it.

/**
 * A mesh's triangles split into pieces of at most `maxTriangles`, each with only the vertices it uses
 * (renumbered), so the engine's duplicate-vertex merge works on a piece's own vertices and not the
 * whole mesh's for every piece. Triangles are kept in order; a piece never splits a triangle.
 * `vertices` is x, y, z per vertex; `indices` three per triangle (a trailing partial triangle is dropped).
 */
export function splitTrimesh(vertices: Float32Array, indices: Uint32Array, maxTriangles: number): { vertices: Float32Array; indices: Uint32Array }[] {
  const per = Math.max(1, Math.floor(maxTriangles) || 1);
  const triangles = Math.floor(indices.length / 3);
  const out: { vertices: Float32Array; indices: Uint32Array }[] = [];
  // Old vertex index to its number in the current piece, reset per piece by a stamp rather than a clear.
  const vertexCount = Math.floor(vertices.length / 3);
  const remap = new Int32Array(vertexCount);
  const stamp = new Int32Array(vertexCount);
  for (let first = 0, piece = 1; first < triangles; first += per, piece++) {
    const count = Math.min(per, triangles - first);
    const idx = new Uint32Array(count * 3);
    const used: number[] = [];
    for (let i = 0; i < count * 3; i++) {
      const v = indices[first * 3 + i];
      if (stamp[v] !== piece) {
        stamp[v] = piece;
        remap[v] = used.length;
        used.push(v);
      }
      idx[i] = remap[v];
    }
    const verts = new Float32Array(used.length * 3);
    for (let i = 0; i < used.length; i++) {
      verts[i * 3] = vertices[used[i] * 3];
      verts[i * 3 + 1] = vertices[used[i] * 3 + 1];
      verts[i * 3 + 2] = vertices[used[i] * 3 + 2];
    }
    out.push({ vertices: verts, indices: idx });
  }
  return out;
}
