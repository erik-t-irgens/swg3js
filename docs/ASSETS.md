# Assets: where SWG content comes from and what we may use

Findings from research into the SWG client archives, the emulator projects and the file formats, verified where possible against primary sources (the SWGEmu launcher manifests and server config, community launcher manifests, and the leaked SOE engine source used only as a format reference). Nothing here is legal advice.

## The short version

- The 2003 retail discs hold launch-era content only. Almost everything people remember (RIS armor, Mandalorian armor, expansion species, every later clothing and armor set) arrived in later patch archives.
- Later content was always delivered as additional `.tre` archives. The base archives on the discs were never replaced, so a disc install plus the patch archives is the complete client.
- SWGEmu's launcher copies the disc archives from your install and downloads the remaining pre-CU patch archives from the project's mirror. That is the project's own workflow, and its rule is that you must own the discs. You do.
- The NGE-era projects (SWG Legends, SWG Restoration) distribute the entire final client through their launchers. Reports say no retail copy is required, though their pages could not be fetched directly to confirm the wording.
- No cease-and-desist, takedown or lawsuit against any SWG emulator was found in fifteen-plus years. The projects' posture is non-profit, non-affiliated, and (for SWGEmu) own-the-discs.

So for a private, friends-only build: use the discs you own plus the SOE-origin patch archives from an emulator install, convert locally, never commit or host the output, and exclude the emulator projects' own custom archives. That is the same footing the emulators themselves stand on.

## What each client version contains

