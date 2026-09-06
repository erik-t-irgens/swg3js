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
```

Flags: `--retail-only` mounts only archives named in the retail manifests, `--no-flip` keeps left-handed coordinates, `--no-textures` skips DDS decoding.

Status:

| Stage | State |
| --- | --- |
| TRE archives: header, zlib records, deletion markers, publish load order | Written against the engine's struct definitions, tested on synthetic archives |
| Retail manifest verification | Names, sizes and hashes for the 14.1, CU and final NGE sets |
| IFF parsing and `dump` | Tested |
| Static meshes (.msh, .apt, .lod) to GLB with vertex colours, hardpoints and bounds | Written against the engine loaders, tested on a synthetic mesh |
| Shaders to main texture, DDS (DXT1/3/5, uncompressed) to PNG embedded in GLB | Tested on synthetic data |
| Skinned meshes, skeletons, animations (.mgn, .skt, .ans) | Formats documented, not started |
| World snapshots and terrain (.ws, .trn) | Not started |

Real client data has still not been run through it. If a conversion fails, run `dump` on the file and share the output.
