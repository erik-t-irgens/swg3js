# SWG asset converter

Converts data from a locally owned Star Wars Galaxies client install into GLTF for private builds. Nothing it produces may be committed; `assets-private/` is git-ignored for this reason.

```bash
npm run swg -- list "C:/SWG" appearance/mesh/         # list matching files across all .tre archives
npm run swg -- dump "C:/SWG" appearance/mesh/thm_tato_moisture_vap_s01_l0.msh   # print the IFF tree
npm run swg -- msh "C:/SWG" appearance/thm_tato_moisture_vap_s01.apt assets-private/vaporator.glb
npm run swg -- batch "C:/SWG" assets-private/meshes appearance/mesh/
```

Status:

| Stage | State |
| --- | --- |
| TRE archives (plain and zlib records) | Written from the community format description, untested against a real install |
| IFF parsing and `dump` | Same |
| Static meshes (.msh, .apt, .lod) to GLB | Same. Vertex layout follows the client's vertex buffer flags |
| Textures (.dds via shaders) | Not started |
| Skinned meshes, skeletons, animations (.mgn, .skt, .ans) | Not started |
| World snapshots and terrain (.ws, .trn) | Not started |

If a conversion fails, run `dump` on the file and share the output; the parser is written to be adjusted from that.
`--flip-z` mirrors the Z axis for meshes that come out reversed.
