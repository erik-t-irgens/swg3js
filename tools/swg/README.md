# SWG asset converter

Converts data from a locally owned Star Wars Galaxies client install into GLTF for private builds. Nothing it produces may be committed; `assets-private/` and `*.tre` are git-ignored for this reason. See `docs/ASSETS.md` for what you may convert and why.

```bash
npm run swg -- verify "C:/SWG"                                   # which archives are retail, which are a project's own
npm run swg -- list "C:/SWG" appearance/mesh/thm_tato            # list files, search priority applied
npm run swg -- dump "C:/SWG" appearance/mesh/thm_tato_moisture_vap_s01_l0.msh
npm run swg -- shader "C:/SWG" shader/thm_tato_moisture_vap.sht
npm run swg -- texture "C:/SWG" texture/thm_tato_moisture_vap.dds assets-private/vap.png
npm run swg -- msh "C:/SWG" appearance/thm_tato_moisture_vap_s01.apt assets-private/vaporator.glb
npm run swg -- batch "C:/SWG" assets-private/meshes appearance/mesh/ --retail-only
npm run swg -- pack "C:/SWG" tools/swg/packs/tatooine.json assets-private/tatooine --retail-only   # scatter props and outpost models
npm run swg -- snapshot "C:/SWG" tatooine assets-private/tatooine --center=3528,-4804 --radius=500 --retail-only   # the real Mos Eisley, with terrain
npm run swg -- snapshot "C:/SWG" tatooine assets-private/tatooine --center=3528,-4804 --radius=all --retail-only   # the whole planet (streams in-game)
npm run swg -- planets "C:/SWG" --retail-only                                                                       # which planets the archives hold, and where each would centre
npm run swg -- snapshot "C:/SWG" all assets-private --radius=all --retail-only                                      # every planet the game knows, one pack each
npm run swg -- terrain "C:/SWG" tatooine assets-private/tatooine                                                  # just the terrain template
npm run swg -- terrain-check assets-private/tatooine                                                              # generated heights vs. snapshot heights
```

`snapshot` reads the planet's world snapshot (`snapshot/<planet>.ws`), keeps every top-level object within the radius of the centre (`--radius=all` for the whole planet; the game streams objects in 256 m regions by size, so a full planet costs disk and conversion time, not frame rate), resolves each object template through its base-template chain to an appearance (portal buildings use their exterior cell), converts each unique mesh, and writes `layout.json` plus a `layout` category in the manifest. It also copies the planet's terrain template (`terrain/<planet>.trn`) to `terrain.trn`, decodes the terrain bitmaps its layers reference into `terrain/<name>.hmap`, and copies every building's terrain-modification layer (`terrainModificationFileName`, a `.lay` file) into `terrain/`, recording which object uses which. The game centres the world on that point, mirrors X to match the converted meshes, instances every object with its exact rotation, and gives the larger ones near spawn exact collision. Without `--center` (or with `--center=auto`) the centre is the planet's starport, failing that its shuttleport, failing that the middle of the 256 m square holding the most objects; `planets` lists every snapshot in the archives with the centre it would pick, and `snapshot <dir> all <out-dir>` converts each planet the game knows (`src/data/planets.ts`) into `<out-dir>/<planet>`, which is where the game looks for a planet's pack.

`snapshot` also converts the planet's flora: the terrain template's flora group names, per family, the appearances the game plants (trees, rocks, plants, with weights and scale ranges); each is converted into `flora/` and listed in the manifest's `flora` category keyed by appearance file. In game the terrain's flora affectors and the baked collidable flora map decide where each family grows, and the same seeded random numbers as the engine decide the exact spot, heading and scale of every plant, which is why flora was identical on every server. Terrain water comes from the template as well: the global water table height, and every lake and pool boundary (rivers still to do).

`flora <dir> <planet>|all <out-dir>` reconverts just the flora for packs converted already.

`snapshot` also writes `pois.json`: the planet's named regions from the client's `datatables/clientregion/<planet>.iff` (cities and landmarks, with their display names from `string/en/*.stf`) and every starport and shuttleport in the snapshot, named after the region it stands in. The galaxy map lists them under each planet and teleports you there. `pois <dir> <planet>|all <out-dir>` rewrites just that file for packs converted already (the centre comes from the pack's `layout.json`).

`terrain-check` (Node 22.18 or newer, since it runs the game's TypeScript directly) runs the ported terrain generator (`src/swg/terrain/`) over the pack: it prints the template's header and layer counts, applies each building's layer at its snapshot position and heading, then samples the ground under every top-level object and compares it with the height the snapshot recorded (objects were placed on the ground in the original editor, so the difference measures how faithful the port is). Expect a median well under half a metre; the worst offenders are listed with their templates so a wrong affector type can be tracked down.

`pack` converts the highest-detail mesh of every family matching a spec (see `packs/`) and writes `manifest.json`. The game looks for `assets-private/<planet>/manifest.json`, scatters the `rocks`, `debris`, `vaporators` and `flora` categories across the terrain in place of the primitive props, and places the structures listed in `src/data/outposts.ts` near the spawn on flattened ground with triangle-mesh collision.

Flags: `--retail-only` mounts only archives named in the retail manifests, `--no-flip` keeps left-handed coordinates, `--no-textures` skips DDS decoding.

Status:

| Stage | State |
| --- | --- |
| TRE archives: 5000 headers, 6000 data-only archives via `.toc` indexes, zlib records, deletion markers, publish load order | Verified on a real SWG Legends install: all 201 retail archives mount |
| Retail manifest verification | Names, sizes and hashes for the 14.1, CU and final NGE sets |
| IFF parsing and `dump` | Tested |
| Static meshes (.msh, .apt, .lod) to GLB with vertex colours, hardpoints and bounds | Written against the engine loaders, tested on a synthetic mesh |
| Shaders to main texture, DDS (DXT1/3/5, uncompressed) to PNG embedded in GLB | Tested on synthetic data |
| Skinned meshes, skeletons, animations (.mgn, .skt, .ans) | Formats documented, not started |
| World snapshots (.ws), object templates, portal buildings (.pob exterior) | Written against the engine loaders, tested synthetically |
| Terrain rule files (.trn), bitmaps and building layers (.lay) | Generator ported from the engine (fractals, boundaries, filters, bitmap filters, height, shader, road and river affectors); fractal noise verified bit-for-bit against the engine's code. On retail Tatooine, `terrain-check` puts 81% of Mos Eisley's snapshot objects within 0.5 m of the generated ground (median 0.00 m); the rest are objects that never sat on the ground (rooftop furniture, wall terminals, walls sunk 2 m, hand-typed fort heights) |
| Component appearances (.cmp) | Parts baked into one mesh by their transforms |
| Skeletal (.sat), particles (.prt) | Skipped with counts in the snapshot output |

Archive reading is verified on real client data. Mesh conversion is still being validated; if a conversion fails, run `dump` on the file and share the output.
