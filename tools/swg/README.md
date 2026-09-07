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
npm run swg -- snapshot "C:/SWG" tatooine assets-private/tatooine --center=3528,-4804 --radius=500 --retail-only   # the real Mos Eisley
```

`snapshot` reads the planet's world snapshot (`snapshot/<planet>.ws`), keeps every top-level object within the radius of the centre, resolves each object template through its base-template chain to an appearance (portal buildings use their exterior cell), converts each unique mesh, and writes `layout.json` plus a `layout` category in the manifest. The game centres the world on that point, mirrors X to match the converted meshes, pulls the terrain to each object's recorded height, instances every object with its exact rotation, and gives the larger ones near spawn exact collision.

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
| Terrain rule files (.trn) | Not started; the game pulls its own terrain to snapshot heights instead |
| Component appearances (.cmp), skeletal (.sat), particles (.prt) | Skipped with counts in the snapshot output |

Archive reading is verified on real client data. Mesh conversion is still being validated; if a conversion fails, run `dump` on the file and share the output.
