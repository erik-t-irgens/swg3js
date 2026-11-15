# The animation importer

Turns a folder of Mixamo FBX animations into the small clip pack the game ships (`public/anims/mixamo/`). It is a
developer's tool: players never run it and never download anything for it. The pack is committed and goes out with
every build, so an imported animation reaches players the way the rest of the game does.

```
npm run anims -- import "<folder of .fbx files>"
```

Options: `--out <folder>` writes the pack somewhere else (the tests use it), `--quiet` prints the report without a
line for every file. The command exits 2 when a file could not be read or was made for another skeleton.

It reads the folder, sub-folders and all, and writes the pack. It never writes into the folder it reads, copies no
source file anywhere, and reads nothing of the game's own files. **The FBX files themselves never go into the
repository**: Mixamo's animations may be used in a game but not handed on as raw files, and what is committed here is
not one (see "What the pack holds").

## Downloading from Mixamo

Any character will do, as long as every file comes off the same one: the importer keeps one rest pose for the whole
pack and leaves out, by name, a file whose rest pose differs from the first's. "Without skin" is enough (the mesh is
not read). Frames a second can be anything; every clip is sampled again at 30. Leave "In place" off: the importer
measures how far a clip travels and the game takes the travel out itself.

## What it works out

For each file, by its own numbers and printed in the report:

- **Its id**: the file name in lower case with every run of anything else an underscore (`Falling Flat Impact.fbx`
  is `falling_flat_impact`, `Walking (1).fbx` is `walking_1`). Two files of one name in different folders take their
  folder in front (`braced_hanging_idle`). The game calls the clip `mx_<id>`.
- **Whether it loops**: its last pose against its first.
- **How far and how fast it travels**: the hips' net travel, and for a clip with feet on the ground the speed and
  heading its planted feet show, which is checked against what the hips did (the report's travel check).
- **Its foot marks**: when each foot comes down, for the footsteps. (The game hears two marks within a twentieth of
  a second as one step: a landing on both feet.)
- **For a one-off**: how high the lower foot stands where the game starts it, and when a foot first comes down.

`mixamoClips.mjs` holds what cannot be read off a file, one row for each clip that needs more than the defaults:
which clips the game loads at start (`use`), a loop the poses do not show, where a one-off starts (`trimStart`), a
mirrored twin to write as well (`mirror`), a clip with nothing under its feet (`ground: false`: the water, the air,
a wall, and the flat impact, which no one lands on their feet), and an airborne loop authored off the ground
(`level`). A row that names no file is printed. Adding a clip the game should play is a row there, a run of the
importer, and a rule in `src/anim/animRules.ts`.

Only a clip that ends pose for pose as it began is called a loop in the table: the three that climb stairs are
(their hips rise, their poses come round), the two that descend are not (each ends with its legs some fifty degrees
from where they began) and stay one-offs until a later wave decides how stairs are cycled.

**The walks, jogs, runs and strafes** the speed classes play (wave 2a: `src/anim/locoTable.ts`, the brief's
Locomotion list as one table) are sixteen rows marked `use` in `mixamoClips.mjs`, twenty clips with the four
mirrored twins. A mirrored twin (`<id>_mirrored`) takes its original's `use`, so marking a one-sided strafe loads
both sides. What the game reads of each off the
index is what this importer measured: its speed (what the class's pace starts at, and what its playback rate is
worked out against), its heading to the nearest 45 degrees (which way its feet carry it: `CLIP_HEADING` in the table
is held to it by `locoTable.test.ts`), and its left-foot marks (where a stride begins, which is what two clips are
kept in step by while one fades into the other). A clip put in the table must be a loop with a left-foot mark and a
measured speed, and the test says so if it is not.

The measured speed is read off each stance's settled middle, between the frames as the game plays the clip: over
each span from one planted frame to the next, the part of it where the heel and the toe are both within 1.5 cm of
the lowest each gets (the height taken straight across the span) and neither rises or falls faster than 0.2 m/s
across it (`settledNear`, `settledStill` in `analyze.mjs`), so never where the foot is still coming down heel first or
already rolling up onto its toe. A stance with no span that still keeps its stillest one near the ground
(`settledShares`): a run's foot that lands and at once rolls its heel up off its toe is flat for an instant, and every
stance of each foot says how fast it went. Over those parts it is the foot's speed back over the ground the clip is
carried on (the hips' mean travel, the very ramp the game's fitter takes out of a loop), never its speed under the
hips, whose sway fore and aft over a stance is no motion of the body at all. Where the plants are found and the foot
marks are unchanged, and the heading is still the planted feet's way under the hips over every planted frame. On the
level clips whose source travels (the report's travel check: the hips' own travel is the truth there) the measure
meets the hips within 2%; a loop that climbs (stairs) has its feet on steps, never on the one floor the measure
reads, and the report says so rather than holding it to its hips. Before it was mended (2026-11-15) the speed was the
mean under the hips over every planted frame and read 2 to 10% low, which with the stride scaled by the hips' height
rather than the legs' (`FitPlan.stride` now) left a planted foot slipping back 3 to 16% of the ground speed in the
game. `rate.feet` in the game's tune (`__debug.loco({ tune: { rate: { feet: 1.05 } } })`) is every clip's foot speed
as a share of what the index says, started at 1 and kept for the eye.

How the game holds a clip in place follows from whether it loops: a loop is held about where its first frame has the
hips, and a one-off over the hips' own rest place, so a take that happens to begin a step to one side does not play
a step to one side.

## What the pack holds

`index.json`: the format, 30 frames a second, the bone list (every bone with a rotation track, its parent and its
rest place in metres) and a row a clip. One `<id>.mxa` a clip: a 12-byte header, then for every frame each bone's
**turn away from its own rest pose**, in the world, as four 16-bit numbers, then the hips' travel in metres as
32-bit floats. That is a motion, in the source's own frame, and nothing of anybody's skeleton, mesh or file format:
about 1.5 MB for 81 clips. `src/anim/mxaFile.ts` reads and writes it, and a run over the same folder writes the same
bytes.

The game fits a clip to each skeleton when that skeleton's first rig loads (`src/anim/fit.ts`, `mixamoPack.ts`):
see "Animations from Mixamo" in the main README.

## After a run

Look at `git status -- public/anims`: a changed clip is one changed file and one changed line of the index. A clip
the folder no longer gives leaves no file behind. Commit the pack with the change that uses it. A built game asks
for the pack only once it is tracked (the build's list of what it ships is git's), so an import nobody committed
plays on the dev server and nowhere else.

## Tests

`npm run test:anim`. The suites run on skeletons and clips made in the tests and on the committed pack. The reader
and the importer are run on FBX files the tests write themselves (`tools/swg/tests/animFbxFixture.ts`: a few bones
and keys as text, which three's own loader reads as it reads Mixamo's), so the order a turn is taken in, the
sampling, the travel's signs and units, the foot marks' frames and the table's every setting are held on any
machine, and the committed pack is held to the table row by row. `animImport.test.ts` also imports a real folder
when `SWG3JS_MIXAMO_FBX` names one (the committed pack must then be that folder's import byte for byte), and says it
skipped that part otherwise. The speed's measure is held on a walk the test lays out with a known stride, landing and
lifting frames and a swaying hips included (`strideWalk` in `animFixtures.ts`), and `locoSlip.test.ts` plays every
clip of the speed classes' table as the game fits it, between its keys, at the game's own rate, on three leg lengths
and holds each planted foot within 2% of the ground across its stances' middles.