| Set | Archives | Size | Content |
| --- | --- | --- | --- |
| 2003 discs (An Empire Divided) | 24: bottom, data_* (animation, music, other, sample_00-04, skeletal_mesh_00-01, static_mesh_00-01, texture_00-07), default_patch, patch_00, patch_01 | ~1.7 GiB | Launch content |
| Pre-CU 14.1 (SWGEmu's client) | 53: discs + patch_02..patch_10, patch_11_00..03, patch_12_00, patch_13_00, patch_14_00, data_sku1_00..07 (Jump to Lightspeed), patch_sku1_12..14_00, two hotfixes | ~2.9 GB | Everything through March 2005, including JTL, Ithorian and Sullustan species |
| CU era (publish 25) | 93 archives plus 4 `.toc` files | ~3.9 GB | Adds Rage of the Wookiees (sku2) and Trials of Obi-Wan (sku3) |
| Final NGE (patch 58, hotfix 59) | 201 archives plus 4 `.toc` files | ~6.1 GB | All clothing, armor, heroic sets and chapter content through December 2011 |

Introduction dates worth knowing: RIS armor in Publish 4 (November 2003), Mandalorian armor in Publish 8 (May 2004), CU-era faction armor in April 2005, heroic armor sets in Chapter 7 (November 2007). None of these are on the discs.

## Which archives are yours to convert

Only SOE-origin archives: `bottom.tre`, `default_patch.tre`, `holidays.tre`, `data_*.tre`, `patch_*.tre`, `hotfix_*.tre`. Emulator projects add their own archives containing work they made themselves and license restrictively: `restoration_N.tre` (Restoration), `Stardust_0N.tre`, `mtg_patch_NNN.tre` and `mtg_planets.tre` (ModTheGalaxy), `swgsource_3.0.tre` (SWG Source), and SWG Legends encrypts its client data. Leave all of those out.

`npm run swg -- verify <dir>` hashes every archive in a directory against the retail manifests in `tools/swg/manifests/retail.json` (names, sizes and hashes only, taken from the SWGEmu launcher manifest, a CU launcher manifest and a final-client manifest) and says which are retail. `--retail-only` on any other command mounts only archives whose names and sizes match those manifests.

## How the client resolves files

The client reads `[SharedFile] searchTree_<sku>_<priority>` entries from its config and searches the highest priority first. A zero-length record in an archive is a deletion marker that hides the file from lower archives. The converter models the same order from archive names (bottom, base data, each publish in sequence with expansion archives just above their base patch and hotfixes above that, `default_patch` on top) and honours deletion markers, so `list` and `read` see what the game saw.

## Format facts the converter relies on

- TRE header is 36 bytes: `EERT`, `5000`, file count, TOC offset, TOC compressor, TOC compressed size, name-block compressor, name-block compressed size, name-block uncompressed size. Records are 24 bytes: CRC of the name, length, offset, compressor, compressed length, name offset. Compressor 0 is stored (compressed length may be 0), 1 is retired, 2 is zlib. An MD5 block follows the names.
- From Publish 18 onward (the `_client` / `_shared` split), SOE wrote version `6000` archives: the token reads `EERT6000` and the rest of the header is zero. They are data-only blobs. The client reads them through the `.toc` index files (`sku0_client.toc` and so on), which are what the final client lists in its config instead of archives. Verified on a real install: every archive from patch_18 through hotfix_59 is `6000`.
- A `.toc` index has a 36-byte header (token `TOC `, version `0001`, two compressor bytes, file count, entry block size, name block sizes, archive count, archive name block size), then the archive names, 24-byte entries (compressor, archive index, CRC, name length, offset, length, compressed length) and the file names. The converter mounts self-indexed archives first and then applies each index in SKU order.
- IFF blocks are a tag plus a big-endian length. A FORM's length includes its 4-byte type. Payloads are little-endian.
- Static meshes: `FORM MESH > 0005 > APPR + SPS`. Shader groups carry a `NAME` (shader path) and primitives with an `INFO` (int32 type, bool8 hasIndices, bool8 hasSortedIndices), a `VTXA > 0003 > INFO + DATA` vertex buffer and an `INDX` (int32 count, uint16 indices). Real files use primitive type 9, indexed triangle list.
- Vertex flags: bit 0 position, 1 transformed, 2 normal, 3 color0, 4 color1, 5 point size, bits 8-11 texture set count, two bits per set from bit 12 holding dimension minus one. Fields are stored in that order. Packed colours are ARGB written little-endian, so B, G, R, A on disk.
- The engine is left-handed Y-up. SOE's own Maya exporter negates X, so the converter negates X and reverses winding to produce right-handed GLTF.
- Shaders: `FORM SSHT` (sometimes inside `FORM CSHD`) holds `TXMS` with one `TXM` per slot: `DATA` (uint32 tag, written little-endian so `MAIN` reads `NIAM` on disk, then sampler bytes) and `NAME` (the `.dds` path).
- Textures are plain DDS: DXT1 to DXT5 plus uncompressed masked formats.
- World snapshots (`.ws`): `FORM WSNP > 0001 > NODS` of `NODE` forms plus an `OTNL` chunk of template names. Each node's `DATA` holds network id, container id, template index, cell index, a quaternion (w, x, y, z), a position, a radius and the portal layout CRC; child nodes are objects inside the building's cells.
- Object templates: `FORM <TYPE> > [DERV { base template }] > FORM 00NN > PCNT + one chunk per parameter` (name, then for strings an int8 type byte of 1 and the value). `appearanceFilename` is inherited through the base chain.
- Portal objects (`.pob`): `FORM PRTO > 000N > CELS > CELL` forms; cell 0 is the exterior and its `DATA` names the appearance.
- Skinned meshes (`.mgn`), skeletons (`.skt`) and animations (`.ans`) are documented in the research and are the next converter stage.

## Reference implementations

Open-source readers that agree with the engine: SWGEmu Core3 `MMOCoreORB/src/tre3`, Kenneth Sewell's treLib, the `swg-rs` crate, Swg.Explorer (C#), and nostyleguy's Blender addon `io_scene_swg_msh`. The SWG-Titan/CSRC repository mirrors the leaked SOE engine source and is the authoritative description of every loader, but it is leaked proprietary code: read it to understand formats, never copy it. One warning: the Blender addon's `vertex_buffer_format.py` defines the point-size flag as 0x10 instead of 0x20, and the CSRC repo's own `swg_blender_addon/formats/msh.py` does not match retail files.
